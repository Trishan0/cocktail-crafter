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
// Version: 1.1
// Date: November 2025
// Copyrights Reserved
// ======================================================

#include <AccelStepper.h>
#include "HX711.h"
#include <WiFi.h>
#include <WebServer.h>
#include <pgmspace.h>

// ---------------------- Pins ----------------------
#define STEP_PIN 25
#define DIR_PIN 26
#define EN_PIN 4
#define MS1_PIN 32
#define MS2_PIN 33
#define TRIG_PIN 5
#define ECHO_PIN 18
#define PUMP_IND_PIN 16
#define ALT_IND_PIN 13  
#define DECO_PIN 17

// HX711 pins
#define HX711_DT 19
#define HX711_SCK 23

// Interactive LED & buzzer
#define GREEN_LED_PIN 21
#define BLUE_LED_PIN 22
#define BUZZER_PIN 14


// ================== Function Declarations ==================
void pollScale();
float readScaleNow();
void startCocktail();
void homeStepper();
void moveToPosition(long target);
void dispense(int bottleNo, int volumeML);
void showCode(int code);
float readUltrasonicWithStepping(unsigned long timeout_us);
void handleSet();
void handleConfirm();
void handleRoot();

// ---------------------- Stepper Setup ----------------------
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);
const int stepsPerBottle = 450;
long currentPosition = 0;

// ---------------------- Recipe & Flow ----------------------
int noOfBottles = 4;
struct Recipe {
  String name;
  int ingredients[4];
};

Recipe recipes[] = {
  {"Mojito", {30, 0, 35, 20}},
  {"Blue Lagoon", {35, 30, 20, 15}},
  {"Tequila Sunrise", {40, 0, 20, 25}},
  {"Cosmopolitan", {30, 15, 25, 15}},
  {"Pina Colada", {25, 0, 30, 0}},
  {"Cuba Libre", {40, 20, 0, 10}},
  {"Strawberry Daiquiri", {35, 0, 20, 30}},
  {"Whiskey Sour", {30, 15, 25, 15}},
  {"Lemon Drop", {25, 20, 30, 10}},
  {"Test", {1000, 0, 0, 0}}
};

const int numRecipes = sizeof(recipes) / sizeof(recipes[0]);

bool isOrdered = false;
int selectedIndex = -1;  // no recipe selected initially

