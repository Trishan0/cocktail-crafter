#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>

// PIN / HARDWARE CONFIGURATION

// MCP23017 / Hall sensor bus (Wire)
constexpr uint8_t I2C_SDA_PIN  = 8;
constexpr uint8_t I2C_SCL_PIN  = 9;
constexpr uint8_t MCP_I2C_ADDR = 0x20;
constexpr uint8_t HALL_PIN     = 0;   // MCP23017 PA0

// NeoPixel status LED
constexpr uint8_t  LED_PIN   = 48;
constexpr uint16_t LED_COUNT = 1;

// Stepper driver (TMC2208)
constexpr uint8_t STEP_PIN = 12;
constexpr uint8_t DIR_PIN  = 13;
constexpr uint8_t EN_PIN   = 16;   // LOW = driver enabled

// INA219 bus (Wire1)
constexpr uint8_t INA_SDA_PIN = 1;
constexpr uint8_t INA_SCL_PIN = 2;

// TB6612 (valve motor)
constexpr uint8_t STBY_PIN = 4;
constexpr uint8_t PWMA_PIN = 5;
constexpr uint8_t AIN1_PIN = 6;
constexpr uint8_t AIN2_PIN = 7;

constexpr uint32_t VALVE_PWM_FREQ       = 20000;
constexpr uint8_t  VALVE_PWM_RESOLUTION = 8;
constexpr uint8_t  VALVE_MOTOR_SPEED    = 255;

// MOTION / VALVE SETTINGS

constexpr long  OSCILLATION_HALF_RANGE = 800;   // +/- steps
constexpr long  RECOVERY_SEARCH_OFFSET = 400;   // +/- steps around home

constexpr float MOTOR_MAX_SPEED    = 20000.0f;
constexpr float MOTOR_ACCELERATION = 10000.0f;

constexpr uint8_t  FAULT_BLINK_COUNT   = 5;
constexpr uint16_t FAULT_BLINK_ON_MS   = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS  = 250;

constexpr float         VALVE_CURRENT_LIMIT_mA = 600.0f;
constexpr unsigned long VALVE_STARTUP_IGNORE_MS = 500;
constexpr unsigned long VALVE_OPEN_TIME_MS      = 5300;

// GLOBAL OBJECTS

Adafruit_MCP23X17  mcp;
Adafruit_NeoPixel  pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
AccelStepper       stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);
Adafruit_INA219    ina219;
TwoWire            WireValve = TwoWire(1);

// STATE MACHINE
//
// Sequence for one full cycle:
//   's' -> VALVE_CLOSING -> OSCILLATING
//   'x' -> HOMING -> (RECOVERY_NEGATIVE -> RECOVERY_POSITIVE if needed)
//       -> VALVE_OPENING -> IDLE
//
enum class SystemState
{
    IDLE,
    VALVE_CLOSING,
    OSCILLATING,
    HOMING,
    RECOVERY_NEGATIVE,
    RECOVERY_POSITIVE,
    VALVE_OPENING
};

SystemState currentState = SystemState::IDLE;

bool stopRequested    = false;   // oscillation should stop at next turnaround
bool nextLegIsNegative = false;  // direction of the next oscillation leg

unsigned long valveActionStartTime = 0;   // used for both closing and opening timing

// HALL SENSOR

bool isHallSensorActive()
{
    return mcp.digitalRead(HALL_PIN) == LOW;   // active LOW
}

// VALVE MOTOR HELPERS (TB6612 + INA219)

void valveMotorClose()   // pulls valve toward closed position
{
    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, HIGH);
    ledcWrite(PWMA_PIN, VALVE_MOTOR_SPEED);
}

void valveMotorOpen()    // pulls valve toward open position
{
    digitalWrite(AIN1_PIN, HIGH);
    digitalWrite(AIN2_PIN, LOW);
    ledcWrite(PWMA_PIN, VALVE_MOTOR_SPEED);
}

void valveMotorStop()
{
    ledcWrite(PWMA_PIN, 0);
}

