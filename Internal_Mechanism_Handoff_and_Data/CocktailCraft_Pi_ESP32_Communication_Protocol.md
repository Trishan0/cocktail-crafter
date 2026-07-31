# CocktailCraft — Raspberry Pi ↔ ESP32-S3 Communication Protocol

> Scope: only commands sent from the Raspberry Pi to the ESP32-S3 and messages sent from the ESP32-S3 back to the Raspberry Pi.

---

## 1. Serial connection

| Setting | Value |
|---|---|
| Interface | ESP32 USB serial |
| Baud rate | `115200` |
| Data bits | `8` |
| Parity | none |
| Stop bits | `1` |
| Flow control | none |
| Recommended line ending | `\n` |
| Maximum command length | 512 characters |

Every command or JSON request should be sent as one complete line.

Example:

```text
START\n
```

Example JSON:

```text
{"command":"ORDER","order_id":"ORD-1042","pumps":[{"pump":1,"time_ms":3333}],"ice":{"enabled":false}}\n
```

---

## 2. ESP32 output prefixes

### Machine-readable output

```text
DATA:<JSON>
```

Example:

```text
DATA:{"type":"system","event":"ready"}
```

The Pi should remove `DATA:` and parse the remainder as JSON.

### Human-readable output

```text
LOG:<message>
```

Example:

```text
LOG:ACK:START
```

The Pi may display or store these messages for diagnostics.

---

# Raspberry Pi → ESP32

## 3. ORDER JSON

The Pi sends an `ORDER` JSON object to initialize one pending drink order.

This does not start the mechanism. After the order is accepted, the Pi must send `START`.

### General format

```json
{
  "command": "ORDER",
  "order_id": "ORD-1042",
  "pumps": [
    {
      "pump": 1,
      "time_ms": 3333
    },
    {
      "pump": 3,
      "time_ms": 5000
    }
  ],
  "ice": {
    "enabled": true
  }
}
```

### Field rules

| Field | Type | Rules |
|---|---|---|
| `command` | string | Must be exactly `"ORDER"` |
| `order_id` | string | Required and non-empty |
| `pumps` | array | Required and must contain at least one item |
| `pump` | integer | `1` through `6` |
| `time_ms` | integer | `1` through `60000` |
| `ice.enabled` | boolean | Optional; defaults to `false` |

Additional rules:

- Pump numbers must not be duplicated.
- Pumps omitted from the array are skipped.
- An order may be rejected while the machine or ice mechanism is busy.
- An ice-enabled order requires the saved ice position to be `CLOSED`.

### Minimal order

```text
{"command":"ORDER","order_id":"ORD-0001","pumps":[{"pump":1,"time_ms":3000}],"ice":{"enabled":false}}
```

### Multiple-pump order

```text
{"command":"ORDER","order_id":"ORD-1042","pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000},{"pump":6,"time_ms":2200}],"ice":{"enabled":true}}
```

### All-pump order

```text
{"command":"ORDER","order_id":"ALL-PUMPS-001","pumps":[{"pump":1,"time_ms":3000},{"pump":2,"time_ms":3000},{"pump":3,"time_ms":3000},{"pump":4,"time_ms":3000},{"pump":5,"time_ms":3000},{"pump":6,"time_ms":3000}],"ice":{"enabled":true}}
```

---

## 4. Plain-text commands

| Command | Alias | Purpose |
|---|---|---|
| `START` | `S`, lowercase `s` | Start the loaded order |
| `CLEAN` | none | Run the cleaning sequence |
| `STOP` | `X`, lowercase `x` | Request mixer stop and/or stop ice |
| `ICE` | none | Run a standalone ice cycle |
| `ICE_STATUS` | none | Read saved and runtime ice state |
| `ICE_SET_OPEN` | none | Manually save ice state as OPEN |
| `ICE_SET_CLOSED` | none | Manually save ice state as CLOSED |
| `CHECK_LEVELS` | none | Read six liquid-level sensor inputs |
| `CHECK_IR` | none | Read upper and lower IR sensor inputs |
| `CHECK_LINE_STATE` | none | Read saved fluid-line state |
| `REVERSE_PUMPS` | none | Reverse all six pumps sequentially |

