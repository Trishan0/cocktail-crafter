#include <AccelStepper.h>
#include <Preferences.h>

// =====================================================
// STEPPER PINS
// =====================================================

// Ice dispenser lead-screw stepper
#define STEP_PIN_1 14
#define DIR_PIN_1  15

// Inactive stepper drivers
#define STEP_PIN_2 10
#define DIR_PIN_2  11
#define STEP_PIN_3 12
#define DIR_PIN_3  13

// Shared TMC2208 enable pin
#define EN_PIN 16

AccelStepper stepper(
  AccelStepper::DRIVER,
  STEP_PIN_1,
  DIR_PIN_1
);

Preferences positionPreferences;

// =====================================================
// MOVEMENT SETTINGS
// =====================================================

const long TARGET_DISTANCE = 1000000000L;

const float MAX_SPEED = 10000.0;
const float ACCELERATION = 15000.0;

// Opening and closing movement duration
const unsigned long TRAVEL_TIME_MS = 26000;

// Time kept fully open before returning
const unsigned long OPEN_HOLD_TIME_MS = 1000;

// Vibration duration
const unsigned long VIBRATION_TIME_MS = 1000;

// Same vibration pulse data used in the original test
const unsigned long VIBRATION_PULSE_DELAY_US = 50;
const unsigned int VIBRATION_BURST_STEPS = 1000;

// =====================================================
// PERSISTENT POSITION STATE
// =====================================================

enum class IcePosition : uint8_t {
  CLOSED = 0,
  OPEN = 1
};

// New/erased ESP32 storage defaults to CLOSED.
IcePosition savedIcePosition = IcePosition::CLOSED;

const char* POSITION_NAMESPACE = "icePosition";
const char* POSITION_KEY = "state";

// =====================================================
// SEQUENCE STATE
// =====================================================

enum class SequenceState : uint8_t {
  IDLE,
  OPENING,
  HOLDING_OPEN,
  CLOSING,
  VIBRATING
};

SequenceState sequenceState = SequenceState::IDLE;

unsigned long phaseStartTime = 0;

// True when the ICE command requested the complete:
// open -> hold -> close -> vibrate sequence.
bool fullIceCycleActive = false;

// Controls whether a closing operation ends with vibration.
bool vibrateAfterClosing = false;

// =====================================================
// VIBRATION STATE
// =====================================================

unsigned long vibrationStartTime = 0;
unsigned long lastVibrationToggleMicros = 0;

bool vibrationStepPinHigh = false;
bool vibrationDirectionHigh = true;
unsigned int vibrationStepsInBurst = 0;

// =====================================================
// SERIAL INPUT
// =====================================================

String commandBuffer = "";

unsigned long lastSerialCharacterTime = 0;
const unsigned long SERIAL_COMMAND_TIMEOUT_MS = 30;

const size_t MAX_COMMAND_LENGTH = 64;

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);

  // Keep unused drivers at defined logic levels.
  pinMode(STEP_PIN_2, OUTPUT);
  pinMode(DIR_PIN_2, OUTPUT);
  pinMode(STEP_PIN_3, OUTPUT);
  pinMode(DIR_PIN_3, OUTPUT);

  digitalWrite(STEP_PIN_2, LOW);
  digitalWrite(DIR_PIN_2, LOW);
  digitalWrite(STEP_PIN_3, LOW);
  digitalWrite(DIR_PIN_3, LOW);

  // Shared TMC2208 enable: LOW = enabled.
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);

  stepper.setMaxSpeed(MAX_SPEED);
  stepper.setAcceleration(ACCELERATION);
  stepper.setMinPulseWidth(2);
  stepper.setCurrentPosition(0);

  loadSavedPosition();

  Serial.println();
  Serial.println("LOG:ICE DISPENSER POSITION-STATE TEST");
  Serial.println("LOG:COMMANDS:");
  Serial.println("LOG:  ICE        = full open/hold/close/vibrate cycle");
  Serial.println("LOG:  OPEN       = move CW for 26 seconds");
  Serial.println("LOG:  CLOSE      = move CCW for 26 seconds, then vibrate");
  Serial.println("LOG:  STATUS     = show saved position and active phase");
  Serial.println("LOG:  STOP       = stop immediately; saved state is unchanged");
  Serial.println("LOG:  SET_OPEN   = manually mark current physical position OPEN");
  Serial.println("LOG:  SET_CLOSED = manually mark current physical position CLOSED");
  printStatus();
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  readSerialInput();
  updateSequence();

  // Prevent false pulses on unused drivers.
  digitalWrite(STEP_PIN_2, LOW);
  digitalWrite(STEP_PIN_3, LOW);
}

