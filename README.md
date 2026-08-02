# CocktailCraft : Automated Cocktail Machine

CocktailCraft is a fully integrated automated cocktail-making system designed for social gatherings and private events. A customer selects a signature recipe or creates a custom drink from a touchscreen, and the machine handles ingredient validation, glass detection, timed liquid dispensing, mixing, optional ice, final pouring, syrup topping, completion feedback, and cleaning.

The project combines a touch-first web application, a Raspberry Pi backend, persistent recipe and inventory management, an ESP32-S3 real-time controller, a dedicated NodeMCU pump controller, custom electronics, and purpose-built mechanical systems.

> CocktailCraft focuses on making drink preparation accessible and repeatable. Supply the configured ingredients, power on the station, place a suitable glass, and select a drink from the touchscreen.

---

## System Overview

CocktailCraft is divided into four coordinated layers:

| Layer | Technology | Responsibility |
|---|---|---|
| Customer and staff interface | React, TypeScript, Vite, Tailwind CSS | Touchscreen ordering, custom drink composition, preparation status, drink-ready feedback, and administration |
| Raspberry Pi application | Python, Flask, REST API, Server-Sent Events | Recipe processing, validation, inventory, order history, hardware orchestration, and real-time UI updates |
| Main real-time controller | ESP32-S3, Arduino, FreeRTOS | Valve, indexer, mixer, sensors, line priming, cleaning, ice sequencing, persistent hardware state, and protocol events |
| Pump controller | NodeMCU-32S (ESP32) | Direct control of the six ingredient pumps from compact UART commands |

```text
┌───────────────────────────────────────────────────────────────────────┐
│                         7" Touchscreen UI                             │
│             React customer kiosk + staff administration              │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ REST API + Server-Sent Events
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         Raspberry Pi                                 │
│ Flask backend · SQLite database · recipe engine · inventory tracking │
│ order orchestration · serial controller · simulator · event stream   │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ JSON and commands over USB serial
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│                           ESP32-S3                                   │
│ valve · indexer · mixer · ice · Hall sensors · IR · level sensors    │
│ persistent states · cleaning · priming · completion coordination      │
└───────────────┬───────────────────────────────┬───────────────────────┘
                │ UART pump commands            │ STEP/DIR, I²C, GPIO
                ▼                               ▼
┌──────────────────────────┐       ┌────────────────────────────────────┐
│ NodeMCU pump controller  │       │ Custom electromechanical system    │
│ pumps 1–6                │       │ indexer · oscillator · pinch valve │
└──────────────────────────┘       │ ice dispenser · sensors · lighting │
                                   └────────────────────────────────────┘
```

---

## Tech Stack

### Frontend

