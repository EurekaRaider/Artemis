import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SEMANTIC_TOKEN_REGISTRY,
  validateSkinIntegrity,
  validateSkinPackage,
  type ResolvedThemeMode,
  type SkinIntegrity,
  type ThemeTokenValue,
} from "@artemis/theme-contract";
import {
  artemisContrastTokens,
  artemisDarkTokens,
  artemisLightTokens,
  artemisThemeCss,
  artemisThemeFallbackTokens,
  artemisThemeManifest,
  artemisTokenDocuments,
} from "../src/index.js";

const color = (value: `#${string}`) => ({ kind: "color", value }) as const;
const length = (value: number) =>
  ({ kind: "length", value, unit: "px" }) as const;

const EXPECTED_FOUNDATION = Object.freeze({
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
} satisfies Readonly<Record<string, ThemeTokenValue>>);

const LIGHT_NORMAL = Object.freeze({
  "color.canvas": "#ffffff",
  "color.background.sidebar": "#f4f4f5",
  "color.background.activity": "#f4f4f5",
  "color.surface.base": "#ffffff",
  "color.surface.raised": "#ffffff",
  "color.surface.sunken": "#f2f2f4",
  "color.surface.composer": "#ffffff",
  "color.surface.user": "#f2f2f4",
  "color.interaction.hover": "#1112160b",
  "color.interaction.selected": "#f2f2f4",
  "color.text.primary": "#16171a",
  "color.text.secondary": "#575b65",
  "color.text.tertiary": "#686c76",
  "color.text.inverse": "#ffffff",
  "color.border.default": "#11121624",
  "color.border.surface": "#11121624",
  "color.border.subtle": "#11121614",
  "color.border.strong": "#686c76",
  "color.accent.primary": "#16171a",
  "color.accent.hover": "#212329",
  "color.accent.subtle": "#16171a1a",
  "color.accent.text": "#16171a",
  "color.accent.onPrimary": "#ffffff",
  "color.focus.ring": "#8f5f00",
  "color.status.success": "#187a4b",
  "color.status.warning": "#8f5f00",
  "color.status.danger": "#c93a32",
  "color.status.info": "#2f5bd3",
  "color.status.successSubtle": "#e6f4ec",
  "color.status.warningSubtle": "#fbf2df",
  "color.status.dangerSubtle": "#fcecea",
  "color.status.infoSubtle": "#eaf0fd",
  "color.status.onSuccess": "#ffffff",
  "color.status.onWarning": "#ffffff",
  "color.status.onDanger": "#ffffff",
  "color.status.onInfo": "#ffffff",
  "color.terminal.background": "#fafafa",
  "color.terminal.foreground": "#0a0a0a",
  "color.diff.addBackground": "#e7f6ee",
  "color.diff.addText": "#187a4b",
  "color.diff.deleteBackground": "#fdedec",
  "color.diff.deleteText": "#c83a32",
  "color.overlay.scrim": "#f4f4f5b8",
  "color.selection.background": "#16171a1a",
  "color.selection.text": "#16171a",
  "color.surface.header": "#ffffff",
  "color.surface.dock": "#ffffff",
  "color.surface.popover": "#ffffff",
  "color.surface.composerHead": "#f2f2f4",
  "color.switch.on": "#16171a",
  "color.brand": "#c08a1e",
  "color.goal": "#c08a1e",
  "color.status.successText": "#187a4b",
  "color.status.warningText": "#8f5f00",
  "color.status.dangerText": "#c93a32",
  "color.context.1": "#0284c7",
  "color.context.2": "#0ea5e9",
  "color.context.3": "#38bdf8",
  "color.context.4": "#7dd3fc",
  "color.context.5": "#bae6fd",
  "color.context.6": "#e0f2fe",
  "color.context.systemPrompt": "#5856d6",
  "color.context.systemTools": "#00a4d6",
  "color.context.mcpTools": "#af52de",
  "color.context.customAgents": "#e0448b",
  "color.context.memoryFiles": "#5576b7",
  "color.context.skills": "#738ebf",
  "color.context.messages": "#007aff",
  "color.context.freeSpace": "#d9dcdf",
  "color.context.autocompactBuffer": "#afb4bd",
  "color.usage.1": "#2f5bd3",
  "color.usage.2": "#5579dd",
  "color.usage.3": "#809be6",
  "color.usage.4": "#afc0ef",
} as const);

