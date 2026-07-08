const API_BASE = "http://localhost:5000/api";

export async function fetchApi(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let errorMsg = "API Error";
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch (e) {
      // Ignore
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

// Menu / Orders
export const getMenu = () => fetchApi("/menu");
export const placeOrder = (recipeId: number) =>
  fetchApi("/order", { method: "POST", body: JSON.stringify({ recipe_id: recipeId }) });
export const placeCustomOrder = (ingredients: any[]) =>
  fetchApi("/order/custom", { method: "POST", body: JSON.stringify({ ingredients }) });
export const abortOrder = () => fetchApi("/abort", { method: "POST" });
export const getStatus = () => fetchApi("/status");

// Admin - Ingredients
export const getIngredients = () => fetchApi("/admin/ingredients");
export const createIngredient = (name: string, desc: string) =>
  fetchApi("/admin/ingredients", { method: "POST", body: JSON.stringify({ name, description: desc }) });
export const updateIngredient = (id: number, name: string, desc: string) =>
  fetchApi(`/admin/ingredients/${id}`, { method: "PUT", body: JSON.stringify({ name, description: desc }) });
export const deleteIngredient = (id: number) => fetchApi(`/admin/ingredients/${id}`, { method: "DELETE" });

// Admin - Pumps
export const getPumps = () => fetchApi("/admin/pumps");
export const assignPump = (pumpNum: number, ingredientId: number | null) =>
  fetchApi(`/admin/pumps/${pumpNum}/assign`, { method: "POST", body: JSON.stringify({ ingredient_id: ingredientId }) });
export const updatePumpFlowRate = (pumpNum: number, flowRate: number) =>
  fetchApi(`/admin/pumps/${pumpNum}/flowrate`, { method: "PUT", body: JSON.stringify({ flow_rate_ml_per_s: flowRate }) });

// Admin - Recipes
export const getAdminRecipes = () => fetchApi("/admin/recipes");
export const createRecipe = (recipe: any) => fetchApi("/admin/recipes", { method: "POST", body: JSON.stringify(recipe) });
export const updateRecipe = (id: number, recipe: any) => fetchApi(`/admin/recipes/${id}`, { method: "PUT", body: JSON.stringify(recipe) });
export const deleteRecipe = (id: number) => fetchApi(`/admin/recipes/${id}`, { method: "DELETE" });
export const uploadRecipeImage = async (id: number, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/admin/recipes/${id}/image`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    let errorMsg = "API Error";
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  return res.json();
};

// Admin - Other
export const cleanSystem = (mode = "all", pump?: number) => fetchApi("/admin/clean", { method: "POST", body: JSON.stringify({ mode, pump }) });
export const verifyPin = (pin: string) => fetchApi("/admin/pin/verify", { method: "POST", body: JSON.stringify({ pin }) });

// Admin - Hardware
export const sendCleanCommand = (trigger: string, mode: string, pump?: number) =>
  fetchApi("/admin/clean", { method: "POST", body: JSON.stringify({ trigger, mode, pump }) });
export const setSimulatorMode = (enabled: boolean) =>
  fetchApi("/admin/mode", { method: "POST", body: JSON.stringify({ simulator: enabled }) });

// Dev
export const simulateHardwareMessage = (message: any) =>
  fetchApi("/dev/simulate-message", { method: "POST", body: JSON.stringify(message) });
export const changePin = (current: string, newPin: string) =>
  fetchApi("/admin/pin/change", { method: "POST", body: JSON.stringify({ current_pin: current, new_pin: newPin }) });

// Glass bypass — for real hardware with no glass sensor.
// Releases the Python-side waiting_glass gate and forces state → dispensing.
// The bypass button in WaitingGlass screen should call this instead of simulateHardwareMessage.
export const confirmGlass = () =>
  fetchApi("/order/confirm-glass", { method: "POST" });
