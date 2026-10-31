import {
  SEMANTIC_TOKEN_REGISTRY,
  SKIN_FONT_STACKS,
  UI_CONTRACT_RANGE,
  assertValidSkinPackage,
  type ResolvedThemeMode,
  type SkinManifest,
  type ThemeTokenDocument,
  type ThemeTokenValue,
} from "@artemis/theme-contract";

export const ARTEMIS_SKIN_ID = "com.artemis.default" as const;
export const ARTEMIS_THEME_VERSION = "1.7.20" as const;

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
  "size.control.compact": length(26),
  "size.control.comfortable": length(30),
  "border.width.default": length(1),
  "radius.control": length(8),
  "radius.input": length(8),
  "radius.card": length(12),
  "radius.panel": length(16),
  "radius.composer": length(16),
  "radius.pill": length(999),
  "typography.body.family": { kind: "fontFamily", value: "geist" },
  "typography.mono.family": { kind: "fontFamily", value: "geist-mono" },
  "typography.display.family": { kind: "fontFamily", value: "geist" },
  "typography.body.size": length(13),
  "typography.label.size": length(11.5),
  "typography.metadata.size": length(11.5),
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
  "color.canvas": color("#ffffff"),
  "color.background.sidebar": color("#f4f4f5"),
  "color.background.activity": color("#f4f4f5"),
  "color.surface.base": color("#ffffff"),
  "color.surface.raised": color("#ffffff"),
  "color.surface.sunken": color("#f2f2f4"),
  "color.surface.composer": color("#ffffff"),
  "color.surface.user": color("#f2f2f4"),
  "color.interaction.hover": color("#1112160b"),
  "color.interaction.selected": color("#f2f2f4"),
  "color.text.primary": color("#16171a"),
  "color.text.secondary": color("#575b65"),
  "color.text.tertiary": color("#686c76"),
  "color.text.inverse": color("#ffffff"),
  "color.border.default": color("#11121624"),
  "color.border.surface": color("#11121624"),
  "color.border.subtle": color("#11121614"),
  "color.border.strong": color("#686c76"),
  "color.accent.primary": color("#16171a"),
  "color.accent.hover": color("#212329"),
  "color.accent.subtle": color("#16171a1a"),
  "color.accent.text": color("#16171a"),
  "color.accent.onPrimary": color("#ffffff"),
  "color.focus.ring": color("#8f5f00"),
  "color.status.success": color("#187a4b"),
  "color.status.warning": color("#8f5f00"),
  "color.status.danger": color("#c93a32"),
  "color.status.info": color("#2f5bd3"),
  "color.status.successSubtle": color("#e6f4ec"),
  "color.status.warningSubtle": color("#fbf2df"),
  "color.status.dangerSubtle": color("#fcecea"),
  "color.status.infoSubtle": color("#eaf0fd"),
  "color.status.onSuccess": color("#ffffff"),
  "color.status.onWarning": color("#ffffff"),
  "color.status.onDanger": color("#ffffff"),
  "color.status.onInfo": color("#ffffff"),
  "color.terminal.background": color("#fafafa"),
  "color.terminal.foreground": color("#0a0a0a"),
  "color.diff.addBackground": color("#e7f6ee"),
  "color.diff.addText": color("#187a4b"),
  "color.diff.deleteBackground": color("#fdedec"),
  "color.diff.deleteText": color("#c83a32"),
  "color.overlay.scrim": color("#f4f4f5b8"),
  "color.selection.background": color("#16171a1a"),
  "color.selection.text": color("#16171a"),
  "color.surface.header": color("#ffffff"),
  "color.surface.dock": color("#ffffff"),
  "color.surface.popover": color("#ffffff"),
  "color.surface.composerHead": color("#f2f2f4"),
  "color.switch.on": color("#16171a"),
  "color.brand": color("#c08a1e"),
  "color.goal": color("#c08a1e"),
  "color.status.successText": color("#187a4b"),
  "color.status.warningText": color("#8f5f00"),
  "color.status.dangerText": color("#c93a32"),
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
  "color.context.memoryFiles": color("#5576b7"),
  "color.context.skills": color("#738ebf"),
  "color.context.messages": color("#007aff"),
  "color.context.freeSpace": color("#d9dcdf"),
  "color.context.autocompactBuffer": color("#afb4bd"),
  "color.usage.1": color("#2f5bd3"),
  "color.usage.2": color("#5579dd"),
  "color.usage.3": color("#809be6"),
  "color.usage.4": color("#afc0ef"),
} as const;

