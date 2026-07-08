import { useState, useEffect } from "react";
import { Activity, ShieldAlert, Droplet, Cpu, Radio, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cleanSystem, abortOrder, getPowerState, setPowerState } from "@/lib/api";

interface HardwareManagerProps {
  machineStatus: string;
}

export function HardwareManager({ machineStatus }: HardwareManagerProps) {
  const [cleaning, setCleaning] = useState(false);
  const [isSimulator, setIsSimulator] = useState<boolean | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [poweredOn, setPoweredOn] = useState<boolean | null>(null);
  const [switchingPower, setSwitchingPower] = useState(false);

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
      alert("Emergency Stop Triggered");
    } catch (e: any) {
      alert("Abort failed: " + e.message);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                Customer ordering is enabled only while powered on. The first order after power-on gets each pump's configured extra prime time.
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

        {/* Maintenance / Cleaning */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-blue-500/20 text-blue-400 border-2 border-blue-500/30 flex items-center justify-center">
              <Droplet className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">System Purge & Clean</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                Run a cleaning cycle to flush all 6 pumps. Ensure warm water or sanitizer is connected to all inputs.
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

        {/* Emergency Stop */}
        <div className="p-5 md:p-8 rounded-3xl border border-red-500/30 bg-red-500/5 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className="w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full bg-red-500/20 text-red-500 border-2 border-red-500/30 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light text-red-200 mb-1 md:mb-2">Emergency Stop</h3>
              <p className="text-xs md:text-sm text-red-400/80 max-w-md">
                Immediately halt all pump activity and disable the machine. Requires PIN to unlock.
              </p>
            </div>
          </div>
          <Button onClick={handleAbort} className="w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg font-bold uppercase tracking-widest bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 transition-all">
            Halt Machine
          </Button>
        </div>

      </div>
    </div>
  );
}


