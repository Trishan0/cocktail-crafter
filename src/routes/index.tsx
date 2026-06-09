import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import robotHero from "@/assets/robot-hero.jpg";
import readyHero from "@/assets/cocktail-ready.jpg";
import c1 from "@/assets/cocktail-1.jpg";
import c2 from "@/assets/cocktail-2.jpg";
import c3 from "@/assets/cocktail-3.jpg";
import c4 from "@/assets/cocktail-4.jpg";
import c5 from "@/assets/cocktail-5.jpg";
import c6 from "@/assets/cocktail-6.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ATRIA — Autonomous Bartender Kiosk" },
      { name: "description", content: "Interactive premium touchscreen kiosk interface for ATRIA, an autonomous bartender robot." },
      { property: "og:title", content: "ATRIA — Autonomous Bartender Kiosk" },
      { property: "og:description", content: "Order, customize, and watch your cocktail being mixed by a robotic mixologist." },
    ],
  }),
  component: KioskApp,
});

/* ============================================================
   Types & data
   ============================================================ */

type Drink = {
  id: string;
  name: string;
  desc: string;
  img: string;
  abv: number;
  time: number;
  price: number;
  story: string;
  ingredients: string[];
  flavor: { sweet: number; bitter: number; smoky: number };
  origin: string;
};

const DRINKS: Drink[] = [
  {
    id: "old-fashioned", name: "Old Fashioned", desc: "Bourbon, demerara, orange.", img: c1, abv: 4, time: 75, price: 18, origin: "Est. 1880 · Louisville, KY",
    story: "Bourbon stirred with demerara and aromatic bitters, expressed with orange oil. Spirit-forward, gently sweet.",
    ingredients: ["Woodford Bourbon 60ml", "Demerara 10ml", "Angostura 2 dash", "Orange peel"],
    flavor: { sweet: 30, bitter: 60, smoky: 45 }
  },
  {
    id: "negroni", name: "Negroni", desc: "Gin, Campari, sweet vermouth.", img: c2, abv: 4, time: 65, price: 17, origin: "Est. 1919 · Florence, IT",
    story: "Equal parts gin, Campari and sweet vermouth, stirred over a single block of ice.",
    ingredients: ["Tanqueray 30ml", "Campari 30ml", "Carpano Antica 30ml", "Orange peel"],
    flavor: { sweet: 35, bitter: 80, smoky: 20 }
  },
  {
    id: "dry-martini", name: "Dry Martini", desc: "Gin, dry vermouth, lemon.", img: c3, abv: 5, time: 55, price: 19.5, origin: "Est. 1905 · New York, NY",
    story: "Tanqueray No. Ten stirred to a glassy −4°C with Dolin Dry. Crystalline, austere, perfectly balanced.",
    ingredients: ["Tanqueray No. Ten 60ml", "Dolin Dry 15ml", "Lemon twist"],
    flavor: { sweet: 10, bitter: 30, smoky: 5 }
  },
  {
    id: "margarita", name: "Margarita", desc: "Tequila, lime, agave, salt.", img: c4, abv: 3, time: 70, price: 16, origin: "Est. 1938 · Tijuana, MX",
    story: "Blanco tequila shaken with fresh lime and a whisper of agave. A salt rim adds the final note.",
    ingredients: ["Don Julio Blanco 50ml", "Lime 25ml", "Agave 10ml", "Salt rim"],
    flavor: { sweet: 45, bitter: 20, smoky: 15 }
  },
  {
    id: "whiskey-sour", name: "Whiskey Sour", desc: "Rye, lemon, sugar, egg white.", img: c5, abv: 3, time: 85, price: 17, origin: "Est. 1870 · Wisconsin, US",
    story: "Rye whiskey shaken with fresh lemon, sugar, and a silky egg-white foam.",
    ingredients: ["Rittenhouse Rye 50ml", "Lemon 25ml", "Sugar 15ml", "Egg white"],
    flavor: { sweet: 55, bitter: 25, smoky: 30 }
  },
  {
    id: "espresso-martini", name: "Espresso Martini", desc: "Vodka, espresso, coffee liqueur.", img: c6, abv: 3, time: 80, price: 18, origin: "Est. 1983 · London, UK",
    story: "Vodka shaken with single-origin espresso and Mr Black for a glossy, dark crown.",
    ingredients: ["Belvedere 40ml", "Espresso 30ml", "Mr Black 20ml", "Coffee beans"],
    flavor: { sweet: 50, bitter: 55, smoky: 35 }
  },
];

