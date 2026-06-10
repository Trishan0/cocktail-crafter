import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Lock, X } from "lucide-react";

interface PinPadProps {
  onSuccess: () => void;
  pinLength?: number;
  correctPin?: string;
}

export function PinPad({ onSuccess, pinLength = 4, correctPin = "1234" }: PinPadProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const handlePress = (num: string) => {
    if (pin.length < pinLength) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);
      
      if (newPin.length === pinLength) {
        if (newPin === correctPin) {
          setTimeout(() => onSuccess(), 300);
        } else {
          setError(true);
          setTimeout(() => setPin(""), 500);
        }
      }
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  };

  const handleClear = () => {
    setPin("");
    setError(false);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 glass-panel rounded-3xl max-w-sm w-full mx-auto border border-white/10 bg-black/40 backdrop-blur-md shadow-2xl">
      <div className="mb-6 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
          <Lock className="w-8 h-8 text-primary/80" />
        </div>
        <h2 className="text-2xl font-light text-white font-serif tracking-widest uppercase">Admin Access</h2>
        <p className="text-white/50 text-sm mt-2">Enter PIN to configure machine</p>
      </div>

      <div className="flex gap-4 mb-8">
        {Array.from({ length: pinLength }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border transition-all duration-300 ${
              pin.length > i
                ? error
                  ? "bg-red-500 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                  : "bg-primary border-primary shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                : "bg-transparent border-white/20"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 w-full">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            variant="outline"
            className="h-16 text-2xl font-light rounded-full border-white/10 bg-white/5 hover:bg-white/15 hover:text-white transition-all text-white/80"
            onClick={() => handlePress(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          variant="outline"
          className="h-16 text-lg font-light rounded-full border-white/10 bg-white/5 hover:bg-white/15 hover:text-white transition-all text-white/50 uppercase"
          onClick={handleClear}
        >
          Clear
        </Button>
        <Button
          variant="outline"
          className="h-16 text-2xl font-light rounded-full border-white/10 bg-white/5 hover:bg-white/15 hover:text-white transition-all text-white/80"
          onClick={() => handlePress("0")}
        >
          0
        </Button>
        <Button
          variant="outline"
          className="h-16 text-lg font-light rounded-full border-white/10 bg-white/5 hover:bg-white/15 hover:text-white transition-all text-white/50"
          onClick={handleBackspace}
        >
          <X className="w-6 h-6" />
        </Button>
      </div>
      
      {error && (
        <div className="absolute bottom-[-40px] text-red-400 text-sm animate-pulse font-medium">
          Incorrect PIN. Try again.
        </div>
      )}
    </div>
  );
}
