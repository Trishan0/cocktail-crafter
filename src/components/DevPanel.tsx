import React from 'react';
import { simulateHardwareMessage } from '../lib/api';

export const DevPanel = () => {
  // Only render in development mode
  if (import.meta.env.PROD) {
    return null;
  }

  const triggerStatus = async (status: string, message: string = "", progress: number = 0) => {
    try {
      await simulateHardwareMessage({
        type: 'STATUS',
        machine_status: status,
        message,
        progress
      });
    } catch (e) {
      console.error("Failed to trigger status:", e);
    }
  };

  const triggerSensor = async (glass_state: string) => {
    try {
      await simulateHardwareMessage({
        type: 'SENSOR',
        glass_state
      });
    } catch (e) {
      console.error("Failed to trigger sensor:", e);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-slate-900 text-white rounded-xl shadow-2xl opacity-60 hover:opacity-100 transition-opacity z-50 border border-slate-700">
      <h3 className="font-bold text-sm mb-3 text-slate-300">Dev Tools (Simulate Hardware)</h3>
      <div className="flex flex-col gap-2 text-xs font-mono">
        {/* Sensor events */}
        <div className="text-slate-400 mb-1 mt-2">Sensors</div>
        <button 
          onClick={() => triggerSensor('SMALL_GLASS')} 
          className="bg-slate-800 hover:bg-slate-700 p-2 rounded text-left"
        >
          🥛 Place Small Glass
        </button>
        <button 
          onClick={() => triggerSensor('LARGE_GLASS')} 
          className="bg-slate-800 hover:bg-slate-700 p-2 rounded text-left"
        >
          🍺 Place Large Glass
        </button>
        <button 
          onClick={() => triggerSensor('no_glass')} 
          className="bg-slate-800 hover:bg-slate-700 p-2 rounded text-left"
        >
          💨 Remove Glass
        </button>

        {/* Status events */}
        <div className="text-slate-400 mb-1 mt-2">Status</div>
        <button 
          onClick={() => triggerStatus('idle', 'Ready')} 
          className="bg-green-900/50 hover:bg-green-800 p-2 rounded text-left border border-green-800"
        >
          ✅ Set Idle
        </button>
        <button 
          onClick={() => triggerStatus('dispensing', 'Dispensing drink...', 50)} 
          className="bg-blue-900/50 hover:bg-blue-800 p-2 rounded text-left border border-blue-800"
        >
          🔄 Set Dispensing (50%)
        </button>
        <button 
          onClick={() => triggerStatus('done', 'Drink Ready', 100)} 
          className="bg-emerald-900/50 hover:bg-emerald-800 p-2 rounded text-left border border-emerald-800"
        >
          🎉 Set Done
        </button>
        <button 
          onClick={() => triggerStatus('error', 'Pump blocked')} 
          className="bg-red-900/50 hover:bg-red-800 p-2 rounded text-left border border-red-800"
        >
          ⚠️ Trigger Error
        </button>
      </div>
    </div>
  );
};
