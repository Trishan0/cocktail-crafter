# CocktailCraft Internal Mechanism — Complete Technical Handoff

> **Purpose:** This document gives another engineer or LLM enough context to understand, maintain, debug, and extend the current CocktailCraft internal-mechanism firmware without reconstructing the project from old conversations.
>
> **Send this Markdown file together with the complete firmware file:**  
> `CocktailCraft_ESP32S3_Complete_Firmware.ino`
>
> **Current firmware is authoritative.** When this document and the code appear to disagree, inspect the code and ask before changing behavior. Do not silently merge older versions of the project.

---

## 1. Snapshot and source of truth

- Project: **CocktailCraft automated cocktail dispenser**
- Controller documented here: **ESP32-S3 internal mechanism controller**
- Firmware snapshot date: **2026-07-24**
- Original source filename: `7___Full_Internal_Mechanism_WITH_LIGHTS_AND_PARALLEL_ICE(1)(1).ino`
- Handoff firmware filename: `CocktailCraft_ESP32S3_Complete_Firmware.ino`
- Source size: **58,607 bytes**
- Source lines: **2,229**
- SHA-256: `71deff84dacc78671f0efd0f219029cd9b1707fd5dc5e297a45de6930de08472`

This is the current integrated firmware containing:

- Raspberry Pi order JSON parsing
- delayed `START` execution
- six-pump dispensing
- automatic feed-line priming
- pump reversal for shutdown
- cleaning sequence
- pinch-valve control with INA219 current sensing
- six-position stepper indexer with Hall sensors
- mixing oscillator with homing and recovery
- liquid-level and IR sensor queries
- NeoPixel status patterns
- parallel ice-dispenser task on the second ESP32-S3 core
- persistent valve, fluid-line, and ice endpoint states

Older firmware files are historical development versions and must not be treated as the active source.

---

## 2. One-paragraph system summary

CocktailCraft is an automated beverage/cocktail dispenser. A Raspberry Pi runs the higher-level application and sends a structured order to an ESP32-S3. The ESP32-S3 stores the requested pump durations, waits for a separate `START` command, optionally starts the ice dispenser in parallel, primes the liquid feed lines when required, closes a pinch valve, indexes a dispensing mechanism through six ingredient positions, activates the relevant pumps through a secondary controller, returns the indexer to position 1, mixes the drink using an oscillator, homes the mixer, and opens the pinch valve to release the finished drink. Maintenance commands support water cleaning, reversing all feed pumps, sensor queries, and manual ice-state correction.

---

## 3. High-level system architecture

```text
Raspberry Pi
    |
    | USB serial, 115200 baud
    | ORDER JSON + plain-text commands
    v
ESP32-S3 internal mechanism controller
    |
    |-- Main Arduino loop / main mechanism, normally core 1
    |     |-- Pinch valve and INA219 current sensing
    |     |-- Six-position indexer
    |     |-- Mixing oscillator
    |     |-- Hall, level and IR sensors
    |     |-- NeoPixel status LED
    |     |-- Line priming and pump reversal state machines
    |
    |-- Dedicated FreeRTOS ice task, pinned to core 0
    |     |-- Ice lead-screw stepper
    |     |-- 26 s open, 1 s hold, 26 s close, 1 s vibration
    |
    | UART2, 9600 baud
    v
NodeMCU / pump controller
    |
    |-- Pump 1 through pump 6
    |-- Receives commands such as M1F, M1S and M1R
```

### Responsibilities

#### Raspberry Pi

The Pi is expected to:

- generate and send the `ORDER` JSON;
- wait for the ESP32 initialization response;
- send `START`;
- listen for `DATA:` JSON events and `LOG:` diagnostics;
- request sensor states as needed;
- send `REVERSE_PUMPS` during controlled machine shutdown;
- optionally send `CLEAN` for the maintenance cleaning cycle.

#### ESP32-S3

The ESP32-S3:

- validates and stores one pending order;
- owns the mechanical sequence and safety interlocks implemented in firmware;
- controls the valve, indexer, mixer and ice stepper;
- relays pump commands to the pump controller;
- stores selected state in non-volatile storage;
- reports machine-readable events to the Pi.

#### NodeMCU / pump controller

The secondary controller receives compact pump commands from ESP32 UART2. This firmware does not implement the NodeMCU side; it assumes the controller responds correctly to:

```text
M1F through M6F   forward
M1R through M6R   reverse
M1S through M6S   stop
```

---

## 4. Current hardware inventory represented in the firmware

### Main controller

- ESP32-S3 DevKit-class board
- Dual-core FreeRTOS environment
- USB serial connection to Raspberry Pi
- UART2 connection to pump controller

### Motion

- Three TMC2208-style stepper drivers sharing one enable line:
  - oscillator stepper;
  - indexer stepper;
  - ice lead-screw stepper.
- Six-position indexer with one Hall sensor per ingredient position.
- Mixing oscillator with a home Hall sensor.
- Lead-screw ice mechanism with no limit switch or position sensor.

### Valve

- Pinch-valve DC motor
- TB6612 motor driver
- INA219 current sensor on a separate I2C bus
- Valve endpoint detection based on current and/or time

### Sensors

- MCP23017 I/O expander
- six index Hall sensors
- one oscillator Hall sensor
- six non-contact liquid-level sensors
- two direct ESP32 IR inputs

