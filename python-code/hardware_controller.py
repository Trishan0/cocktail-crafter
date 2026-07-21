"""
hardware_controller.py — Hardware Abstraction Layer
Cocktail-Craft Bartender | Raspberry Pi

Defines the HardwareController interface and two concrete implementations:
  - SimulatorController : software-only simulation, no physical hardware needed
  - SerialController    : real ESP32 over USB/UART

app.py instantiates the correct controller at startup based on
config.SIMULATOR_MODE. All callers use the same method names regardless
of which controller is active.
"""

import json
import threading
import time
import serial
import serial.tools.list_ports
from datetime import datetime

import config
import machine_state as ms
from machine_state import MachineState


# ─────────────────────────────────────────────
#  SHARED STATE  (thread-safe via lock)
# ─────────────────────────────────────────────

_lock = threading.Lock()

_state = {
    # Connection
    "connected":    False,
    "last_seen":    None,       # ISO timestamp of last message from ESP32

    # Machine state (updated from ESP32 STATUS messages or simulator)
    # Full lifecycle: idle → waiting_glass → dispensing → mixing → pouring →
    #   done → reversing → washing → mixing(shake) → draining → resealing → idle
    # Stored as a MachineState enum value; serialised to str for JSON/SSE output.
    "machine_status":   MachineState.IDLE,
    "current_order_id": None,
    "progress":         0,      # 0-100
    "message":          "",     # human-readable status text

    # Sensor state (updated from ESP32 SENSOR messages or simulator)
    "glass_state": "no_glass",
    "lower_sensor": False,
    "upper_sensor": False,
    "liquid_levels": {f"ls{i}": 0 for i in range(1, 7)},
}

_status_callbacks = []   # registered by app.py via register_status_callback()
_sensor_callbacks = []   # registered by app.py via register_sensor_callback()

_clean_timer = None
CLEAN_DELAY_SECONDS = 10 * 60
# ─────────────────────────────────────────────
#  PUBLIC REGISTRATION HELPERS
# ─────────────────────────────────────────────

def register_status_callback(fn):
    if fn not in _status_callbacks:
        _status_callbacks.append(fn)


def register_sensor_callback(fn):
    if fn not in _sensor_callbacks:
        _sensor_callbacks.append(fn)


# ─────────────────────────────────────────────
#  INTERNAL DISPATCH HELPERS (shared by both controllers)
# ─────────────────────────────────────────────

def _handle_status(data: dict):
    """
    Parse a STATUS payload, validate the state transition, and update shared state.

    Expected payload (from ESP32 or simulator):
    {
        "type":     "STATUS",
        "order_id": 42,
        "status":   "dispensing",   // or "machine_status" key — both accepted
        "progress": 40,             // 0-100
        "message":  "Dispensing Rum..."
    }

    Validation (per PROTOCOL.md §4 / machine_state.py):
    - Unknown state strings are logged and REJECTED (stale state preserved).
    - Illegal transitions are logged and REJECTED (stale state preserved).
    - This prevents buggy/malicious ESP32 firmware from corrupting Pi-side state.
    """
    with _lock:
        # ESP32 may send either "machine_status" or "status"
        raw_status = data.get("machine_status", data.get("status", ""))
        current    = _state["machine_status"]   # MachineState enum

        # ── Parse incoming state string ───────
        new_state = ms.parse_state(raw_status)
        if new_state is None:
            print(f"[HW] REJECT unknown state {raw_status!r} (staying {current.value})")
            return

        # ── Validate the transition ───────────
        if not ms.is_valid_transition(current, new_state):
            print(
                f"[HW] REJECT illegal transition {current.value!r} → {new_state.value!r} "
                f"(message: {data.get('message', '')!r})"
            )
            return

        # ── Accept and update ─────────────────
        state_changed = (current != new_state)
        _state["machine_status"]   = new_state
        _state["current_order_id"] = data.get("order_id", data.get("current_order_id", _state["current_order_id"]))
        _state["progress"]         = data.get("progress", _state["progress"])
        _state["message"]          = data.get("message",  _state["message"])
        state_copy = dict(_state)
        # Serialise enum → str for JSON/SSE consumers
        state_copy["machine_status"] = new_state.value

    print(f"[HW] STATUS {current.value!r} → {new_state.value!r} ({state_copy['progress']}%) | {state_copy['message']}")

    if state_changed:
        import db
        detail = f"Order #{state_copy.get('current_order_id')}" if state_copy.get("current_order_id") else None
        try:
            db.log_event(f"state:{new_state.value}", detail)
        except Exception as e:
            print(f"[HW] Event logging error: {e}")

    for cb in _status_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[HW] Status callback error: {e}")


