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

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list, ice: bool = False):
        """
        Send an ORDER command.
        pump_commands: [{"pump": 1, "ingredient": "Rum", "amount_ml": 50, "duration_ms": 33333}, ...]
        ice: whether the customer requested ice (ESP32 triggers ice mechanism if true)
        """
        raise NotImplementedError

    def send_abort(self):
        """Send an emergency ABORT — stop all dispensing immediately."""
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
    Runs the full order lifecycle (including the post-order auto-clean cycle)
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

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list, ice: bool = False):
        print(f"[SIM] ORDER → #{order_id} {recipe_name} | ice={ice}")
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
        Full lifecycle including the mandatory post-order auto-clean cycle:
          waiting_glass → dispensing → mixing → pouring → done
          → reversing → (wait for glass removed) → washing → mixing(shake) → draining → resealing → idle
        """
        s = self._set_status

        # ── Order sequence ────────────────────
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

        s(order_id, "done", 100, "Drink is ready! Enjoy!")

        # ── Hold the 'done' screen for the customer to see ────────────────
        if self._wait(6):
            return

        # ── Post-order auto-clean cycle ───────
        # REVERSING: pump lines run backward — starts immediately (glass still present is OK here)
        s(order_id, "reversing", 0, "Cleaning pump lines...")
        if self._wait(1):
            return

        s(order_id, "reversing", 30, "Reversing pump lines...")
        if self._wait(1.5):
            return

        # Gate: wait indefinitely for glass to be removed — no timeout by design (PROTOCOL.md §4)
        print("[SIM] Auto-clean gate: waiting for glass removal...")
        s(order_id, "reversing", 60, "Please remove your glass to continue cleaning...")
        self._wait_for_glass_removed()

        if self._aborted():
            return

        _handle_sensor({"type": "SENSOR", "glass_state": "no_glass", "lower_sensor": False, "upper_sensor": False})

        s(order_id, "washing", 0, "Rinsing container with water...")
        if self._wait(1):
            return

        s(order_id, "washing", 50, "Washing in progress...")
        if self._wait(2):
            return

        s(order_id, "washing", 90, "Almost done rinsing...")
        if self._wait(1):
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
    """
    Real serial communication with the ESP32 over USB/UART.
    Implements the line-based JSON protocol defined in PROTOCOL.md.
    """

    def __init__(self):
        self._serial_port: serial.Serial = None
        self._reader_thread: threading.Thread = None
        self._running = False

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
        with _lock:
            port = self._serial_port

        if port:
            try:
                port.close()
            except Exception:
                pass
        print("[SERIAL] SerialController stopped.")

    # ── Commands ──────────────────────────────

    def send_order(self, order_id: int, recipe_name: str, pump_commands: list, ice: bool = False):
        # Build sparse pumps array — only active pumps, only the fields ESP32 needs.
        # duration_ms is pre-calculated by the Pi (amount_ml / flow_rate_ml_per_s * 1000).
        pumps_payload = [
            {"i": cmd["pump"], "t": cmd["duration_ms"]}
            for cmd in pump_commands
            if cmd.get("duration_ms", 0) > 0
        ]
        total_ml = sum(float(cmd.get("amount_ml", 0) or 0) for cmd in pump_commands)
        payload = {
            "cmd":            "ORDER",
            "order_id":       order_id,
            "pumps":          pumps_payload,
            "ice":            1 if ice else 0,
            "required_glass": "large" if total_ml > 200 else "any",
        }
        self._send(payload)
        print(f"[SERIAL] ORDER sent → #{order_id} {recipe_name} | ice={ice}")
        
        # Eagerly update Pi-side state so the UI transitions to the WaitingGlass screen
        # immediately, without waiting for the ESP32 to confirm.
        _handle_status({
            "type": "STATUS",
            "machine_status": "waiting_glass",
            "progress": 0,
            "message": "Waiting for glass...",
            "order_id": order_id,
        })

    def send_abort(self):
        self._send({"cmd": "ABORT"})
        print("[SERIAL] ABORT sent.")
        import db
        try:
            db.log_event("hardware_cmd:abort")
        except Exception as e:
            print(f"[HW] Event logging error: {e}")

    def send_clean(self, trigger: str = "manual", mode: str = "all", pump: int = None, order_id: int = None, pumps: list = None):
        if trigger == "post_order":
            payload = {
                "cmd":      "CLEAN",
                "trigger":  "post_order",
                "order_id": order_id,
                "pumps":    pumps or [],
            }
            self._send(payload)
            print(f"[SERIAL] CLEAN (post_order) → order #{order_id}, pumps {pumps}")
        elif trigger == "manual":
            payload = {"cmd": "CLEAN", "trigger": "manual", "mode": mode}
            if mode == "single" and pump is not None:
                payload["pump"] = pump
            self._send(payload)
            print(f"[SERIAL] CLEAN (manual, {mode}) sent.")

    def send_glass_ok(self):
        self._send({"cmd": "GLASS_OK"})
        print("[SERIAL] GLASS_OK sent.")

    # ── Internal send ─────────────────────────

    def _send(self, payload: dict):
        with _lock:
            port      = self._serial_port
            connected = _state["connected"]

        if port is None or not connected:
            print(f"[SERIAL] WARNING: Not connected. Cannot send: {payload}")
            return

        try:
            line = json.dumps(payload) + "\n"
            port.write(line.encode("utf-8"))
            port.flush()
        except serial.SerialException as e:
            print(f"[SERIAL] Send error: {e}")
            with _lock:
                _state["connected"] = False

    # ── Reader loop ───────────────────────────

    def _reader_loop(self):
        """Background thread: reads JSON lines from the ESP32 and dispatches them."""
        while self._running:
            with _lock:
                port = self._serial_port

            if port is None:
                time.sleep(0.5)
                continue

            try:
                raw = port.readline()   # blocks up to SERIAL_TIMEOUT seconds
                if not raw:
                    continue            # timeout — no data, loop again

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                with _lock:
                    _state["last_seen"] = datetime.now().isoformat()
                    _state["connected"] = True

                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    print(f"[SERIAL] Non-JSON from ESP32: {line!r}")
                    continue

                msg_type = data.get("type", "").upper()

                if msg_type == "STATUS":
                    _handle_status(data)
                elif msg_type == "SENSOR":
                    _handle_sensor(data)
                else:
                    print(f"[SERIAL] Unknown message type: {line!r}")

            except serial.SerialException as e:
                print(f"[SERIAL] Read error: {e} — attempting reconnect...")
                with _lock:
                    _state["connected"] = False
                self._reconnect()
            except Exception as e:
                print(f"[SERIAL] Unexpected reader error: {e}")
                time.sleep(0.1)

    # ── Port management ───────────────────────

    def _open_port(self) -> serial.Serial:
        """Open the configured serial port. Returns port object or None on failure."""
        port_to_try = config.SERIAL_PORT

        # Auto-detect COM port if the configured one isn't available
        ports = list(serial.tools.list_ports.comports())
        if not any(p.device == port_to_try for p in ports) and ports:
            port_to_try = ports[0].device

        try:
            port = serial.Serial(
                port=port_to_try,
                baudrate=config.SERIAL_BAUDRATE,
                timeout=config.SERIAL_TIMEOUT,
            )
            print(f"[SERIAL] Connected to {port_to_try} @ {config.SERIAL_BAUDRATE} baud")
            return port
        except serial.SerialException as e:
            print(f"[SERIAL] Cannot open {port_to_try}: {e}")
            return None

    def _reconnect(self):
        """Close and reopen the serial port, retrying every 3 seconds."""
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
                    self._serial_port   = port
                    _state["connected"] = True
                print("[SERIAL] Reconnected successfully.")
                return
            else:
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