const char htmlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><title>CocktailCraft Menu</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:"Poppins",sans-serif;text-align:center;background:linear-gradient(180deg,#0b0c10,#1f2833);color:#fff;margin:0;padding:20px;}h1{margin-bottom:20px;font-size:2em;}.menu{display:flex;flex-direction:column;align-items:center;gap:12px;}button{width:80%;max-width:300px;padding:15px;border:0;border-radius:12px;font-size:1.1em;font-weight:600;color:#fff;cursor:pointer;transition:transform .2s,opacity .2s;}button:hover{transform:scale(1.05);opacity:.9;}.mojito{background:#2ecc71;}.bluelagoon{background:#3498db;}.tequilasunrise{background:linear-gradient(45deg,#ff512f,#f09819);}.cosmopolitan{background:#e056fd;}.pinacolada{background:#f1c40f;color:#333;}.cubalibre{background:#8e44ad;}.strawberrydaiquiri{background:#e74c3c;}.whiskeysour{background:#d35400;}.lemondrop{background:#f9d71c;color:#222;}.testing{background:#555;color:#fff;opacity:.2;}#current{margin-top:25px;font-size:1.2em;}</style></head><body><h1>Select Your Cocktail</h1><div class="menu"><button class="mojito" onclick="selectRecipe(0,'Mojito')">Mojito</button><button class="bluelagoon" onclick="selectRecipe(1,'Blue Lagoon')">Blue Lagoon</button><button class="tequilasunrise" onclick="selectRecipe(2,'Tequila Sunrise')">Tequila Sunrise</button><button class="cosmopolitan" onclick="selectRecipe(3,'Cosmopolitan')">Cosmopolitan</button><button class="pinacolada" onclick="selectRecipe(4,'Pina Colada')">Pina Colada</button><button class="cubalibre" onclick="selectRecipe(5,'Cuba Libre')">Cuba Libre</button><button class="strawberrydaiquiri" onclick="selectRecipe(6,'Strawberry Daiquiri')">Strawberry Daiquiri</button><button class="whiskeysour" onclick="selectRecipe(7,'Whiskey Sour')">Whiskey Sour</button><button class="lemondrop" onclick="selectRecipe(8,'Lemon Drop')">Lemon Drop</button><button class="testing" onclick="selectRecipe(9,'Testing')">Testing</button></div><div id="current">Current selection:<b>None</b></div><button id="confirmBtn" onclick="confirmOrder()" style="margin-top:20px;padding:15px 30px;border-radius:10px;background:#27ae60;font-size:1.1em;font-weight:600;color:#fff;cursor:pointer;">Confirm Order</button><script>let selectedIndex=-1,selectedName="";async function selectRecipe(i,n){selectedIndex=i;selectedName=n;await fetch("/set?i="+i);document.getElementById("current").innerHTML="Current selection: <b>"+n+"</b>";}async function confirmOrder(){if(selectedIndex===-1){alert("Please select a recipe first!");return;}let r=await fetch("/confirm");if(r.ok)document.getElementById("current").innerHTML="Order confirmed: <b>"+selectedName+"</b>";else alert("Failed to confirm order!");}</script></body></html> )rawliteral";

const float flowRate = 250.0 / 60.0;  // mL/sec

// ---------------------- WiFi Setup ----------------------

const char* ssid = "Galaxy M018b0d";
const char* password = "aect8897";

WebServer server(80);

void handleSet() {
  if (server.hasArg("i")) {
    selectedIndex = server.arg("i").toInt();
    if (selectedIndex >= 0 && selectedIndex < numRecipes) {
      Serial.print("Selected recipe: ");
      Serial.println(recipes[selectedIndex].name);
      server.send(200, "text/plain", "Selected");
    } else {
      server.send(400, "text/plain", "Invalid index");
    }
  } else {
    server.send(400, "text/plain", "Missing index");
  }
}

void handleConfirm() {
  if (selectedIndex >= 0 && selectedIndex < numRecipes) {
    isOrdered = true;
    Serial.print("Order confirmed: ");
    Serial.println(recipes[selectedIndex].name);
    server.send(200, "text/plain", "Order confirmed");
  } else {
    server.send(400, "text/plain", "No recipe selected");
  }
}

void handleRoot() {
  server.send_P(200, "text/html", htmlPage);
}

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

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  
  // Connecting to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
  }
  Serial.println();
  Serial.print("Connected! IP: ");

  // Web routes
  server.on("/", handleRoot);        // show the web menu
  server.on("/set", handleSet);
  server.on("/confirm", handleConfirm);

  server.begin(); // start server
  Serial.println("HTTP server started");
  Serial.println(WiFi.localIP());
  showCode(2);


  // ------ Main Program Setup ------
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
  pinMode(ALT_IND_PIN, OUTPUT);
  digitalWrite(ALT_IND_PIN, LOW);

  // LED and buzzer
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BLUE_LED_PIN, OUTPUT);
  digitalWrite(GREEN_LED_PIN, HIGH);  // off
  digitalWrite(BLUE_LED_PIN, HIGH);   // off
  pinMode(DECO_PIN, OUTPUT);
  // pinMode(BUZZER_PIN, OUTPUT);
  // digitalWrite(BUZZER_PIN, LOW);   // off
  for (int i = 0; i < 255; i++) {
    analogWrite(DECO_PIN, i);
    delay(30);
  }
  delay(100);
  digitalWrite(DECO_PIN, HIGH); // on
  delay(500);
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(BLUE_LED_PIN, HIGH);



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
    server.handleClient();
  pollScale();

  if (isOrdered) {
    showCode(4);
  }

  if (isOrdered && grams >= START_WEIGHT_THRESHOLD) {
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
    
    isOrdered = false; // reset order flag
    selectedIndex = -1; // reset selection
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
  abortFlag = false;
  homeStepper();

  int* currentRecipe = recipes[selectedIndex].ingredients;

  for (int i = 0; i < noOfBottles; i++) {
    if (abortFlag) break;

    moveToPosition(currentPosition + stepsPerBottle);
    currentPosition += stepsPerBottle;

    if (currentRecipe[i] != 0) {
      dispense(i + 1, currentRecipe[i]);
      delay(500);
      if (abortFlag) break;
    } else {
      Serial.print("No dispense from bottle ");
      Serial.println(i + 1);
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

  digitalWrite(BLUE_LED_PIN, LOW);

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
void dispense(int bottleNo, int volumeML) {
  Serial.print("Dispensing from bottle ");
  Serial.println(bottleNo);

  unsigned long pumpTime = (unsigned long)((volumeML / flowRate) * 1000.0);

  unsigned long startTime = millis();
  if (bottleNo == 1) {
    digitalWrite(PUMP_IND_PIN, HIGH);
  } else {
    digitalWrite(ALT_IND_PIN, HIGH);
  }


  while ((millis() - startTime) < pumpTime) {
    stepper.run();
    float nowWeight = readScaleNow();

    digitalWrite(BLUE_LED_PIN, HIGH);
    digitalWrite(BLUE_LED_PIN, (millis() / 100) % 2);

    if (nowWeight < ABORT_WEIGHT_THRESHOLD) {
      digitalWrite(BLUE_LED_PIN, LOW);
      Serial.print("Weight dropped to ");
      Serial.print(nowWeight, 1);
      Serial.println(" g — aborting dispense!");
      digitalWrite(PUMP_IND_PIN, LOW);
      stepper.stop();
      while (stepper.isRunning()) stepper.run();
      abortFlag = true;
      break;
    }

    delay(10);
  }

  if (bottleNo == 1) {
    digitalWrite(PUMP_IND_PIN, LOW);
  } else {
    digitalWrite(ALT_IND_PIN, LOW);
  }
  

  if (!abortFlag) {
    Serial.print("Dispensed ");
    Serial.print(volumeML);
    Serial.println(" mL");
  }
}


// ======================================================
//                    ERROR BUZZER
// ======================================================

// 0 = Success process
// 1 = critical error
// 2 = connection success
// 3 = connection failed
// 4 = order confirmed
void showCode(int code) {
  if (code == 0) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (code == 1) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(2000);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (code == 2) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(50);
    digitalWrite(BUZZER_PIN, LOW);
    delay(50);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(50);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (code == 3) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(1000);
    digitalWrite(BUZZER_PIN, LOW);
    delay(500);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(1000);
    digitalWrite(BUZZER_PIN, LOW);
  } else if (code == 4) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(120);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(80);
    digitalWrite(BUZZER_PIN, LOW);
    delay(80);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(80);
    digitalWrite(BUZZER_PIN, LOW);
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }

}
