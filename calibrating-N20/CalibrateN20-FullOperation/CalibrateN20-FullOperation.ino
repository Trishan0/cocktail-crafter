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
// Your modified pin arrangement
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
// Forward closing configuration
// =====================================================

constexpr float FORWARD_CURRENT_LIMIT_MA = 180.0;

// =====================================================
// Backward opening configuration
// =====================================================

constexpr float BACKWARD_CURRENT_LIMIT_MA = 150.0;
constexpr unsigned long BACKWARD_TIME_MS = 1800;

// =====================================================
// Shared monitoring configuration
// =====================================================

constexpr unsigned long STARTUP_IGNORE_MS = 500;
constexpr unsigned long CURRENT_SAMPLE_INTERVAL_MS = 50;

// Absolute backup timeout
constexpr unsigned long ABSOLUTE_MAX_RUN_TIME_MS = 10000;

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

// Serial input buffers
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

void printStopMessage(
    const char *reason,
    unsigned long runTime,
    float current_mA)
{
    Serial.print("MOTOR:STOPPED");
    Serial.print(",REASON:");
    Serial.print(reason);
    Serial.print(",RUN_TIME:");
    Serial.print(runTime);
    Serial.print("ms");
    Serial.print(",CURRENT_AT_STOP:");
    Serial.print(current_mA, 2);
    Serial.print("mA");
    Serial.print(",MAX_CURRENT:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("MOTOR:STOPPED");
    Serial2.print(",REASON:");
    Serial2.print(reason);
    Serial2.print(",RUN_TIME:");
    Serial2.print(runTime);
    Serial2.print("ms");
    Serial2.print(",CURRENT_AT_STOP:");
    Serial2.print(current_mA, 2);
    Serial2.print("mA");
    Serial2.print(",MAX_CURRENT:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");
}

// =====================================================
// INA219 reading
// =====================================================

float readCurrentAbsolute_mA()
{
    return abs(ina219.getCurrent_mA());
}

void printINA219To(Stream &output)
{
    float rawCurrent_mA = ina219.getCurrent_mA();
    float current_mA = abs(rawCurrent_mA);

    float busVoltage_V = ina219.getBusVoltage_V();
    float shuntVoltage_mV = ina219.getShuntVoltage_mV();

    float loadVoltage_V =
        busVoltage_V + (shuntVoltage_mV / 1000.0);

    float power_mW = ina219.getPower_mW();

    output.print("CURRENT:");
    output.print(current_mA, 2);
    output.print("mA");

    output.print(",RAW_CURRENT:");
    output.print(rawCurrent_mA, 2);
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

    printToBoth(
        "MOTOR:FORWARD,MODE:CURRENT_CONTROL"
    );
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

    printToBoth(
        "MOTOR:BACKWARD,MODE:CURRENT_OR_TIME_CONTROL"
    );
}

void motorStop(const char *reason)
{
    unsigned long runTime = 0;

    if (motorState != MotorState::STOPPED)
    {
        runTime = millis() - motorStartTime;
    }

    ledcWrite(PWMA_PIN, 0);

    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, LOW);

    motorState = MotorState::STOPPED;

    float current_mA = readCurrentAbsolute_mA();

    printStopMessage(
        reason,
        runTime,
        current_mA
    );
}

// =====================================================
// Status output
// =====================================================

void printStatusTo(Stream &output)
{
    output.print("STATUS:");

    if (motorState == MotorState::FORWARD)
    {
        output.print("FORWARD");
    }
    else if (motorState == MotorState::BACKWARD)
    {
        output.print("BACKWARD");
    }
    else
    {
        output.print("STOPPED");
    }

    output.print(",FORWARD_LIMIT:");
    output.print(FORWARD_CURRENT_LIMIT_MA, 2);
    output.print("mA");

    output.print(",BACKWARD_LIMIT:");
    output.print(BACKWARD_CURRENT_LIMIT_MA, 2);
    output.print("mA");

    output.print(",BACKWARD_TIME:");
    output.print(BACKWARD_TIME_MS);
    output.print("ms");

    output.print(",MAX_CURRENT:");
    output.print(maximumCurrent_mA, 2);
    output.println("mA");
}

void printStatusToBoth()
{
    printStatusTo(Serial);
    printStatusTo(Serial2);
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

    if (
        command == "F" ||
        command == "FORWARD")
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
    else if (
        command == "S" ||
        command == "STOP")
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
        printStatusToBoth();
    }
    else
    {
        Serial.print("UNKNOWN_COMMAND:");
        Serial.println(command);

        Serial2.print("UNKNOWN_COMMAND:");
        Serial2.println(command);
    }
}

void readCommandsFrom(
    Stream &port,
    String &buffer)
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

            if (buffer.length() > 50)
            {
                buffer = "";
            }
        }
    }
}

// =====================================================
// Forward monitoring
// =====================================================

