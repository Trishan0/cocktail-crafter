#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>
#include <Preferences.h>
#include <ArduinoJson.h>

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

// IR detectors connected directly to ESP32
constexpr uint8_t IR_UPPER_PIN = 38;
constexpr uint8_t IR_LOWER_PIN = 39;

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

// Initial position-1 correction:
// Move clockwise by at most two index spacings. If position 1 is not found,
// reverse and search counterclockwise until the position-1 Hall sensor triggers.
constexpr long IDX_STEPS_BETWEEN_POSITIONS = 204;
constexpr long IDX_INITIAL_FORWARD_LIMIT = IDX_STEPS_BETWEEN_POSITIONS * 2;
constexpr uint8_t PUMP_COUNT = 6;
constexpr unsigned long MAX_PUMP_TIME_MS = 60000;
unsigned long indexWaitTimes[PUMP_COUNT] = {0, 0, 0, 0, 0, 0};
constexpr unsigned long IDX_POST_STOP_DELAY_MS = 3000;
constexpr unsigned long CLEAN_PUMP_TIME_MS = 5000;
constexpr unsigned long LINE_PRIME_PUMP_TIME_MS = 1400;

// Fault blink
constexpr uint8_t  FAULT_BLINK_COUNT  = 5;
constexpr uint16_t FAULT_BLINK_ON_MS  = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS = 250;

// Pinch-valve control
// Closing: current-controlled
constexpr float         VALVE_CLOSE_CURRENT_LIMIT_mA = 200.0f;

// Opening: stop at current limit or maximum time, whichever happens first
constexpr float         VALVE_OPEN_CURRENT_LIMIT_mA  = 150.0f;
constexpr unsigned long VALVE_OPEN_TIME_MS            = 1800;

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
Preferences          linePreferences;

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

// Persistent feed-line state. false = empty, true = primed near dispenser.
bool fluidLinesPrimed = false;
constexpr const char* LINE_PREF_NAMESPACE = "fluidLines";
constexpr const char* LINE_PREF_KEY       = "primed";

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
    VALVE_OPENING,
    REVERSE_PUMPS,
    PRIME_PUMPS
};

SystemState currentState = SystemState::IDLE;

enum class RunMode
{
    NONE,
    ORDER,
    CLEANING
};


RunMode currentRunMode = RunMode::NONE;

// Declared later with the loaded-order fields.
extern bool orderLoaded;

// ---------------- Non-blocking NeoPixel status system ----------------
//
// The LED pattern is derived from the actual state machine, so it cannot
// silently become out of sync with the mechanism.
//
// IDLE, no order        : dim blue heartbeat
// IDLE, order loaded    : cyan breathing
// Valve moving          : yellow breathing
// Indexer searching     : purple blinking
// Pump dispensing       : green breathing
// Mixing                : white breathing
// Homing/recovery       : blue/teal fast blinking
// Feed-line priming     : cyan fast blinking
// Reverse-pump sequence : magenta alternating
// Cleaning mode         : orange variants of active-stage patterns
// Homing success        : temporary green double flash
// Fault                 : temporary/continuous red fast flash

enum class LedOverlay : uint8_t
{
    NONE,
    HOME_SUCCESS,
    FAULT
};

LedOverlay ledOverlay = LedOverlay::NONE;
unsigned long ledOverlayStartedAt = 0;
unsigned long ledOverlayDurationMs = 0;

uint32_t lastLedColor = 0xFFFFFFFF;
constexpr uint8_t STATUS_LED_BRIGHTNESS = 70;

void writeStatusPixel(uint8_t red, uint8_t green, uint8_t blue)
{
    uint32_t color = pixel.Color(red, green, blue);

    if (color == lastLedColor)
        return;

    lastLedColor = color;
    pixel.setPixelColor(0, color);
    pixel.show();
}

uint8_t triangleBrightness(
    unsigned long now,
    unsigned long periodMs,
    uint8_t minimum,
    uint8_t maximum)
{
    if (periodMs < 2 || maximum <= minimum)
        return maximum;

    unsigned long position = now % periodMs;
    unsigned long halfPeriod = periodMs / 2;

    uint16_t range = static_cast<uint16_t>(maximum - minimum);
    uint16_t value;

    if (position < halfPeriod)
    {
        value = minimum +
            static_cast<uint16_t>(
                (position * range) / halfPeriod
            );
    }
    else
    {
        value = maximum -
            static_cast<uint16_t>(
                ((position - halfPeriod) * range) / halfPeriod
            );
    }

    return static_cast<uint8_t>(value);
}