Use `REVERSE_PUMPS` only. The command `REVERSE` is not implemented.

---

## 5. START

### Pi sends

```text
START
```

### ESP32 acknowledgement

```text
LOG:ACK:START
```

### Possible errors

```text
LOG:NO_ORDER_LOADED
```

```text
LOG:BUSY
```

```text
LOG:ICE_TASK_UNAVAILABLE
```

```text
LOG:ICE_BUSY
```

```text
LOG:ICE_POSITION_NOT_CLOSED
```

```text
LOG:ICE_QUEUE_ERROR
```

---

## 6. CLEAN

### Pi sends

```text
CLEAN
```

### ESP32 acknowledgement

```text
LOG:ACK:CLEAN
```

### Possible error

```text
LOG:BUSY
```

---

## 7. STOP

### Pi sends

```text
STOP
```

or:

```text
X
```

### ESP32 acknowledgement

```text
LOG:ACK:STOP
```

### Nothing stoppable

```text
LOG:NOTHING_STOPPABLE_RUNNING
```

STOP currently applies to the mixer and ice mechanism. It is not a complete emergency-stop command for every machine state.

---

## 8. ICE

### Pi sends

```text
ICE
```

### ESP32 acknowledgement

```text
LOG:ACK:ICE
```

### Possible errors

```text
LOG:BUSY
LOG:ICE_TASK_UNAVAILABLE
LOG:ICE_BUSY
LOG:ICE_POSITION_NOT_CLOSED
LOG:ICE_QUEUE_ERROR
```

---

## 9. ICE_STATUS

### Pi sends

```text
ICE_STATUS
```

### ESP32 responds

```text
LOG:ICE_POSITION:CLOSED,STATE:IDLE,BUSY:NO
```

Possible runtime states:

```text
IDLE
OPENING
HOLDING_OPEN
CLOSING
VIBRATING
```

---

## 10. ICE_SET_OPEN

### Pi sends

```text
ICE_SET_OPEN
```

This changes only the saved software state. It does not move the motor.

The ESP32 warns:

```text
LOG:WARNING: ICE POSITION CHANGED WITHOUT MOVEMENT
```

Use only after physically verifying the ice mechanism.

---

## 11. ICE_SET_CLOSED

### Pi sends

```text
ICE_SET_CLOSED
```

This changes only the saved software state. It does not move the motor.

The ESP32 warns:

```text
LOG:WARNING: ICE POSITION CHANGED WITHOUT MOVEMENT
```

---

## 12. CHECK_LEVELS

### Pi sends

```text
CHECK_LEVELS
```

### ESP32 responds

```text
DATA:{"type":"response","command":"CHECK_LEVELS","ls1":1,"ls2":0,"ls3":1,"ls4":1,"ls5":0,"ls6":1}
```

Values are raw electrical states:

```text
1 = HIGH
0 = LOW
```

---

## 13. CHECK_IR

### Pi sends

```text
CHECK_IR
```

### ESP32 responds

```text
DATA:{"type":"response","command":"CHECK_IR","upper":0,"lower":1}
```

Values are raw electrical states:

```text
1 = HIGH
0 = LOW
```

---

## 14. CHECK_LINE_STATE

### Pi sends

```text
CHECK_LINE_STATE
```

### Primed response

```text
DATA:{"type":"response","command":"CHECK_LINE_STATE","primed":true,"state":"PRIMED"}
```

### Empty response

```text
DATA:{"type":"response","command":"CHECK_LINE_STATE","primed":false,"state":"EMPTY"}
```

---

## 15. REVERSE_PUMPS

### Pi sends

```text
REVERSE_PUMPS
```

### ESP32 acknowledgement

```text
LOG:ACK:REVERSE_PUMPS
```

### Possible error

```text
LOG:BUSY
```

---

# ESP32 → Raspberry Pi

## 16. Startup event

