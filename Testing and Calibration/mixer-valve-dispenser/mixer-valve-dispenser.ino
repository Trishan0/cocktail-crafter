#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>

// I2C - MCP23017 (hall sensors)
constexpr uint8_t I2C_SDA_PIN  = 8;
constexpr uint8_t I2C_SCL_PIN  = 9;
constexpr uint8_t MCP_I2C_ADDR = 0x20;

// I2C - INA219 (second bus)
constexpr uint8_t INA_SDA_PIN = 1;
constexpr uint8_t INA_SCL_PIN = 2;

// NeoPixel
constexpr uint8_t  LED_PIN   = 48;
constexpr uint16_t LED_COUNT = 1;

// Shared enable line for both steppers
constexpr uint8_t EN_PIN = 16;

// Oscillator stepper
constexpr uint8_t OSC_STEP_PIN = 12;
constexpr uint8_t OSC_DIR_PIN  = 13;
constexpr uint8_t OSC_HALL_PIN = 0;    // PA0

// Indexer stepper
constexpr uint8_t IDX_STEP_PIN = 10;
constexpr uint8_t IDX_DIR_PIN  = 11;
constexpr uint8_t IDX_HALL_PINS[6] = {1, 2, 3, 4, 5, 6};   // PA1..PA6

// TB6612 valve driver
constexpr uint8_t STBY_PIN = 4;
constexpr uint8_t PWMA_PIN = 5;
constexpr uint8_t AIN1_PIN = 6;
constexpr uint8_t AIN2_PIN = 7;
constexpr uint32_t VALVE_PWM_FREQ       = 20000;
constexpr uint8_t  VALVE_PWM_RESOLUTION = 8;
constexpr uint8_t  VALVE_MOTOR_SPEED    = 255;

// Oscillator motion
constexpr long  OSC_HALF_RANGE       = 800;
constexpr long  RECOVERY_OFFSET      = 400;
constexpr float OSC_MAX_SPEED        = 20000.0f;
constexpr float OSC_ACCELERATION     = 10000.0f;
constexpr int   OSC_TARGET_LOOPS     = 5;                  // 1 loop = out + back
constexpr int   OSC_TARGET_LEGS      = OSC_TARGET_LOOPS * 2;

// Indexer motion
constexpr long  IDX_SEARCH_DISTANCE = 100000;
constexpr float IDX_SEARCH_SPEED    = 400.0f;
constexpr float IDX_ACCELERATION    = 5000.0f;
unsigned long indexWaitTimes[6] = {2000, 2000, 2000, 2000, 2000, 2000};

// Fault blink
constexpr uint8_t  FAULT_BLINK_COUNT  = 5;
constexpr uint16_t FAULT_BLINK_ON_MS  = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS = 250;

// Valve current-sense close
constexpr float         VALVE_CURRENT_LIMIT_mA  = 600.0f;
constexpr unsigned long VALVE_STARTUP_IGNORE_MS = 500;
constexpr unsigned long VALVE_OPEN_TIME_MS      = 5300;
constexpr unsigned long HOME_TO_VALVE_DELAY_MS  = 1000;

Adafruit_MCP23X17 mcp;
Adafruit_NeoPixel  pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
AccelStepper       stepperOsc(AccelStepper::DRIVER, OSC_STEP_PIN, OSC_DIR_PIN);
AccelStepper       stepperIdx(AccelStepper::DRIVER, IDX_STEP_PIN, IDX_DIR_PIN);
Adafruit_INA219    ina219;
TwoWire            WireValve = TwoWire(1);

enum class SystemState
{
    IDLE,
    VALVE_CLOSING,
    INDEX_SEARCH,
    INDEX_WAIT,
    OSCILLATING,
    HOMING,
    RECOVERY_NEGATIVE,
    RECOVERY_POSITIVE,
    VALVE_OPEN_DELAY,
    VALVE_OPENING
};

SystemState currentState = SystemState::IDLE;

bool stopRequested     = false;
bool nextLegIsNegative  = false;
int  oscLegCount        = 0;

int  idxPosition   = 0;
bool idxReturning  = false;
unsigned long idxWaitStart = 0;

unsigned long valveTimerStart = 0;

// ---------------- Hall sensors ----------------

bool oscHallDetected()
{
    return mcp.digitalRead(OSC_HALL_PIN) == LOW;
}

