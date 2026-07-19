#include <Wire.h>
#include <Adafruit_INA219.h>

// =====================================================
// UART connections to NodeMCU
// Same as the main program
// =====================================================

constexpr uint8_t RXD2_PIN = 18;
constexpr uint8_t TXD2_PIN = 17;
constexpr unsigned long SERIAL2_BAUD = 9600;

// =====================================================
// INA219 current sensor
// Uses the second ESP32 I2C controller
// =====================================================

constexpr uint8_t INA_SDA_PIN = 1;
constexpr uint8_t INA_SCL_PIN = 2;

TwoWire WireValve = TwoWire(1);
Adafruit_INA219 ina219;

// =====================================================
// TB6612FNG valve motor driver
// Same connections as the main program
// =====================================================

constexpr uint8_t STBY_PIN = 4;
constexpr uint8_t PWMA_PIN = 5;
constexpr uint8_t AIN1_PIN = 7;
constexpr uint8_t AIN2_PIN = 6;

// =====================================================
// PWM settings
// =====================================================

constexpr uint32_t PWM_FREQ = 20000;
constexpr uint8_t PWM_RESOLUTION = 8;
constexpr uint8_t MOTOR_SPEED = 120;

// =====================================================
// Current calibration variables
// =====================================================

// Ignore the initial motor-starting current spike for this period.
constexpr unsigned long STARTUP_IGNORE_MS = 500;

// How frequently current is printed while the motor runs.
constexpr unsigned long CURRENT_SAMPLE_INTERVAL_MS = 50;

// Safety limit to prevent accidentally holding the N20 at stall.
// Change this carefully during calibration.
constexpr float EMERGENCY_CURRENT_LIMIT_MA = 1100.0;

// Maximum amount of time the motor may run from one command.
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
    float current_mA = ina219.getCurrent_mA();
    float busVoltage_V = ina219.getBusVoltage_V();
    float shuntVoltage_mV = ina219.getShuntVoltage_mV();
    float loadVoltage_V =
        busVoltage_V + (shuntVoltage_mV / 1000.0);
    float power_mW = ina219.getPower_mW();

    output.print("CURRENT:");
    output.print(current_mA, 2);
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
    ledcWrite(PWMA_PIN, 0);

    motorState = MotorState::STOPPED;

    // The INA219 may still show some residual current immediately
    // after stopping, so this value is mainly for observation.
    currentAtStop_mA = ina219.getCurrent_mA();

    Serial.print("MOTOR:STOPPED,REASON:");
    Serial.print(reason);
    Serial.print(",CURRENT_AT_STOP:");
    Serial.print(currentAtStop_mA, 2);
    Serial.print("mA,MAX_CURRENT:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("MOTOR:STOPPED,REASON:");
    Serial2.print(reason);
    Serial2.print(",CURRENT_AT_STOP:");
    Serial2.print(currentAtStop_mA, 2);
    Serial2.print("mA,MAX_CURRENT:");
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
        return;

    if (command == "F" || command == "FORWARD")
    {
        motorForward();
    }
    else if (command == "B" ||
             command == "BACKWARD" ||
             command == "REVERSE")
    {
        motorBackward();
    }
    else if (command == "S" || command == "STOP")
    {
        motorStop("COMMAND");
    }
    else if (command == "R" ||
             command == "READ" ||
             command == "READ_CURRENT")
    {
        printINA219ToBoth();
    }
    else if (command == "STATUS")
    {
        Serial.print("STATUS:");

        if (motorState == MotorState::FORWARD)
            Serial.print("FORWARD");
        else if (motorState == MotorState::BACKWARD)
            Serial.print("BACKWARD");
        else
            Serial.print("STOPPED");

        Serial.print(",MAX_CURRENT:");
        Serial.print(maximumCurrent_mA, 2);
        Serial.println("mA");

        Serial2.print("STATUS:");

        if (motorState == MotorState::FORWARD)
            Serial2.print("FORWARD");
        else if (motorState == MotorState::BACKWARD)
            Serial2.print("BACKWARD");
        else
            Serial2.print("STOPPED");

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

        if (receivedCharacter == '\n' ||
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

            // Prevent an accidentally enormous command buffer.
            if (buffer.length() > 50)
                buffer = "";
        }
    }
}

// =====================================================
// Continuous current calibration
// =====================================================

void monitorMotorCurrent()
{
    if (motorState == MotorState::STOPPED)
        return;

    unsigned long now = millis();
    unsigned long runTime = now - motorStartTime;

    if (runTime >= MAX_RUN_TIME_MS)
    {
        motorStop("MAX_RUN_TIME");
        return;
    }

    if (now - previousSampleTime < CURRENT_SAMPLE_INTERVAL_MS)
        return;

    previousSampleTime = now;

    float current_mA = ina219.getCurrent_mA();

    if (current_mA > maximumCurrent_mA)
        maximumCurrent_mA = current_mA;

    Serial.print("RUN_TIME:");
    Serial.print(runTime);
    Serial.print("ms,CURRENT:");
    Serial.print(current_mA, 2);
    Serial.print("mA,MAX:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("RUN_TIME:");
    Serial2.print(runTime);
    Serial2.print("ms,CURRENT:");
    Serial2.print(current_mA, 2);
    Serial2.print("mA,MAX:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");

    // Ignore the normal motor startup surge.
    if (runTime >= STARTUP_IGNORE_MS &&
        current_mA >= EMERGENCY_CURRENT_LIMIT_MA)
    {
        motorStop("OVERCURRENT");
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

    // INA219 is on the second I2C controller.
    WireValve.begin(INA_SDA_PIN, INA_SCL_PIN);

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

    // Important: pass the second I2C bus to begin().
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
    printToBoth("F/FORWARD = close direction");
    printToBoth("B/BACKWARD = open direction");
    printToBoth("S/STOP = stop motor");
    printToBoth("R/READ = read INA219");
}

// =====================================================
// Main loop
// =====================================================

void loop()
{
    readCommandsFrom(Serial, usbCommandBuffer);
    readCommandsFrom(Serial2, nodeCommandBuffer);

    monitorMotorCurrent();
}