bool blinkPhase(unsigned long now, unsigned long periodMs)
{
    return (now % periodMs) < (periodMs / 2);
}

void showLedOverlay(LedOverlay overlay, unsigned long durationMs)
{
    ledOverlay = overlay;
    ledOverlayStartedAt = millis();
    ledOverlayDurationMs = durationMs;
}

void updateStatusLed()
{
    unsigned long now = millis();

    if (
        ledOverlay != LedOverlay::NONE &&
        ledOverlayDurationMs > 0 &&
        now - ledOverlayStartedAt >= ledOverlayDurationMs)
    {
        ledOverlay = LedOverlay::NONE;
        ledOverlayDurationMs = 0;
    }

    if (ledOverlay == LedOverlay::FAULT)
    {
        if (blinkPhase(now, 240))
            writeStatusPixel(180, 0, 0);
        else
            writeStatusPixel(0, 0, 0);

        return;
    }

    if (ledOverlay == LedOverlay::HOME_SUCCESS)
    {
        // Two short green flashes during a one-second overlay.
        unsigned long phase = (now - ledOverlayStartedAt) % 1000;
        bool on =
            (phase < 150) ||
            (phase >= 300 && phase < 450);

        if (on)
            writeStatusPixel(0, 170, 20);
        else
            writeStatusPixel(0, 0, 0);

        return;
    }

    bool cleaning = currentRunMode == RunMode::CLEANING;

    switch (currentState)
    {
        case SystemState::IDLE:
        {
            if (orderLoaded)
            {
                uint8_t value =
                    triangleBrightness(now, 1800, 8, 100);
                writeStatusPixel(0, value, value);
            }
            else
            {
                // A quiet double-heartbeat confirms that firmware is alive.
                unsigned long phase = now % 2000;
                bool on =
                    phase < 90 ||
                    (phase >= 190 && phase < 280);

                if (on)
                    writeStatusPixel(0, 20, 90);
                else
                    writeStatusPixel(0, 0, 5);
            }
            break;
        }

        case SystemState::VALVE_CLOSING:
        case SystemState::VALVE_OPEN_DELAY:
        case SystemState::VALVE_OPENING:
        {
            uint8_t value =
                triangleBrightness(now, 900, 12, 115);

            if (cleaning)
                writeStatusPixel(value, value / 4, 0);
            else
                writeStatusPixel(value, value / 2, 0);

            break;
        }

        case SystemState::INDEX_SEARCH:
        case SystemState::INDEX_POST_STOP:
        {
            if (blinkPhase(now, 420))
            {
                if (cleaning)
                    writeStatusPixel(110, 30, 0);
                else
                    writeStatusPixel(75, 0, 120);
            }
            else
            {
                writeStatusPixel(4, 0, 8);
            }
            break;
        }

        case SystemState::INDEX_WAIT:
        {
            uint8_t value =
                triangleBrightness(now, 700, 15, 130);

            if (cleaning)
                writeStatusPixel(value, value / 3, 0);
            else
                writeStatusPixel(0, value, 10);

            break;
        }

        case SystemState::OSCILLATING:
        {
            uint8_t value =
                triangleBrightness(now, 520, 18, 145);

            if (cleaning)
                writeStatusPixel(value, value / 3, 0);
            else
                writeStatusPixel(value, value, value);

            break;
        }

        case SystemState::HOMING:
        case SystemState::RECOVERY_NEGATIVE:
        case SystemState::RECOVERY_POSITIVE:
        {
            if (blinkPhase(now, 260))
            {
                if (cleaning)
                    writeStatusPixel(130, 35, 0);
                else
                    writeStatusPixel(0, 80, 140);
            }
            else
            {
                writeStatusPixel(0, 0, 4);
            }
            break;
        }

        case SystemState::PRIME_PUMPS:
        {
            if (blinkPhase(now, 300))
                writeStatusPixel(0, 115, 125);
            else
                writeStatusPixel(0, 8, 10);
            break;
        }

        case SystemState::REVERSE_PUMPS:
        {
            if (blinkPhase(now, 360))
                writeStatusPixel(125, 0, 80);
            else
                writeStatusPixel(10, 0, 5);
            break;
        }
    }
}

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

