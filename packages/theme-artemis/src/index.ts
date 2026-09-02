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
export const ARTEMIS_THEME_VERSION = "1.4.54" as const;

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
  "radius.control": length(8),
  "radius.input": length(10),
  "radius.card": length(12),
  "radius.panel": length(16),
  "radius.composer": length(18),
  "radius.pill": length(999),
  "typography.body.family": { kind: "fontFamily", value: "system-ui" },
  "typography.mono.family": { kind: "fontFamily", value: "system-mono" },
  "typography.display.family": { kind: "fontFamily", value: "system-ui" },
  "typography.body.size": length(13.5),
  "typography.label.size": length(12),
  "typography.body.weight": { kind: "fontWeight", value: 400 },
  "motion.duration.fast": { kind: "duration", value: 180, unit: "ms" },
  "motion.duration.normal": { kind: "duration", value: 320, unit: "ms" },
  "motion.duration.slow": { kind: "duration", value: 480, unit: "ms" },
  "motion.easing.standard": { kind: "easing", value: "standard" },
  "motion.easing.shell": { kind: "easing", value: "shell" },
  "shadow.card": { kind: "shadow", value: "none" },
  "shadow.surface": { kind: "shadow", value: "none" },
  "shadow.composer": { kind: "shadow", value: "raised" },
  "shadow.overlay": { kind: "shadow", value: "overlay" },
  "opacity.disabled": { kind: "opacity", value: 0.42 },
} as const satisfies Readonly<Record<string, ThemeTokenValue>>;

const lightColors = {
  "color.canvas": color("#f5f5f7"),
  "color.background.sidebar": color("#f0f0f2"),
  "color.background.activity": color("#ebebef"),
  "color.surface.base": color("#ffffff"),
  "color.surface.raised": color("#ffffff"),
  "color.surface.sunken": color("#f5f5f7"),
  "color.surface.composer": color("#ffffff"),
  "color.surface.user": color("#f0f0f2"),
  "color.interaction.hover": color("#0000000b"),
  "color.interaction.selected": color("#0071e314"),
  "color.text.primary": color("#1d1d1f"),
  "color.text.secondary": color("#5a5a60"),
  "color.text.tertiary": color("#68686c"),
  "color.text.inverse": color("#f5f5f7"),
  "color.border.default": color("#0000006b"),
  "color.border.subtle": color("#00000012"),
  "color.border.strong": color("#68686c"),
  "color.accent.primary": color("#0071e3"),
  "color.accent.hover": color("#0071e3"),
  "color.accent.subtle": color("#0071e31a"),
  "color.accent.text": color("#0056ae"),
  "color.accent.onPrimary": color("#ffffff"),
  "color.focus.ring": color("#0071e3"),
  "color.status.success": color("#23843b"),
  "color.status.warning": color("#b25000"),
  "color.status.danger": color("#d70015"),
  "color.status.info": color("#0071e3"),
  "color.status.successSubtle": color("#34c75924"),
  "color.status.warningSubtle": color("#ff9f0a29"),
  "color.status.dangerSubtle": color("#ff3b301a"),
  "color.status.infoSubtle": color("#0071e31a"),
  "color.status.onSuccess": color("#ffffff"),
  "color.status.onWarning": color("#ffffff"),
  "color.status.onDanger": color("#ffffff"),
  "color.status.onInfo": color("#ffffff"),
  "color.terminal.background": color("#1d1d1f"),
  "color.terminal.foreground": color("#e8e8ed"),
  "color.diff.addBackground": color("#34c7591a"),
  "color.diff.addText": color("#1d6c30"),
  "color.diff.deleteBackground": color("#ff3b3014"),
  "color.diff.deleteText": color("#c80014"),
  "color.overlay.scrim": color("#00000052"),
  "color.selection.background": color("#0071e31a"),
  "color.selection.text": color("#1d1d1f"),
} as const;

