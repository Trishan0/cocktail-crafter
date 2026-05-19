// ════════════════════════════════════════════════
//  mqtt_handler.h — MQTT Publish / Subscribe
//  Rule: callback ONLY stores data + sets flags.
//  All state logic runs in state_machine.h loop().
// ════════════════════════════════════════════════
#pragma once
#include "config.h"
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── Shared globals (defined in esp32.ino) ────────
extern PubSubClient client;
extern int  g_orderId;
extern int  g_bottle[6];
extern bool g_iceRequested;
extern bool g_limeRequested;
extern bool g_newOrder;
extern bool g_abortRequested;
extern bool g_cleanRequested;

// ── Publish helpers ───────────────────────────────

void publishStatus(const char* status, int progress, const char* message) {
  StaticJsonDocument<256> doc;
  doc["status"]   = status;
  doc["order_id"] = g_orderId;
  doc["progress"] = progress;
  doc["message"]  = message;
  char buf[256];
  serializeJson(doc, buf);
  client.publish(TOPIC_STATUS, buf);
  Serial.println("[STATUS] " + String(buf));
}

void publishSensor(bool glass) {
  char buf[64];
  snprintf(buf, sizeof(buf), "{\"glass_present\":%s}", glass ? "true" : "false");
  client.publish(TOPIC_SENSOR, buf);
  Serial.print("[SENSOR] glass=");
  Serial.println(glass ? "YES" : "NO");
}

void publishPong() {
  client.publish(TOPIC_PONG, "PONG");
}

// ── MQTT Callback (called by PubSubClient) ────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (length == 0) return;
  String t = String(topic);

  if (t == TOPIC_ABORT) {
    g_abortRequested = true;
    Serial.println("[MQTT] ABORT");
    return;
  }

  if (t == TOPIC_CLEAN) {
    g_cleanRequested = true;
    Serial.println("[MQTT] CLEAN");
    return;
  }

  if (t == TOPIC_PING) {
    publishPong();
    return;
  }

  if (t == TOPIC_ORDER) {
    // Build string from payload bytes
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    StaticJsonDocument<1024> doc;
    if (deserializeJson(doc, msg)) {
      Serial.println("[MQTT] JSON parse failed");
      return;
    }
    if (!doc.containsKey("ingredients")) {
      Serial.println("[MQTT] Missing ingredients");
      return;
    }

    g_orderId = doc["order_id"] | 0;
    for (int i = 0; i < 6; i++) {
      g_bottle[i] = doc["ingredients"]["bottle_" + String(i + 1)] | 0;
    }
    g_iceRequested  = doc["options"]["ice"]  | false;
    g_limeRequested = doc["options"]["lime"] | false;
    g_newOrder      = true;

    Serial.println("[MQTT] Order #" + String(g_orderId) + " received");
  }
}

// ── Reconnect (non-blocking) ──────────────────────
unsigned long _lastReconnect = 0;

void reconnectMQTT() {
  if (client.connected()) return;
  if (millis() - _lastReconnect < MQTT_RECONNECT_MS) return;
  _lastReconnect = millis();

  Serial.print("[MQTT] Connecting...");
  if (client.connect(MQTT_CLIENT_ID)) {
    Serial.println(" OK");
    client.subscribe(TOPIC_ORDER);
    client.subscribe(TOPIC_ABORT);
    client.subscribe(TOPIC_CLEAN);
    client.subscribe(TOPIC_PING);
    Serial.println("[MQTT] Subscribed to all topics");
    publishStatus("idle", 0, "Ready");
  } else {
    Serial.println(" FAIL rc=" + String(client.state()));
  }
}
