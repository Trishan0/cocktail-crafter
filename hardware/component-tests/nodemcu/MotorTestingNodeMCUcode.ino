HardwareSerial MySerial(2);

#define RXD2 26
#define TXD2 15

#define STBY_PIN 18
#define PWM_PIN  25

#define M1_IN1 21
#define M1_IN2 22

#define M2_IN1 23
#define M2_IN2 19

#define M3_IN1 27
#define M3_IN2 32

#define M4_IN1 33
#define M4_IN2 16

#define M5_IN1 17
#define M5_IN2 4

#define M6_IN1 13
#define M6_IN2 14

const int pwmFreq = 20000;
const int pwmResolution = 8;
const int motorSpeed = 255;

String receivedCommand = "";

void setup()
{
  Serial.begin(115200);

  MySerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  pinMode(M1_IN1, OUTPUT);
  pinMode(M1_IN2, OUTPUT);

  pinMode(M2_IN1, OUTPUT);
  pinMode(M2_IN2, OUTPUT);

  pinMode(M3_IN1, OUTPUT);
  pinMode(M3_IN2, OUTPUT);

  pinMode(M4_IN1, OUTPUT);
  pinMode(M4_IN2, OUTPUT);

  pinMode(M5_IN1, OUTPUT);
  pinMode(M5_IN2, OUTPUT);

  pinMode(M6_IN1, OUTPUT);
  pinMode(M6_IN2, OUTPUT);

  pinMode(STBY_PIN, OUTPUT);
  digitalWrite(STBY_PIN, HIGH);

  ledcAttach(PWM_PIN, pwmFreq, pwmResolution);
  ledcWrite(PWM_PIN, motorSpeed);

  stopAllMotors();

  Serial.println("NODEMCU MOTOR CONTROLLER READY");
}

void loop()
{
  while (MySerial.available())
  {
    char c = MySerial.read();

    if (c == '\n')
    {
      receivedCommand.trim();

      Serial.print("Received: ");
      Serial.println(receivedCommand);

      processCommand(receivedCommand);

      receivedCommand = "";
    }
    else
    {
      receivedCommand += c;
    }
  }
}

void processCommand(String cmd)
{
  if (cmd == "M1F")
    motorForward(M1_IN1, M1_IN2);

  else if (cmd == "M1R")
    motorReverse(M1_IN1, M1_IN2);

  else if (cmd == "M1S")
    stopMotor(M1_IN1, M1_IN2);

  else if (cmd == "M2F")
    motorForward(M2_IN1, M2_IN2);

  else if (cmd == "M2R")
    motorReverse(M2_IN1, M2_IN2);

  else if (cmd == "M2S")
    stopMotor(M2_IN1, M2_IN2);

  else if (cmd == "M3F")
    motorForward(M3_IN1, M3_IN2);

  else if (cmd == "M3R")
    motorReverse(M3_IN1, M3_IN2);

  else if (cmd == "M3S")
    stopMotor(M3_IN1, M3_IN2);

  else if (cmd == "M4F")
    motorForward(M4_IN1, M4_IN2);

  else if (cmd == "M4R")
    motorReverse(M4_IN1, M4_IN2);

  else if (cmd == "M4S")
    stopMotor(M4_IN1, M4_IN2);

  else if (cmd == "M5F")
    motorForward(M5_IN1, M5_IN2);

  else if (cmd == "M5R")
    motorReverse(M5_IN1, M5_IN2);

  else if (cmd == "M5S")
    stopMotor(M5_IN1, M5_IN2);

  else if (cmd == "M6F")
    motorForward(M6_IN1, M6_IN2);

  else if (cmd == "M6R")
    motorReverse(M6_IN1, M6_IN2);

  else if (cmd == "M6S")
    stopMotor(M6_IN1, M6_IN2);

  else if (cmd == "STOP")
    stopAllMotors();
}

void motorForward(int in1, int in2)
{
  digitalWrite(in1, HIGH);
  digitalWrite(in2, LOW);
}

void motorReverse(int in1, int in2)
{
  digitalWrite(in1, LOW);
  digitalWrite(in2, HIGH);
}

void stopMotor(int in1, int in2)
{
  digitalWrite(in1, LOW);
  digitalWrite(in2, LOW);
}

void stopAllMotors()
{
  stopMotor(M1_IN1, M1_IN2);
  stopMotor(M2_IN1, M2_IN2);
  stopMotor(M3_IN1, M3_IN2);
  stopMotor(M4_IN1, M4_IN2);
  stopMotor(M5_IN1, M5_IN2);
  stopMotor(M6_IN1, M6_IN2);
}