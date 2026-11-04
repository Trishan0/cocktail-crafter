import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  Info,
  Martini,
  Plus,
  PowerOff,
  RotateCcw,
  X,
} from "lucide-react";

import { getMenu, placeOrder, placeCustomOrder, getPumps, getGlassCapacityConfig } from "@/lib/api";
import {
  DISPENSE_BAY_PHOTO,
  FALLBACK_COLLAGE,
  HOUSE_BACKDROP,
  MACHINE_BACKDROP,
  MACHINE_PHOTO,
  drinkBackdrop,
  drinkImage,
  flavourLine,
  ingredientColor,
} from "@/lib/drinks";

export const Route = createFileRoute("/")({
  component: KioskApp,
});

type ScreenKey =
  | "welcome"
  | "catalog"
  | "detail"
  | "compose"
  | "waiting_glass"
  | "preparing"
  | "ready"
  | "error"
  | "cleaning"
  | "cleaning_done";

const MAX_TOTAL_ML = 300;
const MAX_PER_INGREDIENT_ML = 100;
const AMOUNT_PRESETS = [15, 30, 60, 100];
const DEFAULT_SMALL_GLASS_ML = 170;
// Used in "Your … is ready" copy when the kiosk did not see the order placed
// (e.g. it reloaded mid-order).
const UNKNOWN_DRINK_NAME = "drink";

