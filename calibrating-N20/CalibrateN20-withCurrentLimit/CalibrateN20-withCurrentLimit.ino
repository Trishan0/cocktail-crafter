#include <Wire.h>
#include <Adafruit_INA219.h>

// =====================================================
// UART connection to NodeMCU
// =====================================================

constexpr uint8_t RXD2_PIN = 18;
constexpr uint8_t TXD2_PIN = 17;
constexpr unsigned long SERIAL2_BAUD = 9600;

// =====================================================
// INA219 current sensor
// Uses ESP32 second I2C controller
// =====================================================

constexpr uint8_t INA_SDA_PIN = 1;
constexpr uint8_t INA_SCL_PIN = 2;

TwoWire WireValve = TwoWire(1);
Adafruit_INA219 ina219;

// =====================================================
// TB6612FNG motor driver
// Pin arrangement from your modified code
// =====================================================

constexpr uint8_t STBY_PIN = 4;
constexpr uint8_t PWMA_PIN = 5;
constexpr uint8_t AIN1_PIN = 7;
constexpr uint8_t AIN2_PIN = 6;

// =====================================================
// PWM configuration
// =====================================================

constexpr uint32_t PWM_FREQ = 20000;
constexpr uint8_t PWM_RESOLUTION = 8;
constexpr uint8_t MOTOR_SPEED = 120;

// =====================================================
// Current-limit configuration
// Manually edit these values when necessary
// =====================================================

// Motor automatically stops above this current.
constexpr float CURRENT_LIMIT_MA = 200.0;

// Ignore startup current for this amount of time.
constexpr unsigned long STARTUP_IGNORE_MS = 500;

// Current measurement interval.
constexpr unsigned long CURRENT_SAMPLE_INTERVAL_MS = 50;

// Absolute maximum running time for safety.
constexpr unsigned long MAX_RUN_TIME_MS = 10000;

// =====================================================
// Motor state
// =====================================================

enum class MotorState
{
    STOPPED,
    FORWARD,
    BACKWARD
};

MotorState motorState = MotorState::STOPPED;

unsigned long motorStartTime = 0;
unsigned long previousSampleTime = 0;

float maximumCurrent_mA = 0.0;
float currentAtStop_mA = 0.0;

// Serial command buffers
String usbCommandBuffer;
String nodeCommandBuffer;

// =====================================================
// Output helpers
// =====================================================

void printToBoth(const String &message)
{
    Serial.println(message);
    Serial2.println(message);
}

void printINA219To(Stream &output)
{
    float measuredCurrent_mA = ina219.getCurrent_mA();

    // Current may be negative if INA219 input direction is reversed.
    float current_mA = abs(measuredCurrent_mA);

    float busVoltage_V = ina219.getBusVoltage_V();
    float shuntVoltage_mV = ina219.getShuntVoltage_mV();

    float loadVoltage_V =
        busVoltage_V + (shuntVoltage_mV / 1000.0);

    float power_mW = ina219.getPower_mW();

    output.print("CURRENT:");
    output.print(current_mA, 2);
    output.print("mA");

    output.print(",RAW_CURRENT:");
    output.print(measuredCurrent_mA, 2);
    output.print("mA");

    output.print(",BUS_VOLTAGE:");
    output.print(busVoltage_V, 3);
    output.print("V");

    output.print(",LOAD_VOLTAGE:");
    output.print(loadVoltage_V, 3);
    output.print("V");

    output.print(",POWER:");
    output.print(power_mW, 2);
    output.println("mW");
}

void printINA219ToBoth()
{
    printINA219To(Serial);
    printINA219To(Serial2);
}

// =====================================================
// Motor control
// =====================================================

void motorForward()
{
    digitalWrite(STBY_PIN, HIGH);

    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, HIGH);

    ledcWrite(PWMA_PIN, MOTOR_SPEED);

    motorState = MotorState::FORWARD;
    motorStartTime = millis();
    previousSampleTime = 0;
    maximumCurrent_mA = 0.0;

    printToBoth("MOTOR:FORWARD");
}