// STEPPER MOTOR HELPERS

void stopMotorImmediately()
{
    // Collapses the target to the current position so run() stops
    // issuing pulses immediately, instead of decelerating past the sensor.
    stepper.moveTo(stepper.currentPosition());
    stepper.setSpeed(0);
}

void startOscillationLeg(bool moveNegative)
{
    nextLegIsNegative = moveNegative;
    stepper.moveTo(moveNegative ? -OSCILLATION_HALF_RANGE : OSCILLATION_HALF_RANGE);
}

// STATE TRANSITIONS

void enterIdle(const char* message)
{
    currentState = SystemState::IDLE;
    Serial.println(message);
}

void beginValveClosing()
{
    Serial.println("CLOSING VALVE");
    valveMotorClose();
    valveActionStartTime = millis();
    currentState = SystemState::VALVE_CLOSING;
}

void beginOscillation()
{
    Serial.println("START");
    stopRequested = false;
    currentState  = SystemState::OSCILLATING;
    startOscillationLeg(false);
}

void requestStop()
{
    Serial.println("STOP REQUESTED");
    stopRequested = true;
}

void beginValveOpening()
{
    Serial.println("OPENING VALVE");
    valveMotorOpen();
    valveActionStartTime = millis();
    currentState = SystemState::VALVE_OPENING;
}

void completeHoming()
{
    stopMotorImmediately();
    stepper.setCurrentPosition(0);
    for (uint8_t i = 0; i < 2; i++)
    {
        pixel.setPixelColor(0, pixel.Color(0, 255, 0));
        pixel.show();
        delay(200);
        pixel.clear();
        pixel.show();
        delay(200);
    }
    Serial.println("HOMED");
    beginValveOpening();
}

void beginHomingSequence()
{
    Serial.println("RETURNING HOME");
    currentState = SystemState::HOMING;
    stepper.moveTo(0);
}

void beginRecoveryNegativeSweep()
{
    Serial.println("HOME NOT FOUND");
    Serial.println("STARTING RECOVERY - SEARCHING NEGATIVE");
    currentState = SystemState::RECOVERY_NEGATIVE;
    stepper.moveTo(-RECOVERY_SEARCH_OFFSET);
}

void beginRecoveryPositiveSweep()
{
    Serial.println("SEARCHING POSITIVE");
    currentState = SystemState::RECOVERY_POSITIVE;
    stepper.moveTo(RECOVERY_SEARCH_OFFSET);
}

void reportFatalHomingFailure()
{
    Serial.println("HOME SEARCH FAILED!");

    stopMotorImmediately();
    stopRequested = false;

    for (uint8_t i = 0; i < FAULT_BLINK_COUNT; i++)
    {
        pixel.setPixelColor(0, pixel.Color(255, 0, 0));
        pixel.show();
        delay(FAULT_BLINK_ON_MS);
        pixel.clear();
        pixel.show();
        delay(FAULT_BLINK_OFF_MS);
    }

    // Even if homing failed, still open the valve so it does not stay shut.
    beginValveOpening();
}

// PER-STATE UPDATE FUNCTIONS

void updateValveClosing()
{
    if (millis() - valveActionStartTime <= VALVE_STARTUP_IGNORE_MS)
        return;   // ignore inrush current right after start

    float current = ina219.getCurrent_mA();
    if (current > VALVE_CURRENT_LIMIT_mA)
    {
        valveMotorStop();
        Serial.print("VALVE CLOSED at ");
        Serial.print(current);
        Serial.println(" mA");
        beginOscillation();
    }
}

void updateOscillating()
{
    if (stepper.distanceToGo() != 0)
        return;   // still moving toward the current turnaround point

    if (stopRequested)
    {
        stopRequested = false;
        beginHomingSequence();
        return;
    }

    startOscillationLeg(!nextLegIsNegative);
}

bool checkForHallDuringSearch()
{
    if (isHallSensorActive())
    {
        Serial.println("HOME CONFIRMED");
        completeHoming();
        return true;
    }
    return false;
}

