/** Selected host material; Windows may still substitute its own DWM fallback. */
export type WindowMaterial = "vibrancy" | "acrylic" | "web" | "solid";

export type MaterialPreference = "glass" | "solid";
export function parseMaterialPreference(value: unknown): MaterialPreference {
  if (value !== "glass" && value !== "solid")
    throw new Error("Invalid interface material.");
  return value;
}
export function shouldUseSolidMaterial(preferences: {
  material?: MaterialPreference;
  reducedTransparency: boolean;
  highContrast: boolean;
  forcedColors: boolean;
}): boolean {
  return (
    preferences.material === "solid" ||
    preferences.reducedTransparency ||
    preferences.highContrast ||
    preferences.forcedColors
  );
}
