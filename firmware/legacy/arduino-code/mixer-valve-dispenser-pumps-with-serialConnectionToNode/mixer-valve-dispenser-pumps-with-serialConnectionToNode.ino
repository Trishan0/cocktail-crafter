/*
 * Cocktail-Craft — ESP32 Dispenser Controller
 *
 * Receives newline-terminated JSON commands from the Raspberry Pi over USB Serial.
 * Controls the indexer stepper, oscillator stepper, valve (TB6612), and status LED.
 * Relays pump on/off timing commands to the NodeMCU sub-controller via UART2.
 * Reads two IR sensors to detect glass presence/size before dispensing.
 *
 * ── Command interface  (Pi → ESP32) ──────────────────────────────────────────
 *   Start an order:
 *     {"cmd":"ORDER","order_id":5,"pumps":[{"i":1,"t":33333},{"i":3,"t":6666}],"ice":0,"required_glass":"large"}
 *     pumps[].i  = pump/indexer position (1-6)
 *     pumps[].t  = dispense time in milliseconds (calculated by Pi from ml + flow_rate)
 *     Only active pumps are listed; omitted pumps default to 0 ms (skip).
 *     required_glass = "any" | "large"; large rejects a lower-only IR hit.
 *
 *   Bypass glass sensor (operator override — IR sensors not yet wired):
 *     {"cmd":"GLASS_OK"}
 *     Received while VALVE_CLOSING or GLASS_WAIT; proceeds as if glass was physically detected.
 *
 *   Abort current order:
 *     {"cmd":"ABORT"}
 *
 *   Manual clean cycle (admin):
 *     {"cmd":"CLEAN"}
 *
 * ── Status interface  (ESP32 → Pi) ───────────────────────────────────────────
 *   {"type":"STATUS","machine_status":"<state>","progress":<0-100>,"message":"...","order_id":<n>}
 *   machine_status values:
 *     "idle" | "waiting_glass" | "dispensing" | "mixing" | "done" | "aborted" | "error"
 *
 * ── Sensor interface  (ESP32 → Pi) ───────────────────────────────────────────
 *   {"type":"SENSOR","glass_state":"<state>"}
 *   glass_state values:
 *     "no_glass" | "small_glass" | "large_glass" | "sensor_error"
 *   Sent whenever glass state changes during GLASS_WAIT.
 *   Also sent once on entering GLASS_WAIT (initial reading).
 */

#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_INA219.h>
#include <ArduinoJson.h>

// ── UART2 — command relay to NodeMCU ─────────────────────────────────────────
#define RXD2 18
#define TXD2 17
constexpr unsigned long SERIAL2_BAUD = 9600;

// ── I2C — MCP23017 (hall sensors) ────────────────────────────────────────────
constexpr uint8_t I2C_SDA_PIN  = 8;
constexpr uint8_t I2C_SCL_PIN  = 9;
constexpr uint8_t MCP_I2C_ADDR = 0x20;

// ── I2C — INA219 (valve current sense, second bus) ───────────────────────────
constexpr uint8_t INA_SDA_PIN = 1;
constexpr uint8_t INA_SCL_PIN = 2;

// ── NeoPixel status LED ───────────────────────────────────────────────────────
constexpr uint8_t  LED_PIN   = 48;
constexpr uint16_t LED_COUNT = 1;

// ── Shared enable line for both steppers ─────────────────────────────────────
constexpr uint8_t EN_PIN = 16;

// ── Oscillator stepper ────────────────────────────────────────────────────────
constexpr uint8_t OSC_STEP_PIN = 12;
constexpr uint8_t OSC_DIR_PIN  = 13;
constexpr uint8_t OSC_HALL_PIN = 0;   // MCP PA0

// ── Indexer stepper ───────────────────────────────────────────────────────────
constexpr uint8_t IDX_STEP_PIN = 10;
constexpr uint8_t IDX_DIR_PIN  = 11;
constexpr uint8_t IDX_HALL_PINS[6] = {1, 2, 3, 4, 5, 6};  // MCP PA1..PA6

