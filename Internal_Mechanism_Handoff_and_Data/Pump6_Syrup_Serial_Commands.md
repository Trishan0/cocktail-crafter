# Pump 6 Syrup-Line Serial Commands

These commands are implemented in:

`9___Full_Internal_Mechanism_Pump6_Post_Valve_Syrup.ino`

They are intentionally **not added to the startup command-list serial log**.

## State and maintenance

### `CHECK_PUMP6_STATE`

Returns the persistent pump-6 line state:

```text
DATA:{"type":"response","command":"CHECK_PUMP6_STATE","primed":true,"state":"PRIMED"}
```

or:

```text
DATA:{"type":"response","command":"CHECK_PUMP6_STATE","primed":false,"state":"UNPRIMED"}
```

### `PUMP6_PRIME`

When the machine is idle and the line is marked unprimed:

1. Runs pump 6 forward for 2300 ms.
2. Stops pump 6.
3. Permanently saves the pump-6 line state as `PRIMED`.

If already primed:

```text
LOG:PUMP6_ALREADY_PRIMED
```

### `PUMP6_SET_PRIMED`

Manually sets the persistent pump-6 line state to `PRIMED` without moving the pump.

Use only after physically verifying that the syrup line is primed.

### `PUMP6_SET_UNPRIMED`

Manually sets the persistent pump-6 line state to `UNPRIMED` without moving the pump.

This is the only normal way the pump-6 primed state becomes false after it has been primed.

## Direct manual pump control

### `PUMP6_ON`

Runs pump 6 forward continuously.

It does not change the persistent primed/unprimed state automatically.

### `PUMP6_OFF`

Stops pump 6 when it was started using `PUMP6_ON` or `PUMP6_PRIME`.

It cannot interrupt the automatic order-related pump-6 sequence.

## Automatic order behavior

For an order such as:

```json
{"command":"ORDER","order_id":"ORD-1042","pumps":[{"pump":1,"time_ms":3333},{"pump":6,"time_ms":1500}],"ice":{"enabled":true}}
```

the firmware performs:

1. Pump 6 is excluded from the indexer.
2. Automatic main-line priming covers only pumps 1–5.
3. If pump 6 is requested and its persistent line state is `UNPRIMED`, pump 6 is primed for 2300 ms before the valve/indexer/mixer sequence begins.
4. The valve closes.
5. The indexer processes pumps 1–5 only.
6. Mixing and homing complete.
7. The valve opens.
8. The firmware waits exactly 2000 ms.
9. Pump 6 runs forward for the requested `time_ms`.
10. Pump 6 stops and the order finishes.

The actual order pump-6 run still sends normal pump JSON:

```text
DATA:{"type":"system","event":"pump","pump":6,"action":"forward"}
DATA:{"type":"system","event":"pump","pump":6,"action":"stop"}
```

Automatic or manual pump-6 priming uses debug logs only and does not emit the normal per-pump JSON.

## Reverse behavior

`REVERSE_PUMPS` now reverses only pumps 1–5.

Pump 6:

- is never reversed;
- is never included in the main feed-line priming sequence;
- is not marked unprimed by `REVERSE_PUMPS`;
- remains permanently primed unless `PUMP6_SET_UNPRIMED` is sent.
