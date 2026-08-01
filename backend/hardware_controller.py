"""ESP32-S3 controller for the CocktailCraft internal-mechanism firmware.

The wire contract in this module is intentionally limited to the current
firmware's documented protocol:

* Pi -> ESP32: ORDER JSON, then the plain-text START command.
* ESP32 -> Pi: ``DATA:`` JSON events and ``LOG:`` diagnostic lines.

The firmware does not emit high-level STATUS/SENSOR messages.  This module
therefore translates its documented events into the state values consumed by
the Flask SSE API; it never sends unsupported commands or silently changes
pump timings owned by the ESP32.
"""

from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime
from typing import Any

import serial
import serial.tools.list_ports

import config
import machine_state as ms
from machine_state import MachineState


_lock = threading.RLock()
_UNSET = object()

_state: dict[str, Any] = {
    "connected": False,
    "firmware_ready": False,
    "last_seen": None,
    "machine_status": MachineState.IDLE,
    "current_order_id": None,
    "progress": 0,
    "message": "",
    # The ESP32 exposes only raw IR values.  Do not infer a glass size or
    # presence until the installed sensor polarity is physically confirmed.
    "glass_state": "unknown",
    "upper_sensor": None,
    "lower_sensor": None,
    "liquid_levels": {f"ls{i}": None for i in range(1, 7)},
    "fluid_lines_primed": None,
    # The ESP32 reports raw IR values. These are Pi-side safety facts for the
    # one pending order, used to decide whether it is safe to send START.
    "required_glass": None,
    "order_volume_ml": None,
}

_status_callbacks: list = []
_sensor_callbacks: list = []


def _normalise_order_volume(total_volume_ml: float | int | None) -> float:
    """Validate the liquid volume used by the glass-capacity interlock."""
    try:
        volume = float(total_volume_ml)
    except (TypeError, ValueError) as exc:
        raise ValueError("Order needs a valid total liquid volume for the glass safety check.") from exc
    if not math.isfinite(volume) or volume <= 0:
        raise ValueError("Order total liquid volume must be a positive finite number.")
    if volume > config.MAX_ML_TOTAL:
        raise ValueError(
            f"Order volume {volume:g} ml exceeds the maximum supported drink volume "
            f"of {config.MAX_ML_TOTAL:g} ml."
        )
    return volume


def _small_glass_capacity_ml() -> float:
    """Read the admin-calibrated capacity, with a safe initial default."""
    try:
        import db

        capacity = float(db.get_setting("small_glass_max_ml", config.DEFAULT_SMALL_GLASS_MAX_ML))
    except (TypeError, ValueError):
        return float(config.DEFAULT_SMALL_GLASS_MAX_ML)
    if not math.isfinite(capacity) or capacity <= 0 or capacity > config.MAX_ML_TOTAL:
        return float(config.DEFAULT_SMALL_GLASS_MAX_ML)
    return capacity


def _required_glass_for_volume(total_volume_ml: float) -> str:
    return "large" if total_volume_ml > _small_glass_capacity_ml() else "small_or_large"


def _glass_matches_requirement(glass_state: str, required_glass: str) -> bool:
    return glass_state == "large_glass" or (
        glass_state == "small_glass" and required_glass == "small_or_large"
    )


def _format_ml(volume: float) -> str:
    return f"{volume:g} ml"


def _glass_waiting_message(glass_state: str, required_glass: str, volume: float) -> str:
    if glass_state == "small_glass" and required_glass == "large":
        small_glass_capacity = _small_glass_capacity_ml()
        return (
            f"Small glass detected. This {_format_ml(volume)} drink requires a large glass; "
            f"the small glass safely holds up to {small_glass_capacity:g} ml. Please replace it."
        )
    if required_glass == "large":
        return f"Waiting for a large glass for this {_format_ml(volume)} drink."
    return f"Waiting for a glass for this {_format_ml(volume)} drink."


def _set_glass_requirement(volume: float, required_glass: str):
    with _lock:
        _state["order_volume_ml"] = volume
        _state["required_glass"] = required_glass


def _clear_glass_requirement():
    with _lock:
        _state["order_volume_ml"] = None
        _state["required_glass"] = None


def register_status_callback(callback):
    if callback not in _status_callbacks:
        _status_callbacks.append(callback)


def register_sensor_callback(callback):
    if callback not in _sensor_callbacks:
        _sensor_callbacks.append(callback)


def _serialise_state() -> dict:
    with _lock:
        result = dict(_state)
        result["liquid_levels"] = dict(_state["liquid_levels"])
    if isinstance(result["machine_status"], MachineState):
        result["machine_status"] = result["machine_status"].value
    return result


def get_state() -> dict:
    """Return a thread-safe, JSON-ready snapshot of the controller state."""
    return _serialise_state()


def _notify_status(state: dict):
    for callback in tuple(_status_callbacks):
        try:
            callback(state)
        except Exception as exc:  # pragma: no cover - an app callback must not kill serial I/O
            print(f"[HW] Status callback error: {exc}")


def _notify_sensor(state: dict):
    for callback in tuple(_sensor_callbacks):
        try:
            callback(state)
        except Exception as exc:  # pragma: no cover - an app callback must not kill serial I/O
            print(f"[HW] Sensor callback error: {exc}")