void motorBackward()
{
    digitalWrite(STBY_PIN, HIGH);

    digitalWrite(AIN1_PIN, HIGH);
    digitalWrite(AIN2_PIN, LOW);

    ledcWrite(PWMA_PIN, MOTOR_SPEED);

    motorState = MotorState::BACKWARD;
    motorStartTime = millis();
    previousSampleTime = 0;
    maximumCurrent_mA = 0.0;

    printToBoth("MOTOR:BACKWARD");
}

void motorStop(const char *reason)
{
    // Stop PWM first.
    ledcWrite(PWMA_PIN, 0);

    // Set both direction inputs LOW.
    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, LOW);

    motorState = MotorState::STOPPED;

    float measuredCurrent_mA = ina219.getCurrent_mA();
    currentAtStop_mA = abs(measuredCurrent_mA);

    Serial.print("MOTOR:STOPPED");
    Serial.print(",REASON:");
    Serial.print(reason);
    Serial.print(",CURRENT_AT_STOP:");
    Serial.print(currentAtStop_mA, 2);
    Serial.print("mA");
    Serial.print(",MAX_CURRENT:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("MOTOR:STOPPED");
    Serial2.print(",REASON:");
    Serial2.print(reason);
    Serial2.print(",CURRENT_AT_STOP:");
    Serial2.print(currentAtStop_mA, 2);
    Serial2.print("mA");
    Serial2.print(",MAX_CURRENT:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");
}

// =====================================================
// Command handling
// =====================================================

void processCommand(String command)
{
    command.trim();
    command.toUpperCase();

    if (command.length() == 0)
    {
        return;
    }

    if (command == "F" || command == "FORWARD")
    {
        motorForward();
    }
    else if (
        command == "B" ||
        command == "BACKWARD" ||
        command == "REVERSE")
    {
        motorBackward();
    }
    else if (command == "S" || command == "STOP")
    {
        motorStop("COMMAND");
    }
    else if (
        command == "R" ||
        command == "READ" ||
        command == "READ_CURRENT")
    {
        printINA219ToBoth();
    }
    else if (command == "STATUS")
    {
        Serial.print("STATUS:");

        if (motorState == MotorState::FORWARD)
        {
            Serial.print("FORWARD");
        }
        else if (motorState == MotorState::BACKWARD)
        {
            Serial.print("BACKWARD");
        }
        else
        {
            Serial.print("STOPPED");
        }

        Serial.print(",CURRENT_LIMIT:");
        Serial.print(CURRENT_LIMIT_MA, 2);
        Serial.print("mA");

        Serial.print(",MAX_CURRENT:");
        Serial.print(maximumCurrent_mA, 2);
        Serial.println("mA");

        Serial2.print("STATUS:");

        if (motorState == MotorState::FORWARD)
        {
            Serial2.print("FORWARD");
        }
        else if (motorState == MotorState::BACKWARD)
        {
            Serial2.print("BACKWARD");
        }
        else
        {
            Serial2.print("STOPPED");
        }

        Serial2.print(",CURRENT_LIMIT:");
        Serial2.print(CURRENT_LIMIT_MA, 2);
        Serial2.print("mA");

        Serial2.print(",MAX_CURRENT:");
        Serial2.print(maximumCurrent_mA, 2);
        Serial2.println("mA");
    }
    else
    {
        Serial.print("UNKNOWN_COMMAND:");
        Serial.println(command);

        Serial2.print("UNKNOWN_COMMAND:");
        Serial2.println(command);
    }
}

void readCommandsFrom(Stream &port, String &buffer)
{
    while (port.available())
    {
        char receivedCharacter = port.read();

        if (
            receivedCharacter == '\n' ||
            receivedCharacter == '\r')
        {
            if (buffer.length() > 0)
            {
                processCommand(buffer);
                buffer = "";
            }
        }
        else
        {
            buffer += receivedCharacter;

            // Prevent an excessively large command buffer.
            if (buffer.length() > 50)
            {
                buffer = "";
            }
        }
    }
}

