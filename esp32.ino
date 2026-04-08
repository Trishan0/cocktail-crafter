#include <WiFi.h>
#include <PubSubClient.h>

enum State {
  IDLE,
  WAITING_GLASS,
  DISPENSING,
  DONE
};

State currentState = IDLE;
const char* ssid = "Trishan Fernando";
const char* password = "qazwsxedc";
const char* mqtt_server = "192.168.43.91";
bool glassPresent = true; // simulate for now

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastReconnect = 0;
struct Order {
  int order_id;
  int bottle[6];
  bool ice;
};

Order currentOrder;
bool newOrder = false;
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("Booting...");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi OK");

  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
}
#include <ArduinoJson.h>

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";

  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("JSON parse failed");
    return;
  }

  currentOrder.order_id = doc["order_id"];

  for (int i = 0; i < 6; i++) {
    String key = "bottle_" + String(i + 1);
    currentOrder.bottle[i] = doc["ingredients"][key] | 0;
  }

  currentOrder.ice = doc["options"]["ice"] | false;

  newOrder = true;

  Serial.println("Order stored");
}
void loop() {
  if (!client.connected()) {
    if (millis() - lastReconnect > 3000) {
      lastReconnect = millis();

      Serial.print("MQTT connect...");
      if (client.connect("ESP32_Client")) {
        client.subscribe("cocktail/order");
        Serial.println("Subscribed to cocktail/order");
      } else {
        Serial.println("FAIL");
      }
    }
  }

  client.loop();
  if (newOrder) {
    Serial.println("Order received → waiting for glass");
    newOrder = false;
    currentState = WAITING_GLASS;
  }
  switch (currentState) {

  case IDLE:
    break;

  case WAITING_GLASS:
    if (glassPresent) {
      Serial.println("Glass detected → start dispensing");
      currentState = DISPENSING;
    }
    break;

  case DISPENSING:
    Serial.println("Dispensing...");
    delay(2000);  // TEMP (we will remove later)

    currentState = DONE;
    break;

  case DONE:
    Serial.println("Drink ready");
    currentState = IDLE;
    break;
}
}