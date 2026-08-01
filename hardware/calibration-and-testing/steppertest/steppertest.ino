#include <AccelStepper.h>

#define STEP_PIN 12
#define DIR_PIN  13
#define EN_PIN   16

AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

void setup() {
  Serial.begin(115200);

  // Enable the TMC2208
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);

  stepper.setMaxSpeed(2000);      // steps per second
  stepper.setAcceleration(1000);  // steps per second²

  // Move forward 2000 steps
  stepper.moveTo(2000);

  Serial.println("Stepper Test Started");
}

void loop() {
  stepper.run();

  // Reverse direction when target is reached
  if (stepper.distanceToGo() == 0) {
    stepper.moveTo(-stepper.currentPosition());

    Serial.print("Moving to: ");
    Serial.println(stepper.targetPosition());
  }
}