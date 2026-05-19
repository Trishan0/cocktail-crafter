/* ════════════════════════════════════════════════
 CocktailCraft — Kiosk App Logic
 Handles: menu rendering, touch interactions,
 SSE real-time updates, order flow, custom builder
 ════════════════════════════════════════════════ */

    "use strict";

    // ─────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────

    const State = {
      menu: {},         // grouped menu from API
      bottleLabels: {},         // bottle_N → liquid name
      selectedDrink: null,       // { id, name, emoji, color, desc, ingredients, is_custom }
      currentOrderId: null,
      machineStatus: "idle",
      glassPresent: false,
      bottleLevels: {},
      mqttConnected: false,
      customName: "",
      customIngredients: {},       // bottle_N → ml value
      options: { ice: false, lime: false },
    };

    // ─────────────────────────────────────────────
    //  SCREEN NAVIGATION
    // ─────────────────────────────────────────────

    function showScreen(id) {
      document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
      const target = document.getElementById(id);
      if (target) target.classList.add("active");
    }

    // ─────────────────────────────────────────────
    //  MENU LOADING
    // ─────────────────────────────────────────────

    async function loadMenu() {
      try {
        const res = await fetch("/api/menu");
        const data = await res.json();
        State.menu = data.menu || {};
        State.bottleLabels = data.bottle_labels || {};
        renderTabs();
        renderDrinkGrid(Object.keys(State.menu)[0] || "");
      } catch (e) {
        showToast("Could not load menu", "error");
      }
    }

    function renderTabs() {
      const bar = document.getElementById("tab-bar");
      bar.innerHTML = "";
      Object.keys(State.menu).forEach((cat, i) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (i === 0 ? " active" : "");
        btn.textContent = cat;
        btn.dataset.cat = cat;
        btn.addEventListener("click", () => {
          document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          renderDrinkGrid(cat);
        });
        bar.appendChild(btn);
      });
    }

    function renderDrinkGrid(category) {
      const grid = document.getElementById("drink-grid");
      const drinks = State.menu[category] || [];
      grid.innerHTML = "";

      drinks.forEach(drink => {
        const card = document.createElement("div");
        card.className = "drink-card" + (isDrinkUnavailable(drink) ? " unavailable" : "");
        card.style.setProperty("--card-color", drink.color || "#c9a84c");

        const isCustom = drink.is_custom;
        card.innerHTML = `
      <div class="card-emoji">${drink.emoji || "🍹"}</div>
      <div class="card-name">${drink.name}</div>
      <div class="card-desc">${drink.description || ""}</div>
      ${isCustom ? `<div class="card-badge">Custom</div>` : ""}
    `;
        card.addEventListener("click", () => selectDrink(drink));
        grid.appendChild(card);
      });
    }

    function isDrinkUnavailable(drink) {
      if (!drink.ingredients) return false;
      for (const [bottle, ml] of Object.entries(drink.ingredients)) {
        if (ml > 0 && State.bottleLevels[bottle] === false) return true;
      }
      return false;
    }

    // ─────────────────────────────────────────────
    //  DRINK SELECTION → CONFIRM SCREEN
    // ─────────────────────────────────────────────

    function selectDrink(drink) {
      State.selectedDrink = drink;
      State.options = { ice: false, lime: false };

      document.getElementById("confirm-emoji").textContent = drink.emoji || "🍹";
      document.getElementById("confirm-name").textContent = drink.name;
      document.getElementById("confirm-desc").textContent = drink.description || "";

      // Ingredient pills
      const pillsEl = document.getElementById("confirm-ingredients");
      pillsEl.innerHTML = "";
      if (drink.ingredients) {
        Object.entries(drink.ingredients).forEach(([bottle, ml]) => {
          if (ml > 0) {
            const label = State.bottleLabels[bottle] || bottle;
            const pill = document.createElement("div");
            pill.className = "ingredient-pill";
            pill.innerHTML = `${label} <span>${ml}ml</span>`;
            pillsEl.appendChild(pill);
          }
        });
      }

      // Reset options
      document.getElementById("opt-ice").dataset.active = "false";
      document.getElementById("opt-lime").dataset.active = "false";

      showScreen("screen-confirm");
    }

    // ─────────────────────────────────────────────
    //  ORDER PLACEMENT
    // ─────────────────────────────────────────────

    async function placeOrder() {
      const drink = State.selectedDrink;
      if (!drink) return;

      const body = {
        options: State.options,
      };

      if (drink.is_custom) {
        body.custom_id = drink.id;
      } else {
        body.recipe_id = drink.id;
      }

      try {
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || "Order failed", "error");
          return;
        }

        State.currentOrderId = data.order_id;
        // Transition to making screen
        document.getElementById("making-emoji").textContent = drink.emoji || "🍹";
        document.getElementById("making-title").textContent = `Making ${drink.name}...`;
        document.getElementById("making-message").textContent = "Preparing...";
        setProgress(0);
        showScreen("screen-making");

      } catch (e) {
        showToast("Connection error", "error");
      }
    }

    // ─────────────────────────────────────────────
    //  ABORT
    // ─────────────────────────────────────────────

    async function abortOrder() {
      try {
        await fetch("/api/abort", { method: "POST" });
        showToast("Stopped", "info");
        showScreen("screen-menu");
      } catch (e) {
        showToast("Could not abort", "error");
      }
    }

    // ─────────────────────────────────────────────
    //  PROGRESS UI
    // ─────────────────────────────────────────────

    function setProgress(pct) {
      const fill = document.getElementById("progress-fill");
      const label = document.getElementById("progress-label");
      fill.style.width = pct + "%";
      label.textContent = pct + "%";
    }

    // ─────────────────────────────────────────────
    //  SERVER-SENT EVENTS  (real-time from Flask)
    // ─────────────────────────────────────────────

    function connectSSE() {
      const es = new EventSource("/stream");

      es.addEventListener("init", e => {
        const d = JSON.parse(e.data);
        applyFullState(d);
      });

      es.addEventListener("status", e => {
        const d = JSON.parse(e.data);
        handleStatusUpdate(d);
      });

      es.addEventListener("sensor", e => {
        const d = JSON.parse(e.data);
        handleSensorUpdate(d);
      });

      es.addEventListener("order_placed", e => {
        // already handled by placeOrder(), ignore duplicate
      });

      es.onerror = () => {
        setMqttIndicator(false);
        setTimeout(connectSSE, 3000);   // auto-reconnect
      };
    }

    function applyFullState(d) {
      setMqttIndicator(d.connected);
      setGlassIndicator(d.glass_present);
      State.bottleLevels = d.bottle_levels || {};
      State.machineStatus = d.machine_status || "idle";
      updateMachineLabel(d.machine_status);
      setProgress(d.progress || 0);
    }

    let _doneAutoReturn = null;

    function handleStatusUpdate(d) {
      const status = d.machine_status;
      State.machineStatus = status;
      updateMachineLabel(status);
      setProgress(d.progress || 0);

      const msgEl = document.getElementById("making-message");
      if (msgEl) msgEl.textContent = d.message || "";

      // Show/hide glass prompt
      const glassPrompt = document.getElementById("glass-prompt");
      if (glassPrompt) {
        glassPrompt.classList.toggle("hidden", status !== "waiting_glass");
      }

      // Transition to making screen for any active state
      const activeStates = ["waiting_glass", "dispensing", "mixing", "pouring"];
      const currentScreen = document.querySelector(".screen.active")?.id;
      if (activeStates.includes(status) && currentScreen !== "screen-making") {
        showScreen("screen-making");
      }

      if (status === "done") {
        setProgress(100);
        setTimeout(() => {
          const drink = State.selectedDrink;
          document.getElementById("done-emoji").textContent = drink ? (drink.emoji || "🍹") : "🍹";
          document.getElementById("done-name").textContent = drink ? drink.name : "";
          showScreen("screen-done");
          // Auto-return to welcome after 60s
          clearTimeout(_doneAutoReturn);
          _doneAutoReturn = setTimeout(() => showScreen("screen-welcome"), 60000);
        }, 600);
      }

      if (status === "aborted") {
        showToast("Drink stopped", "info");
        showScreen("screen-path");
      }

      if (status === "error") {
        showToast(d.message || "Something went wrong", "error");
        showScreen("screen-path");
      }
    }

    function handleSensorUpdate(d) {
      setGlassIndicator(d.glass_present);
      if (d.bottle_levels) {
        State.bottleLevels = d.bottle_levels;
      }
    }

    function updateMachineLabel(status) {
      const el = document.getElementById("machine-state-label");
      const map = {
        idle: "Ready",
        waiting_glass: "Waiting for Glass",
        dispensing: "Dispensing",
        mixing: "Mixing",
        pouring: "Pouring",
        done: "Done",
        error: "Error",
        cleaning: "Cleaning",
      };
      if (el) el.textContent = map[status] || status;
    }

    // ─────────────────────────────────────────────
    //  INDICATORS
    // ─────────────────────────────────────────────

    function setGlassIndicator(present) {
      const el = document.getElementById("ind-glass");
      if (!el) return;
      el.classList.toggle("on", present);
      el.classList.toggle("off", !present);
    }

    function setMqttIndicator(connected) {
      const el = document.getElementById("ind-mqtt");
      if (!el) return;
      el.classList.toggle("on", connected);
      el.classList.toggle("off", !connected);
    }

    // ─────────────────────────────────────────────
    //  CUSTOM BUILDER
    // ─────────────────────────────────────────────

    function openCustomBuilder() {
      State.customName = "";
      State.customIngredients = {};

      // Reset name display
      const nameDisplay = document.getElementById("custom-name-display");
      nameDisplay.textContent = "Tap to name your drink...";
      nameDisplay.classList.remove("has-value");

      // Build sliders for each bottle
      const grid = document.getElementById("sliders-grid");
      grid.innerHTML = "";
      const bottles = State.bottleLabels;

      Object.entries(bottles).forEach(([key, label]) => {
        State.customIngredients[key] = 0;
        const item = document.createElement("div");
        item.className = "slider-item";
        item.innerHTML = `
      <div class="slider-label">${label}</div>
      <div class="slider-value-row">
        <span class="slider-value" id="val-${key}">0</span>
        <span class="slider-unit">ml</span>
      </div>
      <input type="range" class="bottle-slider" id="slider-${key}"
             min="0" max="60" step="5" value="0"
             data-bottle="${key}"/>
    `;
        grid.appendChild(item);

        // Attach event after DOM insert
        setTimeout(() => {
          const slider = document.getElementById(`slider-${key}`);
          if (slider) {
            slider.addEventListener("input", () => {
              const val = parseInt(slider.value);
              State.customIngredients[key] = val;
              document.getElementById(`val-${key}`).textContent = val;
              updateCustomTotal();
            });
          }
        }, 0);
      });

      updateCustomTotal();
      showScreen("screen-custom");
    }

    function updateCustomTotal() {
      const total = Object.values(State.customIngredients).reduce((a, b) => a + b, 0);
      document.getElementById("custom-total").textContent = total;
    }

    async function submitCustomDrink() {
      const name = State.customName.trim();
      if (!name) {
        showToast("Please name your drink first", "info");
        return;
      }
      const total = Object.values(State.customIngredients).reduce((a, b) => a + b, 0);
      if (total === 0) {
        showToast("Add at least one ingredient", "info");
        return;
      }
      if (total > 180) {
        showToast("Max 180ml total", "error");
        return;
      }

      try {
        const res = await fetch("/api/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ingredients: State.customIngredients }),
        });
        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || "Could not save", "error");
          return;
        }

        showToast(data.message, "success");

        // Immediately queue as selected drink and go to confirm
        const customDrink = {
          id: data.custom_id,
          name: name,
          emoji: "✨",
          color: "#9b59b6",
          description: "Your custom creation",
          ingredients: State.customIngredients,
          is_custom: true,
        };
        selectDrink(customDrink);
        await loadMenu();   // refresh menu in background
      } catch (e) {
        showToast("Error saving drink", "error");
      }
    }

    // ─────────────────────────────────────────────
    //  ON-SCREEN KEYBOARD
    // ─────────────────────────────────────────────

    const KEYBOARD_ROWS = [
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L", "⌫"],
      ["Z", "X", "C", "V", "B", "N", "M", "SPACE", "SPACE", "SPACE"],
    ];

    let _kbBuffer = "";
    let _kbReturnScreen = "screen-custom";

    function openKeyboard(returnScreen = "screen-custom") {
      _kbReturnScreen = returnScreen;
      _kbBuffer = State.customName || "";
      renderKeyboard();
      updateKbDisplay();
      showScreen("screen-keyboard");
    }

    function renderKeyboard() {
      const grid = document.getElementById("keyboard-grid");
      grid.innerHTML = "";
      KEYBOARD_ROWS.forEach(row => {
        row.forEach(key => {
          const btn = document.createElement("button");
          if (key === "SPACE") {
            btn.className = "key-btn key-space";
            btn.textContent = "SPACE";
          } else if (key === "⌫") {
            btn.className = "key-btn key-special";
            btn.textContent = "⌫";
          } else {
            btn.className = "key-btn";
            btn.textContent = key;
          }
          btn.addEventListener("click", () => handleKey(key));
          grid.appendChild(btn);
        });
      });
    }

    function handleKey(key) {
      if (key === "⌫") {
        _kbBuffer = _kbBuffer.slice(0, -1);
      } else if (key === "SPACE") {
        if (_kbBuffer.length < 40) _kbBuffer += " ";
      } else {
        if (_kbBuffer.length < 40) _kbBuffer += key;
      }
      updateKbDisplay();
    }

    function updateKbDisplay() {
      const el = document.getElementById("kb-display");
      el.textContent = (_kbBuffer || "") + "|";
    }

    function confirmKeyboard() {
      State.customName = _kbBuffer.trim();
      const nameDisplay = document.getElementById("custom-name-display");
      if (State.customName) {
        nameDisplay.textContent = State.customName;
        nameDisplay.classList.add("has-value");
      } else {
        nameDisplay.textContent = "Tap to name your drink...";
        nameDisplay.classList.remove("has-value");
      }
      showScreen(_kbReturnScreen);
    }

    // ─────────────────────────────────────────────
    //  CLEANING
    // ─────────────────────────────────────────────

    async function triggerClean() {
      try {
        await fetch("/api/clean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "periodic" }),
        });
        showToast("Cleaning cycle started", "info");
      } catch (e) {
        showToast("Could not start cleaning", "error");
      }
    }

    // ─────────────────────────────────────────────
    //  OVERLAY
    // ─────────────────────────────────────────────

    function hideOverlay(id) {
      document.getElementById(id)?.classList.add("hidden");
    }

    // ─────────────────────────────────────────────
    //  TOAST
    // ─────────────────────────────────────────────

    function showToast(msg, type = "info") {
      const container = document.getElementById("toast-container");
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.textContent = msg;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    // ─────────────────────────────────────────────
    //  BUTTON WIRING
    // ─────────────────────────────────────────────

    function wireButtons() {
      // Welcome screen
      document.getElementById("btn-welcome-start")
        ?.addEventListener("click", () => showScreen("screen-path"));
      
      document.querySelector(".brand")
        ?.addEventListener("click", () => {
          const activeScreen = document.querySelector(".screen.active")?.id;
          if (activeScreen === "screen-path") {
            showScreen("screen-welcome");
          }
        });

      // Path selection
      document.getElementById("btn-choose-default")
        ?.addEventListener("click", () => showScreen("screen-menu"));

      document.getElementById("btn-choose-custom")
        ?.addEventListener("click", openCustomBuilder);

      document.getElementById("btn-menu-back")
        ?.addEventListener("click", () => showScreen("screen-path"));

      // Confirm screen
      document.getElementById("btn-back")
        ?.addEventListener("click", () => showScreen("screen-path"));

      document.getElementById("btn-confirm")
        ?.addEventListener("click", placeOrder);

      // Options toggles
      ["opt-ice", "opt-lime"].forEach(id => {
        const btn = document.getElementById(id);
        btn?.addEventListener("click", () => {
          const key = id === "opt-ice" ? "ice" : "lime";
          const active = btn.dataset.active !== "true";
          btn.dataset.active = active ? "true" : "false";
          State.options[key] = active;
        });
      });

      // Making screen
      document.getElementById("btn-abort")
        ?.addEventListener("click", abortOrder);

      // Done screen
      document.getElementById("btn-home")
        ?.addEventListener("click", () => {
          State.selectedDrink = null;
          State.currentOrderId = null;
          showScreen("screen-path");
        });

      // Custom builder
      document.getElementById("btn-custom-back")
        ?.addEventListener("click", () => showScreen("screen-path"));

      document.getElementById("btn-custom-confirm")
        ?.addEventListener("click", submitCustomDrink);

      document.getElementById("custom-name-display")
        ?.addEventListener("click", () => openKeyboard("screen-custom"));

      // Keyboard
      document.getElementById("btn-kb-cancel")
        ?.addEventListener("click", () => showScreen(_kbReturnScreen));

      document.getElementById("btn-kb-done")
        ?.addEventListener("click", confirmKeyboard);

      // Clean
      document.getElementById("btn-clean")
        ?.addEventListener("click", triggerClean);
    }

    // ─────────────────────────────────────────────
    //  INIT
    // ─────────────────────────────────────────────

    document.addEventListener("DOMContentLoaded", async () => {
      wireButtons();
      await loadMenu();
      connectSSE();
      showScreen("screen-welcome");
    });

