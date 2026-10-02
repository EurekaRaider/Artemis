import { SEMANTIC_TOKEN_REGISTRY } from "./registry.js";
import type { ResolvedThemeMode, ThemeTokenValue } from "./types.js";
import type { SkinMotion, ValidatedVisualSkinPackage } from "./visual-skin.js";
export const SKIN_FONT_STACKS = {
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
      return SKIN_FONT_STACKS[token.value];
    case "fontWeight":
    case "opacity":
      return String(token.value);
    case "easing":
      return EASINGS[token.value];
    case "shadow":
      return SHADOWS[theme][token.value];
  }
}

export function generateSkinCss(skin: ValidatedVisualSkinPackage): string {
  const blocks = skin.modes
    .filter(
      (mode) => mode.density === "comfortable" && mode.platform === "universal",
    )
    .map((mode) => {
      const selector = `:root[data-artemis-skin="${skin.manifest.id}"][data-artemis-theme="${mode.theme}"][data-artemis-contrast="${mode.contrast}"]`;
      const declarations = Object.entries(SEMANTIC_TOKEN_REGISTRY).map(
        ([name, definition]) =>
          `  ${definition.cssVariable}: ${cssValue(mode.tokens[name]!, mode.theme)};`,
      );
      return `${selector} {\n${declarations.join("\n")}\n}`;
    });
  return `@layer artemis.theme {\n${blocks.join("\n\n")}\n}\n`;
}

export function generateSkinMotionCss(
  motion: SkinMotion | undefined,
  id: string,
): string {
  if (!motion) return "";
  const selector = `:root[data-artemis-skin="${id}"][data-artemis-contrast="normal"]`;
  const targets = {
    background: ".appearance-background-media",
    surface: ".composer-surface",
    controls:
      "[data-artemis-component=button]:active, [data-artemis-component=icon-button]:active",
  };
  const frames: Record<string, (d: number) => string> = {
    fade: () => "from{opacity:.8}to{opacity:1}",
    slide: (d) => `from{translate:0 ${d}px}to{translate:0 0}`,
    scale: () => "from{scale:.98}to{scale:1}",
    pulse: () => "0%,100%{opacity:1}50%{opacity:.85}",
    float: (d) => `0%,100%{translate:0 0}50%{translate:0 ${d}px}`,
  };
  let css = "";
  for (const [target, m] of Object.entries(motion.targets)) {
    if (!m || m.preset === "none" || m.duration === 0) continue;
    const name = `skin-${target}-${m.preset}`;
    css += `@keyframes ${name}{${frames[m.preset]!(m.distance)}}\n@media (prefers-reduced-motion:no-preference){${targets[
      target as keyof typeof targets
    ]
      .split(", ")
      .map((t) => `${selector} ${t}`)
      .join(
        ",",
      )}{animation:${name} ${m.duration}ms ease ${m.loop ? "infinite" : "1"};}}\n`;
  }
  return css;
}