### Status

- one WS2812/NeoPixel status LED on GPIO 48

---

## 5. Required software libraries

The firmware includes:

```cpp
#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
```

Install or provide:

- **Adafruit MCP23X17**
- **AccelStepper**
- **Adafruit NeoPixel**
- **Adafruit INA219**
- **ArduinoJson 7**
- an ESP32 Arduino core supporting:
  - `Preferences`;
  - FreeRTOS task and queue APIs;
  - `ledcAttach(pin, frequency, resolution)`;
  - `ledcWrite(pin, duty)`.

The firmware was structurally reviewed, but this handoff does not claim that it has been compiled against every ESP32 Arduino core/library combination. Compile with the same board package used by the project whenever possible.

---

## 6. Complete pin and bus map

### UART

| Function | Pin / setting |
|---|---:|
| USB Serial to Raspberry Pi | `Serial`, 115200 baud |
| UART2 RX from pump controller | GPIO 18 |
| UART2 TX to pump controller | GPIO 17 |
| UART2 baud | 9600 |

### MCP23017 I2C bus

| Function | Value |
|---|---:|
| SDA | GPIO 8 |
| SCL | GPIO 9 |
| MCP23017 address | `0x20` |

### INA219 I2C bus

The INA219 uses a separate `TwoWire(1)` bus.

| Function | Pin |
|---|---:|
| SDA | GPIO 1 |
| SCL | GPIO 2 |

### Shared stepper enable

| Function | Pin / active level |
|---|---|
| Shared TMC2208 enable | GPIO 16, driven LOW to enable |

All three stepper drivers are enabled together by this line.

### Oscillator stepper

| Function | Pin / expander input |
|---|---:|
| STEP | GPIO 12 |
| DIR | GPIO 13 |
| Home Hall | MCP23017 PA0, Adafruit pin `0` |

### Indexer stepper

| Function | Pin / expander input |
|---|---:|
| STEP | GPIO 10 |
| DIR | GPIO 11 |
| Position 1 Hall | MCP PA1 |
| Position 2 Hall | MCP PA2 |
| Position 3 Hall | MCP PA3 |
| Position 4 Hall | MCP PA4 |
| Position 5 Hall | MCP PA5 |
| Position 6 Hall | MCP PA6 |

Hall inputs use `INPUT_PULLUP` and are considered detected when LOW.

### Ice lead-screw stepper

| Function | Pin |
|---|---:|
| STEP | GPIO 14 |
| DIR | GPIO 15 |

### Liquid-level sensors

Adafruit MCP23X17 numbering maps PB0..PB5 to pins 8..13.

| Logical sensor | MCP pin |
|---|---:|
| `ls1` | PB0 / pin 8 |
| `ls2` | PB1 / pin 9 |
| `ls3` | PB2 / pin 10 |
| `ls4` | PB3 / pin 11 |
| `ls5` | PB4 / pin 12 |
| `ls6` | PB5 / pin 13 |

They use `INPUT_PULLUP`. Responses are raw electrical values; the firmware does not interpret HIGH as “full” or “empty.”

### IR sensors

| Name | GPIO |
|---|---:|
| Upper IR | GPIO 38 |
| Lower IR | GPIO 39 |

Both use `INPUT_PULLUP`, and replies expose raw HIGH/LOW values.

### Pinch valve / TB6612

| Function | GPIO |
|---|---:|
| STBY | 4 |
| PWMA | 5 |
| AIN1 | 7 |
| AIN2 | 6 |

PWM settings:

- frequency: 20 kHz;
- resolution: 8 bit;
- motor duty value: 120.

### NeoPixel

| Function | GPIO |
|---|---:|
| WS2812 data | 48 |
| Number of pixels | 1 |
| Configured brightness | 70 |

---

## 7. Communication conventions

### Line framing

Commands must be sent as complete serial lines terminated by `\n` or `\r`.

The firmware maintains separate input buffers for:

- `Serial` — USB/Pi;
- `Serial2` — pump-controller UART.

Maximum buffered line length is 512 characters. A longer line is discarded and produces:

```text
LOG:ERROR:COMMAND_TOO_LONG
```

Legacy one-byte lowercase commands are handled immediately:

```text
s
x
```

### Output prefixes

All human-readable diagnostic output should begin with:

```text
LOG:
```

All machine-readable JSON output should begin with:

```text
DATA:
```

The Pi should parse only the content following `DATA:` as JSON. `LOG:` messages should be stored or displayed for diagnostics but not treated as protocol data.

---

## 8. ORDER JSON protocol

### Recommended request

The Pi sends one compact JSON object:

```json
{"command":"ORDER","order_id":"ORD-1042","pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000}],"ice":{"enabled":true}}
```

### Fields

| Field | Type | Meaning |
|---|---|---|
| `command` | string | Must be exactly `ORDER` |
| `order_id` | non-empty string | Pi-side identifier |
| `pumps` | non-empty array | Requested pump operations |
| `pump` | integer 1–6 | Pump number |
| `time_ms` | integer 1–60000 | Forward run time |
| `ice.enabled` | boolean | Whether to start the parallel ice cycle |

### Parsing behavior

