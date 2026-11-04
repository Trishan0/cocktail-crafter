import { useState, useEffect } from "react";
import { Lock, Server, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { changePin, getPriceVisibility, getStatus, setPriceVisibility } from "@/lib/api";

type Notice = { tone: "ok" | "error"; text: string } | null;

export function SettingsManager() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinNotice, setPinNotice] = useState<Notice>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showDrinkPrices, setShowDrinkPrices] = useState(false);
  const [isUpdatingPriceVisibility, setIsUpdatingPriceVisibility] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  useEffect(() => {
    getStatus()
      .then((s) => setIsConnected(s.connected))
      .catch(() => setIsConnected(false));
    getPriceVisibility()
      .then((data) => setShowDrinkPrices(Boolean(data.show_prices)))
      .catch(() => setShowDrinkPrices(false));
  }, []);

  const handlePinChange = async () => {
    setIsChangingPin(true);
    setPinNotice(null);
    try {
      await changePin(currentPin, newPin);
      setPinNotice({ tone: "ok", text: "PIN updated. Use the new PIN next time you sign in." });
      setCurrentPin("");
      setNewPin("");
    } catch (e: any) {
      setPinNotice({ tone: "error", text: e.message || "Could not change the PIN." });
    } finally {
      setIsChangingPin(false);
    }
  };

  const handlePriceVisibilityChange = async (showPrices: boolean) => {
    setIsUpdatingPriceVisibility(true);
    setPriceError(null);
    try {
      const data = await setPriceVisibility(showPrices);
      setShowDrinkPrices(Boolean(data.show_prices));
    } catch (e: any) {
      setPriceError(e.message || "Could not update price visibility.");
    } finally {
      setIsUpdatingPriceVisibility(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <p className="mb-8 text-sm md:text-base text-muted-foreground">
        Security and what guests see on the kiosk.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 max-w-5xl">
        {/* Security / PIN */}
        <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
          <div className="flex items-center gap-3 md:gap-4 mb-6 border-b border-white/10 pb-4 md:pb-6">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-accent/15 text-accent flex items-center justify-center">
              <Lock className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <h3 className="text-xl md:text-2xl font-display">Staff PIN</h3>
          </div>

          <div className="space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="current-pin" className="text-muted-foreground text-sm font-medium">
                Current PIN
              </Label>
              <Input
                id="current-pin"
                type="password"
                inputMode="numeric"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                placeholder="••••"
                className="h-12 text-xl tracking-widest"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-pin" className="text-muted-foreground text-sm font-medium">
                New PIN
              </Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="4 digits"
                maxLength={4}
                className="h-12 text-xl tracking-widest"
              />
            </div>
            <Button
              onClick={handlePinChange}
              disabled={isChangingPin || !currentPin || newPin.length !== 4}
              className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 h-12"
            >
              {isChangingPin ? "Updating…" : "Update PIN"}
            </Button>
            {pinNotice && (
              <p
                role="status"
                className={`text-sm ${pinNotice.tone === "ok" ? "text-green-400" : "text-red-400"}`}
              >
                {pinNotice.text}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:gap-8 content-start">
          {/* Controller connection */}
          <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
            <div className="flex items-center gap-3 md:gap-4 mb-5">
              <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                <Server className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <h3 className="text-xl md:text-2xl font-display">Controller</h3>
            </div>
            <div
              className={`flex items-center justify-between p-4 rounded-xl border ${isConnected ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}
            >
              <span
                className={`font-medium text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}
              >
                {isConnected ? "Connected to the ESP32" : "Not connected to the ESP32"}
              </span>
              <span
                className={`flex w-3 h-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
              />
            </div>
          </div>

          {/* Kiosk display */}
          <div className="p-5 md:p-8 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md">
            <div className="flex items-center gap-3 md:gap-4 mb-5">
              <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                <MonitorSmartphone className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <h3 className="text-xl md:text-2xl font-display">Kiosk display</h3>
            </div>
            <div className="flex items-center justify-between gap-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <Label htmlFor="show-drink-prices" className="text-sm font-medium">
                  Show drink prices to guests
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hidden by default. Prices stay editable in Drinks either way.
                </p>
              </div>
              <Switch
                id="show-drink-prices"
                checked={showDrinkPrices}
                disabled={isUpdatingPriceVisibility}
                onCheckedChange={handlePriceVisibilityChange}
                aria-label="Show drink prices to guests"
              />
            </div>
            {priceError && <p className="mt-3 text-sm text-red-400">{priceError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