// Browsing screens return to Welcome after this long without a touch, so a
// walked-away guest never leaves the kiosk parked mid-order.
const IDLE_TIMEOUT_MS = 60_000;
const BROWSING_SCREENS: ScreenKey[] = ["catalog", "detail", "compose"];

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
  const [smallGlassMaxMl, setSmallGlassMaxMl] = useState(DEFAULT_SMALL_GLASS_ML);
  // What the guest actually ordered, kept apart from the browsing selection.
  const [orderedName, setOrderedName] = useState(UNKNOWN_DRINK_NAME);
  const [orderPumps, setOrderPumps] = useState<any[]>([]);

  // SSE State
  const [machineStatus, setMachineStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [glassState, setGlassState] = useState("unknown");
  const [poweredOn, setPoweredOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [requiredGlass, setRequiredGlass] = useState<string | null>(null);
  const [orderVolumeMl, setOrderVolumeMl] = useState<number | null>(null);
  const [reserveMarginMl, setReserveMarginMl] = useState(15);
  const [showPrices, setShowPrices] = useState(false);
  // Tracks the firmware's explicit CLEAN sequence.
  const inCleanCycle = useRef(false);

  // Load menu and the currently configured custom-drink ingredients once.
  // Reloading this data on every screen transition used to overwrite a mix
  // while the customer was composing it.
  useEffect(() => {
    getMenu()
      .then((data) => {
        setDrinks(data.drinks);
        setShowPrices(Boolean(data.show_prices));
      })
      .catch(console.error);
    getPumps()
      .then((data) => {
        const active = data.pumps.filter(
          (p: any) => p.ingredient_id !== null && Boolean(p.is_active),
        );
        setAvailablePumps(active);
        setReserveMarginMl(Number(data.reserve_margin_ml ?? 15));
      })
      .catch(console.error);
    getGlassCapacityConfig()
      .then((data) => {
        const capacity = Number(data.small_glass_max_ml);
        if (Number.isFinite(capacity) && capacity > 0) setSmallGlassMaxMl(capacity);
      })
      .catch(console.error);
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
          setScreen((prev) =>
            ["ready", "error", "preparing", "waiting_glass"].includes(prev) ? "welcome" : prev,
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
        setAvailablePumps(
          data.pumps.filter((pump: any) => pump.ingredient_id !== null && Boolean(pump.is_active)),
        );
      }
      if (Number.isFinite(data.reserve_margin_ml)) setReserveMarginMl(data.reserve_margin_ml);
      getMenu()
        .then((menu) => {
          setDrinks(menu.drinks);
          setShowPrices(Boolean(menu.show_prices));
        })
        .catch(console.error);
    });

    evtSource.addEventListener("display_settings", (e) => {
      const data = JSON.parse(e.data);
      setShowPrices(Boolean(data.show_prices));
      getMenu()
        .then((menu) => setDrinks(menu.drinks))
        .catch(console.error);
    });

    evtSource.addEventListener("menu_updated", () => {
      getMenu()
        .then((menu) => {
          setDrinks(menu.drinks);
          setShowPrices(Boolean(menu.show_prices));
        })
        .catch(console.error);
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
    });

    evtSource.onerror = () => {
      setConnected(false);
    };

    return () => evtSource.close();
  }, []);

  const stationReady = poweredOn && connected;

  const [orderError, setOrderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startOver = () => {
    setScreen("welcome");
    setCustomIngredients([]);
    setWantsIce(false);
  };

  // Auto-navigate from cleaning_done back to welcome after 4 seconds
  useEffect(() => {
    if (screen === "cleaning_done") {
      const t = setTimeout(() => setScreen("welcome"), 4000);
      return () => clearTimeout(t);
    }
  }, [screen]);

  // Inactivity reset while browsing; any touch restarts the countdown.
  useEffect(() => {
    if (!BROWSING_SCREENS.includes(screen) || orderError || isSubmitting) return;
    let timer = setTimeout(startOver, IDLE_TIMEOUT_MS);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(startOver, IDLE_TIMEOUT_MS);
    };
    window.addEventListener("pointerdown", restart);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
    };
  }, [screen, orderError, isSubmitting]);

  const selected = useMemo(
    () => drinks.find((d) => d.id === selectedId) || drinks[0],
    [selectedId, drinks],
  );

  const scale = useKioskScale();
  const go = (s: ScreenKey) => setScreen(s);

  const handleOrder = async () => {
    if (!stationReady || machineStatus !== "idle" || isSubmitting) return;
    setIsSubmitting(true);
    try {
      let response;
      if (mode === "signature") {
        if (!selected) return;
        response = await placeOrder(selected.id, wantsIce);
        setOrderedName(selected.name);
      } else {
        if (customIngredients.length === 0) return;
        const payload = customIngredients.map((i) => ({
          id: i.ingredient_id,
          name: i.name,
          amount_ml: i.amount_ml,
        }));
        response = await placeCustomOrder(payload, wantsIce);
        setOrderedName("custom mix");
      }
      setOrderPumps(Array.isArray(response?.pump_commands) ? response.pump_commands : []);
      // Screen will change via SSE when status becomes waiting_glass or dispensing
    } catch (e: any) {
      setOrderError(e.message || "An unknown error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalMl =
    mode === "custom"
      ? customIngredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0)
      : selected?.ingredients?.reduce((sum: number, i: any) => sum + i.amount_ml, 0) || 0;

  const ctx = {
    selected,
    setSelectedId,
    mode,
    setMode,
    drinks,
    availablePumps,
    customIngredients,
    setCustomIngredients,
    wantsIce,
    setWantsIce,
    machineStatus,
    progress,
    message,
    glassState,
    totalMl,
    requiredGlass,
    orderVolumeMl,
    reserveMarginMl,
    showPrices,
    smallGlassMaxMl,
    orderedName,
    orderPumps,
    now,
    go,
    startOver,
    handleOrder,
    isSubmitting,
  };

  return (
    <main className="kiosk-stage">
      <div
        className="kiosk-frame cc-frame"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {!stationReady && <PoweredOff now={now} poweredOn={poweredOn} />}
        {stationReady && screen === "welcome" && <Welcome {...ctx} />}
        {stationReady && screen === "catalog" && <Catalog {...ctx} />}
        {stationReady && screen === "detail" && <Detail {...ctx} />}
        {stationReady && screen === "compose" && <Compose {...ctx} />}
        {stationReady && screen === "waiting_glass" && <WaitingGlass {...ctx} />}
        {stationReady && screen === "preparing" && <Preparing {...ctx} />}
        {stationReady && screen === "ready" && <Ready {...ctx} />}
        {stationReady && screen === "error" && (
          <ErrorScreen
            now={now}
            message={message}
            orderedName={orderedName}
            startOver={startOver}
          />
        )}
        {stationReady && screen === "cleaning" && <CleaningScreen now={now} progress={progress} />}
        {stationReady && screen === "cleaning_done" && <CleaningDone now={now} />}

        {orderError && (
          <div
            className="cc-dialog-backdrop"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="order-error-title"
          >
            <div className="cc-dialog">
              <span className="cc-dialog__icon">
                <AlertTriangle aria-hidden="true" size={28} />
              </span>
              <h3 id="order-error-title">We couldn’t start that drink</h3>
              <p>{orderError}</p>
              <button
                type="button"
                className="cc-button cc-button--primary"
                onClick={() => setOrderError(null)}
              >
                OK
              </button>
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

function formatTime(now: Date) {
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Logo() {
  return (
    <div className="cc-logo" aria-label="Cocktail Craft">
      <Martini size={20} strokeWidth={1.8} aria-hidden="true" />
      <span>Cocktail Craft</span>
    </div>
  );
}

function Header({ now, action }: { now: Date; action?: ReactNode }) {
  return (
    <header className="cc-header">
      <Logo />
      <div className="cc-header__end">
        {action}
        <time className="cc-time">{formatTime(now)}</time>
      </div>
    </header>
  );
}

function HeaderButton({ onClick, icon, children }: any) {
  return (
    <button type="button" className="cc-header-button" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

/** Real photography behind every screen instead of a flat colour. */
function Backdrop({ src, blur = false }: { src: string; blur?: boolean }) {
  return (
    <div
      className={`cc-backdrop ${blur ? "cc-backdrop--soften" : ""}`}
      style={{ backgroundImage: `url("${src}")` }}
      aria-hidden="true"
    />
  );
}

/** Edge-to-edge photo on the right of a screen; fades into the backdrop. */
function SidePhoto({
  src,
  alt = "",
  tone = "",
  children,
}: {
  src: string;
  alt?: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <figure className={`cc-side-photo ${tone}`}>
      <img src={src} alt={alt} />
      {children}
    </figure>
  );
}

const ORDER_STEPS = ["Place glass", "Mixing", "Enjoy"];

function OrderSteps({ current }: { current: number }) {
  return (
    <ol className="cc-steps" aria-label="Order progress">
      {ORDER_STEPS.map((label, index) => (
        <li
          key={label}
          className={index < current ? "is-done" : index === current ? "is-current" : ""}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="cc-steps__dot">
            {index < current ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function PrimaryButton({ children, onClick, disabled, className = "" }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`cc-button cc-button--primary ${className}`}
    >
      {children}
    </button>
  );
}

function IceChoice({ wantsIce, setWantsIce, compact = false }: any) {
  return (
    <fieldset className={`cc-ice ${compact ? "cc-ice--compact" : ""}`}>
      <legend>Ice</legend>
      <div>
        <button
          type="button"
          aria-pressed={!wantsIce}
          className={!wantsIce ? "is-selected" : ""}
          onClick={() => setWantsIce(false)}
        >
          {!compact && <GlassIcon size={22} />}
          No ice
        </button>
        <button
          type="button"
          aria-pressed={wantsIce}
          className={wantsIce ? "is-selected" : ""}
          onClick={() => setWantsIce(true)}
        >
          {!compact && <Box size={22} strokeWidth={1.8} aria-hidden="true" />}
          With ice
        </button>
      </div>
    </fieldset>
  );
}

function GlassIcon({ size = 22, tall = false }: { size?: number; tall?: boolean }) {
  return tall ? (
    <svg
      width={size * 0.75}
      height={size}
      viewBox="0 0 30 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h24l-2.5 33h-19z" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4h12l-1.5 16h-9z" />
    </svg>
  );
}

function DrinkPhoto({ drink, className = "" }: { drink: any; className?: string }) {
  const src = drinkImage(drink);
  return src ? (
    <img src={src} alt={drink?.name || ""} className={`cc-photo ${className}`} />
  ) : (
    <div className={`cc-photo cc-photo--empty ${className}`} aria-hidden="true">
      <Martini size={56} strokeWidth={1.2} />
    </div>
  );
}

function glassNote(volumeMl: number, smallGlassMaxMl: number) {
  return volumeMl > smallGlassMaxMl ? "needs a large glass" : "fits either glass";
}

/** The photo that represents what is being made: the drink, or the machine for a custom mix. */
function orderPhoto(mode: string, selected: any) {
  return (mode === "signature" && drinkImage(selected)) || MACHINE_PHOTO;
}

/* ============================================================
   Screens
   ============================================================ */

function MachineScreen({ now, children }: { now: Date; children: ReactNode }) {
  return (
    <div className="cc-screen cc-screen--photo">
      <Backdrop src={MACHINE_BACKDROP} />
      <div className="cc-pane">
        <Header now={now} />
        <section className="cc-pane__body cc-message">{children}</section>
      </div>
      <SidePhoto src={MACHINE_PHOTO} />
    </div>
  );
}

function PoweredOff({ now, poweredOn }: any) {
  return (
    <MachineScreen now={now}>
      <span className="cc-message__icon">
        <PowerOff size={28} aria-hidden="true" />
      </span>
      <h1>{poweredOn ? "Taking a short break" : "The bar is closed"}</h1>
      <p>
        {poweredOn
          ? "The station can’t reach its controller right now. Please ask a member of staff for help."
          : "Orders open as soon as staff switch the station on. Please ask a member of staff for help."}
      </p>
    </MachineScreen>
  );
}

function Welcome({
  now,
  go,
  drinks,
  setMode,
  setWantsIce,
  setSelectedId,
  setCustomIngredients,
}: any) {
  const photos = drinks
    .map((drink: any) => drinkImage(drink))
    .filter(Boolean)
    .slice(0, 3);
  const collage = photos.length === 3 ? photos : FALLBACK_COLLAGE;
  const listed = drinks.slice(0, 6);

  const start = () => {
    setMode("signature");
    setWantsIce(false);
    go("catalog");
  };
  const openDrink = (drink: any) => {
    setMode("signature");
    setSelectedId(drink.id);
    setWantsIce(false);
    go("detail");
  };
  const buildOwn = () => {
    setMode("custom");
    setCustomIngredients([]);
    setWantsIce(false);
    go("compose");
  };

  return (
    <div className="cc-screen cc-welcome">
      <Backdrop src={HOUSE_BACKDROP} />
      <Header now={now} />
      <div className="cc-welcome__body">
        <section className="cc-board" aria-labelledby="cc-board-title">
          <div className="cc-board__head">
            <h1 id="cc-board-title">On the menu</h1>
            {drinks.length > 0 && <span>{drinks.length} house drinks</span>}
          </div>
          <ul className="cc-board__list">
            {listed.map((drink: any) => (
              <li key={drink.id}>
                <button type="button" disabled={!drink.available} onClick={() => openDrink(drink)}>
                  <strong>{drink.name}</strong>
                  <i aria-hidden="true" />
                  <span>{drink.available ? flavourLine(drink.ingredients) : "Not today"}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="is-build" onClick={buildOwn}>
                <strong>Build your own</strong>
                <i aria-hidden="true" />
                <span>Your mix</span>
              </button>
            </li>
          </ul>
          <PrimaryButton className="cc-button--large cc-button--block" onClick={start}>
            Tap to order <ArrowRight size={22} aria-hidden="true" />
          </PrimaryButton>
        </section>
        <div className="cc-welcome__collage" aria-hidden="true">
          {collage.map((src: string, index: number) => (
            <img key={index} src={src} alt="" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Catalog({
  now,
  go,
  startOver,
  setSelectedId,
  setMode,
  setWantsIce,
  setCustomIngredients,
  drinks,
  showPrices,
}: any) {
  const [activeCategory, setActiveCategory] = useState("all");
  const categories = useMemo(
    () =>
      Array.from(
        new Set(drinks.map((drink: any) => String(drink.category || "classic"))),
      ).sort() as string[],
    [drinks],
  );
  const visibleDrinks =
    activeCategory === "all"
      ? drinks
      : drinks.filter((drink: any) => String(drink.category || "classic") === activeCategory);

  const openDrink = (drink: any) => {
    setMode("signature");
    setSelectedId(drink.id);
    setWantsIce(false);
    go("detail");
  };
  const buildOwn = () => {
    setMode("custom");
    setCustomIngredients([]);
    setWantsIce(false);
    go("compose");
  };

  return (
    <div className="cc-screen cc-menu">
      <Backdrop src={HOUSE_BACKDROP} />
      <Header
        now={now}
        action={
          <HeaderButton onClick={startOver} icon={<RotateCcw size={18} aria-hidden="true" />}>
            Start over
          </HeaderButton>
        }
      />
      <div className="cc-menu__top">
        <h1>Choose your drink</h1>
        <div className="cc-filters" aria-label="Filter drinks">
          {["all", ...categories].map((category) => (
            <button
              type="button"
              key={category}
              aria-pressed={activeCategory === category}
              className={activeCategory === category ? "is-active" : ""}
              onClick={() => setActiveCategory(category)}
            >
              {category === "all" ? "All" : categoryLabel(category)}
            </button>
          ))}
        </div>
      </div>
      <div className="cc-menu__row">
        <button type="button" className="cc-build-card" onClick={buildOwn}>
          <span className="cc-build-card__icon">
            <Plus size={26} aria-hidden="true" />
          </span>
          <span>
            <strong>Build your own</strong>
            <small>Mix the ingredients the way you like it.</small>
          </span>
        </button>
        {visibleDrinks.map((drink: any) => (
          <button
            type="button"
            key={drink.id}
            className={`cc-drink-card ${!drink.available ? "is-unavailable" : ""}`}
            disabled={!drink.available}
            onClick={() => openDrink(drink)}
          >
            <DrinkPhoto drink={drink} />
            <span className="cc-drink-card__body">
              <strong>{drink.name}</strong>
              <small>
                {drink.available ? flavourLine(drink.ingredients) : "Not available right now"}
              </small>
              {showPrices && drink.available && (
                <span className="cc-price">€{Number(drink.price || 0).toFixed(2)}</span>
              )}
            </span>
          </button>
        ))}
        {visibleDrinks.length === 0 && (
          <p className="cc-menu__empty">No drinks in this category right now.</p>
        )}
      </div>
      <div className="cc-menu__footer">
        {visibleDrinks.length > 3 && (
          <span>
            Swipe for all {visibleDrinks.length} drinks <ArrowRight size={18} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}

function categoryLabel(category: string) {
  return category.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Detail({
  selected,
  now,
  go,
  wantsIce,
  setWantsIce,
  showPrices,
  smallGlassMaxMl,
  handleOrder,
  isSubmitting,
  machineStatus,
}: any) {
  if (!selected) return null;
  const ingredients: any[] = selected.ingredients || [];
  const total = ingredients.reduce((sum, i) => sum + i.amount_ml, 0);
  const backdrop = drinkBackdrop(selected);
  const photo = drinkImage(selected);

  return (
    <div className="cc-screen cc-screen--photo cc-detail">
      <Backdrop src={backdrop.src} blur={backdrop.blur} />
      <div className="cc-pane">
        <Header
          now={now}
          action={
            <HeaderButton
              onClick={() => go("catalog")}
              icon={<ArrowLeft size={18} aria-hidden="true" />}
            >
              Menu
            </HeaderButton>
          }
        />
        <section className="cc-pane__body cc-detail__content">
          <div className="cc-detail__title">
            <h1>{selected.name}</h1>
            {showPrices && (
              <span className="cc-price">€{Number(selected.price || 0).toFixed(2)}</span>
            )}
          </div>
          <p className="cc-detail__description">{selected.description || "A house favourite."}</p>

          <div className="cc-recipe">
            <span className="cc-label">What’s in it</span>
            <div className="cc-recipe__bar" aria-hidden="true">
              {ingredients.map((ingredient, index) => (
                <span
                  key={ingredient.id}
                  style={{
                    width: `${(ingredient.amount_ml / total) * 100}%`,
                    background: ingredientColor(ingredient.name, index),
                  }}
                />
              ))}
            </div>
            <ul className="cc-recipe__legend">
              {ingredients.map((ingredient, index) => (
                <li key={ingredient.id}>
                  <i
                    style={{ background: ingredientColor(ingredient.name, index) }}
                    aria-hidden="true"
                  />
                  {ingredient.name}
                  <span>{ingredient.amount_ml} ml</span>
                </li>
              ))}
            </ul>
          </div>

          <IceChoice wantsIce={wantsIce} setWantsIce={setWantsIce} />

          <div className="cc-detail__confirm">
            {selected.available ? (
              <span className="cc-note">
                <GlassIcon size={18} /> {total} ml · {glassNote(total, smallGlassMaxMl)}
              </span>
            ) : (
              <span className="cc-note cc-note--warning">
                {selected.availability_reason || "One or more ingredients are unavailable."}
              </span>
            )}
            <PrimaryButton
              className="cc-button--large cc-button--block"
              onClick={handleOrder}
              disabled={!selected.available || isSubmitting || machineStatus !== "idle"}
            >
              {isSubmitting ? (
                "Sending to the machine…"
              ) : (
                <>
                  Make my drink <ArrowRight size={22} aria-hidden="true" />
                </>
              )}
            </PrimaryButton>
          </div>
        </section>
      </div>
      {photo ? (
        <SidePhoto src={photo} alt={selected.name} />
      ) : (
        <figure className="cc-side-photo cc-photo--empty" aria-hidden="true">
          <Martini size={72} strokeWidth={1.1} />
        </figure>
      )}
    </div>
  );
}

function Compose({
  now,
  go,
  availablePumps,
  customIngredients,
  setCustomIngredients,
  reserveMarginMl,
  wantsIce,
  setWantsIce,
  smallGlassMaxMl,
  handleOrder,
  isSubmitting,
  machineStatus,
}: any) {
  const totalMl = customIngredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0);
  const orderableMl = (pump: any) =>
    Math.max(0, Number(pump.current_volume_ml || 0) - reserveMarginMl);

  const setAmount = (pump: any, amount: number) => {
    const existing = customIngredients.find((i: any) => i.ingredient_id === pump.ingredient_id);
    if (existing) {
      setCustomIngredients(
        customIngredients.map((i: any) =>
          i.ingredient_id === pump.ingredient_id ? { ...i, amount_ml: amount } : i,
        ),
      );
    } else {
      setCustomIngredients([
        ...customIngredients,
        { ingredient_id: pump.ingredient_id, name: pump.ingredient_name, amount_ml: amount },
      ]);
    }
  };
  const remove = (pump: any) =>
    setCustomIngredients(
      customIngredients.filter((i: any) => i.ingredient_id !== pump.ingredient_id),
    );

  const presetAllowed = (pump: any, preset: number, current: number) =>
    preset <= MAX_PER_INGREDIENT_ML &&
    preset <= orderableMl(pump) &&
    totalMl - current + preset <= MAX_TOTAL_ML;

  const inventoryShort = customIngredients.some((ingredient: any) => {
    const pump = availablePumps.find(
      (item: any) => item.ingredient_id === ingredient.ingredient_id,
    );
    return !pump || ingredient.amount_ml > orderableMl(pump);
  });

  return (
    <div className="cc-screen cc-compose">
      <Backdrop src={HOUSE_BACKDROP} />
      <Header
        now={now}
        action={
          <HeaderButton
            onClick={() => go("catalog")}
            icon={<ArrowLeft size={18} aria-hidden="true" />}
          >
            Menu
          </HeaderButton>
        }
      />
      <div className="cc-compose__body">
        <section className="cc-compose__main">
          <div className="cc-compose__heading">
            <h1>Build your own</h1>
            <p>Choose how much of each. Up to {MAX_TOTAL_ML} ml in total.</p>
          </div>
          <div className="cc-compose__rows">
            {availablePumps.map((pump: any, index: number) => {
              const chosen = customIngredients.find(
                (i: any) => i.ingredient_id === pump.ingredient_id,
              );
              const color = ingredientColor(pump.ingredient_name, index);
              const firstAllowed = AMOUNT_PRESETS.slice(0, 2)
                .reverse()
                .find((preset) => presetAllowed(pump, preset, 0));
              return (
                <div
                  key={pump.ingredient_id}
                  className={`cc-compose-row ${chosen ? "is-chosen" : ""}`}
                >
                  <i style={{ background: color }} aria-hidden="true" />
                  <span className="cc-compose-row__name">{pump.ingredient_name}</span>
                  {chosen ? (
                    <>
                      <div
                        className="cc-amounts"
                        role="group"
                        aria-label={`${pump.ingredient_name} amount`}
                      >
                        {AMOUNT_PRESETS.map((preset) => (
                          <button
                            type="button"
                            key={preset}
                            aria-pressed={chosen.amount_ml === preset}
                            className={chosen.amount_ml === preset ? "is-selected" : ""}
                            disabled={
                              chosen.amount_ml !== preset &&
                              !presetAllowed(pump, preset, chosen.amount_ml)
                            }
                            onClick={() => setAmount(pump, preset)}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="cc-icon-button"
                        aria-label={`Remove ${pump.ingredient_name}`}
                        onClick={() => remove(pump)}
                      >
                        <X size={20} aria-hidden="true" />
                      </button>
                    </>
                  ) : firstAllowed ? (
                    <button
                      type="button"
                      className="cc-add-button"
                      onClick={() => setAmount(pump, firstAllowed)}
                    >
                      <Plus size={18} aria-hidden="true" /> Add
                    </button>
                  ) : (
                    <span className="cc-compose-row__out">
                      {orderableMl(pump) < AMOUNT_PRESETS[0] ? "Running low" : "Glass is full"}
                    </span>
                  )}
                </div>
              );
            })}
            {availablePumps.length === 0 && (
              <p className="cc-note">
                No ingredients are set up yet. Please ask a member of staff.
              </p>
            )}
          </div>
        </section>

        <aside className="cc-compose__summary">
          <MixGlass
            ingredients={customIngredients}
            pumps={availablePumps}
            smallGlassMaxMl={smallGlassMaxMl}
          />
          <div className="cc-compose__total">
            <strong>{totalMl} ml</strong>
            <span>
              {totalMl === 0
                ? "Add an ingredient to start"
                : `of ${MAX_TOTAL_ML} · ${glassNote(totalMl, smallGlassMaxMl)}`}
            </span>
          </div>
          <IceChoice wantsIce={wantsIce} setWantsIce={setWantsIce} compact />
          {inventoryShort && (
            <span className="cc-note cc-note--warning">
              A bottle is running low. Please choose a smaller amount.
            </span>
          )}
          <PrimaryButton
            className="cc-button--block"
            onClick={handleOrder}
            disabled={
              totalMl === 0 ||
              totalMl > MAX_TOTAL_ML ||
              inventoryShort ||
              isSubmitting ||
              machineStatus !== "idle"
            }
          >
            {isSubmitting ? (
              "Sending…"
            ) : (
              <>
                Make my drink <ArrowRight size={20} aria-hidden="true" />
              </>
            )}
          </PrimaryButton>
        </aside>
      </div>
    </div>
  );
}

function MixGlass({ ingredients, pumps, smallGlassMaxMl }: any) {
  const GLASS_HEIGHT = 220;
  const totalMl = ingredients.reduce((sum: number, i: any) => sum + i.amount_ml, 0);
  const colorFor = (ingredientId: number, name: string) => {
    const index = pumps.findIndex((pump: any) => pump.ingredient_id === ingredientId);
    return ingredientColor(name, Math.max(0, index));
  };
  return (
    <div
      className="cc-mix-glass"
      role="img"
      aria-label={`Glass filled to ${totalMl} of ${MAX_TOTAL_ML} millilitres`}
    >
      <div className="cc-mix-glass__body">
        {ingredients.map((ingredient: any) => (
          <span
            key={ingredient.ingredient_id}
            style={{
              height: (ingredient.amount_ml / MAX_TOTAL_ML) * GLASS_HEIGHT,
              background: colorFor(ingredient.ingredient_id, ingredient.name),
            }}
          />
        ))}
      </div>
      <span
        className="cc-mix-glass__limit"
        style={{ bottom: (smallGlassMaxMl / MAX_TOTAL_ML) * GLASS_HEIGHT }}
        aria-hidden="true"
      >
        <small>small glass</small>
      </span>
    </div>
  );
}

function WaitingGlass({
  now,
  glassState,
  totalMl,
  requiredGlass,
  orderVolumeMl,
  smallGlassMaxMl,
  orderedName,
}: any) {
  const volume = Number.isFinite(orderVolumeMl) ? orderVolumeMl : totalMl;
  const requiresLarge = requiredGlass === "large";
  let title = requiresLarge
    ? "Place a large glass under the spout"
    : "Place a glass under the spout";
  let subtitle = `Your ${orderedName} starts as soon as the glass is in place.`;
  let tone = "";

  if (glassState === "small_glass" && requiresLarge) {
    title = "That glass is too small";
    subtitle = `This ${volume} ml drink needs the large glass. Please swap it.`;
    tone = "is-warning";
  } else if (glassState === "small_glass" || glassState === "large_glass") {
    title = "Glass detected";
    subtitle = "Starting your drink…";
    tone = "is-detected";
  } else if (glassState === "sensor_error") {
    title = "We can’t see the glass properly";
    subtitle = "Please centre the glass on the grate, right under the spout.";
    tone = "is-warning";
  }

  return (
    <div className="cc-screen cc-screen--photo">
      <Backdrop src={MACHINE_BACKDROP} />
      <div className="cc-pane">
        <Header now={now} />
        <section className="cc-pane__body">
          <OrderSteps current={0} />
          <div className="cc-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="cc-glass-options">
            <div className={!requiresLarge ? "is-ok" : ""}>
              <GlassIcon size={30} />
              <span>
                <strong>Small glass</strong>
                <small>Up to {smallGlassMaxMl} ml</small>
              </span>
            </div>
            <div className="is-ok">
              <GlassIcon size={40} tall />
              <span>
                <strong>Large glass</strong>
                <small>Your drink is {volume} ml</small>
              </span>
            </div>
          </div>
        </section>
      </div>
      <SidePhoto
        src={DISPENSE_BAY_PHOTO}
        alt="The dispensing bay: place the glass on the grate"
        tone={`is-bay ${tone}`}
      >
        <svg className="cc-bay-guide" viewBox="0 0 540 600" fill="none" aria-hidden="true">
          <g className="cc-bay-guide__arrow">
            <path d="M297 300v41" />
            <path d="M282.5 327l14.5 14.5 14.5-14.5" />
          </g>
          <path
            className="cc-bay-guide__glass"
            d="M245 374h103l-8.3 124c-.5 6.2-4.6 10.3-10.8 10.3h-65.1c-6.2 0-10.3-4.1-10.8-10.3z"
          />
        </svg>
      </SidePhoto>
    </div>
  );
}

// Translate firmware status into the guest-facing three-phase progress.
function preparingPhase(machineStatus: string) {
  if (machineStatus === "mixing") return 1;
  if (machineStatus === "pouring") return 2;
  return 0;
}

function pouringDetail(message: string, orderPumps: any[]) {
  if (/prim/i.test(message)) return "Getting the lines ready";
  const match = message.match(/pump\s+(\d+)/i);
  if (match) {
    const pumpNumber = Number(match[1]);
    const index = orderPumps.findIndex((command: any) => Number(command.pump) === pumpNumber);
    if (index >= 0)
      return `${orderPumps[index].ingredient} now · ${index + 1} of ${orderPumps.length}`;
  }
  return "Getting started";
}

function Preparing({
  now,
  selected,
  mode,
  progress,
  machineStatus,
  message,
  orderedName,
  orderPumps,
}: any) {
  const phase = preparingPhase(machineStatus);
  const phases = ["Pouring ingredients", "Mixing", "Pouring into your glass"];
  const backdrop =
    mode === "signature" ? drinkBackdrop(selected) : { src: HOUSE_BACKDROP, blur: false };
  return (
    <div className="cc-screen cc-screen--photo">
      <Backdrop src={backdrop.src} blur={backdrop.blur} />
      <div className="cc-pane">
        <Header now={now} />
        <section className="cc-pane__body">
          <OrderSteps current={1} />
          <div className="cc-heading">
            <h1>Mixing your {orderedName}</h1>
          </div>
          <ol className="cc-phases">
            <li className="is-done">
              <span className="cc-phases__dot">
                <Check size={16} strokeWidth={3} aria-hidden="true" />
              </span>
              Glass in place
            </li>
            {phases.map((label, index) => (
              <li
                key={label}
                className={index < phase ? "is-done" : index === phase ? "is-current" : ""}
                aria-current={index === phase ? "step" : undefined}
              >
                <span className="cc-phases__dot">
                  {index < phase && <Check size={16} strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="cc-phases__text">
                  {label}
                  {index === 0 && phase === 0 && (
                    <>
                      <small>{pouringDetail(message, orderPumps)}</small>
                      <span className="cc-phases__bar">
                        <i style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="cc-note">
            <Info size={18} aria-hidden="true" /> Please leave the glass where it is until it’s
            ready.
          </p>
        </section>
      </div>
      <SidePhoto src={orderPhoto(mode, selected)} />
    </div>
  );
}

function Ready({ now, selected, mode, orderedName }: any) {
  const backdrop =
    mode === "signature" ? drinkBackdrop(selected) : { src: HOUSE_BACKDROP, blur: false };
  return (
    <div className="cc-screen cc-screen--photo cc-ready">
      <Backdrop src={backdrop.src} blur={backdrop.blur} />
      <div className="cc-pane">
        <Header now={now} />
        <section className="cc-pane__body">
          <OrderSteps current={2} />
          <span className="cc-ready__check">
            <Check size={30} strokeWidth={2.6} aria-hidden="true" />
          </span>
          <h1>Your {orderedName} is ready</h1>
          <p>Lift your glass out and enjoy. The machine rinses itself for the next guest.</p>
        </section>
      </div>
      <SidePhoto src={orderPhoto(mode, selected)} />
    </div>
  );
}

function ErrorScreen({ now, message, orderedName, startOver }: any) {
  return (
    <MachineScreen now={now}>
      <span className="cc-message__icon cc-message__icon--danger">
        <AlertTriangle size={28} aria-hidden="true" />
      </span>
      <h1>Sorry, we couldn’t finish your drink</h1>
      <p>The machine has stopped. Please ask a member of staff — they’ll sort it out.</p>
      <aside className="cc-staff" aria-label="Details for staff">
        <span className="cc-label">For staff</span>
        <p>{message || "The controller reported an error."}</p>
        <small>
          {orderedName !== UNKNOWN_DRINK_NAME && `Order: ${orderedName}. `}Open Admin → Hardware for
          details.
        </small>
      </aside>
      <PrimaryButton onClick={startOver}>Back to start</PrimaryButton>
    </MachineScreen>
  );
}

function CleaningScreen({ now, progress }: any) {
  return (
    <MachineScreen now={now}>
      <span className="cc-message__icon">
        <RinseIcon />
      </span>
      <h1>Getting ready for the next guest</h1>
      <p>The machine is rinsing itself. This only takes a moment.</p>
      <span className="cc-message__bar">
        <i style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
      </span>
    </MachineScreen>
  );
}

function CleaningDone({ now }: any) {
  return (
    <MachineScreen now={now}>
      <span className="cc-message__icon cc-message__icon--accent">
        <Check size={28} strokeWidth={2.6} aria-hidden="true" />
      </span>
      <h1>All set for the next guest</h1>
      <p>Thanks for visiting Cocktail Craft.</p>
    </MachineScreen>
  );
}

function RinseIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3c3.5 4.2 5.5 7.3 5.5 10a5.5 5.5 0 0 1-11 0c0-2.7 2-5.8 5.5-10z" />
      <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  );
}