- JSON is detected before uppercasing text commands.
- The ESP32 only accepts an order when:
  - the main state is `IDLE`;
  - the ice mechanism is not busy.
- A new order is parsed into temporary arrays first.
- Existing order data is replaced only after the new JSON passes validation.
- Pumps omitted from the JSON receive a duration of zero and are skipped.
- Duplicate pump entries are rejected.
- `time_ms` must be greater than zero and no more than 60,000 ms.
- At least one pump entry is required.
- If ice is enabled:
  - the ice task must exist;
  - saved ice position must be `CLOSED`.

### Successful response

Example:

```text
DATA:{"type":"response","command":"ORDER","status":"initialized","order_id":"ORD-1042","ice":true,"pumps":[{"pump":1,"time_ms":3333},{"pump":3,"time_ms":5000}]}
```

The order is now loaded but does **not** begin until `START` arrives.

### Rejection response

General form:

```text
DATA:{"type":"response","command":"ORDER","status":"rejected","reason":"<reason>"}
```

Implemented rejection reasons:

- `busy`
- `invalid_json`
- `invalid_command`
- `missing_order_id`
- `ice_task_unavailable`
- `ice_position_not_closed`
- `missing_pumps`
- `invalid_pump_number`
- `invalid_pump_time`
- `duplicate_pump`

---

## 9. Plain-text commands

| Command | Alias | Function |
|---|---|---|
| `START` | `S`, lowercase `s` | Start the loaded order |
| `CLEAN` | none | Run water cleaning sequence |
| `STOP` | `X`, lowercase `x` | Request mixer stop and/or stop ice |
| `ICE` | none | Run standalone ice cycle |
| `ICE_STATUS` | none | Return ice saved position/runtime state |
| `ICE_SET_OPEN` | none | Manually save ice position as OPEN |
| `ICE_SET_CLOSED` | none | Manually save ice position as CLOSED |
| `CHECK_LEVELS` | none | Return six raw level inputs |
| `CHECK_IR` | none | Return two raw IR inputs |
| `CHECK_LINE_STATE` | none | Return persistent primed/empty feed-line state |
| `REVERSE_PUMPS` | none | Reverse pumps 1–6 sequentially |

Do not add a second alias named `REVERSE` unless the user explicitly changes the requirement. The chosen command is **`REVERSE_PUMPS` only**.

Unknown commands return:

```text
LOG:ERROR:UNKNOWN_COMMAND
```

---

## 10. Machine-readable DATA events

### System ready

Sent once at the end of successful setup:

```text
DATA:{"type":"system","event":"ready"}
```

### Normal pump events

Main order pump actions and the cleaning pump use:

```text
DATA:{"type":"system","event":"pump","pump":1,"action":"forward"}
DATA:{"type":"system","event":"pump","pump":1,"action":"stop"}
```

### Mixing

```text
DATA:{"type":"system","event":"mixing","action":"started"}
DATA:{"type":"system","event":"mixing","action":"stopped"}
```

### Valve

Only successful opening is emitted:

```text
DATA:{"type":"system","event":"valve","action":"opened"}
```

### Cleaning

```text
DATA:{"type":"system","event":"cleaning","action":"started"}
DATA:{"type":"system","event":"cleaning","action":"finished"}
```

### Feed-line priming

Only overall sequence events are JSON:

```text
DATA:{"type":"system","event":"line_priming","action":"started"}
DATA:{"type":"system","event":"line_priming","action":"finished"}
```

Individual priming pumps produce logs only.

### Reverse pumps

Only overall sequence events are JSON:

```text
DATA:{"type":"system","event":"reverse_pumps","action":"started"}
DATA:{"type":"system","event":"reverse_pumps","action":"finished"}
```

Individual reversing pumps produce logs only.

### Sensor responses

```text
DATA:{"type":"response","command":"CHECK_LEVELS","ls1":1,"ls2":0,"ls3":1,"ls4":1,"ls5":0,"ls6":1}
```

```text
DATA:{"type":"response","command":"CHECK_IR","upper":0,"lower":1}
```

```text
DATA:{"type":"response","command":"CHECK_LINE_STATE","primed":true,"state":"PRIMED"}
```

Ice status currently uses `LOG:` rather than `DATA:`:

```text
LOG:ICE_POSITION:CLOSED,STATE:IDLE,BUSY:NO
```

---

## 11. Pump UART protocol

The ESP32 sends one command per line through `Serial2`.

```text
M<n>F  pump n forward
M<n>R  pump n reverse
M<n>S  pump n stop
```

Examples:

```text
M1F
M1S
M6R
M6S
```

Every transmitted pump command is logged:

```text
LOG:TX2: M1F
```

### JSON suppression rules

`sendCmd(cmd, sendPumpJson)` controls whether a pump action also creates a Pi-facing pump event.

- Main order: JSON enabled.
- CLEAN pump 1: JSON enabled.
- Line priming: JSON disabled.
- Reverse-pump maintenance: JSON disabled.

This is intentional. Do not add per-pump JSON for priming or reversal unless explicitly requested.

---

## 12. Main mechanism state machine

```cpp
enum class SystemState
{
    IDLE,
    VALVE_CLOSING,
    INDEX_SEARCH,
    INDEX_WAIT,
    INDEX_POST_STOP,
    OSCILLATING,
    HOMING,
    RECOVERY_NEGATIVE,
    RECOVERY_POSITIVE,
    VALVE_OPEN_DELAY,
    VALVE_OPENING,
    REVERSE_PUMPS,
    PRIME_PUMPS
};
```