// =====================================================
// PERSISTENT STATE
// =====================================================

void loadSavedPosition() {
  positionPreferences.begin(POSITION_NAMESPACE, false);

  uint8_t storedValue = positionPreferences.getUChar(
    POSITION_KEY,
    static_cast<uint8_t>(IcePosition::CLOSED)
  );

  if (storedValue == static_cast<uint8_t>(IcePosition::OPEN)) {
    savedIcePosition = IcePosition::OPEN;
  } else {
    // Includes the default value and any invalid stored value.
    savedIcePosition = IcePosition::CLOSED;
  }

  Serial.print("LOG:SAVED ICE POSITION LOADED: ");
  Serial.println(positionName(savedIcePosition));
}

void saveIcePosition(IcePosition newPosition) {
  savedIcePosition = newPosition;

  positionPreferences.putUChar(
    POSITION_KEY,
    static_cast<uint8_t>(newPosition)
  );

  Serial.print("LOG:SAVED ICE POSITION: ");
  Serial.println(positionName(newPosition));
}

const char* positionName(IcePosition position) {
  return position == IcePosition::OPEN
    ? "OPEN"
    : "CLOSED";
}

// =====================================================
// SERIAL HANDLING
// =====================================================

void readSerialInput() {
  while (Serial.available()) {
    char incoming = Serial.read();

    if (incoming == '\n' || incoming == '\r') {
      if (commandBuffer.length() > 0) {
        processCommand(commandBuffer);
        commandBuffer = "";
      }
      continue;
    }

    if (commandBuffer.length() >= MAX_COMMAND_LENGTH) {
      commandBuffer = "";
      Serial.println("LOG:ERROR:COMMAND_TOO_LONG");
      continue;
    }

    commandBuffer += incoming;
    lastSerialCharacterTime = millis();
  }

  // Allows commands to work with "No line ending".
  if (
    commandBuffer.length() > 0 &&
    millis() - lastSerialCharacterTime >=
      SERIAL_COMMAND_TIMEOUT_MS
  ) {
    processCommand(commandBuffer);
    commandBuffer = "";
  }
}

void processCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command.length() == 0) {
    return;
  }

  if (command == "ICE") {
    startFullIceCycle();
  } else if (command == "OPEN") {
    startManualOpening();
  } else if (command == "CLOSE") {
    startManualClosing();
  } else if (command == "STATUS") {
    printStatus();
  } else if (command == "STOP") {
    stopImmediately();
  } else if (command == "SET_OPEN") {
    manuallySetPosition(IcePosition::OPEN);
  } else if (command == "SET_CLOSED") {
    manuallySetPosition(IcePosition::CLOSED);
  } else {
    Serial.print("LOG:ERROR:UNKNOWN_COMMAND:");
    Serial.println(command);
  }
}

// =====================================================
// COMMAND ACTIONS
// =====================================================

void startFullIceCycle() {
  if (sequenceState != SequenceState::IDLE) {
    Serial.println("LOG:BUSY");
    return;
  }

  if (savedIcePosition != IcePosition::CLOSED) {
    Serial.println(
      "LOG:ICE CYCLE REJECTED: SAVED POSITION IS OPEN"
    );
    Serial.println(
      "LOG:USE CLOSE OR PHYSICALLY VERIFY AND SEND SET_CLOSED"
    );
    return;
  }

  fullIceCycleActive = true;
  vibrateAfterClosing = true;

  Serial.println("LOG:ICE CYCLE STARTED");
  beginOpening();
}

