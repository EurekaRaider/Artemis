import {
  SEMANTIC_TOKEN_REGISTRY,
  UI_CONTRACT_RANGE,
  assertValidSkinPackage,
} from "@artemis/theme-contract";

export const STRESS_SKIN_ID = "com.artemis.synthetic-stress";

const LIGHT_COLORS = {
  "color.canvas": "#fff0a6",
  "color.surface.base": "#fff9dc",
  "color.surface.raised": "#ffffff",
  "color.surface.sunken": "#ffd3f2",
  "color.text.primary": "#2a003c",
  "color.text.secondary": "#5b126d",
  "color.text.tertiary": "#762986",
  "color.border.default": "#9b238d",
  "color.border.strong": "#5c005d",
  "color.accent.primary": "#0057d9",
  "color.accent.hover": "#003f9e",
  "color.accent.text": "#003f9e",
  "color.accent.onPrimary": "#ffffff",
  "color.focus.ring": "#d9006c",
  "color.status.danger": "#b00020",
};
const DARK_COLORS = {
  "color.canvas": "#16002a",
  "color.surface.base": "#2c064d",
  "color.surface.raised": "#3a0c62",
  "color.surface.sunken": "#0b0015",
  "color.text.primary": "#fff6a6",
  "color.text.secondary": "#ffd3f2",
  "color.text.tertiary": "#ef9edd",
  "color.border.default": "#f05bd3",
  "color.border.strong": "#fff0a6",
  "color.accent.primary": "#66d9ff",
  "color.accent.hover": "#a7edff",
  "color.accent.text": "#a7edff",
  "color.accent.onPrimary": "#0b0015",
  "color.focus.ring": "#fff0a6",
  "color.status.danger": "#ff9da8",
};

function tokenValue(name, definition, theme, contrast) {
  switch (definition.kind) {
    case "color": {
      const overrides = theme === "light" ? LIGHT_COLORS : DARK_COLORS;
      if (contrast === "high") {
        if (name === "color.canvas" || name.includes("surface")) {
          return {
            kind: "color",
            value: theme === "light" ? "#ffffff" : "#000000",
          };
        }
        if (name === "color.text.primary") {
          return {
            kind: "color",
            value: theme === "light" ? "#000000" : "#ffffff",
          };
        }
      }
      return {
        kind: "color",
        value: overrides[name] ?? definition.fallback.value,
      };
    }
    case "length":
      return { kind: "length", value: definition.max, unit: "px" };
    case "fontFamily":
      return {
        kind: "fontFamily",
        value:
          name === "typography.mono.family" ? "system-mono" : "editorial-serif",
      };
    case "fontWeight":
      return { kind: "fontWeight", value: 700 };
    case "duration":
      return { kind: "duration", value: definition.max, unit: "ms" };
    case "easing":
      return { kind: "easing", value: "linear" };
    case "shadow":
      return { kind: "shadow", value: "overlay" };
    case "opacity":
      return { kind: "opacity", value: definition.max };
  }
}

function tokens(theme, contrast) {
  return Object.fromEntries(
    Object.entries(SEMANTIC_TOKEN_REGISTRY).map(([name, definition]) => [
      name,
      tokenValue(name, definition, theme, contrast),
    ]),
  );
}

function mode(theme, contrast) {
  return {
    theme,
    contrast,
    density: "compact",
    platform: "universal",
    tokens: tokens(theme, contrast),
  };
}

export const stressSkinManifest = Object.freeze({
  schemaVersion: 1,
  id: STRESS_SKIN_ID,
  name: "Synthetic Stress",
  version: "1.0.0",
  uiContract: UI_CONTRACT_RANGE,
  modes: ["light", "dark"],
  tokens: {
    light: "tokens.light.json",
    dark: "tokens.dark.json",
    contrast: "tokens.contrast.json",
  },
  capabilities: {
    contrastModes: ["normal", "high"],
    densities: ["compact"],
    platforms: ["universal"],
  },
});