The main `loop()` always calls:

```cpp
stepperOsc.run();
stepperIdx.run();
handleIceEvents();
handleSerialCommands();
updateStatusLed();
```

It then invokes one non-blocking state update based on `currentState`.

### Run modes

```cpp
enum class RunMode
{
    NONE,
    ORDER,
    CLEANING
};
```

`RunMode` modifies behavior inside shared states instead of duplicating the entire machine sequence.

- `ORDER` uses parsed pump timings.
- `CLEANING` uses only pump 1 for 5 seconds.
- `NONE` means no active production/cleaning run.

---

## 13. Complete normal-order flow

### Stage 1 — Load order

Pi sends the `ORDER` JSON. ESP32 validates and stores:

- `orderLoaded`
- `loadedOrderId`
- `orderIceEnabled`
- `indexWaitTimes[6]`

### Stage 2 — Start

Pi sends:

```text
START
```

Requirements:

- main mechanism must be idle;
- ice must not be busy;
- an order must be loaded.

If no order is loaded:

```text
LOG:NO_ORDER_LOADED
```

If accepted:

```text
LOG:ACK:START
```

### Stage 3 — Optional ice starts in parallel

If `ice.enabled` is true, the ice request is queued **before** line priming or valve closing. The ice task and main mechanism then run concurrently.

### Stage 4 — Automatic line priming

The persistent variable `fluidLinesPrimed` is checked.

If false, the firmware runs:

```text
Pump 1 forward 1400 ms -> stop
Pump 2 forward 1400 ms -> stop
...
Pump 6 forward 1400 ms -> stop
```

After pump 6:

- `fluidLinesPrimed` is saved as `true`;
- priming-finished JSON is sent;
- the order automatically continues to valve closing.

If already true, this stage is skipped.

### Stage 5 — Pinch valve closes

If saved valve state is already `CLOSED`, physical closing is skipped.

Otherwise:

- save valve state as `CLOSING`;
- drive the valve in the closing direction;
- ignore current for the first 500 ms;
- sample INA219 every 50 ms;
- stop at 200 mA;
- save state as `CLOSED`.

There is currently no explicit maximum closing timeout.

### Stage 6 — Find position 1

The special first-index search:

1. searches clockwise for at most 408 commanded steps;
2. if Hall 1 is not found, reverses and searches counterclockwise over a very large target;
3. when Hall 1 is found:
   - stop the indexer;
   - reset indexer current position to zero;
   - continue dispensing.

### Stage 7 — Dispense across positions

The indexer uses Hall sensors PA1..PA6.

At each position:

- if pump time is zero:
  - log `SKIPPED`;
  - move immediately toward the next position;
- otherwise:
  - send `M<n>F`;
  - wait for configured `time_ms`;
  - send `M<n>S`;
  - wait 3 seconds;
  - search for the next position.

After position 6, the indexer searches in reverse until position 1 is found.

### Stage 8 — Mixing

The oscillator:

- uses target endpoints `+800` and `-800`;
- performs 10 legs = 5 out-and-back loops;
- emits mixing started/stopped JSON;
- begins homing after the loop target or a stop request.

### Stage 9 — Homing and recovery

Primary homing:

- command oscillator to position 0;
- stop as soon as the Hall sensor is detected.

If the Hall sensor is not found at target 0:

1. search to `-400`;
2. then search to `+400`;
3. if still not detected:
   - log fatal homing failure;
   - show a timed red fault overlay;
   - continue to valve opening rather than permanently halt.

On success:

- stop oscillator;
- set current position to zero;
- show a green double-flash;
- wait 1 second before opening the valve.

### Stage 10 — Valve opens

Opening stops at whichever comes first:

- current reaches 150 mA after the startup-ignore period;
- elapsed time reaches 1800 ms.

On success:

- stop motor;
- save valve state `OPEN`;
- send valve-opened JSON;
- clear the consumed order;
- return main system to `IDLE`.

After a completed order:

- `orderLoaded = false`;
- `loadedOrderId` is cleared;
- a new `ORDER` JSON is required before another `START`.

---

## 14. Cleaning sequence

Command:

```text
CLEAN
```

Requirements:

- main state is idle;
- ice is not busy.

Cleaning does not require an order.

Sequence:

```text
Save RunMode = CLEANING
Send cleaning started
Close valve
Find position 1
Run pump 1 forward for 5000 ms
Stop pump 1
Go directly to mixing
Home oscillator
Open valve
Send cleaning finished
Return to idle
```

Important behavior:

- pumps 2–6 are not visited;
- the cleaning pump generates normal pump forward/stop JSON;
- cleaning does not use ice;
- a previously loaded customer order is deliberately preserved;
- cleaning does not modify `fluidLinesPrimed`.

---

## 15. Feed-line priming state

Persistent variable:

```cpp
bool fluidLinesPrimed;
```

Meaning:

- `false` / `EMPTY`: feed tubes are assumed empty after a completed reversal;
- `true` / `PRIMED`: all six lines have been pumped forward toward the dispenser.

NVS:

- namespace: `fluidLines`
- key: `primed`
- default: `false`

