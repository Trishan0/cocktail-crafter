#include <Preferences.h>

Preferences preferences;

void setup()
{
    Serial.begin(115200);

    preferences.begin("pinchValve", false);
    preferences.clear();
    preferences.end();

    Serial.println("Pinch-valve storage cleared");
}

void loop()
{
}