#include <AccelStepper.h>

// Motor 1: controlled motor
#define STEP_PIN_1 14
#define DIR_PIN_1  15

// Motor 2: inactive
#define STEP_PIN_2 10
#define DIR_PIN_2  11

// Motor 3: inactive
#define STEP_PIN_3 12
#define DIR_PIN_3  13

// Shared enable pin
#define EN_PIN 16

AccelStepper stepper(
  AccelStepper::DRIVER,
  STEP_PIN_1,
  DIR_PIN_1
);

enum Mode {
  STOPPED,
  CW,
  CCW,
  VIBRATE
};

Mode mode = STOPPED;

const long targetDistance = 1000000000L;

// Normal movement settings
const float maxSpeed = 10000.0;
const float acceleration = 15000.0;

// Vibration settings
const unsigned int pulseDelay = 50;
const int burstSteps = 1000;

// Movement timing
unsigned long lastMovementCommandTime = 0;
bool movementCommandReceived = false;
char lastMovementCommand = '\0';

// Automatic timed movement
bool timedMovementActive = false;
unsigned long timedMovementStart = 0;
unsigned long timedMovementDuration = 0;

// Serial command buffer
String commandBuffer = "";
unsigned long lastSerialCharacterTime = 0;
const unsigned long serialCommandTimeout = 30;

void setup() {
  Serial.begin(115200);

  // Keep unused drivers at defined logic levels
  pinMode(STEP_PIN_2, OUTPUT);
  pinMode(DIR_PIN_2, OUTPUT);
  pinMode(STEP_PIN_3, OUTPUT);
  pinMode(DIR_PIN_3, OUTPUT);

  digitalWrite(STEP_PIN_2, LOW);
  digitalWrite(DIR_PIN_2, LOW);
  digitalWrite(STEP_PIN_3, LOW);
  digitalWrite(DIR_PIN_3, LOW);

  // Shared TMC2208 enable
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);

  // Controlled stepper settings
  stepper.setMaxSpeed(maxSpeed);
  stepper.setAcceleration(acceleration);
  stepper.setMinPulseWidth(2);

  Serial.println();
  Serial.println("TMC2208 Stepper Controller");
  Serial.println("--------------------------");
  Serial.println("f       = CW continuously");
  Serial.println("r       = CCW continuously");
  Serial.println("f25000  = CW for 25000 ms");
  Serial.println("r25000  = CCW for 25000 ms");
  Serial.println("s       = Smooth stop");
  Serial.println("v       = Vibrate");
  Serial.println("x       = Exit vibration");
}

void loop() {
  readSerialInput();
  checkTimedMovement();

  switch (mode) {
    case CW:
      runClockwise();
      break;

    case CCW:
      runCounterClockwise();
      break;

    case STOPPED:
      // Complete smooth deceleration
      stepper.run();
      break;

    case VIBRATE:
      vibrate();
      break;
  }

  // Prevent false pulses on unused drivers
  digitalWrite(STEP_PIN_2, LOW);
  digitalWrite(STEP_PIN_3, LOW);
}

// =====================================================
// SERIAL COMMAND HANDLING
// =====================================================

void readSerialInput() {
  while (Serial.available()) {
    char incoming = Serial.read();

    if (incoming == '\n' || incoming == '\r') {
      if (commandBuffer.length() > 0) {
        processCommand(commandBuffer);
        commandBuffer = "";
      }
    } else if (incoming != ' ') {
      commandBuffer += incoming;
      lastSerialCharacterTime = millis();
    }
  }

  /*
   * This allows commands to work even when the Serial Monitor
   * is configured with "No line ending."
   */
  if (
    commandBuffer.length() > 0 &&
    millis() - lastSerialCharacterTime >= serialCommandTimeout
  ) {
    processCommand(commandBuffer);
    commandBuffer = "";
  }
}

void processCommand(String command) {
  command.trim();
  command.toLowerCase();

  if (command.length() == 0) {
    return;
  }

  char commandLetter = command.charAt(0);

  switch (commandLetter) {
    case 'f':
      processMovementCommand(command, CCW, 'f');
      break;

    case 'r':
      processMovementCommand(command, CW, 'r');
      break;

    case 's':
      if (command.length() == 1) {
        stopMovementManually();
      } else {
        Serial.println("Invalid stop command");
      }
      break;

    case 'v':
      if (command.length() == 1) {
        startVibration();
      } else {
        Serial.println("Invalid vibration command");
      }
      break;

    case 'x':
      if (command.length() == 1) {
        exitVibration();
      } else {
        Serial.println("Invalid exit command");
      }
      break;

    default:
      Serial.print("Unknown command: ");
      Serial.println(command);
      break;
  }
}

// =====================================================
// MOVEMENT COMMANDS
// =====================================================