def _set_machine_state(
    status: MachineState | str,
    *,
    progress: int | None = None,
    message: str | None = None,
    order_id: Any = _UNSET,
    force: bool = False,
) -> bool:
    """Set the Pi-facing state after a documented firmware event.

    ``force`` is reserved for controller startup/simulator reset.  All normal
    event translations use the transition table in :mod:`machine_state`.
    """
    new_state = status if isinstance(status, MachineState) else ms.parse_state(status)
    if new_state is None:
        print(f"[HW] Ignoring unknown state {status!r}")
        return False

    with _lock:
        current = _state["machine_status"]
        if not force and not ms.is_valid_transition(current, new_state):
            print(f"[HW] Ignoring illegal state transition {current.value} -> {new_state.value}")
            return False

        _state["machine_status"] = new_state
        if progress is not None:
            _state["progress"] = max(0, min(100, int(progress)))
        if message is not None:
            _state["message"] = str(message)
        if order_id is not _UNSET:
            _state["current_order_id"] = order_id
        state_copy = _serialise_state()

    print(f"[HW] STATE {current.value} -> {new_state.value} ({state_copy['progress']}%) | {state_copy['message']}")
    _notify_status(state_copy)
    return True


def _handle_status(data: dict):
    """Compatibility entry point for the development panel and simulator.

    The real ESP32 firmware does not send STATUS objects.  Runtime serial
    processing is performed by :class:`SerialController` from ``DATA:`` lines.
    """
    raw_status = data.get("machine_status", data.get("status"))
    return _set_machine_state(
        raw_status,
        progress=data.get("progress"),
        message=data.get("message"),
        order_id=data.get("order_id", data.get("current_order_id", _UNSET)),
    )


def _handle_sensor(data: dict):
    """Update sensor data without assigning undocumented physical meaning."""
    with _lock:
        if "glass_state" in data:
            _state["glass_state"] = str(data["glass_state"])
        if "upper_sensor" in data:
            _state["upper_sensor"] = data["upper_sensor"]
        if "lower_sensor" in data:
            _state["lower_sensor"] = data["lower_sensor"]
        if "liquid_levels" in data:
            _state["liquid_levels"] = dict(data["liquid_levels"])
        if "fluid_lines_primed" in data:
            _state["fluid_lines_primed"] = data["fluid_lines_primed"]
        state_copy = _serialise_state()
    _notify_sensor(state_copy)


def _record_event(event_type: str, detail: str | None = None):
    try:
        import db

        db.log_event(event_type, detail)
    except Exception as exc:  # database logging must never break hardware control
        print(f"[HW] Event logging error: {exc}")


class HardwareController:
    """Interface shared by the real serial controller and local simulator."""

    def start(self):
        raise NotImplementedError

    def stop(self):
        raise NotImplementedError

    def send_order(
        self,
        order_id: int,
        recipe_name: str,
        pump_commands: list,
        ice: bool = False,
        total_volume_ml: float | int | None = None,
    ):
        raise NotImplementedError

    def start_pending_order(self):
        """Send START only after the ESP32 has acknowledged ORDER."""
        raise NotImplementedError

    def send_stop_request(self):
        """Request STOP; this firmware only applies it to mixing/ice activity."""
        raise NotImplementedError

    def send_power(self, powered: bool):
        raise NotImplementedError

    def send_clean(self):
        raise NotImplementedError

    def query_sensors(self, command: str):
        raise NotImplementedError

    def send_debug_command(self, command: str):
        """Send one allow-listed maintenance command from the admin console."""
        raise NotImplementedError

    def read_liquid_levels(self) -> dict:
        """Synchronously request the documented raw ``CHECK_LEVELS`` response."""
        raise NotImplementedError

    # Old callers use these names.  They now preserve the actual firmware
    # semantics instead of inventing ABORT/GLASS_OK commands.
    def send_abort(self):
        return self.send_stop_request()

    def send_glass_ok(self):
        return self.start_pending_order()

    def get_state(self) -> dict:
        return get_state()