def _handle_sensor(data: dict):
    """
    Parse a SENSOR payload and update shared state.
    Expected payload:
    {"type": "SENSOR", "glass_state": "small_glass", "lower_sensor": true, "upper_sensor": false}
    """
    with _lock:
        old_glass = _state.get("glass_state", "no_glass")
        if "glass_state" in data:
            _state["glass_state"] = str(data["glass_state"]).lower()
        if "lower_sensor" in data:
            _state["lower_sensor"] = bool(data["lower_sensor"])
        if "upper_sensor" in data:
            _state["upper_sensor"] = bool(data["upper_sensor"])
        state_copy = dict(_state)
        glass_changed = (old_glass != state_copy["glass_state"])
        # Serialise MachineState enum -> str for callbacks
        if isinstance(state_copy["machine_status"], MachineState):
            state_copy["machine_status"] = state_copy["machine_status"].value

    print(
        f"[HW] SENSOR -> glass_state={state_copy['glass_state']} "
        f"lower={state_copy.get('lower_sensor')} upper={state_copy.get('upper_sensor')}"
    )

    if glass_changed:
        import db
        try:
            db.log_event("sensor:glass", state_copy["glass_state"])
        except Exception as e:
            print(f"[HW] Event logging error: {e}")

    for cb in _sensor_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[HW] Sensor callback error: {e}")


def get_state() -> dict:
    """Return a copy of the current shared state. machine_status is always a plain string."""
    with _lock:
        s = dict(_state)
    # Serialise MachineState enum → str so callers never need to import machine_state
    if isinstance(s["machine_status"], MachineState):
        s["machine_status"] = s["machine_status"].value
    return s


# ─────────────────────────────────────────────
#  BASE INTERFACE
# ─────────────────────────────────────────────

class HardwareController:
    """
    Abstract interface for the hardware layer.
    Both SimulatorController and SerialController implement these methods.
    app.py instantiates one at startup; all callers use this interface.
    """

    def start(self):
        """Initialise the controller. Call once at startup."""
        raise NotImplementedError

    def stop(self):
        """Cleanly shut down the controller."""
        raise NotImplementedError

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list, ice: bool = False, first_after_power_on: bool = False):
        """
        Send an ORDER command.
        pump_commands: [{"pump": 1, "ingredient": "Rum", "amount_ml": 50, "duration_ms": 33333}, ...]
        ice: whether the customer requested ice (ESP32 triggers ice mechanism if true)
        first_after_power_on: add each pump's configured startup prime time once after power-on
        """
        raise NotImplementedError

    def send_abort(self):
        """Send an emergency ABORT — stop all dispensing immediately."""
        raise NotImplementedError

    def send_power(self, powered: bool, reverse_config: list = None):
        """Send a soft power-state command to the ESP32."""
        raise NotImplementedError

    def send_clean(self, trigger: str = "manual", mode: str = "all", pump: int = None, order_id: int = None, pumps: list = None):
        """
        Send a CLEAN command.

        trigger="post_order": automatic full cycle after every drink.
            Required: order_id (int), pumps (list of pump numbers used in that order)
        trigger="manual": admin-initiated line flush/prime, no container wash.
            Required: mode ("all" or "single")
            If mode="single", also pass: pump (int)
        """
        raise NotImplementedError

    def send_glass_ok(self):
        """Send a GLASS_OK command to bypass the physical glass IR sensors."""
        raise NotImplementedError

    # Convenience pass-through so callers don't need to import this module directly
    def get_state(self) -> dict:
        return get_state()