It becomes true only after all six 1400 ms priming operations finish.

It becomes false only after all six reverse operations finish.

### Power-loss semantics

- interruption during priming leaves the stored value false;
- next `START` primes all six lines again;
- interruption during reversal leaves the stored value true;
- only successful pump 6 reversal marks the system empty.

This is intentional and avoids falsely claiming completion.

---

## 16. Reverse-pump shutdown sequence

Command:

```text
REVERSE_PUMPS
```

Requirements:

- main state is idle;
- ice is not busy.

Sequence:

```text
Pump 1 reverse 4000 ms -> stop
Pump 2 reverse 4000 ms -> stop
...
Pump 6 reverse 4000 ms -> stop
```

At completion:

- save `fluidLinesPrimed = false`;
- send reverse-finished JSON;
- return to idle.

Individual reverse commands are `LOG:` only. Do not emit individual pump JSON for this sequence.

---

## 17. Parallel ice dispenser

### Physical concept

The ice mechanism is a lead screw driven by a stepper motor.

- initial/front position is treated as `CLOSED`;
- CW movement for 26 seconds moves backward to the open position;
- it remains open for 1 second;
- CCW movement for 26 seconds returns to the front/closed position;
- it vibrates for 1 second to shake/release remaining ice.

There are no limit switches, Hall sensors, encoders, or other physical position sensors.

### Dedicated task

The ice mechanism runs in a FreeRTOS task:

- pinned to core 0;
- priority 1;
- stack size 4096;
- main Arduino mechanism normally runs on core 1.

Queues:

- command queue length 2;
- event queue length 12.

Commands into the task:

```cpp
START_CYCLE
STOP
```

Runtime states:

```cpp
IDLE
OPENING
HOLDING_OPEN
CLOSING
VIBRATING
```

These runtime states are not persistent endpoint positions.

### Persistent ice position

There is exactly one persistent endpoint variable with two states:

```cpp
enum class IcePosition : uint8_t
{
    CLOSED = 0,
    OPEN = 1
};
```

NVS:

- namespace: `icePosition`
- key: `state`
- default: `CLOSED`

The firmware does **not** save step counts or continuously track movement in NVS.

The AccelStepper `currentPosition()` value is only a volatile internal counter used while generating a distant motion target. It is not treated as a persistent physical-position estimate.

### Ice cycle

```text
Require saved position CLOSED
Queue STARTED
CW/open for 26000 ms
Immediate stop
Save OPEN
Hold for 1000 ms
CCW/close for 26000 ms
Immediate stop
Save CLOSED
Vibrate for 1000 ms
Return ice task to IDLE
```

Vibration uses direct step pulses:

- 50 microseconds HIGH;
- 50 microseconds LOW;
- direction switches after every 1000 completed pulses;
- vibration lasts approximately 1 second.

After vibration, `stepperIce.setCurrentPosition(0)` resets the volatile library counter.

### Ice commands

```text
ICE
ICE_STATUS
ICE_SET_OPEN
ICE_SET_CLOSED
```

`ICE_SET_OPEN` and `ICE_SET_CLOSED` only change the saved software state. They do not move the motor and therefore produce a warning.

### Intentional limitation

The two-state model cannot represent a partial position after power loss or emergency stop during the 26-second motion.

Examples:

- power fails halfway through opening: saved state remains `CLOSED`;
- power fails halfway through closing: saved state remains `OPEN`.

This risk was explicitly accepted in favor of the requested simple two-state model. Do not introduce continuous step tracking without user approval.

---

## 18. Pinch-valve persistent state

```cpp
enum class ValveSavedState : uint8_t
{
    UNKNOWN = 0,
    OPEN,
    CLOSED,
    CLOSING,
    OPENING
};
```

NVS:

- namespace: `pinchValve`
- key: `state`
- default: `UNKNOWN`

Unlike the ice endpoint state, the valve saves transitional states before movement.

Startup behavior:

- an exact saved `CLOSED` causes closing to be skipped;
- `UNKNOWN`, `OPEN`, `OPENING` or `CLOSING` leads the next run to attempt closing.

This state is a software record and still depends on motor/current behavior being physically correct.

---

## 19. Ice and main-mechanism concurrency

For an ice-enabled order, `START` does this in order:

1. queue ice cycle;
2. set `RunMode::ORDER`;
3. either begin line priming or valve closing;
4. return `LOG:ACK:START`.

Consequences:

- ice can begin while all six lines are being primed;
- ice can run while the valve/indexer/pumps/mixer are active;
- the main sequence does not wait for the ice cycle to finish before opening the drink valve;
- order parsing and CLEAN are rejected while ice is busy;
- `REVERSE_PUMPS` is rejected while ice is busy.

The timing relationship must be validated mechanically for the final product.

---

## 20. STOP behavior

Command:

```text
STOP
```

Current implementation only:

- requests the oscillator to finish its current leg and then home, if in `OSCILLATING`;
- sends an immediate stop request to the ice task, if ice is active.

It does **not** currently stop:

- valve opening/closing;
- indexer search;
- an active dispensing pump;
- line priming;
- reverse-pump sequence.

Therefore, `STOP` is not a complete emergency-stop implementation.

Do not describe it as a global emergency stop. A physical hardware emergency stop and/or expanded firmware stop handling is still recommended.

