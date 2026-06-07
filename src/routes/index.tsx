import { createFileRoute } from "@tanstack/react-router";
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
      { title: "ATRIA — Autonomous Bartender Kiosk UI Case Study" },
      { name: "description", content: "A premium enterprise-grade touchscreen kiosk interface for an autonomous bartender robot. Eight-screen product design case study." },
      { property: "og:title", content: "ATRIA — Autonomous Bartender Kiosk UI" },
      { property: "og:description", content: "Eight-screen product design case study for a luxury hospitality robot." },
    ],
  }),
  component: CaseStudy,
});

/* ---------- Shared atoms ---------- */

function StatusBar({ title }: { title: string }) {
  return (
    <div className="absolute top-0 inset-x-0 h-10 px-7 flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-muted-foreground/90 font-medium z-20">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_currentColor]" />
        <span>ATRIA · {title}</span>
      </div>
      <div className="flex items-center gap-5">
        <span>Station 04</span>
        <span>Online</span>
        <span>21:42</span>
      </div>
    </div>
  );
}

function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <div className={`flex items-center gap-2 ${size === "lg" ? "text-2xl" : "text-sm"}`}>
      <span className="brushed-gold w-5 h-5 rounded-full" />
      <span className="font-display tracking-[0.35em] uppercase">Atria</span>
    </div>
  );
}

function GoldButton({
  children,
  big = false,
  variant = "primary",
}: { children: React.ReactNode; big?: boolean; variant?: "primary" | "ghost" }) {
  if (variant === "ghost") {
    return (
      <div className={`inline-flex items-center justify-center gap-3 rounded-full border border-border-strong text-foreground/90 ${big ? "px-10 h-16 text-base" : "px-6 h-12 text-sm"} uppercase tracking-[0.22em]`}>
        {children}
      </div>
    );
  }
  return (
    <div className={`relative inline-flex items-center justify-center gap-3 rounded-full brushed-gold text-accent-foreground ${big ? "px-12 h-16 text-base" : "px-8 h-12 text-sm"} font-medium uppercase tracking-[0.22em] shadow-[0_8px_30px_-8px_oklch(0.83_0.09_85/40%)]`}>
      {children}
    </div>
  );
}

/* ---------- Screen 1: Welcome ---------- */

function Screen1() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Welcome" />
      <img src={robotHero} alt="" className="absolute inset-y-0 right-0 h-full w-[58%] object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
      <div className="absolute top-10 left-7"><Logo /></div>

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
          <GoldButton big>Start Experience →</GoldButton>
          <span className="text-xs text-muted-foreground tracking-widest uppercase">EN · FR · JP</span>
        </div>
      </div>

      <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
        <span className="h-px w-10 hairline" /> Touch anywhere to begin <span className="h-px w-10 hairline" />
      </div>
    </div>
  );
}

/* ---------- Screen 2: Choose Experience ---------- */

function ExperienceCard({
  title, sub, eyebrow, image, big,
}: { title: string; sub: string; eyebrow: string; image: string; big?: boolean }) {
  return (
    <div className="surface-card relative flex-1 rounded-3xl overflow-hidden h-full p-8 flex flex-col justify-between">
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
        <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{big ? "12 curated · refreshed weekly" : "Tailor every note"}</span>
        <span className="brushed-gold w-12 h-12 rounded-full flex items-center justify-center text-accent-foreground text-lg">→</span>
      </div>
    </div>
  );
}

function Screen2() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Choose Experience" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-10 px-12 flex flex-col">
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 01 of 04</div>
          <h2 className="font-display text-4xl mt-3 font-light">How would you like to be served tonight?</h2>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-6">
          <ExperienceCard
            eyebrow="The Library"
            title="Signature Cocktails"
            sub="Twelve recipes from our master mixologists, served with quiet precision."
            image={c2}
            big
          />
          <ExperienceCard
            eyebrow="The Studio"
            title="Create a Custom Drink"
            sub="Compose your own — base spirit, sweetness, garnish. Saved to your profile."
            image={c5}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 3: Catalog ---------- */

