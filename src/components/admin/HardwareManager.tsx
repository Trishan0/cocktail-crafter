import { useState, useEffect } from "react";
import { Activity, ShieldAlert, Droplet, Cpu, Radio, Power, RefreshCw, Terminal, GlassWater } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cleanSystem, abortOrder, getAdminEvents, getGlassCapacityConfig, getLiquidLevelConfig, getPowerState, getStatus, queryHardware, sendHardwareDebugCommand, setGlassCapacityConfig, setLiquidLevelConfig, setPowerState } from "@/lib/api";

interface HardwareManagerProps {
  machineStatus: string;
}

export function HardwareManager({ machineStatus }: HardwareManagerProps) {
  const [cleaning, setCleaning] = useState(false);
  const [isSimulator, setIsSimulator] = useState<boolean | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [poweredOn, setPoweredOn] = useState<boolean | null>(null);
  const [switchingPower, setSwitchingPower] = useState(false);
  const [liquidLevels, setLiquidLevels] = useState<Record<string, number | null>>(
    Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`ls${index + 1}`, null]))
  );
  const [checkingLevels, setCheckingLevels] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [levelAboveValue, setLevelAboveValue] = useState<number | null>(null);
  const [savingLevelPolarity, setSavingLevelPolarity] = useState(false);
  const [smallGlassCapacity, setSmallGlassCapacity] = useState("");
  const [savingGlassCapacity, setSavingGlassCapacity] = useState(false);
  const [glassCapacityError, setGlassCapacityError] = useState<string | null>(null);
  const [debugCommand, setDebugCommand] = useState<string | null>(null);
  const [pendingDebugCommand, setPendingDebugCommand] = useState<string | null>(null);
  const [debugOutput, setDebugOutput] = useState<string[]>([]);

  const BASE = `http://${window.location.hostname}:5000`;

  // Fetch current mode on mount
  useEffect(() => {
    fetch(`${BASE}/api/admin/mode`)
      .then(r => r.json())
      .then(d => setIsSimulator(d.simulator))
      .catch(console.error);
    getPowerState()
      .then(d => setPoweredOn(d.powered_on))
      .catch(console.error);
    getStatus()
      .then(d => updateLiquidLevels(d.liquid_levels))
      .catch(console.error);
    getLiquidLevelConfig()
      .then(d => {
        setLevelAboveValue(d.above_value === 0 || d.above_value === 1 ? d.above_value : null);
      })
      .catch(console.error);
    getGlassCapacityConfig()
      .then(d => setSmallGlassCapacity(String(d.small_glass_max_ml ?? "")))
      .catch(console.error);
  }, []);

  const updateLiquidLevels = (levels: Record<string, number | null> | undefined) => {
    if (!levels) return;
    setLiquidLevels(Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const key = `ls${index + 1}`;
        const value = levels[key];
        return [key, value === 0 || value === 1 ? value : null];
      })
    ));
    setCheckingLevels(false);
    setLevelError(null);
  };

  useEffect(() => {
    const evtSource = new EventSource(`http://${window.location.hostname}:5000/stream`);
    const updateFromEvent = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      updateLiquidLevels(data.liquid_levels);
    };
    evtSource.addEventListener("init", updateFromEvent);
    evtSource.addEventListener("sensor", updateFromEvent);
    return () => evtSource.close();
  }, []);

  const handleModeToggle = async (toSimulator: boolean) => {
    if (machineStatus !== "idle") {
      alert(`Cannot switch mode while machine is "${machineStatus}". Wait until idle.`);
      return;
    }
    setSwitchingMode(true);
    try {
      const res = await fetch(`${BASE}/api/admin/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulator: toSimulator }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch mode");
      // Small delay so the new controller has time to start
      setTimeout(() => {
        setIsSimulator(toSimulator);
        setSwitchingMode(false);
      }, 1200);
    } catch (e: any) {
      alert("Mode switch failed: " + e.message);
      setSwitchingMode(false);
    }
  };
  const handlePowerToggle = async (nextPoweredOn: boolean) => {
    if (machineStatus !== "idle") {
      alert(`Cannot change power while machine is "${machineStatus}". Wait until idle.`);
      return;
    }
    setSwitchingPower(true);
    try {
      const data = await setPowerState(nextPoweredOn);
      setPoweredOn(data.powered_on);
    } catch (e: any) {
      alert("Power change failed: " + (e.message || e));
    } finally {
      setSwitchingPower(false);
    }
  };

  const handleClean = async () => {
    setCleaning(true);
    try {
      await cleanSystem("all");
      setTimeout(() => setCleaning(false), 5000);
    } catch (e: any) {
      alert("Failed to start clean: " + e.message);
      setCleaning(false);
    }
  };

  const handleAbort = async () => {
    try {
      await abortOrder();
      alert("STOP request sent. This firmware only stops mixing/ice activity; use the physical emergency stop for a full halt.");
    } catch (e: any) {
      alert("Abort failed: " + e.message);
    }
  };

  const handleCheckLevels = async () => {
    setCheckingLevels(true);
    setLevelError(null);
    try {
      await queryHardware("CHECK_LEVELS");
    } catch (e: any) {
      setCheckingLevels(false);
      setLevelError(e.message || "Could not request liquid-level readings.");
    }
  };

  const handleSetLevelPolarity = async (value: 0 | 1) => {
    setSavingLevelPolarity(true);
    setLevelError(null);
    try {
      const data = await setLiquidLevelConfig(value);
      setLevelAboveValue(data.above_value);
    } catch (e: any) {
      setLevelError(e.message || "Could not save the shared sensor calibration.");
    } finally {
      setSavingLevelPolarity(false);
    }
  };

  const handleSaveGlassCapacity = async () => {
    const capacity = Number(smallGlassCapacity);
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 300) {
      setGlassCapacityError("Enter a capacity between 1 and 300 ml.");
      return;
    }
    setSavingGlassCapacity(true);
    setGlassCapacityError(null);
    try {
      const data = await setGlassCapacityConfig(capacity);
      setSmallGlassCapacity(String(data.small_glass_max_ml));
    } catch (e: any) {
      setGlassCapacityError(e.message || "Could not save the small-glass capacity.");
    } finally {
      setSavingGlassCapacity(false);
    }
  };

  const refreshDebugOutput = async () => {
    const events = await getAdminEvents(12);
    const lines = events.map((event: any) => {
      const time = event.timestamp ? new Date(`${event.timestamp}Z`).toLocaleTimeString() : "";
      return `${time}  ${event.event_type}${event.detail ? `: ${event.detail}` : ""}`;
    });
    setDebugOutput(lines);
    return lines.length;
  };

  const runDebugCommand = async (command: string) => {
    setDebugCommand(command);
    try {
      const result = await sendHardwareDebugCommand(command);
      await new Promise(resolve => window.setTimeout(resolve, 300));
      const outputCount = await refreshDebugOutput();
      if (!outputCount) setDebugOutput([result.message]);
    } catch (e: any) {
      setDebugOutput([`ERROR: ${e.message || e}`]);
    } finally {
      setDebugCommand(null);
    }
  };

  const handleDebugCommand = (command: string) => {
    setPendingDebugCommand(command);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <AlertDialog open={pendingDebugCommand !== null} onOpenChange={(open) => !open && setPendingDebugCommand(null)}>
        <AlertDialogContent className="sm:max-w-md rounded-3xl border-amber-500/30 bg-card/95 text-card-foreground backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-light text-amber-200">Confirm diagnostic command</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-muted-foreground">
              <span className="font-mono text-amber-300">{pendingDebugCommand}</span>{" "}
              {pendingDebugCommand === "ICE"
                ? "starts the standalone ice cycle and physically moves the ice mechanism."
                : ["ICE_SET_OPEN", "ICE_SET_CLOSED"].includes(pendingDebugCommand || "")
                  ? "changes the saved ice position only; it does not move the mechanism. Use it only after verifying the physical position."
                  : "will request a live diagnostic reading from the ESP32 and add its response to the diagnostic log."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                const command = pendingDebugCommand;
                setPendingDebugCommand(null);
                if (command) void runDebugCommand(command);
              }}
            >
              Confirm action
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 md:mb-10 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-light mb-1 md:mb-2">Hardware Controls</h2>
          <p className="text-sm md:text-base text-muted-foreground">Manage IoT settings, sensors, and manual overrides</p>
        </div>
      </div>
      
      <div className="grid gap-6 md:gap-8 max-w-4xl">

        {/* Machine Power */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className={`w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors duration-500 ${
              poweredOn
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-red-500/20 text-red-400 border-red-500/30"
            }`}>
              <Power className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">
                {poweredOn === null ? "Loading Power State..." : poweredOn ? "Machine Powered On" : "Machine Powered Off"}
              </h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                Customer ordering is enabled only while powered on. The ESP32 independently primes all six lines when its saved feed-line state is empty.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              size="lg"
              onClick={() => handlePowerToggle(!poweredOn)}
              disabled={switchingPower || poweredOn === null || machineStatus !== "idle"}
              className={`w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg transition-all ${
                poweredOn ? "bg-red-500 hover:bg-red-600 text-white" : "bg-green-500 hover:bg-green-400 text-white"
              } disabled:opacity-50`}
            >
              {switchingPower ? "Switching..." : poweredOn ? "Power Off" : "Power On"}
            </Button>
            {machineStatus !== "idle" && (
              <span className="text-xs text-orange-400 mt-1">Machine busy - power unavailable</span>
            )}
          </div>
        </div>
        {/* Simulator / Live Mode Toggle */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className={`w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors duration-500 ${
              isSimulator
                ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                : "bg-green-500/20 text-green-400 border-green-500/30"
            }`}>
              {isSimulator ? <Cpu className="w-6 h-6 md:w-8 md:h-8" /> : <Radio className="w-6 h-6 md:w-8 md:h-8" />}
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">
                {isSimulator === null ? "Loading..." : isSimulator ? "Simulator Mode" : "Live Hardware Mode"}
              </h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                {isSimulator
                  ? "Running in software simulation — no ESP32 required. Orders are simulated locally."
                  : "Connected to the real ESP32 via USB/UART serial port."}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 p-1 bg-black/40 rounded-full border border-white/5 shadow-inner">
              <button
                onClick={() => handleModeToggle(false)}
                disabled={switchingMode || isSimulator === null || machineStatus !== "idle"}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                  isSimulator === false
                    ? "bg-green-500 text-white shadow-lg shadow-green-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Live
              </button>
              <button
                onClick={() => handleModeToggle(true)}
                disabled={switchingMode || isSimulator === null || machineStatus !== "idle"}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                  isSimulator === true
                    ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Simulator
              </button>
            </div>
            {switchingMode && (
              <span className="text-xs text-muted-foreground animate-pulse mt-1">Switching mode...</span>
            )}
            {machineStatus !== "idle" && (
              <span className="text-xs text-orange-400 mt-1">Machine busy — switch unavailable</span>
            )}
          </div>
        </div>

        {/* Documented ESP32 diagnostics. This is intentionally a fixed command list, not a serial terminal. */}
        <div className="p-5 md:p-8 rounded-3xl border border-amber-500/20 bg-card/40 backdrop-blur-md">
          <div className="flex gap-4 md:gap-6 items-center mb-5">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-amber-500/15 text-amber-300 border-2 border-amber-500/30 flex items-center justify-center">
              <Terminal className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1">ESP32 Diagnostics</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-xl">Runs only documented firmware commands. Replies and firmware logs appear below; ice movement and saved-position changes require confirmation.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["CHECK_IR", "Read IR sensors"],
              ["CHECK_LINE_STATE", "Read line state"],
              ["ICE_STATUS", "Read ice status"],
              ["ICE", "Test ice cycle"],
              ["ICE_SET_CLOSED", "Set ice CLOSED"],
              ["ICE_SET_OPEN", "Set ice OPEN"],
            ].map(([command, label]) => (
              <Button key={command} variant="outline" size="sm" disabled={debugCommand !== null}
                onClick={() => handleDebugCommand(command)} className="rounded-full">
                {debugCommand === command ? "Sending..." : label}
              </Button>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-black/40 bg-black/40 p-3 min-h-20 font-mono text-xs text-amber-100/80 whitespace-pre-wrap">
            {debugOutput.length ? debugOutput.join("\n") : "No diagnostic command run in this session."}
          </div>
        </div>

        {/* Liquid-level sensor query: the firmware deliberately returns raw electrical states. */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 mb-6">
            <div className="flex gap-4 md:gap-6 items-center">
              <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-cyan-500/20 text-cyan-300 border-2 border-cyan-500/30 flex items-center justify-center">
                <Activity className="w-6 h-6 md:w-8 md:h-8" />
              </div>
              <div>
                <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">Liquid-Level Sensors</h3>
                <p className="text-xs md:text-sm text-muted-foreground max-w-xl">
                  All six sensors share one fixed physical low-level line. Values are raw: 1 = HIGH and 0 = LOW.
                </p>
              </div>
            </div>
            <Button
              size="lg"
              onClick={handleCheckLevels}
              disabled={checkingLevels}
              className="w-full sm:w-auto rounded-full h-12 px-6 text-sm md:text-base bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${checkingLevels ? "animate-spin" : ""}`} />
              {checkingLevels ? "Checking..." : "Check Levels"}
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }, (_, index) => {
              const key = `ls${index + 1}`;
              const value = liquidLevels[key];
              const valueLabel = value === null ? "Not read" : value === 1 ? "HIGH (1)" : "LOW (0)";
              const valueClass = value === null
                ? "border-white/10 bg-black/20 text-muted-foreground"
                : value === 1
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                  : "border-orange-500/30 bg-orange-500/10 text-orange-200";
              return (
                <div key={key} className={`rounded-2xl border p-4 text-center ${valueClass}`}>
                  <p className="text-xs uppercase tracking-[0.18em] opacity-70">{key}</p>
                  <p className="mt-2 text-sm font-semibold">{valueLabel}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-muted-foreground">
            <span>When a bottle is above the fixed line, its shared raw value is:</span>
            <div className="flex gap-2">
              {[1, 0].map(value => (
                <Button
                  key={value}
                  size="sm"
                  variant={levelAboveValue === value ? "default" : "outline"}
                  disabled={savingLevelPolarity}
                  onClick={() => handleSetLevelPolarity(value as 0 | 1)}
                  className="rounded-full"
                >
                  {value === 1 ? "HIGH (1)" : "LOW (0)"}
                </Button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Fill a bottle above the fixed line, press Check Levels, then save the matching value once. Before ORDER, the Pi requires both this physical reading and enough tracked bottle volume for the recipe plus the 15 ml reserve configured by the backend.
          </p>
          {levelError && <p className="mt-3 text-sm text-red-400">{levelError}</p>}
        </div>

        {/* The Pi compares each recipe total with this admin-calibrated value before START. */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-violet-500/20 text-violet-300 border-2 border-violet-500/30 flex items-center justify-center">
              <GlassWater className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1">Small Glass Capacity</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-xl">
                Drinks above this liquid volume require the large-glass IR pattern. The Raspberry Pi checks this before it sends START.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-col sm:flex-row sm:items-end gap-3 max-w-md">
            <label className="flex-1 text-xs text-muted-foreground">
              Safe liquid capacity (ml)
              <Input
                className="mt-2"
                type="number"
                min="1"
                max="300"
                step="1"
                value={smallGlassCapacity}
                onChange={(event) => setSmallGlassCapacity(event.target.value)}
                disabled={savingGlassCapacity}
              />
            </label>
            <Button
              onClick={handleSaveGlassCapacity}
              disabled={savingGlassCapacity}
              className="rounded-full"
            >
              {savingGlassCapacity ? "Saving..." : "Save Capacity"}
            </Button>
          </div>
          {glassCapacityError && <p className="mt-3 text-sm text-red-400">{glassCapacityError}</p>}
        </div>

        {/* Maintenance / Cleaning */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-blue-500/20 text-blue-400 border-2 border-blue-500/30 flex items-center justify-center">
              <Droplet className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">System Purge & Clean</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                CLEAN closes the valve, runs pump 1 for 5 seconds, mixes, then opens the valve. It does not flush all six pumps.
              </p>
            </div>
          </div>
          <Button 
            size="lg" 
            onClick={handleClean} 
            disabled={cleaning || machineStatus !== "idle"}
            className={`w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg transition-all ${
              cleaning ? "bg-blue-600 animate-pulse text-white" : 
              machineStatus !== "idle" ? "bg-muted text-muted-foreground" :
              "bg-blue-500 hover:bg-blue-400 text-white"
            }`}
          >
            {cleaning ? "Cleaning..." : "Start Cleaning Cycle"}
          </Button>
        </div>

        {/* Firmware STOP limitation */}
        <div className="p-5 md:p-8 rounded-3xl border border-red-500/30 bg-red-500/5 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-red-500/20 text-red-500 border-2 border-red-500/30 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light text-red-200 mb-1 md:mb-2">Limited STOP Request</h3>
              <p className="text-xs md:text-sm text-red-400/80 max-w-md">
                Requests the mixer to finish its current leg and stops active ice movement. It does not halt pumps, valves, indexing, priming, or reversal.
              </p>
            </div>
          </div>
          <Button onClick={handleAbort} className="w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg font-bold uppercase tracking-widest bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 transition-all">
            Request STOP
          </Button>
        </div>

      </div>
    </div>
  );
}