// ── TB6612 valve driver ───────────────────────────────────────────────────────
constexpr uint8_t  STBY_PIN = 4;
constexpr uint8_t  PWMA_PIN = 5;
constexpr uint8_t  AIN1_PIN = 6;
constexpr uint8_t  AIN2_PIN = 7;
constexpr uint32_t VALVE_PWM_FREQ       = 20000;
constexpr uint8_t  VALVE_PWM_RESOLUTION = 8;
constexpr uint8_t  VALVE_MOTOR_SPEED    = 255;

// ── IR Glass Sensors ──────────────────────────────────────────────────────────
// Two IR sensors positioned at different heights in the glass cradle:
//   IR_LOWER: detects both small and large glasses (beam at low position)
//   IR_UPPER: detects large glasses only          (beam at higher position)
// Wiring: sensor OUTPUT → GPIO pin, INPUT_PULLUP, LOW = beam broken = glass present.
// !! CHANGE THESE PINS to match your actual wiring !!
constexpr uint8_t IR_LOWER_PIN = 38;  // lower beam — small & large glass
constexpr uint8_t IR_UPPER_PIN = 39;  // upper beam — large glass only

// Glass polling interval while in GLASS_WAIT
constexpr unsigned long GLASS_POLL_MS = 150;

// ── Oscillator motion constants ───────────────────────────────────────────────
constexpr long  OSC_HALF_RANGE   = 800;
constexpr long  RECOVERY_OFFSET  = 400;
constexpr float OSC_MAX_SPEED    = 20000.0f;
constexpr float OSC_ACCELERATION = 10000.0f;
constexpr int   OSC_TARGET_LOOPS = 5;               // 1 loop = one out + one back
constexpr int   OSC_TARGET_LEGS  = OSC_TARGET_LOOPS * 2;

// ── Indexer motion constants ──────────────────────────────────────────────────
constexpr long  IDX_SEARCH_DISTANCE    = 100000;
constexpr float IDX_SEARCH_SPEED       = 400.0f;
constexpr float IDX_ACCELERATION       = 5000.0f;
constexpr unsigned long IDX_POST_STOP_DELAY_MS = 1000;

// ── Valve current-sense / timing constants ────────────────────────────────────
constexpr float         VALVE_CURRENT_LIMIT_mA  = 600.0f;
constexpr unsigned long VALVE_STARTUP_IGNORE_MS = 500;
constexpr unsigned long VALVE_OPEN_TIME_MS      = 5300;
constexpr unsigned long HOME_TO_VALVE_DELAY_MS  = 1000;

// ── Fault blink ───────────────────────────────────────────────────────────────
constexpr uint8_t  FAULT_BLINK_COUNT  = 5;
constexpr uint16_t FAULT_BLINK_ON_MS  = 250;
constexpr uint16_t FAULT_BLINK_OFF_MS = 250;

// ── Hardware objects ──────────────────────────────────────────────────────────
Adafruit_MCP23X17 mcp;
Adafruit_NeoPixel  pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
AccelStepper       stepperOsc(AccelStepper::DRIVER, OSC_STEP_PIN, OSC_DIR_PIN);
AccelStepper       stepperIdx(AccelStepper::DRIVER, IDX_STEP_PIN, IDX_DIR_PIN);
Adafruit_INA219    ina219;
TwoWire            WireValve = TwoWire(1);

// ── State machine ─────────────────────────────────────────────────────────────
enum class SystemState
{
    IDLE,
    PUMP_REVERSING,
    VALVE_CLOSING,
    GLASS_WAIT,         // NEW: wait for glass detection (IR sensors or GLASS_OK bypass)
    INDEX_SEARCH,
    INDEX_WAIT,
    INDEX_POST_STOP,
    OSCILLATING,
    HOMING,
    RECOVERY_NEGATIVE,
    RECOVERY_POSITIVE,
    VALVE_OPEN_DELAY,
    VALVE_OPENING,
    POST_DRINK_WAIT
};

SystemState currentState = SystemState::IDLE;

