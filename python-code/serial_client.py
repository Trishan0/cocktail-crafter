"""
serial_client.py — Wired Serial Communication Layer
ATRIA Bartender | Raspberry Pi

Replaces mqtt_client.py. Handles all JSON-line communication
between the Raspberry Pi and the ESP32 over USB/UART.

Protocol (all messages are single-line JSON terminated by \\n):
  RPi → ESP32 : {"cmd": "ORDER", ...}  {"cmd": "ABORT"}  {"cmd": "CLEAN", ...}
  ESP32 → RPi : {"type": "STATUS", ...}  {"type": "SENSOR", ...}
"""

import json
import threading
import time
import serial
import serial.tools.list_ports
from datetime import datetime
import config

# ─────────────────────────────────────────────
#  SHARED STATE  (thread-safe via lock)
# ─────────────────────────────────────────────

_lock = threading.Lock()

_state = {
    # Connection
    "connected":    False,
    "last_seen":    None,       # ISO timestamp of last message from ESP32

    # Machine state (updated from ESP32 STATUS messages)
    # Lifecycle: idle → waiting_glass → dispensing → mixing → pouring → done | error | aborted
    "machine_status":   "idle",
    "current_order_id": None,
    "progress":         0,      # 0-100
    "message":          "",     # human-readable status text

    # Sensor state (updated from ESP32 SENSOR messages)
    "glass_present": False,
}

_status_callbacks = []   # registered by app.py
_sensor_callbacks = []   # registered by app.py

_serial_port: serial.Serial = None
_reader_thread: threading.Thread = None
_running = False


# ─────────────────────────────────────────────
#  PUBLIC API
# ─────────────────────────────────────────────

def get_state() -> dict:
    with _lock:
        return dict(_state)


def register_status_callback(fn):
    _status_callbacks.append(fn)


def register_sensor_callback(fn):
    _sensor_callbacks.append(fn)


def send_order(order_id: int, recipe_name: str, pump_commands: list):
    """
    Send an ORDER command to the ESP32.

    pump_commands: [
        {"pump": 1, "ingredient": "Rum",  "amount_ml": 50, "duration_ms": 33333},
        ...
    ]
    """
    payload = {
        "cmd":         "ORDER",
        "order_id":    order_id,
        "recipe_name": recipe_name,
        "pumps":       pump_commands,
    }
    _send(payload)
    print(f"[SERIAL] ORDER sent → #{order_id} {recipe_name}")


def send_abort():
    """Send an emergency ABORT to the ESP32."""
    _send({"cmd": "ABORT"})
    print("[SERIAL] ABORT sent.")


def send_clean(mode="all"):
    """
    Trigger a cleaning cycle.
    mode: 'all' = flush all pumps | 'single' = flush a specific pump
    """
    _send({"cmd": "CLEAN", "mode": mode})
    print(f"[SERIAL] CLEAN ({mode}) sent.")


# ─────────────────────────────────────────────
#  INTERNAL — SEND
# ─────────────────────────────────────────────

def _send(payload: dict):
    with _lock:
        port = _serial_port
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


# ─────────────────────────────────────────────
#  INTERNAL — RECEIVE LOOP
# ─────────────────────────────────────────────

def _reader_loop():
    """Background thread that reads JSON lines from the ESP32."""
    global _running
    while _running:
        with _lock:
            port = _serial_port

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
                _state["last_seen"]  = datetime.now().isoformat()
                _state["connected"]  = True

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
            _reconnect()
        except Exception as e:
            print(f"[SERIAL] Unexpected reader error: {e}")
            time.sleep(0.1)


def _handle_status(data: dict):
    """
    Expected ESP32 STATUS payload:
    {
        "type":     "STATUS",
        "order_id": 42,
        "status":   "dispensing",   // idle|waiting_glass|dispensing|mixing|pouring|done|error|aborted
        "progress": 40,             // 0-100
        "message":  "Dispensing Rum..."
    }
    """
    with _lock:
        # ESP32 might send "machine_status" or "status"
        status_val = data.get("machine_status", data.get("status", _state["machine_status"]))
        
        _state["machine_status"]   = status_val
        _state["current_order_id"] = data.get("order_id", data.get("current_order_id", _state["current_order_id"]))
        _state["progress"]         = data.get("progress", _state["progress"])
        _state["message"]          = data.get("message",  _state["message"])
        state_copy = dict(_state)

    print(f"[SERIAL] STATUS → {state_copy['machine_status']} ({state_copy['progress']}%) | {state_copy['message']}")

    for cb in _status_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[SERIAL] Status callback error: {e}")


def _handle_sensor(data: dict):
    """
    Expected ESP32 SENSOR payload:
    {
        "type":          "SENSOR",
        "glass_present": true
    }
    """
    with _lock:
        if "glass_present" in data:
            _state["glass_present"] = bool(data["glass_present"])
        state_copy = dict(_state)

    print(f"[SERIAL] SENSOR → glass_present={state_copy['glass_present']}")

    for cb in _sensor_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[SERIAL] Sensor callback error: {e}")


# ─────────────────────────────────────────────
#  INTERNAL — CONNECTION MANAGEMENT
# ─────────────────────────────────────────────

def _open_port() -> serial.Serial:
    """Open the serial port. Returns port object or None on failure."""
    port_to_try = config.SERIAL_PORT
    
    # Auto-detect COM port if we're on Windows and config port isn't in the list
    ports = list(serial.tools.list_ports.comports())
    if not any(p.device == port_to_try for p in ports) and len(ports) > 0:
        port_to_try = ports[0].device

    try:
        port = serial.Serial(
            port=port_to_try,
            baudrate=config.SERIAL_BAUDRATE,
            timeout=config.SERIAL_TIMEOUT
        )
        print(f"[SERIAL] Connected to {port_to_try} @ {config.SERIAL_BAUDRATE} baud")
        return port
    except serial.SerialException as e:
        print(f"[SERIAL] Cannot open {port_to_try}: {e}")
        return None


def _reconnect():
    """Close and reopen the serial port. Retries every 3 seconds."""
    global _serial_port
    with _lock:
        if _serial_port is not None:
            try:
                _serial_port.close()
            except Exception:
                pass
            _serial_port = None

    while _running:
        print("[SERIAL] Retrying connection...")
        time.sleep(3)
        port = _open_port()
        if port:
            with _lock:
                _serial_port = port
                _state["connected"] = True
            print("[SERIAL] Reconnected successfully.")
            return
        else:
            with _lock:
                _state["connected"] = False


# ─────────────────────────────────────────────
#  START / STOP
# ─────────────────────────────────────────────

def start():
    """Open the serial port and start the reader thread. Call once at startup."""
    global _serial_port, _reader_thread, _running

    _running = True
    port = _open_port()

    with _lock:
        _serial_port = port
        _state["connected"] = (port is not None)

    if port is None:
        print("[SERIAL] WARNING: Starting without ESP32 connection. Will retry in background.")

    _reader_thread = threading.Thread(target=_reader_loop, daemon=True, name="serial-reader")
    _reader_thread.start()
    print("[SERIAL] Serial client started.")


def stop():
    """Gracefully stop the serial client."""
    global _running
    _running = False

    with _lock:
        port = _serial_port

    if port:
        try:
            port.close()
        except Exception:
            pass
    print("[SERIAL] Serial client stopped.")
