#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>
#include <Preferences.h>

// UART2 - command relay to nodeMCU
#define RXD2 18
#define TXD2 17
constexpr unsigned long SERIAL2_BAUD = 9600;

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

// Non-contact liquid-level sensors on MCP23017 port B
// Adafruit MCP23X17 numbering: PB0..PB5 = pins 8..13
constexpr uint8_t LEVEL_SENSOR_PINS[6] = {8, 9, 10, 11, 12, 13};

// TB6612 valve driver
constexpr uint8_t STBY_PIN = 4;
constexpr uint8_t PWMA_PIN = 5;
constexpr uint8_t AIN1_PIN = 7;
constexpr uint8_t AIN2_PIN = 6;
constexpr uint32_t VALVE_PWM_FREQ       = 20000;
constexpr uint8_t  VALVE_PWM_RESOLUTION = 8;
constexpr uint8_t  VALVE_MOTOR_SPEED    = 120;

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

// Initial position-1 recovery:
// Search clockwise for no more than two index spacings. If position 1 is
// not found, reverse and search counterclockwise until it is detected.
constexpr long IDX_STEPS_BETWEEN_POSITIONS = 204;
constexpr long IDX_INITIAL_FORWARD_LIMIT = IDX_STEPS_BETWEEN_POSITIONS * 2;
unsigned long indexWaitTimes[6] = {4000, 4000, 4000, 4000, 4000, 4000};
constexpr unsigned long IDX_POST_STOP_DELAY_MS = 3000;

// Fault blink
constexpr uint8_t  FAULT_BLINK_COUNT  = 5;
constexpr uint16_t FAULT_BLINK_ON_MS  = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS = 250;

// Pinch-valve control
// Closing: current-controlled
constexpr float         VALVE_CLOSE_CURRENT_LIMIT_mA = 200.0f;

// Opening: stop at current limit or maximum time, whichever happens first
constexpr float         VALVE_OPEN_CURRENT_LIMIT_mA  = 150.0f;
constexpr unsigned long VALVE_OPEN_TIME_MS            = 2000;

// Ignore the normal motor startup-current surge in both directions
constexpr unsigned long VALVE_STARTUP_IGNORE_MS       = 500;
constexpr unsigned long VALVE_CURRENT_SAMPLE_MS       = 50;
constexpr unsigned long HOME_TO_VALVE_DELAY_MS        = 1000;

Adafruit_MCP23X17 mcp;
Adafruit_NeoPixel  pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
AccelStepper       stepperOsc(AccelStepper::DRIVER, OSC_STEP_PIN, OSC_DIR_PIN);
AccelStepper       stepperIdx(AccelStepper::DRIVER, IDX_STEP_PIN, IDX_DIR_PIN);
Adafruit_INA219    ina219;
TwoWire            WireValve = TwoWire(1);
Preferences          preferences;

// Persistent pinch-valve state stored in ESP32 NVS.
enum class ValveSavedState : uint8_t
{
    UNKNOWN = 0,
    OPEN,
    CLOSED,
    CLOSING,
    OPENING
};

ValveSavedState savedValveState = ValveSavedState::UNKNOWN;
constexpr const char* VALVE_PREF_NAMESPACE = "pinchValve";
constexpr const char* VALVE_PREF_KEY       = "state";

