"""Pi-facing state model for the current CocktailCraft ESP32-S3 firmware.

The ESP32 emits ``DATA:`` events, not high-level STATUS messages.  The Python
controller maps those events to the values below for the Flask/SSE clients.
``INITIALIZING`` and ``WAITING_GLASS`` are Pi/UI coordination states; the
firmware itself stores an ORDER until it receives the separate START command.
"""

from enum import Enum


# ─────────────────────────────────────────────
#  MachineState enum
# ─────────────────────────────────────────────

class MachineState(str, Enum):
    """
    Values are the stable SSE/API vocabulary.  They are not claimed to be
    literal ESP32 state strings; only the controller translates firmware
    events into them.
    """

    IDLE          = "idle"
    INITIALIZING  = "initializing"
    WAITING_GLASS = "waiting_glass"
    DISPENSING    = "dispensing"
    MIXING        = "mixing"        # drink and CLEAN both use the oscillator
    POURING       = "pouring"
    DONE          = "done"
    REVERSING     = "reversing"     # REVERSE_PUMPS maintenance sequence
    WASHING       = "washing"       # CLEAN sequence
    DRAINING      = "draining"      # retained for older SSE consumers
    RESEALING     = "resealing"     # retained for older SSE consumers
    ERROR         = "error"
    ABORTED       = "aborted"       # retained only for historical records


# ─────────────────────────────────────────────
#  Legal transition table
# ─────────────────────────────────────────────

# Every set contains the states that are allowed after the previous Pi-facing
# state. The controller rejects an unexpected event mapping instead of letting
# malformed serial traffic corrupt the UI state. Self-transitions cover
# successive events within one phase (for example, multiple pump events).

S = MachineState   # local alias for readability

LEGAL_TRANSITIONS: dict[MachineState, set[MachineState]] = {
    S.IDLE:          {S.IDLE, S.INITIALIZING, S.REVERSING, S.WASHING, S.ERROR},
    S.INITIALIZING:  {S.WAITING_GLASS, S.ERROR, S.IDLE},
    # CLEAN is accepted by the firmware while an initialized order is loaded;
    # it preserves that order and returns the Pi to WAITING_GLASS afterwards.
    S.WAITING_GLASS: {S.WAITING_GLASS, S.DISPENSING, S.WASHING, S.ERROR, S.IDLE},
    S.DISPENSING:    {S.DISPENSING, S.MIXING, S.POURING, S.DONE, S.ERROR, S.IDLE},
    S.MIXING:        {S.MIXING, S.POURING, S.IDLE, S.ERROR},
    S.POURING:       {S.DISPENSING, S.POURING, S.DONE, S.WASHING, S.IDLE, S.ERROR},
    S.DONE:          {S.DONE, S.WASHING, S.IDLE, S.ERROR},
    S.REVERSING:     {S.REVERSING, S.IDLE, S.ERROR},
    S.WASHING:       {S.WASHING, S.MIXING, S.POURING, S.WAITING_GLASS, S.IDLE, S.ERROR},
    S.DRAINING:      {S.DRAINING, S.RESEALING, S.IDLE, S.ERROR},
    S.RESEALING:     {S.RESEALING, S.IDLE, S.ERROR},
    S.ERROR:         {S.IDLE, S.INITIALIZING, S.ERROR},
    S.ABORTED:       {S.IDLE, S.INITIALIZING, S.ABORTED},
}

# Sanity check: every state has an entry in the table
assert set(LEGAL_TRANSITIONS.keys()) == set(MachineState), (
    "LEGAL_TRANSITIONS is missing entries for some MachineState values"
)


# ─────────────────────────────────────────────
#  States that block new orders
# ─────────────────────────────────────────────

ORDER_BLOCKING_STATES: frozenset[MachineState] = frozenset({
    S.INITIALIZING,
    S.WAITING_GLASS,
    S.DISPENSING,
    S.MIXING,
    S.POURING,
    S.DONE,
    S.REVERSING,
    S.WASHING,
    S.DRAINING,
    S.RESEALING,
})

ORDER_ALLOWED_STATES: frozenset[MachineState] = frozenset({
    S.IDLE,
    S.ERROR,
    S.ABORTED,
})


# ─────────────────────────────────────────────
#  Public helpers
# ─────────────────────────────────────────────

def parse_state(value: str) -> MachineState | None:
    """
    Parse a raw string from the ESP32 into a MachineState.
    Returns None if the string is not a recognised state value.
    """
    try:
        return MachineState(value.lower())
    except (ValueError, AttributeError):
        return None


def is_valid_transition(from_state: MachineState, to_state: MachineState) -> bool:
    """
    Return True if transitioning from `from_state` to `to_state` is legal.
    """
    allowed = LEGAL_TRANSITIONS.get(from_state, set())
    return to_state in allowed


def can_accept_order(machine_status: str) -> bool:
    """
    Return True if the machine is in a state that allows a new order.
    Accepts both MachineState enum values and raw status strings.
    """
    state = parse_state(machine_status) if isinstance(machine_status, str) else machine_status
    if state is None:
        return False
    return state in ORDER_ALLOWED_STATES