---

## 21. Sensor query behavior

### `CHECK_LEVELS`

Returns raw states for PB0..PB5.

```text
1 = HIGH
0 = LOW
```

No conversion to `FULL`, `LOW`, `PRESENT`, or `ABSENT` is done because the installed sensor polarity/physical interpretation must be confirmed at system level.

### `CHECK_IR`

Returns raw upper/lower GPIO values.

Again, no semantic glass-position interpretation is applied in the firmware.

### `CHECK_LINE_STATE`

Returns the software/NVS feed-line priming state, not a physical sensor measurement.

---

## 22. NeoPixel status system

The LED is non-blocking and derived from the main state machine.

| Main state / condition | Pattern |
|---|---|
| Idle, no order | dim blue double heartbeat |
| Idle, order loaded | cyan breathing |
| Valve moving/delay | yellow breathing |
| Index search/post-stop | purple blinking |
| Pump dispensing | green breathing |
| Mixing | white breathing |
| Homing/recovery | blue/teal fast blinking |
| Feed-line priming | cyan fast blinking |
| Reverse pumps | magenta alternating |
| Cleaning | orange variants of active-stage colors |
| Homing success | temporary green double flash |
| Fault | red fast flash |

The LED is based on `currentState` and `RunMode`. There is no dedicated ice-only LED state. If ice runs while the main system is idle, the LED may still show the normal idle/order-loaded pattern.

Startup failures for MCP23017 or INA219 create a continuous red fault pattern and halt setup in a loop.

---

## 23. Important constants and calibration values

### Serial and I2C

| Constant | Value |
|---|---:|
| USB Serial | 115200 baud |
| UART2 | 9600 baud |
| MCP address | `0x20` |

### Valve

| Constant | Value |
|---|---:|
| PWM frequency | 20,000 Hz |
| PWM resolution | 8 bit |
| duty | 120 |
| closing current threshold | 200 mA |
| opening current threshold | 150 mA |
| opening maximum time | 1800 ms |
| startup current ignore | 500 ms |
| current sample interval | 50 ms |
| home-to-open delay | 1000 ms |

### Indexer

| Constant | Value |
|---|---:|
| search distance | 100,000 steps |
| search speed | 400 steps/s |
| acceleration | 5000 steps/s² |
| nominal spacing | 204 steps |
| initial clockwise limit | 408 steps |
| post-pump delay | 3000 ms |

### Oscillator

| Constant | Value |
|---|---:|
| half range | 800 steps |
| recovery offset | 400 steps |
| max speed | 20,000 steps/s |
| acceleration | 10,000 steps/s² |
| target loops | 5 |
| target legs | 10 |

### Pumps

| Purpose | Time |
|---|---:|
| maximum order pump time | 60,000 ms |
| cleaning pump 1 | 5000 ms |
| feed-line priming per pump | 1400 ms |
| reversing per pump | 4000 ms |

### Ice

| Constant | Value |
|---|---:|
| max speed | 10,000 steps/s |
| acceleration | 15,000 steps/s² |
| open travel time | 26,000 ms |
| hold-open time | 1000 ms |
| close travel time | 26,000 ms |
| vibration duration | 1000 ms |
| vibration half-pulse | 50 µs |
| direction-switch burst | 1000 steps |

All motion/timing constants are empirical project values. Changes must be tested on the actual mechanism.

---

## 24. Error and recovery behavior

### MCP23017 missing

Firmware logs:

```text
LOG:ERROR: MCP23017 not found!
```

Then remains in a fault loop.

### INA219 missing

Firmware logs:

```text
LOG:ERROR: INA219 not found!
```

Then remains in a fault loop.

### Ice queues/task creation fail

Ice functionality becomes unavailable. An ice-enabled order is rejected.

### Oscillator home not found

The firmware searches:

```text
target 0 -> -400 -> +400
```

If still not found, it:

- logs failure;
- shows red fault overlay;
- proceeds to valve opening.

### Index Hall not found

The indexer uses very large search targets. There is no complete timeout/fault transition for every missing-Hall case. If a target is exhausted without detection, the state can remain stuck in `INDEX_SEARCH`.

### Valve close current not reached

Closing has no maximum timeout. The system can remain in `VALVE_CLOSING` if the threshold is never reached.

These are important future safety improvements.

---

## 25. Known limitations and risks

1. **Ice has no physical homing sensor.**  
   Its saved OPEN/CLOSED state can disagree with the true physical position after power loss, manual movement, stall, or skipped steps.

2. **Timed ice travel is open loop.**  
   The mechanism assumes that 26 seconds at the configured motion settings equals full travel.

3. **Ice state is intentionally only two states.**  
   Do not add step persistence or transitional NVS states unless requested.

4. **Valve closing has no timeout.**

5. **Indexer searches have incomplete timeout/fault handling.**

6. **STOP is not a global stop.**

7. **The shared stepper enable remains LOW.**  
   All three drivers remain enabled/energized unless external hardware handles them differently.

8. **Pump controller acknowledgements are not checked.**  
   The ESP32 assumes UART commands are acted upon.

9. **Pump timing is based on command transmission, not flow measurement.**

10. **Level and IR values are raw.**  
    Higher-level logic must map them to physical meaning.

