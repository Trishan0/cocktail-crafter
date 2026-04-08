# CocktailCraft — Raspberry Pi Setup Guide

## 1. Install Mosquitto MQTT Broker
```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

Verify broker is running:
```bash
mosquitto_sub -t "cocktail/#" -v   # listen to all cocktail topics
```

## 2. Install Python Dependencies
```bash
cd ~/cocktailcraft
pip install -r requirements.txt --break-system-packages
```

## 3. Initialize the Database
```bash
python db.py
# Should print: Seeded 9 default recipes.
```

## 4. Run the App
```bash
python app.py
# Starts on http://localhost:5000
```

## 5. Open in Kiosk Browser (Chromium fullscreen)
```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --no-first-run http://localhost:5000
```

Or add to autostart:
```bash
# Edit /etc/xdg/lxsession/LXDE-pi/autostart
@chromium-browser --kiosk http://localhost:5000
```

## 6. Run on Boot (systemd service)
```bash
sudo nano /etc/systemd/system/cocktailcraft.service
```

Paste:
```ini
[Unit]
Description=CocktailCraft Flask App
After=network.target mosquitto.service

[Service]
User=pi
WorkingDirectory=/home/pi/cocktailcraft
ExecStart=/usr/bin/python3 app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl enable cocktailcraft
sudo systemctl start cocktailcraft
```

## MQTT Topics Reference

| Topic              | Direction    | Payload example |
|--------------------|--------------|-----------------|
| cocktail/order     | RPi → ESP32  | `{"order_id":1,"recipe_name":"Mojito","ingredients":{"bottle_1":40,...},"options":{"ice":true,"lime":false}}` |
| cocktail/status    | ESP32 → RPi  | `{"status":"dispensing","order_id":1,"progress":40,"message":"Dispensing Rum..."}` |
| cocktail/sensor    | ESP32 → RPi  | `{"glass_present":true,"bottle_levels":{"bottle_1":true,"bottle_2":false,...}}` |
| cocktail/abort     | RPi → ESP32  | `ABORT` |
| cocktail/clean     | RPi → ESP32  | `{"mode":"periodic"}` |
| cocktail/ping      | RPi → ESP32  | `PING` |
| cocktail/pong      | ESP32 → RPi  | `PONG` |

## ESP32 Status Values
- `idle`           — waiting for order
- `waiting_glass`  — order received, waiting for IR sensor
- `dispensing`     — pumps running
- `mixing`         — servo oscillating
- `pouring`        — solenoid valve open
- `done`           — complete
- `error`          — something went wrong
- `cleaning`       — cleaning cycle active

## Bottle Layout (edit in db.py → BOTTLE_LABELS)
```
bottle_1 → Rum
bottle_2 → Tequila
bottle_3 → Vodka
bottle_4 → Gin
bottle_5 → Juice / Mixer
bottle_6 → Syrup / Lime
```