const drinks = [
  { name: "Old Fashioned", desc: "Bourbon, demerara, orange.",   img: c1, abv: 4, time: 75 },
  { name: "Negroni",       desc: "Gin, Campari, sweet vermouth.", img: c2, abv: 4, time: 65 },
  { name: "Dry Martini",   desc: "Gin, dry vermouth, lemon.",    img: c3, abv: 5, time: 55 },
  { name: "Margarita",     desc: "Tequila, lime, agave, salt.",  img: c4, abv: 3, time: 70 },
  { name: "Whiskey Sour",  desc: "Rye, lemon, sugar, egg white.", img: c5, abv: 3, time: 85 },
  { name: "Espresso Martini", desc: "Vodka, espresso, coffee liqueur.", img: c6, abv: 3, time: 80 },
];

function AbvDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= level ? "bg-accent" : "bg-foreground/15"}`} />
      ))}
    </div>
  );
}

function DrinkCard({ d }: { d: typeof drinks[number] }) {
  return (
    <div className="surface-card rounded-2xl overflow-hidden flex flex-col">
      <div className="relative h-[130px] overflow-hidden">
        <img src={d.img} alt="" className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
      </div>
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h4 className="font-display text-xl leading-none">{d.name}</h4>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{d.time}s</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug min-h-[28px]">{d.desc}</p>
        <div className="flex items-center justify-between pt-1">
          <AbvDots level={d.abv} />
          <span className="brushed-gold text-accent-foreground text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-full font-medium">Order</span>
        </div>
      </div>
    </div>
  );
}

function Screen3() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Signature Catalog" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-6 px-10 flex flex-col">
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.4em] text-accent">The Library</div>
            <h2 className="font-display text-3xl mt-2 font-light">Signature Cocktails</h2>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
            {["All","Classic","Citrus","Smoky","Sweet"].map((t,i) => (
              <span key={t} className={`px-4 py-2 rounded-full ${i===0 ? "brushed-gold text-accent-foreground font-medium" : "border border-border text-muted-foreground"}`}>{t}</span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 flex-1">
          {drinks.map(d => <DrinkCard key={d.name} d={d} />)}
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 4: Detail ---------- */

function Screen4() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Old Fashioned" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 grid grid-cols-[1.1fr_1fr]">
        <div className="relative">
          <img src={c1} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-background/40" />
          <div className="absolute bottom-6 left-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Est. 1880 · Louisville, KY</div>
        </div>

        <div className="px-10 py-6 flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">House Classic</div>
          <h2 className="font-display text-5xl font-light mt-2 leading-none">Old Fashioned</h2>
          <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">
            Bourbon stirred with demerara and aromatic bitters, expressed with
            orange oil. Spirit-forward, gently sweet.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 text-[11px]">
            <div className="glass-card rounded-xl px-4 py-3">
              <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Strength</div>
              <div className="mt-1 font-medium">Bold · 28% ABV</div>
            </div>
            <div className="glass-card rounded-xl px-4 py-3">
              <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Prep time</div>
              <div className="mt-1 font-medium">75 seconds</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Ingredients</div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {["Woodford Bourbon 60ml","Demerara 10ml","Angostura 2 dash","Orange peel"].map(i =>
                <span key={i} className="px-3 py-1.5 rounded-full border border-border text-foreground/90">{i}</span>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Flavor profile</div>
            <div className="space-y-1.5">
              {[["Sweet",30],["Bitter",60],["Smoky",45]].map(([k,v]) => (
                <div key={k as string} className="flex items-center gap-3 text-[11px]">
                  <span className="w-14 text-muted-foreground">{k}</span>
                  <span className="flex-1 h-[3px] bg-foreground/10 rounded-full overflow-hidden">
                    <span className="block h-full brushed-gold" style={{ width: `${v}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between pt-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Price</div>
              <div className="font-display text-3xl font-light">€18<span className="text-base text-muted-foreground">.00</span></div>
            </div>
            <GoldButton>Prepare Drink →</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 5: Custom Builder ---------- */