void updateHoming()
{
    if (checkForHallDuringSearch())
        return;

    if (stepper.distanceToGo() == 0)
        beginRecoveryNegativeSweep();
}

void updateRecoveryNegative()
{
    if (checkForHallDuringSearch())
        return;

    if (stepper.distanceToGo() == 0)
        beginRecoveryPositiveSweep();
}

void updateRecoveryPositive()
{
    if (checkForHallDuringSearch())
        return;

    if (stepper.distanceToGo() == 0)
        reportFatalHomingFailure();
}

void updateValveOpening()
{
    if (millis() - valveActionStartTime >= VALVE_OPEN_TIME_MS)
    {
        valveMotorStop();
        enterIdle("VALVE OPEN - READY");
    }
}

// SERIAL COMMAND HANDLING

void handleSerialCommands()
{
    if (!Serial.available())
        return;

    char command = Serial.read();

    switch (command)
    {
        case 's':
            if (currentState == SystemState::IDLE)
                beginValveClosing();
            break;

        case 'x':
            if (currentState == SystemState::OSCILLATING)
                requestStop();
            break;

        default:
            // unrecognized commands are ignored
            break;
    }
}

// SETUP

void initializeStatusLed()
{
    pixel.begin();
    pixel.clear();
    pixel.show();
}

void initializeIoExpander()
{
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

    if (!mcp.begin_I2C(MCP_I2C_ADDR))
    {
        Serial.println("ERROR: MCP23017 not found!");
        while (true)   // no hall sensor available, refuse to proceed
        {
            pixel.setPixelColor(0, pixel.Color(255, 0, 0));
            pixel.show();
            delay(200);
            pixel.clear();
            pixel.show();
            delay(200);
        }
    }

    mcp.pinMode(HALL_PIN, INPUT_PULLUP);
}

void initializeStepperDriver()
{
    pinMode(EN_PIN, OUTPUT);
    digitalWrite(EN_PIN, LOW);   // enable TMC2208

    stepper.setMaxSpeed(MOTOR_MAX_SPEED);
    stepper.setAcceleration(MOTOR_ACCELERATION);

    if (isHallSensorActive())
    {
        stepper.setCurrentPosition(0);
        Serial.println("HOME DETECTED AT STARTUP");
    }
}

void initializeValveHardware()
{
    WireValve.begin(INA_SDA_PIN, INA_SCL_PIN);

    pinMode(STBY_PIN, OUTPUT);
    pinMode(AIN1_PIN, OUTPUT);
    pinMode(AIN2_PIN, OUTPUT);
    digitalWrite(STBY_PIN, HIGH);

    ledcAttach(PWMA_PIN, VALVE_PWM_FREQ, VALVE_PWM_RESOLUTION);

    if (!ina219.begin(&WireValve))
    {
        Serial.println("ERROR: INA219 not found!");
        while (true) { delay(1000); }
    }
}

void setup()
{
    Serial.begin(115200);

    initializeStatusLed();
    initializeIoExpander();
    initializeStepperDriver();
    initializeValveHardware();

    Serial.println("READY");
    Serial.println("Send 's' to close valve and start oscillation.");
    Serial.println("Send 'x' to stop oscillation, home, then open valve.");
}

// MAIN LOOP

void loop()
{
    stepper.run();

    handleSerialCommands();

    switch (currentState)
    {
        case SystemState::IDLE:
            break;

        case SystemState::VALVE_CLOSING:
            updateValveClosing();
            break;

        case SystemState::OSCILLATING:
            updateOscillating();
            break;

        case SystemState::HOMING:
            updateHoming();
            break;

        case SystemState::RECOVERY_NEGATIVE:
            updateRecoveryNegative();
            break;

        case SystemState::RECOVERY_POSITIVE:
            updateRecoveryPositive();
            break;

        case SystemState::VALVE_OPENING:
            updateValveOpening();
            break;
    }
}