// Reverse-pump maintenance sequence
constexpr unsigned long PUMP_REVERSE_TIME_MS = 4000;
uint8_t reversePumpNumber = 0;
unsigned long reversePumpStartTime = 0;

// Automatic feed-line priming before the first order after reversal.
uint8_t primePumpNumber = 0;
unsigned long primePumpStartTime = 0;

// Loaded order received from the Raspberry Pi
bool orderLoaded = false;
bool orderIceEnabled = false;
String loadedOrderId;

// ---------------- Hall sensors ----------------

bool oscHallDetected()
{
    return mcp.digitalRead(OSC_HALL_PIN) == LOW;
}

bool idxHallDetected(uint8_t index)
{
    return mcp.digitalRead(IDX_HALL_PINS[index]) == LOW;
}

// ---------------- Structured serial output ----------------

void sendLog(Stream& output, const char* message)
{
    output.print("LOG:");
    output.println(message);
}

void sendLog(const char* message)
{
    sendLog(Serial, message);
}

void sendSystemReadyData()
{
    Serial.println("DATA:{\"type\":\"system\",\"event\":\"ready\"}");
}

void sendPumpData(uint8_t pump, const char* action)
{
    Serial.print("DATA:{\"type\":\"system\",\"event\":\"pump\",\"pump\":");
    Serial.print(pump);
    Serial.print(",\"action\":\"");
    Serial.print(action);
    Serial.println("\"}");
}

void sendMixingData(const char* action)
{
    Serial.print("DATA:{\"type\":\"system\",\"event\":\"mixing\",\"action\":\"");
    Serial.print(action);
    Serial.println("\"}");
}

void sendValveOpenedData()
{
    Serial.println("DATA:{\"type\":\"system\",\"event\":\"valve\",\"action\":\"opened\"}");
}

void sendReversePumpsData(const char* action)
{
    Serial.print("DATA:{\"type\":\"system\",\"event\":\"reverse_pumps\",\"action\":\"");
    Serial.print(action);
    Serial.println("\"}");
}

void sendCleaningData(const char* action)
{
    Serial.print("DATA:{\"type\":\"system\",\"event\":\"cleaning\",\"action\":\"");
    Serial.print(action);
    Serial.println("\"}");
}

void sendLinePrimingData(const char* action)
{
    Serial.print("DATA:{\"type\":\"system\",\"event\":\"line_priming\",\"action\":\"");
    Serial.print(action);
    Serial.println("\"}");
}

void sendLineStateResponse(Stream& output)
{
    output.print("DATA:{\"type\":\"response\",\"command\":\"CHECK_LINE_STATE\",\"primed\":");
    output.print(fluidLinesPrimed ? "true" : "false");
    output.print(",\"state\":\"");
    output.print(fluidLinesPrimed ? "PRIMED" : "EMPTY");
    output.println("\"}");
}

// ---------------- ORDER JSON handling ----------------

void sendOrderResponse(
    Stream& output,
    const char* status,
    const char* reason = nullptr)
{
    JsonDocument response;
    response["type"] = "response";
    response["command"] = "ORDER";
    response["status"] = status;

    if (reason != nullptr)
        response["reason"] = reason;

    if (strcmp(status, "initialized") == 0)
    {
        response["order_id"] = loadedOrderId;
        response["ice"] = orderIceEnabled;

        JsonArray pumps = response["pumps"].to<JsonArray>();
        for (uint8_t i = 0; i < PUMP_COUNT; i++)
        {
            if (indexWaitTimes[i] == 0)
                continue;

            JsonObject pump = pumps.add<JsonObject>();
            pump["pump"] = i + 1;
            pump["time_ms"] = indexWaitTimes[i];
        }
    }

    output.print("DATA:");
    serializeJson(response, output);
    output.println();
}

