import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import robotHero from "@/assets/robot-hero.jpg";
import readyHero from "@/assets/cocktail-ready.jpg";
import { getMenu, placeOrder, placeCustomOrder, getPumps } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: KioskApp,
});

type ScreenKey =
  | "welcome" | "experience" | "catalog" | "detail"
  | "compose" | "review" | "waiting_glass" | "preparing" | "ready" | "error";

function useKioskScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const recompute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(w / 1024, h / 600, 1.5);
      setScale(s);
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);
  return scale;
}

function KioskApp() {
  const [screen, setScreen] = useState<ScreenKey>("welcome");
  const [drinks, setDrinks] = useState<any[]>([]);
  const [availablePumps, setAvailablePumps] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"signature" | "custom">("signature");
  const [customIngredients, setCustomIngredients] = useState<any[]>([]);
  const [now, setNow] = useState(new Date());

  // SSE State
  const [machineStatus, setMachineStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [glassPresent, setGlassPresent] = useState(true);

  // Load menu and available ingredients
  useEffect(() => {
    getMenu().then(data => setDrinks(data.drinks)).catch(console.error);
    getPumps().then(data => {
      const active = data.pumps.filter((p: any) => p.ingredient_id !== null);
      setAvailablePumps(active);
      // Initialize custom with first available ingredient
      if (active.length > 0) {
        setCustomIngredients([{ ingredient_id: active[0].ingredient_id, name: active[0].ingredient_name, amount_ml: 50 }]);
      }
    }).catch(console.error);
  }, [screen]); // Reload menu when returning to start

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // SSE Connection
  useEffect(() => {
    const evtSource = new EventSource(`http://${window.location.hostname}:5000/stream`);
    
    evtSource.addEventListener("init", (e) => {
      const data = JSON.parse(e.data);
      setMachineStatus(data.machine_status);
      setGlassPresent(data.glass_present);
    });

    evtSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setMachineStatus(data.machine_status);
      setProgress(data.progress || 0);
      setMessage(data.message || "");

      // Auto-transition screens based on machine status
      setScreen(prev => {
        if (data.machine_status === "waiting_glass") return "waiting_glass";
        if (["dispensing", "mixing", "pouring"].includes(data.machine_status)) return "preparing";
        if (data.machine_status === "done") return "ready";
        if (data.machine_status === "error") return "error";
        if (data.machine_status === "idle" && prev !== "welcome") {
          if (["ready", "error", "preparing", "waiting_glass"].includes(prev)) {
             return "welcome";
          }
        }
        return prev;
      });
    });

    evtSource.addEventListener("sensor", (e) => {
      const data = JSON.parse(e.data);
      setGlassPresent(data.glass_present);
    });

    return () => evtSource.close();
  }, []);

  const selected = useMemo(
    () => drinks.find(d => d.id === selectedId) || drinks[0],
    [selectedId, drinks]
  );

  const scale = useKioskScale();
  const go = (s: ScreenKey) => setScreen(s);

  const handleOrder = async () => {
    try {
      if (mode === "signature") {
        if (!selected) return;
        await placeOrder(selected.id);
      } else {
        if (customIngredients.length === 0) return;
        const payload = customIngredients.map(i => ({ id: i.ingredient_id, name: i.name, amount_ml: i.amount_ml }));
        await placeCustomOrder(payload);
      }
      // Screen will change via SSE when status becomes waiting_glass or dispensing
    } catch (e: any) {
      alert("Failed to order: " + e.message);
    }
  };

  const ctx = {
    selected, setSelectedId, mode, setMode, drinks, availablePumps,
    customIngredients, setCustomIngredients,
    machineStatus, progress, message, glassPresent,
    now, go, handleOrder
  };

  return (
    <main className="min-h-screen bg-page text-page-foreground flex items-center justify-center overflow-hidden touch-none select-none">
      <div className="pointer-events-none fixed inset-0 opacity-60"
        style={{ background: "radial-gradient(60% 50% at 50% 40%, oklch(0.83 0.09 85 / 8%), transparent 70%)" }} />

      <div
        className="kiosk-frame transition-transform w-[1024px] h-[600px] relative"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {screen === "welcome" && <Welcome {...ctx} />}
        {screen === "experience" && <Experience {...ctx} />}
        {screen === "catalog" && <Catalog {...ctx} />}
        {screen === "detail" && <Detail {...ctx} />}
        {screen === "compose" && <Compose {...ctx} />}
        {screen === "review" && <Review {...ctx} />}
        {screen === "waiting_glass" && <WaitingGlass {...ctx} />}
        {screen === "preparing" && <Preparing {...ctx} />}
        {screen === "ready" && <Ready {...ctx} />}
        {screen === "error" && <ErrorScreen {...ctx} />}
      </div>
    </main>
  );
}

