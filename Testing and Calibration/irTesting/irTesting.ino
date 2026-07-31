// Simple test for two IR detector modules
// ESP32 pins: GPIO 38 and GPIO 39

constexpr uint8_t IR_SENSOR_1_PIN = 38;
constexpr uint8_t IR_SENSOR_2_PIN = 39;

void setup()
{
    Serial.begin(115200);

    pinMode(IR_SENSOR_1_PIN, INPUT_PULLUP);
    pinMode(IR_SENSOR_2_PIN, INPUT_PULLUP);

    Serial.println("IR detector test started");
    Serial.println("Sensor order: GPIO38, GPIO39");
}

void loop()
{
    int sensor1 = digitalRead(IR_SENSOR_1_PIN);
    int sensor2 = digitalRead(IR_SENSOR_2_PIN);

    Serial.print("IR 38: ");
    Serial.print(sensor1);

    Serial.print("  |  IR 39: ");
    Serial.println(sensor2);

    delay(200);
}