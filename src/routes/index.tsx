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
  { id: "old-fashioned", name: "Old Fashioned", desc: "Bourbon, demerara, orange.", img: c1, abv: 4, time: 75, price: 18, origin: "Est. 1880 · Louisville, KY",
    story: "Bourbon stirred with demerara and aromatic bitters, expressed with orange oil. Spirit-forward, gently sweet.",
    ingredients: ["Woodford Bourbon 60ml", "Demerara 10ml", "Angostura 2 dash", "Orange peel"],
    flavor: { sweet: 30, bitter: 60, smoky: 45 } },
  { id: "negroni", name: "Negroni", desc: "Gin, Campari, sweet vermouth.", img: c2, abv: 4, time: 65, price: 17, origin: "Est. 1919 · Florence, IT",
    story: "Equal parts gin, Campari and sweet vermouth, stirred over a single block of ice.",
    ingredients: ["Tanqueray 30ml", "Campari 30ml", "Carpano Antica 30ml", "Orange peel"],
    flavor: { sweet: 35, bitter: 80, smoky: 20 } },
  { id: "dry-martini", name: "Dry Martini", desc: "Gin, dry vermouth, lemon.", img: c3, abv: 5, time: 55, price: 19.5, origin: "Est. 1905 · New York, NY",
    story: "Tanqueray No. Ten stirred to a glassy −4°C with Dolin Dry. Crystalline, austere, perfectly balanced.",
    ingredients: ["Tanqueray No. Ten 60ml", "Dolin Dry 15ml", "Lemon twist"],
    flavor: { sweet: 10, bitter: 30, smoky: 5 } },
  { id: "margarita", name: "Margarita", desc: "Tequila, lime, agave, salt.", img: c4, abv: 3, time: 70, price: 16, origin: "Est. 1938 · Tijuana, MX",
    story: "Blanco tequila shaken with fresh lime and a whisper of agave. A salt rim adds the final note.",
    ingredients: ["Don Julio Blanco 50ml", "Lime 25ml", "Agave 10ml", "Salt rim"],
    flavor: { sweet: 45, bitter: 20, smoky: 15 } },
  { id: "whiskey-sour", name: "Whiskey Sour", desc: "Rye, lemon, sugar, egg white.", img: c5, abv: 3, time: 85, price: 17, origin: "Est. 1870 · Wisconsin, US",
    story: "Rye whiskey shaken with fresh lemon, sugar, and a silky egg-white foam.",
    ingredients: ["Rittenhouse Rye 50ml", "Lemon 25ml", "Sugar 15ml", "Egg white"],
    flavor: { sweet: 55, bitter: 25, smoky: 30 } },
  { id: "espresso-martini", name: "Espresso Martini", desc: "Vodka, espresso, coffee liqueur.", img: c6, abv: 3, time: 80, price: 18, origin: "Est. 1983 · London, UK",
    story: "Vodka shaken with single-origin espresso and Mr Black for a glossy, dark crown.",
    ingredients: ["Belvedere 40ml", "Espresso 30ml", "Mr Black 20ml", "Coffee beans"],
    flavor: { sweet: 50, bitter: 55, smoky: 35 } },
];

type ScreenKey =
  | "welcome" | "experience" | "catalog" | "detail"
  | "compose" | "review" | "preparing" | "ready";

/* ============================================================
   Kiosk shell — responsive 1024×600 frame that scales to fit
   ============================================================ */

function useKioskScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const recompute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pad = 48;
      const s = Math.min((w - pad) / 1024, (h - pad) / 600, 1.2);
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
    const total = 12000; // 12s simulated
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
    <main className="min-h-screen bg-page text-page-foreground flex items-center justify-center overflow-hidden">
      {/* ambient page glow */}
      <div className="pointer-events-none fixed inset-0 opacity-60"
        style={{ background: "radial-gradient(60% 50% at 50% 40%, oklch(0.83 0.09 85 / 8%), transparent 70%)" }} />

      <div
        className="kiosk-frame transition-transform"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {screen === "welcome"    && <Welcome    {...ctx} />}
        {screen === "experience" && <Experience {...ctx} />}
        {screen === "catalog"    && <Catalog    {...ctx} />}
        {screen === "detail"     && <Detail     {...ctx} />}
        {screen === "compose"    && <Compose    {...ctx} />}
        {screen === "review"     && <Review     {...ctx} />}
        {screen === "preparing"  && <Preparing  {...ctx} />}
        {screen === "ready"      && <Ready      {...ctx} />}
      </div>

      {/* dev helper: tiny step indicator at bottom */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-50">
        {(["welcome","experience","catalog","detail","compose","review","preparing","ready"] as ScreenKey[]).map(k => (
          <button
            key={k}
            onClick={() => setScreen(k)}
            aria-label={k}
            className={`h-1.5 rounded-full transition-all ${screen===k ? "w-8 bg-accent" : "w-1.5 bg-page-foreground/20 hover:bg-page-foreground/40"}`}
          />
        ))}
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
    <div className="absolute top-0 inset-x-0 h-10 px-7 flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-muted-foreground/90 font-medium z-20">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_currentColor]" />
        <span>ATRIA · {title}</span>
      </div>
      <div className="flex items-center gap-5">
        <span>Station 04</span>
        <span>Online</span>
        <span>{formatTime(now)}</span>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="brushed-gold w-5 h-5 rounded-full" />
      <span className="font-display tracking-[0.35em] uppercase">Atria</span>
    </div>
  );
}

