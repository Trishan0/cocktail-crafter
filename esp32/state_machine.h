// ════════════════════════════════════════════════
//  state_machine.h — Main Control Logic
//  Runs entirely in loop(). Never blocks.
//  MQTT callback only sets flags; logic runs here.
// ════════════════════════════════════════════════
#pragma once
#include "config.h"
#include "pumps.h"
#include "sensors.h"

// Forward declarations of publish helpers
void publishStatus(const char* status, int progress, const char* message);
void publishSensor(bool glass);

// ── Shared globals (defined in esp32.ino) ─────────
extern bool g_newOrder;
extern bool g_abortRequested;
extern bool g_cleanRequested;
extern int  g_orderId;
extern int  g_bottle[6];

// ── Machine States ────────────────────────────────
enum MachineState {
  ST_IDLE,
  ST_WAITING_GLASS,
  ST_DISPENSING,
  ST_DONE,
  ST_ABORTED,
  ST_CLEANING,
  ST_ERROR
};

MachineState currentState = ST_IDLE;

// ── Dispensing tracking vars ──────────────────────
static int           _dispBottle   = 0;
static bool          _pumpRunning  = false;
static unsigned long _pumpStart    = 0;
static unsigned long _doneTime     = 0;

// ── State Machine Runner ──────────────────────────
void stateMachineRun() {

  // Read sensors every tick
  bool glass = readGlassPresent();

  // ── Abort takes priority from any active state ──
  if (g_abortRequested &&
      currentState != ST_IDLE &&
      currentState != ST_ABORTED) {
    stopAllPumps();
    g_abortRequested = false;
    publishStatus("aborted", 0, "Stopped");
    currentState = ST_ABORTED;
    Serial.println("[SM] → ABORTED");
    return;
  }

  // ── New order accepted only when idle ───────────
  if (g_newOrder && currentState == ST_IDLE) {
    g_newOrder   = false;
    _dispBottle  = 0;
    _pumpRunning = false;
    publishStatus("waiting_glass", 0, "Place your glass");
    currentState = ST_WAITING_GLASS;
    Serial.println("[SM] → WAITING_GLASS");
    return;
  }

  // ── Cleaning request ────────────────────────────
  if (g_cleanRequested && currentState == ST_IDLE) {
    g_cleanRequested = false;
    currentState = ST_CLEANING;
    Serial.println("[SM] → CLEANING");
    return;
  }

  switch (currentState) {

    // ── IDLE ────────────────────────────────────────
    case ST_IDLE:
      break;

    // ── WAITING FOR GLASS ───────────────────────────
    case ST_WAITING_GLASS:
      if (glass) {
        _dispBottle  = 0;
        _pumpRunning = false;
        publishStatus("dispensing", 0, "Starting...");
        currentState = ST_DISPENSING;
        Serial.println("[SM] → DISPENSING");
      }
      break;

    // ── DISPENSING ──────────────────────────────────
    case ST_DISPENSING:
      // Advance past empty bottles
      while (_dispBottle < 6 && g_bottle[_dispBottle] == 0) {
        _dispBottle++;
      }

      if (_dispBottle >= 6) {
        // All done
        stopAllPumps();
        publishStatus("done", 100, "Enjoy your drink!");
        _doneTime    = millis();
        currentState = ST_DONE;
        Serial.println("[SM] → DONE");
        break;
      }

      {
        int ml  = g_bottle[_dispBottle];
        int pct = (_dispBottle * 100) / 6;

        if (!_pumpRunning) {
          String msg = "Bottle " + String(_dispBottle + 1) + " (" + String(ml) + "ml)";
          publishStatus("dispensing", pct, msg.c_str());
          pumpOn(_dispBottle);
          _pumpStart   = millis();
          _pumpRunning = true;
        } else {
          if (millis() - _pumpStart >= calcDuration(_dispBottle, ml)) {
            pumpOff(_dispBottle);
            _pumpRunning = false;
            _dispBottle++;
          }
        }
      }
      break;

    // ── DONE ────────────────────────────────────────
    case ST_DONE:
      if (millis() - _doneTime >= DONE_RESET_MS) {
        currentState = ST_IDLE;
        Serial.println("[SM] → IDLE");
      }
      break;

    // ── ABORTED ─────────────────────────────────────
    case ST_ABORTED:
      currentState = ST_IDLE;
      Serial.println("[SM] → IDLE (after abort)");
      break;

    // ── CLEANING ────────────────────────────────────
    case ST_CLEANING:
      publishStatus("cleaning", 0, "Cleaning...");
      // TODO: run water flush when servo/solenoid are wired
      // For now, simulate a 3s delay without blocking:
      delay(3000);
      publishStatus("idle", 0, "Cleaning done");
      currentState = ST_IDLE;
      Serial.println("[SM] → IDLE (after clean)");
      break;

    // ── ERROR ────────────────────────────────────────
    case ST_ERROR:
      stopAllPumps();
      publishStatus("error", 0, "Error — check hardware");
      currentState = ST_IDLE;
      break;
  }
}
