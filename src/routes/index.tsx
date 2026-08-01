import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  Droplets,
  FlaskConical,
  GlassWater,
  Martini,
  Minus,
  Plus,
  PowerOff,
  ShieldCheck,
  Snowflake,
  Sparkles,
} from "lucide-react";
import readyHero from "@/assets/cocktail-ready.png";
import customBuild from "@/assets/custom-drink.png";
import defaultDrink from "@/assets/default-drink.png";


import { getMenu, placeOrder, placeCustomOrder, getPumps } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: KioskApp,
});

type ScreenKey =
  | "welcome" | "experience" | "catalog" | "detail"
  | "compose" | "review" | "waiting_glass" | "preparing" | "ready" | "error" | "cleaning" | "cleaning_done";

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
  const [wantsIce, setWantsIce] = useState(false);
  const [now, setNow] = useState(new Date());

  // SSE State
  const [machineStatus, setMachineStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [glassState, setGlassState] = useState("unknown");
  const [poweredOn, setPoweredOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lowerSensor, setLowerSensor] = useState<number | null>(null);
  const [upperSensor, setUpperSensor] = useState<number | null>(null);
  const [requiredGlass, setRequiredGlass] = useState<string | null>(null);
  const [orderVolumeMl, setOrderVolumeMl] = useState<number | null>(null);
  const [reserveMarginMl, setReserveMarginMl] = useState(15);
  const [showPrices, setShowPrices] = useState(false);
  // Tracks the firmware's explicit CLEAN sequence.
  const inCleanCycle = useRef(false);

  // Load menu and the currently configured custom-drink ingredients once.
  // Reloading this data on every screen transition used to overwrite a mix
  // while the customer moved from Compose to Review.
  useEffect(() => {
    getMenu().then(data => {
      setDrinks(data.drinks);
      setShowPrices(Boolean(data.show_prices));
    }).catch(console.error);
    getPumps().then(data => {
      const active = data.pumps.filter((p: any) => p.ingredient_id !== null && Boolean(p.is_active));
      setAvailablePumps(active);
      setReserveMarginMl(Number(data.reserve_margin_ml ?? 15));
    }).catch(console.error);
  }, []);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // SSE Connection
  useEffect(() => {
    const evtSource = new EventSource(`http://${window.location.hostname}:5000/stream`);

    const syncScreenWithMachine = (status: string, statusMessage = "", initial = false) => {
      if (status === "waiting_glass") {
        inCleanCycle.current = false;
        setScreen("waiting_glass");
      } else if (["initializing", "dispensing", "pouring"].includes(status)) {
        setScreen("preparing");
      } else if (status === "mixing") {
        // Mixing is used both during drink-making and the firmware's CLEAN cycle.
        const cleaning = inCleanCycle.current || statusMessage.toLowerCase().includes("clean");
        inCleanCycle.current = cleaning;
        setScreen(cleaning ? "cleaning" : "preparing");
      } else if (status === "done") {
        inCleanCycle.current = false;
        setScreen("ready");
      } else if (status === "error") {
        setScreen("error");
      } else if (["reversing", "washing", "draining", "resealing"].includes(status)) {
        inCleanCycle.current = true;
        setScreen("cleaning");
      } else if (status === "idle") {
        if (initial) {
          // A newly connected kiosk should simply start at welcome when the
          // controller is already idle; it did not observe this clean cycle.
          inCleanCycle.current = false;
          setScreen("welcome");
        } else if (inCleanCycle.current) {
          // Show a "cleaning done" confirmation before returning to welcome.
          inCleanCycle.current = false;
          setScreen("cleaning_done");
        } else {
          setScreen(prev =>
            ["ready", "error", "preparing", "waiting_glass"].includes(prev) ? "welcome" : prev
          );
        }
      }
    };

    evtSource.addEventListener("init", (e) => {
      const data = JSON.parse(e.data);
      setMachineStatus(data.machine_status);
      setPoweredOn(Boolean(data.powered_on));
      setConnected(Boolean(data.connected));
      setProgress(data.progress || 0);
      setMessage(data.message || "");
      setGlassState(data.glass_state);
      if ("lower_sensor" in data) setLowerSensor(data.lower_sensor ?? null);
      if ("upper_sensor" in data) setUpperSensor(data.upper_sensor ?? null);
      if ("required_glass" in data) setRequiredGlass(data.required_glass ?? null);
      if ("order_volume_ml" in data) setOrderVolumeMl(data.order_volume_ml ?? null);
      syncScreenWithMachine(data.machine_status, data.message || "", true);
    });

    evtSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      const status = data.machine_status;
      setMachineStatus(status);
      if ("powered_on" in data) setPoweredOn(Boolean(data.powered_on));
      if (typeof data.connected === "boolean") setConnected(data.connected);
      setProgress(data.progress || 0);
      setMessage(data.message || "");
      if ("required_glass" in data) setRequiredGlass(data.required_glass ?? null);
      if ("order_volume_ml" in data) setOrderVolumeMl(data.order_volume_ml ?? null);
      syncScreenWithMachine(status, data.message || "");
    });

    evtSource.addEventListener("inventory", (e) => {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.pumps)) {
        setAvailablePumps(data.pumps.filter((pump: any) => pump.ingredient_id !== null && Boolean(pump.is_active)));
      }
      if (Number.isFinite(data.reserve_margin_ml)) setReserveMarginMl(data.reserve_margin_ml);
      getMenu().then(menu => {
        setDrinks(menu.drinks);
        setShowPrices(Boolean(menu.show_prices));
      }).catch(console.error);
    });

    evtSource.addEventListener("display_settings", (e) => {
      const data = JSON.parse(e.data);
      setShowPrices(Boolean(data.show_prices));
      getMenu().then(menu => setDrinks(menu.drinks)).catch(console.error);
    });


    evtSource.addEventListener("power", (e) => {
      const data = JSON.parse(e.data);
      setPoweredOn(Boolean(data.powered_on));
      if (!data.powered_on) {
        setScreen("welcome");
      }
    });
    evtSource.addEventListener("sensor", (e) => {
      const data = JSON.parse(e.data);
      setGlassState(data.glass_state);
      if ("lower_sensor" in data) setLowerSensor(data.lower_sensor ?? null);
      if ("upper_sensor" in data) setUpperSensor(data.upper_sensor ?? null);
    });

    evtSource.onerror = () => {
      setConnected(false);
    };

    return () => evtSource.close();
  }, []);

  const stationReady = poweredOn && connected;

  // Auto-navigate from cleaning_done back to welcome after 4 seconds
  useEffect(() => {
    if (screen === "cleaning_done") {
      const t = setTimeout(() => setScreen("welcome"), 4000);
      return () => clearTimeout(t);
    }
  }, [screen]);

  const selected = useMemo(
    () => drinks.find(d => d.id === selectedId) || drinks[0],
    [selectedId, drinks]
  );

  const scale = useKioskScale();
  const go = (s: ScreenKey) => setScreen(s);

  const [orderError, setOrderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOrder = async () => {
    if (!stationReady || machineStatus !== "idle" || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (mode === "signature") {
        if (!selected) return;
        await placeOrder(selected.id, wantsIce);
      } else {
        if (customIngredients.length === 0) return;
        const payload = customIngredients.map(i => ({ id: i.ingredient_id, name: i.name, amount_ml: i.amount_ml }));
        await placeCustomOrder(payload, wantsIce);
      }
      // Screen will change via SSE when status becomes waiting_glass or dispensing
    } catch (e: any) {
      setOrderError(e.message || "An unknown error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalMl = mode === "custom" 
    ? customIngredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0)
    : selected?.ingredients?.reduce((sum: number, i: any) => sum + i.amount_ml, 0) || 0;

  const ctx = {
    selected, setSelectedId, mode, setMode, drinks, availablePumps,
    customIngredients, setCustomIngredients, wantsIce, setWantsIce,
    machineStatus, progress, message, glassState, lowerSensor, upperSensor, poweredOn,
    connected, stationReady, totalMl, requiredGlass, orderVolumeMl, reserveMarginMl, showPrices,
    now, go, handleOrder, isSubmitting, orderError, setOrderError
  };

  return (
    <main className="kiosk-stage">
      <div
        className="kiosk-frame cc-frame"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {!stationReady && <PoweredOff now={now} poweredOn={poweredOn} connected={connected} />}
        {stationReady && screen === "welcome" && <Welcome {...ctx} />}
        {stationReady && screen === "experience" && <Experience {...ctx} />}
        {stationReady && screen === "catalog" && <Catalog {...ctx} />}
        {stationReady && screen === "detail" && <Detail {...ctx} />}
        {stationReady && screen === "compose" && <Compose {...ctx} />}
        {stationReady && screen === "review" && <Review {...ctx} />}
        {stationReady && screen === "waiting_glass" && <WaitingGlass {...ctx} />}
        {stationReady && screen === "preparing" && <Preparing {...ctx} />}
        {stationReady && screen === "ready" && <Ready {...ctx} />}
        {stationReady && screen === "error" && <ErrorScreen now={now} message={message} />}
        {stationReady && screen === "cleaning" && <CleaningScreen now={now} progress={progress} message={message} />}
        {stationReady && screen === "cleaning_done" && <CleaningDone now={now} />}

        {/* Error Modal Overlay */}
        {orderError && (
          <div className="cc-dialog-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="order-error-title">
            <div className="cc-dialog">
              <div className="cc-dialog__icon"><AlertTriangle aria-hidden="true" size={38} /></div>
              <h3 id="order-error-title">Unable to place order</h3>
              <p>{orderError}</p>
              <GoldButton onClick={() => setOrderError(null)}>Dismiss</GoldButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   Shared atoms
   ============================================================ */

function StatusBar({ title, now, online = true }: { title: string; now: Date; online?: boolean }) {
  return (
    <header className="cc-header" aria-label={`${title} screen`}>
      <Logo />
      <div className="cc-status" aria-label={`Station 01 is ${online ? "online" : "offline"}`}>
        <span>Station 01</span>
        <i aria-hidden="true" />
        <span className={online ? "cc-status__state" : "cc-status__state cc-status__state--offline"}>
          <Circle size={10} fill="currentColor" aria-hidden="true" />
          {online ? "Online" : "Offline"}
        </span>
        <i aria-hidden="true" />
        <time>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="cc-logo" aria-label="Cocktail Craft">
      <span className="cc-logo__mark"><Martini size={29} strokeWidth={2.2} aria-hidden="true" /></span>
      <span>Cocktail Craft</span>
    </div>
  );
}

function GoldButton({ children, onClick, big = false, variant = "primary", disabled }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`cc-button cc-button--${variant} ${big ? "cc-button--large" : ""}`}
    >
      {children}
    </button>
  );
}

function BackChip({ onClick, label = "Back" }: any) {
  return (
    <button type="button" onClick={onClick} className="cc-back">
      <ArrowLeft size={22} aria-hidden="true" />
      {label}
    </button>
  );
}

/* ============================================================
   Screens
   ============================================================ */

function PoweredOff({ now, poweredOn, connected }: any) {
  const unavailable = !poweredOn;
  const heading = unavailable
    ? "Machine is offline"
    : "Controller is unavailable";
  const description = unavailable
    ? "Please ask a member of staff for assistance. Orders will be available once the station is powered on."
    : "The station cannot communicate with its controller. Please ask a member of staff for assistance.";

  return (
    <div className="cc-screen cc-unavailable">
      <StatusBar title="Machine unavailable" now={now} online={false} />
      <div className="cc-state-card cc-state-card--warning">
        <div className="cc-state-card__icon"><PowerOff size={44} aria-hidden="true" /></div>
        <p className="cc-eyebrow">Station unavailable</p>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Welcome({ now, go }: any) {
  return (
    <div className="cc-screen cc-welcome">
      <StatusBar title="Welcome" now={now} />
      <div className="cc-welcome__glow" aria-hidden="true" />
      <section className="cc-welcome__copy">
        <p className="cc-eyebrow">Touchscreen cocktail station</p>
        <h1>Ready for<br />your next <span>drink?</span></h1>
        <p className="cc-welcome__intro">Choose a house classic or create a drink with the ingredients available at this station.</p>
        <GoldButton big onClick={() => go("experience")}>
          <Martini size={30} aria-hidden="true" />
          Start Order
          <ChevronRight size={26} aria-hidden="true" />
        </GoldButton>
      </section>
      <div className="cc-welcome__art" aria-hidden="true">
        <div className="cc-welcome__rear-card" />
        <figure className="cc-welcome__drink-card">
          <img src={readyHero} alt="" />
          <figcaption><Sparkles size={18} /> Cocktail Craft</figcaption>
        </figure>
      </div>
    </div>
  );
}

function Experience({ now, go, setMode, setCustomIngredients, setWantsIce }: any) {
  const choose = (m: string) => {
    setMode(m);
    setWantsIce(false);
    if (m === "custom") setCustomIngredients([]);
    go(m === "signature" ? "catalog" : "compose");
  };
  return (
    <div className="cc-screen cc-experience">
      <StatusBar title="Choose Experience" now={now} />
      <BackChip onClick={() => go("welcome")} label="Home" />
      <div className="cc-experience__heading">
        <p className="cc-eyebrow">Choose your experience</p>
        <h1>How would you like to <span>order?</span></h1>
        <p>Choose one option to continue.</p>
      </div>
      <div className="cc-experience__cards">
        <button type="button" onClick={() => choose("signature")} className="cc-experience-card">
          <div className="cc-experience-card__visual cc-experience-card__visual--classic"><img src={defaultDrink} alt="" /></div>
          <div className="cc-experience-card__body">
            <span className="cc-card-icon"><Sparkles size={25} /></span>
            <h2>House Classics</h2>
            <p>Browse signature cocktails</p>
            <span className="cc-select-label">Select <ChevronRight size={24} /></span>
          </div>
        </button>
        <button type="button" onClick={() => choose("custom")} className="cc-experience-card">
          <div className="cc-experience-card__visual cc-experience-card__visual--custom"><img src={customBuild} alt="" /></div>
          <div className="cc-experience-card__body">
            <span className="cc-card-icon"><Sparkles size={25} /></span>
            <h2>Build Your Own</h2>
            <p>Create a custom mix</p>
            <span className="cc-select-label">Select <ChevronRight size={24} /></span>
          </div>
        </button>
      </div>
    </div>
  );
}

function categoryLabel(category: string) {
  return category.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function drinkImageUrl(imageUrl?: string) {
  return imageUrl ? `http://localhost:5000${imageUrl}` : undefined;
}

function Catalog({ now, go, setSelectedId, drinks, showPrices }: any) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [page, setPage] = useState(0);
  const categories = useMemo(
    () => Array.from(new Set(drinks.map((drink: any) => String(drink.category || "classic")))).sort(),
    [drinks],
  );
  const filteredDrinks = useMemo(
    () => activeCategory === "all" ? drinks : drinks.filter((drink: any) => String(drink.category || "classic") === activeCategory),
    [activeCategory, drinks],
  );
  const pageCount = Math.max(1, Math.ceil(filteredDrinks.length / 4));
  const visibleDrinks = filteredDrinks.slice(page * 4, page * 4 + 4);

  useEffect(() => setPage(0), [activeCategory]);
  useEffect(() => setPage(current => Math.min(current, pageCount - 1)), [pageCount]);

  return (
    <div className="cc-screen cc-catalog">
      <StatusBar title="House Classics" now={now} />
      <BackChip onClick={() => go("welcome")} label="Home" />
      <div className="cc-catalog__top">
        <div>
          <p className="cc-eyebrow">Cocktail menu</p>
          <h1>House Classics</h1>
          <p>Tap a drink to continue.</p>
        </div>
        <div className="cc-filters" aria-label="Drink categories">
          <button type="button" className={activeCategory === "all" ? "is-active" : ""} onClick={() => setActiveCategory("all")}>All</button>
          {categories.map((category: string) => (
            <button type="button" key={category} className={activeCategory === category ? "is-active" : ""} onClick={() => setActiveCategory(category)}>
              {categoryLabel(category)}
            </button>
          ))}
        </div>
      </div>
      <div className="cc-drink-grid">
        {visibleDrinks.map((drink: any) => (
          <button
            type="button"
            key={drink.id}
            onClick={() => { setSelectedId(drink.id); go("detail"); }}
            className={`cc-drink-card ${!drink.available ? "cc-drink-card--unavailable" : ""}`}
            disabled={!drink.available}
          >
            <div className="cc-drink-card__image">
              {drinkImageUrl(drink.image_url) ? <img src={drinkImageUrl(drink.image_url)} alt={drink.name} /> : <Martini size={88} strokeWidth={1.1} aria-hidden="true" />}
            </div>
            <div className="cc-drink-card__content">
              <h2>{drink.name}</h2>
              <p>{drink.description || categoryLabel(drink.category || "classic")}</p>
              <div>{showPrices && <strong>€{Number(drink.price || 0).toFixed(2)}</strong>}<span>View <ChevronRight size={18} /></span></div>
              {!drink.available && <small>{drink.availability_reason || "Ingredients unavailable"}</small>}
            </div>
          </button>
        ))}
        {visibleDrinks.length === 0 && <div className="cc-empty-menu">No drinks are available in this category.</div>}
      </div>
      <div className="cc-pagination" aria-label="Menu pagination">
        <button type="button" aria-label="Previous drinks" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}><ArrowLeft size={24} /></button>
        <div>{Array.from({ length: pageCount }, (_, index) => <i key={index} className={index === page ? "is-active" : ""} />)}</div>
        <button type="button" aria-label="Next drinks" disabled={page === pageCount - 1} onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}><ArrowRight size={24} /></button>
      </div>
    </div>
  );
}

function Detail({ selected, now, go, wantsIce, setWantsIce, showPrices }: any) {
  if (!selected) return null;
  return (
    <div className="cc-screen cc-detail">
      <StatusBar title={selected.name} now={now} />
      <BackChip onClick={() => go("catalog")} />
      <div className="cc-detail__visual">
        <div className="cc-detail__image">
          {drinkImageUrl(selected.image_url) ? <img src={drinkImageUrl(selected.image_url)} alt={selected.name} /> : <Martini size={210} strokeWidth={1.1} aria-hidden="true" />}
        </div>
      </div>
      <section className="cc-detail__content">
        <p className="cc-eyebrow">House classic</p>
        <h1>{selected.name}</h1>
        <p className="cc-detail__description">{selected.description || "A carefully balanced house favourite."}</p>
        {showPrices && <p className="cc-price">€{Number(selected.price || 0).toFixed(2)}</p>}
        <div className="cc-ingredient-section">
          <p>Ingredients</p>
          <div className="cc-ingredient-grid">
            {selected.ingredients.map((ingredient: any) => (
              <div key={ingredient.id} className="cc-ingredient">
                <Droplets size={21} aria-hidden="true" />
                <span>{ingredient.name}</span>
                <small>{ingredient.amount_ml} ml</small>
              </div>
            ))}
          </div>
        </div>
        <fieldset className="cc-ice-choice">
          <legend>Ice</legend>
          <button type="button" className={!wantsIce ? "is-selected" : ""} onClick={() => setWantsIce(false)}><Snowflake size={24} /> No Ice</button>
          <button type="button" className={wantsIce ? "is-selected" : ""} onClick={() => setWantsIce(true)}><Snowflake size={24} /> Add Ice</button>
        </fieldset>
        {!selected.available && <p className="cc-detail__description">{selected.availability_reason || "One or more ingredients are unavailable."}</p>}
        <GoldButton big onClick={() => go("review")} disabled={!selected.available}>
          <Martini size={28} /> Add to Order
        </GoldButton>
      </section>
    </div>
  );
}

function Compose({ now, go, availablePumps, customIngredients, setCustomIngredients, reserveMarginMl }: any) {
  const totalMl = customIngredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0);
  const MAX_TOTAL = 300;
  const MAX_PER_ING = 100;

  const updateAmount = (idx: number, amount: number) => {
    if (amount < 0) amount = 0;
    if (amount > MAX_PER_ING) amount = MAX_PER_ING;

    const pump = availablePumps.find((item: any) => item.ingredient_id === customIngredients[idx].ingredient_id);
    if (pump) {
      const orderableMl = Math.max(0, Number(pump.current_volume_ml || 0) - reserveMarginMl);
      if (amount > orderableMl) amount = Math.floor(orderableMl / 5) * 5;
    }

    const newIngs = [...customIngredients];
    newIngs[idx].amount_ml = amount;
    setCustomIngredients(newIngs);
  };

  const addIngredient = (pump: any) => {
    if (customIngredients.length >= 6) return;
    if (customIngredients.find((i: any) => i.ingredient_id === pump.ingredient_id)) return;
    const orderableMl = Math.max(0, Number(pump.current_volume_ml || 0) - reserveMarginMl);
    const initialAmount = Math.min(25, Math.floor(orderableMl / 5) * 5);
    if (initialAmount < 5) return;
    setCustomIngredients([...customIngredients, { ingredient_id: pump.ingredient_id, name: pump.ingredient_name, amount_ml: initialAmount }]);
  };

  const removeIngredient = (idx: number) => {
    setCustomIngredients(customIngredients.filter((_: any, i: number) => i !== idx));
  };

  const isOverLimit = totalMl > MAX_TOTAL;
  const isZero = totalMl === 0;
  const inventoryErrors = customIngredients.filter((ingredient: any) => {
    const pump = availablePumps.find((item: any) => item.ingredient_id === ingredient.ingredient_id);
    const orderableMl = pump ? Math.max(0, Number(pump.current_volume_ml || 0) - reserveMarginMl) : 0;
    return ingredient.amount_ml > orderableMl;
  });

  return (
    <div className="cc-screen cc-compose">
      <StatusBar title="Custom Creation" now={now} />
      <BackChip onClick={() => go("experience")} />
      <section className="cc-compose__main">
        <div className="cc-compose__heading"><div><p className="cc-eyebrow">Build your own</p><h1>Your recipe</h1></div><strong className={isOverLimit ? "is-over-limit" : ""}>{totalMl} / {MAX_TOTAL} ml</strong></div>
        <div className="cc-compose__selected">
          {customIngredients.map((ingredient: any, index: number) => (
            <div key={ingredient.ingredient_id} className="cc-compose-row">
              <span>{ingredient.name}</span>
              <div>
                <button type="button" aria-label={`Decrease ${ingredient.name}`} onClick={() => updateAmount(index, ingredient.amount_ml - 5)}><Minus size={20} /></button>
                <strong>{ingredient.amount_ml} ml</strong>
                <button type="button" aria-label={`Increase ${ingredient.name}`} onClick={() => updateAmount(index, ingredient.amount_ml + 5)}><Plus size={20} /></button>
                <button type="button" className="cc-remove" aria-label={`Remove ${ingredient.name}`} onClick={() => removeIngredient(index)}>×</button>
              </div>
            </div>
          ))}
          {customIngredients.length === 0 && <div className="cc-compose-empty"><FlaskConical size={30} /><span>Select ingredients below to start your mix.</span></div>}
        </div>
        <div className="cc-compose__available">
          <p>Available ingredients</p>
          <div>
            {availablePumps.map((pump: any) => {
              const isSelected = customIngredients.some((ingredient: any) => ingredient.ingredient_id === pump.ingredient_id);
              const orderableMl = Math.max(0, Number(pump.current_volume_ml || 0) - reserveMarginMl);
              return (
                <button type="button" key={pump.ingredient_id} onClick={() => addIngredient(pump)} disabled={isSelected || orderableMl < 5}>
                  {pump.ingredient_name} · {Number(orderableMl.toFixed(1))} ml available
                </button>
              );
            })}
            {availablePumps.length === 0 && <span className="cc-no-pumps">No active ingredients are configured. Ask staff for assistance.</span>}
          </div>
        </div>
      </section>
      <aside className="cc-compose__summary">
        <div><FlaskConical size={78} aria-hidden="true" /><p>Custom Mix</p><span>{customIngredients.length} ingredient{customIngredients.length === 1 ? "" : "s"} selected</span></div>
        {isOverLimit && <small>Total exceeds {MAX_TOTAL} ml</small>}
        {isZero && <small>Choose at least one ingredient</small>}
        {inventoryErrors.length > 0 && <small>One or more bottles no longer have enough tracked volume plus the {reserveMarginMl} ml reserve.</small>}
        <GoldButton big onClick={() => go("review")} disabled={isOverLimit || isZero || inventoryErrors.length > 0}>Review mix <ChevronRight size={24} /></GoldButton>
      </aside>
    </div>
  );
}

function Review({ selected, mode, customIngredients, wantsIce, now, go, handleOrder, isSubmitting, machineStatus, poweredOn, showPrices }: any) {
  const isCustom = mode === "custom";
  const title = isCustom ? "Custom Mix" : selected?.name;

  return (
    <div className="cc-screen cc-review">
      <StatusBar title="Confirm Order" now={now} />
      <BackChip onClick={() => go(isCustom ? "compose" : "detail")} label="Edit" />
      <div className="cc-review__panel">
        <div className="cc-review__visual">
          {!isCustom && drinkImageUrl(selected?.image_url) ? <img src={drinkImageUrl(selected.image_url)} alt={title} /> : <FlaskConical size={132} strokeWidth={1.1} aria-hidden="true" />}
        </div>
        <section className="cc-review__content">
          <p className="cc-eyebrow">Order confirmation</p>
          <h1>{title}</h1>
          <div className="cc-review__items">
            {isCustom ? (
              customIngredients.map((ingredient: any) => (
                <div key={ingredient.ingredient_id}>
                  <span>{ingredient.name}</span><strong>{ingredient.amount_ml} ml</strong>
                </div>
              ))
            ) : (
              selected?.ingredients.map((ingredient: any) => (
                <div key={ingredient.id}>
                  <span>{ingredient.name}</span><strong>{ingredient.amount_ml} ml</strong>
                </div>
              ))
            )}
          </div>
          <div className="cc-review__ice"><Snowflake size={22} /><span>Ice</span><strong>{wantsIce ? "Add Ice" : "No Ice"}</strong></div>
          {showPrices && <div className="cc-review__total"><span>Total</span><strong>{isCustom ? "—" : `€${Number(selected?.price || 0).toFixed(2)}`}</strong></div>}
          <GoldButton big onClick={handleOrder} disabled={!poweredOn || isSubmitting || machineStatus !== "idle"}>
            <Check size={26} /> {isSubmitting ? "Processing…" : "Confirm Order"}
          </GoldButton>
        </section>
      </div>
    </div>
  );
}

function WaitingGlass({ now, glassState, lowerSensor, upperSensor, totalMl, requiredGlass, orderVolumeMl, message }: any) {
  const drinkVolumeMl = Number.isFinite(orderVolumeMl) ? orderVolumeMl : totalMl;
  const requiresLarge = requiredGlass === "large";
  const raw = (value: number | null) => value === null ? "not read" : String(value);
  let title = `Please place a ${requiresLarge ? "LARGE " : ""}glass`;
  let subtitle = "under the dispenser nozzle";
  let ringClass = "is-waiting";

  if (glassState === "small_glass") {
    if (requiresLarge) {
      title = "Large Glass Required";
      subtitle = message || `This ${drinkVolumeMl} ml drink requires the large glass. Please replace it.`;
      ringClass = "is-sensor-error";
    } else {
      title = "Small Glass Detected";
      subtitle = "Starting order...";
      ringClass = "is-detected";
    }
  } else if (glassState === "large_glass") {
    title = "Large Glass Detected";
    subtitle = "Starting order...";
    ringClass = "is-detected";
  } else if (glassState === "sensor_error") {
    title = "IR Sensor Alignment Error";
    subtitle = "Please check the glass position and sensors";
    ringClass = "is-sensor-error";
  }
  const sensorText = `Raw IR — lower: ${raw(lowerSensor)} / upper: ${raw(upperSensor)}`;

  return (
    <div className="cc-screen cc-machine-state">
      <StatusBar title="Waiting for Glass" now={now} />
      <div className={`cc-machine-state__icon ${ringClass}`}>
        <GlassWater size={74} aria-hidden="true" />
      </div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <small>{sensorText}</small>
    </div>
  );
}

function Preparing({ selected, mode, progress, machineStatus, message, now }: any) {
  let title = "Preparing";
  if (machineStatus === "mixing") title = "Mixing your drink";
  if (machineStatus === "pouring") title = "Pouring into glass";

  const drinkName = mode === "signature" ? selected?.name : "Custom Mix";

  return (
    <div className="cc-screen cc-machine-state cc-preparing">
      <StatusBar title={title} now={now} />
      <div className="cc-progress-ring" style={{ "--progress": `${Math.max(0, Math.min(100, progress))}%` } as React.CSSProperties}>
        <div>{progress}%</div>
      </div>
      <h1>{drinkName}</h1>
      <p>{message || title}</p>
    </div>
  );
}

function Ready({ now }: any) {
  return (
    <div className="cc-screen cc-ready">
      <StatusBar title="Ready" now={now} />
      <img src={readyHero} alt="" className="cc-ready__image" />
      <div className="cc-ready__overlay" />
      <section>
        <p className="cc-eyebrow">Order complete</p>
        <h1>Your drink is <span>ready.</span></h1>
        <p>Enjoy your drink. Remove the glass to start cleaning.</p>
      </section>
    </div>
  );
}

function ErrorScreen({ now, message }: any) {
  return (
    <div className="cc-screen cc-machine-state cc-error-state">
      <StatusBar title="System Error" now={now} />
      <div className="cc-machine-state__icon"><AlertTriangle size={68} aria-hidden="true" /></div>
      <h1>Order unavailable</h1>
      <p>{message || "Please contact staff for assistance."}</p>
    </div>
  );
}

function CleaningScreen({ now, progress, message }: any) {
  return (
    <div className="cc-screen cc-machine-state cc-cleaning">
      <StatusBar title="Machine Maintenance" now={now} />
      <div className="cc-machine-state__icon"><Sparkles size={68} aria-hidden="true" /></div>
      <h1>Cleaning in progress</h1>
      <p>Please wait while the station is prepared for the next order.</p>
      <div className="cc-cleaning__bar"><i style={{ width: `${progress}%` }} /></div>
      <small>{message || "Rinsing systems…"}</small>
    </div>
  );
}

function CleaningDone({ now }: any) {
  return (
    <div className="cc-screen cc-machine-state cc-cleaning-done">
      <StatusBar title="All Clean" now={now} />
      <div className="cc-machine-state__icon"><Check size={74} aria-hidden="true" /></div>
      <h1>All clean</h1>
      <p>Machine ready for the next order.</p>
    </div>
  );
}