// ── Motion state ──────────────────────────────────────────────────────────────
bool stopRequested    = false;
bool nextLegIsNegative = false;
int  oscLegCount       = 0;

int           idxPosition      = 0;
bool          idxReturning     = false;
unsigned long idxWaitStart     = 0;
unsigned long idxPostStopStart = 0;

unsigned long valveTimerStart = 0;

// ── Glass-wait state ──────────────────────────────────────────────────────────
// glassOkReceived: set true when {"cmd":"GLASS_OK"} arrives from Pi (bypass).
// lastGlassState:  tracks last reported glass state so we only send SENSOR
//                  messages when the glass state actually changes.
// lastGlassPollMs: millis() of the last sensor poll.
bool          glassOkReceived  = false;
unsigned long lastGlassPollMs  = 0;
bool          orderRequiresLargeGlass = false;
bool          postOrderCleanMode = false;

enum class GlassState
{
    NO_GLASS,
    SMALL_GLASS,
    LARGE_GLASS,
    SENSOR_ERROR   // upper LOW but lower HIGH — physically impossible if sensors ok
};
GlassState lastReportedGlass = GlassState::NO_GLASS;

// ── Dispense timing — loaded from ORDER command ───────────────────────────────
// indexWaitTimes[i] = ms to wait at indexer position i+1 (0 = skip / not in this drink)
unsigned long indexWaitTimes[6] = {0, 0, 0, 0, 0, 0};
unsigned long reversePumpTimes[6] = {0, 0, 0, 0, 0, 0};
bool reversePumpRunning[6] = {false, false, false, false, false, false};
unsigned long reversePumpStart = 0;

// ── Order tracking ────────────────────────────────────────────────────────────
int  currentOrderId   = -1;
bool iceEnabled       = false;
int  activePumpCount  = 0;    // pumps with t > 0 in this order, for progress calc

// ── Serial line buffer ────────────────────────────────────────────────────────
static char s_buf[512];
static int  s_len = 0;

bool cleanCycleMode = false;

// =============================================================================
//  STATUS REPORTER  (ESP32 → Pi)
// =============================================================================

void sendStatus(const char* machineStatus, int progress, const char* message)
{
    StaticJsonDocument<256> doc;
    doc["type"]           = "STATUS";
    doc["machine_status"] = machineStatus;
    doc["progress"]       = progress;
    doc["message"]        = message;
    if (currentOrderId >= 0)
        doc["order_id"] = currentOrderId;
    serializeJson(doc, Serial);
    Serial.println();
}


// =============================================================================
//  SENSOR REPORTER  (ESP32 → Pi)
// =============================================================================

// Convert enum to wire string
static const char* glassStateStr(GlassState g)
{
    switch (g)
    {
        case GlassState::NO_GLASS:     return "no_glass";
        case GlassState::SMALL_GLASS:  return "small_glass";
        case GlassState::LARGE_GLASS:  return "large_glass";
        case GlassState::SENSOR_ERROR: return "sensor_error";
    }
    return "no_glass";
}

void sendSensorStatus(GlassState g)
{
    StaticJsonDocument<160> doc;
    bool lowerBlocked = (digitalRead(IR_LOWER_PIN) == LOW);
    bool upperBlocked = (digitalRead(IR_UPPER_PIN) == LOW);

    doc["type"]         = "SENSOR";
    doc["glass_state"]  = glassStateStr(g);
    doc["lower_sensor"] = lowerBlocked;
    doc["upper_sensor"] = upperBlocked;
    serializeJson(doc, Serial);
    Serial.println();
    Serial.print("[SENSOR] glass_state=");
    Serial.println(glassStateStr(g));
}


// =============================================================================
//  IR GLASS SENSORS
// =============================================================================

/**
 * Read both IR sensors and determine glass state.
 *
 * IR sensor output convention: LOW  = beam broken = glass present
 *                               HIGH = beam clear  = no glass
 *
 * lower=LOW, upper=LOW  → LARGE_GLASS  (blocks both beams)
 * lower=LOW, upper=HIGH → SMALL_GLASS  (only lower beam blocked)
 * lower=HIGH,upper=HIGH → NO_GLASS
 * lower=HIGH,upper=LOW  → SENSOR_ERROR (physically impossible stacking)
 */