const darkColors = {
  "color.canvas": color("#1d1d1f"),
  "color.background.sidebar": color("#1a1a1c"),
  "color.background.activity": color("#17171a"),
  "color.surface.base": color("#232325"),
  "color.surface.raised": color("#272729"),
  "color.surface.sunken": color("#1a1a1c"),
  "color.surface.composer": color("#272729"),
  "color.surface.user": color("#2c2c2f"),
  "color.interaction.hover": color("#ffffff0e"),
  "color.interaction.selected": color("#2997ff24"),
  "color.text.primary": color("#f5f5f7"),
  "color.text.secondary": color("#bcbcc1"),
  "color.text.tertiary": color("#a6a6aa"),
  "color.text.inverse": color("#1d1d1f"),
  "color.border.default": color("#ffffff5c"),
  "color.border.subtle": color("#ffffff14"),
  "color.border.strong": color("#a6a6aa"),
  "color.accent.primary": color("#2077c9"),
  "color.accent.hover": color("#2076c7"),
  "color.accent.subtle": color("#2997ff29"),
  "color.accent.text": color("#89b7e2"),
  "color.accent.onPrimary": color("#ffffff"),
  "color.focus.ring": color("#89b7e2"),
  "color.status.success": color("#30d158"),
  "color.status.warning": color("#ffd60a"),
  "color.status.danger": color("#ff453a"),
  "color.status.info": color("#2077c9"),
  "color.status.successSubtle": color("#30d15826"),
  "color.status.warningSubtle": color("#ff9f0a29"),
  "color.status.dangerSubtle": color("#ff453a21"),
  "color.status.infoSubtle": color("#2997ff29"),
  "color.status.onSuccess": color("#0e1510"),
  "color.status.onWarning": color("#1d1d1f"),
  "color.status.onDanger": color("#1d1d1f"),
  "color.status.onInfo": color("#ffffff"),
  "color.terminal.background": color("#141416"),
  "color.terminal.foreground": color("#e8e8ed"),
  "color.diff.addBackground": color("#30d1581f"),
  "color.diff.addText": color("#30d158"),
  "color.diff.deleteBackground": color("#ff453a1a"),
  "color.diff.deleteText": color("#ff8179"),
  "color.overlay.scrim": color("#00000052"),
  "color.selection.background": color("#2997ff29"),
  "color.selection.text": color("#f5f5f7"),
} as const;

const lightContrastColors = {
  ...lightColors,
  "color.text.secondary": color("#3a3a3c"),
  "color.text.tertiary": color("#55555c"),
  "color.border.default": color("#00000080"),
  "color.border.subtle": color("#0000002e"),
  "color.border.strong": color("#55555c"),
} as const;

const darkContrastColors = {
  ...darkColors,
  "color.text.secondary": color("#dcdce0"),
  "color.text.tertiary": color("#bdbdc2"),
  "color.border.default": color("#ffffff80"),
  "color.border.subtle": color("#ffffff38"),
  "color.border.strong": color("#bdbdc2"),
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
  "system-ui":
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", sans-serif',
  "system-mono":
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  "editorial-serif": '"New York", "Songti SC", Georgia, serif',
} as const;
const EASINGS = {
  standard: "cubic-bezier(0.32, 0.72, 0, 1)",
  entrance: "cubic-bezier(0, 0, 0, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  linear: "linear",
  shell: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
const SHADOWS = {
  light: {
    none: "none",
    soft: "0 1px 2px #0000000a",
    raised: "0 10px 36px #0000002e",
    overlay: "0 12px 40px #00000029, 0 2px 8px #0000000f",
  },
  dark: {
    none: "none",
    soft: "0 1px 2px #00000040",
    raised: "0 10px 36px #00000066",
    overlay: "0 12px 40px #00000080, 0 2px 8px #0000004d",
  },
} as const;

function cssValue(
  token: ThemeTokenValue,
  theme: ResolvedThemeMode["theme"],
): string {
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
      return SHADOWS[theme][token.value];
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
        `  ${definition.cssVariable}: ${cssValue(themeMode.tokens[name]!, themeMode.theme)};`,
    );
    return `${selectorFor(themeMode)} {\n${declarations.join("\n")}\n}`;
  });
  return `@layer artemis.theme {\n${blocks.join("\n\n")}\n}\n`;
}

export const artemisThemeCss = generateThemeCss();
export const artemisThemeFallbackTokens = validatedTheme.fallbackTokens;
