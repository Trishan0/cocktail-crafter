// =============================================================
//  ESP32 — HALL SENSOR MASTER (MUX version)
//  Hall sensors on 74HC4051 MUX
//    SIG  → GPIO 15
//    S0   → GPIO 5
//    S1   → GPIO 6
//    S2   → GPIO 7
//  UART to NodeMCU via Serial1 (TX: GPIO17, RX: GPIO18)
// =============================================================

HardwareSerial MySerial(1);

// ── UART to NodeMCU ──────────────────────────────────────────
#define RXD2  18
#define TXD2  17

// ── MUX PINS ─────────────────────────────────────────────────
#define MUX_SIG  15
#define S0        5
#define S1        6
#define S2        7

// ── CONFIG ───────────────────────────────────────────────────
const int  NUM_SENSORS    = 6;
const int  DEBOUNCE_MS    = 30;     // tweak if you get false triggers

// ── STATE TRACKING ───────────────────────────────────────────
bool lastState[NUM_SENSORS];
unsigned long lastTriggerTime[NUM_SENSORS];

// ── MOTOR COMMANDS ───────────────────────────────────────────
const String MOTOR_CMD[NUM_SENSORS] = {
  "M1F", "M2F", "M3F", "M4F", "M5F", "M6F"
};

// =============================================================
void setup()
{
  Serial.begin(115200);
  MySerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  pinMode(MUX_SIG, INPUT);   // no pullup — MUX output drives the line
  pinMode(S0, OUTPUT);
  pinMode(S1, OUTPUT);
  pinMode(S2, OUTPUT);

  // Read initial states so we don't fire on boot
  for (int i = 0; i < NUM_SENSORS; i++)
  {
    lastState[i]       = readMux(i);
    lastTriggerTime[i] = 0;
  }

  Serial.println("ESP32 HALL SENSOR MASTER READY (MUX)");
}

// =============================================================
void loop()
{
  for (int i = 0; i < NUM_SENSORS; i++)
    checkSensor(i);

  delay(20);
}

// =============================================================
//  Select MUX channel and read digital value
// =============================================================
int readMux(int ch)
{
  digitalWrite(S0,  ch & 0x01);
  digitalWrite(S1, (ch >> 1) & 0x01);
  digitalWrite(S2, (ch >> 2) & 0x01);
  delayMicroseconds(20);          // settle time for MUX switching
  return digitalRead(MUX_SIG);
}

// =============================================================
//  Check one sensor channel for state change
//  Adjust the trigger edge below to match your sensor polarity:
//    Active-LOW  (most hall sensors): HIGH → LOW = magnet present
//    Active-HIGH (less common):       LOW  → HIGH = magnet present
// =============================================================
void checkSensor(int idx)
{
  int current = readMux(idx);
  unsigned long now = millis();

  // ── MAGNET DETECTED (HIGH → LOW, active-low sensor) ──────
  if (lastState[idx] == HIGH && current == LOW)
  {
    if (now - lastTriggerTime[idx] > DEBOUNCE_MS)
    {
      Serial.print("[SENSOR ");
      Serial.print(idx + 1);
      Serial.println("] MAGNET DETECTED");

      sendCommand(MOTOR_CMD[idx]);
      lastTriggerTime[idx] = now;
    }
  }

  // ── MAGNET REMOVED (LOW → HIGH) ──────────────────────────
  if (lastState[idx] == LOW && current == HIGH)
  {
    Serial.print("[SENSOR ");
    Serial.print(idx + 1);
    Serial.println("] MAGNET REMOVED");

    // Uncomment to stop motor immediately on magnet removal:
    // sendCommand("STOP");
  }

  lastState[idx] = current;
}

// =============================================================
void sendCommand(String cmd)
{
  MySerial.println(cmd);

  Serial.print("SENT → ");
  Serial.println(cmd);
}
