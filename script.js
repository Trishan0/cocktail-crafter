/* ── DATA ─────────────────────────────────────────────── */
const SLOTS = [
  { id: 1, name: "Vodka", color: "#8B9CF7" },
  { id: 2, name: "Sugar Syrup", color: "#F4B942" },
  { id: 3, name: "Soda Water", color: "#6EE7F7" },
  { id: 4, name: "Lime Juice", color: "#86EFAC" },
  { id: 5, name: "Blue Curaçao", color: "#60A5FA" },
  { id: 6, name: "Grenadine", color: "#F87171" },
];

const DRINKS = [
  {
    id: 1,
    emoji: "🍹",
    name: "Tropical Breeze",
    desc: "A refreshing blend of citrus and tropical sweetness.",
    price: 950,
    tags: ["Sweet", "Citrus", "Light"],
    ingredients: [
      { slot: 1, name: "Vodka", ml: 60 },
      { slot: 3, name: "Soda Water", ml: 80 },
      { slot: 4, name: "Lime Juice", ml: 30 },
      { slot: 2, name: "Sugar Syrup", ml: 20 },
    ],
  },
  {
    id: 2,
    emoji: "🌊",
    name: "Blue Lagoon",
    desc: "Electric blue with a crisp, slightly sweet taste.",
    price: 1100,
    tags: ["Sweet", "Fruity", "Strong"],
    ingredients: [
      { slot: 1, name: "Vodka", ml: 45 },
      { slot: 5, name: "Blue Curaçao", ml: 30 },
      { slot: 3, name: "Soda Water", ml: 100 },
      { slot: 4, name: "Lime Juice", ml: 20 },
    ],
  },
  {
    id: 3,
    emoji: "🌅",
    name: "Sunset Kiss",
    desc: "Layers of colour with grenadine sunrise effect.",
    price: 1050,
    tags: ["Sweet", "Smooth", "Vibrant"],
    ingredients: [
      { slot: 1, name: "Vodka", ml: 45 },
      { slot: 6, name: "Grenadine", ml: 25 },
      { slot: 3, name: "Soda Water", ml: 90 },
      { slot: 2, name: "Sugar Syrup", ml: 15 },
    ],
  },
  {
    id: 4,
    emoji: "🍋",
    name: "Citrus Fizz",
    desc: "Sharp lime meets bubbling soda for a clean kick.",
    price: 850,
    tags: ["Sour", "Fizzy", "Refreshing"],
    ingredients: [
      { slot: 3, name: "Soda Water", ml: 120 },
      { slot: 4, name: "Lime Juice", ml: 40 },
      { slot: 2, name: "Sugar Syrup", ml: 20 },
    ],
  },
  {
    id: 5,
    emoji: "🏝️",
    name: "Island Mule",
    desc: "A vodka-lime combo with fizzy island vibes.",
    price: 1000,
    tags: ["Tangy", "Fizzy", "Classic"],
    ingredients: [
      { slot: 1, name: "Vodka", ml: 60 },
      { slot: 4, name: "Lime Juice", ml: 30 },
      { slot: 3, name: "Soda Water", ml: 80 },
      { slot: 6, name: "Grenadine", ml: 10 },
    ],
  },
  {
    id: 6,
    emoji: "💜",
    name: "Violet Haze",
    desc: "A deep blue-purple dream with a bittersweet edge.",
    price: 1150,
    tags: ["Bold", "Fruity", "Exotic"],
    ingredients: [
      { slot: 1, name: "Vodka", ml: 50 },
      { slot: 5, name: "Blue Curaçao", ml: 40 },
      { slot: 6, name: "Grenadine", ml: 20 },
      { slot: 2, name: "Sugar Syrup", ml: 15 },
    ],
  },
];

const ADDONS = [
  { id: "ice", emoji: "🧊", label: "Add Ice" },
  { id: "lemon", emoji: "🍋", label: "Add Lemon" },
];

/* ── STATE ────────────────────────────────────────────── */
let currentDrink = null;
let selectedAddons = new Set();
let customSlots = SLOTS.map((s) => ({ ...s, active: false, ml: 50 }));
let customAddons = new Set();

/* ── THEME ────────────────────────────────────────────── */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.getElementById("theme-icon").textContent = isDark ? "🌙" : "☀️";
}