export const stressLightTokens = Object.freeze({
  schemaVersion: 1,
  skinId: STRESS_SKIN_ID,
  modes: [mode("light", "normal")],
});
export const stressDarkTokens = Object.freeze({
  schemaVersion: 1,
  skinId: STRESS_SKIN_ID,
  modes: [mode("dark", "normal")],
});
export const stressContrastTokens = Object.freeze({
  schemaVersion: 1,
  skinId: STRESS_SKIN_ID,
  modes: [mode("light", "high"), mode("dark", "high")],
});

export const stressSkinTokenDocuments = Object.freeze({
  "tokens.light.json": stressLightTokens,
  "tokens.dark.json": stressDarkTokens,
  "tokens.contrast.json": stressContrastTokens,
});

export const stressSkinPackage = Object.freeze({
  manifest: stressSkinManifest,
  tokenDocuments: stressSkinTokenDocuments,
});

export const stressSkinDataFiles = Object.freeze({
  "manifest.json": stressSkinManifest,
  ...stressSkinTokenDocuments,
});
export const stressSkinIntegrity = Object.freeze({
  algorithm: "sha256",
  files: {
    "manifest.json":
      "6aefe92e8559145e2f9d25ff6c84c8d010a0754ba675024d24b97aa042898ad7",
    "tokens.light.json":
      "51b98cd4056f82b4ac2c8e620f58922d8c0ea894a8b427273187789d94f8390a",
    "tokens.dark.json":
      "e19fd953e69a9d601c9dec7875c350eac0b938c4411ae009f769f866bffb6b9e",
    "tokens.contrast.json":
      "2a0033e9fa7855dfd7fadfb2aca096e4dd5c0b01eb07db064f782a6d3956976f",
  },
});
export const stressSkinPackageFiles = Object.freeze({
  ...stressSkinDataFiles,
  "integrity.json": stressSkinIntegrity,
});

const validatedStressSkin = assertValidSkinPackage(stressSkinPackage);
const FONT_STACKS = {
  "system-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "system-mono": '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  "editorial-serif": '"New York", "Songti SC", Georgia, serif',
};
const EASINGS = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  entrance: "cubic-bezier(0, 0, 0, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  linear: "linear",
  shell: "cubic-bezier(0.16, 1, 0.3, 1)",
};
const SHADOWS = {
  none: "none",
  soft: "0 1px 3px #00000024",
  raised: "0 8px 24px #0000002e",
  overlay: "0 16px 48px #0000003d",
};

function cssValue(value) {
  switch (value.kind) {
    case "color":
      return value.value;
    case "length":
    case "duration":
      return `${value.value}${value.unit}`;
    case "fontFamily":
      return FONT_STACKS[value.value];
    case "fontWeight":
    case "opacity":
      return String(value.value);
    case "easing":
      return EASINGS[value.value];
    case "shadow":
      return SHADOWS[value.value];
    default:
      throw new Error("Unserializable synthetic token kind");
  }
}

function serializeStressCss() {
  const blocks = validatedStressSkin.modes.map((resolvedMode) => {
    const selector = `:root[data-artemis-skin="${STRESS_SKIN_ID}"][data-artemis-theme="${resolvedMode.theme}"][data-artemis-contrast="${resolvedMode.contrast}"]`;
    const declarations = Object.entries(SEMANTIC_TOKEN_REGISTRY).map(
      ([name, definition]) =>
        `  ${definition.cssVariable}: ${cssValue(resolvedMode.tokens[name])};`,
    );
    return `${selector} {\n${declarations.join("\n")}\n}`;
  });
  const css = `@layer artemis.theme {\n${blocks.join("\n\n")}\n}\n`;
  if (/url\s*\(|@import|https?:|data:/iu.test(css)) {
    throw new Error(
      "Synthetic stress CSS escaped the fixed serializer allowlist",
    );
  }
  return css;
}

export const stressSkinCss = serializeStressCss();
