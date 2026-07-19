#include <Wire.h>
#include <Adafruit_MCP23X17.h>

Adafruit_MCP23X17 mcp;

// ESP32-S3 I2C pins from your original system
constexpr uint8_t I2C_SDA_PIN = 8;
constexpr uint8_t I2C_SCL_PIN = 9;

// MCP23017 address when A0, A1 and A2 are connected to GND
constexpr uint8_t MCP_ADDRESS = 0x20;

// MCP23017 PB0-PB5 correspond to library pins 8-13
constexpr uint8_t LEVEL_SENSOR_PINS[6] = {
    8,   // PB0
    9,   // PB1
    10,  // PB2
    11,  // PB3
    12,  // PB4
    13   // PB5
};

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("MCP23017 Liquid Level Sensor Test");
    Serial.println("---------------------------------");

    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

    if (!mcp.begin_I2C(MCP_ADDRESS))
    {
        Serial.println("ERROR: MCP23017 not detected!");
        Serial.println("Check SDA, SCL, power, ground and address pins.");

        while (true)
        {
            delay(1000);
        }
    }

    Serial.println("MCP23017 detected.");

    for (uint8_t i = 0; i < 6; i++)
    {
        mcp.pinMode(LEVEL_SENSOR_PINS[i], INPUT_PULLUP);
    }

    Serial.println("Reading PB0-PB5...");
}

void loop()
{
    for (uint8_t i = 0; i < 6; i++)
    {
        int sensorState = mcp.digitalRead(LEVEL_SENSOR_PINS[i]);

        Serial.print("PB");
        Serial.print(i);
        Serial.print(": ");

        if (sensorState == LOW)
        {
            Serial.print("LOW ");
        }
        else
        {
            Serial.print("HIGH");
        }

        if (i < 5)
        {
            Serial.print("  |  ");
        }
    }

    Serial.println();

    delay(500);
}