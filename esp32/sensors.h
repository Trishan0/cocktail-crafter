// ════════════════════════════════════════════════
//  sensors.h — Sensor Reading
//  SIMULATE_SENSORS=1 → safe defaults (no hardware)
//  SIMULATE_SENSORS=0 → reads real IR + level sensors
// ════════════════════════════════════════════════
#pragma once
#include "config.h"

void sensorsInit() {
#if !SIMULATE_SENSORS
  pinMode(IR_PIN, INPUT_PULLUP);
#endif
  Serial.println("[SENSOR] Init OK (sim=" + String(SIMULATE_SENSORS) + ")");
}

// Returns true if a glass is placed on the platform
bool readGlassPresent() {
#if SIMULATE_SENSORS
  return true;   // always present in simulation
#else
  return digitalRead(IR_PIN) == LOW;  // active LOW
#endif
}

// Returns true if bottle[index] has liquid
bool readBottleLevel(int index) {
  // TODO: wire capacitive level sensor per bottle
  return true;   // assume full until sensors are wired
}