class SimulatorController(HardwareController):
    """Small local simulation that follows the same ORDER -> START contract."""

    def __init__(self):
        self._running = False
        self._pending: dict | None = None
        self._run_mode: str | None = None
        self._lock = threading.RLock()
        self._stop_requested = threading.Event()
        self._lines_primed = False

    def start(self):
        self._running = True
        with _lock:
            _state["connected"] = True
            _state["firmware_ready"] = True
        _set_machine_state(MachineState.IDLE, progress=0, message="Simulator ready.", order_id=None, force=True)
        print("[SIM] Firmware-protocol simulator started.")

    def stop(self):
        self._running = False
        self._stop_requested.set()
        with _lock:
            _state["connected"] = False
        _clear_glass_requirement()
        print("[SIM] Simulator stopped.")

    def send_order(
        self,
        order_id: int,
        recipe_name: str,
        pump_commands: list,
        ice: bool = False,
        total_volume_ml: float | int | None = None,
    ):
        volume = _normalise_order_volume(total_volume_ml)
        required_glass = _required_glass_for_volume(volume)
        with self._lock:
            if self._pending is not None or self._run_mode is not None:
                raise RuntimeError("Another machine operation is already active.")
            self._pending = {
                "db_order_id": order_id,
                "recipe_name": recipe_name,
                "initialized": False,
                "start_sent": False,
                "ice": bool(ice),
                "pumps": list(pump_commands),
                "total_volume_ml": volume,
                "required_glass": required_glass,
            }

        _set_glass_requirement(volume, required_glass)
        _set_machine_state(MachineState.INITIALIZING, progress=0, message="Loading order into controller...", order_id=order_id)
        threading.Timer(0.15, self._acknowledge_order).start()

    def _acknowledge_order(self):
        with self._lock:
            if not self._running or not self._pending:
                return
            self._pending["initialized"] = True
            order_id = self._pending["db_order_id"]
        _set_machine_state(MachineState.WAITING_GLASS, progress=0, message="Order initialized. Waiting for IR glass detection...", order_id=order_id)
        threading.Timer(0.5, self._simulate_glass_detection).start()

    def _simulate_glass_detection(self):
        with self._lock:
            if not self._running or not self._pending or self._pending["start_sent"]:
                return
        # Active-low mapping verified for the physical installation:
        # upper=0, lower=0 means a large glass is present.
        _handle_sensor({"glass_state": "large_glass", "upper_sensor": 0, "lower_sensor": 0})
        try:
            self.start_pending_order()
        except RuntimeError:
            # A maintenance operation may have begun while this timer waited.
            # Detection restarts after that operation finishes.
            return

    def start_pending_order(self):
        with self._lock:
            if not self._pending or not self._pending["initialized"]:
                raise RuntimeError("Order is not initialized yet.")
            if self._run_mode is not None:
                raise RuntimeError("Cannot start an order while maintenance is active.")
            if self._pending["start_sent"]:
                return
            glass_state = get_state()["glass_state"]
            if not _glass_matches_requirement(glass_state, self._pending["required_glass"]):
                message = _glass_waiting_message(
                    glass_state,
                    self._pending["required_glass"],
                    self._pending["total_volume_ml"],
                )
                _set_machine_state(MachineState.WAITING_GLASS, progress=0, message=message, order_id=self._pending["db_order_id"])
                raise RuntimeError(message)
            self._pending["start_sent"] = True
            self._run_mode = "order"
            pending = dict(self._pending)

        _set_machine_state(MachineState.DISPENSING, progress=1, message="START accepted. Preparing drink...", order_id=pending["db_order_id"])
        threading.Thread(target=self._run_order, args=(pending,), daemon=True, name=f"sim-order-{pending['db_order_id']}").start()

    def send_stop_request(self):
        self._stop_requested.set()
        _record_event("hardware_cmd:stop", "Simulator STOP request")
        print("[SIM] STOP requested; only mixing/ice work is interruptible in firmware.")

    def send_power(self, powered: bool):
        if powered:
            return
        with self._lock:
            if self._run_mode is not None or self._pending is not None:
                raise RuntimeError("Cannot reverse pumps while an order is pending or active.")
            self._run_mode = "reverse"
        _set_machine_state(MachineState.REVERSING, progress=0, message="Reversing all pump lines...", order_id=None)
        threading.Thread(target=self._run_reverse, daemon=True, name="sim-reverse-pumps").start()

    def send_clean(self):
        with self._lock:
            if self._run_mode is not None:
                raise RuntimeError("Another machine operation is already active.")
            self._run_mode = "cleaning"
        _set_machine_state(MachineState.WASHING, progress=0, message="Cleaning started (pump 1, 5 seconds)...", order_id=None)
        threading.Thread(target=self._run_clean, daemon=True, name="sim-clean").start()

    def query_sensors(self, command: str):
        command = command.upper()
        if command == "CHECK_IR":
            _handle_sensor({"upper_sensor": 1, "lower_sensor": 1, "glass_state": "unknown"})
        elif command == "CHECK_LEVELS":
            _handle_sensor({"liquid_levels": {f"ls{i}": 1 for i in range(1, 7)}})
        elif command == "CHECK_LINE_STATE":
            _handle_sensor({"fluid_lines_primed": self._lines_primed})
        else:
            raise ValueError(f"Unsupported sensor query: {command}")

    def send_debug_command(self, command: str):
        command = command.upper()
        if command in {"CHECK_IR", "CHECK_LEVELS", "CHECK_LINE_STATE"}:
            self.query_sensors(command)
        elif command == "ICE_STATUS":
            _record_event("esp32:log", "ICE_POSITION:CLOSED,STATE:IDLE,BUSY:NO (simulator)")
        elif command in {"ICE", "ICE_SET_OPEN", "ICE_SET_CLOSED"}:
            _record_event("hardware:debug", f"{command} accepted by simulator")
        else:
            raise ValueError(f"Unsupported diagnostic command: {command}")

    def read_liquid_levels(self) -> dict:
        levels = {f"ls{i}": 1 for i in range(1, 7)}
        _handle_sensor({"liquid_levels": levels})
        return levels

    def _run_order(self, pending: dict):
        order_id = pending["db_order_id"]
        if not self._lines_primed:
            _set_machine_state(MachineState.DISPENSING, progress=5, message="Priming all six feed lines...", order_id=order_id)
            if not self._wait(1.0):
                return
            self._lines_primed = True

        for position, command in enumerate(pending["pumps"], start=1):
            _set_machine_state(MachineState.DISPENSING, progress=min(60, 15 + position * 10), message=f"Dispensing pump {command['pump']}...", order_id=order_id)
            if not self._wait(0.35):
                return

        _set_machine_state(MachineState.MIXING, progress=75, message="Mixing drink...", order_id=order_id)
        self._wait(0.8)  # STOP is honoured here, matching the real firmware's limited scope.
        _set_machine_state(MachineState.POURING, progress=90, message="Opening valve...", order_id=order_id)
        if not self._wait(0.3):
            return
        self._finish_order(order_id)

    def _run_clean(self):
        if not self._wait(0.8):
            return
        _set_machine_state(MachineState.MIXING, progress=70, message="Mixing cleaning water...", order_id=None)
        if not self._wait(0.7):
            return
        with self._lock:
            self._run_mode = None
            pending = dict(self._pending) if self._pending else None
        if pending and pending["initialized"] and not pending["start_sent"]:
            _set_machine_state(
                MachineState.WAITING_GLASS,
                progress=0,
                message="Cleaning finished. Pending order is still initialized; waiting for IR glass detection...",
                order_id=pending["db_order_id"],
            )
            threading.Timer(0.5, self._simulate_glass_detection).start()
        else:
            _set_machine_state(MachineState.IDLE, progress=0, message="Cleaning finished.", order_id=None)

    def _run_reverse(self):
        if not self._wait(1.0):
            return
        self._lines_primed = False
        with self._lock:
            self._run_mode = None
        _set_machine_state(MachineState.IDLE, progress=0, message="Pump reversal finished.", order_id=None)

    def _finish_order(self, order_id: int):
        _set_machine_state(MachineState.DONE, progress=100, message="Drink completed.", order_id=order_id)
        time.sleep(config.DONE_SCREEN_SECONDS)
        with self._lock:
            self._pending = None
            self._run_mode = None
        _clear_glass_requirement()
        _set_machine_state(MachineState.IDLE, progress=0, message="Ready.", order_id=order_id)

    def _wait(self, seconds: float) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if not self._running:
                return False
            # Firmware STOP only changes oscillator/ice behavior.  It does not
            # abort the order, pumps, valve, priming, or reverse sequence.
            if self._stop_requested.is_set():
                self._stop_requested.clear()
                return True
            time.sleep(0.05)
        return True