# ─────────────────────────────────────────────
#  SIMULATOR CONTROLLER
# ─────────────────────────────────────────────

class SimulatorController(HardwareController):
    """
    Software-only simulation of the ESP32 hardware.
    Runs the full order lifecycle and waits for glass removal before cleaning
    without any physical serial port.
    """

    def __init__(self):
        self._running = False
        self._abort_flag = threading.Event()

    def start(self):
        self._running = True
        with _lock:
            _state["connected"]      = True
            _state["machine_status"] = ms.MachineState.IDLE
        print("[SIM] SimulatorController started — SIMULATOR MODE active.")

    def stop(self):
        self._running = False
        print("[SIM] SimulatorController stopped.")

    # ── Commands ──────────────────────────────

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list, ice: bool = False, first_after_power_on: bool = False):
        print(f"[SIM] ORDER #{order_id} {recipe_name} | ice={ice} | first_after_power_on={first_after_power_on}")
        self._abort_flag.clear()
        threading.Thread(
            target=self._simulate_order_process,
            args=(order_id, recipe_name, ice),
            daemon=True,
            name=f"sim-order-{order_id}",
        ).start()

    def send_abort(self):
        print("[SIM] ABORT sent.")
        self._abort_flag.set()
        import db
        try:
            db.log_event("hardware_cmd:abort")
        except Exception as e:
            print(f"[HW] Event logging error: {e}")
        _handle_status({"type": "STATUS", "status": "aborted", "progress": 0, "message": "Order aborted by user."})
        threading.Timer(2.0, lambda: _handle_status({"type": "STATUS", "status": "idle", "progress": 0, "message": "Ready"})).start()

    def send_power(self, powered: bool, reverse_config: list = None):
        print(f"[SIM] POWER {'on' if powered else 'off'}")
        if powered:
            _handle_status({"type": "STATUS", "status": "idle", "progress": 0, "message": "Machine powered on."})
        else:
            threading.Thread(target=self._simulate_power_off_reverse, daemon=True, name="sim-power-off-reverse").start()

    def send_clean(self, trigger: str = "manual", mode: str = "all", pump: int = None, order_id: int = None, pumps: list = None):
        if trigger == "post_order":
            print(f"[SIM] CLEAN (post_order) → order #{order_id}, pumps {pumps}")
            # post_order clean is driven by _simulate_order_process; this is a no-op here
        elif trigger == "manual":
            pump_desc = f"pump {pump}" if mode == "single" else "all pumps"
            print(f"[SIM] CLEAN (manual, {mode}) → {pump_desc}")
            threading.Thread(
                target=self._simulate_manual_clean,
                args=(mode, pump),
                daemon=True,
                name="sim-manual-clean",
            ).start()

    def send_glass_ok(self):
        """In simulator, manually trigger the glass state update."""
        print("[SIM] GLASS_OK sent.")
        # Trigger the SENSOR event to place the glass
        _handle_sensor({"type": "SENSOR", "glass_state": "large_glass", "lower_sensor": True, "upper_sensor": True})

    # ── Internal simulation ───────────────────

    def _set_status(self, order_id, status, progress, msg):
        _handle_status({
            "type":     "STATUS",
            "order_id": order_id,
            "status":   status,
            "progress": progress,
            "message":  msg,
        })

    def _aborted(self):
        return self._abort_flag.is_set()

    def _simulate_order_process(self, order_id: int, recipe_name: str, ice: bool):
        """
        Full lifecycle:
          waiting_glass -> dispensing -> mixing -> pouring -> done
          -> wait for glass removal -> washing -> mixing(shake) -> draining -> resealing -> idle
        """
        s = self._set_status

        s(order_id, "waiting_glass", 0, "Waiting for glass...")
        if self._wait(2):
            return

        _handle_sensor({"type": "SENSOR", "glass_state": "large_glass", "lower_sensor": True, "upper_sensor": True})

        if ice:
            s(order_id, "dispensing", 5, "Adding ice...")
            if self._wait(1):
                return

        s(order_id, "dispensing", 10, f"Preparing {recipe_name}...")
        if self._wait(1.5):
            return

        s(order_id, "dispensing", 40, "Dispensing ingredients...")
        if self._wait(2):
            return

        s(order_id, "dispensing", 70, "Finishing dispense...")
        if self._wait(1):
            return

        s(order_id, "mixing", 80, "Mixing your drink...")
        if self._wait(1.5):
            return

        s(order_id, "pouring", 90, "Pouring into glass...")
        if self._wait(1):
            return

        s(order_id, "done", 100, "Enjoy your drink! Please remove the glass when finished.")
        print("[SIM] Waiting for glass removal before cleaning...")
        self._wait_for_glass_removed()
        if self._aborted():
            return

        _handle_sensor({"type": "SENSOR", "glass_state": "no_glass", "lower_sensor": False, "upper_sensor": False})

        s(order_id, "washing", 0, "Glass removed. Cleaning machine...")
        if self._wait(1):
            return

        s(order_id, "washing", 50, "Washing in progress...")
        if self._wait(2):
            return

        s(order_id, "washing", 90, "Almost done rinsing...")
        if self._wait(1):
            return

        s(order_id, "mixing", 70, "Shaking rinse water...")
        if self._wait(1.5):
            return

        s(order_id, "draining", 0, "Draining water...")
        if self._wait(1):
            return

        s(order_id, "draining", 60, "Draining water...")
        if self._wait(1.5):
            return

        s(order_id, "resealing", 0, "Resealing container...")
        if self._wait(0.5):
            return

        s(order_id, "resealing", 100, "Done!")
        if self._wait(1):
            return

        s(None, "idle", 0, "Ready for next order")
    def _simulate_power_off_reverse(self):
        _handle_status({"type": "STATUS", "status": "reversing", "progress": 0, "message": "Reversing pump lines before power off..."})
        time.sleep(2)
        _handle_status({"type": "STATUS", "status": "idle", "progress": 0, "message": "Machine powered off."})

    def _simulate_manual_clean(self, mode: str, pump: int):
        """Manual admin-triggered line flush — line only, no container wash."""
        pump_desc = f"pump {pump}" if mode == "single" else "all pump lines"
        _handle_status({"type": "STATUS", "status": "reversing", "progress": 0, "message": f"Flushing {pump_desc}..."})
        time.sleep(2)
        _handle_status({"type": "STATUS", "status": "idle", "progress": 0, "message": "Ready"})

    def _wait(self, seconds: float) -> bool:
        """Sleep in small increments; return True if aborted."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            if self._aborted():
                return True
            time.sleep(0.1)
        return False

    def _wait_for_glass_removed(self):
        """
        Block until glass_state == NO_GLASS (or abort).
        In the simulator, we auto-remove the glass after 3 seconds to keep things moving.
        On real hardware, the ESP32 sends a SENSOR event when the customer lifts the glass.
        """
        deadline = time.time() + 3.0   # sim shortcut: auto-remove after 3s
        while time.time() < deadline:
            if self._aborted():
                return
            with _lock:
                if _state.get("glass_state") == "no_glass":
                    return
            time.sleep(0.1)
        # Auto-remove for simulator
        with _lock:
            _state["glass_state"] = "no_glass"


# ─────────────────────────────────────────────
#  SERIAL CONTROLLER  (real ESP32)
# ─────────────────────────────────────────────

class SerialController(HardwareController):
    """Real USB serial controller for the ESP32 LOG:/DATA: protocol."""

    IR_POLL_INTERVAL_SECONDS = 0.75

    def __init__(self):
        self._serial_port: serial.Serial = None
        self._reader_thread: threading.Thread = None
        self._running = False

        self._command_lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._ir_poll_stop = threading.Event()
        self._ir_poll_thread: threading.Thread = None

        # The order is sent to the ESP32 first and initialized there. START is
        # sent only after initialization is confirmed and a valid glass is seen.
        self._pending_order = None
        self._active_run_mode = None  # None | "order" | "cleaning" | "reverse"

    # ── Lifecycle ─────────────────────────────

    def start(self):
        self._running = True
        port = self._open_port()

        with _lock:
            self._serial_port = port
            _state["connected"] = (port is not None)

        if port is None:
            print("[SERIAL] WARNING: Starting without ESP32 connection — will retry in background.")

        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            daemon=True,
            name="serial-reader",
        )
        self._reader_thread.start()
        print("[SERIAL] SerialController started.")

    def stop(self):
        self._running = False
        self._stop_ir_polling()

        with _lock:
            port = self._serial_port

        if port:
            try:
                port.close()
            except Exception:
                pass
        print("[SERIAL] SerialController stopped.")

    # ── Commands ──────────────────────────────

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list,
                   ice: bool = False, first_after_power_on: bool = False):
        """Initialize an order on the ESP32, then wait for glass detection."""
        pumps_payload = []
        for cmd in pump_commands:
            duration_ms = int(cmd.get("duration_ms", 0) or 0)
            if first_after_power_on:
                duration_ms += int(cmd.get("initial_extra_ms", 1460) or 0)
            if duration_ms > 0:
                pumps_payload.append({
                    "pump": int(cmd["pump"]),
                    "time_ms": duration_ms,
                })

        if not pumps_payload:
            raise ValueError("Order has no valid pump durations.")

        wire_order_id = f"ORD-{order_id}"
        payload = {
            "command": "ORDER",
            "order_id": wire_order_id,
            "pumps": pumps_payload,
            "ice": {"enabled": bool(ice)},
        }

        with self._pending_lock:
            if self._pending_order is not None:
                raise RuntimeError("Another order is already pending.")
            self._pending_order = {
                "db_order_id": order_id,
                "wire_order_id": wire_order_id,
                "recipe_name": recipe_name,
                "initialized": False,
                "start_sent": False,
                "glass_state": "no_glass",
            }

        self._active_run_mode = "order"
        self._send_json(payload)

        _handle_status({
            "type": "STATUS",
            "machine_status": "waiting_glass",
            "progress": 0,
            "message": "Initializing order and waiting for glass...",
            "order_id": order_id,
        })
        print(f"[SERIAL] ORDER sent {wire_order_id} {recipe_name} | ice={ice}")

    def send_abort(self):
        self._stop_ir_polling()
        self._send_text("STOP")
        print("[SERIAL] STOP sent.")
        try:
            import db
            db.log_event("hardware_cmd:stop")
        except Exception as exc:
            print(f"[HW] Event logging error: {exc}")

        with self._pending_lock:
            self._pending_order = None
        self._active_run_mode = None

        _handle_status({
            "type": "STATUS",
            "status": "aborted",
            "progress": 0,
            "message": "Order stopped by user.",
        })

    def send_power(self, powered: bool, reverse_config: list = None):
        # The current ESP32 firmware has no POWER command. Power-off performs
        # the implemented reverse-pumps maintenance sequence.
        if powered:
            print("[SERIAL] Soft power enabled on Pi; no ESP32 command required.")
            return

        self._active_run_mode = "reverse"
        self._send_text("REVERSE_PUMPS")
        print("[SERIAL] REVERSE_PUMPS sent for power-off.")

    def send_clean(self, trigger: str = "manual", mode: str = "all",
                   pump: int = None, order_id: int = None, pumps: list = None):
        if trigger != "manual":
            print("[SERIAL] Ignoring obsolete post-order CLEAN request.")
            return

        self._active_run_mode = "cleaning"
        self._send_text("CLEAN")
        print("[SERIAL] CLEAN sent.")

    def send_glass_ok(self):
        # Retained for interface compatibility. The real flow uses CHECK_IR.
        print("[SERIAL] GLASS_OK bypass is not used; requesting CHECK_IR instead.")
        self._send_text("CHECK_IR")

    # ── Serial output ─────────────────────────

    def _send_json(self, payload: dict):
        self._write_line(json.dumps(payload, separators=(",", ":")))

    def _send_text(self, command: str):
        self._write_line(command.strip())

    def _write_line(self, line: str):
        with self._command_lock:
            with _lock:
                port = self._serial_port
                connected = _state["connected"]

            if port is None or not connected:
                raise ConnectionError(f"ESP32 is not connected; cannot send {line!r}")

            try:
                port.write((line + "\n").encode("utf-8"))
                port.flush()
            except serial.SerialException as exc:
                with _lock:
                    _state["connected"] = False
                raise ConnectionError(f"ESP32 serial send failed: {exc}") from exc

    # ── IR glass polling ──────────────────────

    def _start_ir_polling(self):
        if self._ir_poll_thread and self._ir_poll_thread.is_alive():
            return

        self._ir_poll_stop.clear()
        self._ir_poll_thread = threading.Thread(
            target=self._ir_poll_loop,
            daemon=True,
            name="esp32-ir-poll",
        )
        self._ir_poll_thread.start()

    def _stop_ir_polling(self):
        self._ir_poll_stop.set()

    def _ir_poll_loop(self):
        print("[SERIAL] Starting CHECK_IR polling.")
        while self._running and not self._ir_poll_stop.is_set():
            with self._pending_lock:
                pending = dict(self._pending_order) if self._pending_order else None

            if not pending or pending.get("start_sent"):
                break

            try:
                self._send_text("CHECK_IR")
            except ConnectionError as exc:
                print(f"[SERIAL] CHECK_IR send failed: {exc}")

            self._ir_poll_stop.wait(self.IR_POLL_INTERVAL_SECONDS)

        print("[SERIAL] CHECK_IR polling stopped.")

    @staticmethod
    def _classify_glass(upper_raw: int, lower_raw: int) -> str:
        # Explicit active-low mapping supplied by the mechanism design.
        if upper_raw == 1 and lower_raw == 1:
            return "no_glass"
        if upper_raw == 1 and lower_raw == 0:
            return "small_glass"
        if upper_raw == 0 and lower_raw == 0:
            return "large_glass"
        return "invalid"

    def _handle_ir_response(self, data: dict):
        try:
            upper_raw = int(data["upper"])
            lower_raw = int(data["lower"])
        except (KeyError, TypeError, ValueError):
            print(f"[SERIAL] Invalid CHECK_IR response: {data}")
            return

        glass_state = self._classify_glass(upper_raw, lower_raw)
        detected = glass_state in {"small_glass", "large_glass"}

        _handle_sensor({
            "type": "SENSOR",
            "glass_state": glass_state,
            "upper_sensor": upper_raw == 0,
            "lower_sensor": lower_raw == 0,
            "upper_raw": upper_raw,
            "lower_raw": lower_raw,
        })

        if glass_state == "invalid":
            print("[SERIAL] Invalid IR combination upper=0 lower=1; START withheld.")
            return

        if not detected:
            return

        with self._pending_lock:
            pending = self._pending_order
            if not pending:
                return

            pending["glass_state"] = glass_state
            if not pending.get("initialized") or pending.get("start_sent"):
                return

            pending["start_sent"] = True
            db_order_id = pending["db_order_id"]

        self._stop_ir_polling()
        self._send_text("START")
        print(f"[SERIAL] Glass detected ({glass_state}); START sent for order #{db_order_id}.")

        _handle_status({
            "type": "STATUS",
            "status": "dispensing",
            "order_id": db_order_id,
            "progress": 1,
            "message": f"{glass_state.replace('_', ' ').title()} detected. Starting order...",
        })

    # ── Incoming DATA messages ────────────────

    def _handle_response(self, data: dict):
        command = str(data.get("command", "")).upper()

        if command == "ORDER":
            status = str(data.get("status", "")).lower()
            wire_order_id = str(data.get("order_id", ""))

            with self._pending_lock:
                pending = self._pending_order
                if not pending:
                    print(f"[SERIAL] Unexpected ORDER response with no pending order: {data}")
                    return
                expected = pending["wire_order_id"]

                if wire_order_id and wire_order_id != expected:
                    print(f"[SERIAL] ORDER response mismatch: expected {expected}, got {wire_order_id}")
                    return

                if status == "initialized":
                    pending["initialized"] = True
                    db_order_id = pending["db_order_id"]
                else:
                    reason = str(data.get("reason", "unknown"))
                    db_order_id = pending["db_order_id"]
                    self._pending_order = None

            if status == "initialized":
                print(f"[SERIAL] ORDER {expected} initialized; waiting for glass.")
                _handle_status({
                    "type": "STATUS",
                    "status": "waiting_glass",
                    "order_id": db_order_id,
                    "progress": 0,
                    "message": "Order initialized. Waiting for glass...",
                })
                self._start_ir_polling()
            else:
                self._active_run_mode = None
                print(f"[SERIAL] ORDER {expected} rejected: {reason}")
                try:
                    import db
                    db.update_order_status(db_order_id, "error")
                    db.log_event("order:rejected", f"Order #{db_order_id}: {reason}")
                except Exception as exc:
                    print(f"[HW] Database update error: {exc}")
                _handle_status({
                    "type": "STATUS",
                    "status": "error",
                    "order_id": db_order_id,
                    "progress": 0,
                    "message": f"ESP32 rejected order: {reason}",
                })
            return

        if command == "CHECK_IR":
            self._handle_ir_response(data)
            return

        if command == "CHECK_LEVELS":
            levels = {f"ls{i}": int(data.get(f"ls{i}", 0)) for i in range(1, 7)}
            with _lock:
                _state["liquid_levels"] = levels
            print(f"[SERIAL] LEVELS {levels}")
            return

        print(f"[SERIAL] Unhandled response: {data}")

    def _handle_system_event(self, data: dict):
        event = str(data.get("event", "")).lower()
        action = str(data.get("action", "")).lower()

        if event == "ready":
            print("[SERIAL] ESP32 ready.")
            return

        if event == "pump":
            pump = data.get("pump")
            if action == "forward":
                with self._pending_lock:
                    order_id = self._pending_order.get("db_order_id") if self._pending_order else None
                _handle_status({
                    "type": "STATUS",
                    "status": "dispensing",
                    "order_id": order_id,
                    "progress": 25,
                    "message": f"Dispensing pump {pump}...",
                })
            return

        if event == "mixing":
            with self._pending_lock:
                order_id = self._pending_order.get("db_order_id") if self._pending_order else None

            if action == "started":
                _handle_status({
                    "type": "STATUS",
                    "status": "mixing",
                    "order_id": order_id,
                    "progress": 70,
                    "message": "Mixing..." if self._active_run_mode == "order" else "Cleaning mix...",
                })
            elif action == "stopped":
                next_state = "pouring" if self._active_run_mode == "order" else "draining"
                _handle_status({
                    "type": "STATUS",
                    "status": next_state,
                    "order_id": order_id,
                    "progress": 90,
                    "message": "Opening valve..." if self._active_run_mode == "order" else "Draining cleaning water...",
                })
            return

        if event == "valve" and action == "opened":
            if self._active_run_mode == "order":
                with self._pending_lock:
                    order_id = self._pending_order.get("db_order_id") if self._pending_order else None
                _handle_status({
                    "type": "STATUS",
                    "status": "done",
                    "order_id": order_id,
                    "progress": 100,
                    "message": "Drink completed.",
                })
                _handle_status({
                    "type": "STATUS",
                    "status": "idle",
                    "order_id": order_id,
                    "progress": 0,
                    "message": "Ready",
                })
                with self._pending_lock:
                    self._pending_order = None
                self._active_run_mode = None
            elif self._active_run_mode == "cleaning":
                _handle_status({
                    "type": "STATUS",
                    "status": "resealing",
                    "progress": 95,
                    "message": "Finishing cleaning...",
                })
            return

        if event == "reverse_pumps":
            if action == "started":
                self._active_run_mode = "reverse"
                _handle_status({"type": "STATUS", "status": "reversing", "progress": 0,
                                "message": "Reversing pump lines..."})
            elif action == "finished":
                _handle_status({"type": "STATUS", "status": "idle", "progress": 0,
                                "message": "Pump reversing finished."})
                self._active_run_mode = None
            return

        if event == "cleaning":
            if action == "started":
                self._active_run_mode = "cleaning"
                _handle_status({"type": "STATUS", "status": "washing", "progress": 0,
                                "message": "Cleaning started."})
            elif action == "finished":
                _handle_status({"type": "STATUS", "status": "idle", "progress": 0,
                                "message": "Cleaning finished."})
                self._active_run_mode = None
            return

        print(f"[SERIAL] Unhandled system event: {data}")

    # ── Reader loop ───────────────────────────

    def _reader_loop(self):
        while self._running:
            with _lock:
                port = self._serial_port

            if port is None:
                self._reconnect()
                continue

            try:
                raw = port.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                with _lock:
                    _state["last_seen"] = datetime.now().isoformat()
                    _state["connected"] = True

                if line.startswith("LOG:"):
                    print(f"[ESP32] {line[4:]}")
                    continue

                if not line.startswith("DATA:"):
                    print(f"[SERIAL] Unclassified ESP32 line: {line!r}")
                    continue

                json_text = line[5:]
                try:
                    data = json.loads(json_text)
                except json.JSONDecodeError as exc:
                    print(f"[SERIAL] Invalid DATA JSON {json_text!r}: {exc}")
                    continue

                message_type = str(data.get("type", "")).lower()
                if message_type == "response":
                    self._handle_response(data)
                elif message_type == "system":
                    self._handle_system_event(data)
                else:
                    print(f"[SERIAL] Unknown DATA message type: {data}")

            except serial.SerialException as exc:
                print(f"[SERIAL] Read error: {exc} — attempting reconnect...")
                with _lock:
                    _state["connected"] = False
                self._stop_ir_polling()
                self._reconnect()
            except Exception as exc:
                print(f"[SERIAL] Unexpected reader error: {exc}")
                time.sleep(0.1)

    # ── Port management ───────────────────────

    def _open_port(self) -> serial.Serial:
        port_to_try = config.SERIAL_PORT
        ports = list(serial.tools.list_ports.comports())
        if not any(p.device == port_to_try for p in ports) and ports:
            usb_candidates = [
                p.device for p in ports
                if any(keyword in (p.description or "").lower()
                       for keyword in ("usb", "uart", "cp210", "ch340", "esp32"))
            ]
            if usb_candidates:
                port_to_try = usb_candidates[0]

        try:
            port = serial.Serial(
                port=port_to_try,
                baudrate=config.SERIAL_BAUDRATE,
                timeout=config.SERIAL_TIMEOUT,
                write_timeout=2,
            )
            time.sleep(2)
            port.reset_input_buffer()
            print(f"[SERIAL] Connected to {port_to_try} @ {config.SERIAL_BAUDRATE} baud")
            return port
        except serial.SerialException as exc:
            print(f"[SERIAL] Cannot open {port_to_try}: {exc}")
            return None

    def _reconnect(self):
        with _lock:
            if self._serial_port is not None:
                try:
                    self._serial_port.close()
                except Exception:
                    pass
                self._serial_port = None

        while self._running:
            print("[SERIAL] Retrying connection...")
            time.sleep(3)
            port = self._open_port()
            if port:
                with _lock:
                    self._serial_port = port
                    _state["connected"] = True
                print("[SERIAL] Reconnected successfully.")
                return
            with _lock:
                _state["connected"] = False

# ─────────────────────────────────────────────
#  FACTORY
# ─────────────────────────────────────────────

def create_controller() -> HardwareController:
    """
    Instantiate the correct controller based on config.SIMULATOR_MODE.
    Call this once at app startup.
    """
    if getattr(config, "SIMULATOR_MODE", False):
        return SimulatorController()
    return SerialController()