const darkColors = {
  "color.canvas": color("#141519"),
  "color.background.sidebar": color("#0e0f12"),
  "color.background.activity": color("#0e0f12"),
  "color.surface.base": color("#1a1b20"),
  "color.surface.raised": color("#1a1b20"),
  "color.surface.sunken": color("#212329"),
  "color.surface.composer": color("#1a1b20"),
  "color.surface.user": color("#212329"),
  "color.interaction.hover": color("#ffffff0d"),
  "color.interaction.selected": color("#212329"),
  "color.text.primary": color("#ecedef"),
  "color.text.secondary": color("#a9adb6"),
  "color.text.tertiary": color("#878c96"),
  "color.text.inverse": color("#121317"),
  "color.border.default": color("#ffffff1f"),
  "color.border.surface": color("#ffffff1f"),
  "color.border.subtle": color("#ffffff12"),
  "color.border.strong": color("#878c96"),
  "color.accent.primary": color("#ecedef"),
  "color.accent.hover": color("#ffffff"),
  "color.accent.subtle": color("#ecedef1a"),
  "color.accent.text": color("#ecedef"),
  "color.accent.onPrimary": color("#121317"),
  "color.focus.ring": color("#f2c877"),
  "color.status.success": color("#5bc793"),
  "color.status.warning": color("#e8b65a"),
  "color.status.danger": color("#f2736b"),
  "color.status.info": color("#8fb0ff"),
  "color.status.successSubtle": color("#5bc7931f"),
  "color.status.warningSubtle": color("#e8b65a1f"),
  "color.status.dangerSubtle": color("#f2736b1f"),
  "color.status.infoSubtle": color("#8fb0ff1f"),
  "color.status.onSuccess": color("#052e16"),
  "color.status.onWarning": color("#1d1d1f"),
  "color.status.onDanger": color("#1d1d1f"),
  "color.status.onInfo": color("#0a0a0a"),
  "color.terminal.background": color("#0a0a0a"),
  "color.terminal.foreground": color("#fafafa"),
  "color.diff.addBackground": color("#5bc7931c"),
  "color.diff.addText": color("#5bc793"),
  "color.diff.deleteBackground": color("#f2736b1c"),
  "color.diff.deleteText": color("#f2736b"),
  "color.overlay.scrim": color("#060709a8"),
  "color.selection.background": color("#ecedef1a"),
  "color.selection.text": color("#ecedef"),
  "color.surface.header": color("#141519"),
  "color.surface.dock": color("#141519"),
  "color.surface.popover": color("#1d1e23"),
  "color.surface.composerHead": color("#212329"),
  "color.switch.on": color("#ecedef"),
  "color.brand": color("#e8b65a"),
  "color.goal": color("#e8b65a"),
  "color.status.successText": color("#5bc793"),
  "color.status.warningText": color("#f2c877"),
  "color.status.dangerText": color("#f2736b"),
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
  "color.context.memoryFiles": color("#9bb8ec"),
  "color.context.skills": color("#789bcf"),
  "color.context.messages": color("#0a84ff"),
  "color.context.freeSpace": color("#46494f"),
  "color.context.autocompactBuffer": color("#737982"),
  "color.usage.1": color("#8fb0ff"),
  "color.usage.2": color("#6f90dc"),
  "color.usage.3": color("#506dae"),
  "color.usage.4": color("#364c7d"),
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

const FONT_STACKS = SKIN_FONT_STACKS;
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