bool parseOrderJson(const String& jsonMessage, Stream& replyPort)
{
    if (currentState != SystemState::IDLE)
    {
        sendOrderResponse(replyPort, "rejected", "busy");
        return false;
    }

    JsonDocument document;
    DeserializationError error = deserializeJson(document, jsonMessage);

    if (error)
    {
        Serial.print("LOG:ORDER JSON PARSE FAILED: ");
        Serial.println(error.c_str());
        sendOrderResponse(replyPort, "rejected", "invalid_json");
        return false;
    }

    const char* command = document["command"] | "";
    if (strcmp(command, "ORDER") != 0)
    {
        sendOrderResponse(replyPort, "rejected", "invalid_command");
        return false;
    }

    const char* orderId = document["order_id"] | "";
    if (strlen(orderId) == 0)
    {
        sendOrderResponse(replyPort, "rejected", "missing_order_id");
        return false;
    }

    JsonArray pumps = document["pumps"].as<JsonArray>();
    if (pumps.isNull() || pumps.size() == 0)
    {
        sendOrderResponse(replyPort, "rejected", "missing_pumps");
        return false;
    }

    unsigned long newPumpTimes[PUMP_COUNT] = {0, 0, 0, 0, 0, 0};
    bool pumpSeen[PUMP_COUNT] = {false, false, false, false, false, false};

    for (JsonObject pumpEntry : pumps)
    {
        int pumpNumber = pumpEntry["pump"] | 0;
        long pumpTime = pumpEntry["time_ms"] | -1;

        if (pumpNumber < 1 || pumpNumber > PUMP_COUNT)
        {
            sendOrderResponse(replyPort, "rejected", "invalid_pump_number");
            return false;
        }

        if (pumpTime <= 0 || pumpTime > static_cast<long>(MAX_PUMP_TIME_MS))
        {
            sendOrderResponse(replyPort, "rejected", "invalid_pump_time");
            return false;
        }

        uint8_t pumpIndex = static_cast<uint8_t>(pumpNumber - 1);
        if (pumpSeen[pumpIndex])
        {
            sendOrderResponse(replyPort, "rejected", "duplicate_pump");
            return false;
        }

        pumpSeen[pumpIndex] = true;
        newPumpTimes[pumpIndex] = static_cast<unsigned long>(pumpTime);
    }

    for (uint8_t i = 0; i < PUMP_COUNT; i++)
        indexWaitTimes[i] = newPumpTimes[i];

    loadedOrderId = orderId;
    orderIceEnabled = document["ice"]["enabled"] | false;
    orderLoaded = true;

    Serial.print("LOG:ORDER INITIALIZED: ");
    Serial.println(loadedOrderId);

    for (uint8_t i = 0; i < PUMP_COUNT; i++)
    {
        Serial.print("LOG:PUMP ");
        Serial.print(i + 1);
        Serial.print(" TIME: ");
        Serial.print(indexWaitTimes[i]);
        Serial.println(" ms");
    }

    Serial.print("LOG:ICE: ");
    Serial.println(orderIceEnabled ? "ENABLED" : "DISABLED");

    sendOrderResponse(replyPort, "initialized");
    return true;
}

// ---------------- Liquid-level sensors ----------------

void sendLevelStates(Stream& output)
{
    output.print("DATA:{\"type\":\"response\",\"command\":\"CHECK_LEVELS\"");

    for (uint8_t i = 0; i < 6; i++)
    {
        uint8_t state = mcp.digitalRead(LEVEL_SENSOR_PINS[i]) == HIGH ? 1 : 0;
        output.print(",\"ls");
        output.print(i + 1);
        output.print("\":");
        output.print(state);
    }

    output.println("}");
}

// ---------------- IR detectors ----------------

void sendIrStates(Stream& output)
{
    uint8_t upper = digitalRead(IR_UPPER_PIN) == HIGH ? 1 : 0;
    uint8_t lower = digitalRead(IR_LOWER_PIN) == HIGH ? 1 : 0;

    output.print("DATA:{\"type\":\"response\",\"command\":\"CHECK_IR\",\"upper\":");
    output.print(upper);
    output.print(",\"lower\":");
    output.print(lower);
    output.println("}");
}

// ---------------- UART2 command relay ----------------

void sendCmd(const char* cmd, bool sendPumpJson = true)
{
    Serial2.println(cmd);

    Serial.print("LOG:TX2: ");
    Serial.println(cmd);

    // Main-sequence pump commands use JSON. The reverse-cleaning sequence
    // passes false so its individual pump operations remain LOG-only.
    if (sendPumpJson && cmd[0] == 'M' && cmd[1] >= '1' && cmd[1] <= '6')
    {
        uint8_t pump = static_cast<uint8_t>(cmd[1] - '0');

        if (cmd[2] == 'F')
            sendPumpData(pump, "forward");
        else if (cmd[2] == 'S')
            sendPumpData(pump, "stop");
    }
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

    Serial.print("LOG:VALVE STATE: ");
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

    Serial.print("LOG:VALVE STORED STATE: ");
    Serial.println(valveStateName(savedValveState));
}

