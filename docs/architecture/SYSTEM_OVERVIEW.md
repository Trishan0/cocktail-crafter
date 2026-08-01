# Cocktail-Craft Bartender — System Overview

**Target Audience:** AI Agents, Developers, and Maintainers joining the project.
**Purpose:** Provide a comprehensive understanding of the system architecture, data flow, hardware integration, and current project status.

---

## 1. High-Level Architecture

The system is a robotic cocktail-making machine. It consists of three primary layers:

1.  **Frontend (React/TypeScript):** Provides a touch-first Kiosk UI for customers to order drinks, and a secured Admin Dashboard to manage recipes, hardware, and view order history.
2.  **Backend (Python/Flask):** Serves the API, manages the SQLite database, and acts as the orchestrator between the user interface and the physical hardware.
3.  **Hardware (ESP32 via Serial):** A microcontroller that physically drives the pumps, reads the IR glass sensor, and executes the cleaning cycles based on commands from the Pi.

### Data Flow
```
[ Frontend UI ] <--(REST API & SSE)--> [ Flask Backend ] <--(JSON over UART)--> [ ESP32 Hardware ]
```
*   **Commands:** Flow downwards (UI clicks "Order" -> Flask saves to DB and sends `ORDER` JSON to ESP32).
*   **Events/Status:** Flow upwards (ESP32 sends `STATUS` -> Flask updates state and broadcasts via SSE -> UI updates progress bars).

---

## 2. Codebase Structure & Key Components

### 2.1 Backend (`/python-code`)
*   **`app.py`**: The Flask server. Exposes REST endpoints (`/api/...`) and a Server-Sent Events (SSE) stream (`/stream`). It instantiates the hardware controller on startup.
*   **`db.py`**: SQLite database layer. Manages `drinks`, `ingredients`, `pumps`, `orders` (with historical snapshots), `events` (system logs), and `settings` (persisted config like Admin PIN).
*   **`hardware_controller.py`**: The abstraction layer. Defines a `HardwareController` base class and two implementations:
    *   `SimulatorController`: Software-only simulation that mimics hardware timing.
    *   `SerialController`: Talks to the real ESP32 over USB.
*   **`machine_state.py`**: The single source of truth for the hardware state machine. It defines the `MachineState` enum and validates all state transitions to prevent buggy hardware from corrupting the Pi's state.
*   **`fake_esp32.py`**: A standalone script used for testing. It simulates the ESP32 hardware behavior over virtual serial or TCP loopback, allowing full end-to-end testing without the physical machine.
*   **`backup_db.py` / `backup.sh`**: Utilities for safe, automated SQLite backups via cron.

### 2.2 Frontend (`/src`)
*   **Tech Stack:** React, TypeScript, Vite, Tailwind CSS, TanStack Router.
*   **Kiosk UI (`/src/routes/index.tsx`)**: The customer-facing flow (`Welcome -> Catalog/Compose -> Preparing -> Ready -> Cleaning`). It relies heavily on the SSE connection to auto-transition screens based on the hardware's real-time status.
*   **Admin UI (`/src/routes/admin.tsx`)**: The management portal. Includes tabs for Drinks, Ingredients, Hardware Control (manual clean, simulator toggles), and Live Order History.

---

## 3. Hardware Protocol & State Machine

The communication between the Pi and the ESP32 is strictly defined in **`PROTOCOL.md`**.

### The Core Lifecycle
A standard drink order follows a strict sequence of states. The backend enforces these transitions and ignores illegal jumps:
1.  `IDLE` (Ready for orders)
2.  `WAITING_GLASS` (Waiting for IR sensor confirmation)
3.  `DISPENSING` (Pumping ingredients)
4.  `MIXING` (Shaking the container)
5.  `POURING` (Dispensing final drink into glass)
6.  `DONE` (Drink is ready. UI holds here for ~5 seconds)
7.  *Auto-Clean Cycle Begins:* `REVERSING` -> `WASHING` -> `MIXING` (shaking water) -> `DRAINING` -> `RESEALING`
8.  `IDLE`

### Commands sent to ESP32:
*   `ORDER`: Contains pump numbers and durations.
*   `CLEAN`: Can be `post_order` (full container wash) or `manual` (flush specific lines).
*   `ABORT`: Emergency stop.

---

## 4. Crucial System Behaviors to Note

*   **SSE is the Source of Truth for the UI:** The Kiosk UI does not poll. It reacts instantly to Server-Sent Events. If the hardware says `washing`, the UI instantly switches to the Cleaning screen.
*   **Live Hardware Timing Workarounds:** On real hardware, the ESP32 transitions from `DONE` to `REVERSING` almost instantly when a user removes their glass. To prevent the UI from flashing past the "Ready" screen too fast, `index.tsx` enforces a strict minimum 5-second hold on the `DONE`/Ready screen before it allows the UI to render the cleaning state.
*   **Order Snapshots:** The `orders` table saves the exact price and ingredient amounts as a JSON snapshot at the time of purchase. This ensures accounting remains accurate even if a recipe's price or ingredients change months later.

---

## 5. Current Project Status

**Status:** ALL PHASE 1-4 MILESTONES COMPLETE. READY FOR HARDWARE DEPLOYMENT.

*   The hardware abstraction layer is fully implemented and tested.
*   The software simulator (`fake_esp32.py` and `SimulatorController`) behaves identically to the expected hardware spec.
*   The UI perfectly handles the complex post-order cleaning lifecycle without flickering.
*   The database is robust, with live-updating SSE history for the admin panel and automated backups.

**Next Steps / Future Work:**
1.  Connect the physical Raspberry Pi to the physical ESP32.
2.  Update `config.py` to `SIMULATOR_MODE = False` and set the correct `SERIAL_PORT`.
3.  Tune the baud rate, timeout values, and physical pump flow rates (ml-to-ms calculations) based on real-world liquid tests.