After successful ESP32 setup:

```text
DATA:{"type":"system","event":"ready"}
```

The Pi should wait for this before submitting an order.

---

## 17. ORDER initialized response

```text
DATA:{"type":"response","command":"ORDER","status":"initialized","order_id":"ORD-1042","ice":true,"pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000}]}
```

The Pi may send `START` only after receiving this response.

---

## 18. ORDER rejection response

General format:

```text
DATA:{"type":"response","command":"ORDER","status":"rejected","reason":"<reason>"}
```

Possible reasons:

```text
busy
invalid_json
invalid_command
missing_order_id
ice_task_unavailable
ice_position_not_closed
missing_pumps
invalid_pump_number
invalid_pump_time
duplicate_pump
```

Example:

```text
DATA:{"type":"response","command":"ORDER","status":"rejected","reason":"duplicate_pump"}
```

---

## 19. Pump events

### Pump started

```text
DATA:{"type":"system","event":"pump","pump":1,"action":"forward"}
```

### Pump stopped

```text
DATA:{"type":"system","event":"pump","pump":1,"action":"stop"}
```

These events are produced for:

- normal order dispensing;
- cleaning pump operation.

They are not produced for line priming or pump reversal.

---

## 20. Mixing events

### Mixing started

```text
DATA:{"type":"system","event":"mixing","action":"started"}
```

### Mixing stopped

```text
DATA:{"type":"system","event":"mixing","action":"stopped"}
```

---

## 21. Valve event

When valve opening completes:

```text
DATA:{"type":"system","event":"valve","action":"opened"}
```

This is currently the closest practical end-of-order event.

There is no dedicated order-completed JSON event.

---

## 22. Line-priming events

### Started

```text
DATA:{"type":"system","event":"line_priming","action":"started"}
```

### Finished

```text
DATA:{"type":"system","event":"line_priming","action":"finished"}
```

Individual priming pumps produce logs only.

---

## 23. Cleaning events

### Started

```text
DATA:{"type":"system","event":"cleaning","action":"started"}
```

### Finished

```text
DATA:{"type":"system","event":"cleaning","action":"finished"}
```

---

## 24. Reverse-pump events

### Started

```text
DATA:{"type":"system","event":"reverse_pumps","action":"started"}
```

### Finished

```text
DATA:{"type":"system","event":"reverse_pumps","action":"finished"}
```

Individual reverse-pump operations produce logs only.

---

## 25. Ice-cycle logs

The ice mechanism currently reports progress using `LOG:` messages rather than JSON.

Typical sequence:

```text
LOG:ICE CYCLE STARTED
LOG:ICE DISPENSER OPENING CW FOR 26000ms
LOG:ICE SAVED POSITION: OPEN
LOG:ICE DISPENSER FULLY OPEN
LOG:ICE DISPENSER CLOSING CCW FOR 26000ms
LOG:ICE SAVED POSITION: CLOSED
LOG:ICE DISPENSER FULLY CLOSED
LOG:ICE DISPENSER VIBRATION STARTED
LOG:ICE DISPENSER VIBRATION FINISHED
LOG:ICE CYCLE FINISHED
```

---

## 26. General acknowledgement logs

```text
LOG:ACK:START
LOG:ACK:CLEAN
LOG:ACK:STOP
LOG:ACK:ICE
LOG:ACK:REVERSE_PUMPS
```

---

## 27. General error/status logs

```text
LOG:BUSY
LOG:NO_ORDER_LOADED
LOG:NOTHING_STOPPABLE_RUNNING
LOG:ERROR:UNKNOWN_COMMAND
LOG:ERROR:COMMAND_TOO_LONG
LOG:ICE_TASK_UNAVAILABLE
LOG:ICE_BUSY
LOG:ICE_POSITION_NOT_CLOSED
LOG:ICE_QUEUE_ERROR
```

---

## 28. Complete normal order example

### ESP32 announces readiness

```text
DATA:{"type":"system","event":"ready"}
```

### Pi sends order

```text
{"command":"ORDER","order_id":"ORD-1042","pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000}],"ice":{"enabled":true}}
```