// ---------------- Persistent fluid-line state ----------------

void saveFluidLinesPrimed(bool primed)
{
    fluidLinesPrimed = primed;
    linePreferences.putBool(LINE_PREF_KEY, primed);

    Serial.print("LOG:FLUID LINES: ");
    Serial.println(primed ? "PRIMED" : "EMPTY");
}

void initializeFluidLineStateStorage()
{
    linePreferences.begin(LINE_PREF_NAMESPACE, false);
    fluidLinesPrimed = linePreferences.getBool(LINE_PREF_KEY, false);

    Serial.print("LOG:STORED FLUID LINE STATE: ");
    Serial.println(fluidLinesPrimed ? "PRIMED" : "EMPTY");
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

    long target = stepperIdx.currentPosition() + IDX_INITIAL_FORWARD_LIMIT;
    stepperIdx.moveTo(target);

    Serial.print("LOG:INDEXER: SEARCHING POSITION 1 CLOCKWISE FOR ");
    Serial.print(IDX_INITIAL_FORWARD_LIMIT);
    Serial.println(" STEPS");
}

void reverseInitialIdxSearch()
{
    idxInitialSearchReversed = true;

    long target = stepperIdx.currentPosition() - IDX_SEARCH_DISTANCE;
    stepperIdx.moveTo(target);

    Serial.println(
        "LOG:INDEXER: POSITION 1 NOT FOUND, SEARCHING COUNTERCLOCKWISE"
    );
}

// ---------------- Sequence stages ----------------

void beginIndexerSequence();

void enterIdle(const char* msg)
{
    currentState = SystemState::IDLE;
    Serial.print("LOG:");
    Serial.println(msg);
}

void beginValveClosing()
{
    if (savedValveState == ValveSavedState::CLOSED)
    {
        Serial.println("LOG:VALVE: ALREADY CLOSED");
        beginIndexerSequence();
        return;
    }

    Serial.println("LOG:VALVE: CLOSING");
    saveValveState(ValveSavedState::CLOSING);
    valveClose();
    valveTimerStart = millis();
    valveLastCurrentSample = 0;
    currentState = SystemState::VALVE_CLOSING;
}

void beginIndexerSequence()
{
    Serial.println("LOG:INDEXER: STARTING CYCLE");
    idxPosition  = 0;
    idxReturning = false;
    startInitialIdxSearch();
    currentState = SystemState::INDEX_SEARCH;
}

void beginOscillationSequence()
{
    Serial.println("LOG:OSC: START");
    sendMixingData("started");
    stopRequested = false;
    oscLegCount   = 0;
    currentState  = SystemState::OSCILLATING;
    startOscLeg(false);
}

void requestOscStop()
{
    Serial.println("LOG:OSC: STOP REQUESTED");
    stopRequested = true;
}

void beginHomingSequence()
{
    Serial.println("LOG:OSC: RETURNING HOME");
    currentState = SystemState::HOMING;
    stepperOsc.moveTo(0);
}

void beginRecoveryNegative()
{
    Serial.println("LOG:OSC: HOME NOT FOUND, RECOVERY SEARCH NEGATIVE");
    currentState = SystemState::RECOVERY_NEGATIVE;
    stepperOsc.moveTo(-RECOVERY_OFFSET);
}

void beginRecoveryPositive()
{
    Serial.println("LOG:OSC: RECOVERY SEARCH POSITIVE");
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
    Serial.println("LOG:VALVE: OPENING");
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

    // Non-blocking double green success flash.
    showLedOverlay(LedOverlay::HOME_SUCCESS, 1000);

    Serial.println("LOG:OSC: HOMED");
    beginValveOpenDelay();
}