11. **No order-completed JSON exists.**  
    Completion is inferred from later events, especially valve opened and order state clearing. Add a dedicated order completion event only if the Pi requires it.

12. **Order ID is not included in subsequent system events.**  
    Only the initialization response includes `order_id`.

13. **No ice DATA events are currently emitted.**  
    Ice activity is reported through `LOG:` events.

14. **Main sequence does not wait for ice completion.**

15. **Cleaning preserves a loaded order.**  
    This is intentional but must be understood by the Pi application.

---

## 26. Intentional design decisions that future work must preserve

Unless the user explicitly changes them:

- Use the complete `.ino` as the source of truth.
- Return full updated code files rather than isolated fragments when asked to implement.
- Maintain non-blocking state-machine behavior.
- Keep `LOG:` for diagnostics and `DATA:` for machine-readable JSON.
- Parse JSON before uppercasing plain-text commands.
- `ORDER` only initializes; `START` begins the sequence.
- Omitted pumps are zero and skipped.
- Automatically prime all six feed lines before the first order when saved state is empty.
- Mark lines primed only after all six priming pumps finish.
- Mark lines empty only after all six reverse pumps finish.
- Use command name `REVERSE_PUMPS` only.
- Do not send per-pump JSON during priming or reversal.
- CLEAN uses pump 1 for exactly 5000 ms and then reuses normal mixing/homing/valve opening.
- CLEAN preserves a loaded customer order.
- Ice runs in parallel on core 0.
- Ice uses one persistent two-state variable: OPEN or CLOSED.
- Do not continuously save ice steps.
- Save ice OPEN only after the 26-second opening completes.
- Save ice CLOSED only after the 26-second closing completes.
- Ice holds open for 1 second and vibrates for 1 second after closing.
- Ice is allowed only when its saved state is CLOSED.
- Manual ice-state commands do not move the mechanism.
- Normal order and cleaning pump actions can send individual pump JSON.
- Raw level and IR readings remain raw unless physical polarity is confirmed.

---

## 27. Recommended testing checklist

### Build and startup

- [ ] Firmware compiles for the exact ESP32-S3 board.
- [ ] ArduinoJson version is compatible.
- [ ] MCP23017 initializes at `0x20`.
- [ ] INA219 initializes on the second I2C bus.
- [ ] status LED shows idle heartbeat.
- [ ] `DATA:...ready` is received by Pi.
- [ ] ice task reports core 0.
- [ ] main Arduino task reports its core.

### Communications

- [ ] ORDER JSON fits in one line and ends with newline.
- [ ] valid order returns `initialized`.
- [ ] malformed JSON is rejected.
- [ ] duplicate pump is rejected.
- [ ] invalid pump/time is rejected.
- [ ] `START` without order is rejected.
- [ ] UART2 receives exact M-command lines.

### Priming and reversal

- [ ] first order after erased NVS primes all six lines.
- [ ] later order skips priming.
- [ ] `CHECK_LINE_STATE` reports PRIMED.
- [ ] `REVERSE_PUMPS` reverses each pump for 4 seconds.
- [ ] no per-pump reverse JSON is emitted.
- [ ] final state becomes EMPTY.
- [ ] next order primes again.

### Normal order

- [ ] omitted pumps are skipped.
- [ ] requested pump durations are accurate.
- [ ] 3-second post-dispense delay occurs for active pumps.
- [ ] indexer returns to position 1.
- [ ] mixer performs five loops.
- [ ] home Hall is detected.
- [ ] valve opens and order becomes unloaded.

### Cleaning

- [ ] works without an order.
- [ ] uses only pump 1.
- [ ] pump 1 runs 5 seconds.
- [ ] mixing/homing/opening occur.
- [ ] loaded order remains available afterward.

### Ice

- [ ] starts in parallel when order has `ice.enabled=true`.
- [ ] CW direction physically opens.
- [ ] 26 seconds reaches intended rear position.
- [ ] one-second hold is sufficient.
- [ ] CCW direction physically closes.
- [ ] 26 seconds reaches intended front position.
- [ ] vibration lasts approximately one second.
- [ ] saved state returns to CLOSED.
- [ ] standalone `ICE` works.
- [ ] `ICE_STATUS` is accurate in normal completed cycles.
- [ ] manual correction commands work after physical verification.
- [ ] repeated full-load cycles do not drift or stall.

### Failure tests

- [ ] disconnect a Hall sensor and observe behavior safely.
- [ ] disconnect INA219 and confirm startup fault.
- [ ] prevent valve current from reaching threshold and test under supervision.
- [ ] interrupt ice power during opening/closing and verify recovery procedure.
- [ ] ensure physical emergency-stop hardware can cut motor power.

---

## 28. Troubleshooting map

### `LOG:NO_ORDER_LOADED`

Send a valid ORDER JSON first and wait for `status:"initialized"`.

### `LOG:BUSY`

The main mechanism or ice task is active. Query ice status and inspect current logs.

### ORDER rejected with `ice_position_not_closed`

Physically verify the ice carriage. If it is at the front/closed position, send:

```text
ICE_SET_CLOSED
```

Do not use the command merely to bypass the check without physical verification.

### Order never leaves valve closing

Check:

- INA219 readings;
- valve motor direction;
- current threshold;
- TB6612 wiring;
- mechanical pinch force.

