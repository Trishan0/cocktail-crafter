// ======================================================
// Project: CocktailCraft : Cocktail Dispenser – Weight Activated
// Description:
//   This system automatically dispenses cocktails using a
//   stepper motor mechanism controlled by an ESP32/Arduino.
//   The dispenser begins operation only when a glass is detected
//   on the load cell (weight ≥ 200g) and performs smooth, precise
//   stepper motion for accurate pouring. The system is modular,
//   allowing integration with ultrasonic sensors, RGB indicators,
//   and safety features for future expansion.
//
// Developed by: Kaveesha Nethmal / Sanjana Trishan / Dulmina Sithara
// Version: 1.0
// Date: November 2025
// Copyrights Reserved
// ======================================================


#include <AccelStepper.h>
#include "HX711.h"

// ---------------------- Pins ----------------------
#define STEP_PIN 25
#define DIR_PIN 26
#define EN_PIN 4
#define MS1_PIN 32
#define MS2_PIN 33
#define TRIG_PIN 5
#define ECHO_PIN 18
#define PUMP_IND_PIN 16
#define DECO_PIN 17

// HX711 pins
#define HX711_DT 19
#define HX711_SCK 23

// Interactive LED & buzzer
#define GREEN_LED_PIN 21
#define BLUE_LED_PIN 22
#define BUZZER_PIN 14

// ---------------------- Stepper Setup ----------------------
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);
const int stepsPerBottle = 450;
long currentPosition = 0;

// ---------------------- Recipe & Flow ----------------------
const int recipe1[] = {25, 35, 12, 22};
int noOfBottles = 4;

const float flowRate = 250.0 / 60.0;  // mL/sec

// ---------------------- HX711 Setup ----------------------
HX711 scale;
float calibration_factor = -364.0;
float grams = 0.0;
const int HX_NUM_READINGS = 3;
const float NOISE_THRESHOLD = 2.0;
const float START_WEIGHT_THRESHOLD = 200.0; // start only if >= 200 g
const float ABORT_WEIGHT_THRESHOLD = 100.0; // abort if < 100 g during pump
const unsigned long SCALE_POLL_INTERVAL_MS = 200;
unsigned long lastScalePoll = 0;

// ---------------------- Abort flag ----------------------
volatile bool abortFlag = false; // check when glass removed during dispensing


// ---------------------- Setup ----------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== Cocktail Dispenser HX711 Trigger + Smooth Stepper ===");

  // Stepper pins
  pinMode(EN_PIN, OUTPUT);
  pinMode(MS1_PIN, OUTPUT);
  pinMode(MS2_PIN, OUTPUT);
  digitalWrite(MS1_PIN, HIGH);
  digitalWrite(MS2_PIN, HIGH);
  digitalWrite(EN_PIN, LOW);  // Enable driver

  // Ultrasonic + pump
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(PUMP_IND_PIN, OUTPUT);
  digitalWrite(PUMP_IND_PIN, LOW);

  // LED and buzzer
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(DECO_PIN, OUTPUT);
  digitalWrite(GREEN_LED_PIN, LOW);  // off
  digitalWrite(BLUE_LED_PIN, HIGH);   // off
  digitalWrite(DECO_PIN, HIGH); // on
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);   // off

  // HX711 init
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(calibration_factor);
  scale.tare();
  Serial.println("HX711 initialized and tared.");

  // Stepper configuration
  stepper.setPinsInverted(true, false, false);
  stepper.setMaxSpeed(1500);
  stepper.setAcceleration(1000);
  stepper.setCurrentPosition(0);

  Serial.println("System ready. Place glass (>=200 g) to start...");
}

// ---------------------- Loop ----------------------
void loop() {
  pollScale();

  if (grams >= START_WEIGHT_THRESHOLD) {
    Serial.print("Glass detected: ");
    Serial.print(grams, 1);
    Serial.println(" g – Starting cocktail sequence...");
    digitalWrite(GREEN_LED_PIN, HIGH);
    digitalWrite(BLUE_LED_PIN, LOW);
    startCocktail();
    if (abortFlag) {
      Serial.println("Cycle aborted due to glass removal.");
      abortFlag = false;

    } else {
      Serial.println("Cycle complete. Waiting for next glass...");
      showCode(0);
    }

    digitalWrite(GREEN_LED_PIN, LOW);
    digitalWrite(BLUE_LED_PIN, HIGH);
    delay(2000);
  } else {
    Serial.print("Waiting for glass (current weight: ");
    Serial.print(grams, 1);
    Serial.println(" g)");
    
  }

  delay(300);
}