void startManualOpening() {
  if (sequenceState != SequenceState::IDLE) {
    Serial.println("LOG:BUSY");
    return;
  }

  if (savedIcePosition == IcePosition::OPEN) {
    Serial.println("LOG:ALREADY OPEN");
    return;
  }

  fullIceCycleActive = false;
  vibrateAfterClosing = false;

  beginOpening();
}

void startManualClosing() {
  if (sequenceState != SequenceState::IDLE) {
    Serial.println("LOG:BUSY");
    return;
  }

  if (savedIcePosition == IcePosition::CLOSED) {
    Serial.println("LOG:ALREADY CLOSED");
    return;
  }

  fullIceCycleActive = false;
  vibrateAfterClosing = true;

  beginClosing();
}

void manuallySetPosition(IcePosition position) {
  if (sequenceState != SequenceState::IDLE) {
    Serial.println("LOG:BUSY");
    return;
  }

  saveIcePosition(position);

  Serial.println(
    "LOG:WARNING:POSITION STATE CHANGED WITHOUT MOTOR MOVEMENT"
  );
}

// =====================================================
// SEQUENCE CONTROL
// =====================================================

void updateSequence() {
  switch (sequenceState) {
    case SequenceState::IDLE:
      // No movement.
      break;

    case SequenceState::OPENING:
      updateOpening();
      break;

    case SequenceState::HOLDING_OPEN:
      updateOpenHold();
      break;

    case SequenceState::CLOSING:
      updateClosing();
      break;

    case SequenceState::VIBRATING:
      updateVibration();
      break;
  }
}

// =====================================================
// OPENING
// =====================================================

void beginOpening() {
  phaseStartTime = millis();
  sequenceState = SequenceState::OPENING;

  // Positive movement is treated as CW, matching the test code.
  stepper.moveTo(
    stepper.currentPosition() + TARGET_DISTANCE
  );

  Serial.println("LOG:ICE DISPENSER OPENING CW FOR 26000ms");
}

void updateOpening() {
  stepper.run();

  if (millis() - phaseStartTime < TRAVEL_TIME_MS) {
    return;
  }

  // Immediate stop keeps the commanded travel interval at 26 seconds.
  // A smooth AccelStepper stop would continue moving while decelerating.
  stopStepperImmediately();

  // OPEN is saved only after the complete 26-second opening motion.
  saveIcePosition(IcePosition::OPEN);

  Serial.println("LOG:ICE DISPENSER FULLY OPEN");

  if (fullIceCycleActive) {
    phaseStartTime = millis();
    sequenceState = SequenceState::HOLDING_OPEN;

    Serial.println("LOG:ICE OPEN HOLD FOR 1000ms");
  } else {
    sequenceState = SequenceState::IDLE;
    Serial.println("LOG:OPEN COMMAND FINISHED");
  }
}

// =====================================================
// OPEN HOLD
// =====================================================

void updateOpenHold() {
  if (millis() - phaseStartTime < OPEN_HOLD_TIME_MS) {
    return;
  }

  beginClosing();
}

// =====================================================
// CLOSING
// =====================================================

void beginClosing() {
  phaseStartTime = millis();
  sequenceState = SequenceState::CLOSING;

  // Negative movement is treated as CCW, matching the test code.
  stepper.moveTo(
    stepper.currentPosition() - TARGET_DISTANCE
  );

  Serial.println("LOG:ICE DISPENSER CLOSING CCW FOR 26000ms");
}

void updateClosing() {
  stepper.run();

  if (millis() - phaseStartTime < TRAVEL_TIME_MS) {
    return;
  }

  stopStepperImmediately();

  // CLOSED is saved only after the complete 26-second return motion.
  saveIcePosition(IcePosition::CLOSED);

  Serial.println("LOG:ICE DISPENSER FULLY CLOSED");

  if (vibrateAfterClosing) {
    beginVibration();
  } else {
    finishOperation();
  }
}

