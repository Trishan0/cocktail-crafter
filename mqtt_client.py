"""
mqtt_client.py — MQTT Communication Layer
CocktailCraft | Raspberry Pi
Handles all publish/subscribe logic between RPi and ESP32-S3.
"""

import json
import threading
import time
import paho.mqtt.client as mqtt
from datetime import datetime

# ─────────────────────────────────────────────
#  MQTT CONFIG
# ─────────────────────────────────────────────

BROKER_HOST = "localhost"
BROKER_PORT = 1883
KEEPALIVE   = 60
CLIENT_ID   = "cocktailcraft_rpi"

# Topics
TOPIC_ORDER   = "cocktail/order"    # RPi → ESP32  : send recipe
TOPIC_STATUS  = "cocktail/status"   # ESP32 → RPi  : machine status updates
TOPIC_SENSOR  = "cocktail/sensor"   # ESP32 → RPi  : glass + bottle levels
TOPIC_ABORT   = "cocktail/abort"    # RPi → ESP32  : emergency stop
TOPIC_CLEAN   = "cocktail/clean"    # RPi → ESP32  : trigger cleaning cycle
TOPIC_PING    = "cocktail/ping"     # RPi → ESP32  : heartbeat
TOPIC_PONG    = "cocktail/pong"     # ESP32 → RPi  : heartbeat reply

SUBSCRIBE_TOPICS = [
    (TOPIC_STATUS, 1),
    (TOPIC_SENSOR, 1),
    (TOPIC_PONG,   1),
]


# ─────────────────────────────────────────────
#  SHARED STATE  (thread-safe via lock)
# ─────────────────────────────────────────────

_lock = threading.Lock()

_state = {
    # Connection
    "connected": False,
    "last_seen": None,          # last message from ESP32

    # Machine state (from ESP32 status messages)
    "machine_status": "idle",   # idle | waiting_glass | dispensing | mixing | pouring | done | error | cleaning
    "current_order_id": None,
    "progress": 0,              # 0–100 percent
    "message": "",              # human-readable status message

    # Sensor data (from ESP32 sensor messages)
    "glass_present": False,
    "bottle_levels": {          # True = liquid present, False = empty/low
        "bottle_1": True,
        "bottle_2": True,
        "bottle_3": True,
        "bottle_4": True,
        "bottle_5": True,
        "bottle_6": True,
    },
}

# Callbacks registered by app.py to react to incoming messages
_status_callbacks  = []   # called when status changes
_sensor_callbacks  = []   # called when sensor data arrives


def get_state():
    with _lock:
        return dict(_state)


def register_status_callback(fn):
    _status_callbacks.append(fn)


def register_sensor_callback(fn):
    _sensor_callbacks.append(fn)


# ─────────────────────────────────────────────
#  MQTT CLIENT SETUP
# ─────────────────────────────────────────────

_client = None


def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Connected to broker at {BROKER_HOST}:{BROKER_PORT}")
        with _lock:
            _state["connected"] = True
        for topic, qos in SUBSCRIBE_TOPICS:
            client.subscribe(topic, qos)
            print(f"[MQTT] Subscribed to {topic}")
    else:
        print(f"[MQTT] Connection failed with code {rc}")
        with _lock:
            _state["connected"] = False


def _on_disconnect(client, userdata, rc):
    print(f"[MQTT] Disconnected (rc={rc}). Will auto-reconnect...")
    with _lock:
        _state["connected"] = False


def _on_message(client, userdata, msg):
    topic   = msg.topic
    payload = msg.payload.decode("utf-8")

    with _lock:
        _state["last_seen"] = datetime.now().isoformat()

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        data = payload  # plain string (e.g. PONG)

    # ── Status update from ESP32 ──────────────────
    if topic == TOPIC_STATUS:
        _handle_status(data)

    # ── Sensor data from ESP32 ────────────────────
    elif topic == TOPIC_SENSOR:
        _handle_sensor(data)

    # ── Heartbeat reply ───────────────────────────
    elif topic == TOPIC_PONG:
        pass  # last_seen already updated above

    else:
        print(f"[MQTT] Unhandled topic: {topic} | {payload}")