![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![TanStack](https://img.shields.io/badge/TanStack-Router_%26_Query-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)

### Backend and Data

![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-REST_API-000000?style=for-the-badge&logo=flask&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Server-Sent Events](https://img.shields.io/badge/Server--Sent_Events-Realtime-5A29E4?style=for-the-badge)
![Raspberry Pi](https://img.shields.io/badge/Raspberry_Pi-Controller-A22846?style=for-the-badge&logo=raspberrypi&logoColor=white)

### Embedded Systems

![C++](https://img.shields.io/badge/C++-Firmware-00599C?style=for-the-badge&logo=cplusplus&logoColor=white)
![Arduino](https://img.shields.io/badge/Arduino-Framework-00878F?style=for-the-badge&logo=arduino&logoColor=white)
![ESP32-S3](https://img.shields.io/badge/ESP32--S3-Main_Controller-E7352C?style=for-the-badge&logo=espressif&logoColor=white)
![NodeMCU-32S](https://img.shields.io/badge/NodeMCU--32S-Pump_Controller-E7352C?style=for-the-badge&logo=espressif&logoColor=white)
![FreeRTOS](https://img.shields.io/badge/FreeRTOS-Parallel_Ice_Task-7A1FA2?style=for-the-badge)

### Hardware and Communication

![UART](https://img.shields.io/badge/UART-Pi_%E2%86%94_ESP32_%E2%86%94_NodeMCU-4B5563?style=for-the-badge)
![I²C](https://img.shields.io/badge/I%C2%B2C-Sensors_%26_IO_Expansion-4B5563?style=for-the-badge)
![JSON](https://img.shields.io/badge/JSON-Command_Protocol-000000?style=for-the-badge&logo=json&logoColor=white)
![Stepper Motors](https://img.shields.io/badge/Stepper_Motors-Indexer_%C2%B7_Mixer_%C2%B7_Ice-374151?style=for-the-badge)
![Custom Hardware](https://img.shields.io/badge/Custom_Hardware-Electronics_%26_Mechanics-374151?style=for-the-badge)

## What the System Can Do

### Customer experience

- Browse administrator-configured signature drinks.
- Build a custom drink from currently assigned and available ingredients.
- Add optional ice.
- Review the selected ingredients and total volume before ordering.
- Receive clear prompts for the required glass.
- Follow live machine progress without refreshing the page.
- See explicit preparation, ready, error, and cleaning states.
- Prevent ordering when the station is powered off, disconnected, busy, or lacks sufficient ingredients.

### Staff administration

The secured staff console provides dedicated sections for:

- Orders and historical order records
- Drink creation, editing, visibility, pricing, images, and menu ordering
- Ingredient management
- Pump assignment and calibration
- Tracked bottle volumes and orderable inventory
- Hardware status and manual maintenance controls
- Machine settings, including price visibility and glass capacity
- Live machine activity through the same real-time event stream used by the kiosk

### Embedded and mechanical operation

- Six independently controlled ingredient pumps
- Pumps 1–5 dispensed through a six-position indexed mechanism
- Pump 6 used as a direct-to-cup syrup line after the main pour
- Automatic line priming with persistent state
- Current-controlled motorized pinch valve
- Stepper-driven mixing oscillator with Hall-sensor homing and recovery
- Optional ice dispensing in parallel on the ESP32-S3's second core
- Glass detection using two IR sensors
- Six liquid-level inputs
- Persistent valve, line-priming, syrup-line, and ice endpoint states
- Non-blocking NeoPixel machine-status indication
- Cleaning, pump reversal, diagnostics, and manual service commands

---

## Complete Drink Flow

### 1. Menu and recipe selection

The touchscreen retrieves the current menu and pump availability from the Flask backend. The customer can choose:

- a saved signature recipe; or
- a custom combination of available ingredients.

Ice can be enabled per order.

### 2. Backend validation

Before an order reaches the hardware, the Raspberry Pi backend:

1. Confirms that the station is powered on and connected.
2. Verifies that the machine is in a state that can accept an order.
3. Resolves recipe quantities into pump numbers and calibrated run times.
4. Enforces per-ingredient and total-volume limits.
5. Checks raw liquid-level inputs.
6. Checks tracked bottle volume while preserving a safety reserve.
7. Validates the required glass capacity.
8. Atomically reserves inventory.
9. Stores an order snapshot in the database.

The saved snapshot preserves the recipe name, ingredient amounts, price, and exact pump commands used for that order.

### 3. Order initialization

The Pi sends an `ORDER` JSON message to the ESP32-S3:

```json
{
  "command": "ORDER",
  "order_id": "ORD-1042",
  "pumps": [
    { "pump": 1, "time_ms": 3200 },
    { "pump": 3, "time_ms": 4800 },
    { "pump": 6, "time_ms": 1400 }
  ],
  "ice": {
    "enabled": true
  }
}
```

The firmware validates the message and replies with a structured initialization response. Loading an order does not immediately start the mechanisms.

### 4. Glass verification and start

After successful initialization, the backend polls the ESP32 IR sensors. It sends `START` only after detecting a valid glass configuration for the requested drink volume.

This separates order creation from physical execution and prevents the machine from dispensing before a glass is ready.

### 5. Automatic preparation

When `START` is accepted:

1. The optional ice task is queued on ESP32-S3 core 0.
2. Main ingredient lines are primed when their saved state is empty.
3. The pinch valve closes.
4. The indexer locates position 1.
5. Pumps 1–5 are processed at their Hall-referenced positions.
6. Unused indexed pumps are skipped.
7. The indexer returns to position 1.
8. The oscillator mixes the drink.
9. The oscillator returns home, with a recovery sweep if required.
10. The pinch valve opens and pours the mixed drink into the cup.

### 6. Direct syrup topping

Pump 6 is physically located above the cup and is not connected to the indexer or mixing container.

When an order includes pump 6:

1. The main mixed drink is poured first.
2. The firmware waits for the configured post-valve delay.
3. Pump 6 runs directly into the cup for the requested order time.
4. Pump 6 stops.

The syrup line has its own persistent primed state and is never included in the normal indexed-line reversal process.

### 7. Ice and final completion

The ice dispenser runs independently from the main sequence:

```text
Open for 26 seconds
→ hold open
→ close for 26 seconds
→ vibrate
→ finish
```

The ESP32 uses a completion barrier so the final ready event is not sent too early:

- without pump 6, the main path completes after valve opening;
- with pump 6, the main path completes after pump 6 stops;
- when ice was requested, both the main path and ice task must finish.

Only then does the ESP32 send:

```text
DATA:{"type":"system","event":"drink","action":"ready","order_id":"ORD-1042"}
```

The backend records the successful completion and broadcasts it through Server-Sent Events. The customer UI then displays the drink-ready screen.

### 8. Glass removal and cleaning

After the finished drink is collected, the system can proceed through its cleaning lifecycle. The current firmware cleaning sequence:

1. closes the pinch valve;
2. locates index position 1;
3. runs the configured water pump;
4. stops the pump;
5. mixes the cleaning water;
6. homes the oscillator;
7. opens the valve to drain;
8. returns to idle.

Cleaning is treated as a separate machine process rather than part of the customer-ready event.

---

## Frontend

The frontend is a touch-oriented React application designed for the machine's 7-inch display.

### Technology

- React 19
- TypeScript
- Vite
- Tailwind CSS
- TanStack Router
- TanStack Query
- Radix UI primitives
- Lucide icons
- Zod validation

### Customer kiosk screens

The main kiosk flow includes:

```text
Welcome
→ Experience selection
→ Signature catalog or custom composition
→ Drink details
→ Review
→ Waiting for glass
→ Preparing
→ Drink ready
→ Cleaning
→ Cleaning complete
```

The frontend does not continuously poll the backend for progress. It subscribes to the Flask `/stream` endpoint and reacts to Server-Sent Events for:

- controller connection
- machine power
- glass state
- inventory changes
- preparation progress
- menu updates
- display settings
- completion
- cleaning
- faults

### Admin console

The staff interface includes:

```text
Orders
Drinks
Ingredients
Pumps
Hardware
Settings
```

It displays live machine state and progress while allowing authorized management of the data and hardware configuration that drive the customer experience.

---

## Backend

The Raspberry Pi backend is the bridge between the user-facing application and the real-time embedded controller.

### Responsibilities

- Serve CORS-enabled REST APIs
- Stream machine updates through SSE
- Resolve recipes into pump commands
- Convert millilitres into pump durations
- Validate machine state, glass capacity, level sensors, and inventory
- Reserve and restore liquid inventory safely
- Store recipes, ingredients, pumps, settings, events, and orders
- Preserve historical order snapshots
- Manage serial communication and reconnection
- Support physical hardware and software simulation
- Broadcast live inventory and menu changes
- Provide database backup tooling

### Hardware abstraction

The backend supports two controller implementations:

| Controller | Purpose |
|---|---|
| `SerialController` | Communicates with the physical ESP32-S3 over USB serial |
| `SimulatorController` | Reproduces the expected machine behavior without physical hardware |

A separate fake-ESP32 utility can exercise the real serial implementation through a virtual serial pair or TCP loopback.

---

## Database

The current repository uses SQLite on the Raspberry Pi.

The normalized schema contains:

| Table | Purpose |
|---|---|
| `ingredients` | All known liquids available to recipes |
| `pumps` | The six physical pump slots, assignments, flow rates, and tracked volume |
| `recipes` | Drink definitions, visibility, category, price, image, and display order |
| `recipe_ingredients` | Ingredient quantities used by each recipe |
| `orders` | Historical orders and immutable order-time snapshots |
| `settings` | Persistent machine and UI configuration |
| `events` | Structured operational event history |

SQLite is configured with foreign-key support and write-ahead logging. Order snapshots remain meaningful even if an editable recipe is later changed or deleted.

---

## ESP32-S3 Main Controller

The ESP32-S3 firmware is a non-blocking state-machine implementation.

### Controlled subsystems

- Pinch-valve DC motor through TB6612
- Valve current measurement through INA219
- Six-position indexer stepper
- Oscillator/mixer stepper
- Ice lead-screw stepper
- MCP23017 I/O expander
- Index and home Hall sensors
- Liquid-level sensors
- Upper and lower IR sensors
- WS2812 status LED
- UART connection to the pump controller

### Main states

The primary state machine includes:

```text
IDLE
VALVE_CLOSING
INDEX_SEARCH
INDEX_WAIT
INDEX_POST_STOP
OSCILLATING
HOMING
RECOVERY_NEGATIVE
RECOVERY_POSITIVE
VALVE_OPEN_DELAY
VALVE_OPENING
PRIME_PUMPS
REVERSE_PUMPS
PUMP6_AUTO_PRIMING
PUMP6_POST_VALVE_DELAY
PUMP6_ORDER_DISPENSING
PUMP6_MANUAL_PRIMING
PUMP6_MANUAL_RUNNING
```

### Persistent hardware state

ESP32 Preferences/NVS stores selected states that must survive restart:

- pinch-valve state;
- indexed feed-line primed state;
- pump-6 syrup-line primed state;
- ice endpoint state (`OPEN` or `CLOSED`).

The ice mechanism intentionally does not continuously write step position to flash.

### Parallel ice task

The ice mechanism has its own FreeRTOS task and command/event queues. This allows the main dispensing and mixing sequence to continue while ice is being prepared, while the final ready event still waits for both paths to finish.

---

## Pump Controller

The NodeMCU-32S, based on the ESP32 platform, receives compact UART commands from the ESP32-S3.

```text
M1F  → Pump 1 forward
M1R  → Pump 1 reverse
M1S  → Pump 1 stop
...
M6F  → Pump 6 forward
M6R  → Pump 6 reverse
M6S  → Pump 6 stop
```

The NodeMCU isolates pump switching from the larger ESP32 state machine and provides one dedicated control layer for all six pumps.

---

## Mechanical System

Most physical functions are implemented through custom-designed mechanisms and printed or fabricated parts.

### Indexed ingredient dispenser

Pumps 1–5 feed an indexed dispensing system. A stepper motor moves the outlet assembly between six Hall-referenced positions. The controller searches for each physical position rather than relying only on accumulated step counts.

### Oscillating mixer

The drink is collected in a mixing container and mechanically agitated by a stepper-driven oscillator. A Hall sensor establishes the home position, while firmware recovery searches compensate for missed or overshot home detection.

### Pinch valve

A custom pinch valve opens and closes the silicone outlet tube. The valve motor is driven through a TB6612, and the INA219 current measurement is used to identify mechanical resistance at the endpoints.

### Ice dispenser

The ice subsystem uses a stepper-driven lead screw. It opens, holds, closes, and vibrates according to a timed sequence running independently from the main mechanism.

### Direct syrup line

Pump 6 bypasses the indexer and mixer. It dispenses directly over the cup after the mixed drink has been poured.

### Enclosure and integration

The machine uses a custom enclosure and internal mounting system designed around the touchscreen, bottle placement, liquid routing, motors, electronics, service access, and cup bay.

---

## Communication Protocols

### Frontend ↔ Flask backend

| Direction | Transport |
|---|---|
| Commands and data requests | REST/JSON |
| Live status and inventory updates | Server-Sent Events |

### Raspberry Pi ↔ ESP32-S3

| Property | Value |
|---|---|
| Physical link | USB serial/UART |
| Baud rate | 115200 |
| Commands | Plain-text commands and `ORDER` JSON |
| Diagnostics | Lines prefixed with `LOG:` |
| Machine-readable events | JSON lines prefixed with `DATA:` |

Common Pi-to-ESP32 commands include:

```text
START
CLEAN
STOP
CHECK_LEVELS
CHECK_IR
CHECK_LINE_STATE
REVERSE_PUMPS
ICE
ICE_STATUS
```

### ESP32-S3 ↔ NodeMCU

| Property | Value |
|---|---|
| Physical link | UART |
| Baud rate | 9600 |
| Protocol | Compact pump command strings |

---

## Safety and Reliability Features

- Orders are rejected while the machine is busy.
- The backend verifies controller connectivity before accepting an order.
- Glass presence and glass-size requirements are checked before `START`.
- Tracked inventory includes a configurable reserve margin.
- Raw liquid-level inputs are checked before dispensing.
- Pump durations are validated against firmware limits.
- Inventory is restored when order initialization fails.
- Valve movement ignores startup-current spikes before evaluating endpoint current.
- Mixer homing includes negative and positive recovery searches.
- Feed-line state is stored persistently.
- Pump 6 has independent persistent priming state.
- The final ready event waits for every requested parallel path.
- The status LED provides state and fault feedback.
- The backend stores structured event history.
- A simulator and fake serial device support testing without the physical machine.

CocktailCraft is an engineering prototype. Motor power, liquid handling, mains wiring, food-contact materials, cleaning procedures, and emergency stopping must be reviewed before unsupervised or public operation.

---

## Repository Structure

```text
cocktail-crafter/
├── backend/
│   ├── app.py                       # Flask API and SSE server
│   ├── main.py                      # Backend entry point
│   ├── config.py                    # Serial, server, recipe, and hardware limits
│   ├── db.py                        # SQLite schema and data access
│   ├── hardware_controller.py       # Serial and simulated hardware abstraction
│   ├── machine_state.py             # Pi-side machine-state validation
│   ├── recipe_manager.py            # Recipe, duration, inventory, and order logic
│   ├── tools/                       # Fake ESP32 and backup utilities
│   ├── scripts/                     # Operational scripts
│   └── tests/                       # Backend test suite
│
├── frontend/
│   ├── src/routes/                  # Customer kiosk and admin routes
│   ├── src/components/              # UI and administration components
│   ├── src/lib/                     # API and shared frontend utilities
│   ├── src/assets/                  # Application visual assets
│   └── package.json                 # Frontend scripts and dependencies
│
├── firmware/
│   ├── esp32-s3/
│   │   └── CocktailCraft_Firmware.ino
│   ├── nodemcu/
│   │   └── nodemcu_motor_controller.ino
│   └── legacy/                      # Superseded firmware retained for reference
│
├── hardware/
│   ├── calibration-and-testing/     # Isolated mechanism and sensor test sketches
│   ├── component-tests/             # Component-level test firmware
│   └── prototype-history/           # Major integrated firmware milestones
│
├── docs/
│   ├── architecture/                # System-level architecture notes
│   ├── project/                     # Project and work-distribution records
│   └── reference/                   # Protocol and mechanism reference material
│
└── README.md
```

The active production-oriented firmware is under `firmware/`. Files under `legacy`, `calibration-and-testing`, and `prototype-history` document development and should not replace the active firmware without deliberate review.

---

## Development Setup

### Prerequisites

- Node.js and npm
- Python 3.12 or later
- `uv` or another Python environment manager
- Arduino IDE or PlatformIO
- Espressif ESP32 Arduino board support for both the ESP32-S3 and NodeMCU-32S
- Required Arduino libraries listed by the firmware includes

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### Backend

Using `uv`:

```bash
cd backend
uv sync
uv run python main.py
```

The Flask server listens on port `5000` by default.

Before using real hardware, review `backend/config.py`, especially:

```python
SIMULATOR_MODE = False
SERIAL_PORT = "/dev/ttyACM0"
SERIAL_BAUDRATE = 115200
```

The SQLite database is initialized automatically when the backend starts.

### Hardware-free integration testing

The repository includes both a simulator controller and a fake ESP32 serial harness. See:

```text
backend/DEV_SETUP.md
backend/tools/fake_esp32.py
```

These tools allow the React frontend, Flask backend, state machine, and serial parser to be tested without running the physical machine.

### Firmware

Flash the active sketches:

```text
firmware/esp32-s3/CocktailCraft_Firmware.ino
firmware/nodemcu/nodemcu_motor_controller.ino
```

Verify all GPIO assignments, current limits, directions, travel timings, pump mappings, and sensor polarities against the physical machine before operation.

---

## Typical Startup

1. Confirm that pumps, tubing, sensors, motors, and power rails are connected safely.
2. Fill the configured ingredient bottles and update tracked volumes through the admin console.
3. Power the pump controller and ESP32-S3.
4. Connect the ESP32-S3 to the Raspberry Pi.
5. Start the Flask backend.
6. Start or deploy the frontend.
7. Power on the station through the staff interface.
8. Verify controller connectivity and sensor state.
9. Place a test glass and run a low-volume supervised order.

---

## Maintenance Operations

The current system supports:

- full cleaning cycle;
- indexed-line priming;
- indexed-pump reversal;
- liquid-level queries;
- IR sensor queries;
- line-state queries;
- standalone ice testing;
- manual ice endpoint correction;
- pump-6 priming-state inspection and correction;
- manual pump-6 forward, reverse, and stop;
- simulated hardware operation;
- database backup.

Detailed low-level commands and mechanism notes are retained under `docs/reference/`.

---

## Current Limitations

- Liquid quantities are based on calibrated pump flow rate and run time rather than closed-loop flow measurement.
- The ice mechanism uses timed travel and persistent endpoint state without a physical position sensor.
- Raw level-sensor polarity depends on the installed hardware and calibration.
- The ESP32 firmware's software `STOP` behavior is not a substitute for a physical emergency-stop circuit.
- Pump-controller commands are sent over UART without a full transactional acknowledgement protocol.
- Mechanical timing and current thresholds are specific to the built prototype.
- The system requires appropriate sanitation and food-safe handling procedures for real beverage use.

---

## Project Scope

CocktailCraft was developed as a complete multidisciplinary system rather than an isolated software or electronics demonstration. The repository therefore includes:

- customer experience and visual interface;
- staff administration;
- backend services and data persistence;
- real-time embedded control;
- inter-controller protocols;
- custom electronics;
- sensor integration;
- mechanical design and fabrication;
- calibration programs;
- hardware simulators;
- tests and development history.

The value of the project comes from these layers operating as one coordinated machine.
