// ════════════════════════════════════════════════
//  pumps.h — MCP23017 Pump Control
//  6 peristaltic pumps on GPA0–GPA5.
//  Non-blocking: caller is responsible for timing.
//  SIMULATE_SENSORS=1 → Serial-only, no hardware.
// ════════════════════════════════════════════════
#pragma once
#include "config.h"
#include <Wire.h>
#include <Adafruit_MCP23X17.h>

Adafruit_MCP23X17 mcp;
bool pumpsReady = false;

void pumpsInit() {
#if SIMULATE_SENSORS
  pumpsReady = true;
  Serial.println("[PUMP] Simulation mode — MCP23017 skipped");
  return;
#endif

  Wire.begin();  // ESP32 default: SDA=21, SCL=22
  if (!mcp.begin_I2C(MCP_ADDR)) {
    Serial.println("[PUMP] MCP23017 FAILED at 0x" + String(MCP_ADDR, HEX));
    pumpsReady = false;
    return;
  }
  for (int i = 0; i < 6; i++) {
    mcp.pinMode(PUMP_PINS[i], OUTPUT);
    mcp.digitalWrite(PUMP_PINS[i], LOW);  // all OFF
  }
  pumpsReady = true;
  Serial.println("[PUMP] MCP23017 ready — all pumps OFF");
}

void pumpOn(int index) {
  if (index < 0 || index >= 6) return;
  Serial.println("[PUMP] ON  → Bottle " + String(index + 1));
#if !SIMULATE_SENSORS
  if (pumpsReady) mcp.digitalWrite(PUMP_PINS[index], HIGH);
#endif
}

void pumpOff(int index) {
  if (index < 0 || index >= 6) return;
  Serial.println("[PUMP] OFF ← Bottle " + String(index + 1));
#if !SIMULATE_SENSORS
  if (pumpsReady) mcp.digitalWrite(PUMP_PINS[index], LOW);
#endif
}

void stopAllPumps() {
  Serial.println("[PUMP] STOP ALL");
#if !SIMULATE_SENSORS
  if (!pumpsReady) return;
  for (int i = 0; i < 6; i++) mcp.digitalWrite(PUMP_PINS[i], LOW);
#endif
}

// Returns milliseconds needed to dispense `ml` from pump `index`
unsigned long calcDuration(int index, int ml) {
  if (index < 0 || index >= 6 || ml <= 0) return 0;
  return (unsigned long)((float)ml / FLOW_RATES[index] * 1000.0f);
}
