import { useState, useEffect } from "react";
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
  }, [pin, error, pinLength, correctPin]);

  return (
    <div className="admin-login">
      <div className="admin-login__intro">
        <div className="admin-login__lock">
          <Lock size={29} aria-hidden="true" />
        </div>
        <p>Staff access</p>
        <h2>Admin Console</h2>
        <span>Enter your PIN to configure the machine.</span>
      </div>

      <div className="admin-login__dots" aria-label={`${pin.length} of ${pinLength} PIN digits entered`}>
        {Array.from({ length: pinLength }).map((_, i) => (
          <div
            key={i}
            className={`admin-login__dot ${
              pin.length > i
                ? error
                  ? "is-error"
                  : "is-filled"
                : ""
            }`}
          />
        ))}
      </div>

      <div className="admin-login__keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            variant="outline"
            className="admin-login__key"
            onClick={() => handlePress(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          variant="outline"
          className="admin-login__key admin-login__key--muted"
          onClick={handleClear}
        >
          Clear
        </Button>
        <Button
          variant="outline"
          className="admin-login__key"
          onClick={() => handlePress("0")}
        >
          0
        </Button>
        <Button
          variant="outline"
          className="admin-login__key admin-login__key--muted"
          onClick={handleBackspace}
        >
          <X className="w-6 h-6" />
        </Button>
      </div>
      
      {error && (
        <div className="admin-login__error">
          Incorrect PIN. Try again.
        </div>
      )}
    </div>
  );
}