type ScreenKey =
  | "welcome" | "experience" | "catalog" | "detail"
  | "compose" | "review" | "preparing" | "ready";

/* ============================================================
   Kiosk shell — responsive frame that scales to fit
   ============================================================ */

function useKioskScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const recompute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pad = 0;
      const s = Math.min((w - pad) / 1024, (h - pad) / 600, 1.5);
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
  const [selectedId, setSelectedId] = useState<string>("dry-martini");
  const [custom, setCustom] = useState({ spirit: 1, sweet: 1, strength: 2, ice: 2, garnish: 1 });
  const [mode, setMode] = useState<"signature" | "custom">("signature");
  const [progress, setProgress] = useState(0);
  const [now, setNow] = useState(new Date());

  const selected = useMemo(
    () => DRINKS.find(d => d.id === selectedId) ?? DRINKS[0],
    [selectedId]
  );

  // clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // preparation timer
  useEffect(() => {
    if (screen !== "preparing") return;
    setProgress(0);
    const start = Date.now();
    const total = 6000; // 6s simulated to be fast
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / total);
      setProgress(p);
      if (p >= 1) {
        clearInterval(id);
        setTimeout(() => setScreen("ready"), 400);
      }
    }, 100);
    return () => clearInterval(id);
  }, [screen]);

  const scale = useKioskScale();

  const go = (s: ScreenKey) => setScreen(s);

  const ctx = {
    selected, setSelectedId, custom, setCustom, mode, setMode,
    progress, now, go,
  };

  return (
    <main className="min-h-screen bg-page text-page-foreground flex items-center justify-center overflow-hidden touch-none select-none">
      <div className="pointer-events-none fixed inset-0 opacity-60"
        style={{ background: "radial-gradient(60% 50% at 50% 40%, oklch(0.83 0.09 85 / 8%), transparent 70%)" }} />

      <div
        className="kiosk-frame transition-transform w-[1024px] h-[600px] relative"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {screen === "welcome" && <Welcome    {...ctx} />}
        {screen === "experience" && <Experience {...ctx} />}
        {screen === "catalog" && <Catalog    {...ctx} />}
        {screen === "detail" && <Detail     {...ctx} />}
        {screen === "compose" && <Compose    {...ctx} />}
        {screen === "review" && <Review     {...ctx} />}
        {screen === "preparing" && <Preparing  {...ctx} />}
        {screen === "ready" && <Ready      {...ctx} />}
      </div>
    </main>
  );
}

/* ============================================================
   Shared atoms
   ============================================================ */

type Ctx = {
  selected: Drink;
  setSelectedId: (id: string) => void;
  custom: { spirit: number; sweet: number; strength: number; ice: number; garnish: number };
  setCustom: React.Dispatch<React.SetStateAction<Ctx["custom"]>>;
  mode: "signature" | "custom";
  setMode: (m: "signature" | "custom") => void;
  progress: number;
  now: Date;
  go: (s: ScreenKey) => void;
};

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function StatusBar({ title, now }: { title: string; now: Date }) {
  return (
    <div className="absolute top-0 inset-x-0 h-14 px-8 flex items-center justify-between text-sm uppercase tracking-[0.2em] text-muted-foreground/90 font-medium z-20 bg-gradient-to-b from-background/80 to-transparent">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_12px_currentColor]" />
        <span>ATRIA · {title}</span>
      </div>
      <div className="flex items-center gap-6">
        <span>Station 04</span>
        <span>Online</span>
        <span className="font-bold text-foreground">{formatTime(now)}</span>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 text-2xl">
      <span className="brushed-gold w-8 h-8 rounded-full shadow-md" />
      <span className="font-display tracking-[0.35em] uppercase font-light drop-shadow-md text-foreground">Atria</span>
    </div>
  );
}