GlassState readGlassSensors()
{
    bool lowerBlocked = (digitalRead(IR_LOWER_PIN) == LOW);
    bool upperBlocked = (digitalRead(IR_UPPER_PIN) == LOW);

    if (!lowerBlocked && !upperBlocked) return GlassState::NO_GLASS;
    if ( lowerBlocked && !upperBlocked) return GlassState::SMALL_GLASS;
    if ( lowerBlocked &&  upperBlocked) return GlassState::LARGE_GLASS;
    // lowerBlocked=false, upperBlocked=true — sensor wiring issue
    return GlassState::SENSOR_ERROR;
}


// =============================================================================
//  HALL SENSORS
// =============================================================================

bool oscHallDetected()
{
    return mcp.digitalRead(OSC_HALL_PIN) == LOW;
}

bool idxHallDetected(uint8_t index)
{
    return mcp.digitalRead(IDX_HALL_PINS[index]) == LOW;
}


// =============================================================================
//  UART2 — RELAY TO NODEMCU
// =============================================================================

void sendCmd(const char* cmd)
{
    Serial2.println(cmd);
    Serial.print("[TX2] ");
    Serial.println(cmd);
}


// =============================================================================
//  VALVE HELPERS
// =============================================================================

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


// =============================================================================
//  STEPPER HELPERS
// =============================================================================

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


// =============================================================================
//  SEQUENCE STAGE TRANSITIONS
// =============================================================================

void enterIdle(const char* debugMsg)
{
    currentState   = SystemState::IDLE;
    currentOrderId = -1;
    Serial.println(debugMsg);
    sendStatus("idle", 0, "Ready");
}

void beginPumpReverseSequence(JsonArray reversePumps)
{
    memset(reversePumpTimes, 0, sizeof(reversePumpTimes));
    memset(reversePumpRunning, 0, sizeof(reversePumpRunning));

    for (JsonObject p : reversePumps)
    {
        int idx = (p["i"] | 0) - 1;
        if (idx >= 0 && idx < 6)
            reversePumpTimes[idx] = p["t"].as<unsigned long>();
    }

    bool anyReverse = false;
    for (int i = 0; i < 6; i++)
    {
        if (reversePumpTimes[i] > 0)
        {
            char cmd[8];
            snprintf(cmd, sizeof(cmd), "M%dR", i + 1);
            sendCmd(cmd);
            reversePumpRunning[i] = true;
            anyReverse = true;
        }
    }

    if (!anyReverse)
    {
        enterIdle("[POWER] Off - no reverse pump time configured");
        return;
    }

    reversePumpStart = millis();
    currentState = SystemState::PUMP_REVERSING;
    sendStatus("reversing", 0, "Reversing pump lines before power off...");
}
void beginValveClosing()
{
    Serial.println("[VALVE] Closing...");
    valveClose();
    valveTimerStart = millis();
    currentState = SystemState::VALVE_CLOSING;
}

/**
 * Enter GLASS_WAIT state.
 * Performs an immediate sensor read and sends a SENSOR message so the Pi (and
 * UI) know the starting glass state.  The machine then polls every GLASS_POLL_MS
 * until a glass is placed OR a GLASS_OK command is received from the Pi.
 */
void beginGlassWait()
{
    Serial.println("[GLASS] Waiting for glass...");
    lastGlassPollMs  = 0;   // force immediate poll on first updateGlassWait() call

    // Read initial glass state and report it
    GlassState initial = readGlassSensors();
    lastReportedGlass  = initial;
    sendSensorStatus(initial);

    currentState = SystemState::GLASS_WAIT;
    if (orderRequiresLargeGlass)
        sendStatus("waiting_glass", 5, "Please place a large glass under the dispenser...");
    else
        sendStatus("waiting_glass", 5, "Please place your glass under the dispenser...");
}

void beginIndexerSequence()
{
    Serial.println("[IDX] Starting cycle");
    idxPosition  = 0;
    idxReturning = false;
    startIdxSearch();
    currentState = SystemState::INDEX_SEARCH;
}

