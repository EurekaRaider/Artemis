import type { WindowMaterial } from "../../shared/window-material.js";

export interface WindowsMaterialPreferences {
  release: string;
  dark: boolean;
  reducedTransparency: boolean;
  highContrast: boolean;
  forcedColors: boolean;
}

export function windowsTitleBarOverlay(dark: boolean) {
  return {
    color: "#00000000",
    symbolColor: dark ? "#ededed" : "#222222",
    height: 48,
  };
}

export function windowsWindowMaterial(
  preferences: WindowsMaterialPreferences,
): WindowMaterial {
  if (
    preferences.reducedTransparency ||
    preferences.highContrast ||
    preferences.forcedColors
  )
    return "solid";
  const [major = 0, , build = 0] = preferences.release.split(".").map(Number);
  return major >= 10 && build >= 22621 ? "acrylic" : "web";
}

// Only the main window has transparent renderer surfaces. Auxiliary windows
// retain their existing opaque background and native window behavior.
export function applyWindowsWindowMaterial(
  window: {
    setBackgroundMaterial(material: "acrylic" | "none"): void;
    setBackgroundColor(color: string): void;
  },
  preferences: WindowsMaterialPreferences,
): WindowMaterial {
  let material = windowsWindowMaterial(preferences);
  if (
    material === "acrylic" ||
    Number(preferences.release.split(".")[2]) >= 22621
  ) {
    try {
      window.setBackgroundMaterial(material === "acrylic" ? "acrylic" : "none");
    } catch {
      material = material === "solid" ? "solid" : "web";
    }
  }
  window.setBackgroundColor(
    material === "acrylic"
      ? "#00000000"
      : preferences.dark
        ? "#0f1012"
        : "#f7f7f6",
  );
  return material;
}
