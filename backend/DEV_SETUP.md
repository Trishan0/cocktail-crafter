# Dev setup — current ESP32-S3 serial harness

`fake_esp32.py` lets you exercise the real `SerialController` without the physical ESP32. It implements the current firmware protocol from `arduino-code/CocktailCraft_Internal_Mechanism_Complete_Handoff.md`:

```text
Pi -> ESP32: ORDER JSON, START, CLEAN, REVERSE_PUMPS, CHECK_*
ESP32 -> Pi: DATA:<JSON> and LOG:<diagnostic>
```

It does not simulate the old `STATUS`, `SENSOR`, `ABORT`, or automatic post-order-clean protocol.

## Linux/Raspberry Pi: virtual serial pair

Install `socat`, then create a pair:

```bash
sudo apt install socat
socat -d -d pty,raw,echo=0 pty,raw,echo=0
```

The command displays two paths such as `/dev/pts/2` and `/dev/pts/3`.

1. Start the harness on one path:

   ```bash
   cd backend
   python fake_esp32.py --port /dev/pts/3
   ```

2. Set the other path in `config.py`:

   ```python
   SIMULATOR_MODE = False
   SERIAL_PORT = "/dev/pts/2"
   ```

3. Start Flask:

   ```bash
   python main.py
   ```

## Windows or TCP loopback

Start the harness:

```powershell
cd python-code
python fake_esp32.py --tcp --tcp-port 9999
```

Set `SERIAL_PORT = "socket://localhost:9999"` and `SIMULATOR_MODE = False`, then run `python main.py`.

## Expected order sequence

```text
Flask                   Fake ESP32
  | ORDER JSON              |
  |------------------------>|
  | DATA: ORDER initialized |
  |<------------------------|
  | START                   |
  |------------------------>|
  | DATA: line_priming*     |
  |<------------------------|
  | DATA: pump/mixing/valve |
  |<------------------------|
```

`line_priming` is emitted only when the harness' saved line state is empty. After `DATA: valve/opened`, Flask displays the completed drink briefly before returning its UI state to idle. `CLEAN` and `REVERSE_PUMPS` are standalone operations.
