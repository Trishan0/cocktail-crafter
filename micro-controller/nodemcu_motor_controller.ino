// =============================================================
//  NodeMCU (ESP32) — MOTOR CONTROLLER
//  Receives motor commands from ESP32 master via UART2
//  Controls 6 DC peristaltic pumps via two TB6612FNG drivers
//
//  Driver 1 → M1 (IN1/IN2: 21/22)  M2 (IN1/IN2: 23/19)  M3 (IN1/IN2: 27/32)
//  Driver 2 → M4 (IN1/IN2: 33/16)  M5 (IN1/IN2: 17/4)   M6 (IN1/IN2: 13/14)
//
//  Both drivers share a single PWM pin (25) and STBY pin (18).
//  STBY is held HIGH permanently — motors are controlled via IN1/IN2.
//  Each MxF command runs that motor forward for RUN_DURATION_MS then stops.
// =============================================================

HardwareSerial MySerial(2);   // UART2

// ── UART from ESP32 ──────────────────────────────────────────
#define RXD2  26
#define TXD2  15

// ── SHARED DRIVER PINS ───────────────────────────────────────
#define STBY_PIN  18
#define PWM_PIN   25

// ── MOTOR PINS ───────────────────────────────────────────────
#define M1_IN1  21
#define M1_IN2  22

#define M2_IN1  23
#define M2_IN2  19

#define M3_IN1  27
#define M3_IN2  32

#define M4_IN1  33
#define M4_IN2  16

#define M5_IN1  17
#define M5_IN2   4

#define M6_IN1  13
#define M6_IN2  14

// ── PWM CONFIG ───────────────────────────────────────────────
const int PWM_FREQ       = 20000;   // 20 kHz — above audible range
const int PWM_RESOLUTION = 8;       // 0–255
const int MOTOR_SPEED    = 255;     // full speed; lower if needed

// ── RUN DURATION ─────────────────────────────────────────────
const int RUN_DURATION_MS = 2000;   // how long each pump runs (ms)

// ── MOTOR PIN TABLE ──────────────────────────────────────────
const int IN1[6] = { M1_IN1, M2_IN1, M3_IN1, M4_IN1, M5_IN1, M6_IN1 };
const int IN2[6] = { M1_IN2, M2_IN2, M3_IN2, M4_IN2, M5_IN2, M6_IN2 };

// ── SERIAL BUFFER ────────────────────────────────────────────
String receivedCommand = "";

// =============================================================
void setup()
{
  Serial.begin(115200);
  MySerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  for (int i = 0; i < 6; i++)
  {
    pinMode(IN1[i], OUTPUT);
    pinMode(IN2[i], OUTPUT);
  }

  pinMode(STBY_PIN, OUTPUT);
  digitalWrite(STBY_PIN, HIGH);     // take drivers out of standby

  ledcAttach(PWM_PIN, PWM_FREQ, PWM_RESOLUTION);
  ledcWrite(PWM_PIN, MOTOR_SPEED);

  stopAllMotors();

  Serial.println("NODEMCU MOTOR CONTROLLER READY");
}

// =============================================================
void loop()
{
  while (MySerial.available())
  {
    char c = MySerial.read();

    if (c == '\n')
    {
      receivedCommand.trim();

      if (receivedCommand.length() > 0)
      {
        Serial.print("RECEIVED: ");
        Serial.println(receivedCommand);

        processCommand(receivedCommand);
      }

      receivedCommand = "";
    }
    else
    {
      receivedCommand += c;
    }
  }
}

// =============================================================
void processCommand(String cmd)
{
  if      (cmd == "M1F")  runMotor(0);
  else if (cmd == "M2F")  runMotor(1);
  else if (cmd == "M3F")  runMotor(2);
  else if (cmd == "M4F")  runMotor(3);
  else if (cmd == "M5F")  runMotor(4);
  else if (cmd == "M6F")  runMotor(5);
  else if (cmd == "STOP") stopAllMotors();
  else
  {
    Serial.print("UNKNOWN COMMAND: ");
    Serial.println(cmd);
  }
}

// =============================================================
//  Run one motor forward for RUN_DURATION_MS, then stop it.
//  Uses blocking delay — fine for single-pump-at-a-time logic.
//  If you ever need concurrent pumps, replace with a non-blocking
//  timer approach.
// =============================================================
void runMotor(int idx)
{
  Serial.print("RUNNING MOTOR ");
  Serial.println(idx + 1);

  digitalWrite(IN1[idx], HIGH);
  digitalWrite(IN2[idx], LOW);

  delay(RUN_DURATION_MS);

  digitalWrite(IN1[idx], LOW);
  digitalWrite(IN2[idx], LOW);

  Serial.print("MOTOR ");
  Serial.print(idx + 1);
  Serial.println(" STOPPED");
}

// =============================================================
void stopAllMotors()
{
  for (int i = 0; i < 6; i++)
  {
    digitalWrite(IN1[i], LOW);
    digitalWrite(IN2[i], LOW);
  }
  Serial.println("ALL MOTORS STOPPED");
}