const DARK_NORMAL = Object.freeze({
  "color.canvas": "#141519",
  "color.background.sidebar": "#0e0f12",
  "color.background.activity": "#0e0f12",
  "color.surface.base": "#1a1b20",
  "color.surface.raised": "#1a1b20",
  "color.surface.sunken": "#212329",
  "color.surface.composer": "#1a1b20",
  "color.surface.user": "#212329",
  "color.interaction.hover": "#ffffff0d",
  "color.interaction.selected": "#212329",
  "color.text.primary": "#ecedef",
  "color.text.secondary": "#a9adb6",
  "color.text.tertiary": "#878c96",
  "color.text.inverse": "#121317",
  "color.border.default": "#ffffff1f",
  "color.border.surface": "#ffffff1f",
  "color.border.subtle": "#ffffff12",
  "color.border.strong": "#878c96",
  "color.accent.primary": "#ecedef",
  "color.accent.hover": "#ffffff",
  "color.accent.subtle": "#ecedef1a",
  "color.accent.text": "#ecedef",
  "color.accent.onPrimary": "#121317",
  "color.focus.ring": "#f2c877",
  "color.status.success": "#5bc793",
  "color.status.warning": "#e8b65a",
  "color.status.danger": "#f2736b",
  "color.status.info": "#8fb0ff",
  "color.status.successSubtle": "#5bc7931f",
  "color.status.warningSubtle": "#e8b65a1f",
  "color.status.dangerSubtle": "#f2736b1f",
  "color.status.infoSubtle": "#8fb0ff1f",
  "color.status.onSuccess": "#052e16",
  "color.status.onWarning": "#1d1d1f",
  "color.status.onDanger": "#1d1d1f",
  "color.status.onInfo": "#0a0a0a",
  "color.terminal.background": "#0a0a0a",
  "color.terminal.foreground": "#fafafa",
  "color.diff.addBackground": "#5bc7931c",
  "color.diff.addText": "#5bc793",
  "color.diff.deleteBackground": "#f2736b1c",
  "color.diff.deleteText": "#f2736b",
  "color.overlay.scrim": "#060709a8",
  "color.selection.background": "#ecedef1a",
  "color.selection.text": "#ecedef",
  "color.surface.header": "#141519",
  "color.surface.dock": "#141519",
  "color.surface.popover": "#1d1e23",
  "color.surface.composerHead": "#212329",
  "color.switch.on": "#ecedef",
  "color.brand": "#e8b65a",
  "color.goal": "#e8b65a",
  "color.status.successText": "#5bc793",
  "color.status.warningText": "#f2c877",
  "color.status.dangerText": "#f2736b",
  "color.context.1": "#0ea5e9",
  "color.context.2": "#38bdf8",
  "color.context.3": "#55cbfa",
  "color.context.4": "#7dd3fc",
  "color.context.5": "#9ce0fd",
  "color.context.6": "#bae6fd",
  "color.context.systemPrompt": "#7d7aff",
  "color.context.systemTools": "#40c8f5",
  "color.context.mcpTools": "#bf5af2",
  "color.context.customAgents": "#ff648f",
  "color.context.memoryFiles": "#9bb8ec",
  "color.context.skills": "#789bcf",
  "color.context.messages": "#0a84ff",
  "color.context.freeSpace": "#46494f",
  "color.context.autocompactBuffer": "#737982",
  "color.usage.1": "#8fb0ff",
  "color.usage.2": "#6f90dc",
  "color.usage.3": "#506dae",
  "color.usage.4": "#364c7d",
} as const);

const EXPECTED_COLORS = Object.freeze({
  "light-normal": LIGHT_NORMAL,
  "dark-normal": DARK_NORMAL,
  "light-high": Object.freeze({
    ...LIGHT_NORMAL,
    "color.text.secondary": "#3a3a3c",
    "color.text.tertiary": "#55555c",
    "color.border.default": "#0000004d",
    "color.border.surface": "#0000004d",
    "color.border.subtle": "#0000002e",
    "color.border.strong": "#55555c",
  }),
  "dark-high": Object.freeze({
    ...DARK_NORMAL,
    "color.text.secondary": "#dcdce0",
    "color.text.tertiary": "#bdbdc2",
    "color.border.default": "#ffffff5c",
    "color.border.surface": "#ffffff5c",
    "color.border.subtle": "#ffffff38",
    "color.border.strong": "#bdbdc2",
  }),
} as const);

type ExpectedModeKey = keyof typeof EXPECTED_COLORS;

