"""
config.py — Centralised Configuration
ATRIA Bartender | Raspberry Pi
Single source of truth for Serial, Flask, and app settings.
"""

# ─── Serial Connection (ESP32 via USB/UART) ───────────
SERIAL_PORT     = "/dev/ttyACM0"   # update if ls /dev/tty* shows differently
SERIAL_BAUDRATE = 115200
SERIAL_TIMEOUT  = 1                # seconds read timeout

# ─── Flask ────────────────────────────────────────────
FLASK_PORT  = 5000
FLASK_HOST  = "0.0.0.0"
SECRET_KEY  = "atria_bartender_secret_2025"

# ─── Pump Hardware ────────────────────────────────────
NUM_PUMPS             = 6
DEFAULT_FLOW_RATE     = 1.5    # ml per second — default for new pumps

# ─── Recipe / Volume Limits ───────────────────────────
MAX_ML_PER_INGREDIENT = 100   # max ml of any single ingredient per drink
MIN_ML_PER_INGREDIENT = 5     # below this, snap to 0 (ignore trace amounts)
MAX_ML_TOTAL          = 300   # max total volume per drink

# ─── Admin ────────────────────────────────────────────
ADMIN_PIN = "1234"             # default PIN, changeable via API
