import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Lock, X } from "lucide-react";
import { verifyPin } from "@/lib/api";

interface PinPadProps {
  onSuccess: () => void;
  pinLength?: number;
}

// The PIN is checked by the backend, so a PIN changed in Settings takes effect.
export function PinPad({ onSuccess, pinLength = 4 }: PinPadProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (candidate: string) => {
    setChecking(true);
    try {
      await verifyPin(candidate);
      onSuccess();
    } catch (e: any) {
      const unreachable = e instanceof TypeError;
      setError(unreachable ? "Can’t reach the station. Try again." : "Incorrect PIN. Try again.");
      setTimeout(() => setPin(""), 500);
    } finally {
      setChecking(false);
    }
  };

  const handlePress = (num: string) => {
    if (checking || pin.length >= pinLength) return;
    const newPin = pin + num;
    setPin(newPin);
    setError(null);
    if (newPin.length === pinLength) void submit(newPin);
  };

  const handleBackspace = () => {
    if (checking) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    if (checking) return;
    setPin("");
    setError(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        handlePress(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Escape" || e.key === "Delete") {
        handleClear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, error, pinLength, checking]);

  return (
    <div className="admin-login">
      <div className="admin-login__intro">
        <div className="admin-login__lock">
          <Lock size={26} aria-hidden="true" />
        </div>
        <h2>Staff console</h2>
        <span>Enter your PIN to manage the station.</span>
      </div>

      <div
        className="admin-login__dots"
        aria-label={`${pin.length} of ${pinLength} PIN digits entered`}
      >
        {Array.from({ length: pinLength }).map((_, i) => (
          <div
            key={i}
            className={`admin-login__dot ${pin.length > i ? (error ? "is-error" : "is-filled") : ""}`}
          />
        ))}
      </div>

      <div className="admin-login__keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            variant="outline"
            className="admin-login__key"
            disabled={checking}
            onClick={() => handlePress(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          variant="outline"
          className="admin-login__key admin-login__key--muted"
          disabled={checking}
          onClick={handleClear}
        >
          Clear
        </Button>
        <Button
          variant="outline"
          className="admin-login__key"
          disabled={checking}
          onClick={() => handlePress("0")}
        >
          0
        </Button>
        <Button
          variant="outline"
          className="admin-login__key admin-login__key--muted"
          disabled={checking}
          onClick={handleBackspace}
          aria-label="Delete last digit"
        >
          <X className="w-6 h-6" />
        </Button>
      </div>

      <p className="admin-login__error" role="alert">
        {error}
      </p>

      <a href="/" className="admin-login__back">
        ← Back to the kiosk
      </a>
    </div>
  );
}
