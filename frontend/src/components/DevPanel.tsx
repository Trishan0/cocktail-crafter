import { useState } from 'react';
import { simulateHardwareMessage } from '../lib/api';

// Local UI testing helper. Pair with `python dev_sim.py` in backend/ — the
// simulator lets these buttons jump the kiosk to any machine-driven screen.
export const DevPanel = () => {
  const [open, setOpen] = useState(false);

  // Only render in development mode
  if (import.meta.env.PROD) {
    return null;
  }

  const send = async (message: Record<string, unknown>) => {
    try {
      await simulateHardwareMessage(message);
    } catch (e) {
      console.error("Dev panel request failed:", e);
    }
  };

  const status = (machine_status: string, message = "", progress = 0) =>
    send({ type: 'STATUS', machine_status, message, progress });

  const glass = (glass_state: string, upper_sensor: number, lower_sensor: number) =>
    send({ type: 'SENSOR', glass_state, upper_sensor, lower_sensor });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-50 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs font-mono text-slate-200 border border-slate-700 hover:bg-slate-800"
      >
        Dev
      </button>
    );
  }

  const btn = "bg-slate-800 hover:bg-slate-700 px-2 py-1.5 rounded text-left";

  return (
    <div className="fixed bottom-3 right-3 p-3 w-56 bg-slate-900/95 text-white rounded-xl shadow-2xl z-50 border border-slate-700 text-xs font-mono">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-slate-300">Dev Tools (Simulator)</h3>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white px-1">✕</button>
      </div>

      <div className="text-slate-400 mb-1">Glass (IR sensors)</div>
      <div className="flex flex-col gap-1">
        <button onClick={() => glass('small_glass', 1, 0)} className={btn}>🥛 Place small glass</button>
        <button onClick={() => glass('large_glass', 0, 0)} className={btn}>🍺 Place large glass</button>
        <button onClick={() => glass('no_glass', 1, 1)} className={btn}>💨 Remove glass</button>
      </div>

      <div className="text-slate-400 mb-1 mt-3">Jump to machine screen</div>
      <div className="flex flex-col gap-1">
        <button onClick={() => status('waiting_glass', 'Waiting for a glass for this 150 ml drink.')} className={btn}>⏳ Waiting for glass</button>
        <button onClick={() => status('dispensing', 'Dispensing pump 2...', 45)} className={btn}>🔄 Preparing (45%)</button>
        <button onClick={() => status('done', 'Drink ready. Remove the glass to start cleaning.', 100)} className={btn}>🎉 Drink ready</button>
        <button onClick={() => status('washing', 'Cleaning started (pump 1, 5 seconds)...', 30)} className={btn}>🧽 Cleaning</button>
        <button onClick={() => status('error', 'Pump blocked')} className="bg-red-900/50 hover:bg-red-800 px-2 py-1.5 rounded text-left border border-red-800">⚠️ Error</button>
        <button onClick={() => status('idle', 'Ready')} className="bg-green-900/50 hover:bg-green-800 px-2 py-1.5 rounded text-left border border-green-800">✅ Reset to idle</button>
      </div>
    </div>
  );
};
