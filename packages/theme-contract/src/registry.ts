import type { SemanticTokenDefinition, ThemeTokenValue } from "./types.js";

const color = (value: `#${string}`, required = true) =>
  ({
    kind: "color",
    required,
    fallback: { kind: "color", value },
  }) as const;

const length = (value: number, min: number, max: number, required = true) =>
  ({
    kind: "length",
    required,
    fallback: { kind: "length", value, unit: "px" },
    min,
    max,
  }) as const;

export const SEMANTIC_TOKEN_REGISTRY = {
  "color.canvas": {
    ...color("#f7f7f8"),
    cssVariable: "--artemis-color-canvas",
  },
  "color.background.sidebar": {
    ...color("#f1f2f4"),
    cssVariable: "--artemis-color-background-sidebar",
  },
  "color.background.activity": {
    ...color("#ebecef"),
    cssVariable: "--artemis-color-background-activity",
  },
  "color.surface.base": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-surface-base",
  },
  "color.surface.raised": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-surface-raised",
  },
  "color.surface.sunken": {
    ...color("#eef0f3"),
    cssVariable: "--artemis-color-surface-sunken",
  },
  "color.surface.composer": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-surface-composer",
  },
  "color.surface.user": {
    ...color("#eef0f3"),
    cssVariable: "--artemis-color-surface-user",
  },
  "color.interaction.hover": {
    ...color("#0000000a"),
    cssVariable: "--artemis-color-interaction-hover",
  },
  "color.interaction.selected": {
    ...color("#315e851a"),
    cssVariable: "--artemis-color-interaction-selected",
  },
  "color.text.primary": {
    ...color("#1a1b1e"),
    cssVariable: "--artemis-color-text-primary",
  },
  "color.text.secondary": {
    ...color("#5e626b"),
    cssVariable: "--artemis-color-text-secondary",
  },
  "color.text.tertiary": {
    ...color("#747983"),
    cssVariable: "--artemis-color-text-tertiary",
  },
  "color.text.inverse": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-text-inverse",
  },
  "color.border.default": {
    ...color("#d5d7dc"),
    cssVariable: "--artemis-color-border-default",
  },
  "color.border.subtle": {
    ...color("#00000012"),
    cssVariable: "--artemis-color-border-subtle",
  },
  "color.border.strong": {
    ...color("#9ca1aa"),
    cssVariable: "--artemis-color-border-strong",
  },
  "color.accent.primary": {
    ...color("#315e85"),
    cssVariable: "--artemis-color-accent-primary",
  },
  "color.accent.hover": {
    ...color("#254e70"),
    cssVariable: "--artemis-color-accent-hover",
  },
  "color.accent.subtle": {
    ...color("#315e851a"),
    cssVariable: "--artemis-color-accent-subtle",
  },
  "color.accent.text": {
    ...color("#254e70"),
    cssVariable: "--artemis-color-accent-text",
  },
  "color.accent.onPrimary": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-accent-on-primary",
  },
  "color.focus.ring": {
    ...color("#315e85"),
    cssVariable: "--artemis-color-focus-ring",
  },
  "color.status.success": {
    ...color("#2e6b4f"),
    cssVariable: "--artemis-color-status-success",
  },
  "color.status.warning": {
    ...color("#8a5b12"),
    cssVariable: "--artemis-color-status-warning",
  },
  "color.status.danger": {
    ...color("#9b3434"),
    cssVariable: "--artemis-color-status-danger",
  },
  "color.status.info": {
    ...color("#315e85"),
    cssVariable: "--artemis-color-status-info",
  },
  "color.status.successSubtle": {
    ...color("#2e6b4f1f"),
    cssVariable: "--artemis-color-status-success-subtle",
  },
  "color.status.warningSubtle": {
    ...color("#8a5b121f"),
    cssVariable: "--artemis-color-status-warning-subtle",
  },
  "color.status.dangerSubtle": {
    ...color("#9b34341a"),
    cssVariable: "--artemis-color-status-danger-subtle",
  },
  "color.status.infoSubtle": {
    ...color("#315e851a"),
    cssVariable: "--artemis-color-status-info-subtle",
  },
  "color.status.onSuccess": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-status-on-success",
  },
  "color.status.onWarning": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-status-on-warning",
  },
  "color.status.onDanger": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-status-on-danger",
  },
  "color.status.onInfo": {
    ...color("#ffffff"),
    cssVariable: "--artemis-color-status-on-info",
  },
  "color.terminal.background": {
    ...color("#16171a"),
    cssVariable: "--artemis-color-terminal-background",
  },
  "color.terminal.foreground": {
    ...color("#eceef1"),
    cssVariable: "--artemis-color-terminal-foreground",
  },
  "color.diff.addBackground": {
    ...color("#2e6b4f1a"),
    cssVariable: "--artemis-color-diff-add-background",
  },
  "color.diff.addText": {
    ...color("#2e6b4f"),
    cssVariable: "--artemis-color-diff-add-text",
  },
  "color.diff.deleteBackground": {
    ...color("#9b343414"),
    cssVariable: "--artemis-color-diff-delete-background",
  },
  "color.diff.deleteText": {
    ...color("#9b3434"),
    cssVariable: "--artemis-color-diff-delete-text",
  },
  "color.overlay.scrim": {
    ...color("#00000099", false),
    cssVariable: "--artemis-color-overlay-scrim",
  },
  "color.selection.background": {
    ...color("#d7e8f5", false),
    cssVariable: "--artemis-color-selection-background",
  },
  "color.selection.text": {
    ...color("#10283c", false),
    cssVariable: "--artemis-color-selection-text",
  },
  "space.1": {
    ...length(4, 0, 16),
    cssVariable: "--artemis-space-1",
  },
  "space.2": {
    ...length(8, 0, 24),
    cssVariable: "--artemis-space-2",
  },
  "space.3": {
    ...length(12, 0, 32),
    cssVariable: "--artemis-space-3",
  },
  "space.4": {
    ...length(16, 0, 40),
    cssVariable: "--artemis-space-4",
  },
  "space.6": {
    ...length(24, 0, 56),
    cssVariable: "--artemis-space-6",
  },
  "size.control.compact": {
    ...length(28, 24, 40),
    cssVariable: "--artemis-size-control-compact",
  },
  "size.control.comfortable": {
    ...length(36, 28, 52),
    cssVariable: "--artemis-size-control-comfortable",
  },
  "border.width.default": {
    ...length(1, 0, 4),
    cssVariable: "--artemis-border-width-default",
  },
  "radius.control": {
    ...length(7, 0, 24),
    cssVariable: "--artemis-radius-control",
  },
  "radius.input": {
    ...length(8, 0, 24),
    cssVariable: "--artemis-radius-input",
  },
  "radius.card": {
    ...length(10, 0, 32),
    cssVariable: "--artemis-radius-card",
  },
  "radius.panel": {
    ...length(10, 0, 32),
    cssVariable: "--artemis-radius-panel",
  },
  "radius.composer": {
    ...length(14, 0, 40),
    cssVariable: "--artemis-radius-composer",
  },
  "radius.pill": {
    ...length(999, 100, 999, false),
    cssVariable: "--artemis-radius-pill",
  },
  "typography.body.family": {
    kind: "fontFamily",
    required: true,
    cssVariable: "--artemis-typography-body-family",
    fallback: { kind: "fontFamily", value: "system-ui" },
    allowedValues: ["system-ui", "system-mono", "editorial-serif"],
  },
  "typography.mono.family": {
    kind: "fontFamily",
    required: true,
    cssVariable: "--artemis-typography-mono-family",
    fallback: { kind: "fontFamily", value: "system-mono" },
    allowedValues: ["system-ui", "system-mono", "editorial-serif"],
  },
  "typography.display.family": {
    kind: "fontFamily",
    required: true,
    cssVariable: "--artemis-typography-display-family",
    fallback: { kind: "fontFamily", value: "system-ui" },
    allowedValues: ["system-ui", "system-mono", "editorial-serif"],
  },
  "typography.body.size": {
    ...length(13, 11, 20),
    cssVariable: "--artemis-typography-body-size",
  },
  "typography.label.size": {
    ...length(12, 10, 18),
    cssVariable: "--artemis-typography-label-size",
  },
  "typography.body.weight": {
    kind: "fontWeight",
    required: true,
    cssVariable: "--artemis-typography-body-weight",
    fallback: { kind: "fontWeight", value: 400 },
    allowedValues: [400, 500, 600, 700],
  },
  "motion.duration.fast": {
    kind: "duration",
    required: true,
    cssVariable: "--artemis-motion-duration-fast",
    fallback: { kind: "duration", value: 120, unit: "ms" },
    min: 0,
    max: 400,
  },
  "motion.duration.normal": {
    kind: "duration",
    required: true,
    cssVariable: "--artemis-motion-duration-normal",
    fallback: { kind: "duration", value: 180, unit: "ms" },
    min: 0,
    max: 600,
  },
  "motion.duration.slow": {
    kind: "duration",
    required: true,
    cssVariable: "--artemis-motion-duration-slow",
    fallback: { kind: "duration", value: 320, unit: "ms" },
    min: 0,
    max: 800,
  },
  "motion.easing.standard": {
    kind: "easing",
    required: true,
    cssVariable: "--artemis-motion-easing-standard",
    fallback: { kind: "easing", value: "standard" },
    allowedValues: ["standard", "entrance", "exit", "linear", "shell"],
  },
  "motion.easing.shell": {
    kind: "easing",
    required: true,
    cssVariable: "--artemis-motion-easing-shell",
    fallback: { kind: "easing", value: "shell" },
    allowedValues: ["standard", "entrance", "exit", "linear", "shell"],
  },
  "shadow.card": {
    kind: "shadow",
    required: true,
    cssVariable: "--artemis-shadow-card",
    fallback: { kind: "shadow", value: "soft" },
    allowedValues: ["none", "soft", "raised", "overlay"],
  },
  "shadow.surface": {
    kind: "shadow",
    required: true,
    cssVariable: "--artemis-shadow-surface",
    fallback: { kind: "shadow", value: "soft" },
    allowedValues: ["none", "soft", "raised", "overlay"],
  },
  "shadow.composer": {
    kind: "shadow",
    required: true,
    cssVariable: "--artemis-shadow-composer",
    fallback: { kind: "shadow", value: "raised" },
    allowedValues: ["none", "soft", "raised", "overlay"],
  },
  "shadow.overlay": {
    kind: "shadow",
    required: false,
    cssVariable: "--artemis-shadow-overlay",
    fallback: { kind: "shadow", value: "overlay" },
    allowedValues: ["none", "soft", "raised", "overlay"],
  },
  "opacity.disabled": {
    kind: "opacity",
    required: false,
    cssVariable: "--artemis-opacity-disabled",
    fallback: { kind: "opacity", value: 0.48 },
    min: 0.2,
    max: 0.8,
  },
} as const satisfies Readonly<Record<string, SemanticTokenDefinition>>;

export type SemanticTokenName = keyof typeof SEMANTIC_TOKEN_REGISTRY;

export const REQUIRED_SEMANTIC_TOKENS = Object.freeze(
  Object.entries(SEMANTIC_TOKEN_REGISTRY)
    .filter(([, definition]) => definition.required)
    .map(([name]) => name as SemanticTokenName),
);

export const OPTIONAL_SEMANTIC_TOKENS = Object.freeze(
  Object.entries(SEMANTIC_TOKEN_REGISTRY)
    .filter(([, definition]) => !definition.required)
    .map(([name]) => name as SemanticTokenName),
);

export const SAFE_FALLBACK_TOKENS = Object.freeze(
  Object.fromEntries(
    Object.entries(SEMANTIC_TOKEN_REGISTRY).map(([name, definition]) => [
      name,
      definition.fallback,
    ]),
  ) as Readonly<Record<SemanticTokenName, ThemeTokenValue>>,
);
