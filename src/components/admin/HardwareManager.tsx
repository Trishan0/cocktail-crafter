import { useState } from "react";
import { Activity, Power, ShieldAlert, Droplet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cleanSystem, abortOrder } from "@/lib/api";

export function HardwareManager() {
  const [glassDetection, setGlassDetection] = useState(true);
  const [cleaning, setCleaning] = useState(false);

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
        {/* Glass Detection Sensor */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex gap-4 md:gap-6 items-center">
            <div className={`w-14 h-14 md:w-16 md:h-16 shrink-0 rounded-full flex items-center justify-center border-2 ${
              glassDetection ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-white/5 text-muted-foreground border-white/10"
            }`}>
              <Activity className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-1 md:mb-2">Glass Detection Sensor</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md">
                Ensure a glass is present under the nozzle before dispensing liquid to prevent spills.
              </p>
            </div>
          </div>
          <div className="flex sm:flex-col w-full sm:w-auto items-center justify-between sm:justify-center gap-3">
            <Switch 
              checked={glassDetection} 
              onCheckedChange={setGlassDetection}
              className="data-[state=checked]:bg-green-500"
            />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {glassDetection ? "Active" : "Disabled"}
            </span>
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
            disabled={cleaning}
            className={`w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg transition-all ${
              cleaning ? "bg-blue-600 animate-pulse text-white" : "bg-blue-500 hover:bg-blue-400 text-white"
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
          <Button variant="destructive" size="lg" onClick={handleAbort} className="w-full sm:w-auto rounded-full h-12 md:h-14 px-6 md:px-8 text-sm md:text-lg font-bold uppercase tracking-widest">
            Halt Machine
          </Button>
        </div>

      </div>
    </div>
  );
}
