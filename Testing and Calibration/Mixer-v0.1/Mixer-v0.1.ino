#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <AccelStepper.h>

// ===================== MCP23017 =====================
Adafruit_MCP23X17 mcp;

#define SDA_PIN 8
#define SCL_PIN 9

const uint8_t HALL_PIN = 0;      // PA0

// ===================== STEPPER =======================
const int STEP_PIN = 12;
const int DIR_PIN  = 13;
const int EN_PIN   = 16;

AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

// ===================== SETTINGS ======================
const long FIRST_MOVE_DISTANCE      = 800;
const long RECOVERY_SEARCH_DISTANCE = 400;

const float MAX_SPEED    = 20000;
const float ACCELERATION = 10000;

// ===================== STATES ========================
bool oscillating   = false;
bool stopRequested = false;
bool directionFlip = false;

bool returningHome = false;
bool recoveryMode  = false;

uint8_t recoveryStage = 0;

// =====================================================

bool hallDetected()
{
    return mcp.digitalRead(HALL_PIN) == LOW;   // Active LOW
}

void finishHoming()
{
    stepper.stop();

    while (stepper.isRunning())
        stepper.run();

    stepper.setCurrentPosition(0);

    returningHome = false;
    recoveryMode  = false;

    Serial.println("HOMED");
}

// =====================================================

void setup()
{
    Serial.begin(115200);

    pinMode(EN_PIN, OUTPUT);
    digitalWrite(EN_PIN, LOW);

    Wire.begin(SDA_PIN, SCL_PIN);

    if (!mcp.begin_I2C(0x20))
    {
        Serial.println("MCP23017 not found!");
        while (1);
    }

    mcp.pinMode(HALL_PIN, INPUT_PULLUP);

    stepper.setMaxSpeed(MAX_SPEED);
    stepper.setAcceleration(ACCELERATION);

    if (hallDetected())
    {
        stepper.setCurrentPosition(0);
        Serial.println("HOME DETECTED AT STARTUP");
    }

    Serial.println("READY");
}

// =====================================================

void loop()
{
    stepper.run();

    // ---------------- Serial Commands ----------------

    if (Serial.available())
    {
        char cmd = Serial.read();

        switch (cmd)
        {
            case 's':

                if (!oscillating && !returningHome && !recoveryMode)
                {
                    Serial.println("START");

                    oscillating   = true;
                    stopRequested = false;
                    directionFlip = false;

                    stepper.moveTo(FIRST_MOVE_DISTANCE);
                }

                break;

            case 'x':

                if (oscillating)
                {
                    Serial.println("STOP REQUESTED");
                    stopRequested = true;
                }

                break;
        }
    }

    // ---------------- Oscillation ----------------

    if (oscillating && stepper.distanceToGo() == 0)
    {
        if (stopRequested)
        {
            Serial.println("RETURNING HOME");

            oscillating   = false;
            stopRequested = false;
            returningHome = true;

            stepper.moveTo(0);
        }
        else
        {
            directionFlip = !directionFlip;

            stepper.moveTo(directionFlip ?
                           -FIRST_MOVE_DISTANCE :
                            FIRST_MOVE_DISTANCE);
        }
    }

    // ---------------- Return Home ----------------

    if (returningHome)
    {
        if (hallDetected())
        {
            Serial.println("HOME CONFIRMED");
            finishHoming();
        }
        else if (stepper.distanceToGo() == 0)
        {
            Serial.println("HOME NOT FOUND -> RECOVERY");

            returningHome = false;
            recoveryMode  = true;
            recoveryStage = 0;

            stepper.moveTo(-RECOVERY_SEARCH_DISTANCE);
        }
    }

    // ---------------- Recovery ----------------

    if (recoveryMode)
    {
        if (hallDetected())
        {
            Serial.println("HOME RECOVERED");
            finishHoming();
        }
        else if (stepper.distanceToGo() == 0)
        {
            recoveryStage++;

            switch (recoveryStage)
            {
                case 1:
                    Serial.println("SEARCH OTHER SIDE");
                    stepper.moveTo(RECOVERY_SEARCH_DISTANCE);
                    break;

                case 2:
                    Serial.println("RETURN CENTER");
                    stepper.moveTo(0);
                    break;

                default:
                    Serial.println("HOME SEARCH FAILED");
                    recoveryMode = false;
                    break;
            }
        }
    }
}