function GoldButton({
  children, onClick, big = false, variant = "primary", disabled,
}: {
  children: React.ReactNode; onClick?: () => void; big?: boolean;
  variant?: "primary" | "ghost"; disabled?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-3 rounded-full font-medium uppercase tracking-[0.22em] transition-all active:scale-[0.98] select-none";
  const size = big ? "px-12 h-16 text-base" : "px-8 h-12 text-sm";
  if (variant === "ghost") {
    return (
      <button onClick={onClick} disabled={disabled}
        className={`${base} ${size} border border-border-strong text-foreground/90 hover:bg-foreground/5`}>
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
      className="absolute top-10 right-7 z-30 text-[10px] uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 h-9 rounded-full border border-border/60 hover:border-border-strong">
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
      <img src={robotHero} alt="" className="absolute inset-y-0 right-0 h-full w-[58%] object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <button onClick={() => go("experience")} className="absolute inset-0 cursor-pointer text-left">
        <div className="relative h-full flex flex-col justify-center px-16 max-w-[58%] z-10">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent mb-6">An evening, perfectly poured</div>
          <h1 className="font-display text-[68px] leading-[0.95] font-light tracking-tight">
            Good <em className="italic font-normal">evening.</em><br />
            Shall we begin?
          </h1>
          <p className="mt-6 text-muted-foreground text-[15px] leading-relaxed max-w-md">
            A signature cocktail, mixed to your preference by ATRIA — our resident
            robotic mixologist. Ready in under ninety seconds.
          </p>
          <div className="mt-10 flex items-center gap-4">
            <GoldButton big onClick={() => go("experience")}>Start Experience →</GoldButton>
            <span className="text-xs text-muted-foreground tracking-widest uppercase">EN · FR · JP</span>
          </div>
        </div>
      </button>

      <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70 pointer-events-none">
        <span className="h-px w-10 hairline" /> Touch anywhere to begin <span className="h-px w-10 hairline" />
      </div>
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
      <div className="absolute top-10 left-7"><Logo /></div>
      <BackChip onClick={() => go("welcome")} label="Home" />

      <div className="h-full pt-20 pb-10 px-12 flex flex-col">
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 01 of 04</div>
          <h2 className="font-display text-4xl mt-3 font-light">How would you like to be served tonight?</h2>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-6">
          <ExperienceCard onClick={() => choose("signature")}
            eyebrow="The Library" title="Signature Cocktails"
            sub="Twelve recipes from our master mixologists, served with quiet precision."
            image={c2} hint="12 curated · refreshed weekly" />
          <ExperienceCard onClick={() => choose("custom")}
            eyebrow="The Studio" title="Create a Custom Drink"
            sub="Compose your own — base spirit, sweetness, garnish. Saved to your profile."
            image={c5} hint="Tailor every note" />
        </div>
      </div>
    </div>
  );
}

function ExperienceCard({
  title, sub, eyebrow, image, hint, onClick,
}: { title: string; sub: string; eyebrow: string; image: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="surface-card text-left relative flex-1 rounded-3xl overflow-hidden h-full p-8 flex flex-col justify-between hover:ring-1 hover:ring-accent/60 transition">
      <div>
        <div className="text-[10px] uppercase tracking-[0.32em] text-accent">{eyebrow}</div>
        <h3 className="font-display text-4xl mt-3 font-light leading-tight">{title}</h3>
        <p className="text-muted-foreground text-[13px] mt-3 max-w-[260px] leading-relaxed">{sub}</p>
      </div>
      <div className="absolute -right-10 -bottom-10 w-[260px] h-[260px] rounded-full overflow-hidden opacity-90">
        <img src={image} alt="" className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-tl from-transparent via-transparent to-background/60" />
      </div>
      <div className="relative z-10 flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{hint}</span>
        <span className="brushed-gold w-12 h-12 rounded-full flex items-center justify-center text-accent-foreground text-lg">→</span>
      </div>
    </button>
  );
}

function AbvDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= level ? "bg-accent" : "bg-foreground/15"}`} />
      ))}
    </div>
  );
}

const FILTERS = ["All","Classic","Citrus","Smoky","Sweet"];

function Catalog({ now, go, setSelectedId }: Ctx) {
  const [filter, setFilter] = useState(0);
  return (
    <div className="absolute inset-0">
      <StatusBar title="Signature Catalog" now={now} />
      <div className="absolute top-10 left-7"><Logo /></div>
      <BackChip onClick={() => go("experience")} />

      <div className="h-full pt-20 pb-6 px-10 flex flex-col">
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.4em] text-accent">The Library</div>
            <h2 className="font-display text-3xl mt-2 font-light">Signature Cocktails</h2>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
            {FILTERS.map((t,i) => (
              <button key={t} onClick={() => setFilter(i)}
                className={`px-4 py-2 rounded-full transition ${i===filter ? "brushed-gold text-accent-foreground font-medium" : "border border-border text-muted-foreground hover:text-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 flex-1">
          {DRINKS.map(d => (
            <button key={d.id} onClick={() => { setSelectedId(d.id); go("detail"); }}
              className="surface-card text-left rounded-2xl overflow-hidden flex flex-col hover:ring-1 hover:ring-accent/60 transition">
              <div className="relative h-[130px] overflow-hidden">
                <img src={d.img} alt="" className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
              </div>
              <div className="p-4 flex flex-col gap-2 flex-1">
                <div className="flex items-baseline justify-between">
                  <h4 className="font-display text-xl leading-none">{d.name}</h4>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{d.time}s</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug min-h-[28px]">{d.desc}</p>
                <div className="flex items-center justify-between pt-1 mt-auto">
                  <AbvDots level={d.abv} />
                  <span className="brushed-gold text-accent-foreground text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-full font-medium">Order</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Detail({ selected, now, go }: Ctx) {
  return (
    <div className="absolute inset-0">
      <StatusBar title={selected.name} now={now} />
      <div className="absolute top-10 left-7"><Logo /></div>
      <BackChip onClick={() => go("catalog")} />

      <div className="h-full pt-20 grid grid-cols-[1.1fr_1fr]">
        <div className="relative">
          <img src={selected.img} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-background/40" />
          <div className="absolute bottom-6 left-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{selected.origin}</div>
        </div>

        <div className="px-10 py-6 flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">House Classic</div>
          <h2 className="font-display text-5xl font-light mt-2 leading-none">{selected.name}</h2>
          <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">{selected.story}</p>

          <div className="mt-5 grid grid-cols-2 gap-3 text-[11px]">
            <div className="glass-card rounded-xl px-4 py-3">
              <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Strength</div>
              <div className="mt-1 font-medium">Bold · {20 + selected.abv * 4}% ABV</div>
            </div>
            <div className="glass-card rounded-xl px-4 py-3">
              <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Prep time</div>
              <div className="mt-1 font-medium">{selected.time} seconds</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Ingredients</div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {selected.ingredients.map(i =>
                <span key={i} className="px-3 py-1.5 rounded-full border border-border text-foreground/90">{i}</span>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Flavor profile</div>
            <div className="space-y-1.5">
              {([["Sweet", selected.flavor.sweet],["Bitter", selected.flavor.bitter],["Smoky", selected.flavor.smoky]] as const).map(([k,v]) => (
                <div key={k} className="flex items-center gap-3 text-[11px]">
                  <span className="w-14 text-muted-foreground">{k}</span>
                  <span className="flex-1 h-[3px] bg-foreground/10 rounded-full overflow-hidden">
                    <span className="block h-full brushed-gold transition-all" style={{ width: `${v}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between pt-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Price</div>
              <div className="font-display text-3xl font-light">
                €{Math.floor(selected.price)}
                <span className="text-base text-muted-foreground">.{(selected.price % 1).toFixed(2).slice(2)}</span>
              </div>
            </div>
            <GoldButton onClick={() => go("review")}>Prepare Drink →</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Segmented({
  label, options, active, onChange,
}: { label: string; options: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</span>
      </div>
      <div className="flex bg-surface rounded-full p-1 border border-border">
        {options.map((o, i) => (
          <button key={o} onClick={() => onChange(i)}
            className={`flex-1 text-center py-2 rounded-full text-[11px] uppercase tracking-[0.18em] transition ${i===active ? "brushed-gold text-accent-foreground font-medium" : "text-muted-foreground"}`}>
            {o}
          </button>
        ))}
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
  const labels = ["Dry","Medium","Sweet"];
  const strengths = ["Light","Standard","Bold"];
  return (
    <div className="absolute inset-0">
      <StatusBar title="Compose · The Studio" now={now} />
      <div className="absolute top-10 left-7"><Logo /></div>
      <BackChip onClick={() => go("experience")} />

      <div className="h-full pt-20 pb-6 px-10 grid grid-cols-[1fr_320px] gap-8">
        <div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 02 of 04</div>
          <h2 className="font-display text-3xl font-light mt-1">Compose your drink</h2>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Base Spirit</div>
            <div className="grid grid-cols-4 gap-3">
              {SPIRITS.map((s, i) => (
                <button key={s.name} onClick={() => setCustom(c => ({ ...c, spirit: i }))}
                  className={`surface-card text-left rounded-2xl p-4 transition ${i===custom.spirit ? "ring-1 ring-accent" : "hover:ring-1 hover:ring-border-strong"}`}>
                  <div className={`w-7 h-7 rounded-full mb-3 ${i===custom.spirit ? "brushed-gold" : "bg-surface-3"}`} />
                  <div className="font-display text-lg leading-none">{s.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{s.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <Segmented label="Sweetness" options={["Dry","Med","Sweet"]} active={custom.sweet}
              onChange={i => setCustom(c => ({ ...c, sweet: i }))} />
            <Segmented label="Strength" options={["Light","Std","Bold"]} active={custom.strength}
              onChange={i => setCustom(c => ({ ...c, strength: i }))} />
            <Segmented label="Ice" options={["None","Cubes","Sphere"]} active={custom.ice}
              onChange={i => setCustom(c => ({ ...c, ice: i }))} />
            <Segmented label="Garnish" options={["Twist","Peel","Cherry"]} active={custom.garnish}
              onChange={i => setCustom(c => ({ ...c, garnish: i }))} />
          </div>
        </div>

        <div className="glass-card rounded-3xl p-5 flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Live preview</div>
          <div className="relative flex-1 rounded-2xl overflow-hidden mt-3 bg-surface">
            <img src={spirit.img} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90 transition" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/70 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <div className="font-display text-xl">Custom №14</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {spirit.name} · {labels[custom.sweet]} · {strengths[custom.strength]}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Est. 80s</span>
            <span className="font-display text-2xl">€16</span>
          </div>
          <div className="mt-3 flex justify-center">
            <GoldButton onClick={() => go("review")}>Review Order →</GoldButton>
          </div>
        </div>
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
        ["Method", "Stirred · −4°C"],
        ["Glassware", "Crystal coupe"],
        ["Origin", selected.origin],
      ]
    : [
        ["Base spirit", spirit.name],
        ["Sweetness", ["Dry","Medium","Sweet"][custom.sweet]],
        ["Strength", ["Light","Standard","Bold"][custom.strength]],
        ["Ice", ["None","Cubes","Sphere"][custom.ice]],
        ["Garnish", ["Twist","Peel","Cherry"][custom.garnish]],
      ];
  const price = mode === "signature" ? selected.price : 16;
  const time = mode === "signature" ? selected.time : 80;
  const image = mode === "signature" ? selected.img : spirit.img;
  const title = mode === "signature" ? selected.name : "Custom №14";
  return (
    <div className="absolute inset-0">
      <StatusBar title="Confirm Order" now={now} />
      <div className="absolute top-10 left-7"><Logo /></div>
      <BackChip onClick={() => go(mode === "signature" ? "detail" : "compose")} label="Edit" />

      <div className="h-full pt-20 pb-8 px-12 grid grid-cols-[360px_1fr] gap-10">
        <div className="relative rounded-3xl overflow-hidden surface-card">
          <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
          <div className="absolute bottom-5 left-5 right-5">
            <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Your selection</div>
            <div className="font-display text-3xl font-light mt-1">{title}</div>
            <div className="text-[11px] text-muted-foreground">Reimagined for you</div>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 04 of 04</div>
          <h2 className="font-display text-4xl font-light mt-1">Review your order</h2>

          <div className="mt-6 divide-y divide-border">
            {rows.map(([k,v]) => (
              <div key={k} className="flex justify-between py-3 text-sm">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px] mt-1">{k}</span>
                <span className="text-foreground font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-end justify-between pt-6 border-t border-border-strong/40">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total · Prep time {time}s</div>
              <div className="font-display text-4xl font-light mt-1">
                €{Math.floor(price)}<span className="text-lg text-muted-foreground">.{(price % 1).toFixed(2).slice(2)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <GoldButton variant="ghost" onClick={() => go(mode === "signature" ? "detail" : "compose")}>Edit</GoldButton>
              <GoldButton big onClick={() => go("preparing")}>Confirm & Prepare →</GoldButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 92;
  const c = 2 * Math.PI * r;
  return (
    <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
      <circle cx="110" cy="110" r={r} stroke="oklch(1 0 0 / 8%)" strokeWidth="3" fill="none" />
      <circle cx="110" cy="110" r={r} stroke="url(#gold)" strokeWidth="3" fill="none" strokeLinecap="round"
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
  const title = mode === "signature" ? selected.name : "Custom №14";
  const stepIndex = progress < 0.25 ? 0 : progress < 0.55 ? 1 : progress < 0.9 ? 2 : 3;
  const steps = [
    ["01","Chilling glass"],
    ["02","Measuring base spirit"],
    ["03","Stirring · 18 rotations"],
    ["04","Garnish & serve"],
  ] as const;
  return (
    <div className="absolute inset-0">
      <StatusBar title={`Preparing · 00:${remaining.toString().padStart(2,"0")} remaining`} now={now} />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-8 px-10 grid grid-cols-[1fr_1fr]">
        <div className="relative flex flex-col items-center justify-center">
          <div className="relative">
            <ProgressRing pct={progress} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Ready in</div>
              <div className="font-display text-6xl font-light mt-1 leading-none tabular-nums">
                {remaining}<span className="text-2xl text-muted-foreground">s</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-accent mt-2">{Math.round(progress * 100)}% complete</div>
            </div>
          </div>
          <div className="mt-6 text-center">
            <div className="font-display text-2xl">{title}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground mt-1">Station 04 · Crystal coupe</div>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="relative h-[200px] rounded-2xl overflow-hidden surface-card">
            <img src={robotHero} alt="" className="absolute inset-0 w-full h-full object-cover scale-110" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-tr from-background/70 via-transparent to-background/40" />
            <div className="absolute top-3 left-3 text-[10px] uppercase tracking-[0.3em] text-accent flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> Live · Arm 02
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>Torque {(10 + progress * 5).toFixed(1)} Nm</span>
              <span>Temp −{(2 + progress * 2).toFixed(1)}°C</span>
              <span>Cycle {Math.min(4, stepIndex + 1)} / 04</span>
            </div>
          </div>

          <div className="mt-5 flex-1 flex flex-col gap-2">
            {steps.map(([n,t], i) => {
              const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "queued";
              return (
                <div key={n} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${state === "active" ? "surface-card" : ""}`}>
                  <span className={`font-mono text-[10px] ${state === "done" ? "text-accent" : state === "active" ? "text-foreground" : "text-muted-foreground/60"}`}>{n}</span>
                  <span className={`flex-1 text-sm ${state === "queued" ? "text-muted-foreground/60" : ""}`}>{t}</span>
                  <span className={`text-[10px] uppercase tracking-widest ${state === "active" ? "text-accent" : "text-muted-foreground"}`}>
                    {state === "done" ? "Complete" : state === "active" ? "In progress" : "Queued"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Ready({ selected, mode, now, go }: Ctx) {
  const title = mode === "signature" ? selected.name : "Custom №14";
  const orderNo = useMemo(() => 2400 + Math.floor(Math.random() * 99), []);
  return (
    <div className="absolute inset-0">
      <StatusBar title="Ready" now={now} />
      <img src={readyHero} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/30" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="relative h-full flex flex-col justify-center px-16 max-w-[60%] z-10">
        <div className="text-[10px] uppercase tracking-[0.4em] text-accent mb-5">Order №{orderNo} · Complete</div>
        <h1 className="font-display text-[64px] leading-[0.95] font-light tracking-tight">
          Your drink is <em className="italic font-normal gold-text">ready.</em>
        </h1>
        <p className="mt-5 text-muted-foreground text-[15px] leading-relaxed max-w-md">
          Please collect your {title} from the serving window on your right.
          Mind the chilled glass — it is at −4°C.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <div className="glass-card rounded-2xl px-5 py-3">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Window</div>
            <div className="font-display text-xl">B · 04</div>
          </div>
          <div className="glass-card rounded-2xl px-5 py-3">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Receipt</div>
            <div className="font-display text-xl">{orderNo}</div>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <GoldButton onClick={() => go("welcome")}>Order Another →</GoldButton>
          <GoldButton variant="ghost">Email Receipt</GoldButton>
        </div>

        <div className="mt-8 text-[11px] uppercase tracking-[0.3em] text-muted-foreground/80">Thank you — enjoy your evening.</div>
      </div>
    </div>
  );
}
