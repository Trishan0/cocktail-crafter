"""
config.py — Centralised Configuration
CocktailCraft | Raspberry Pi
Single source of truth for MQTT, bottle labels, and app settings.
Import this in app.py, mqtt_client.py, and db.py instead of
duplicating constants.
"""

# ─── MQTT Broker ──────────────────────────────────
MQTT_BROKER_HOST = "localhost"   # Mosquitto runs on-device
MQTT_BROKER_PORT = 1883
MQTT_KEEPALIVE   = 60
MQTT_CLIENT_ID   = "cocktailcraft_rpi"

# ─── MQTT Topics ──────────────────────────────────
TOPIC_ORDER  = "cocktail/order"
TOPIC_STATUS = "cocktail/status"
TOPIC_SENSOR = "cocktail/sensor"
TOPIC_ABORT  = "cocktail/abort"
TOPIC_CLEAN  = "cocktail/clean"
TOPIC_PING   = "cocktail/ping"
TOPIC_PONG   = "cocktail/pong"

# ─── Bottle Label Map ─────────────────────────────
# Maps hardware slot → human-readable liquid name.
# Update here when you swap bottles on the machine.
BOTTLE_LABELS = {
    "bottle_1": "Rum",
    "bottle_2": "Tequila",
    "bottle_3": "Vodka",
    "bottle_4": "Gin",
    "bottle_5": "Juice / Mixer",
    "bottle_6": "Syrup / Lime",
}

# ─── Recipe Limits ────────────────────────────────
MAX_ML_PER_BOTTLE = 60    # max ml of any single ingredient
MIN_ML_PER_BOTTLE = 5     # values below this snap to 0
MAX_ML_TOTAL      = 180   # max total volume per drink

# ─── Custom Drink Settings ────────────────────────
CUSTOM_EXPIRY_DAYS = 3    # custom drinks expire after N days

# ─── App Settings ─────────────────────────────────
FLASK_PORT       = 5000
FLASK_HOST       = "0.0.0.0"
SECRET_KEY       = "cocktailcraft_secret_2025"