// =====================================================
// Automatic current monitoring
// =====================================================

void monitorMotorCurrent()
{
    if (motorState == MotorState::STOPPED)
    {
        return;
    }

    unsigned long now = millis();
    unsigned long runTime = now - motorStartTime;

    // Stop motor if it runs for too long.
    if (runTime >= MAX_RUN_TIME_MS)
    {
        motorStop("MAX_RUN_TIME");
        return;
    }

    // Read only at the configured sampling interval.
    if (now - previousSampleTime < CURRENT_SAMPLE_INTERVAL_MS)
    {
        return;
    }

    previousSampleTime = now;

    float measuredCurrent_mA = ina219.getCurrent_mA();

    // Use absolute current so the protection works even if
    // INA219 current direction is reversed.
    float current_mA = abs(measuredCurrent_mA);

    if (current_mA > maximumCurrent_mA)
    {
        maximumCurrent_mA = current_mA;
    }

    Serial.print("RUN_TIME:");
    Serial.print(runTime);
    Serial.print("ms");

    Serial.print(",CURRENT:");
    Serial.print(current_mA, 2);
    Serial.print("mA");

    Serial.print(",LIMIT:");
    Serial.print(CURRENT_LIMIT_MA, 2);
    Serial.print("mA");

    Serial.print(",MAX:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("RUN_TIME:");
    Serial2.print(runTime);
    Serial2.print("ms");

    Serial2.print(",CURRENT:");
    Serial2.print(current_mA, 2);
    Serial2.print("mA");

    Serial2.print(",LIMIT:");
    Serial2.print(CURRENT_LIMIT_MA, 2);
    Serial2.print("mA");

    Serial2.print(",MAX:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");

    // Ignore the normal startup surge.
    if (runTime <= STARTUP_IGNORE_MS)
    {
        return;
    }

    // Automatically stop when the current exceeds the limit.
    if (current_mA >= CURRENT_LIMIT_MA)
    {
        Serial.print("CURRENT_LIMIT_EXCEEDED:");
        Serial.print(current_mA, 2);
        Serial.println("mA");

        Serial2.print("CURRENT_LIMIT_EXCEEDED:");
        Serial2.print(current_mA, 2);
        Serial2.println("mA");

        motorStop("CURRENT_LIMIT");
    }
}

// =====================================================
// Setup
// =====================================================

void setup()
{
    Serial.begin(115200);

    Serial2.begin(
        SERIAL2_BAUD,
        SERIAL_8N1,
        RXD2_PIN,
        TXD2_PIN
    );

    // INA219 uses ESP32 I2C controller 1.
    WireValve.begin(
        INA_SDA_PIN,
        INA_SCL_PIN
    );

    pinMode(STBY_PIN, OUTPUT);
    pinMode(AIN1_PIN, OUTPUT);
    pinMode(AIN2_PIN, OUTPUT);

    digitalWrite(STBY_PIN, HIGH);
    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, LOW);

    ledcAttach(
        PWMA_PIN,
        PWM_FREQ,
        PWM_RESOLUTION
    );

    ledcWrite(PWMA_PIN, 0);

    if (!ina219.begin(&WireValve))
    {
        printToBoth("ERROR:INA219_NOT_FOUND");

        while (true)
        {
            ledcWrite(PWMA_PIN, 0);
            delay(1000);
        }
    }

    printToBoth("N20_CALIBRATION_READY");
    printToBoth("COMMANDS:F,B,S,R,STATUS");

    Serial.print("CURRENT_LIMIT:");
    Serial.print(CURRENT_LIMIT_MA, 2);
    Serial.println("mA");

    Serial2.print("CURRENT_LIMIT:");
    Serial2.print(CURRENT_LIMIT_MA, 2);
    Serial2.println("mA");
}

// =====================================================
// Main loop
// =====================================================

void loop()
{
    readCommandsFrom(
        Serial,
        usbCommandBuffer
    );

    readCommandsFrom(
        Serial2,
        nodeCommandBuffer
    );

    monitorMotorCurrent();
}