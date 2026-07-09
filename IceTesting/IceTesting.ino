#include <AccelStepper.h>

#define STEP_PIN 14
#define DIR_PIN  15
#define EN_PIN   16

AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

enum Mode {
  STOPPED,
  CW,
  CCW,
  VIBRATE
};

Mode mode = STOPPED;

const long target = 1000000000L;

// Vibration settings
const int pulseDelay = 50;   // µs (25-100 recommended)
const int burstSteps = 1000;

void setup() {
  Serial.begin(115200);

  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);      // Enable TMC2208

  stepper.setMaxSpeed(10000);
  stepper.setAcceleration(15000);

  Serial.println("Commands:");
  Serial.println("f = CW");
  Serial.println("r = CCW");
  Serial.println("s = Stop");
  Serial.println("v = Vibrate");
  Serial.println("x = Exit vibration");
}

void loop() {

  if (Serial.available()) {
    char cmd = Serial.read();

    switch (cmd) {

      case 'f':
        mode = CW;
        stepper.moveTo(stepper.currentPosition() + target);
        Serial.println("CW");
        break;

      case 'r':
        mode = CCW;
        stepper.moveTo(stepper.currentPosition() - target);
        Serial.println("CCW");
        break;

      case 's':
        mode = STOPPED;
        stepper.stop();
        Serial.println("STOP");
        break;

      case 'v':
        mode = VIBRATE;
        Serial.println("VIBRATE");
        break;

      case 'x':
        mode = STOPPED;
        stepper.stop();
        Serial.println("EXIT VIBRATION");
        break;
    }
  }

  switch (mode) {

    case CW:
      if (stepper.distanceToGo() < 10000)
        stepper.moveTo(stepper.currentPosition() + target);
      stepper.run();
      break;

    case CCW:
      if (stepper.distanceToGo() > -10000)
        stepper.moveTo(stepper.currentPosition() - target);
      stepper.run();
      break;

    case STOPPED:
      stepper.run();      // Allows smooth deceleration
      break;

    case VIBRATE:
      vibrate();
      break;
  }
}

void vibrate() {

  digitalWrite(DIR_PIN, HIGH);

  for (int i = 0; i < burstSteps; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(pulseDelay);
    digitalWrite(STEP_PIN, LOW);
    delayMicroseconds(pulseDelay);
  }

  digitalWrite(DIR_PIN, LOW);

  for (int i = 0; i < burstSteps; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(pulseDelay);
    digitalWrite(STEP_PIN, LOW);
    delayMicroseconds(pulseDelay);
  }

  // Allow immediate command processing
  if (Serial.available())
    return;
}