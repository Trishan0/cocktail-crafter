#include <Wire.h>
#include <Adafruit_MCP23X17.h>

Adafruit_MCP23X17 mcp;

// ESP32-S3 I2C
#define SDA_PIN 8
#define SCL_PIN 9

// Hall sensors on PA1 - PA6
const uint8_t hallPins[] = {1, 2, 3, 4, 5, 6};

void setup() {
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);

  if (!mcp.begin_I2C(0x20)) {
    Serial.println("ERROR: MCP23017 not found!");
    while (1);
  }

  // Configure PA1-PA6 as inputs with pull-ups
  for (int i = 0; i < 6; i++) {
    mcp.pinMode(hallPins[i], INPUT_PULLUP);
  }

  Serial.println("=== Hall Sensor Test ===");
}

void loop() {

  Serial.print("PA1: ");
  Serial.print(mcp.digitalRead(1) ? "OFF" : "ON");

  Serial.print(" | PA2: ");
  Serial.print(mcp.digitalRead(2) ? "OFF" : "ON");

  Serial.print(" | PA3: ");
  Serial.print(mcp.digitalRead(3) ? "OFF" : "ON");

  Serial.print(" | PA4: ");
  Serial.print(mcp.digitalRead(4) ? "OFF" : "ON");

  Serial.print(" | PA5: ");
  Serial.print(mcp.digitalRead(5) ? "OFF" : "ON");

  Serial.print(" | PA6: ");
  Serial.println(mcp.digitalRead(6) ? "OFF" : "ON");

  delay(100);
}