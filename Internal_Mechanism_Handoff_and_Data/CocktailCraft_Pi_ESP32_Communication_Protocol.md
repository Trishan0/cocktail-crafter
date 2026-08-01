# CocktailCraft — Raspberry Pi ↔ ESP32-S3 Communication Protocol

> Scope: only commands sent from the Raspberry Pi to the ESP32-S3 and messages sent from the ESP32-S3 back to the Raspberry Pi.

> **Deployed completion profile:** the Pi backend now targets
> `CocktailCraft_Firmware/CocktailCraft_Firmware.ino`.  Its common `ORDER`,
> `START`, sensor-query and `CLEAN` grammar is the same as this handoff, but
> it additionally emits the final `drink/ready` event documented below.  The
> older `arduino-code/CocktailCraft_ESP32S3_Complete_Firmware.ino` stops at
> `valve/opened` and must not be flashed with this Pi release unless a legacy
> completion handler is restored.

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

### Raspberry Pi bottle-inventory policy

This is application logic on the Pi; it does not add anything to the ESP32
wire protocol. Admin staff enter the starting/current volume for each installed
bottle in **Admin → Pumps**. Before sending `ORDER`, the Pi checks only the
pumps used by that recipe and requires both:

1. the corresponding raw `CHECK_LEVELS` value must match the configured
   “above the fixed sensor line” polarity; and
2. the tracked bottle volume must be at least the recipe amount plus a 15 ml
   safety reserve.

For example, a 50 ml pump request needs at least 65 ml tracked. If either check
fails, the Pi returns an ingredient-specific error to the customer UI and sends
no `ORDER`. If both pass, the Pi atomically deducts only the requested 50 ml,
leaving the reserve untouched. The deduction is restored if the Pi cannot save
or send the order. Updated bottle estimates are pushed to open Admin and kiosk
screens over SSE.

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

### Raspberry Pi glass-capacity policy

The ESP32 protocol remains unchanged: it reports only these two raw sensor
values and receives the normal `ORDER` JSON followed by `START`. The Raspberry
Pi application classifies the installed sensor pattern and makes the capacity
decision before it sends `START`:

- `upper=1, lower=1`: no glass
- `upper=1, lower=0`: small glass
- `upper=0, lower=0`: large glass
- `upper=0, lower=1`: inconsistent reading / sensor error

For each order, the Pi calculates the total liquid volume from the recipe. It
compares that volume with the Admin Hardware setting `small_glass_max_ml`
(initial default: 170 ml). If a small glass is detected for an order above that
safe capacity, the Pi stays in `waiting_glass`, prompts the user to replace the
glass, and does **not** send `START`. A large glass or a sufficiently small
order may proceed. `total_volume_ml` is Pi-side order metadata; it is not an
`ORDER` JSON field in this firmware protocol.

The same raw reading has a second, separate use **after** the drink completes.
After receiving the matching `drink/ready` event, the Pi shows the customer
the ready screen and polls `CHECK_IR` every 0.75 seconds. It does not send
`CLEAN` while a small or large glass is still detected. When it receives
`upper=1, lower=1` (no glass), it sends `CLEAN` and changes the UI to cleaning.

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

This is a progress event, not the customer completion signal. In the deployed
firmware, a Pump-6 dispense and/or the parallel ice task can still be pending
after the valve opens.

### Final drink-ready event

Only after the full order has completed, the firmware sends the order-correlated
event:

```text
DATA:{"type":"system","event":"drink","action":"ready","order_id":"ORD-1042"}
```

The Pi verifies the `order_id` against the loaded order, marks that order done,
shows **Your drink is ready**, and begins the post-drink `CHECK_IR` polling
described in section 13. It is this event—not `valve/opened`—that confirms the
drink is complete.

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
DATA:{"type":"system","event":"drink","action":"ready","order_id":"ORD-1042"}
```

Additional `LOG:` messages, optional line-priming events, and Pump-6/ice work
may appear before the final `drink/ready` event. After it, the Pi repeatedly
sends `CHECK_IR`; when the response is `upper=1,lower=1`, it sends `CLEAN`.
The `cleaning/finished` event then returns the kiosk to its welcome screen.

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

- `drink/ready` is the deployed firmware's dedicated final order event and
  includes an `order_id`; earlier pump, mixing and valve events do not.
- The Pi, rather than the ESP32, owns the customer hand-off: it must observe
  a no-glass `CHECK_IR` response before it sends `CLEAN`.
- `order_id` is not included in later pump, mixing, or valve events.
- Ice progress is sent through `LOG:` lines, not `DATA:` JSON.
- There is no complete main-system status query.
- Sensor values are raw electrical readings.
- `STOP` is not a complete emergency-stop command.
- Responses do not include request IDs.

---

## 34. Source identity

This handoff originated from the integrated base firmware. The deployed
post-drink-completion profile is verified against
`CocktailCraft_Firmware/CocktailCraft_Firmware.ino`.

Firmware SHA-256:

```text
9c4f7d80fb26143c24de83d59380ae1b69435928eee8517e0f894a90da90e2f7
```
