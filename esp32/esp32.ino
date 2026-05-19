/*
 * CocktailCraft — ESP32 Firmware (Arduino IDE)
 * ──────────────────────────────────────────────
 * Main sketch: globals + setup() + loop() only.
 * All logic lives in the header modules:
 *
 *   config.h        — Wi-Fi, MQTT, pins, flow rates
 *   sensors.h       — IR glass + bottle level sensors
 *   pumps.h         — MCP23017 pump control
 *   mqtt_handler.h  — publish/subscribe + callback
 *   state_machine.h — full dispensing state machine
 *
 * Required libraries (install via Arduino Library Manager):
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon
 *   - Adafruit MCP23017 Arduino Library
 *   - Adafruit BusIO (dependency of MCP library)
 */

// ─── Library includes (order matters) ─────────────
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>

// ─── Project headers ──────────────────────────────
#include "config.h"
#include "sensors.h"
#include "pumps.h"
// Note: mqtt_handler.h and state_machine.h need the
// globals below to be declared first.

// ─── SHARED GLOBALS ───────────────────────────────
// These are accessed via extern in the header modules.

WiFiClient   espClient;
PubSubClient client(espClient);

// Order data (written by MQTT callback, read by state machine)
int  g_orderId      = 0;
int  g_bottle[6]    = {0, 0, 0, 0, 0, 0};
bool g_iceRequested  = false;
bool g_limeRequested = false;

// Control flags (set by MQTT callback, cleared by state machine)
bool g_newOrder       = false;
bool g_abortRequested = false;
bool g_cleanRequested = false;

// ─── Include logic modules AFTER globals ──────────
#include "mqtt_handler.h"
#include "state_machine.h"

// ─── Sensor publish ticker ────────────────────────
unsigned long _lastSensor = 0;

// ─── SETUP ────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n[BOOT] CocktailCraft ESP32 starting...");

  // Hardware init
  sensorsInit();
  pumpsInit();

  // Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WIFI] Connecting");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected — IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WIFI] FAILED — will retry in background");
  }

  // MQTT
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setBufferSize(MQTT_BUFFER_SIZE);   // ← fixes the 256-byte buffer bug
  client.setCallback(mqttCallback);

  Serial.println("[BOOT] Ready");
}

// ─── LOOP ─────────────────────────────────────────
void loop() {
  // Keep MQTT alive + reconnect if dropped
  reconnectMQTT();
  client.loop();

  // Publish sensor data on interval
  if (millis() - _lastSensor >= SENSOR_PUBLISH_MS) {
    _lastSensor = millis();
    publishSensor(readGlassPresent());
  }

  // Run state machine
  stateMachineRun();
}