void beginOscillationSequence()
{
    Serial.println("[OSC] Starting");
    stopRequested = false;
    oscLegCount   = 0;
    currentState  = SystemState::OSCILLATING;
    startOscLeg(false);
    sendStatus("mixing", 80, "Mixing your drink...");
}

void requestOscStop()
{
    Serial.println("[OSC] Stop requested");
    stopRequested = true;
}

void beginHomingSequence()
{
    Serial.println("[OSC] Returning home");
    currentState = SystemState::HOMING;
    stepperOsc.moveTo(0);
}

void beginRecoveryNegative()
{
    Serial.println("[OSC] Home not found — recovery negative");
    currentState = SystemState::RECOVERY_NEGATIVE;
    stepperOsc.moveTo(-RECOVERY_OFFSET);
}

void beginRecoveryPositive()
{
    Serial.println("[OSC] Recovery positive");
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
    Serial.println("[VALVE] Opening");
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
    Serial.println("[OSC] Homed");
    beginValveOpenDelay();
}

void reportFatalHomingFailure()
{
    Serial.println("[OSC] Homing FAILED");
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
    sendStatus("error", 0, "Homing failure — please contact staff.");
    beginValveOpenDelay();
}


// =============================================================================
//  PER-STATE UPDATE FUNCTIONS
// =============================================================================

void updatePumpReversing()
{
    bool anyRunning = false;
    unsigned long elapsed = millis() - reversePumpStart;

    for (int i = 0; i < 6; i++)
    {
        if (!reversePumpRunning[i])
            continue;

        if (elapsed >= reversePumpTimes[i])
        {
            char cmd[8];
            snprintf(cmd, sizeof(cmd), "M%dS", i + 1);
            sendCmd(cmd);
            reversePumpRunning[i] = false;
        }
        else
        {
            anyRunning = true;
        }
    }

    if (!anyRunning)
    {
        enterIdle("[POWER] Pump reverse complete - powered off");
    }
}
void updateValveClosing()
{
    if (millis() - valveTimerStart <= VALVE_STARTUP_IGNORE_MS)
        return;

    float current = ina219.getCurrent_mA();
    if (current > VALVE_CURRENT_LIMIT_mA)
    {
        valveStop();
        Serial.print("[VALVE] Closed at ");
        Serial.print(current);
        Serial.println(" mA");

        if (cleanCycleMode)
        {
            Serial.println("[CLEAN] Valve closed - skipping glass wait");
            cleanCycleMode = false;
            beginIndexerSequence();
            return;
        }

        // Valve is now sealed, so wait for a valid glass before dispensing.
        beginGlassWait();
    }
}

/**
 * GLASS_WAIT: poll IR sensors every GLASS_POLL_MS.
 *
 * Advances to INDEX_SEARCH when:
 *   (a) A glass is physically detected (small or large), OR
 *   (b) The Pi sends {"cmd":"GLASS_OK"} — operator bypass while IR not wired.
 *
 * Sends a SENSOR JSON message whenever the glass state changes so the Pi/UI
 * can show the real-time glass state without polling.
 */