bool idxHallDetected(uint8_t index)
{
    return mcp.digitalRead(IDX_HALL_PINS[index]) == LOW;
}

// ---------------- Valve helpers ----------------

void valveClose()
{
    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, HIGH);
    ledcWrite(PWMA_PIN, VALVE_MOTOR_SPEED);
}

void valveOpen()
{
    digitalWrite(AIN1_PIN, HIGH);
    digitalWrite(AIN2_PIN, LOW);
    ledcWrite(PWMA_PIN, VALVE_MOTOR_SPEED);
}

void valveStop()
{
    ledcWrite(PWMA_PIN, 0);
}

// ---------------- Stepper helpers ----------------

void stopOscImmediately()
{
    stepperOsc.moveTo(stepperOsc.currentPosition());
    stepperOsc.setSpeed(0);
}

void stopIdxImmediately()
{
    stepperIdx.moveTo(stepperIdx.currentPosition());
    stepperIdx.setSpeed(0);
}

void startOscLeg(bool moveNegative)
{
    nextLegIsNegative = moveNegative;
    stepperOsc.moveTo(moveNegative ? -OSC_HALF_RANGE : OSC_HALF_RANGE);
}

void startIdxSearch(bool reverse = false)
{
    long delta = reverse ? -IDX_SEARCH_DISTANCE : IDX_SEARCH_DISTANCE;
    stepperIdx.moveTo(stepperIdx.currentPosition() + delta);
}

// ---------------- Sequence stages ----------------

void enterIdle(const char* msg)
{
    currentState = SystemState::IDLE;
    Serial.println(msg);
}

void beginValveClosing()
{
    Serial.println("VALVE: CLOSING");
    valveClose();
    valveTimerStart = millis();
    currentState = SystemState::VALVE_CLOSING;
}

void beginIndexerSequence()
{
    Serial.println("INDEXER: STARTING CYCLE");
    idxPosition  = 0;
    idxReturning = false;
    startIdxSearch();
    currentState = SystemState::INDEX_SEARCH;
}

void beginOscillationSequence()
{
    Serial.println("OSC: START");
    stopRequested = false;
    oscLegCount   = 0;
    currentState  = SystemState::OSCILLATING;
    startOscLeg(false);
}

void requestOscStop()
{
    Serial.println("OSC: STOP REQUESTED");
    stopRequested = true;
}

void beginHomingSequence()
{
    Serial.println("OSC: RETURNING HOME");
    currentState = SystemState::HOMING;
    stepperOsc.moveTo(0);
}

void beginRecoveryNegative()
{
    Serial.println("OSC: HOME NOT FOUND, RECOVERY SEARCH NEGATIVE");
    currentState = SystemState::RECOVERY_NEGATIVE;
    stepperOsc.moveTo(-RECOVERY_OFFSET);
}

void beginRecoveryPositive()
{
    Serial.println("OSC: RECOVERY SEARCH POSITIVE");
    currentState = SystemState::RECOVERY_POSITIVE;
    stepperOsc.moveTo(RECOVERY_OFFSET);
}

void beginValveOpenDelay()
{
    valveTimerStart = millis();
    currentState = SystemState::VALVE_OPEN_DELAY;
}

void beginValveOpening()
{
    Serial.println("VALVE: OPENING");
    valveOpen();
    valveTimerStart = millis();
    currentState = SystemState::VALVE_OPENING;
}

void completeHoming()
{
    stopOscImmediately();
    stepperOsc.setCurrentPosition(0);
    for (uint8_t i = 0; i < 2; i++)
    {
        pixel.setPixelColor(0, pixel.Color(0, 255, 0));
        pixel.show();
        delay(200);
        pixel.clear();
        pixel.show();
        delay(200);
    }
    Serial.println("OSC: HOMED");
    beginValveOpenDelay();
}

void reportFatalHomingFailure()
{
    Serial.println("OSC: HOME SEARCH FAILED");
    stopOscImmediately();
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
    beginValveOpenDelay();
}

// ---------------- Per-state update ----------------

void updateValveClosing()
{
    if (millis() - valveTimerStart <= VALVE_STARTUP_IGNORE_MS)
        return;

    float current = ina219.getCurrent_mA();
    if (current > VALVE_CURRENT_LIMIT_mA)
    {
        valveStop();
        Serial.print("VALVE: CLOSED at ");
        Serial.print(current);
        Serial.println(" mA");
        beginIndexerSequence();
    }
}

