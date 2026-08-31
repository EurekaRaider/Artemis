import {
  SEMANTIC_TOKEN_REGISTRY,
  UI_CONTRACT_RANGE,
  assertValidSkinPackage,
  type ResolvedThemeMode,
  type SkinManifest,
  type ThemeTokenDocument,
  type ThemeTokenValue,
} from "@artemis/theme-contract";

export const ARTEMIS_SKIN_ID = "com.artemis.default" as const;
export const ARTEMIS_THEME_VERSION = "1.4.41" as const;

const color = (value: `#${string}`) => ({ kind: "color", value }) as const;
const length = (value: number) =>
  ({ kind: "length", value, unit: "px" }) as const;

const foundationTokens = {
  "space.1": length(4),
  "space.2": length(8),
  "space.3": length(12),
  "space.4": length(16),
  "space.6": length(24),
  "size.control.compact": length(28),
  "size.control.comfortable": length(36),
  "border.width.default": length(1),
  "radius.control": length(7),
  "radius.input": length(8),
  "radius.card": length(10),
  "radius.panel": length(10),
  "radius.composer": length(14),
  "typography.body.family": { kind: "fontFamily", value: "system-ui" },
  "typography.mono.family": { kind: "fontFamily", value: "system-mono" },
  "typography.display.family": { kind: "fontFamily", value: "system-ui" },
  "typography.body.size": length(13),
  "typography.label.size": length(12),
  "typography.body.weight": { kind: "fontWeight", value: 400 },
  "motion.duration.fast": { kind: "duration", value: 120, unit: "ms" },
  "motion.duration.normal": { kind: "duration", value: 180, unit: "ms" },
  "motion.duration.slow": { kind: "duration", value: 320, unit: "ms" },
  "motion.easing.standard": { kind: "easing", value: "standard" },
  "motion.easing.shell": { kind: "easing", value: "shell" },
  "shadow.card": { kind: "shadow", value: "soft" },
  "shadow.surface": { kind: "shadow", value: "soft" },
  "shadow.composer": { kind: "shadow", value: "raised" },
} as const satisfies Readonly<Record<string, ThemeTokenValue>>;

const lightColors = {
  "color.canvas": color("#f7f7f8"),
  "color.background.sidebar": color("#f1f2f4"),
  "color.background.activity": color("#ebecef"),
  "color.surface.base": color("#ffffff"),
  "color.surface.raised": color("#ffffff"),
  "color.surface.sunken": color("#eef0f3"),
  "color.surface.composer": color("#ffffff"),
  "color.surface.user": color("#eef0f3"),
  "color.interaction.hover": color("#0000000a"),
  "color.interaction.selected": color("#315e851a"),
  "color.text.primary": color("#1a1b1e"),
  "color.text.secondary": color("#5e626b"),
  "color.text.tertiary": color("#747983"),
  "color.text.inverse": color("#ffffff"),
  "color.border.default": color("#d5d7dc"),
  "color.border.subtle": color("#00000012"),
  "color.border.strong": color("#9ca1aa"),
  "color.accent.primary": color("#315e85"),
  "color.accent.hover": color("#254e70"),
  "color.accent.subtle": color("#315e851a"),
  "color.accent.text": color("#254e70"),
  "color.accent.onPrimary": color("#ffffff"),
  "color.focus.ring": color("#315e85"),
  "color.status.success": color("#2e6b4f"),
  "color.status.warning": color("#8a5b12"),
  "color.status.danger": color("#9b3434"),
  "color.status.info": color("#315e85"),
  "color.status.successSubtle": color("#2e6b4f1f"),
  "color.status.warningSubtle": color("#8a5b121f"),
  "color.status.dangerSubtle": color("#9b34341a"),
  "color.status.infoSubtle": color("#315e851a"),
  "color.status.onSuccess": color("#ffffff"),
  "color.status.onWarning": color("#ffffff"),
  "color.status.onDanger": color("#ffffff"),
  "color.status.onInfo": color("#ffffff"),
  "color.terminal.background": color("#16171a"),
  "color.terminal.foreground": color("#eceef1"),
  "color.diff.addBackground": color("#2e6b4f1a"),
  "color.diff.addText": color("#2e6b4f"),
  "color.diff.deleteBackground": color("#9b343414"),
  "color.diff.deleteText": color("#9b3434"),
} as const;

const darkColors = {
  "color.canvas": color("#151619"),
  "color.background.sidebar": color("#191a1d"),
  "color.background.activity": color("#111215"),
  "color.surface.base": color("#1d1f23"),
  "color.surface.raised": color("#25282d"),
  "color.surface.sunken": color("#101114"),
  "color.surface.composer": color("#222428"),
  "color.surface.user": color("#2b2e33"),
  "color.interaction.hover": color("#ffffff0e"),
  "color.interaction.selected": color("#8bb8dc24"),
  "color.text.primary": color("#f2f3f5"),
  "color.text.secondary": color("#a7abb3"),
  "color.text.tertiary": color("#858a94"),
  "color.text.inverse": color("#151619"),
  "color.border.default": color("#3c4048"),
  "color.border.subtle": color("#ffffff14"),
  "color.border.strong": color("#686e78"),
  "color.accent.primary": color("#8bb8dc"),
  "color.accent.hover": color("#a0c9e8"),
  "color.accent.subtle": color("#8bb8dc24"),
  "color.accent.text": color("#a0c9e8"),
  "color.accent.onPrimary": color("#10283c"),
  "color.focus.ring": color("#a9d6f5"),
  "color.status.success": color("#79c59f"),
  "color.status.warning": color("#e3b45f"),
  "color.status.danger": color("#ee9292"),
  "color.status.info": color("#8bb8dc"),
  "color.status.successSubtle": color("#79c59f24"),
  "color.status.warningSubtle": color("#e3b45f24"),
  "color.status.dangerSubtle": color("#ee929224"),
  "color.status.infoSubtle": color("#8bb8dc24"),
  "color.status.onSuccess": color("#102019"),
  "color.status.onWarning": color("#231a08"),
  "color.status.onDanger": color("#260e0e"),
  "color.status.onInfo": color("#10283c"),
  "color.terminal.background": color("#101114"),
  "color.terminal.foreground": color("#eceef1"),
  "color.diff.addBackground": color("#79c59f1f"),
  "color.diff.addText": color("#79c59f"),
  "color.diff.deleteBackground": color("#ee92921a"),
  "color.diff.deleteText": color("#ee9292"),
} as const;

