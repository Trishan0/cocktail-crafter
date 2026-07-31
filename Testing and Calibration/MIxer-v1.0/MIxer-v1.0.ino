/*
 * ==========================================================
 *  Oscillating Stepper Controller with Hall-Sensor Homing
 * ==========================================================
 *
 *  Hardware:
 *    - ESP32-S3
 *    - TMC2208 stepper driver (STEP=12, DIR=13, EN=16)
 *    - MCP23017 I/O expander (SDA=8, SCL=9, addr 0x20)
 *        -> Hall sensor on PA0, INPUT_PULLUP, active LOW
 *    - NeoPixel status LED on GPIO48 (fault indication only)
 *
 *  Behaviour summary:
 *    - 's' starts continuous oscillation between +/-800 steps.
 *    - 'x' finishes the current move, then homes back to the
 *      remembered zero position using the hall sensor.
 *    - If homing overshoots without detecting the sensor, a
 *      recovery sweep from -400 to +400 (relative to remembered
 *      zero) is attempted.
 *    - If recovery also fails, the fault is reported by blinking
 *      the NeoPixel red five times, then the system returns to
 *      idle and is ready to accept 's' again (no reset needed).
 *
 *  The hall sensor is ALWAYS read through the MCP23017 - never
 *  through a native ESP32 GPIO.
 * ==========================================================
 */

#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>

// ==========================================================
// PIN / HARDWARE CONFIGURATION
// ==========================================================

// --- MCP23017 / Hall sensor ---
constexpr uint8_t I2C_SDA_PIN   = 8;
constexpr uint8_t I2C_SCL_PIN   = 9;
constexpr uint8_t MCP_I2C_ADDR  = 0x20;
constexpr uint8_t HALL_PIN      = 0;   // MCP23017 PA0

// --- NeoPixel status LED ---
constexpr uint8_t  LED_PIN   = 48;
constexpr uint16_t LED_COUNT = 1;

// --- Stepper driver ---
constexpr uint8_t STEP_PIN = 12;
constexpr uint8_t DIR_PIN  = 13;
constexpr uint8_t EN_PIN   = 16;   // LOW = driver enabled

// ==========================================================
// MOTION SETTINGS
// ==========================================================

constexpr long  OSCILLATION_HALF_RANGE  = 800;   // +/- steps
constexpr long  RECOVERY_SEARCH_OFFSET  = 400;   // +/- steps around home

constexpr float MOTOR_MAX_SPEED    = 20000.0f;
constexpr float MOTOR_ACCELERATION = 10000.0f;

constexpr uint8_t FAULT_BLINK_COUNT     = 5;
constexpr uint16_t FAULT_BLINK_ON_MS    = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS   = 250;

// ==========================================================
// GLOBAL OBJECTS
// ==========================================================

Adafruit_MCP23X17 mcp;
Adafruit_NeoPixel pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

// ==========================================================
// STATE MACHINE
// ==========================================================
//
// A single enum replaces the collection of booleans used in the
// original firmware. Exactly one state is active at a time, which
// removes the need for combinations like
// "oscillating && !returningHome && !recoveryMode".
//
enum class SystemState
{
    IDLE,             // Waiting for 's' command
    OSCILLATING,       // Moving back and forth between +/-800
    HOMING,           // Moving toward remembered zero after 'x'
    RECOVERY_NEGATIVE, // Homing missed; sweeping to -400
    RECOVERY_POSITIVE  // -400 reached without success; sweeping to +400
};

SystemState currentState = SystemState::IDLE;

// True once oscillation should stop at the next turnaround point.
bool stopRequested = false;

// True if the next oscillation leg should move in the negative direction.
bool nextLegIsNegative = false;

// ==========================================================
// HALL SENSOR
// ==========================================================

/**
 * Reads the hall sensor via the MCP23017.
 * Active LOW: returns true when the magnet is detected.
 */
bool isHallSensorActive()
{
    return mcp.digitalRead(HALL_PIN) == LOW;
}

// ==========================================================
// MOTOR HELPERS
// ==========================================================

/**
 * Halts the stepper as close to instantly as possible.
 *
 * Calling stepper.stop() lets AccelStepper decelerate smoothly,
 * which can carry the motor several steps past the hall sensor.
 * Instead, we collapse the target position to the current position
 * so distanceToGo() becomes zero immediately and run() stops
 * issuing step pulses on the very next call - no deceleration ramp,
 * minimal overshoot.
 */
void stopMotorImmediately()
{
    stepper.moveTo(stepper.currentPosition());
    stepper.setSpeed(0);
}

/**
 * Starts one leg of the oscillation motion.
 */
void startOscillationLeg(bool moveNegative)
{
    nextLegIsNegative = moveNegative;
    stepper.moveTo(moveNegative ? -OSCILLATION_HALF_RANGE : OSCILLATION_HALF_RANGE);
}

// ==========================================================
// STATE TRANSITIONS
// ==========================================================

void enterIdle(const char* message)
{
    currentState = SystemState::IDLE;
    Serial.println(message);
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

/**
 * Called once the motor is confirmed to be at the hall sensor.
 * Common completion path for HOMING and both RECOVERY states.
 */
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
    enterIdle("HOMED");
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

/**
 * Blinks the NeoPixel red to report an unrecoverable homing
 * failure, then returns the system to idle so a new 's' command
 * can be accepted without rebooting.
 */
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

    enterIdle("READY");
}

// ==========================================================
// PER-STATE UPDATE FUNCTIONS
// ==========================================================
// Each function is only responsible for its own state's logic,
// keeping loop() flat and free of deep nesting.

void updateOscillating()
{
    if (stepper.distanceToGo() != 0)
        return;   // Still moving toward the current turnaround point.

    if (stopRequested)
    {
        stopRequested = false;
        beginHomingSequence();
        return;
    }

    startOscillationLeg(!nextLegIsNegative);
}

/**
 * Shared logic for any state where we are actively searching for
 * the hall sensor while moving toward a target. Returns true if
 * the caller should stop processing further (homing completed).
 */
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

// ==========================================================
// SERIAL COMMAND HANDLING
// ==========================================================

void handleSerialCommands()
{
    if (!Serial.available())
        return;

    char command = Serial.read();

    switch (command)
    {
        case 's':
            if (currentState == SystemState::IDLE)
                beginOscillation();
            break;

        case 'x':
            if (currentState == SystemState::OSCILLATING)
                requestStop();
            break;

        default:
            // Unrecognized commands are ignored.
            break;
    }
}

// ==========================================================
// SETUP
// ==========================================================

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

        // No hall sensor available - refuse to proceed, but keep
        // blinking so the fault is visible rather than hanging silently.
        while (true)
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
    digitalWrite(EN_PIN, LOW);   // Enable TMC2208

    stepper.setMaxSpeed(MOTOR_MAX_SPEED);
    stepper.setAcceleration(MOTOR_ACCELERATION);

    if (isHallSensorActive())
    {
        stepper.setCurrentPosition(0);
        Serial.println("HOME DETECTED AT STARTUP");
    }
}

void setup()
{
    Serial.begin(115200);

    initializeStatusLed();
    initializeIoExpander();
    initializeStepperDriver();

    Serial.println("READY");
    Serial.println("Send 's' to start.");
    Serial.println("Send 'x' to stop and home.");
}

// ==========================================================
// MAIN LOOP
// ==========================================================

void loop()
{
    stepper.run();

    handleSerialCommands();

    switch (currentState)
    {
        case SystemState::IDLE:
            // Nothing to do; waiting for a command.
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
    }
}