void reportFatalHomingFailure()
{
    Serial.println("LOG:OSC: HOME SEARCH FAILED");
    stopOscImmediately();
    stopRequested = false;

    // Five non-blocking red flashes while the recovery sequence continues.
    showLedOverlay(
        LedOverlay::FAULT,
        FAULT_BLINK_COUNT *
            (FAULT_BLINK_ON_MS + FAULT_BLINK_OFF_MS)
    );

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
        Serial.print("LOG:VALVE: CLOSED at ");
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

        // Position 1 has been found, so the special correction search is done.
        if (idxInitialSearchActive)
        {
            if (idxInitialSearchReversed)
            {
                Serial.println(
                    "LOG:INDEXER: POSITION 1 FOUND COUNTERCLOCKWISE"
                );
            }
            else
            {
                Serial.println(
                    "LOG:INDEXER: POSITION 1 FOUND CLOCKWISE"
                );
            }

            idxInitialSearchActive = false;
            idxInitialSearchReversed = false;
            stepperIdx.setCurrentPosition(0);
        }

        if (idxReturning)
        {
            Serial.println("LOG:INDEXER: BACK AT POSITION 1");
            stepperIdx.setCurrentPosition(0);
            beginOscillationSequence();
            return;
        }

        Serial.print("LOG:INDEXER: AT POSITION ");
        Serial.println(idxPosition + 1);

        // Cleaning uses only position 1 and pump 1 for five seconds.
        if (currentRunMode == RunMode::CLEANING)
        {
            if (idxPosition != 0)
            {
                Serial.println("LOG:CLEANING: UNEXPECTED INDEX POSITION");
                beginOscillationSequence();
                return;
            }

            sendCmd("M1F");
            idxWaitStart = millis();
            currentState = SystemState::INDEX_WAIT;
            return;
        }

        if (indexWaitTimes[idxPosition] == 0)
        {
            Serial.print("LOG:PUMP ");
            Serial.print(idxPosition + 1);
            Serial.println(" SKIPPED");

            idxPostStopStart = millis() - IDX_POST_STOP_DELAY_MS;
            currentState = SystemState::INDEX_POST_STOP;
            return;
        }

        char cmd[8];
        snprintf(cmd, sizeof(cmd), "M%dF", idxPosition + 1);
        sendCmd(cmd);

        idxWaitStart = millis();
        currentState = SystemState::INDEX_WAIT;
        return;
    }

    // During only the initial position-1 search, stop after two index spacings
    // clockwise and reverse if the Hall sensor was not detected.
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
    unsigned long requiredTime =
        currentRunMode == RunMode::CLEANING
            ? CLEAN_PUMP_TIME_MS
            : indexWaitTimes[idxPosition];

    if (millis() - idxWaitStart < requiredTime)
        return;

    char cmd[8];
    snprintf(cmd, sizeof(cmd), "M%dS", idxPosition + 1);
    sendCmd(cmd);

    if (currentRunMode == RunMode::CLEANING)
    {
        Serial.println("LOG:CLEANING: WATER DISPENSE COMPLETED");
        beginOscillationSequence();
        return;
    }

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
        Serial.println("LOG:INDEXER: RETURNING TO POSITION 1");
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
        Serial.println("LOG:OSC: LOOP TARGET REACHED");
        sendMixingData("stopped");
        beginHomingSequence();
        return;
    }

    startOscLeg(!nextLegIsNegative);
}

