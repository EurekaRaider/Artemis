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
export const ARTEMIS_THEME_VERSION = "1.5.6" as const;

const color = (value: `#${string}`) => ({ kind: "color", value }) as const;
const length = (value: number) =>
  ({ kind: "length", value, unit: "px" }) as const;

const foundationTokens = {
  "space.1": length(4),
  "space.2": length(8),
  "space.3": length(12),
  "space.4": length(16),
  "space.5": length(20),
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
  "typography.body.size": length(14),
  "typography.label.size": length(12),
  "typography.metadata.size": length(11),
  "typography.body.weight": { kind: "fontWeight", value: 400 },
  "motion.duration.fast": { kind: "duration", value: 180, unit: "ms" },
  "motion.duration.normal": { kind: "duration", value: 320, unit: "ms" },
  "motion.duration.slow": { kind: "duration", value: 480, unit: "ms" },
  "motion.easing.standard": { kind: "easing", value: "standard" },
  "motion.easing.shell": { kind: "easing", value: "shell" },
  "shadow.card": { kind: "shadow", value: "none" },
  "shadow.surface": { kind: "shadow", value: "none" },
  "shadow.composer": { kind: "shadow", value: "none" },
  "shadow.overlay": { kind: "shadow", value: "overlay" },
  "opacity.disabled": { kind: "opacity", value: 0.42 },
} as const satisfies Readonly<Record<string, ThemeTokenValue>>;

const lightColors = {
  "color.canvas": color("#fafafa"),
  "color.background.sidebar": color("#f3f4f5"),
  "color.background.activity": color("#f3f4f5"),
  "color.surface.base": color("#ffffff"),
  "color.surface.raised": color("#ffffff"),
  "color.surface.sunken": color("#f5f5f5"),
  "color.surface.composer": color("#ffffff"),
  "color.surface.user": color("#f0f1f2"),
  "color.interaction.hover": color("#27272a0d"),
  "color.interaction.selected": color("#0a0a0a1a"),
  "color.text.primary": color("#27272a"),
  "color.text.secondary": color("#60646c"),
  "color.text.tertiary": color("#717680"),
  "color.text.inverse": color("#fafafa"),
  "color.border.default": color("#0a0a0a1a"),
  "color.border.surface": color("#0a0a0a1a"),
  "color.border.subtle": color("#0a0a0a0f"),
  "color.border.strong": color("#717680"),
  "color.accent.primary": color("#171717"),
  "color.accent.hover": color("#262626"),
  "color.accent.subtle": color("#1717171a"),
  "color.accent.text": color("#171717"),
  "color.accent.onPrimary": color("#fafafa"),
  "color.focus.ring": color("#0369a1"),
  "color.status.success": color("#16a34a"),
  "color.status.warning": color("#ca8a04"),
  "color.status.danger": color("#dc2626"),
  "color.status.info": color("#0369a1"),
  "color.status.successSubtle": color("#16a34a24"),
  "color.status.warningSubtle": color("#ca8a0424"),
  "color.status.dangerSubtle": color("#dc26261a"),
  "color.status.infoSubtle": color("#0369a11a"),
  "color.status.onSuccess": color("#ffffff"),
  "color.status.onWarning": color("#ffffff"),
  "color.status.onDanger": color("#ffffff"),
  "color.status.onInfo": color("#ffffff"),
  "color.terminal.background": color("#fafafa"),
  "color.terminal.foreground": color("#0a0a0a"),
  "color.diff.addBackground": color("#16a34a1a"),
  "color.diff.addText": color("#12702f"),
  "color.diff.deleteBackground": color("#dc26261a"),
  "color.diff.deleteText": color("#b91c1c"),
  "color.overlay.scrim": color("#00000052"),
  "color.selection.background": color("#1717171a"),
  "color.selection.text": color("#27272a"),
  "color.surface.header": color("#fafafa"),
  "color.surface.dock": color("#ffffff"),
  "color.surface.popover": color("#ffffff"),
  "color.surface.composerHead": color("#f5f5f5"),
  "color.switch.on": color("#22c55e"),
  "color.brand": color("#0369a1"),
  "color.goal": color("#b8860b"),
  "color.status.successText": color("#12702f"),
  "color.status.warningText": color("#8a5406"),
  "color.status.dangerText": color("#b91c1c"),
  "color.context.1": color("#0284c7"),
  "color.context.2": color("#0ea5e9"),
  "color.context.3": color("#38bdf8"),
  "color.context.4": color("#7dd3fc"),
  "color.context.5": color("#bae6fd"),
  "color.context.6": color("#e0f2fe"),
  "color.context.systemPrompt": color("#5856d6"),
  "color.context.systemTools": color("#00a4d6"),
  "color.context.mcpTools": color("#af52de"),
  "color.context.customAgents": color("#e0448b"),
  "color.context.memoryFiles": color("#e8ae00"),
  "color.context.skills": color("#ff9500"),
  "color.context.messages": color("#007aff"),
  "color.context.freeSpace": color("#d9dcdf"),
  "color.context.autocompactBuffer": color("#afb4bd"),
  "color.usage.1": color("#0284c7"),
  "color.usage.2": color("#0f766e"),
  "color.usage.3": color("#7c3aed"),
  "color.usage.4": color("#e11d48"),
} as const;

