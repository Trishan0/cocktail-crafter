#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <ArduinoJson.h>

// ================== MCP ==================
Adafruit_MCP23X17 mcp;

// ================== WIFI + MQTT ==================
const char* ssid = "Trishan Fernando";
const char* password = "qazwsxedc";
const char* mqtt_server = "192.168.43.91";

WiFiClient espClient;
PubSubClient client(espClient);

// ================== STATE MACHINE ==================
enum State {
  IDLE,
  WAITING_GLASS,
  DISPENSING,
  DONE
};

State currentState = IDLE;

struct Order {
  int order_id;
  int bottle[6];
  bool ice;
};

Order currentOrder;

bool newOrder = false;
bool glassPresent = true;  // simulate

int currentBottle = 0;
bool bottleRunning = false;
unsigned long stateStartTime = 0;

// flow rate: ml/sec
const float flowRate = 250.0 / 60.0;

unsigned long lastReconnect = 0;

// ================== SETUP ==================
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("Booting...");

  // MCP INIT
  Wire.begin();

  if (!mcp.begin_I2C()) {
    Serial.println("MCP init FAILED!");
    while (1)
      ;
  }

  mcp.pinMode(2, OUTPUT);    // GPA2
  mcp.digitalWrite(2, LOW);  // OFF

  Serial.println("MCP ready");

  // WIFI
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi OK");

  // MQTT
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
  client.setBufferSize(1024);

}

// ================== MQTT CALLBACK ==================
void callback(char* topic, byte* payload, unsigned int length) {
  if (length == 0) {
    Serial.println("Empty message");
    return;
  }

  String msg = "";
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  Serial.println("Raw message:");
  Serial.println(msg);

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, msg);

  if (err) {
    Serial.println("JSON parse failed");
    return;
  }

  if (!doc.containsKey("ingredients")) {
    Serial.println("Invalid JSON");
    return;
  }

  currentOrder.order_id = doc["order_id"] | 0;

  for (int i = 0; i < 6; i++) {
    String key = "bottle_" + String(i + 1);
    currentOrder.bottle[i] = doc["ingredients"][key] | 0;
  }

  currentOrder.ice = doc["options"]["ice"] | false;

  newOrder = true;

  Serial.println("Order stored safely");
}

// ================== MQTT RECONNECT ==================
void reconnectMQTT() {
  if (!client.connected()) {
    if (millis() - lastReconnect > 3000) {
      lastReconnect = millis();

      Serial.print("MQTT connecting...");

      if (client.connect("ESP32_Client")) {
        Serial.println("OK");
        client.subscribe("cocktail/order");
        Serial.println("Subscribed to cocktail/order");
      } else {
        Serial.println("FAILED");
      }
    }
  }
}

// ================== MAIN LOOP ==================
void loop() {
  reconnectMQTT();
  client.loop();
  static unsigned long lastSensor = 0;

  if (millis() - lastSensor > 2000) {
    lastSensor = millis();

    publishSensor(glassPresent);  // currently always true
  }

  if (newOrder) {
    Serial.println("Order received → waiting for glass");

    currentBottle = 0;
    bottleRunning = false;

    publishStatus("waiting_glass", 0, "Place glass");

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

      if (currentBottle < 6) {

        int amount = currentOrder.bottle[currentBottle];

        if (amount > 0) {

          if (!bottleRunning) {
            Serial.print("Bottle ");
            Serial.print(currentBottle + 1);
            Serial.print(" → ");
            Serial.print(amount);
            Serial.println(" ml");

            int progress = (currentBottle * 100) / 6;
            publishStatus("dispensing", progress, "Dispensing...");

            Serial.println("Pump ON");
            mcp.digitalWrite(2, HIGH);  // adjust if inverted

            stateStartTime = millis();
            bottleRunning = true;
          }

          unsigned long duration = (amount / flowRate) * 1000;

          if (millis() - stateStartTime >= duration) {
            Serial.println("Bottle done");

            Serial.println("Pump OFF");
            mcp.digitalWrite(2, LOW);

            bottleRunning = false;
            currentBottle++;
          }

        } else {
          currentBottle++;
        }

      } else {
        Serial.println("All bottles done");
        currentState = DONE;
      }

      break;

    case DONE:
      Serial.println("Drink ready");

      publishStatus("done", 100, "Drink ready");

      currentState = IDLE;
      break;
  }
}

// ================== STATUS ==================
void publishStatus(const char* status, int progress, const char* message) {
  String payload = "{";
  payload += "\"status\":\"" + String(status) + "\",";
  payload += "\"order_id\":" + String(currentOrder.order_id) + ",";
  payload += "\"progress\":" + String(progress) + ",";
  payload += "\"message\":\"" + String(message) + "\"";
  payload += "}";

  client.publish("cocktail/status", payload.c_str());

  Serial.print("[STATUS] ");
  Serial.println(payload);
}

void publishSensor(bool glass) {
  String payload = "{";
  payload += "\"glass_present\":" + String(glass ? "true" : "false");
  payload += "}";

  client.publish("cocktail/sensor", payload.c_str());

  Serial.print("[SENSOR] ");
  Serial.println(payload);
}