void updateGlassWait()
{
    unsigned long now = millis();
    if (now - lastGlassPollMs < GLASS_POLL_MS)
        return;
    lastGlassPollMs = now;

    GlassState current = readGlassSensors();

    // Send SENSOR update only when state changes (avoids flooding Serial)
    if (current != lastReportedGlass)
    {
        lastReportedGlass = current;
        sendSensorStatus(current);
    }

    // Proceed if the correct glass is placed (real sensor) OR bypass command received.
    bool glassPresent = orderRequiresLargeGlass
        ? (current == GlassState::LARGE_GLASS)
        : (current == GlassState::SMALL_GLASS || current == GlassState::LARGE_GLASS);

    if (glassPresent || glassOkReceived)
    {
        if (glassOkReceived)
            Serial.println("[GLASS] Bypass accepted — proceeding without sensor");
        else
            Serial.println("[GLASS] Glass confirmed by IR sensor — proceeding");

        glassOkReceived = false;
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
        Serial.println("[IDX] Back at position 1");
        stepperIdx.setCurrentPosition(0);
        beginOscillationSequence();
        return;
    }

    Serial.print("[IDX] At position ");
    Serial.println(idxPosition + 1);

    // Send pump-start command to NodeMCU only if this pump is active in this order
    if (indexWaitTimes[idxPosition] > 0)
    {
        char cmd[8];
        snprintf(cmd, sizeof(cmd), "M%dF", idxPosition + 1);
        sendCmd(cmd);

        // Progress: spread 10%→70% evenly across all 6 indexer positions
        int progress = 10 + (idxPosition * 60) / 6;
        char msg[48];
        snprintf(msg, sizeof(msg), "Dispensing pump %d...", idxPosition + 1);
        sendStatus("dispensing", progress, msg);
    }

    idxWaitStart = millis();
    currentState = SystemState::INDEX_WAIT;
}

void updateIndexWait()
{
    if (millis() - idxWaitStart < indexWaitTimes[idxPosition])
        return;

    // Send pump-stop command to NodeMCU only if this pump was active
    if (indexWaitTimes[idxPosition] > 0)
    {
        char cmd[8];
        snprintf(cmd, sizeof(cmd), "M%dS", idxPosition + 1);
        sendCmd(cmd);
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
        Serial.println("[IDX] Returning to position 1");
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
        Serial.println("[OSC] Target reached — homing");
        beginHomingSequence();
        return;
    }

    startOscLeg(!nextLegIsNegative);
}

bool checkOscHallDuringSearch()
{
    if (oscHallDetected())
    {
        Serial.println("[OSC] Home confirmed");
        completeHoming();
        return true;
    }
    return false;
}

void updateHoming()
{
    if (checkOscHallDuringSearch()) return;
    if (stepperOsc.distanceToGo() == 0)
        beginRecoveryNegative();
}

void updateRecoveryNegative()
{
    if (checkOscHallDuringSearch()) return;
    if (stepperOsc.distanceToGo() == 0)
        beginRecoveryPositive();
}

void updateRecoveryPositive()
{
    if (checkOscHallDuringSearch()) return;
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

        if (postOrderCleanMode)
        {
            postOrderCleanMode = false;
            enterIdle("[CLEAN] Complete - READY");
            return;
        }

        if (currentOrderId >= 0)
        {
            GlassState current = readGlassSensors();
            lastReportedGlass = current;
            sendSensorStatus(current);
            lastGlassPollMs = millis();
            sendStatus("done", 100, "Enjoy your drink! Please remove the glass when finished.");
            currentState = SystemState::POST_DRINK_WAIT;
            return;
        }

        enterIdle("[VALVE] Open - READY");
    }
}

void updatePostDrinkWait()
{
    unsigned long now = millis();
    if (now - lastGlassPollMs < GLASS_POLL_MS)
        return;
    lastGlassPollMs = now;

    GlassState current = readGlassSensors();
    if (current != lastReportedGlass)
    {
        lastReportedGlass = current;
        sendSensorStatus(current);
    }

    if (current == GlassState::NO_GLASS)
    {
        Serial.println("[CLEAN] Glass removed - starting post-drink clean");
        postOrderCleanMode = true;
        cleanCycleMode = true;
        memset(indexWaitTimes, 0, sizeof(indexWaitTimes));
        activePumpCount = 0;
        sendStatus("washing", 0, "Glass removed. Cleaning machine...");
        beginValveClosing();
    }
}


// =============================================================================
//  JSON COMMAND PROCESSOR  (Pi → ESP32)
// =============================================================================