void monitorForward(
    unsigned long now,
    unsigned long runTime)
{
    if (
        now - previousSampleTime <
        CURRENT_SAMPLE_INTERVAL_MS)
    {
        return;
    }

    previousSampleTime = now;

    float current_mA =
        readCurrentAbsolute_mA();

    if (current_mA > maximumCurrent_mA)
    {
        maximumCurrent_mA = current_mA;
    }

    Serial.print("FORWARD,RUN_TIME:");
    Serial.print(runTime);
    Serial.print("ms,CURRENT:");
    Serial.print(current_mA, 2);
    Serial.print("mA,LIMIT:");
    Serial.print(FORWARD_CURRENT_LIMIT_MA, 2);
    Serial.print("mA,MAX:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("FORWARD,RUN_TIME:");
    Serial2.print(runTime);
    Serial2.print("ms,CURRENT:");
    Serial2.print(current_mA, 2);
    Serial2.print("mA,LIMIT:");
    Serial2.print(FORWARD_CURRENT_LIMIT_MA, 2);
    Serial2.print("mA,MAX:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");

    // Ignore current limit during startup
    if (runTime <= STARTUP_IGNORE_MS)
    {
        return;
    }

    if (current_mA >= FORWARD_CURRENT_LIMIT_MA)
    {
        motorStop("FORWARD_COMPLETE_CURRENT");
    }
}

// =====================================================
// Backward monitoring
// =====================================================

void monitorBackward(
    unsigned long now,
    unsigned long runTime)
{
    // Normal time-based completion
    if (runTime >= BACKWARD_TIME_MS)
    {
        motorStop("BACKWARD_COMPLETE_TIME");
        return;
    }

    if (
        now - previousSampleTime <
        CURRENT_SAMPLE_INTERVAL_MS)
    {
        return;
    }

    previousSampleTime = now;

    float current_mA =
        readCurrentAbsolute_mA();

    if (current_mA > maximumCurrent_mA)
    {
        maximumCurrent_mA = current_mA;
    }

    Serial.print("BACKWARD,RUN_TIME:");
    Serial.print(runTime);
    Serial.print("ms,CURRENT:");
    Serial.print(current_mA, 2);
    Serial.print("mA,LIMIT:");
    Serial.print(BACKWARD_CURRENT_LIMIT_MA, 2);
    Serial.print("mA,MAX:");
    Serial.print(maximumCurrent_mA, 2);
    Serial.println("mA");

    Serial2.print("BACKWARD,RUN_TIME:");
    Serial2.print(runTime);
    Serial2.print("ms,CURRENT:");
    Serial2.print(current_mA, 2);
    Serial2.print("mA,LIMIT:");
    Serial2.print(BACKWARD_CURRENT_LIMIT_MA, 2);
    Serial2.print("mA,MAX:");
    Serial2.print(maximumCurrent_mA, 2);
    Serial2.println("mA");

    // Ignore startup current spike
    if (runTime <= STARTUP_IGNORE_MS)
    {
        return;
    }

    // Normal early completion if resistance is reached
    if (current_mA >= BACKWARD_CURRENT_LIMIT_MA)
    {
        motorStop("BACKWARD_COMPLETE_CURRENT");
    }
}

// =====================================================
// Main motor monitor
// =====================================================

void monitorMotor()
{
    if (motorState == MotorState::STOPPED)
    {
        return;
    }

    unsigned long now = millis();
    unsigned long runTime =
        now - motorStartTime;

    if (runTime >= ABSOLUTE_MAX_RUN_TIME_MS)
    {
        motorStop("ABSOLUTE_TIMEOUT");
        return;
    }

    if (motorState == MotorState::FORWARD)
    {
        monitorForward(
            now,
            runTime
        );
    }
    else if (motorState == MotorState::BACKWARD)
    {
        monitorBackward(
            now,
            runTime
        );
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

    printToBoth("N20_VALVE_CONTROL_READY");
    printToBoth("COMMANDS:F,B,S,R,STATUS");

    Serial.print("FORWARD_CURRENT_LIMIT:");
    Serial.print(FORWARD_CURRENT_LIMIT_MA, 2);
    Serial.println("mA");

    Serial.print("BACKWARD_CURRENT_LIMIT:");
    Serial.print(BACKWARD_CURRENT_LIMIT_MA, 2);
    Serial.println("mA");

    Serial.print("BACKWARD_TIME_LIMIT:");
    Serial.print(BACKWARD_TIME_MS);
    Serial.println("ms");

    Serial2.print("FORWARD_CURRENT_LIMIT:");
    Serial2.print(FORWARD_CURRENT_LIMIT_MA, 2);
    Serial2.println("mA");

    Serial2.print("BACKWARD_CURRENT_LIMIT:");
    Serial2.print(BACKWARD_CURRENT_LIMIT_MA, 2);
    Serial2.println("mA");

    Serial2.print("BACKWARD_TIME_LIMIT:");
    Serial2.print(BACKWARD_TIME_MS);
    Serial2.println("ms");
}

// =====================================================
// Loop
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

    monitorMotor();
}