class SerialController(HardwareController):
    """USB serial implementation of the documented ``LOG:``/``DATA:`` protocol."""

    ORDER_RESPONSE_TIMEOUT_SECONDS = config.ORDER_RESPONSE_TIMEOUT_SECONDS
    IR_POLL_INTERVAL_SECONDS = config.IR_POLL_INTERVAL_SECONDS
    LEVEL_RESPONSE_TIMEOUT_SECONDS = config.LEVEL_RESPONSE_TIMEOUT_SECONDS

    def __init__(self):
        self._serial_port: serial.Serial | None = None
        self._reader_thread: threading.Thread | None = None
        self._running = False
        self._command_lock = threading.Lock()
        self._pending_lock = threading.RLock()
        self._pending_order: dict | None = None
        self._active_run_mode: str | None = None  # order | cleaning | reverse
        self._order_timeout: threading.Timer | None = None
        self._done_timer: threading.Timer | None = None
        self._ir_poll_stop = threading.Event()
        self._ir_poll_thread: threading.Thread | None = None
        self._level_query_gate = threading.Lock()
        self._level_response_lock = threading.Lock()
        self._level_response_ready = threading.Event()
        self._latest_level_response: dict | None = None

    def start(self):
        self._running = True
        port = self._open_port()
        with _lock:
            self._serial_port = port
            _state["connected"] = port is not None
            _state["firmware_ready"] = False
        _set_machine_state(MachineState.IDLE, progress=0, message="Waiting for ESP32 firmware...", order_id=None, force=True)
        self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True, name="esp32-serial-reader")
        self._reader_thread.start()
        print("[SERIAL] SerialController started.")

    def stop(self):
        self._running = False
        self._stop_ir_polling()
        self._cancel_timer("_order_timeout")
        self._cancel_timer("_done_timer")
        _clear_glass_requirement()
        with _lock:
            port = self._serial_port
            self._serial_port = None
            _state["connected"] = False
            _state["firmware_ready"] = False
            state_copy = _serialise_state()
        if port:
            try:
                port.close()
            except serial.SerialException:
                pass
        _notify_status(state_copy)
        print("[SERIAL] SerialController stopped.")

    def send_order(
        self,
        order_id: int,
        recipe_name: str,
        pump_commands: list,
        ice: bool = False,
        total_volume_ml: float | int | None = None,
    ):
        with _lock:
            if not _state["connected"]:
                raise ConnectionError("ESP32 is not connected.")
        pumps = self._normalise_pumps(pump_commands)
        volume = _normalise_order_volume(total_volume_ml)
        required_glass = _required_glass_for_volume(volume)
        wire_order_id = f"ORD-{order_id}"
        payload = {
            "command": "ORDER",
            "order_id": wire_order_id,
            "pumps": pumps,
            "ice": {"enabled": bool(ice)},
        }

        with self._pending_lock:
            if self._pending_order is not None or self._active_run_mode is not None:
                raise RuntimeError("Another order or maintenance operation is already active.")
            self._pending_order = {
                "db_order_id": order_id,
                "wire_order_id": wire_order_id,
                "recipe_name": recipe_name,
                "initialized": False,
                "start_sent": False,
                "ice": bool(ice),
                "total_volume_ml": volume,
                "required_glass": required_glass,
            }

        _set_glass_requirement(volume, required_glass)
        # Set the Pi-facing state before transmitting. The ESP32 can reply
        # immediately after the write, and its initialized response must never
        # race an out-of-order INITIALIZING state update.
        _set_machine_state(
            MachineState.INITIALIZING,
            progress=0,
            message="Loading order into controller...",
            order_id=order_id,
        )
        try:
            self._send_json(payload)
        except Exception as exc:
            with self._pending_lock:
                self._pending_order = None
            _clear_glass_requirement()
            _set_machine_state(
                MachineState.ERROR,
                progress=0,
                message=f"Could not send ORDER to ESP32: {exc}",
                order_id=order_id,
            )
            raise

        self._start_order_timeout(order_id)
        print(f"[SERIAL] ORDER sent: {wire_order_id} ({recipe_name}), ice={bool(ice)}")

    def start_pending_order(self):
        with self._pending_lock:
            if not self._pending_order:
                raise RuntimeError("There is no pending order to start.")
            if not self._pending_order["initialized"]:
                raise RuntimeError("ESP32 has not initialized the order yet.")
            if self._active_run_mode is not None:
                raise RuntimeError("Cannot start an order while maintenance is active.")
            if self._pending_order["start_sent"]:
                return
            order_id = self._pending_order["db_order_id"]
            ice_enabled = self._pending_order["ice"]
            total_volume_ml = self._pending_order["total_volume_ml"]
            required_glass = self._pending_order["required_glass"]

        with _lock:
            glass_state = _state["glass_state"]
        if not _glass_matches_requirement(glass_state, required_glass):
            message = _glass_waiting_message(glass_state, required_glass, total_volume_ml)
            _set_machine_state(
                MachineState.WAITING_GLASS,
                progress=0,
                message=message,
                order_id=order_id,
            )
            raise RuntimeError(message)

        with self._pending_lock:
            # The pending order could be cleared while reading raw sensor state.
            if not self._pending_order or self._pending_order["start_sent"]:
                return
            self._pending_order["start_sent"] = True
            self._active_run_mode = "order"

        self._stop_ir_polling()
        message = "START sent. Dispensing ice and preparing drink..." if ice_enabled else "START sent. Preparing drink..."
        _set_machine_state(MachineState.DISPENSING, progress=1, message=message, order_id=order_id)
        try:
            self._send_text("START")
        except Exception as exc:
            _clear_glass_requirement()
            _set_machine_state(
                MachineState.ERROR,
                progress=0,
                message=f"Could not send START to ESP32: {exc}",
                order_id=order_id,
            )
            raise
        print(f"[SERIAL] START sent for order #{order_id}.")

    def send_stop_request(self):
        self._send_text("STOP")
        _record_event("hardware_cmd:stop")
        print("[SERIAL] STOP sent. It is not a global emergency stop in this firmware.")

    def send_power(self, powered: bool):
        if powered:
            print("[SERIAL] Pi-side power enabled; the firmware has no POWER command.")
            return
        with self._pending_lock:
            if self._pending_order is not None or self._active_run_mode is not None:
                raise RuntimeError("Cannot reverse pumps while an order is pending or active.")
            self._active_run_mode = "reverse"
        try:
            self._send_text("REVERSE_PUMPS")
        except Exception:
            with self._pending_lock:
                self._active_run_mode = None
            raise
        _set_machine_state(MachineState.REVERSING, progress=0, message="Reversing all six pump lines...", order_id=None)
        print("[SERIAL] REVERSE_PUMPS sent (firmware uses 4000 ms per pump).")

    def send_clean(self):
        self._stop_ir_polling()
        with self._pending_lock:
            if self._active_run_mode is not None:
                raise RuntimeError("Another machine operation is already active.")
            self._active_run_mode = "cleaning"
        try:
            self._send_text("CLEAN")
        except Exception:
            with self._pending_lock:
                self._active_run_mode = None
            raise
        _set_machine_state(MachineState.WASHING, progress=0, message="Cleaning started (pump 1 for 5 seconds)...", order_id=None)
        print("[SERIAL] CLEAN sent (firmware cleans using pump 1 for 5000 ms).")

    def query_sensors(self, command: str):
        command = command.upper()
        if command not in {"CHECK_IR", "CHECK_LEVELS", "CHECK_LINE_STATE"}:
            raise ValueError(f"Unsupported sensor query: {command}")
        # The firmware cannot tag CHECK_LEVELS replies. Serialize manual and
        # pre-order requests so a manual diagnostic cannot satisfy an order's
        # synchronous safety check.
        if command == "CHECK_LEVELS":
            with self._level_query_gate:
                self._send_text(command)
            return
        self._send_text(command)

    def send_debug_command(self, command: str):
        """Transmit an admin-only, documented maintenance command.

        This deliberately uses a closed allow-list so the web admin panel
        cannot become an arbitrary serial terminal.
        """
        command = command.upper()
        if command in {"CHECK_IR", "CHECK_LEVELS", "CHECK_LINE_STATE"}:
            self.query_sensors(command)
            return
        if command not in {"ICE", "ICE_STATUS", "ICE_SET_OPEN", "ICE_SET_CLOSED"}:
            raise ValueError(f"Unsupported diagnostic command: {command}")
        self._send_text(command)

    def read_liquid_levels(self) -> dict:
        """Request raw LS1..LS6 values and wait briefly for the ESP32 reply."""
        with self._level_query_gate:
            with self._level_response_lock:
                self._latest_level_response = None
                self._level_response_ready.clear()
            self._send_text("CHECK_LEVELS")
            if not self._level_response_ready.wait(self.LEVEL_RESPONSE_TIMEOUT_SECONDS):
                raise TimeoutError("ESP32 did not respond to CHECK_LEVELS in time.")
            with self._level_response_lock:
                if self._latest_level_response is None:
                    raise RuntimeError("ESP32 returned an invalid CHECK_LEVELS response.")
                return dict(self._latest_level_response)

    def _start_ir_polling(self):
        if self._ir_poll_thread and self._ir_poll_thread.is_alive():
            return
        self._ir_poll_stop.clear()
        self._ir_poll_thread = threading.Thread(target=self._ir_poll_loop, daemon=True, name="esp32-ir-poll")
        self._ir_poll_thread.start()

    def _stop_ir_polling(self):
        self._ir_poll_stop.set()

    def _ir_poll_loop(self):
        print("[SERIAL] Starting CHECK_IR polling.")
        while self._running and not self._ir_poll_stop.is_set():
            with self._pending_lock:
                pending = self._pending_order
                should_poll = bool(pending and pending["initialized"] and not pending["start_sent"])
            if not should_poll:
                break
            try:
                self._send_text("CHECK_IR")
            except ConnectionError as exc:
                print(f"[SERIAL] CHECK_IR send failed: {exc}")
            self._ir_poll_stop.wait(self.IR_POLL_INTERVAL_SECONDS)
        print("[SERIAL] CHECK_IR polling stopped.")

    @staticmethod
    def _normalise_pumps(pump_commands: list) -> list[dict]:
        by_pump: dict[int, int] = {}
        for command in pump_commands:
            try:
                pump = int(command["pump"])
                time_ms = int(command["duration_ms"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError("Each pump command needs integer pump and duration_ms values.") from exc
            if pump not in range(1, config.NUM_PUMPS + 1):
                raise ValueError(f"Pump {pump} is outside the firmware range 1-{config.NUM_PUMPS}.")
            if not 1 <= time_ms <= config.MAX_PUMP_TIME_MS:
                raise ValueError(f"Pump {pump} time must be between 1 and {config.MAX_PUMP_TIME_MS} ms.")
            if pump in by_pump:
                raise ValueError(f"Duplicate pump {pump} cannot be sent to the ESP32.")
            by_pump[pump] = time_ms
        if not by_pump:
            raise ValueError("Order has no valid pump durations.")
        return [{"pump": pump, "time_ms": by_pump[pump]} for pump in sorted(by_pump)]

    def _send_json(self, payload: dict):
        self._write_line(json.dumps(payload, separators=(",", ":")))

    def _send_text(self, command: str):
        self._write_line(command.strip())

    def _write_line(self, line: str):
        if not line:
            raise ValueError("ESP32 commands cannot be empty.")
        if "\r" in line or "\n" in line:
            raise ValueError("ESP32 commands must be a single line.")
        if len(line) > 512:
            raise ValueError("ESP32 commands must not exceed 512 characters.")
        with self._command_lock:
            with _lock:
                port = self._serial_port
                connected = _state["connected"]
            if port is None or not connected:
                raise ConnectionError(f"Please Contact the Support")
            try:
                port.write((line + "\n").encode("utf-8"))
                port.flush()
            except serial.SerialException as exc:
                with _lock:
                    _state["connected"] = False
                    _state["firmware_ready"] = False
                    state_copy = _serialise_state()
                _notify_status(state_copy)
                raise ConnectionError(f"ESP32 serial send failed: {exc}") from exc

    def _start_order_timeout(self, order_id: int):
        self._cancel_timer("_order_timeout")
        self._order_timeout = threading.Timer(self.ORDER_RESPONSE_TIMEOUT_SECONDS, self._order_timed_out, args=(order_id,))
        self._order_timeout.daemon = True
        self._order_timeout.start()

    def _order_timed_out(self, order_id: int):
        with self._pending_lock:
            pending = self._pending_order
            if not pending or pending["db_order_id"] != order_id or pending["initialized"]:
                return
            self._pending_order = None
        _clear_glass_requirement()
        _record_event("order:initialization_timeout", f"Order #{order_id}")
        _set_machine_state(MachineState.ERROR, progress=0, message="ESP32 did not acknowledge ORDER in time.", order_id=order_id)

    def _cancel_timer(self, attribute: str):
        timer = getattr(self, attribute, None)
        if timer:
            timer.cancel()
        setattr(self, attribute, None)

    def _handle_response(self, data: dict):
        command = str(data.get("command", "")).upper()
        if command == "ORDER":
            self._handle_order_response(data)
        elif command == "CHECK_IR":
            self._handle_ir_response(data)
        elif command == "CHECK_LEVELS":
            levels = {f"ls{i}": self._raw_binary(data.get(f"ls{i}")) for i in range(1, 7)}
            _handle_sensor({"liquid_levels": levels})
            with self._level_response_lock:
                self._latest_level_response = levels
                self._level_response_ready.set()
            print(f"[SERIAL] Raw liquid levels: {levels}")
        elif command == "CHECK_LINE_STATE":
            _handle_sensor({"fluid_lines_primed": bool(data.get("primed"))})
            print(f"[SERIAL] Feed-line state: {data.get('state', 'UNKNOWN')}")
        else:
            print(f"[SERIAL] Unhandled DATA response: {data}")

    def _handle_order_response(self, data: dict):
        status = str(data.get("status", "")).lower()
        with self._pending_lock:
            pending = self._pending_order
            if not pending:
                print(f"[SERIAL] Unexpected ORDER response: {data}")
                return
            received_id = str(data.get("order_id", ""))
            if received_id and received_id != pending["wire_order_id"]:
                print(f"[SERIAL] Ignoring ORDER response for {received_id}; expected {pending['wire_order_id']}.")
                return
            order_id = pending["db_order_id"]
            if status == "initialized":
                pending["initialized"] = True
            else:
                self._pending_order = None
                self._active_run_mode = None

        self._cancel_timer("_order_timeout")
        if status == "initialized":
            _set_machine_state(MachineState.WAITING_GLASS, progress=0, message="Order initialized. Waiting for IR glass detection...", order_id=order_id)
            self._start_ir_polling()
            print(f"[SERIAL] ORDER {data.get('order_id')} initialized.")
            return

        self._stop_ir_polling()
        _clear_glass_requirement()
        reason = str(data.get("reason", "unknown"))
        _record_event("order:rejected", f"Order #{order_id}: {reason}")
        _set_machine_state(MachineState.ERROR, progress=0, message=f"ESP32 rejected order: {reason}", order_id=order_id)
        print(f"[SERIAL] ORDER rejected: {reason}")

    def _handle_ir_response(self, data: dict):
        upper = self._raw_binary(data.get("upper"))
        lower = self._raw_binary(data.get("lower"))
        if upper is None or lower is None:
            print(f"[SERIAL] Invalid CHECK_IR response: {data}")
            return
        glass_state = self._classify_glass(upper, lower)
        _handle_sensor({"glass_state": glass_state, "upper_sensor": upper, "lower_sensor": lower})
        print(f"[SERIAL] IR values: upper={upper}, lower={lower} -> {glass_state}")
        if glass_state not in {"small_glass", "large_glass"}:
            return
        with self._pending_lock:
            pending = dict(self._pending_order) if self._pending_order else None
            if self._active_run_mode is not None or not pending:
                return
        if not _glass_matches_requirement(glass_state, pending["required_glass"]):
            _set_machine_state(
                MachineState.WAITING_GLASS,
                progress=0,
                message=_glass_waiting_message(
                    glass_state,
                    pending["required_glass"],
                    pending["total_volume_ml"],
                ),
                order_id=pending["db_order_id"],
            )
            return
        try:
            self.start_pending_order()
        except (ConnectionError, RuntimeError) as exc:
            print(f"[SERIAL] Could not start detected-glass order: {exc}")

    @staticmethod
    def _classify_glass(upper: int, lower: int) -> str:
        """Classify the verified active-low two-IR-sensor installation."""
        if upper == 1 and lower == 1:
            return "no_glass"
        if upper == 1 and lower == 0:
            return "small_glass"
        if upper == 0 and lower == 0:
            return "large_glass"
        return "sensor_error"  # upper=0, lower=1 is physically inconsistent

    @staticmethod
    def _raw_binary(value):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed in (0, 1) else None

    def _handle_system_event(self, data: dict):
        event = str(data.get("event", "")).lower()
        action = str(data.get("action", "")).lower()

        if event == "ready":
            with _lock:
                _state["firmware_ready"] = True
                state_copy = _serialise_state()
            _record_event("esp32:ready")
            _notify_status(state_copy)
            print("[SERIAL] ESP32 reported ready.")
            return

        with self._pending_lock:
            pending = dict(self._pending_order) if self._pending_order else None
            run_mode = self._active_run_mode
        order_id = pending["db_order_id"] if pending else None

        if event == "line_priming":
            progress = 5 if action == "started" else 15
            message = "Priming all six feed lines..." if action == "started" else "Feed lines primed. Continuing order..."
            _set_machine_state(MachineState.DISPENSING, progress=progress, message=message, order_id=order_id)
            return

        if event == "pump":
            pump = data.get("pump")
            if run_mode == "cleaning":
                progress = 45 if action == "forward" else 55
                message = f"Cleaning with pump {pump}..." if action == "forward" else "Cleaning dispense complete."
                _set_machine_state(MachineState.WASHING, progress=progress, message=message, order_id=None)
            elif run_mode == "order":
                progress = 30 if action == "forward" else 60
                message = f"Dispensing pump {pump}..." if action == "forward" else f"Pump {pump} complete."
                _set_machine_state(MachineState.DISPENSING, progress=progress, message=message, order_id=order_id)
            return

        if event == "mixing":
            if action == "started":
                _set_machine_state(MachineState.MIXING, progress=75, message="Mixing drink..." if run_mode == "order" else "Mixing cleaning water...", order_id=order_id if run_mode == "order" else None)
            elif action == "stopped":
                _set_machine_state(MachineState.POURING, progress=90, message="Opening valve...", order_id=order_id if run_mode == "order" else None)
            return

        if event == "valve" and action == "opened":
            if run_mode == "order":
                # The documented firmware has no drink-complete event. Its
                # valve-opened DATA event is the final normal-order signal.
                _record_event("esp32:valve_opened", f"Pi order {order_id}")
                self._finish_order_after_display(order_id)
            elif run_mode == "cleaning":
                _set_machine_state(MachineState.WASHING, progress=95, message="Opening valve to finish cleaning...", order_id=None)
            return

        if event == "cleaning":
            if action == "started":
                with self._pending_lock:
                    self._active_run_mode = "cleaning"
                _set_machine_state(MachineState.WASHING, progress=0, message="Cleaning started (pump 1 for 5 seconds)...", order_id=None)
            elif action == "finished":
                with self._pending_lock:
                    self._active_run_mode = None
                    pending = dict(self._pending_order) if self._pending_order else None
                if pending and pending["initialized"] and not pending["start_sent"]:
                    _set_machine_state(
                        MachineState.WAITING_GLASS,
                        progress=0,
                        message="Cleaning finished. Pending order is still initialized; waiting for IR glass detection...",
                        order_id=pending["db_order_id"],
                    )
                    self._start_ir_polling()
                else:
                    _set_machine_state(MachineState.IDLE, progress=0, message="Cleaning finished.", order_id=None)
            return

        if event == "reverse_pumps":
            if action == "started":
                with self._pending_lock:
                    self._active_run_mode = "reverse"
                _set_machine_state(MachineState.REVERSING, progress=0, message="Reversing all six pump lines...", order_id=None)
            elif action == "finished":
                with self._pending_lock:
                    self._active_run_mode = None
                _handle_sensor({"fluid_lines_primed": False})
                _set_machine_state(MachineState.IDLE, progress=0, message="Pump reversal finished.", order_id=None)
            return

        print(f"[SERIAL] Unhandled system event: {data}")

    def _finish_order_after_display(self, order_id: int | None):
        if order_id is None:
            print("[SERIAL] Drink-ready event without a tracked order; keeping controller state unchanged.")
            return
        _set_machine_state(MachineState.DONE, progress=100, message="Drink ready.", order_id=order_id)
        self._cancel_timer("_done_timer")
        self._done_timer = threading.Timer(config.DONE_SCREEN_SECONDS, self._return_to_idle_after_order, args=(order_id,))
        self._done_timer.daemon = True
        self._done_timer.start()

    def _return_to_idle_after_order(self, order_id: int):
        with self._pending_lock:
            pending = self._pending_order
            if not pending or pending.get("db_order_id") != order_id:
                return
            self._pending_order = None
            self._active_run_mode = None
        _clear_glass_requirement()
        _set_machine_state(MachineState.IDLE, progress=0, message="Ready.", order_id=order_id)

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
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                with _lock:
                    _state["last_seen"] = datetime.now().isoformat()
                    _state["connected"] = True
                self._process_line(line)
            except serial.SerialException as exc:
                print(f"[SERIAL] Read error: {exc}")
                with _lock:
                    _state["connected"] = False
                    _state["firmware_ready"] = False
                    state_copy = _serialise_state()
                _notify_status(state_copy)
                self._reconnect()
            except Exception as exc:  # retain serial reader availability on malformed input
                print(f"[SERIAL] Unexpected reader error: {exc}")

    def _process_line(self, line: str):
        if line.startswith("LOG:"):
            message = line[4:]
            self._handle_log(message)
            return
        if not line.startswith("DATA:"):
            print(f"[SERIAL] Unclassified ESP32 line: {line!r}")
            return
        try:
            data = json.loads(line[5:])
        except json.JSONDecodeError as exc:
            print(f"[SERIAL] Invalid DATA JSON: {exc}")
            return
        message_type = str(data.get("type", "")).lower()
        if message_type == "response":
            self._handle_response(data)
        elif message_type == "system":
            self._handle_system_event(data)
        else:
            print(f"[SERIAL] Unknown DATA message type: {data}")

    def _handle_log(self, message: str):
        """Store ESP32 diagnostic logs and surface command rejection safely.

        The firmware reports acknowledgements and plain-text errors through
        ``LOG:`` rather than JSON.  A log error can only be attributed to the
        one Pi-managed operation currently in flight; unrelated admin ice
        diagnostics remain diagnostic-only.
        """
        message = message.strip()
        _record_event("esp32:log", message)
        print(f"[ESP32] {message}")

        error_logs = {
            "BUSY",
            "NO_ORDER_LOADED",
            "ICE_TASK_UNAVAILABLE",
            "ICE_BUSY",
            "ICE_POSITION_NOT_CLOSED",
            "ICE_QUEUE_ERROR",
            "ERROR:UNKNOWN_COMMAND",
            "ERROR:COMMAND_TOO_LONG",
        }
        if message.upper() not in error_logs:
            return

        with self._pending_lock:
            pending = dict(self._pending_order) if self._pending_order else None
            run_mode = self._active_run_mode
            if run_mode not in {"order", "cleaning", "reverse"}:
                return
            self._pending_order = None
            self._active_run_mode = None

        self._stop_ir_polling()
        self._cancel_timer("_order_timeout")
        if pending:
            _clear_glass_requirement()
        order_id = pending["db_order_id"] if pending else None
        _set_machine_state(
            MachineState.ERROR,
            progress=0,
            message=f"ESP32 command rejected: {message}",
            order_id=order_id,
        )

    def _open_port(self) -> serial.Serial | None:
        port_to_try = config.SERIAL_PORT
        ports = list(serial.tools.list_ports.comports())
        if not any(port.device == port_to_try for port in ports) and ports:
            candidates = [
                port.device
                for port in ports
                if any(keyword in (port.description or "").lower() for keyword in ("usb", "uart", "cp210", "ch340", "esp32"))
            ]
            if candidates:
                port_to_try = candidates[0]
        try:
            port = serial.serial_for_url(
                port_to_try,
                baudrate=config.SERIAL_BAUDRATE,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=config.SERIAL_TIMEOUT,
                write_timeout=2,
                xonxoff=False,
                rtscts=False,
                dsrdtr=False,
            )
            time.sleep(1)
            port.reset_input_buffer()
            print(f"[SERIAL] Connected to {port_to_try} @ {config.SERIAL_BAUDRATE} baud")
            return port
        except serial.SerialException as exc:
            print(f"[SERIAL] Cannot open {port_to_try}: {exc}")
            return None

    def _reconnect(self):
        with _lock:
            old_port = self._serial_port
            self._serial_port = None
            _state["connected"] = False
            _state["firmware_ready"] = False
            state_copy = _serialise_state()
        if old_port:
            try:
                old_port.close()
            except serial.SerialException:
                pass
        _notify_status(state_copy)
        while self._running:
            time.sleep(config.SERIAL_RECONNECT_SECONDS)
            port = self._open_port()
            if port:
                with _lock:
                    self._serial_port = port
                    _state["connected"] = True
                    _state["firmware_ready"] = False
                    state_copy = _serialise_state()
                _notify_status(state_copy)
                print("[SERIAL] Reconnected successfully.")
                return


def create_controller() -> HardwareController:
    return SimulatorController() if config.SIMULATOR_MODE else SerialController()
