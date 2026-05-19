// ════════════════════════════════════════════════
//  config.h — CocktailCraft ESP32 Configuration
//  Change settings HERE only. Never scatter
//  constants across other files.
// ════════════════════════════════════════════════
#pragma once

// ─── Wi-Fi ────────────────────────────────────────
#define WIFI_SSID        "Trishan Fernando"
#define WIFI_PASS        "qazwsxedc"

// ─── MQTT Broker (Raspberry Pi IP) ───────────────
#define MQTT_HOST        "192.168.43.91"
#define MQTT_PORT        1883
#define MQTT_CLIENT_ID   "ESP32_CocktailCraft"
#define MQTT_BUFFER_SIZE 1024

// ─── MQTT Topics ──────────────────────────────────
#define TOPIC_ORDER   "cocktail/order"
#define TOPIC_STATUS  "cocktail/status"
#define TOPIC_SENSOR  "cocktail/sensor"
#define TOPIC_ABORT   "cocktail/abort"
#define TOPIC_CLEAN   "cocktail/clean"
#define TOPIC_PING    "cocktail/ping"
#define TOPIC_PONG    "cocktail/pong"

// ─── MCP23017 I/O Expander ────────────────────────
// Default I2C address (A0=A1=A2=GND)
#define MCP_ADDR  0x20

// MCP GPA pin for each bottle pump (GPA0–GPA5)
// Bottle:                1  2  3  4  5  6
const uint8_t PUMP_PINS[6] = { 0, 1, 2, 3, 4, 5 };

// ─── Flow Rates (ml per second per pump) ─────────
// 250ml / 60s ≈ 4.17 ml/s. Tune per pump after calibration.
const float FLOW_RATES[6] = { 4.17f, 4.17f, 4.17f, 4.17f, 4.17f, 4.17f };

// ─── Pins ─────────────────────────────────────────
#define IR_PIN  34   // IR glass detection (active LOW)

// ─── Simulation Mode ──────────────────────────────
// 1 = run without physical hardware (software testing)
// 0 = use real MCP23017, IR sensor, pumps
#define SIMULATE_SENSORS 1

// ─── Timing Constants (ms) ────────────────────────
#define SENSOR_PUBLISH_MS  2000   // Sensor data publish interval
#define MQTT_RECONNECT_MS  3000   // Delay between reconnect attempts
#define DONE_RESET_MS      3000   // Auto-reset to IDLE after DONE state