// =====================================================
// VIBRATION
// =====================================================

void beginVibration() {
  // AccelStepper is not used during direct-pulse vibration.
  stopStepperImmediately();

  vibrationStartTime = millis();
  lastVibrationToggleMicros = micros();

  vibrationStepPinHigh = false;
  vibrationDirectionHigh = true;
  vibrationStepsInBurst = 0;

  digitalWrite(STEP_PIN_1, LOW);
  digitalWrite(DIR_PIN_1, HIGH);

  sequenceState = SequenceState::VIBRATING;

  Serial.println("LOG:ICE DISPENSER VIBRATION STARTED");
}

void updateVibration() {
  // Finish only with STEP LOW.
  if (
    millis() - vibrationStartTime >= VIBRATION_TIME_MS &&
    !vibrationStepPinHigh
  ) {
    digitalWrite(STEP_PIN_1, LOW);

    // Direct pulses are intentionally not used as a position estimate.
    stepper.setCurrentPosition(0);

    Serial.println("LOG:ICE DISPENSER VIBRATION FINISHED");
    finishOperation();
    return;
  }

  unsigned long nowMicros = micros();

  if (
    nowMicros - lastVibrationToggleMicros <
      VIBRATION_PULSE_DELAY_US
  ) {
    return;
  }

  lastVibrationToggleMicros = nowMicros;

  if (!vibrationStepPinHigh) {
    digitalWrite(STEP_PIN_1, HIGH);
    vibrationStepPinHigh = true;
    return;
  }

  digitalWrite(STEP_PIN_1, LOW);
  vibrationStepPinHigh = false;

  vibrationStepsInBurst++;

  if (vibrationStepsInBurst >= VIBRATION_BURST_STEPS) {
    vibrationStepsInBurst = 0;
    vibrationDirectionHigh = !vibrationDirectionHigh;

    digitalWrite(
      DIR_PIN_1,
      vibrationDirectionHigh ? HIGH : LOW
    );
  }
}

// =====================================================
// STOP AND COMPLETION
// =====================================================

void stopStepperImmediately() {
  // setCurrentPosition() also sets the current speed to zero and
  // makes the current position the new target.
  stepper.setCurrentPosition(
    stepper.currentPosition()
  );

  digitalWrite(STEP_PIN_1, LOW);
}

void stopImmediately() {
  if (sequenceState == SequenceState::IDLE) {
    Serial.println("LOG:ALREADY STOPPED");
    return;
  }

  stopStepperImmediately();

  sequenceState = SequenceState::IDLE;
  fullIceCycleActive = false;
  vibrateAfterClosing = false;

  Serial.println("LOG:STOPPED IMMEDIATELY");
  Serial.println(
    "LOG:SAVED OPEN/CLOSED STATE WAS NOT CHANGED"
  );
  printStatus();
}

void finishOperation() {
  sequenceState = SequenceState::IDLE;

  bool completedFullCycle = fullIceCycleActive;

  fullIceCycleActive = false;
  vibrateAfterClosing = false;

  if (completedFullCycle) {
    Serial.println("LOG:ICE CYCLE FINISHED");
  } else {
    Serial.println("LOG:OPERATION FINISHED");
  }

  printStatus();
}

// =====================================================
// STATUS
// =====================================================

void printStatus() {
  Serial.print("LOG:SAVED_POSITION:");
  Serial.println(positionName(savedIcePosition));

  Serial.print("LOG:SEQUENCE_STATE:");
  Serial.println(sequenceStateName(sequenceState));
}

const char* sequenceStateName(SequenceState state) {
  switch (state) {
    case SequenceState::IDLE:
      return "IDLE";

    case SequenceState::OPENING:
      return "OPENING";

    case SequenceState::HOLDING_OPEN:
      return "HOLDING_OPEN";

    case SequenceState::CLOSING:
      return "CLOSING";

    case SequenceState::VIBRATING:
      return "VIBRATING";
  }

  return "UNKNOWN";
}
