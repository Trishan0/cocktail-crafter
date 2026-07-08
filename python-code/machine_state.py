"""
machine_state.py — MachineState Enum + Transition Validation
Cocktail-Craft Bartender | Raspberry Pi

Single source of truth for the machine state enum and all legal state
transitions as defined in PROTOCOL.md §4.

Used by hardware_controller._handle_status() to validate every incoming
STATUS message before trusting it. Illegal or unknown transitions are
logged and rejected — the stale known-good state is preserved instead.
"""

from enum import Enum


# ─────────────────────────────────────────────
#  MachineState enum
# ─────────────────────────────────────────────

class MachineState(str, Enum):
    """
    Full state space for the Cocktail-Craft ESP32 state machine.

    Values are lowercase strings matching what the ESP32 sends over the wire
    (and what the existing UI/API layer already expects), so the enum can be
    used directly as a string wherever needed.

    Normal order lifecycle:
        IDLE → WAITING_GLASS → DISPENSING → MIXING → POURING → DONE

    Post-order auto-clean (fires automatically after every DONE):
        DONE → REVERSING → [gate: glass_state == "no_glass"] → WASHING → MIXING → DRAINING → RESEALING → IDLE

    Manual clean (admin-triggered, line-only — never enters WASHING/DRAINING/RESEALING):
        IDLE → REVERSING → IDLE

    Error / abort:
        Any → ERROR | ABORTED → IDLE (after explicit recovery)

    Design note (PROTOCOL.md §4, open item):
        MIXING is reused for both the drink-shake step and the post-clean
        shake step — same physical NEMA17 mechanism. This is intentional;
        the code comment here serves as the explicit call-out so it's never
        mistaken for a bug.
    """

    IDLE          = "idle"
    WAITING_GLASS = "waiting_glass"
    DISPENSING    = "dispensing"
    MIXING        = "mixing"        # used for both drink shake AND post-clean shake
    POURING       = "pouring"
    DONE          = "done"
    REVERSING     = "reversing"     # pump lines run backward (first step of auto-clean)
    WASHING       = "washing"       # water into container
    DRAINING      = "draining"      # water exits via drink path
    RESEALING     = "resealing"     # n20 reseals the container
    ERROR         = "error"
    ABORTED       = "aborted"


# ─────────────────────────────────────────────
#  Legal transition table (PROTOCOL.md §4)
# ─────────────────────────────────────────────

# Every set contains the states that are ALLOWED as the next state from the
# given current state. Incoming STATUS messages are rejected if they would
# produce a transition not listed here.
#
# Self-transitions (e.g. DISPENSING → DISPENSING) are listed where the ESP32
# sends multiple progress updates within a single phase.

S = MachineState   # local alias for readability

LEGAL_TRANSITIONS: dict[MachineState, set[MachineState]] = {
    # ── Idle — can start an order or a manual clean
    S.IDLE:          {S.WAITING_GLASS, S.REVERSING, S.ERROR, S.ABORTED},

    # ── Order sequence ────────────────────────
    S.WAITING_GLASS: {S.DISPENSING, S.ERROR, S.ABORTED},

    # DISPENSING self-loop: ESP32 sends multiple updates at different progress %
    S.DISPENSING:    {S.DISPENSING, S.MIXING, S.DONE, S.ERROR, S.ABORTED},

    # MIXING self-loop for same reason; goes to POURING, DONE, or DRAINING (clean)
    S.MIXING:        {S.MIXING, S.POURING, S.DONE, S.DRAINING, S.ERROR, S.ABORTED},

    S.POURING:       {S.DONE, S.ERROR, S.ABORTED},

    # ── Post-order auto-clean sequence ────────
    # DONE can go to REVERSING (auto-clean) or back to IDLE (if no auto-clean)
    S.DONE:          {S.REVERSING, S.IDLE, S.ERROR, S.ABORTED},

    # REVERSING self-loop: two progress updates (0% start, 50% "please remove glass")
    # REVERSING → WASHING: only after glass_state == "no_glass" (gate enforced ESP32-side)
    # REVERSING → IDLE:    end of a manual clean cycle
    S.REVERSING:     {S.REVERSING, S.WASHING, S.IDLE, S.ERROR, S.ABORTED},

    S.WASHING:       {S.MIXING, S.ERROR, S.ABORTED},
    S.DRAINING:      {S.RESEALING, S.ERROR, S.ABORTED},
    S.RESEALING:     {S.IDLE, S.ERROR, S.ABORTED},

    # ── Error / abort recovery ────────────────
    # Return to IDLE only; exact ack mechanism TBD (PROTOCOL.md §4.3 open item)
    S.ERROR:         {S.IDLE, S.ERROR},
    S.ABORTED:       {S.IDLE, S.ABORTED},
}

# Sanity check: every state has an entry in the table
assert set(LEGAL_TRANSITIONS.keys()) == set(MachineState), (
    "LEGAL_TRANSITIONS is missing entries for some MachineState values"
)


# ─────────────────────────────────────────────
#  States that BLOCK new orders (PROTOCOL.md §4)
# ─────────────────────────────────────────────

# "No new order is accepted by the Pi from DONE through IDLE."
# The whole post-order clean cycle is blocking, by design.
ORDER_BLOCKING_STATES: frozenset[MachineState] = frozenset({
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

# States from which a new order IS accepted
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