/* ── NAVIGATION ───────────────────────────────────────── */
function goTo(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

/* ── BUILD DRINKS GRID ────────────────────────────────── */
function buildDrinksGrid() {
  const grid = document.getElementById("drinks-grid");
  grid.innerHTML = DRINKS.map(
    (d) => `
    <div class="drink-card" onclick="openModal(${d.id})">
      <div class="drink-emoji">${d.emoji}</div>
      <div class="drink-name">${d.name}</div>
      <div class="drink-desc">${d.desc}</div>
      <div class="drink-tags">${d.tags.map((t) => `<span class="drink-tag">${t}</span>`).join("")}</div>
      <div class="drink-footer">
        <div class="drink-price"><span>LKR </span>${d.price}</div>
        <div class="drink-arrow">→</div>
      </div>
    </div>
  `,
  ).join("");
}

/* ── MODAL ────────────────────────────────────────────── */
function openModal(id) {
  const d = DRINKS.find((x) => x.id === id);
  if (!d) return;
  currentDrink = d;
  selectedAddons.clear();
  document.getElementById("modal-emoji").textContent = d.emoji;
  document.getElementById("modal-name").textContent = d.name;
  document.getElementById("modal-desc").textContent = d.desc;
  document.getElementById("modal-price").textContent = d.price.toLocaleString();
  document.getElementById("modal-ingredients").innerHTML = d.ingredients
    .map(
      (i) => `
    <div class="ingredient-row">
      <span class="ingredient-name">${i.name}</span>
      <span class="ingredient-ml">${i.ml} ml</span>
    </div>
  `,
    )
    .join("");
  document.getElementById("modal-addons").innerHTML = ADDONS.map(
    (a) => `
    <div class="addon-chip" id="addon-${a.id}" onclick="toggleAddon('${a.id}')">
      <div class="addon-check" id="addon-check-${a.id}"></div>
      ${a.emoji} ${a.label}
    </div>
  `,
  ).join("");
  document.getElementById("drink-modal").classList.add("open");
}

function toggleAddon(id) {
  if (selectedAddons.has(id)) {
    selectedAddons.delete(id);
    document.getElementById(`addon-${id}`).classList.remove("selected");
    document.getElementById(`addon-check-${id}`).textContent = "";
  } else {
    selectedAddons.add(id);
    document.getElementById(`addon-${id}`).classList.add("selected");
    document.getElementById(`addon-check-${id}`).textContent = "✓";
  }
}

function closeModal(e) {
  if (e.target === document.getElementById("drink-modal")) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById("drink-modal").classList.remove("open");
}

function startDispenseFromModal() {
  closeModalDirect();
  startDispense(false);
}

/* ── BUILD CUSTOM SLOTS ───────────────────────────────── */
function buildCustom() {
  const panel = document.getElementById("slots-panel");
  panel.innerHTML = customSlots
    .map(
      (s, i) => `
    <div class="slot-card" id="slot-card-${i}">
      <div class="slot-top">
        <span class="slot-label">Slot ${s.id}</span>
        <div class="slot-toggle ${s.active ? "on" : ""}" id="slot-toggle-${i}" onclick="toggleSlot(${i})"></div>
      </div>
      <div class="slot-name">${s.name}</div>
      <div class="slot-stepper ${!s.active ? "disabled" : ""}" id="slot-stepper-${i}">
        <button class="stepper-btn" ontouchstart="" onclick="stepSlot(${i}, -1)">−</button>
        <div class="stepper-divider"></div>
        <div class="stepper-val" id="slot-ml-${i}">${s.ml} ml</div>
        <div class="stepper-divider"></div>
        <button class="stepper-btn" ontouchstart="" onclick="stepSlot(${i}, 1)">+</button>
      </div>
    </div>
  `,
    )
    .join("");

  const addonsRow = document.getElementById("custom-addons-row");
  addonsRow.innerHTML = ADDONS.map(
    (a) => `
    <div class="custom-addon-chip ${customAddons.has(a.id) ? "selected" : ""}"
      onclick="toggleCustomAddon('${a.id}')">
      ${a.emoji} ${a.label}
    </div>
  `,
  ).join("");

  updateCustomSummary();
}

function toggleSlot(i) {
  customSlots[i].active = !customSlots[i].active;
  document
    .getElementById(`slot-toggle-${i}`)
    .classList.toggle("on", customSlots[i].active);
  document
    .getElementById(`slot-card-${i}`)
    .classList.toggle("active-slot", customSlots[i].active);
  document
    .getElementById(`slot-stepper-${i}`)
    .classList.toggle("disabled", !customSlots[i].active);
  updateCustomSummary();
}

function stepSlot(i, dir) {
  const s = customSlots[i];
  if (!s.active) return;
  s.ml = Math.min(150, Math.max(10, s.ml + dir * 5));
  document.getElementById(`slot-ml-${i}`).textContent = s.ml + " ml";
  updateCustomSummary();
}

function updateCustomSummary() {
  const active = customSlots.filter((s) => s.active);
  const totalMl = active.reduce((sum, s) => sum + s.ml, 0);
  const container = document.getElementById("summary-items");
  const empty = document.getElementById("summary-empty");

  if (active.length === 0) {
    container.innerHTML =
      '<div class="summary-empty" id="summary-empty">No slots selected yet</div>';
  } else {
    container.innerHTML = active
      .map(
        (s) => `
      <div class="summary-item">
        <span class="summary-item-name">${s.name}</span>
        <span class="summary-item-ml">${s.ml} ml</span>
      </div>
    `,
      )
      .join("");
  }
  document.getElementById("custom-total-vol").innerHTML =
    `Total: <strong>${totalMl} ml</strong>`;
  const btn = document.getElementById("custom-make-btn");
  btn.disabled = active.length === 0;
}

function toggleCustomAddon(id) {
  const chips = document
    .getElementById("custom-addons-row")
    .querySelectorAll(".custom-addon-chip");
  if (customAddons.has(id)) {
    customAddons.delete(id);
    chips.forEach((c) => {
      if (c.textContent.includes(ADDONS.find((a) => a.id === id).label))
        c.classList.remove("selected");
    });
  } else {
    customAddons.add(id);
    chips.forEach((c) => {
      if (c.textContent.includes(ADDONS.find((a) => a.id === id).label))
        c.classList.add("selected");
    });
  }
}

/* ── DISPENSE ─────────────────────────────────────────── */
function startDispense(isCustom) {
  let dispenseIngredients = [];
  let drinkName = "Your Custom Blend";
  let drinkSub = "Crafting your unique creation";

  if (!isCustom && currentDrink) {
    dispenseIngredients = currentDrink.ingredients.map((i) => ({
      name: i.name,
      ml: i.ml,
      target: i.ml,
    }));
    drinkName = currentDrink.name;
    drinkSub = "Sit tight — your cocktail is being crafted";
  } else {
    dispenseIngredients = customSlots
      .filter((s) => s.active)
      .map((s) => ({ name: s.name, ml: s.ml, target: s.ml }));
  }

  document.getElementById("progress-drink-name").textContent = drinkName;
  document.getElementById("progress-drink-sub").textContent = drinkSub;

  const container = document.getElementById("progress-slots");
  container.innerHTML = dispenseIngredients
    .map(
      (ing, i) => `
    <div class="progress-slot">
      <div class="progress-slot-label">${ing.name}</div>
      <div class="progress-track">
        <div class="progress-fill" id="pfill-${i}"></div>
      </div>
      <div class="progress-ml" id="pml-${i}">0 ml</div>
    </div>
  `,
    )
    .join("");

  document.getElementById("progress-overall-fill").style.width = "0%";
  document.getElementById("progress-pct").textContent = "0%";
  document.getElementById("done-drink-name").textContent = drinkName;

  goTo("screen-progress");
  simulateDispense(dispenseIngredients);
}

function simulateDispense(ingredients) {
  /* Simulates ESP32 MQTT messages — in production replace with
     socket.on('dispenser/progress', ...) WebSocket handler */
  const poured = ingredients.map(() => 0);
  const totalTarget = ingredients.reduce((s, i) => s + i.target, 0);
  let allDone = false;

  const interval = setInterval(() => {
    if (allDone) {
      clearInterval(interval);
      return;
    }

    let totalPoured = 0;
    let anyPouring = false;

    ingredients.forEach((ing, i) => {
      if (poured[i] < ing.target) {
        const step = Math.min(Math.random() * 12 + 4, ing.target - poured[i]);
        poured[i] = Math.min(poured[i] + step, ing.target);
        anyPouring = true;
      }
      const pct = (poured[i] / ing.target) * 100;
      const fill = document.getElementById(`pfill-${i}`);
      const ml = document.getElementById(`pml-${i}`);
      if (fill) {
        fill.style.width = pct + "%";
        if (pct >= 100) fill.classList.add("done");
      }
      if (ml) ml.textContent = Math.round(poured[i]) + " ml";
      totalPoured += poured[i];
    });

    const overallPct = Math.round((totalPoured / totalTarget) * 100);
    const ofill = document.getElementById("progress-overall-fill");
    const pctEl = document.getElementById("progress-pct");
    if (ofill) ofill.style.width = overallPct + "%";
    if (pctEl) pctEl.textContent = overallPct + "%";

    if (!anyPouring) {
      allDone = true;
      clearInterval(interval);
      setTimeout(() => goTo("screen-done"), 900);
    }
  }, 200);
}

/* ── INIT ─────────────────────────────────────────────── */
buildDrinksGrid();
buildCustom();