void processJsonCommand(const char* line)
{
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err)
    {
        Serial.print("[ERR] JSON parse: ");
        Serial.println(err.c_str());
        return;
    }

    const char* cmd = doc["cmd"] | "";

    // ── ORDER ────────────────────────────────────────────────────────────────
    if (strcmp(cmd, "ORDER") == 0)
    {
        if (currentState != SystemState::IDLE)
        {
            Serial.println("[WARN] ORDER ignored — machine not idle");
            return;
        }

        currentOrderId = doc["order_id"] | -1;
        iceEnabled     = (doc["ice"] | 0) != 0;

        // Reset all pump wait times to zero (unused pumps are skipped)
        memset(indexWaitTimes, 0, sizeof(indexWaitTimes));
        activePumpCount = 0;

        // Load only the active pumps from the sparse array
        JsonArray pumps = doc["pumps"].as<JsonArray>();
        for (JsonObject p : pumps)
        {
            int idx = (p["i"] | 0) - 1;   // convert 1-indexed → 0-indexed
            if (idx >= 0 && idx < 6)
            {
                indexWaitTimes[idx] = p["t"].as<unsigned long>();
                if (indexWaitTimes[idx] > 0)
                    activePumpCount++;
            }
        }

        Serial.print("[ORDER] #");
        Serial.print(currentOrderId);
        Serial.print(" | ");
        Serial.print(activePumpCount);
        Serial.print(" active pumps | ice=");
        Serial.println(iceEnabled ? "yes" : "no");
        orderRequiresLargeGlass = strcmp(doc["required_glass"] | "any", "large") == 0;
        Serial.print("[ORDER] required_glass=");
        Serial.println(orderRequiresLargeGlass ? "large" : "any");

        glassOkReceived = false;
        cleanCycleMode = false;
        postOrderCleanMode = false;
        beginValveClosing();
    }

    // ── GLASS_OK (bypass / operator override) ────────────────────────────────
    // Accepted only in GLASS_WAIT state.  Causes the machine to proceed as if
    // a glass had been physically detected.  Used while IR sensors are not yet
    // wired, or as a staff override.
    else if (strcmp(cmd, "GLASS_OK") == 0)
    {
        if (currentState == SystemState::GLASS_WAIT || currentState == SystemState::VALVE_CLOSING)
        {
            Serial.println("[GLASS] GLASS_OK received from Pi - bypass latched");
            glassOkReceived = true;   // consumed by updateGlassWait() on next poll
        }
        else
        {
            Serial.println("[WARN] GLASS_OK ignored - machine is not waiting for glass");
        }
    }

    // ── ABORT ────────────────────────────────────────────────────────────────
    else if (strcmp(cmd, "ABORT") == 0)
    {
        stopOscImmediately();
        stopIdxImmediately();
        valveStop();
        glassOkReceived = false;
        cleanCycleMode = false;
        postOrderCleanMode = false;
        // Send stop to all NodeMCU pumps just in case one is running
        for (int i = 1; i <= 6; i++)
        {
            char stopCmd[8];
            snprintf(stopCmd, sizeof(stopCmd), "M%dS", i);
            sendCmd(stopCmd);
        }
        sendStatus("aborted", 0, "Order aborted.");
        currentOrderId = -1;
        currentState   = SystemState::IDLE;
        Serial.println("[ABORT] Machine stopped.");
    }

    // -- POWER ---------------------------------------------------------------
    else if (strcmp(cmd, "POWER") == 0)
    {
        if (currentState != SystemState::IDLE)
        {
            Serial.println("[WARN] POWER ignored - machine not idle");
            return;
        }

        bool powerOn = (doc["on"] | 0) != 0;
        if (powerOn)
        {
            sendStatus("idle", 0, "Machine powered on.");
            Serial.println("[POWER] ON");
        }
        else
        {
            Serial.println("[POWER] OFF - reversing pumps only");
            memset(indexWaitTimes, 0, sizeof(indexWaitTimes));
            activePumpCount = 0;
            currentOrderId = -1;
            iceEnabled = false;
            orderRequiresLargeGlass = false;
            glassOkReceived = false;
            JsonArray reversePumps = doc["reverse"].as<JsonArray>();
            beginPumpReverseSequence(reversePumps);
        }
    }
    // ── CLEAN ────────────────────────────────────────────────────────────────
    else if (strcmp(cmd, "CLEAN") == 0)
    {
        if (currentState != SystemState::IDLE)
        {
            Serial.println("[WARN] CLEAN ignored — machine not idle");
            return;
        }
        Serial.println("[CLEAN] Starting manual clean cycle");
        // Run a full cycle with zero dispense times — valve + indexer movement
        // + oscillation, no liquids dispensed.
        // Clean skips glass-wait: no glass is needed (container is already in place).
        memset(indexWaitTimes, 0, sizeof(indexWaitTimes));
        activePumpCount = 0;
        currentOrderId  = -1;
        iceEnabled = false;
        orderRequiresLargeGlass = false;
        glassOkReceived = false;
        cleanCycleMode = true;
        postOrderCleanMode = false;
        sendStatus("washing", 0, "Manual cleaning cycle started...");
        beginValveClosing();
    }

    else
    {
        Serial.print("[WARN] Unknown command: ");
        Serial.println(cmd);
    }
}