function expectedTokens(key: ExpectedModeKey) {
  return {
    ...EXPECTED_FOUNDATION,
    ...Object.fromEntries(
      Object.entries(EXPECTED_COLORS[key]).map(([name, value]) => [
        name,
        color(value),
      ]),
    ),
  };
}

function modeKey(mode: ResolvedThemeMode): ExpectedModeKey {
  return `${mode.theme}-${mode.contrast}`;
}

function parseHex(value: string): readonly [number, number, number, number] {
  expect(value).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255,
  ];
}

function composite(foreground: string, background: string): string {
  const [red, green, blue, alphaByte] = parseHex(foreground);
  const [backRed, backGreen, backBlue, backAlpha] = parseHex(background);
  expect(backAlpha).toBe(255);
  const alpha = alphaByte / 255;
  return `#${[red, green, blue]
    .map((channel, index) => {
      const back = [backRed, backGreen, backBlue][index]!;
      return Math.round(channel * alpha + back * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function luminance(value: string): number {
  const [red, green, blue] = parseHex(value);
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const opaqueForeground =
    foreground.length === 9 ? composite(foreground, background) : foreground;
  const lighter = Math.max(luminance(opaqueForeground), luminance(background));
  const darker = Math.min(luminance(opaqueForeground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function colorToken(mode: ResolvedThemeMode, name: string): string {
  const token = mode.tokens[name];
  expect(token?.kind).toBe("color");
  return (token as { readonly kind: "color"; readonly value: string }).value;
}

function actualCarryingBackground(
  mode: ResolvedThemeMode,
  name: string,
  baseName = "color.surface.base",
): string {
  const background = colorToken(mode, name);
  return background.length === 9
    ? composite(background, colorToken(mode, baseName))
    : background;
}

describe("default Artemis Nocturne skin", () => {
  it("matches the independent frozen token matrix in every mode", () => {
    const report = validateSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    expect(report.valid).toBe(true);
    expect(report.value?.modes).toHaveLength(4);
    expect(artemisThemeFallbackTokens).toEqual([]);

    const modes = report.value!.modes;
    expect(modes.map(modeKey).sort()).toEqual(
      ["dark-high", "dark-normal", "light-high", "light-normal"].sort(),
    );
    const registryNames = Object.keys(SEMANTIC_TOKEN_REGISTRY).sort();
    for (const resolvedMode of modes) {
      expect(resolvedMode.density).toBe("comfortable");
      expect(resolvedMode.platform).toBe("universal");
      expect(resolvedMode.fallbackTokens).toEqual([]);
      expect(Object.keys(resolvedMode.tokens).sort()).toEqual(registryNames);
      expect(resolvedMode.tokens).toEqual(
        expectedTokens(modeKey(resolvedMode)),
      );
    }
    expect(new Set(modes.map((mode) => JSON.stringify(mode.tokens))).size).toBe(
      4,
    );
  });

  it("uses the approved prototype role thresholds on their carrying surfaces", () => {
    const report = validateSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    for (const resolvedMode of report.value!.modes) {
      const surfaces = [
        "color.canvas",
        "color.background.sidebar",
        "color.background.activity",
        "color.surface.base",
        "color.surface.raised",
        "color.surface.sunken",
        "color.surface.composer",
        "color.surface.user",
      ];
      for (const backgroundName of surfaces) {
        expect(
          contrastRatio(
            colorToken(resolvedMode, "color.text.primary"),
            colorToken(resolvedMode, backgroundName),
          ),
          `${modeKey(resolvedMode)} primary on ${backgroundName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const textName of [
        "color.text.secondary",
        "color.text.tertiary",
        "color.accent.text",
      ]) {
        for (const backgroundName of surfaces) {
          expect(
            contrastRatio(
              colorToken(resolvedMode, textName),
              colorToken(resolvedMode, backgroundName),
            ),
            `${modeKey(resolvedMode)} ${textName} on ${backgroundName}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrastRatio(
          colorToken(resolvedMode, "color.terminal.foreground"),
          colorToken(resolvedMode, "color.terminal.background"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      for (const [textName, backgroundName] of [
        ["color.diff.addText", "color.diff.addBackground"],
        ["color.diff.deleteText", "color.diff.deleteBackground"],
        ["color.selection.text", "color.selection.background"],
      ] as const) {
        expect(
          contrastRatio(
            colorToken(resolvedMode, textName),
            actualCarryingBackground(resolvedMode, backgroundName),
          ),
          `${modeKey(resolvedMode)} ${textName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps primary controls at 4.5:1 and status/focus indicators at 3:1", () => {
    const report = validateSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    for (const resolvedMode of report.value!.modes) {
      for (const [foregroundName, backgroundName] of [
        ["color.accent.onPrimary", "color.accent.primary"],
        ["color.status.onSuccess", "color.status.success"],
        ["color.status.onDanger", "color.status.danger"],
        ["color.status.onInfo", "color.status.info"],
      ] as const) {
        expect(
          contrastRatio(
            colorToken(resolvedMode, foregroundName),
            colorToken(resolvedMode, backgroundName),
          ),
          `${modeKey(resolvedMode)} ${foregroundName}`,
        ).toBeGreaterThanOrEqual(
          foregroundName === "color.accent.onPrimary" ? 4.5 : 3,
        );
      }
      for (const foregroundName of [
        "color.focus.ring",
        "color.border.strong",
        "color.status.success",
        "color.status.warningText",
        "color.status.danger",
        "color.status.info",
      ]) {
        expect(
          contrastRatio(
            colorToken(resolvedMode, foregroundName),
            colorToken(resolvedMode, "color.surface.base"),
          ),
          `${modeKey(resolvedMode)} ${foregroundName}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("generates only controlled root selectors and namespaced properties", () => {
    expect(artemisThemeCss).not.toMatch(
      /url\s*\(|@import|javascript:|data-direction|direction-[bc]|synthetic/iu,
    );
    expect(artemisThemeCss).toContain(
      "--artemis-motion-easing-standard: cubic-bezier(0.32, 0.72, 0, 1);",
    );
    expect(artemisThemeCss).toContain(
      '--artemis-typography-body-family: "Geist", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif;',
    );
    expect(artemisThemeCss).toContain(
      '--artemis-typography-mono-family: "Geist Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;',
    );
    expect(artemisThemeCss).toContain("--artemis-shadow-composer: none;");
    expect(artemisThemeCss).toContain(
      "--artemis-shadow-overlay: 0 12px 40px #00000029, 0 2px 8px #0000000f;",
    );
    expect(artemisThemeCss).toContain(
      "--artemis-shadow-overlay: 0 12px 40px #00000080, 0 2px 8px #0000004d;",
    );
    const meaningfulLines = artemisThemeCss
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const selectorLines = meaningfulLines.filter((line) => line.endsWith("{"));
    expect(selectorLines).toHaveLength(5);
    expect(selectorLines[0]).toBe("@layer artemis.theme {");
    for (const selector of selectorLines.slice(1)) {
      expect(selector).toMatch(
        /^:root\[data-artemis-skin="com\.artemis\.default"\]\[data-artemis-theme="(?:light|dark)"\]\[data-artemis-contrast="(?:normal|high)"\] \{$/u,
      );
    }
    const declarationLines = meaningfulLines.filter((line) =>
      line.startsWith("--"),
    );
    expect(declarationLines).toHaveLength(
      Object.keys(SEMANTIC_TOKEN_REGISTRY).length * 4,
    );
    for (const line of declarationLines) {
      expect(line).toMatch(/^--artemis-[a-z0-9-]+: [^;]+;$/u);
    }
  });

  it("writes public JSON/CSS/integrity artifacts from the validated exports", () => {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    const json = (relative: string) =>
      JSON.parse(readFileSync(`${dist}${relative}`, "utf8")) as unknown;
    expect(json("manifest.json")).toEqual(artemisThemeManifest);
    expect(json("tokens.light.json")).toEqual(artemisLightTokens);
    expect(json("tokens.dark.json")).toEqual(artemisDarkTokens);
    expect(json("tokens.contrast.json")).toEqual(artemisContrastTokens);
    const integrity = json("integrity.json") as SkinIntegrity;
    expect(validateSkinIntegrity(integrity, artemisThemeManifest).valid).toBe(
      true,
    );
    expect(Object.keys(integrity.files).sort()).toEqual(
      [
        "manifest.json",
        "tokens.light.json",
        "tokens.dark.json",
        "tokens.contrast.json",
      ].sort(),
    );
    for (const [file, expectedHash] of Object.entries(integrity.files)) {
      const actualHash = createHash("sha256")
        .update(readFileSync(`${dist}${file}`))
        .digest("hex");
      expect(actualHash).toBe(expectedHash);
    }
    expect(readFileSync(`${dist}theme.css`, "utf8")).toBe(artemisThemeCss);
  });
});