function Segmented({ label, options, active }: { label: string; options: string[]; active: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</span>
      </div>
      <div className="flex bg-surface rounded-full p-1 border border-border">
        {options.map((o, i) => (
          <span key={o} className={`flex-1 text-center py-2 rounded-full text-[11px] uppercase tracking-[0.18em] ${i===active ? "brushed-gold text-accent-foreground font-medium" : "text-muted-foreground"}`}>{o}</span>
        ))}
      </div>
    </div>
  );
}

function Screen5() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Compose · The Studio" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-6 px-10 grid grid-cols-[1fr_320px] gap-8">
        <div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 02 of 04</div>
          <h2 className="font-display text-3xl font-light mt-1">Compose your drink</h2>

          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">Base Spirit</div>
            <div className="grid grid-cols-4 gap-3">
              {[
                ["Gin","Botanical"],
                ["Bourbon","Toasted oak"],
                ["Vodka","Neutral"],
                ["Tequila","Agave"],
              ].map(([n,t], i) => (
                <div key={n} className={`surface-card rounded-2xl p-4 ${i===1 ? "ring-1 ring-accent" : ""}`}>
                  <div className={`w-7 h-7 rounded-full mb-3 ${i===1 ? "brushed-gold" : "bg-surface-3"}`} />
                  <div className="font-display text-lg leading-none">{n}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{t}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <Segmented label="Sweetness" options={["Dry","Med","Sweet"]} active={1} />
            <Segmented label="Strength"  options={["Light","Std","Bold"]} active={2} />
            <Segmented label="Ice"       options={["None","Cubes","Sphere"]} active={2} />
            <Segmented label="Garnish"   options={["Twist","Peel","Cherry"]} active={1} />
          </div>
        </div>

        <div className="glass-card rounded-3xl p-5 flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Live preview</div>
          <div className="relative flex-1 rounded-2xl overflow-hidden mt-3 bg-surface">
            <img src={c1} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/70 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <div className="font-display text-xl">Custom №14</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Bourbon · Medium · Bold</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Est. 80s</span>
            <span className="font-display text-2xl">€16</span>
          </div>
          <div className="mt-3 flex justify-center">
            <GoldButton>Review Order →</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 6: Review ---------- */

function Screen6() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Confirm Order" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-8 px-12 grid grid-cols-[360px_1fr] gap-10">
        <div className="relative rounded-3xl overflow-hidden surface-card">
          <img src={c3} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
          <div className="absolute bottom-5 left-5 right-5">
            <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Your selection</div>
            <div className="font-display text-3xl font-light mt-1">Dry Martini</div>
            <div className="text-[11px] text-muted-foreground">Reimagined for you</div>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.4em] text-accent">Step 04 of 04</div>
          <h2 className="font-display text-4xl font-light mt-1">Review your order</h2>

          <div className="mt-6 divide-y divide-border">
            {[
              ["Base spirit","Tanqueray No. Ten"],
              ["Vermouth","Dolin Dry · 15ml"],
              ["Garnish","Lemon twist"],
              ["Temperature","Stirred · −4°C"],
              ["Glassware","Crystal coupe"],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between py-3 text-sm">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px] mt-1">{k}</span>
                <span className="text-foreground font-medium">{v}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-end justify-between pt-6 border-t border-border-strong/40">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total · Prep time 65s</div>
              <div className="font-display text-4xl font-light mt-1">€19<span className="text-lg text-muted-foreground">.50</span></div>
            </div>
            <div className="flex items-center gap-3">
              <GoldButton variant="ghost">Edit</GoldButton>
              <GoldButton big>Confirm & Prepare →</GoldButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 7: Preparation ---------- */

function ProgressRing() {
  const r = 92;
  const c = 2 * Math.PI * r;
  const pct = 0.62;
  return (
    <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
      <circle cx="110" cy="110" r={r} stroke="oklch(1 0 0 / 8%)" strokeWidth="3" fill="none" />
      <circle
        cx="110" cy="110" r={r}
        stroke="url(#gold)" strokeWidth="3" fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
      <defs>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.08 85)" />
          <stop offset="100%" stopColor="oklch(0.92 0.09 88)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Screen7() {
  const steps = [
    ["01","Chilling glass","Complete"],
    ["02","Measuring base spirit","Complete"],
    ["03","Stirring · 18 rotations","In progress"],
    ["04","Garnish & serve","Queued"],
  ];
  return (
    <div className="kiosk-frame">
      <StatusBar title="Preparing · 00:38 remaining" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="h-full pt-20 pb-8 px-10 grid grid-cols-[1fr_1fr]">
        <div className="relative flex flex-col items-center justify-center">
          <div className="relative">
            <ProgressRing />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Ready in</div>
              <div className="font-display text-6xl font-light mt-1 leading-none">38<span className="text-2xl text-muted-foreground">s</span></div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-accent mt-2">62% complete</div>
            </div>
          </div>
          <div className="mt-6 text-center">
            <div className="font-display text-2xl">Dry Martini</div>
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
              <span>Torque 12.4 Nm</span>
              <span>Temp −3.8°C</span>
              <span>Cycle 03 / 04</span>
            </div>
          </div>

          <div className="mt-5 flex-1 flex flex-col gap-2">
            {steps.map(([n,t,s], i) => (
              <div key={n} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${i===2 ? "surface-card" : ""}`}>
                <span className={`font-mono text-[10px] ${i<2 ? "text-accent" : i===2 ? "text-foreground" : "text-muted-foreground/60"}`}>{n}</span>
                <span className={`flex-1 text-sm ${i>2 ? "text-muted-foreground/60" : ""}`}>{t}</span>
                <span className={`text-[10px] uppercase tracking-widest ${i===2 ? "text-accent" : "text-muted-foreground"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Screen 8: Ready ---------- */

function Screen8() {
  return (
    <div className="kiosk-frame">
      <StatusBar title="Ready" />
      <img src={readyHero} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/30" />
      <div className="absolute top-10 left-7"><Logo /></div>

      <div className="relative h-full flex flex-col justify-center px-16 max-w-[60%] z-10">
        <div className="text-[10px] uppercase tracking-[0.4em] text-accent mb-5">Order №2418 · Complete</div>
        <h1 className="font-display text-[64px] leading-[0.95] font-light tracking-tight">
          Your drink is <em className="italic font-normal gold-text">ready.</em>
        </h1>
        <p className="mt-5 text-muted-foreground text-[15px] leading-relaxed max-w-md">
          Please collect your Dry Martini from the serving window on your right.
          Mind the chilled glass — it is at −4°C.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <div className="glass-card rounded-2xl px-5 py-3">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Window</div>
            <div className="font-display text-xl">B · 04</div>
          </div>
          <div className="glass-card rounded-2xl px-5 py-3">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Receipt</div>
            <div className="font-display text-xl">2418</div>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <GoldButton>Order Another →</GoldButton>
          <GoldButton variant="ghost">Email Receipt</GoldButton>
        </div>

        <div className="mt-8 text-[11px] uppercase tracking-[0.3em] text-muted-foreground/80">Thank you — enjoy your evening.</div>
      </div>
    </div>
  );
}

/* ---------- Presentation Board ---------- */

function ScreenLabel({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-5 px-1">
      <span className="font-mono text-[11px] text-page-foreground/40 tracking-widest">{n}</span>
      <span className="font-display text-2xl tracking-tight">{title}</span>
      <span className="text-[11px] uppercase tracking-[0.28em] text-page-foreground/40">{sub}</span>
      <span className="flex-1 h-px bg-page-foreground/10 ml-2" />
    </div>
  );
}

function CaseStudy() {
  const screens = [
    { c: <Screen1 />, n: "01", t: "Welcome",           s: "Hero · Attract loop" },
    { c: <Screen2 />, n: "02", t: "Choose Experience", s: "Signature or custom" },
    { c: <Screen3 />, n: "03", t: "Catalog",           s: "Browse · Filter" },
    { c: <Screen4 />, n: "04", t: "Detail",            s: "Recipe · Profile" },
    { c: <Screen5 />, n: "05", t: "Compose",           s: "Custom drink builder" },
    { c: <Screen6 />, n: "06", t: "Review",            s: "Confirmation summary" },
    { c: <Screen7 />, n: "07", t: "Preparation",       s: "Live robot status" },
    { c: <Screen8 />, n: "08", t: "Ready",             s: "Pickup · Thank you" },
  ];

  return (
    <main className="min-h-screen bg-page text-page-foreground">
      {/* Cover */}
      <section className="max-w-[1240px] mx-auto px-10 pt-24 pb-16">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.32em] text-page-foreground/50">
          <span>Case Study · 2026</span>
          <span>Hospitality Robotics · Touchscreen UI</span>
        </div>
        <h1 className="mt-10 font-display text-[112px] leading-[0.9] font-light tracking-tight">
          ATRIA<br />
          <em className="italic gold-text font-normal">Autonomous Bartender.</em>
        </h1>
        <div className="mt-10 grid grid-cols-3 gap-10 text-[13px] text-page-foreground/70 max-w-4xl leading-relaxed">
          <p>
            A premium kiosk interface for a robotic mixologist deployed in luxury
            hotels, members' clubs, and first-class lounges.
          </p>
          <p>
            7-inch landscape · 1024 × 600 · capacitive multi-touch. Designed for
            single-handed use, glove-friendly targets, and ambient bar lighting.
          </p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-6 self-start">
            <span className="text-page-foreground/40 uppercase tracking-widest text-[10px]">Platform</span><span>Embedded Linux</span>
            <span className="text-page-foreground/40 uppercase tracking-widest text-[10px]">Surface</span><span>Anti-glare AG3</span>
            <span className="text-page-foreground/40 uppercase tracking-widest text-[10px]">Touch</span><span>Min 56pt</span>
            <span className="text-page-foreground/40 uppercase tracking-widest text-[10px]">Type</span><span>Cormorant · Inter Tight</span>
          </div>
        </div>
      </section>

      {/* Design tokens strip */}
      <section className="max-w-[1240px] mx-auto px-10 pb-20">
        <ScreenLabel n="00" title="Design system" sub="Tokens · Surface · Accent" />
        <div className="grid grid-cols-6 gap-3">
          {[
            ["#0F0F0E","Matte Black","Background"],
            ["#1F1F1D","Graphite","Surface"],
            ["#2B2B28","Charcoal","Surface 2"],
            ["#D8B981","Champagne","Accent"],
            ["#F1E9D7","Vellum","Foreground"],
            ["#7A7A75","Stone","Muted"],
          ].map(([hex,name,role]) => (
            <div key={name as string} className="rounded-xl overflow-hidden border border-page-foreground/10">
              <div className="h-20" style={{ background: hex as string }} />
              <div className="p-3 bg-black/40">
                <div className="text-sm font-medium">{name}</div>
                <div className="text-[10px] uppercase tracking-widest text-page-foreground/40">{role}</div>
                <div className="font-mono text-[10px] mt-1 text-page-foreground/40">{hex}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Screens grid: 1 big + pairs */}
      <section className="max-w-[1240px] mx-auto px-10 pb-32 space-y-20">
        {screens.map(s => (
          <div key={s.n}>
            <ScreenLabel n={s.n} title={s.t} sub={s.s} />
            <div className="relative">
              <div className="absolute -inset-8 bg-gradient-to-b from-page-foreground/0 to-page-foreground/0" />
              <div className="relative w-full overflow-hidden rounded-[32px] flex items-center justify-center bg-black/40 border border-page-foreground/5 p-8">
                <div className="origin-center" style={{ transform: "scale(1.02)" }}>
                  {s.c}
                </div>
              </div>
              <div className="flex justify-between mt-4 text-[10px] uppercase tracking-[0.3em] text-page-foreground/40 font-mono">
                <span>1024 × 600 px</span>
                <span>Screen {s.n} / 08</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <footer className="border-t border-page-foreground/10">
        <div className="max-w-[1240px] mx-auto px-10 py-10 flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-page-foreground/40">
          <span>ATRIA · Hospitality Robotics</span>
          <span>Product Design Case Study · 2026</span>
        </div>
      </footer>
    </main>
  );
}