### Indexer remains searching

Check:

- relevant Hall sensor polarity;
- MCP pin mapping;
- magnet alignment;
- stepper direction;
- missing search timeout limitation.

### Mixer reports home failure

Check:

- oscillator Hall sensor PA0;
- magnet position;
- whether 0 and ±400 search range cover the physical home;
- oscillator step loss.

### Pumps do not run

Check:

- Serial2 TX/RX crossover;
- common ground;
- 9600 baud;
- NodeMCU parser;
- exact uppercase M-command format.

### Ice moves in the wrong direction

The code assumes:

```text
positive AccelStepper target -> CW/open
negative target -> CCW/close
```

Reverse motor wiring or invert the intended direction in code only after testing.

---

## 29. Suggested improvement backlog

These are recommendations, not currently implemented requirements:

1. Add a true hardware emergency-stop path.
2. Expand STOP to halt all pump and mechanism states safely.
3. Add maximum valve-closing timeout.
4. Add indexer Hall-search timeouts and explicit fault state.
5. Add Pi-facing ice JSON events.
6. Add an order-completed event containing `order_id`.
7. Add order ID to all relevant system events.
8. Add pump-controller acknowledgements/timeouts.
9. Add an ice front limit switch or Hall sensor.
10. Add a dedicated fault latch and reset command.
11. Add watchdog-aware error handling for stalled tasks.
12. Decide whether CLEAN should be blocked when an order is loaded.
13. Decide whether main dispense completion should wait for ice completion.
14. Interpret raw liquid/IR sensor polarity after physical testing.
15. Review whether all stepper drivers must remain continuously enabled.

Do not implement these automatically just because they appear here.

---

## 30. How another LLM should work on this project

Use the following operating rules:

1. Read this file and the complete `.ino` before proposing changes.
2. Search the current code for the affected state and all call sites.
3. Preserve all unrelated features.
4. Avoid creating a second competing state machine for behavior that can be represented by `RunMode`.
5. Keep long actions non-blocking.
6. Keep ice-specific motor updates inside the ice task.
7. Use queues for communication between the main loop and ice task.
8. Do not print to USB serial from the ice task; queue an event and let the main loop print.
9. Do not change NVS namespaces or keys without a migration plan.
10. Do not emit individual reverse/prime pump JSON.
11. Validate JSON into temporary variables before replacing the loaded order.
12. Return a complete updated `.ino` file when implementation is requested.
13. State clearly when code was not compiled on real hardware.
14. Flag physical-safety risks honestly rather than guessing.
15. Treat empirical timings as hardware calibration values.

---

## 31. Ready-to-paste prompt for another LLM

```text
You are helping maintain the CocktailCraft automated cocktail dispenser.

Read the attached Markdown handoff and the complete firmware file before answering. The firmware is the current source of truth. Preserve all existing unrelated features.

The controller is an ESP32-S3. The main mechanism is a non-blocking state machine. A separate FreeRTOS task pinned to core 0 runs the ice lead-screw stepper. Raspberry Pi communication uses LOG: diagnostic lines and DATA: JSON lines. ORDER JSON initializes pump timings; START begins the order.

Important intentional requirements:
- REVERSE_PUMPS is the only reverse command name.
- Priming and reversal produce only overall JSON events, not per-pump JSON.
- CLEAN uses only pump 1 for 5000 ms, then normal mixing/homing/valve opening.
- Feed-line primed state is persistent and becomes false only after complete reversal.
- Ice has only one persistent two-state OPEN/CLOSED variable.
- Do not add continuous ice step tracking.
- Ice opens CW for 26 s, holds 1 s, closes CCW for 26 s, then vibrates 1 s.
- Return complete updated code files when implementing changes.

Before modifying code, explain which states/functions are affected and check for interactions with ORDER, CLEAN, line priming, reverse pumps, valve state, LED state, Serial/Serial2, and the parallel ice task.
```

---

## 32. File package to send

Send both:

1. `CocktailCraft_Internal_Mechanism_Complete_Handoff.md`
2. `CocktailCraft_ESP32S3_Complete_Firmware.ino`

The `.ino` copy in this bundle is byte-for-byte identical to the supplied current firmware. Its SHA-256 is:

```text
71deff84dacc78671f0efd0f219029cd9b1707fd5dc5e297a45de6930de08472
```

---

## 33. Final operational summary

```text
BOOT
  -> initialize NVS, sensors, steppers, LED, ice task and valve current sensor
  -> emit ready

ORDER JSON
  -> validate and store order
  -> confirm initialized

START
  -> optionally start ice in parallel
  -> prime lines if saved state is EMPTY
  -> close valve
  -> index and dispense selected pumps
  -> return indexer to position 1
  -> mix five loops
  -> home with recovery
  -> open valve
  -> clear order
  -> idle

CLEAN
  -> close valve
  -> find position 1
  -> pump water through pump 1 for 5 seconds
  -> mix
  -> home
  -> open valve
  -> preserve pending order
  -> idle

REVERSE_PUMPS
  -> reverse each pump for 4 seconds
  -> save feed lines EMPTY
  -> idle

ICE
  -> core-0 task opens 26 seconds
  -> hold 1 second
  -> closes 26 seconds
  -> vibrates 1 second
  -> saved endpoint CLOSED
```