// =============================================================================
//  SERIAL COMMAND HANDLER  (line-based)
// =============================================================================

void handleSerialCommands()
{
    while (Serial.available())
    {
        char c = (char)Serial.read();
        if (c == '\n')
        {
            // Strip carriage return if present
            if (s_len > 0 && s_buf[s_len - 1] == '\r')
                s_len--;

            s_buf[s_len] = '\0';
            if (s_len > 0)
                processJsonCommand(s_buf);
            s_len = 0;
        }
        else if (s_len < (int)sizeof(s_buf) - 1)
        {
            s_buf[s_len++] = c;
        }
    }
}


// =============================================================================
//  SETUP HELPERS
// =============================================================================

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
        Serial.println("[ERR] MCP23017 not found!");
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
        Serial.println("[OSC] Home detected at startup");
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
        Serial.println("[ERR] INA219 not found!");
        while (true) { delay(1000); }
    }
}

void initializeGlassSensors()
{
    // IR sensor outputs are INPUT_PULLUP: LOW = beam broken = glass present.
    pinMode(IR_LOWER_PIN, INPUT_PULLUP);
    pinMode(IR_UPPER_PIN, INPUT_PULLUP);
    Serial.println("[GLASS] IR sensors initialised (pins " 
                   + String(IR_LOWER_PIN) + ", " + String(IR_UPPER_PIN) + ")");
}


// =============================================================================
//  SETUP & LOOP
// =============================================================================

void setup()
{
    Serial.begin(115200);
    Serial2.begin(SERIAL2_BAUD, SERIAL_8N1, RXD2, TXD2);

    initializeStatusLed();
    initializeIoExpander();
    initializeSteppers();
    initializeValveHardware();
    initializeGlassSensors();

    // Announce ready to the Pi in JSON so it can parse it if desired
    sendStatus("idle", 0, "ESP32 ready");
    Serial.println("[READY] Awaiting JSON commands from Raspberry Pi.");
}

void loop()
{
    stepperOsc.run();
    stepperIdx.run();

    handleSerialCommands();

    switch (currentState)
    {
        case SystemState::IDLE:               break;
        case SystemState::PUMP_REVERSING:     updatePumpReversing();     break;
        case SystemState::VALVE_CLOSING:      updateValveClosing();      break;
        case SystemState::GLASS_WAIT:         updateGlassWait();         break;
        case SystemState::INDEX_SEARCH:       updateIndexSearch();        break;
        case SystemState::INDEX_WAIT:         updateIndexWait();          break;
        case SystemState::INDEX_POST_STOP:    updateIndexPostStop();      break;
        case SystemState::OSCILLATING:        updateOscillating();        break;
        case SystemState::HOMING:             updateHoming();             break;
        case SystemState::RECOVERY_NEGATIVE:  updateRecoveryNegative();   break;
        case SystemState::RECOVERY_POSITIVE:  updateRecoveryPositive();   break;
        case SystemState::VALVE_OPEN_DELAY:   updateValveOpenDelay();     break;
        case SystemState::VALVE_OPENING:      updateValveOpening();       break;
        case SystemState::POST_DRINK_WAIT:    updatePostDrinkWait();      break;
    }
}