// ---------------------- HX711 Poll ----------------------
void pollScale() {
  if (millis() - lastScalePoll < SCALE_POLL_INTERVAL_MS) return;
  lastScalePoll = millis();

  scale.set_scale(calibration_factor);
  float reading = scale.get_units(HX_NUM_READINGS);
  if (abs(reading) < NOISE_THRESHOLD) reading = 0.0;
  grams = round(reading * 10.0) / 10.0;
}

// --- Immediate scale read (used while pumping for quick checks) ---
float readScaleNow() {
  scale.set_scale(calibration_factor);
  float reading = scale.get_units(HX_NUM_READINGS);
  if (abs(reading) < NOISE_THRESHOLD) reading = 0.0;
  grams = round(reading * 10.0) / 10.0;
  return grams;
}

// ======================================================
//                   COCKTAIL SEQUENCE
// ======================================================
void startCocktail() {
  abortFlag = false;           // clearing any previous abort
  homeStepper();

  for (int i = 1; i <= noOfBottles; i++) {
    if (abortFlag) break;      // if abort happened earlier, stop sequence

    moveToPosition(currentPosition + stepsPerBottle);
    currentPosition += stepsPerBottle;

    if (recipe1[i - 1] != 0) {
      dispense(i);
      delay(500);
      if (abortFlag) break;
    } else {
      Serial.print("No dispense from bottle ");
      Serial.println(i);
    }
  }

  if (abortFlag) {
    Serial.println("Aborted — returning home for safety...");
    showCode(1);
    homeStepper();
  } else {
    Serial.println("Returning home...");
    homeStepper();
  }
}

// ======================================================
//                    HOMING ROUTINES
// ======================================================

// --- Ultrasonic read ---
float readUltrasonicWithStepping(unsigned long timeout_us = 30000) {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long startMicros = micros();
  unsigned long deadline = startMicros + timeout_us;

  // Wait for echo HIGH
  while (digitalRead(ECHO_PIN) == LOW) {
    if (micros() > deadline) return 0.0; // timeout
    stepper.runSpeed(); // keep stepping
  }
  unsigned long echoStart = micros();

  // Wait for echo LOW
  while (digitalRead(ECHO_PIN) == HIGH) {
    if (micros() > deadline) return 0.0; // timeout
    stepper.runSpeed();
  }
  unsigned long echoEnd = micros();

  unsigned long duration = echoEnd - echoStart;
  float distance_cm = (duration / 2.0) * 0.0343;
  return distance_cm;
}

// --- Home to left limit ---
void homeStepper() {
  Serial.println("Homing...");
  stepper.setMaxSpeed(1800);
  stepper.setAcceleration(2000);
  stepper.setSpeed(-500); // negative = home direction

  while (true) {
    float distance = readUltrasonicWithStepping(30000);
    if (distance > 5 && distance <= 15) {
      stepper.stop();
      // while (stepper.isRunning()) stepper.run();
      stepper.setCurrentPosition(0);
      currentPosition = 0;
      Serial.println("Home position reached!");
      break;
    }
  }

  stepper.setMaxSpeed(1500);
  stepper.setAcceleration(1000);
}

// ======================================================
//                      MOVEMENT
// ======================================================
void moveToPosition(long target) {
  stepper.moveTo(target);
  while (stepper.distanceToGo() != 0) {
    stepper.run();
  }
}



// ======================================================
//                      DISPENSING
// ======================================================
void dispense(int bottleNo) {
  Serial.print("Dispensing from bottle ");
  Serial.println(bottleNo);

  int volumeML = recipe1[bottleNo - 1];
  unsigned long pumpTime = (unsigned long)((volumeML / flowRate) * 1000.0);

  unsigned long startTime = millis();
  digitalWrite(PUMP_IND_PIN, HIGH);

  while ((millis() - startTime) < pumpTime) {
    // Keep stepper alive
    stepper.run();

    // Immediate scale read to detect glass removal
    float nowWeight = readScaleNow();

    // If weight drops below threshold, abort immediately
    if (nowWeight < ABORT_WEIGHT_THRESHOLD) {
      Serial.print("Weight dropped to ");
      Serial.print(nowWeight, 1);
      Serial.println(" g — aborting dispense!");
      // turn off pump
      digitalWrite(PUMP_IND_PIN, LOW);
      // stop stepper safely (decelerate)
      stepper.stop();
      while (stepper.isRunning()) stepper.run();
      // mark abort so higher logic can stop sequence
      abortFlag = true;
      break;
    }

    delay(10);
  }

  // Ensure pump is off
  digitalWrite(PUMP_IND_PIN, LOW);

  // If normal completion (not aborted), report dispensed
  if (!abortFlag) {
    Serial.print("Dispensed ");
    Serial.print(volumeML);
    Serial.println(" mL");
  }
}

// ======================================================
//                    ERROR BUZZER
// ======================================================
void showCode(int code) {
  if (code == 1) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(2000);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (code == 0) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }

}
