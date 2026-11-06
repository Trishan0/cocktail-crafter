import appleRoseFizz from "@/assets/drinks/new/apple_rose_fizz.webp";
import appleRoseFizzBg from "@/assets/drinks/apple-rose-fizz-bg.webp";
import citrusSunrise from "@/assets/drinks/new/citrus_sunrise.webp";
import citrusSunriseBg from "@/assets/drinks/citrus-sunrise-bg.webp";
import pinkAppleSparkle from "@/assets/drinks/new/pink_apple_sparkle.webp";
import pinkAppleSparkleBg from "@/assets/drinks/pink-apple-sparkle-bg.webp";
import goldenAppleTwist from "@/assets/drinks/new/golden_apple_twist.webp";
import goldenAppleTwistBg from "@/assets/drinks/golden-apple-twist-bg.webp";
import tropicalSunset from "@/assets/drinks/new/tropical_sunset.webp";
import tropicalSunsetBg from "@/assets/drinks/tropical-sunset-bg.webp";
import royalRoseCooler from "@/assets/drinks/new/royal_rose_cooler.webp";
import royalRoseCoolerBg from "@/assets/drinks/royal-rose-cooler-bg.webp";
import machinePhoto from "@/assets/backdrops/machine.webp";
import machineBackdrop from "@/assets/backdrops/machine-bg.webp";
import dispenseBayPhoto from "@/assets/backdrops/bay.webp";

// Photos bundled with the kiosk for the house recipes (originals in new/). An image uploaded in
// Admin (recipe.image_url) always wins over these. Each has a pre-softened
// "-bg" twin so screen backdrops need no live CSS blur on the Pi.
const BUNDLED_IMAGES: Record<string, { photo: string; backdrop: string }> = {
  "apple rose fizz": { photo: appleRoseFizz, backdrop: appleRoseFizzBg },
  "citrus sunrise": { photo: citrusSunrise, backdrop: citrusSunriseBg },
  "pink apple sparkle": { photo: pinkAppleSparkle, backdrop: pinkAppleSparkleBg },
  "golden apple twist": { photo: goldenAppleTwist, backdrop: goldenAppleTwistBg },
  "tropical sunset": { photo: tropicalSunset, backdrop: tropicalSunsetBg },
  "royal rose cooler": { photo: royalRoseCooler, backdrop: royalRoseCoolerBg },
};

export const FALLBACK_COLLAGE = [tropicalSunset, appleRoseFizz, royalRoseCooler];
export const HOUSE_BACKDROP = tropicalSunsetBg;
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
  "green apple juice": "#9BC53D",
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
  // Largest pours first. The API lists ingredients by id, not recipe order.
  const names = [...ingredients]
    .sort((a, b) => b.amount_ml - a.amount_ml)
    .map((i) => shortIngredientName(i.name));
  return Array.from(new Set(names)).slice(0, 3).join(" · ");
}