### ESP32 accepts order

```text
DATA:{"type":"response","command":"ORDER","status":"initialized","order_id":"ORD-1042","ice":true,"pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000}]}
```

### Pi starts order

```text
START
```

### ESP32 acknowledges

```text
LOG:ACK:START
```

### Important sequence events

```text
DATA:{"type":"system","event":"pump","pump":1,"action":"forward"}
DATA:{"type":"system","event":"pump","pump":1,"action":"stop"}
DATA:{"type":"system","event":"pump","pump":3,"action":"forward"}
DATA:{"type":"system","event":"pump","pump":3,"action":"stop"}
DATA:{"type":"system","event":"mixing","action":"started"}
DATA:{"type":"system","event":"mixing","action":"stopped"}
DATA:{"type":"system","event":"valve","action":"opened"}
```

Additional `LOG:` messages and optional line-priming events may appear between these events.

---

## 29. First order after lines were emptied

### Pi sends order

```text
{"command":"ORDER","order_id":"ORD-1002","pumps":[{"pump":2,"time_ms":3200}],"ice":{"enabled":false}}
```

### ESP32 initializes it

```text
DATA:{"type":"response","command":"ORDER","status":"initialized","order_id":"ORD-1002","ice":false,"pumps":[{"pump":2,"time_ms":3200}]}
```

### Pi sends

```text
START
```

### ESP32 automatically primes lines

```text
DATA:{"type":"system","event":"line_priming","action":"started"}
```

Then:

```text
DATA:{"type":"system","event":"line_priming","action":"finished"}
```

The order continues automatically. The Pi must not send a second `START`.

---

## 30. Cleaning example

### Pi sends

```text
CLEAN
```

### ESP32 sends

```text
DATA:{"type":"system","event":"cleaning","action":"started"}
LOG:ACK:CLEAN
```

Then:

```text
DATA:{"type":"system","event":"pump","pump":1,"action":"forward"}
DATA:{"type":"system","event":"pump","pump":1,"action":"stop"}
DATA:{"type":"system","event":"mixing","action":"started"}
DATA:{"type":"system","event":"mixing","action":"stopped"}
DATA:{"type":"system","event":"valve","action":"opened"}
DATA:{"type":"system","event":"cleaning","action":"finished"}
```

---

## 31. Shutdown reversal example

### Pi sends

```text
REVERSE_PUMPS
```

### ESP32 sends

```text
DATA:{"type":"system","event":"reverse_pumps","action":"started"}
LOG:ACK:REVERSE_PUMPS
```

After completion:

```text
DATA:{"type":"system","event":"reverse_pumps","action":"finished"}
```

The Pi may confirm:

```text
CHECK_LINE_STATE
```

Expected response:

```text
DATA:{"type":"response","command":"CHECK_LINE_STATE","primed":false,"state":"EMPTY"}
```

---

## 32. Recommended Pi parser

```python
import json


def process_esp32_line(line: str) -> None:
    line = line.strip()

    if not line:
        return

    if line.startswith("DATA:"):
        payload = line[5:]

        try:
            message = json.loads(payload)
        except json.JSONDecodeError:
            print("Invalid DATA JSON:", payload)
            return

        handle_data_message(message)
        return

    if line.startswith("LOG:"):
        handle_log_message(line[4:])
        return

    print("Unknown ESP32 line:", line)
```

---

## 33. Important limitations

- There is no dedicated `order finished` JSON event.
- `valve opened` is currently the closest final normal-order event.
- `order_id` is not included in later pump, mixing, or valve events.
- Ice progress is sent through `LOG:` lines, not `DATA:` JSON.
- There is no complete main-system status query.
- Sensor values are raw electrical readings.
- `STOP` is not a complete emergency-stop command.
- Responses do not include request IDs.

---

## 34. Source identity

This document was created from the current integrated firmware.

Firmware SHA-256:

```text
71deff84dacc78671f0efd0f219029cd9b1707fd5dc5e297a45de6930de08472
```