function GoldButton({
  children, onClick, big = false, variant = "primary", disabled,
}: {
  children: React.ReactNode; onClick?: () => void; big?: boolean;
  variant?: "primary" | "ghost"; disabled?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-3 font-bold uppercase tracking-[0.2em] transition-all active:scale-[0.95] select-none shadow-xl";
  const size = big ? "px-24 h-32 text-4xl rounded-[3rem]" : "px-10 h-16 text-lg rounded-[2rem]";
  if (variant === "ghost") {
    return (
      <button onClick={onClick} disabled={disabled}
        className={`${base} ${size} border-2 border-border-strong text-foreground/90 hover:bg-foreground/5`}>
        {children}
      </button>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${base} ${size} brushed-gold text-accent-foreground shadow-[0_8px_30px_-8px_oklch(0.83_0.09_85/40%)] hover:shadow-[0_10px_40px_-8px_oklch(0.83_0.09_85/60%)] disabled:opacity-40`}>
      {children}
    </button>
  );
}

function BackChip({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      className="absolute top-10 right-8 z-30 text-lg uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground flex items-center gap-3 px-8 h-16 rounded-full border-2 border-border/60 hover:border-border-strong bg-background/50 backdrop-blur-md active:scale-[0.95] transition-all">
      ← {label}
    </button>
  );
}

/* ============================================================
   Screens
   ============================================================ */

function Welcome({ now, go }: Ctx) {
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

function Experience({ now, go, setMode }: Ctx) {
  const choose = (m: "signature" | "custom") => {
    setMode(m);
    go(m === "signature" ? "catalog" : "compose");
  };
  return (
    <div className="absolute inset-0">
      <StatusBar title="Choose Experience" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("welcome")} label="Home" />

      <div className="h-full pt-28 pb-12 px-16 flex flex-col">
        <h2 className="font-display text-5xl font-light text-center mb-12 drop-shadow-md">What are we pouring?</h2>
        <div className="flex-1 grid grid-cols-2 gap-10">
          <ExperienceCard onClick={() => choose("signature")}
            title="House Classics" image={c2} />
          <ExperienceCard onClick={() => choose("custom")}
            title="Custom Creation" image={c5} />
        </div>
      </div>
    </div>
  );
}

function ExperienceCard({
  title, image, onClick,
}: { title: string; image: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative rounded-[3rem] overflow-hidden group hover:ring-4 hover:ring-accent/80 transition-all active:scale-[0.98] shadow-2xl">
      <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-16">
        <h3 className="font-display text-[56px] font-light text-center leading-tight drop-shadow-lg px-8">{title}</h3>
        <div className="mt-8">
          <span className="brushed-gold w-20 h-20 rounded-full flex items-center justify-center text-accent-foreground text-4xl shadow-xl">→</span>
        </div>
      </div>
    </button>
  );
}

function Catalog({ now, go, setSelectedId }: Ctx) {
  return (
    <div className="absolute inset-0">
      <StatusBar title="House Classics" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("experience")} />

      <div className="h-full pt-28 pb-10 px-12 flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-4 pb-12 custom-scrollbar">
          <div className="grid grid-cols-2 gap-8">
            {DRINKS.map(d => (
              <button key={d.id} onClick={() => { setSelectedId(d.id); go("detail"); }}
                className="surface-card relative text-left rounded-[2rem] overflow-hidden flex flex-col h-[380px] hover:ring-4 hover:ring-accent/80 transition active:scale-[0.98] group shadow-xl">
                <img src={d.img} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-transparent" />

                <div className="absolute bottom-0 inset-x-0 p-8 flex justify-between items-end">
                  <div>
                    <h4 className="font-display text-[44px] leading-none mb-2 text-foreground">{d.name}</h4>
                    <div className="text-2xl text-accent font-light">€{d.price.toFixed(2)}</div>
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

function Detail({ selected, now, go }: Ctx) {
  return (
    <div className="absolute inset-0">
      <StatusBar title={selected.name} now={now} />
      <div className="absolute top-10 left-8 z-30"><Logo /></div>
      <BackChip onClick={() => go("catalog")} />

      <div className="h-full flex">
        <div className="w-[55%] relative">
          <img src={selected.img} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/20 to-background" />
        </div>

        <div className="w-[45%] px-10 pb-12 pt-24 flex flex-col justify-end bg-background relative z-10">
          <h2 className="font-display text-[64px] font-light leading-none mb-2">{selected.name}</h2>
          <div className="font-display text-5xl text-accent mb-6">
            €{Math.floor(selected.price)}
            <span className="text-3xl">.{(selected.price % 1).toFixed(2).slice(2)}</span>
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            {selected.ingredients.map(i =>
              <span key={i} className="px-5 py-2 rounded-2xl bg-surface-2 text-lg font-medium border border-border-strong text-foreground whitespace-nowrap">{i}</span>
            )}
            <span className="px-5 py-2 rounded-2xl bg-surface-2 text-lg font-medium border border-border-strong text-muted-foreground whitespace-nowrap">{selected.abv * 4 + 20}% ABV</span>
          </div>

          <div>
            <GoldButton big onClick={() => go("review")}>ORDER NOW</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

const SPIRITS = [
  { name: "Gin", sub: "Botanical", img: c3 },
  { name: "Bourbon", sub: "Toasted oak", img: c1 },
  { name: "Vodka", sub: "Neutral", img: c6 },
  { name: "Tequila", sub: "Agave", img: c4 },
];

function Compose({ now, go, custom, setCustom }: Ctx) {
  const spirit = SPIRITS[custom.spirit];
  const labels = ["Dry", "Balanced", "Sweet"];
  const strengths = ["Light", "Standard", "Bold"];
  const iceOptions = ["None", "Cubes", "Sphere"];
  const garnishOptions = ["Twist", "Peel", "Cherry"];

  return (
    <div className="absolute inset-0">
      <StatusBar title="Custom Creation" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go("experience")} />

      <div className="h-full pt-28 pb-10 px-12 grid grid-cols-[1fr_400px] gap-12">
        <div className="flex flex-col gap-10 overflow-y-auto pr-4 pb-8 custom-scrollbar">
          <div>
            <div className="text-2xl uppercase tracking-[0.2em] text-muted-foreground mb-4">Base Spirit</div>
            <div className="grid grid-cols-2 gap-4">
              {SPIRITS.map((s, i) => (
                <button key={s.name} onClick={() => setCustom(c => ({ ...c, spirit: i }))}
                  className={`surface-card text-left rounded-[2rem] p-6 transition-all active:scale-[0.98] ${i === custom.spirit ? "ring-4 ring-accent bg-accent/10" : "hover:bg-surface-2"}`}>
                  <div className="flex items-center gap-5">
                    <img src={s.img} alt="" className="w-20 h-20 rounded-full object-cover" />
                    <div>
                      <div className="font-display text-3xl mb-1">{s.name}</div>
                      <div className="text-lg text-muted-foreground">{s.sub}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10">
            <BigSegmented label="Sweetness" options={labels} active={custom.sweet}
              onChange={i => setCustom(c => ({ ...c, sweet: i }))} />
            <BigSegmented label="Strength" options={strengths} active={custom.strength}
              onChange={i => setCustom(c => ({ ...c, strength: i }))} />
            <BigSegmented label="Ice" options={iceOptions} active={custom.ice}
              onChange={i => setCustom(c => ({ ...c, ice: i }))} />
            <BigSegmented label="Garnish" options={garnishOptions} active={custom.garnish}
              onChange={i => setCustom(c => ({ ...c, garnish: i }))} />
          </div>
        </div>

        <div className="relative rounded-[3rem] overflow-hidden flex flex-col justify-end shadow-2xl">
          <img src={spirit.img} alt="" className="absolute inset-0 w-full h-full object-cover transition" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent" />

          <div className="relative z-10 p-8 flex flex-col">
            <div className="font-display text-5xl mb-2 text-foreground">Custom Drink</div>
            <div className="text-2xl text-accent mb-6">€16.00</div>

            <GoldButton big onClick={() => go("review")}>REVIEW</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function BigSegmented({
  label, options, active, onChange,
}: { label: string; options: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div>
      <div className="text-xl uppercase tracking-[0.2em] text-muted-foreground mb-4">{label}</div>
      <div className="flex flex-col gap-3">
        {options.map((o, i) => (
          <button key={o} onClick={() => onChange(i)}
            className={`py-4 px-6 rounded-2xl text-xl font-medium transition-all text-left border-2 ${i === active ? "brushed-gold border-transparent text-accent-foreground shadow-lg" : "bg-surface border-border-strong text-muted-foreground hover:bg-surface-2"}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Review({ selected, mode, custom, now, go }: Ctx) {
  const spirit = SPIRITS[custom.spirit];
  const rows: [string, string][] = mode === "signature"
    ? [
      ["Cocktail", selected.name],
      ["Base spirit", selected.ingredients[0]],
    ]
    : [
      ["Base spirit", spirit.name],
      ["Sweetness", ["Dry", "Balanced", "Sweet"][custom.sweet]],
      ["Strength", ["Light", "Standard", "Bold"][custom.strength]],
      ["Ice", ["None", "Cubes", "Sphere"][custom.ice]],
      ["Garnish", ["Twist", "Peel", "Cherry"][custom.garnish]],
    ];
  const price = mode === "signature" ? selected.price : 16;
  const image = mode === "signature" ? selected.img : spirit.img;
  const title = mode === "signature" ? selected.name : "Custom Drink";

  return (
    <div className="absolute inset-0 flex flex-col justify-center items-center bg-background">
      <StatusBar title="Confirm Order" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>
      <BackChip onClick={() => go(mode === "signature" ? "detail" : "compose")} label="Edit" />

      <div className="w-full max-w-[850px] flex gap-12 items-center">
        <div className="w-[380px] h-[380px] rounded-[3rem] overflow-hidden relative shrink-0 shadow-2xl">
          <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        </div>

        <div className="flex-1 flex flex-col">
          <h2 className="font-display text-[56px] font-light leading-none mb-6">{title}</h2>

          <div className="flex flex-col gap-3 mb-8">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between items-center text-2xl border-b border-border/40 pb-4">
                <span className="text-muted-foreground uppercase tracking-widest text-lg">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-6 mt-4">
            <span className="text-2xl uppercase tracking-[0.2em] text-muted-foreground">Total</span>
            <span className="font-display text-[56px] text-accent">€{price.toFixed(2)}</span>
          </div>

          <GoldButton big onClick={() => go("preparing")}>CONFIRM ORDER</GoldButton>
        </div>
      </div>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 180;
  const c = 2 * Math.PI * r;
  return (
    <svg width="400" height="400" viewBox="0 0 400 400" className="-rotate-90 drop-shadow-2xl">
      <circle cx="200" cy="200" r={r} stroke="oklch(1 0 0 / 10%)" strokeWidth="6" fill="none" />
      <circle cx="200" cy="200" r={r} stroke="url(#gold)" strokeWidth="12" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 120ms linear" }} />
      <defs>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.08 85)" />
          <stop offset="100%" stopColor="oklch(0.92 0.09 88)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Preparing({ selected, mode, progress, now }: Ctx) {
  const total = mode === "signature" ? selected.time : 80;
  const remaining = Math.max(0, Math.ceil(total * (1 - progress)));
  const title = mode === "signature" ? selected.name : "Custom Drink";

  return (
    <div className="absolute inset-0 bg-background flex flex-col items-center justify-center">
      <StatusBar title="Preparing" now={now} />
      <div className="absolute top-10 left-8"><Logo /></div>

      <div className="relative flex flex-col items-center justify-center">
        <div className="relative">
          <ProgressRing pct={progress} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-display text-[120px] font-light leading-none tabular-nums text-foreground">
              {remaining}
            </div>
            <div className="text-3xl text-accent mt-2">seconds</div>
          </div>
        </div>

        <h2 className="font-display text-[56px] mt-16 font-light">{title}</h2>
        <div className="text-2xl uppercase tracking-[0.3em] text-muted-foreground mt-4 animate-pulse">Pouring now...</div>
      </div>
    </div>
  );
}

function Ready({ selected, mode, now, go }: Ctx) {
  const orderNo = useMemo(() => 2400 + Math.floor(Math.random() * 99), []);
  return (
    <div className="absolute inset-0">
      <StatusBar title="Ready" now={now} />
      <img src={readyHero} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/30" />
      <div className="absolute top-10 left-8 z-20"><Logo /></div>

      <div className="relative h-full flex flex-col justify-end pb-12 px-16 max-w-[80%] z-10">
        <div className="text-xl uppercase tracking-[0.4em] text-accent mb-2">Order Complete</div>
        <h1 className="font-display text-[72px] leading-[1] font-light tracking-tight mb-8 drop-shadow-lg">
          Your drink is <em className="italic font-normal gold-text">ready.</em>
        </h1>

        <div className="flex gap-6 mb-10">
          <div className="glass-card rounded-[2rem] px-8 py-5 border-2 border-accent/40 shadow-xl">
            <div className="text-sm uppercase tracking-widest text-muted-foreground mb-1">Collect at Window</div>
            <div className="font-display text-[56px] text-accent leading-none">B · 04</div>
          </div>
          <div className="glass-card rounded-[2rem] px-8 py-5 border border-border-strong/50 shadow-xl">
            <div className="text-sm uppercase tracking-widest text-muted-foreground mb-1">Order No.</div>
            <div className="font-display text-[56px] leading-none">{orderNo}</div>
          </div>
        </div>

        <div>
          <GoldButton big onClick={() => go("welcome")}>FINISH</GoldButton>
        </div>
      </div>
    </div>
  );
}
