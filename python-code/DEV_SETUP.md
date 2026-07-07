# Dev Setup — Fake ESP32 Serial Harness

This guide explains how to run `fake_esp32.py` as a drop-in replacement for real ESP32 hardware, exercising the `SerialController` path end-to-end without any physical devices.

---

## Why bother?

`SimulatorController` (simulator mode in `config.py`) is great for rapid UI iteration,  
but `SerialController` — the real serial path — was never exercised before.  
`fake_esp32.py` fixes that: it creates a real serial conversation so reconnection logic,  
JSON parse errors, and partial-read handling are all tested with actual bytes.

---

## Option A — Linux / Raspberry Pi (`socat` virtual serial pair)

### 1. Install socat

```bash
sudo apt install socat   # Debian / Raspberry Pi OS
```

### 2. Create a linked virtual serial pair

```bash
socat -d -d pty,raw,echo=0 pty,raw,echo=0
```

socat prints two device paths, e.g.:

```
... PTY is /dev/pts/2
... PTY is /dev/pts/3
```

Leave this terminal running — the pair exists as long as socat does.

### 3. Start the fake ESP32 on one end

```bash
# In a new terminal, from python-code/:
python fake_esp32.py --port /dev/pts/3
```

### 4. Point the Flask app at the other end

In `config.py`:

```python
SIMULATOR_MODE = False
SERIAL_PORT    = "/dev/pts/2"   # the OTHER end of the socat pair
```

### 5. Run the Flask app

```bash
python app.py
```

You should see the fake ESP32 printing received commands and the Flask app printing incoming STATUS/SENSOR events.

---

## Option B — Windows (`socket://` TCP loopback)

`socat` is not available on Windows. Instead, `fake_esp32.py` runs as a TCP server and pyserial connects to it via its `socket://` URL scheme — no drivers or virtual COM port software needed.

### 1. Start the fake ESP32 as a TCP server

```powershell
# In python-code/
python fake_esp32.py --tcp --tcp-port 9999
```

### 2. Point the Flask app at it

In `config.py`:

```python
SIMULATOR_MODE = False
SERIAL_PORT    = "socket://localhost:9999"
```

### 3. Run the Flask app

```powershell
python app.py
```

> **Note:** pyserial's `socket://` support acts as a TCP *client* — it connects outward to the server. `fake_esp32.py --tcp` is the server that accepts that connection.

---

## Chaos mode

Add `--chaos` to either invocation to stress-test error handling:

```bash
python fake_esp32.py --port /dev/pts/3 --chaos
# or
python fake_esp32.py --tcp --chaos
```

Chaos mode randomly injects:
- **Malformed / non-JSON lines** — verifies `SerialController` logs and skips bad input without crashing
- **Unknown message types** — verifies the `else` branch in the reader loop
- **Artificial delays** — verifies the app doesn't time out or deadlock mid-sequence

---

## What the fake ESP32 simulates

| Command received | Sequence sent back |
|---|---|
| `ORDER` | `waiting_glass` → sensor(glass=true) → `dispensing` → `mixing` → `pouring` → `done` → *auto-clean* |
| `ORDER` + `"ice": true` | As above, with an extra `dispensing` step for ice before ingredients |
| Post-order auto-clean | `reversing` → (waits 3s, sends sensor glass=false) → `washing` → `mixing` → `draining` → `resealing` → `idle` |
| `ABORT` | Immediately → `aborted` → `idle` |
| `CLEAN` `trigger=manual` `mode=all` | `reversing` → `idle` |
| `CLEAN` `trigger=manual` `mode=single` | `reversing` → `idle` |

All timing is accelerated vs real hardware for fast dev feedback.

---

## Sequence diagram

```
Flask app (SerialController)            fake_esp32.py
          │                                    │
          │── ORDER {id:42, recipe:"Mojito"} ─▶│
          │                                    │── STATUS waiting_glass (0%)
          │                                    │── SENSOR glass_present=true
          │                                    │── STATUS dispensing (10%)
          │                                    │── STATUS dispensing (40%)
          │                                    │── STATUS mixing (60%)
          │                                    │── STATUS pouring (80%)
          │                                    │── STATUS done (100%)
          │                                    │
          │         [auto-clean begins]         │
          │                                    │── STATUS reversing (0%)
          │                                    │── STATUS reversing (50%) "remove glass"
          │                                    │   [3s pause]
          │                                    │── SENSOR glass_present=false
          │                                    │── STATUS washing (0%)
          │                                    │── STATUS mixing (50%)
          │                                    │── STATUS draining (75%)
          │                                    │── STATUS resealing (90%)
          │                                    │── STATUS idle (0%)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot open /dev/pts/X` | socat process died; re-run it and update the port numbers |
| Flask app connects but no messages | Check both ends are using opposite pts devices |
| TCP: `Connection refused` | Start `fake_esp32.py --tcp` before `app.py` |
| `No module named 'serial'` | Activate the venv: `source .venv/bin/activate` (Linux) or `.\.venv\Scripts\Activate.ps1` (Windows) |