const darkColors = {
  "color.canvas": color("#141414"),
  "color.background.sidebar": color("#1d1d1d"),
  "color.background.activity": color("#1d1d1d"),
  "color.surface.base": color("#202020"),
  "color.surface.raised": color("#2b2b2b"),
  "color.surface.sunken": color("#262626"),
  "color.surface.composer": color("#262626"),
  "color.surface.user": color("#303030"),
  "color.interaction.hover": color("#e5e5e51a"),
  "color.interaction.selected": color("#e5e5e51a"),
  "color.text.primary": color("#e5e5e5"),
  "color.text.secondary": color("#a8a8ad"),
  "color.text.tertiary": color("#898990"),
  "color.text.inverse": color("#0a0a0a"),
  "color.border.default": color("#fafafa1a"),
  "color.border.surface": color("#fafafa1a"),
  "color.border.subtle": color("#fafafa0f"),
  "color.border.strong": color("#898990"),
  "color.accent.primary": color("#f5f5f5"),
  "color.accent.hover": color("#e5e5e5"),
  "color.accent.subtle": color("#f5f5f51a"),
  "color.accent.text": color("#f5f5f5"),
  "color.accent.onPrimary": color("#0a0a0a"),
  "color.focus.ring": color("#38bdf8"),
  "color.status.success": color("#22c55e"),
  "color.status.warning": color("#eab308"),
  "color.status.danger": color("#ef4444"),
  "color.status.info": color("#38bdf8"),
  "color.status.successSubtle": color("#22c55e24"),
  "color.status.warningSubtle": color("#eab30824"),
  "color.status.dangerSubtle": color("#ef44441a"),
  "color.status.infoSubtle": color("#38bdf81a"),
  "color.status.onSuccess": color("#052e16"),
  "color.status.onWarning": color("#1d1d1f"),
  "color.status.onDanger": color("#1d1d1f"),
  "color.status.onInfo": color("#0a0a0a"),
  "color.terminal.background": color("#0a0a0a"),
  "color.terminal.foreground": color("#fafafa"),
  "color.diff.addBackground": color("#22c55e1a"),
  "color.diff.addText": color("#4ade80"),
  "color.diff.deleteBackground": color("#ef44441a"),
  "color.diff.deleteText": color("#ff8a8a"),
  "color.overlay.scrim": color("#00000052"),
  "color.selection.background": color("#f5f5f51a"),
  "color.selection.text": color("#e5e5e5"),
  "color.surface.header": color("#141414"),
  "color.surface.dock": color("#141414"),
  "color.surface.popover": color("#2b2b2b"),
  "color.surface.composerHead": color("#303030"),
  "color.switch.on": color("#22c55e"),
  "color.brand": color("#38bdf8"),
  "color.goal": color("#e7c664"),
  "color.status.successText": color("#4ade80"),
  "color.status.warningText": color("#facc15"),
  "color.status.dangerText": color("#ff8a8a"),
  "color.context.1": color("#0ea5e9"),
  "color.context.2": color("#38bdf8"),
  "color.context.3": color("#55cbfa"),
  "color.context.4": color("#7dd3fc"),
  "color.context.5": color("#9ce0fd"),
  "color.context.6": color("#bae6fd"),
  "color.context.systemPrompt": color("#7d7aff"),
  "color.context.systemTools": color("#40c8f5"),
  "color.context.mcpTools": color("#bf5af2"),
  "color.context.customAgents": color("#ff648f"),
  "color.context.memoryFiles": color("#ffd60a"),
  "color.context.skills": color("#ff9f0a"),
  "color.context.messages": color("#0a84ff"),
  "color.context.freeSpace": color("#46494f"),
  "color.context.autocompactBuffer": color("#737982"),
  "color.usage.1": color("#38bdf8"),
  "color.usage.2": color("#2dd4bf"),
  "color.usage.3": color("#a78bfa"),
  "color.usage.4": color("#fb7185"),
} as const;

const lightContrastColors = {
  ...lightColors,
  "color.text.secondary": color("#3a3a3c"),
  "color.text.tertiary": color("#55555c"),
  "color.border.default": color("#0000004d"),
  "color.border.surface": color("#0000004d"),
  "color.border.subtle": color("#0000002e"),
  "color.border.strong": color("#55555c"),
} as const;

const darkContrastColors = {
  ...darkColors,
  "color.text.secondary": color("#dcdce0"),
  "color.text.tertiary": color("#bdbdc2"),
  "color.border.default": color("#ffffff5c"),
  "color.border.surface": color("#ffffff5c"),
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
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  "system-mono":
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
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
