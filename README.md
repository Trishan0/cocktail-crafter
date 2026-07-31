# Automated Cocktail Machine

A fully automated cocktail-mixing machine. Orders are placed on a touchscreen,
routed through a small network of microcontrollers, and the machine measures,
pumps, mixes, and dispenses the drink — including ice on request — with no
manual intervention.

## Overview

The system is split across four coordinated devices, each responsible for one
part of the pipeline:

| Device | Role |
|---|---|
| Raspberry Pi + 7" touchscreen | Order-taking UI, sends the selected recipe downstream |
| ESP32 | Central controller — receives orders, decides pump timing, drives the oscillator/mixer, detects the cup, triggers ice |
| NodeMCU (ESP8266) | Pump controller — receives dispense commands from the ESP32 and switches the correct pumps on/off for the correct duration |
| Oscillator (stepper + hall-sensor homing) | Physically agitates/mixes the drink after the liquids are dispensed |

## Order Flow

1. **Order placed** — The customer selects a cocktail recipe on the Raspberry
   Pi's touchscreen UI.
2. **Order sent to ESP32** — The Pi transmits the recipe (ingredient list and
   quantities) to the ESP32.
3. **Cup check** — The ESP32 confirms a cup is present using IR sensors before
   dispensing anything.
4. **Pump commands** — The ESP32 calculates the required run-time for each
   ingredient and sends dispense commands to the NodeMCU.
5. **Dispensing** — The NodeMCU switches on the correct pumps for the
   calculated durations, dispensing each ingredient by time (volume ≈ pump
   flow rate × time).
6. **Mixing** — Once all ingredients are dispensed, the ESP32 runs the
   oscillator to mix the drink.
7. **Ice (optional)** — If the order requested ice, the ice-dispensing
   mechanism is triggered.
8. **Completion** — The finished drink is ready in the cup; the machine
   returns to idle and waits for the next order.

```
 ┌────────────┐      order      ┌───────────┐   dispense cmds   ┌──────────┐
 │ Raspberry  │ ───────────────▶│   ESP32   │ ──────────────────▶│ NodeMCU  │
 │ Pi + Touch │                 │ (Main     │                    │ (Pump    │
 │ Display    │                 │ Controller)│◀────────────────── │ Driver)  │
 └────────────┘                 └─────┬─────┘     status/ack     └────┬─────┘
                                       │                                │
                                       │ mix                            │ pump
                                       ▼                                ▼
                                 ┌───────────┐                    ┌───────────┐
                                 │ Oscillator │                    │  Pumps    │
                                 │  (Mixer)   │                    │ (per      │
                                 └───────────┘                     │ ingredient)│
                                       │                            └───────────┘
                                       ▼
                                 ┌───────────┐        ┌────────────┐
                                 │ IR Cup     │        │ Ice        │
                                 │ Detection  │        │ Dispenser  │
                                 └───────────┘        └────────────┘
```

## Hardware Components

### Order UI
- Raspberry Pi (model TBD)
- 7-inch touchscreen display

### Main Controller — ESP32
- Coordinates the whole pipeline: receives orders, talks to the NodeMCU,
  runs the oscillator, reads the IR cup sensors, and triggers ice dispensing.

### Pump Controller — NodeMCU
- Dedicated to driving the ingredient pumps. Takes simple "pump X for Y ms"
  commands from the ESP32 and switches the corresponding relay/MOSFET
  channel.

### Oscillator (Mixer)
- ESP32-S3 based stepper subsystem, used to physically agitate the drink
  after dispensing.
- TMC2208 stepper driver — STEP = GPIO12, DIR = GPIO13, EN = GPIO16
- Homing reference: hall-effect sensor read through an MCP23017 I/O
  expander (SDA = GPIO8, SCL = GPIO9, I2C address `0x20`, sensor on port A,
  active LOW)
- NeoPixel status LED on GPIO48, used to indicate a homing fault

### Cup Detection
- IR sensor pair confirms a cup is present and correctly positioned before
  any liquid is dispensed.

### Ice Dispenser
- Triggered on request as part of the order; mechanism details TBD.

## Communication

| Link | Transport |
|---|---|
| Raspberry Pi → ESP32 | *(fill in: Wi-Fi/HTTP, MQTT, Serial/UART, etc.)* |
| ESP32 → NodeMCU | *(fill in: Wi-Fi/HTTP, MQTT, Serial/UART, ESP-NOW, etc.)* |
| NodeMCU → ESP32 (ack/status) | *(fill in)* |

> Fill in the actual protocol/library used for each link once finalized —
> this keeps the README accurate as the communication layer evolves.

## Features

- Fully automated, end-to-end drink preparation from a single touch order
- Time-based ingredient dosing via independently controlled pumps
- Automatic mixing via a homed, hall-sensor-referenced oscillator
- Cup presence detection before dispensing (prevents spills / dry-pumping)
- Optional ice dispensing per order
- Fault recovery on the oscillator: if homing overshoots, a recovery sweep
  re-locates the hall sensor; if that also fails, the machine reports the
  fault (status LED) and returns to a ready state without needing a reboot

## Repository Structure

```
/pi-ui/          Touchscreen ordering interface (Raspberry Pi)
/esp32-main/     Main controller firmware (order handling, cup detection,
                 oscillator control, ice trigger)
/nodemcu-pumps/  Pump controller firmware
/oscillator/     Standalone oscillator/homing firmware
/docs/           Wiring diagrams, recipe format, protocol notes
```

*(Adjust to match your actual folder layout.)*

## Getting Started

1. Flash `esp32-main` to the ESP32 and `nodemcu-pumps` to the NodeMCU.
2. Wire the pumps to the NodeMCU's relay/MOSFET outputs per `/docs`.
3. Wire the oscillator's stepper driver, MCP23017, hall sensor, and NeoPixel
   to the ESP32-S3 as listed above.
4. Set up the Raspberry Pi with the touchscreen and run the order UI.
5. Configure the communication link(s) between all three devices (IP
   addresses / topics / serial ports as applicable).
6. Power on in this order: pump controller → oscillator/main controller →
   Raspberry Pi UI, then place a test order.

## Safety Notes

- Verify cup presence logic (IR sensors) is working before enabling
  autonomous pumping — this prevents dispensing onto an empty platform.
- Keep pump run-times calibrated per pump (flow rate can vary between
  pumps/tubing) so time-based dosing stays accurate.
- The oscillator's fault indicator (NeoPixel blinking red) means homing
  failed twice in a row — inspect the hall sensor and mechanical range
  before resuming.

## Roadmap / Future Improvements

- [ ] Volume calibration routine per pump (rather than fixed time-per-ml)
- [ ] Recipe editor in the touch UI
- [ ] Remote monitoring / order history
- [ ] Leak / overflow detection
- [ ] Cleaning / flush cycle between different drink types

## License

*(Add your chosen license here.)*