void processMovementCommand(
  const String &command,
  Mode requestedMode,
  char commandLetter
) {
  unsigned long duration = 0;
  bool hasDuration = command.length() > 1;

  if (hasDuration) {
    String durationText = command.substring(1);

    if (!containsOnlyDigits(durationText)) {
      Serial.println(
        "Invalid duration. Example: f25000"
      );
      return;
    }

    duration = strtoul(
      durationText.c_str(),
      nullptr,
      10
    );

    if (duration == 0) {
      Serial.println(
        "Duration must be greater than 0 ms"
      );
      return;
    }
  }

  unsigned long commandTime = millis();

  lastMovementCommandTime = commandTime;
  movementCommandReceived = true;
  lastMovementCommand = commandLetter;

  mode = requestedMode;

  if (requestedMode == CW) {
    stepper.moveTo(
      stepper.currentPosition() + targetDistance
    );
  } else {
    stepper.moveTo(
      stepper.currentPosition() - targetDistance
    );
  }

  if (hasDuration) {
    timedMovementActive = true;
    timedMovementStart = commandTime;
    timedMovementDuration = duration;

    Serial.print(
      requestedMode == CW ? "CW" : "CCW"
    );
    Serial.print(" FOR ");
    Serial.print(duration);
    Serial.println("ms");
  } else {
    timedMovementActive = false;

    Serial.println(
      requestedMode == CW ? "CW" : "CCW"
    );
  }
}

bool containsOnlyDigits(const String &text) {
  if (text.length() == 0) {
    return false;
  }

  for (unsigned int i = 0; i < text.length(); i++) {
    if (!isDigit(text.charAt(i))) {
      return false;
    }
  }

  return true;
}

// =====================================================
// TIMED MOVEMENT
// =====================================================

void checkTimedMovement() {
  if (!timedMovementActive) {
    return;
  }

  unsigned long currentTime = millis();

  if (
    currentTime - timedMovementStart >=
    timedMovementDuration
  ) {
    timedMovementActive = false;

    // Smooth automatic stop
    stepper.stop();
    mode = STOPPED;

    Serial.println("AUTOMATIC STOP");
    printElapsedTime(currentTime);
  }
}

// =====================================================
// MANUAL STOP
// =====================================================

void stopMovementManually() {
  unsigned long stopCommandTime = millis();

  timedMovementActive = false;

  if (mode == VIBRATE) {
    stepper.setCurrentPosition(0);
    stepper.moveTo(0);
  } else {
    stepper.stop();
  }

  mode = STOPPED;

  Serial.println("STOP");
  printElapsedTime(stopCommandTime);
}

void printElapsedTime(unsigned long stopTime) {
  if (!movementCommandReceived) {
    Serial.println(
      "RUN_TIME: No previous f or r command"
    );
    return;
  }

  unsigned long elapsedTime =
    stopTime - lastMovementCommandTime;

  Serial.print("LAST_COMMAND:");
  Serial.print(lastMovementCommand);

  Serial.print(",RUN_TIME:");
  Serial.print(elapsedTime);
  Serial.print("ms");

  Serial.print(",SECONDS:");
  Serial.print(elapsedTime / 1000.0, 3);
  Serial.println("s");
}

// =====================================================
// NORMAL ROTATION
// =====================================================

void runClockwise() {
  if (stepper.distanceToGo() < 10000) {
    stepper.moveTo(
      stepper.currentPosition() + targetDistance
    );
  }

  stepper.run();
}

void runCounterClockwise() {
  if (stepper.distanceToGo() > -10000) {
    stepper.moveTo(
      stepper.currentPosition() - targetDistance
    );
  }

  stepper.run();
}

// =====================================================
// VIBRATION
// =====================================================

void startVibration() {
  timedMovementActive = false;

  stepper.setCurrentPosition(0);
  stepper.moveTo(0);

  mode = VIBRATE;
  Serial.println("VIBRATE");
}

void exitVibration() {
  timedMovementActive = false;

  stepper.setCurrentPosition(0);
  stepper.moveTo(0);

  mode = STOPPED;
  Serial.println("EXIT VIBRATION");
}

void vibrate() {
  digitalWrite(DIR_PIN_1, HIGH);

  for (int i = 0; i < burstSteps; i++) {
    if (Serial.available()) {
      return;
    }

    generateStepPulse();
  }

  delayMicroseconds(5);

  digitalWrite(DIR_PIN_1, LOW);

  for (int i = 0; i < burstSteps; i++) {
    if (Serial.available()) {
      return;
    }

    generateStepPulse();
  }

  delayMicroseconds(5);
}

void generateStepPulse() {
  digitalWrite(STEP_PIN_1, HIGH);
  delayMicroseconds(pulseDelay);

  digitalWrite(STEP_PIN_1, LOW);
  delayMicroseconds(pulseDelay);
}