/* ============================================================
   Shared atoms
   ============================================================ */

function StatusBar({ title, now }: { title: string; now: Date }) {
  return (
    <div className="absolute top-0 inset-x-0 h-14 px-8 flex items-center justify-between text-sm uppercase tracking-[0.2em] text-muted-foreground/90 font-medium z-20 bg-gradient-to-b from-background/80 to-transparent">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_12px_currentColor]" />
        <span>ATRIA Bartender · {title}</span>
      </div>
      <div className="flex items-center gap-6">
        <span>Station 01</span>
        <span>Online</span>
        <span className="font-bold text-foreground">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 text-2xl">
      <span className="brushed-gold w-8 h-8 rounded-full shadow-md" />
      <span className="font-display tracking-[0.35em] uppercase font-light drop-shadow-md text-foreground">ATRIA</span>
    </div>
  );
}

function GoldButton({ children, onClick, big = false, variant = "primary", disabled }: any) {
  const base = "inline-flex items-center justify-center gap-3 font-bold uppercase tracking-[0.2em] transition-all active:scale-[0.95] select-none shadow-xl";
  const size = big ? "px-24 h-32 text-4xl rounded-[3rem]" : "px-10 h-16 text-lg rounded-[2rem]";
  if (variant === "ghost") {
    return (
      <button onClick={onClick} disabled={disabled} className={`${base} ${size} border-2 border-border-strong text-foreground/90 hover:bg-foreground/5`}>
        {children}
      </button>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${size} brushed-gold text-accent-foreground shadow-[0_8px_30px_-8px_oklch(0.83_0.09_85/40%)] hover:shadow-[0_10px_40px_-8px_oklch(0.83_0.09_85/60%)] disabled:opacity-40`}>
      {children}
    </button>
  );
}

function BackChip({ onClick, label = "Back" }: any) {
  return (
    <button onClick={onClick} className="absolute top-10 right-8 z-30 text-lg uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground flex items-center gap-3 px-8 h-16 rounded-full border-2 border-border/60 hover:border-border-strong bg-background/50 backdrop-blur-md active:scale-[0.95] transition-all">
      ← {label}
    </button>
  );
}

/* ============================================================
   Screens
   ============================================================ */

function Welcome({ now, go }: any) {
  return (
    <div className="absolute inset-0">
      <StatusBar title="Welcome" now={now} />
      <img src={robotHero} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/40" />
      <div className="absolute top-10 left-8"><Logo /></div>
      <button onClick={() => go("experience")} className="absolute inset-0 w-full h-full cursor-pointer text-left focus:outline-none">
        <div className="relative h-full flex flex-col items-center justify-center z-10">
          <h1 className="font-display text-[80px] leading-[1] font-light tracking-tight text-center drop-shadow-2xl">
            Good <em className="italic font-normal">evening.</em>
          </h1>
          <div className="mt-16 animate-pulse hover:animate-none">
            <GoldButton big>Touch anywhere to order</GoldButton>
          </div>
        </div>
      </button>
    </div>
  );
}

function Experience({ now, go, setMode }: any) {
  const choose = (m: string) => { setMode(m); go(m === "signature" ? "catalog" : "compose"); };
  return (
    <div className="absolute inset-0">
      <StatusBar title="Choose Experience" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("welcome")} label="Home" />
      <div className="h-full pt-28 pb-12 px-16 flex flex-col">
        <h2 className="font-display text-5xl font-light text-center mb-12 drop-shadow-md">What are we pouring?</h2>
        <div className="flex-1 grid grid-cols-2 gap-10">
          <button onClick={() => choose("signature")} className="relative rounded-[3rem] overflow-hidden group hover:ring-4 hover:ring-accent/80 transition-all active:scale-[0.98] shadow-2xl">
            <div className="absolute inset-0 bg-surface-2 flex items-center justify-center font-display text-[56px]">House Classics</div>
          </button>
          <button onClick={() => choose("custom")} className="relative rounded-[3rem] overflow-hidden group hover:ring-4 hover:ring-accent/80 transition-all active:scale-[0.98] shadow-2xl">
             <div className="absolute inset-0 bg-surface-2 flex items-center justify-center font-display text-[56px]">Custom Creation</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function Catalog({ now, go, setSelectedId, drinks }: any) {
  return (
    <div className="absolute inset-0">
      <StatusBar title="Menu" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("welcome")} label="Home" />

      <div className="h-full pt-28 pb-10 px-12 flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-4 pb-12 custom-scrollbar">
          <div className="grid grid-cols-2 gap-8">
            {drinks.map((d: any) => (
              <button key={d.id} onClick={() => { setSelectedId(d.id); go("detail"); }}
                className={`surface-card relative text-left rounded-[2rem] overflow-hidden flex flex-col h-[380px] hover:ring-4 hover:ring-accent/80 transition active:scale-[0.98] group shadow-xl ${!d.available && 'opacity-50 grayscale'}`}
                disabled={!d.available}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-surface-2/20" />
                <div className="absolute top-6 right-6 text-4xl">{d.available ? '🍸' : '❌'}</div>
                <div className="absolute bottom-0 inset-x-0 p-8 flex justify-between items-end">
                  <div>
                    <h4 className="font-display text-[44px] leading-none mb-2 text-foreground">{d.name}</h4>
                    <div className="text-2xl text-accent font-light">€{d.price.toFixed(2)}</div>
                    {!d.available && <div className="text-red-400 mt-2 text-sm uppercase tracking-widest">Ingredients Unavailable</div>}
                  </div>
                  <div className="brushed-gold w-16 h-16 rounded-full flex items-center justify-center text-accent-foreground text-2xl shadow-lg">→</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ selected, now, go }: any) {
  if (!selected) return null;
  return (
    <div className="absolute inset-0">
      <StatusBar title={selected.name} now={now} />
      <div className="absolute top-10 left-8 z-30"><Logo /></div>
      <BackChip onClick={() => go("catalog")} />

      <div className="h-full flex">
        <div className="w-[45%] relative bg-surface-2 flex items-center justify-center text-6xl">
           🍸
        </div>
        <div className="w-[55%] px-10 pb-12 pt-24 flex flex-col justify-center bg-background relative z-10">
          <h2 className="font-display text-[64px] font-light leading-none mb-2">{selected.name}</h2>
          <p className="text-xl text-muted-foreground mb-6">{selected.description}</p>
          <div className="font-display text-5xl text-accent mb-8">
            €{Math.floor(selected.price)}
            <span className="text-3xl">.{(selected.price % 1).toFixed(2).slice(2)}</span>
          </div>

          <div className="flex flex-wrap gap-2 mb-12">
            {selected.ingredients.map((i: any) =>
              <span key={i.id} className="px-5 py-2 rounded-2xl bg-surface-2 text-lg font-medium border border-border-strong text-foreground whitespace-nowrap">{i.name} {i.amount_ml}ml</span>
            )}
          </div>
          <div>
            <GoldButton big onClick={() => go("review")}>ORDER NOW</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Compose({ now, go, availablePumps, customIngredients, setCustomIngredients }: any) {
  const totalMl = customIngredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0);
  const MAX_TOTAL = 300;
  const MAX_PER_ING = 100;

  const updateAmount = (idx: number, amount: number) => {
    if (amount < 0) amount = 0;
    if (amount > MAX_PER_ING) amount = MAX_PER_ING;
    
    const newIngs = [...customIngredients];
    newIngs[idx].amount_ml = amount;
    setCustomIngredients(newIngs);
  };

  const addIngredient = (pump: any) => {
    if (customIngredients.length >= 6) return;
    if (customIngredients.find((i: any) => i.ingredient_id === pump.ingredient_id)) return;
    setCustomIngredients([...customIngredients, { ingredient_id: pump.ingredient_id, name: pump.ingredient_name, amount_ml: 25 }]);
  };

  const removeIngredient = (idx: number) => {
    setCustomIngredients(customIngredients.filter((_: any, i: number) => i !== idx));
  };

  const isOverLimit = totalMl > MAX_TOTAL;
  const isZero = totalMl === 0;

  return (
    <div className="absolute inset-0">
      <StatusBar title="Custom Creation" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("experience")} />

      <div className="h-full pt-28 pb-10 px-12 grid grid-cols-[1fr_400px] gap-12">
        <div className="flex flex-col gap-8 overflow-y-auto pr-4 pb-8 custom-scrollbar">
          
          <div>
            <div className="text-xl uppercase tracking-[0.2em] text-muted-foreground mb-4 flex justify-between">
              <span>Your Recipe</span>
              <span className={isOverLimit ? "text-red-400" : ""}>{totalMl} / {MAX_TOTAL} ml</span>
            </div>
            
            <div className="flex flex-col gap-4">
              {customIngredients.map((ing: any, idx: number) => (
                <div key={ing.ingredient_id} className="surface-card rounded-2xl p-4 flex items-center justify-between">
                  <div className="font-display text-2xl">{ing.name}</div>
                  <div className="flex items-center gap-4">
                    <button onClick={() => updateAmount(idx, ing.amount_ml - 5)} className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-2xl flex items-center justify-center">-</button>
                    <div className="text-xl w-16 text-center tabular-nums">{ing.amount_ml}ml</div>
                    <button onClick={() => updateAmount(idx, ing.amount_ml + 5)} className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-2xl flex items-center justify-center">+</button>
                    <button onClick={() => removeIngredient(idx)} className="w-12 h-12 ml-2 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xl flex items-center justify-center">×</button>
                  </div>
                </div>
              ))}
              {customIngredients.length === 0 && (
                <div className="text-center p-8 border border-dashed border-white/20 rounded-2xl text-muted-foreground">
                  Select ingredients to begin composing your drink.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-xl uppercase tracking-[0.2em] text-muted-foreground mb-4">Available Ingredients</div>
            <div className="flex flex-wrap gap-3">
              {availablePumps.map((p: any) => {
                const isSelected = customIngredients.some((i: any) => i.ingredient_id === p.ingredient_id);
                return (
                  <button key={p.ingredient_id} onClick={() => addIngredient(p)} disabled={isSelected}
                    className={`py-3 px-6 rounded-2xl text-lg font-medium transition-all ${isSelected ? "bg-primary/20 text-primary border border-primary/30 opacity-50" : "bg-surface border-2 border-border-strong text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
                    {p.ingredient_name}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        <div className="relative rounded-[3rem] overflow-hidden flex flex-col justify-end shadow-2xl bg-surface-2 p-8">
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div>
              <div className="text-[120px] text-center mb-4">🧪</div>
              <div className="font-display text-5xl mb-2 text-foreground text-center">Custom Mix</div>
            </div>

            <div className="flex flex-col gap-4">
              {isOverLimit && <div className="text-red-400 text-center uppercase tracking-widest text-sm font-bold">Total exceeds {MAX_TOTAL}ml limit</div>}
              {isZero && <div className="text-red-400 text-center uppercase tracking-widest text-sm font-bold">Please add ingredients</div>}
              <GoldButton big onClick={() => go("review")} disabled={isOverLimit || isZero}>REVIEW</GoldButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Review({ selected, mode, customIngredients, now, go, handleOrder }: any) {
  const isCustom = mode === "custom";
  const title = isCustom ? "Custom Mix" : selected?.name;
  
  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-background">
      <StatusBar title="Confirm Order" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go(isCustom ? "compose" : "detail")} label="Edit" />

      <div className="w-full max-w-[850px] flex gap-12 items-center">
        <div className="w-[380px] h-[380px] rounded-[3rem] overflow-hidden relative shrink-0 shadow-2xl bg-surface-2 flex items-center justify-center text-[150px]">
          {isCustom ? "🧪" : "🍸"}
        </div>

        <div className="flex-1 flex flex-col">
          <h2 className="font-display text-[56px] font-light leading-none mb-8">{title}</h2>

          <div className="flex flex-col gap-3 mb-8 max-h-[200px] overflow-y-auto pr-4 custom-scrollbar">
            {isCustom ? (
              customIngredients.map((ing: any) => (
                <div key={ing.ingredient_id} className="flex justify-between items-center text-2xl border-b border-border/40 pb-4">
                  <span className="text-muted-foreground uppercase tracking-widest text-lg">{ing.name}</span>
                  <span className="font-medium">{ing.amount_ml} ml</span>
                </div>
              ))
            ) : (
              selected?.ingredients.map((ing: any) => (
                <div key={ing.id} className="flex justify-between items-center text-2xl border-b border-border/40 pb-4">
                  <span className="text-muted-foreground uppercase tracking-widest text-lg">{ing.name}</span>
                  <span className="font-medium">{ing.amount_ml} ml</span>
                </div>
              ))
            )}
          </div>

          {!isCustom && (
            <div className="flex items-center justify-between mb-8">
              <span className="text-2xl uppercase tracking-[0.2em] text-muted-foreground">Total</span>
              <span className="font-display text-[56px] text-accent">€{selected?.price.toFixed(2)}</span>
            </div>
          )}

          <GoldButton big onClick={handleOrder}>CONFIRM ORDER</GoldButton>
        </div>
      </div>
    </div>
  );
}

function WaitingGlass({ now, glassPresent }: any) {
  return (
    <div className="absolute inset-0 bg-background flex flex-col items-center justify-center">
      <StatusBar title="Waiting for Glass" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      
      <div className={`w-48 h-48 rounded-full flex items-center justify-center mb-12 transition-all duration-500 border-4 ${glassPresent ? 'border-green-500 bg-green-500/20 text-green-400' : 'border-accent bg-accent/10 text-accent animate-pulse'}`}>
        <span className="text-6xl">🥃</span>
      </div>

      <h2 className="font-display text-[56px] font-light text-center">
        {glassPresent ? "Glass Detected" : "Please place a glass"}
      </h2>
      <p className="text-2xl text-muted-foreground mt-4 uppercase tracking-[0.2em]">
        {glassPresent ? "Starting order..." : "under the dispenser nozzle"}
      </p>
    </div>
  );
}

function Preparing({ selected, mode, progress, machineStatus, message, now }: any) {
  let title = "Preparing";
  if (machineStatus === "mixing") title = "Mixing your drink";
  if (machineStatus === "pouring") title = "Pouring into glass";
  
  const drinkName = mode === "signature" ? selected?.name : "Custom Mix";

  return (
    <div className="absolute inset-0 bg-background flex flex-col items-center justify-center">
      <StatusBar title={title} now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>

      <div className="relative flex flex-col items-center justify-center">
        <div className="relative">
          <svg width="400" height="400" viewBox="0 0 400 400" className="-rotate-90 drop-shadow-2xl">
            <circle cx="200" cy="200" r={180} stroke="oklch(1 0 0 / 10%)" strokeWidth="6" fill="none" />
            <circle cx="200" cy="200" r={180} stroke="url(#gold)" strokeWidth="12" fill="none" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 180} strokeDashoffset={(2 * Math.PI * 180) * (1 - (progress / 100))} style={{ transition: "stroke-dashoffset 300ms linear" }} />
            <defs>
              <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="oklch(0.78 0.08 85)" />
                <stop offset="100%" stopColor="oklch(0.92 0.09 88)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-[100px] font-light leading-none tabular-nums text-foreground">
              {progress}%
            </div>
          </div>
        </div>

        <h2 className="font-display text-[56px] mt-16 font-light">{drinkName}</h2>
        <div className="text-2xl uppercase tracking-[0.3em] text-muted-foreground mt-4 animate-pulse">{message || title}</div>
      </div>
    </div>
  );
}

function Ready({ now, go }: any) {
  return (
    <div className="absolute inset-0">
      <StatusBar title="Ready" now={now} />
      <img src={readyHero} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/30" />
      <div className="absolute top-10 left-8 z-20"><Logo /></div>

      <div className="relative h-full flex flex-col justify-end pb-12 px-16 max-w-[80%] z-10">
        <div className="text-xl uppercase tracking-[0.4em] text-accent mb-2">Order Complete</div>
        <h1 className="font-display text-[72px] leading-[1] font-light tracking-tight mb-8 drop-shadow-lg">
          Your drink is <em className="italic font-normal gold-text">ready.</em>
        </h1>
        <div><GoldButton big onClick={() => go("welcome")}>FINISH</GoldButton></div>
      </div>
    </div>
  );
}

function ErrorScreen({ now, go, message }: any) {
  return (
    <div className="absolute inset-0 bg-red-950/20 flex flex-col items-center justify-center">
      <StatusBar title="Error" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      
      <div className="text-[120px] mb-8">⚠️</div>
      <h2 className="font-display text-[56px] font-light text-red-400 mb-4">Something went wrong</h2>
      <p className="text-2xl text-muted-foreground max-w-2xl text-center mb-16">{message || "The machine encountered an error while processing your order."}</p>
      
      <GoldButton big onClick={() => go("welcome")}>RETURN HOME</GoldButton>
    </div>
  );
}
