"""
config.py — Centralised Configuration
Cocktail-Craft Bartender | Raspberry Pi
Single source of truth for Serial, Flask, and app settings.
"""

# ─── Serial Connection (ESP32 via USB/UART) ───────────
SIMULATOR_MODE  = False             # If True, bypasses hardware and simulates pouring
SERIAL_PORT     = "/dev/ttyACM0"   # update if ls /dev/tty* shows differently
SERIAL_BAUDRATE = 115200
SERIAL_TIMEOUT  = 1                # seconds read timeout
SERIAL_RECONNECT_SECONDS = 3

# The current ESP32 firmware rejects an ORDER if a pump time is outside this
# range. Keep the Pi-side validation in lockstep with MAX_PUMP_TIME_MS in the
# firmware.
MAX_PUMP_TIME_MS = 60_000
ORDER_RESPONSE_TIMEOUT_SECONDS = 8
IR_POLL_INTERVAL_SECONDS = 0.75
LEVEL_RESPONSE_TIMEOUT_SECONDS = 2

# The firmware sends no explicit order-completed event; valve-opened is the
# completion signal. Keep the customer confirmation visible briefly before
# returning the Pi-facing state to idle.
DONE_SCREEN_SECONDS = 5

# ─── Flask ────────────────────────────────────────────
FLASK_PORT  = 5000
FLASK_HOST  = "0.0.0.0"
SECRET_KEY  = "Cocktail-Craft_bartender_secret_2025"

# ─── Pump Hardware ────────────────────────────────────
NUM_PUMPS             = 6
DEFAULT_FLOW_RATE     = 1.5    # ml per second — default for new pumps

# ─── Recipe / Volume Limits ───────────────────────────
MAX_ML_PER_INGREDIENT = 100   # max ml of any single ingredient per drink
MIN_ML_PER_INGREDIENT = 5     # below this, snap to 0 (ignore trace amounts)
MAX_ML_TOTAL          = 300   # max total volume per drink

# ─── Admin ────────────────────────────────────────────
ADMIN_PIN = "1234"             # default PIN, changeable via API