def _handle_status(data: dict):
    """
    Expected ESP32 status payload:
    {
        "status":   "dispensing",       // machine_status string
        "order_id": 5,
        "progress": 40,                 // 0–100
        "message":  "Dispensing Rum..."
    }
    """
    with _lock:
        if isinstance(data, dict):
            _state["machine_status"]   = data.get("status", _state["machine_status"])
            _state["current_order_id"] = data.get("order_id", _state["current_order_id"])
            _state["progress"]         = data.get("progress", _state["progress"])
            _state["message"]          = data.get("message", _state["message"])
        state_copy = dict(_state)

    print(f"[MQTT] Status → {state_copy['machine_status']} | {state_copy['message']}")

    for cb in _status_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[MQTT] Status callback error: {e}")


def _handle_sensor(data: dict):
    """
    Expected ESP32 sensor payload:
    {
        "glass_present": true,
        "bottle_levels": {
            "bottle_1": true,
            "bottle_2": false,
            ...
        }
    }
    """
    with _lock:
        if isinstance(data, dict):
            if "glass_present" in data:
                _state["glass_present"] = data["glass_present"]
            if "bottle_levels" in data:
                _state["bottle_levels"].update(data["bottle_levels"])
        state_copy = dict(_state)

    for cb in _sensor_callbacks:
        try:
            cb(state_copy)
        except Exception as e:
            print(f"[MQTT] Sensor callback error: {e}")


# ─────────────────────────────────────────────
#  PUBLISH HELPERS
# ─────────────────────────────────────────────

def publish_order(order_id: int, recipe_name: str, ingredients: dict, options: dict = None):
    """
    Publish a drink order to the ESP32.
    ingredients: {"bottle_1": 30, "bottle_2": 0, ...}
    options:     {"ice": true, "lime": false}
    """
    payload = {
        "order_id":    order_id,
        "recipe_name": recipe_name,
        "ingredients": ingredients,
        "options":     options or {"ice": False, "lime": False},
        "timestamp":   datetime.now().isoformat(),
    }
    _publish(TOPIC_ORDER, payload, qos=1)
    print("Publishing order to MQTT:", payload)
    print(f"[MQTT] Order published → #{order_id} {recipe_name}")


def publish_abort():
    """Send emergency abort to ESP32."""
    _publish(TOPIC_ABORT, "ABORT", qos=2)
    print("[MQTT] ABORT published.")


def publish_clean(mode="periodic"):
    """
    Trigger cleaning cycle on ESP32.
    mode: 'periodic' | 'end_of_day'
    """
    _publish(TOPIC_CLEAN, {"mode": mode}, qos=1)
    print(f"[MQTT] Clean ({mode}) published.")


def publish_ping():
    _publish(TOPIC_PING, "PING", qos=0)


def _publish(topic, payload, qos=0):
    if _client is None or not _state.get("connected"):
        print(f"[MQTT] WARNING: Not connected. Cannot publish to {topic}")
        return
    if isinstance(payload, dict):
        payload = json.dumps(payload)
    _client.publish(topic, payload, qos=qos)


# ─────────────────────────────────────────────
#  HEARTBEAT THREAD
# ─────────────────────────────────────────────

def _heartbeat_loop():
    """Ping the ESP32 every 10 seconds to check liveness."""
    while True:
        time.sleep(10)
        publish_ping()


# ─────────────────────────────────────────────
#  START / STOP
# ─────────────────────────────────────────────

def start():
    """Initialize and connect the MQTT client. Call once at app startup."""
    global _client
    _client = mqtt.Client(client_id=CLIENT_ID, clean_session=True)
    _client.on_connect    = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.on_message    = _on_message

    # Auto-reconnect on drop
    _client.reconnect_delay_set(min_delay=1, max_delay=30)

    try:
        _client.connect(BROKER_HOST, BROKER_PORT, KEEPALIVE)
    except Exception as e:
        print(f"[MQTT] Initial connection error: {e} — will keep retrying...")

    # Non-blocking network loop
    _client.loop_start()

    # Heartbeat
    hb = threading.Thread(target=_heartbeat_loop, daemon=True)
    hb.start()

    print("[MQTT] Client started.")


def stop():
    """Gracefully disconnect."""
    if _client:
        _client.loop_stop()
        _client.disconnect()
    print("[MQTT] Client stopped.")