bool checkOscHallDuringSearch()
{
    if (oscHallDetected())
    {
        Serial.println("LOG:OSC: HOME CONFIRMED");
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

void finishActiveRun()
{
    if (currentRunMode == RunMode::CLEANING)
    {
        Serial.println("LOG:CLEANING SEQUENCE FINISHED");
        sendCleaningData("finished");
        currentRunMode = RunMode::NONE;
        // Deliberately preserve any previously loaded customer order.
    }
    else if (currentRunMode == RunMode::ORDER)
    {
        orderLoaded = false;
        loadedOrderId = "";
        currentRunMode = RunMode::NONE;
    }
}

void updateValveOpening()
{
    unsigned long now = millis();
    unsigned long runTime = now - valveTimerStart;

    // Normal time-based completion.
    if (runTime >= VALVE_OPEN_TIME_MS)
    {
        float current = abs(ina219.getCurrent_mA());
        valveStop();
        saveValveState(ValveSavedState::OPEN);
        Serial.print("LOG:VALVE: OPENED after ");
        Serial.print(runTime);
        Serial.print(" ms at ");
        Serial.print(current, 2);
        Serial.println(" mA");
        sendValveOpenedData();
        finishActiveRun();
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
        Serial.print("LOG:VALVE: OPENED at ");
        Serial.print(current, 2);
        Serial.println(" mA");
        sendValveOpenedData();
        finishActiveRun();
        enterIdle("VALVE OPEN - READY");
    }
}

// ---------------- Automatic feed-line priming ----------------

void startCurrentPumpPrime()
{
    char command[8];
    snprintf(command, sizeof(command), "M%dF", primePumpNumber);
    sendCmd(command, false);

    Serial.print("LOG:PUMP ");
    Serial.print(primePumpNumber);
    Serial.println(" PRIMING");

    primePumpStartTime = millis();
}

void beginPrimePumpsForOrder()
{
    Serial.println("LOG:FLUID LINE PRIMING STARTED");
    sendLinePrimingData("started");

    primePumpNumber = 1;
    currentState = SystemState::PRIME_PUMPS;
    startCurrentPumpPrime();
}

void updatePrimePumps()
{
    if (millis() - primePumpStartTime < LINE_PRIME_PUMP_TIME_MS)
        return;

    char stopCommand[8];
    snprintf(stopCommand, sizeof(stopCommand), "M%dS", primePumpNumber);
    sendCmd(stopCommand, false);

    Serial.print("LOG:PUMP ");
    Serial.print(primePumpNumber);
    Serial.println(" PRIMING COMPLETED");

    if (primePumpNumber >= PUMP_COUNT)
    {
        saveFluidLinesPrimed(true);
        Serial.println("LOG:FLUID LINE PRIMING FINISHED");
        sendLinePrimingData("finished");

        // Continue automatically into the already loaded order.
        beginValveClosing();
        return;
    }

    primePumpNumber++;
    startCurrentPumpPrime();
}

// ---------------- Reverse-pump sequence ----------------

void startCurrentPumpReverse()
{
    char command[8];
    snprintf(command, sizeof(command), "M%dR", reversePumpNumber);
    sendCmd(command, false);

    Serial.print("LOG:PUMP ");
    Serial.print(reversePumpNumber);
    Serial.println(" REVERSING");

    reversePumpStartTime = millis();
}

void beginReversePumps()
{
    Serial.println("LOG:REVERSE PUMPS SEQUENCE STARTED");
    sendReversePumpsData("started");

    reversePumpNumber = 1;
    currentState = SystemState::REVERSE_PUMPS;
    startCurrentPumpReverse();
}

void updateReversePumps()
{
    if (millis() - reversePumpStartTime < PUMP_REVERSE_TIME_MS)
        return;

    char stopCommand[8];
    snprintf(stopCommand, sizeof(stopCommand), "M%dS", reversePumpNumber);
    sendCmd(stopCommand, false);

    Serial.print("LOG:PUMP ");
    Serial.print(reversePumpNumber);
    Serial.println(" REVERSE COMPLETED");

    if (reversePumpNumber >= 6)
    {
        currentState = SystemState::IDLE;
        saveFluidLinesPrimed(false);
        Serial.println("LOG:REVERSE PUMPS SEQUENCE FINISHED");
        sendReversePumpsData("finished");
        return;
    }

    reversePumpNumber++;
    startCurrentPumpReverse();
}

// ---------------- Serial commands ----------------

String usbCommandBuffer;
String nodeCommandBuffer;

void processSerialCommand(String command, Stream& replyPort)
{
    command.trim();

    if (command.length() == 0)
        return;

    // JSON must be parsed before uppercasing plain-text commands.
    if (command.startsWith("{"))
    {
        parseOrderJson(command, replyPort);
        return;
    }

    command.toUpperCase();

    if (command == "S" || command == "START")
    {
        if (currentState != SystemState::IDLE)
        {
            replyPort.println("LOG:BUSY");
        }
        else if (!orderLoaded)
        {
            replyPort.println("LOG:NO_ORDER_LOADED");
        }
        else
        {
            currentRunMode = RunMode::ORDER;

            if (fluidLinesPrimed)
            {
                beginValveClosing();
            }
            else
            {
                beginPrimePumpsForOrder();
            }

            replyPort.println("LOG:ACK:START");
        }
    }
    else if (command == "CLEAN")
    {
        if (currentState != SystemState::IDLE)
        {
            replyPort.println("LOG:BUSY");
        }
        else
        {
            currentRunMode = RunMode::CLEANING;
            Serial.println("LOG:CLEANING SEQUENCE STARTED");
            sendCleaningData("started");
            beginValveClosing();
            replyPort.println("LOG:ACK:CLEAN");
        }
    }
    else if (command == "X" || command == "STOP")
    {
        if (currentState == SystemState::OSCILLATING)
        {
            requestOscStop();
            replyPort.println("LOG:ACK:STOP");
        }
        else
        {
            replyPort.println("LOG:NOT_OSCILLATING");
        }
    }
    else if (command == "CHECK_LEVELS")
    {
        sendLevelStates(replyPort);
    }
    else if (command == "CHECK_IR")
    {
        sendIrStates(replyPort);
    }
    else if (command == "CHECK_LINE_STATE")
    {
        sendLineStateResponse(replyPort);
    }
    else if (command == "REVERSE_PUMPS")
    {
        if (currentState == SystemState::IDLE)
        {
            beginReversePumps();
            replyPort.println("LOG:ACK:REVERSE_PUMPS");
        }
        else
        {
            replyPort.println("LOG:BUSY");
        }
    }
    else
    {
        replyPort.println("LOG:ERROR:UNKNOWN_COMMAND");
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
        else if (buffer.length() < 512)
        {
            buffer += incoming;
        }
        else
        {
            buffer = "";
            port.println("LOG:ERROR:COMMAND_TOO_LONG");
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
    pixel.setBrightness(STATUS_LED_BRIGHTNESS);
    pixel.clear();
    pixel.show();
    lastLedColor = 0;
}

void initializeIoExpander()
{
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

    if (!mcp.begin_I2C(MCP_I2C_ADDR))
    {
        Serial.println("LOG:ERROR: MCP23017 not found!");
        showLedOverlay(LedOverlay::FAULT, 0);
        while (true)
        {
            updateStatusLed();
            delay(1);
        }
    }

    mcp.pinMode(OSC_HALL_PIN, INPUT_PULLUP);
    for (uint8_t i = 0; i < 6; i++)
        mcp.pinMode(IDX_HALL_PINS[i], INPUT_PULLUP);

    for (uint8_t i = 0; i < 6; i++)
        mcp.pinMode(LEVEL_SENSOR_PINS[i], INPUT_PULLUP);
}

void initializeIrDetectors()
{
    pinMode(IR_UPPER_PIN, INPUT_PULLUP);
    pinMode(IR_LOWER_PIN, INPUT_PULLUP);
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
        Serial.println("LOG:OSC: HOME DETECTED AT STARTUP");
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
        Serial.println("LOG:ERROR: INA219 not found!");
        showLedOverlay(LedOverlay::FAULT, 0);
        while (true)
        {
            updateStatusLed();
            delay(1);
        }
    }
}

void setup()
{
    Serial.begin(115200);
    Serial2.begin(SERIAL2_BAUD, SERIAL_8N1, RXD2, TXD2);

    initializeStatusLed();
    initializeValveStateStorage();
    initializeFluidLineStateStorage();
    initializeIoExpander();
    initializeIrDetectors();
    initializeSteppers();
    initializeValveHardware();

    Serial.println("LOG:READY");
    Serial.println("LOG:Commands: ORDER JSON, START (or S), CLEAN, STOP (or X), CHECK_LEVELS, CHECK_IR, CHECK_LINE_STATE, REVERSE_PUMPS");
    Serial.println("LOG:Level response: DATA JSON using ls1..ls6");
    Serial.println("LOG:Sensor values are raw: 1 = HIGH, 0 = LOW");
    Serial.print("LOG:Stored valve state: ");
    Serial.println(valveStateName(savedValveState));
    Serial.print("LOG:Stored fluid line state: ");
    Serial.println(fluidLinesPrimed ? "PRIMED" : "EMPTY");
    Serial.print("LOG:Valve close limit: ");
    Serial.print(VALVE_CLOSE_CURRENT_LIMIT_mA, 0);
    Serial.println(" mA");
    Serial.print("LOG:Valve open limit/time: ");
    Serial.print(VALVE_OPEN_CURRENT_LIMIT_mA, 0);
    Serial.print(" mA or ");
    Serial.print(VALVE_OPEN_TIME_MS);
    Serial.println(" ms");

    sendSystemReadyData();
}

// ---------------- Main loop ----------------

void loop()
{
    stepperOsc.run();
    stepperIdx.run();

    handleSerialCommands();
    updateStatusLed();

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
        case SystemState::REVERSE_PUMPS:
            updateReversePumps();
            break;
        case SystemState::PRIME_PUMPS:
            updatePrimePumps();
            break;
    }
}