void updateIndexSearch()
{
    if (!idxHallDetected(idxPosition))
        return;

    stopIdxImmediately();

    if (idxReturning)
    {
        Serial.println("INDEXER: BACK AT POSITION 1");
        stepperIdx.setCurrentPosition(0);
        beginOscillationSequence();
        return;
    }

    Serial.print("INDEXER: AT POSITION ");
    Serial.println(idxPosition + 1);
    idxWaitStart = millis();
    currentState = SystemState::INDEX_WAIT;
}

void updateIndexWait()
{
    if (millis() - idxWaitStart < indexWaitTimes[idxPosition])
        return;

    idxPosition++;

    if (idxPosition < 6)
    {
        startIdxSearch();
        currentState = SystemState::INDEX_SEARCH;
    }
    else
    {
        Serial.println("INDEXER: RETURNING TO POSITION 1");
        idxPosition  = 0;
        idxReturning = true;
        startIdxSearch(true);
        currentState = SystemState::INDEX_SEARCH;
    }
}

void updateOscillating()
{
    if (stepperOsc.distanceToGo() != 0)
        return;

    oscLegCount++;

    if (stopRequested || oscLegCount >= OSC_TARGET_LEGS)
    {
        stopRequested = false;
        Serial.println("OSC: LOOP TARGET REACHED");
        beginHomingSequence();
        return;
    }

    startOscLeg(!nextLegIsNegative);
}

bool checkOscHallDuringSearch()
{
    if (oscHallDetected())
    {
        Serial.println("OSC: HOME CONFIRMED");
        completeHoming();
        return true;
    }
    return false;
}

void updateHoming()
{
    if (checkOscHallDuringSearch())
        return;
    if (stepperOsc.distanceToGo() == 0)
        beginRecoveryNegative();
}

void updateRecoveryNegative()
{
    if (checkOscHallDuringSearch())
        return;
    if (stepperOsc.distanceToGo() == 0)
        beginRecoveryPositive();
}

void updateRecoveryPositive()
{
    if (checkOscHallDuringSearch())
        return;
    if (stepperOsc.distanceToGo() == 0)
        reportFatalHomingFailure();
}

void updateValveOpenDelay()
{
    if (millis() - valveTimerStart >= HOME_TO_VALVE_DELAY_MS)
        beginValveOpening();
}

void updateValveOpening()
{
    if (millis() - valveTimerStart >= VALVE_OPEN_TIME_MS)
    {
        valveStop();
        enterIdle("VALVE OPEN - READY");
    }
}

// ---------------- Serial commands ----------------

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
                requestOscStop();
            break;

        default:
            break;
    }
}

// ---------------- Setup ----------------

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

    mcp.pinMode(OSC_HALL_PIN, INPUT_PULLUP);
    for (uint8_t i = 0; i < 6; i++)
        mcp.pinMode(IDX_HALL_PINS[i], INPUT_PULLUP);
}

void initializeSteppers()
{
    pinMode(EN_PIN, OUTPUT);
    digitalWrite(EN_PIN, LOW);

    stepperOsc.setMaxSpeed(OSC_MAX_SPEED);
    stepperOsc.setAcceleration(OSC_ACCELERATION);

    stepperIdx.setMaxSpeed(IDX_SEARCH_SPEED);
    stepperIdx.setAcceleration(IDX_ACCELERATION);

    if (oscHallDetected())
    {
        stepperOsc.setCurrentPosition(0);
        Serial.println("OSC: HOME DETECTED AT STARTUP");
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
    initializeSteppers();
    initializeValveHardware();

    Serial.println("READY");
    Serial.println("Send 's' to run the full sequence.");
}

// ---------------- Main loop ----------------

void loop()
{
    stepperOsc.run();
    stepperIdx.run();

    handleSerialCommands();

    switch (currentState)
    {
        case SystemState::IDLE:
            break;
        case SystemState::VALVE_CLOSING:
            updateValveClosing();
            break;
        case SystemState::INDEX_SEARCH:
            updateIndexSearch();
            break;
        case SystemState::INDEX_WAIT:
            updateIndexWait();
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
        case SystemState::VALVE_OPEN_DELAY:
            updateValveOpenDelay();
            break;
        case SystemState::VALVE_OPENING:
            updateValveOpening();
            break;
    }
}
