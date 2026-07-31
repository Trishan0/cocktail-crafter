import { useState, useEffect } from "react";
import { Lock, Server, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePin, getStatus } from "@/lib/api";

export function SettingsManager() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    getStatus().then(s => setIsConnected(s.connected)).catch(() => setIsConnected(false));
  }, []);

  const handlePinChange = async () => {
    try {
      await changePin(currentPin, newPin);
      alert("PIN changed successfully!");
      setCurrentPin(""); setNewPin("");
    } catch (e: any) {
      alert(e.message);
    }
  };
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 md:mb-10 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-light mb-1 md:mb-2">System Settings</h2>
          <p className="text-sm md:text-base text-muted-foreground">Configure connectivity, security, and display preferences</p>
        </div>
        <Button size="lg" className="w-full md:w-auto rounded-full px-8 h-12 md:h-14 text-base md:text-lg bg-primary text-primary-foreground">
          Save All Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 max-w-5xl">
        {/* Security / PIN */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8 border-b border-white/10 pb-4 md:pb-6">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-white/5 flex items-center justify-center">
              <Lock className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <h3 className="text-xl md:text-2xl font-display font-light">Security</h3>
          </div>

          <div className="space-y-6">
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Current Admin PIN</Label>
              <Input type="password" value={currentPin} onChange={e=>setCurrentPin(e.target.value)} placeholder="****" className="h-12 bg-white/5 border-white/10 font-mono text-xl tracking-widest" />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">New Admin PIN</Label>
              <Input type="password" value={newPin} onChange={e=>setNewPin(e.target.value)} placeholder="4 digits" maxLength={4} className="h-12 bg-white/5 border-white/10 font-mono text-xl tracking-widest" />
            </div>
            <Button onClick={handlePinChange} className="w-full rounded-full bg-primary text-primary-foreground h-12">Update PIN</Button>
          </div>
        </div>

        {/* Connectivity */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8 border-b border-white/10 pb-4 md:pb-6">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-white/5 flex items-center justify-center">
              <Server className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <h3 className="text-xl md:text-2xl font-display font-light">Connectivity</h3>
          </div>

          <div className="space-y-6">
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Serial Port (USB/UART)</Label>
              <Input disabled value="/dev/ttyACM0 (115200 baud)" className="h-12 bg-white/5 border-white/10 font-mono text-muted-foreground" />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">API Backend</Label>
              <Input disabled value="http://localhost:5000/api" className="h-12 bg-white/5 border-white/10 font-mono text-muted-foreground" />
            </div>
            <div className={`flex items-center justify-between p-4 rounded-xl border ${isConnected ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <span className={`font-medium text-sm ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                Hardware Status: {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              <span className={`flex w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            </div>
          </div>
        </div>

        {/* Display */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md lg:col-span-2">
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8 border-b border-white/10 pb-4 md:pb-6">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-white/5 flex items-center justify-center">
              <MonitorSmartphone className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <h3 className="text-xl md:text-2xl font-display font-light">Display & Interface</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div className="space-y-6">
              <div className="grid gap-2">
                <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Screensaver Timeout (Seconds)</Label>
                <Input type="number" defaultValue="120" className="h-12 bg-white/5 border-white/10" />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Display Brightness (%)</Label>
                <Input type="number" defaultValue="85" max="100" min="10" className="h-12 bg-white/5 border-white/10" />
              </div>
            </div>
            <div className="space-y-6">
              <div className="grid gap-2">
                <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Default Language</Label>
                <select className="h-12 bg-white/5 border border-white/10 rounded-md px-3 text-white focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="en" className="bg-background">English (EN)</option>
                  <option value="fr" className="bg-background">French (FR)</option>
                  <option value="jp" className="bg-background">Japanese (JP)</option>
                </select>
              </div>
              <Button variant="outline" className="w-full h-12 rounded-xl bg-white/5 border-white/10 mt-6">
                Preview Screensaver
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