const lightContrastColors = {
  ...lightColors,
  "color.canvas": color("#ffffff"),
  "color.text.primary": color("#000000"),
  "color.text.secondary": color("#343434"),
  "color.text.tertiary": color("#444444"),
  "color.border.default": color("#656565"),
  "color.border.strong": color("#1f1f1f"),
  "color.accent.primary": color("#174b74"),
  "color.focus.ring": color("#003f70"),
} as const;

const darkContrastColors = {
  ...darkColors,
  "color.canvas": color("#000000"),
  "color.surface.base": color("#111111"),
  "color.text.primary": color("#ffffff"),
  "color.text.secondary": color("#d8d8d8"),
  "color.text.tertiary": color("#c7c7c7"),
  "color.border.default": color("#9a9a9a"),
  "color.border.strong": color("#e0e0e0"),
  "color.accent.primary": color("#b7ddff"),
  "color.focus.ring": color("#d3eaff"),
} as const;

const mode = (
  theme: "light" | "dark",
  contrast: "normal" | "high",
  colors: Readonly<Record<string, ThemeTokenValue>>,
) =>
  ({
    theme,
    contrast,
    density: "comfortable",
    platform: "universal",
    tokens: { ...foundationTokens, ...colors },
  }) as const;

export const artemisThemeManifest = {
  schemaVersion: 1,
  id: ARTEMIS_SKIN_ID,
  name: "Artemis",
  version: ARTEMIS_THEME_VERSION,
  uiContract: UI_CONTRACT_RANGE,
  modes: ["light", "dark"],
  tokens: {
    light: "tokens.light.json",
    dark: "tokens.dark.json",
    contrast: "tokens.contrast.json",
  },
  capabilities: {
    contrastModes: ["normal", "high"],
    densities: ["comfortable"],
    platforms: ["universal"],
  },
} as const satisfies SkinManifest;

export const artemisLightTokens = {
  schemaVersion: 1,
  skinId: ARTEMIS_SKIN_ID,
  modes: [mode("light", "normal", lightColors)],
} as const satisfies ThemeTokenDocument;

export const artemisDarkTokens = {
  schemaVersion: 1,
  skinId: ARTEMIS_SKIN_ID,
  modes: [mode("dark", "normal", darkColors)],
} as const satisfies ThemeTokenDocument;

export const artemisContrastTokens = {
  schemaVersion: 1,
  skinId: ARTEMIS_SKIN_ID,
  modes: [
    mode("light", "high", lightContrastColors),
    mode("dark", "high", darkContrastColors),
  ],
} as const satisfies ThemeTokenDocument;

export const artemisTokenDocuments = {
  "tokens.light.json": artemisLightTokens,
  "tokens.dark.json": artemisDarkTokens,
  "tokens.contrast.json": artemisContrastTokens,
} as const;

const validatedTheme = assertValidSkinPackage({
  manifest: artemisThemeManifest,
  tokenDocuments: artemisTokenDocuments,
});

const FONT_STACKS = {
  "system-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "system-mono": '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  "editorial-serif": '"New York", "Songti SC", Georgia, serif',
} as const;
const EASINGS = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  entrance: "cubic-bezier(0, 0, 0, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  linear: "linear",
  shell: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
const SHADOWS = {
  none: "none",
  soft: "0 1px 3px #00000024",
  raised: "0 8px 24px #0000002e",
  overlay: "0 16px 48px #0000003d",
} as const;

function cssValue(token: ThemeTokenValue): string {
  switch (token.kind) {
    case "color":
      return token.value;
    case "length":
    case "duration":
      return `${token.value}${token.unit}`;
    case "fontFamily":
      return FONT_STACKS[token.value];
    case "fontWeight":
    case "opacity":
      return String(token.value);
    case "easing":
      return EASINGS[token.value];
    case "shadow":
      return SHADOWS[token.value];
  }
}

function selectorFor(themeMode: ResolvedThemeMode): string {
  return [
    `:root[data-artemis-skin="${ARTEMIS_SKIN_ID}"]`,
    `[data-artemis-theme="${themeMode.theme}"]`,
    `[data-artemis-contrast="${themeMode.contrast}"]`,
  ].join("");
}

function generateThemeCss(): string {
  const blocks = validatedTheme.modes.map((themeMode) => {
    const declarations = Object.entries(SEMANTIC_TOKEN_REGISTRY).map(
      ([name, definition]) =>
        `  ${definition.cssVariable}: ${cssValue(themeMode.tokens[name]!)};`,
    );
    return `${selectorFor(themeMode)} {\n${declarations.join("\n")}\n}`;
  });
  return `@layer artemis.theme {\n${blocks.join("\n\n")}\n}\n`;
}

export const artemisThemeCss = generateThemeCss();
export const artemisThemeFallbackTokens = validatedTheme.fallbackTokens;