enum class SystemState
{
    IDLE,
    VALVE_CLOSING,
    INDEX_SEARCH,
    INDEX_WAIT,
    INDEX_POST_STOP,
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
bool idxInitialSearchActive = false;
bool idxInitialSearchReversed = false;
unsigned long idxWaitStart = 0;
unsigned long idxPostStopStart = 0;

unsigned long valveTimerStart = 0;
unsigned long valveLastCurrentSample = 0;

// ---------------- Hall sensors ----------------

bool oscHallDetected()
{
    return mcp.digitalRead(OSC_HALL_PIN) == LOW;
}

bool idxHallDetected(uint8_t index)
{
    return mcp.digitalRead(IDX_HALL_PINS[index]) == LOW;
}

// ---------------- Liquid-level sensors ----------------

void sendLevelStates(Stream& output)
{
    // Machine-readable response, ordered PB0 through PB5.
    // 1 = HIGH, 0 = LOW.
    output.print("LEVELS:");

    for (uint8_t i = 0; i < 6; i++)
    {
        uint8_t state = mcp.digitalRead(LEVEL_SENSOR_PINS[i]) == HIGH ? 1 : 0;
        output.print(state);

        if (i < 5)
            output.print(',');
    }

    output.println();
}

// ---------------- UART2 command relay ----------------

void sendCmd(const char* cmd)
{
    Serial2.println(cmd);
    Serial.print("TX2: ");
    Serial.println(cmd);
}

// ---------------- Persistent valve state ----------------

const char* valveStateName(ValveSavedState state)
{
    switch (state)
    {
        case ValveSavedState::OPEN:    return "OPEN";
        case ValveSavedState::CLOSED:  return "CLOSED";
        case ValveSavedState::CLOSING: return "CLOSING";
        case ValveSavedState::OPENING: return "OPENING";
        default:                       return "UNKNOWN";
    }
}

void saveValveState(ValveSavedState state)
{
    savedValveState = state;
    preferences.putUChar(VALVE_PREF_KEY, static_cast<uint8_t>(state));

    Serial.print("VALVE STATE: ");
    Serial.println(valveStateName(state));
}

void initializeValveStateStorage()
{
    preferences.begin(VALVE_PREF_NAMESPACE, false);

    uint8_t storedValue = preferences.getUChar(
        VALVE_PREF_KEY,
        static_cast<uint8_t>(ValveSavedState::UNKNOWN)
    );

    if (storedValue > static_cast<uint8_t>(ValveSavedState::OPENING))
        storedValue = static_cast<uint8_t>(ValveSavedState::UNKNOWN);

    savedValveState = static_cast<ValveSavedState>(storedValue);

    Serial.print("VALVE STORED STATE: ");
    Serial.println(valveStateName(savedValveState));
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

void startInitialIdxSearch()
{
    idxInitialSearchActive = true;
    idxInitialSearchReversed = false;

    // First try clockwise, but only for two index spacings.
    stepperIdx.moveTo(
        stepperIdx.currentPosition() + IDX_INITIAL_FORWARD_LIMIT
    );

    Serial.print("INDEXER: SEARCHING POSITION 1 CLOCKWISE FOR ");
    Serial.print(IDX_INITIAL_FORWARD_LIMIT);
    Serial.println(" STEPS");
}

void reverseInitialIdxSearch()
{
    idxInitialSearchReversed = true;

    // Position 1 was not found within the safe clockwise distance.
    // Search counterclockwise until the position-1 Hall sensor is found.
    stepperIdx.moveTo(
        stepperIdx.currentPosition() - IDX_SEARCH_DISTANCE
    );

    Serial.println("INDEXER: POSITION 1 NOT FOUND, SEARCHING COUNTERCLOCKWISE");
}

// ---------------- Sequence stages ----------------

void beginIndexerSequence();

void enterIdle(const char* msg)
{
    currentState = SystemState::IDLE;
    Serial.println(msg);
}

void beginValveClosing()
{
    if (savedValveState == ValveSavedState::CLOSED)
    {
        Serial.println("VALVE: ALREADY CLOSED");
        beginIndexerSequence();
        return;
    }

    Serial.println("VALVE: CLOSING");
    saveValveState(ValveSavedState::CLOSING);
    valveClose();
    valveTimerStart = millis();
    valveLastCurrentSample = 0;
    currentState = SystemState::VALVE_CLOSING;
}

void beginIndexerSequence()
{
    Serial.println("INDEXER: STARTING CYCLE");
    idxPosition  = 0;
    idxReturning = false;
    startInitialIdxSearch();
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
    saveValveState(ValveSavedState::OPENING);
    valveOpen();
    valveTimerStart = millis();
    valveLastCurrentSample = 0;
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
    unsigned long now = millis();
    unsigned long runTime = now - valveTimerStart;

    // Ignore the normal startup-current surge.
    if (runTime <= VALVE_STARTUP_IGNORE_MS)
        return;

    // Avoid reading the INA219 more often than necessary.
    if (now - valveLastCurrentSample < VALVE_CURRENT_SAMPLE_MS)
        return;

    valveLastCurrentSample = now;

    float current = abs(ina219.getCurrent_mA());

    if (current >= VALVE_CLOSE_CURRENT_LIMIT_mA)
    {
        valveStop();
        saveValveState(ValveSavedState::CLOSED);
        Serial.print("VALVE: CLOSED at ");
        Serial.print(current, 2);
        Serial.println(" mA");
        beginIndexerSequence();
    }
}

void updateIndexSearch()
{
    if (idxHallDetected(idxPosition))
    {
        stopIdxImmediately();

        // The special startup recovery is complete once position 1 is found.
        if (idxInitialSearchActive)
        {
            if (idxInitialSearchReversed)
                Serial.println("INDEXER: POSITION 1 FOUND COUNTERCLOCKWISE");
            else
                Serial.println("INDEXER: POSITION 1 FOUND CLOCKWISE");

            idxInitialSearchActive = false;
            idxInitialSearchReversed = false;
            stepperIdx.setCurrentPosition(0);
        }

        if (idxReturning)
        {
            Serial.println("INDEXER: BACK AT POSITION 1");
            stepperIdx.setCurrentPosition(0);
            beginOscillationSequence();
            return;
        }

        Serial.print("INDEXER: AT POSITION ");
        Serial.println(idxPosition + 1);

        char cmd[8];
        snprintf(cmd, sizeof(cmd), "M%dF", idxPosition + 1);
        sendCmd(cmd);

        idxWaitStart = millis();
        currentState = SystemState::INDEX_WAIT;
        return;
    }

    // Only the first position search has a short clockwise limit.
    // If that movement finishes without detecting position 1, reverse.
    if (
        idxInitialSearchActive &&
        !idxInitialSearchReversed &&
        stepperIdx.distanceToGo() == 0)
    {
        reverseInitialIdxSearch();
    }
}

void updateIndexWait()
{
    if (millis() - idxWaitStart < indexWaitTimes[idxPosition])
        return;

    char cmd[8];
    snprintf(cmd, sizeof(cmd), "M%dS", idxPosition + 1);
    sendCmd(cmd);

    idxPostStopStart = millis();
    currentState = SystemState::INDEX_POST_STOP;
}

void updateIndexPostStop()
{
    if (millis() - idxPostStopStart < IDX_POST_STOP_DELAY_MS)
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
    unsigned long now = millis();
    unsigned long runTime = now - valveTimerStart;

    // Normal time-based completion.
    if (runTime >= VALVE_OPEN_TIME_MS)
    {
        // Capture the motor current immediately before stopping so the
        // reported value represents the current at the timed stop moment.
        float currentAtStop = abs(ina219.getCurrent_mA());

        valveStop();
        saveValveState(ValveSavedState::OPEN);

        Serial.print("VALVE: OPENED after ");
        Serial.print(runTime);
        Serial.print(" ms at ");
        Serial.print(currentAtStop, 2);
        Serial.println(" mA");

        enterIdle("VALVE OPEN - READY");
        return;
    }

    // Ignore the normal startup-current surge.
    if (runTime <= VALVE_STARTUP_IGNORE_MS)
        return;

    if (now - valveLastCurrentSample < VALVE_CURRENT_SAMPLE_MS)
        return;

    valveLastCurrentSample = now;

    float current = abs(ina219.getCurrent_mA());

    // Reaching the opening-side resistance is a normal completion,
    // not a fault.
    if (current >= VALVE_OPEN_CURRENT_LIMIT_mA)
    {
        valveStop();
        saveValveState(ValveSavedState::OPEN);
        Serial.print("VALVE: OPENED at ");
        Serial.print(current, 2);
        Serial.println(" mA");
        enterIdle("VALVE OPEN - READY");
    }
}

// ---------------- Serial commands ----------------

String usbCommandBuffer;
String nodeCommandBuffer;

void processSerialCommand(String command, Stream& replyPort)
{
    command.trim();
    command.toUpperCase();

    if (command.length() == 0)
        return;

    if (command == "S" || command == "START")
    {
        if (currentState == SystemState::IDLE)
        {
            beginValveClosing();
            replyPort.println("ACK:START");
        }
        else
        {
            replyPort.println("BUSY");
        }
    }
    else if (command == "X" || command == "STOP")
    {
        if (currentState == SystemState::OSCILLATING)
        {
            requestOscStop();
            replyPort.println("ACK:STOP");
        }
        else
        {
            replyPort.println("NOT_OSCILLATING");
        }
    }
    else if (command == "CHECK_LEVELS")
    {
        sendLevelStates(replyPort);
    }
    else
    {
        replyPort.println("ERROR:UNKNOWN_COMMAND");
    }
}

void readSerialCommands(Stream& port, String& buffer)
{
    while (port.available())
    {
        char incoming = static_cast<char>(port.read());

        // Preserve the original one-byte lowercase commands.
        if (buffer.length() == 0 && (incoming == 's' || incoming == 'x'))
        {
            String legacyCommand(incoming);
            processSerialCommand(legacyCommand, port);
        }
        else if (incoming == '\n' || incoming == '\r')
        {
            if (buffer.length() > 0)
            {
                processSerialCommand(buffer, port);
                buffer = "";
            }
        }
        else if (buffer.length() < 64)
        {
            buffer += incoming;
        }
        else
        {
            buffer = "";
            port.println("ERROR:COMMAND_TOO_LONG");
        }
    }
}

void handleSerialCommands()
{
    readSerialCommands(Serial, usbCommandBuffer);
    readSerialCommands(Serial2, nodeCommandBuffer);
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

    for (uint8_t i = 0; i < 6; i++)
        mcp.pinMode(LEVEL_SENSOR_PINS[i], INPUT_PULLUP);
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
    digitalWrite(AIN1_PIN, LOW);
    digitalWrite(AIN2_PIN, LOW);

    ledcAttach(PWMA_PIN, VALVE_PWM_FREQ, VALVE_PWM_RESOLUTION);
    ledcWrite(PWMA_PIN, 0);

    if (!ina219.begin(&WireValve))
    {
        Serial.println("ERROR: INA219 not found!");
        while (true) { delay(1000); }
    }
}

void setup()
{
    Serial.begin(115200);
    Serial2.begin(SERIAL2_BAUD, SERIAL_8N1, RXD2, TXD2);

    initializeStatusLed();
    initializeValveStateStorage();
    initializeIoExpander();
    initializeSteppers();
    initializeValveHardware();

    Serial.println("READY");
    Serial.println("Commands: START (or S), STOP (or X), CHECK_LEVELS");
    Serial.println("Level response: LEVELS:PB0,PB1,PB2,PB3,PB4,PB5");
    Serial.println("Each level value is raw: 1 = HIGH, 0 = LOW");
    Serial.print("Stored valve state: ");
    Serial.println(valveStateName(savedValveState));
    Serial.print("Valve close limit: ");
    Serial.print(VALVE_CLOSE_CURRENT_LIMIT_mA, 0);
    Serial.println(" mA");
    Serial.print("Valve open limit/time: ");
    Serial.print(VALVE_OPEN_CURRENT_LIMIT_mA, 0);
    Serial.print(" mA or ");
    Serial.print(VALVE_OPEN_TIME_MS);
    Serial.println(" ms");
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
        case SystemState::INDEX_POST_STOP:
            updateIndexPostStop();
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
