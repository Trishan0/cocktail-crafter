import orangeRoseFizz from "@/assets/drinks/orange-rose-fizz.webp";
import roseLimeFizz from "@/assets/drinks/rose-lime-fizz.webp";
import orangeSpritzer from "@/assets/drinks/orange-spritzer.webp";
import orangeRoseCooler from "@/assets/drinks/orange-rose-cooler.webp";
import citrusRoseSpritz from "@/assets/drinks/citrus-rose-spritz.webp";
import orangeRoseFizzBg from "@/assets/drinks/orange-rose-fizz-bg.webp";
import roseLimeFizzBg from "@/assets/drinks/rose-lime-fizz-bg.webp";
import orangeSpritzerBg from "@/assets/drinks/orange-spritzer-bg.webp";
import orangeRoseCoolerBg from "@/assets/drinks/orange-rose-cooler-bg.webp";
import citrusRoseSpritzBg from "@/assets/drinks/citrus-rose-spritz-bg.webp";
import roseSprite from "@/assets/drinks/rose-sprite.webp";
import roseSpriteBg from "@/assets/drinks/rose-sprite-bg.webp";
import machinePhoto from "@/assets/backdrops/machine.webp";
import machineBackdrop from "@/assets/backdrops/machine-bg.webp";
import dispenseBayPhoto from "@/assets/backdrops/bay.webp";

// Photos bundled with the kiosk for the house recipes. An image uploaded in
// Admin (recipe.image_url) always wins over these. Each has a pre-softened
// "-bg" twin so screen backdrops need no live CSS blur on the Pi.
const BUNDLED_IMAGES: Record<string, { photo: string; backdrop: string }> = {
  "orange rose fizz": { photo: orangeRoseFizz, backdrop: orangeRoseFizzBg },
  "rose lime fizz": { photo: roseLimeFizz, backdrop: roseLimeFizzBg },
  "orange spritzer": { photo: orangeSpritzer, backdrop: orangeSpritzerBg },
  "orange rose cooler": { photo: orangeRoseCooler, backdrop: orangeRoseCoolerBg },
  "citrus rose spritz": { photo: citrusRoseSpritz, backdrop: citrusRoseSpritzBg },
  "rose sprite": { photo: roseSprite, backdrop: roseSpriteBg },
};

export const FALLBACK_COLLAGE = [orangeRoseCooler, orangeRoseFizz, roseLimeFizz];
export const HOUSE_BACKDROP = orangeRoseCoolerBg;
export const MACHINE_PHOTO = machinePhoto;
// Softened machine shot for screens that show the machine, so no drink glass
// sits behind text next to the charcoal hardware photo.
export const MACHINE_BACKDROP = machineBackdrop;
export const DISPENSE_BAY_PHOTO = dispenseBayPhoto;

type DrinkLike = { name?: string; image_url?: string | null };

function bundled(drink?: DrinkLike) {
  return drink?.name ? BUNDLED_IMAGES[drink.name.trim().toLowerCase()] : undefined;
}

function uploadedImage(drink?: DrinkLike) {
  if (!drink?.image_url || typeof window === "undefined") return undefined;
  return `${window.location.protocol}//${window.location.hostname}:5000${drink.image_url}`;
}

export function drinkImage(drink?: DrinkLike) {
  return uploadedImage(drink) ?? bundled(drink)?.photo;
}

/** Softened photo for a screen backdrop; `blur` means the browser must soften it. */
export function drinkBackdrop(drink?: DrinkLike): { src: string; blur: boolean } {
  const uploaded = uploadedImage(drink);
  if (uploaded) return { src: uploaded, blur: true };
  return { src: bundled(drink)?.backdrop ?? HOUSE_BACKDROP, blur: false };
}

const INGREDIENT_COLORS: Record<string, string> = {
  "orange juice": "#E8893A",
  "rose syrup": "#D8607A",
  sprite: "#D9E6A6",
  soda: "#8FB8CC",
  "lime cordial": "#A6C25A",
  water: "#B9C3C9",
};
const FALLBACK_COLORS = ["#E9C46A", "#C98BB9", "#9CC5D6", "#E8846B", "#B7C98B", "#D9A27A"];

export function ingredientColor(name: string, index = 0) {
  return (
    INGREDIENT_COLORS[name.trim().toLowerCase()] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
  );
}

/** "Orange Juice" -> "Orange", "Lime Cordial" -> "Lime" for compact flavour lines. */
export function shortIngredientName(name: string) {
  return name.replace(/\s+(juice|syrup|cordial)$/i, "").trim();
}

export function flavourLine(ingredients: { name: string; amount_ml: number }[] = []) {
  // Recipe order, not volume: a 12 ml rose syrup defines the drink more than soda.
  const names = ingredients.map((i) => shortIngredientName(i.name));
  return Array.from(new Set(names)).slice(0, 3).join(" · ");
}
