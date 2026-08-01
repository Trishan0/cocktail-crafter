HardwareSerial MySerial(1);

#define RXD2 18
#define TXD2 17

#define STEPPER_EN_PIN 16

void sendCmd(String cmd)
{
  MySerial.println(cmd);
  Serial.print("Sent: ");
  Serial.println(cmd);
  delay(100);
}

void runMotorForward(int motor)
{
  String forwardCmd = "M" + String(motor) + "F";
  String stopCmd = "M" + String(motor) + "S";

  sendCmd(forwardCmd);

  delay(500);

  sendCmd(stopCmd);
}

void reverseAllMotors()
{
  Serial.println("Starting reverse sequence...");

  for (int i = 1; i <= 6; i++)
  {
    String reverseCmd = "M" + String(i) + "R";
    String stopCmd = "M" + String(i) + "S";

    sendCmd(reverseCmd);

    delay(4000); // reverse for 1 second

    sendCmd(stopCmd);

    delay(500); // small gap between motors
  }

  Serial.println("Reverse sequence complete");
}

void setup()
{
  Serial.begin(115200);
  MySerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  Serial.println("MAIN MOTOR MANUAL TEST READY");
  Serial.println("----------------------------");
  Serial.println("1-6 : Run motor forward for 4 seconds");
  Serial.println("a   : Reverse all motors one by one");
  Serial.println("s   : STOP all motors");

  pinMode(STEPPER_EN_PIN, OUTPUT);
  digitalWrite(STEPPER_EN_PIN, HIGH);
}

void loop()
{
  if (Serial.available())
  {
    char cmd = Serial.read();

    if (cmd >= '1' && cmd <= '6')
    {
      int motorNum = cmd - '0';

      Serial.print("Running Motor ");
      Serial.println(motorNum);

      runMotorForward(motorNum);
    }
    else if (cmd == 'a' || cmd == 'A')
    {
      reverseAllMotors();
    }
    else if (cmd == 's' || cmd == 'S')
    {
      sendCmd("STOP");
      Serial.println("All motors stopped");
    }
  }
}