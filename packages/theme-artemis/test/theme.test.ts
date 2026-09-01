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
} satisfies Readonly<Record<string, ThemeTokenValue>>);

const LIGHT_NORMAL = Object.freeze({
  "color.canvas": "#f5f5f7",
  "color.background.sidebar": "#f0f0f2",
  "color.background.activity": "#ebebef",
  "color.surface.base": "#ffffff",
  "color.surface.raised": "#ffffff",
  "color.surface.sunken": "#f5f5f7",
  "color.surface.composer": "#ffffff",
  "color.surface.user": "#f0f0f2",
  "color.interaction.hover": "#0000000b",
  "color.interaction.selected": "#0071e314",
  "color.text.primary": "#1d1d1f",
  "color.text.secondary": "#5a5a60",
  "color.text.tertiary": "#68686c",
  "color.text.inverse": "#f5f5f7",
  "color.border.default": "#0000006b",
  "color.border.subtle": "#00000012",
  "color.border.strong": "#68686c",
  "color.accent.primary": "#0071e3",
  "color.accent.hover": "#0071e3",
  "color.accent.subtle": "#0071e31a",
  "color.accent.text": "#0056ae",
  "color.accent.onPrimary": "#ffffff",
  "color.focus.ring": "#0071e3",
  "color.status.success": "#23843b",
  "color.status.warning": "#b25000",
  "color.status.danger": "#d70015",
  "color.status.info": "#0071e3",
  "color.status.successSubtle": "#34c75924",
  "color.status.warningSubtle": "#ff9f0a29",
  "color.status.dangerSubtle": "#ff3b301a",
  "color.status.infoSubtle": "#0071e31a",
  "color.status.onSuccess": "#ffffff",
  "color.status.onWarning": "#ffffff",
  "color.status.onDanger": "#ffffff",
  "color.status.onInfo": "#ffffff",
  "color.terminal.background": "#1d1d1f",
  "color.terminal.foreground": "#e8e8ed",
  "color.diff.addBackground": "#34c7591a",
  "color.diff.addText": "#1d6c30",
  "color.diff.deleteBackground": "#ff3b3014",
  "color.diff.deleteText": "#c80014",
  "color.overlay.scrim": "#00000052",
  "color.selection.background": "#0071e31a",
  "color.selection.text": "#1d1d1f",
} as const);

const DARK_NORMAL = Object.freeze({
  "color.canvas": "#1d1d1f",
  "color.background.sidebar": "#1a1a1c",
  "color.background.activity": "#17171a",
  "color.surface.base": "#232325",
  "color.surface.raised": "#272729",
  "color.surface.sunken": "#1a1a1c",
  "color.surface.composer": "#272729",
  "color.surface.user": "#2c2c2f",
  "color.interaction.hover": "#ffffff0e",
  "color.interaction.selected": "#2997ff24",
  "color.text.primary": "#f5f5f7",
  "color.text.secondary": "#bcbcc1",
  "color.text.tertiary": "#a6a6aa",
  "color.text.inverse": "#1d1d1f",
  "color.border.default": "#ffffff5c",
  "color.border.subtle": "#ffffff14",
  "color.border.strong": "#a6a6aa",
  "color.accent.primary": "#2077c9",
  "color.accent.hover": "#2076c7",
  "color.accent.subtle": "#2997ff29",
  "color.accent.text": "#89b7e2",
  "color.accent.onPrimary": "#ffffff",
  "color.focus.ring": "#89b7e2",
  "color.status.success": "#30d158",
  "color.status.warning": "#ffd60a",
  "color.status.danger": "#ff453a",
  "color.status.info": "#2077c9",
  "color.status.successSubtle": "#30d15826",
  "color.status.warningSubtle": "#ff9f0a29",
  "color.status.dangerSubtle": "#ff453a21",
  "color.status.infoSubtle": "#2997ff29",
  "color.status.onSuccess": "#0e1510",
  "color.status.onWarning": "#1d1d1f",
  "color.status.onDanger": "#1d1d1f",
  "color.status.onInfo": "#ffffff",
  "color.terminal.background": "#141416",
  "color.terminal.foreground": "#e8e8ed",
  "color.diff.addBackground": "#30d1581f",
  "color.diff.addText": "#30d158",
  "color.diff.deleteBackground": "#ff453a1a",
  "color.diff.deleteText": "#ff8179",
  "color.overlay.scrim": "#00000052",
  "color.selection.background": "#2997ff29",
  "color.selection.text": "#f5f5f7",
} as const);

const EXPECTED_COLORS = Object.freeze({
  "light-normal": LIGHT_NORMAL,
  "dark-normal": DARK_NORMAL,
  "light-high": Object.freeze({
    ...LIGHT_NORMAL,
    "color.text.secondary": "#3a3a3c",
    "color.text.tertiary": "#55555c",
    "color.border.default": "#00000080",
    "color.border.subtle": "#0000002e",
    "color.border.strong": "#55555c",
  }),
  "dark-high": Object.freeze({
    ...DARK_NORMAL,
    "color.text.secondary": "#dcdce0",
    "color.text.tertiary": "#bdbdc2",
    "color.border.default": "#ffffff80",
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

describe("default Artemis Direction A skin", () => {
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

  it("keeps small text pairs at 4.5:1 on their actual carrying surfaces", () => {
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

  it("keeps filled controls at 4.5:1 and focus/strong boundaries at 3:1", () => {
    const report = validateSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    for (const resolvedMode of report.value!.modes) {
      for (const [foregroundName, backgroundName] of [
        ["color.accent.onPrimary", "color.accent.primary"],
        ["color.status.onSuccess", "color.status.success"],
        ["color.status.onWarning", "color.status.warning"],
        ["color.status.onDanger", "color.status.danger"],
        ["color.status.onInfo", "color.status.info"],
      ] as const) {
        expect(
          contrastRatio(
            colorToken(resolvedMode, foregroundName),
            colorToken(resolvedMode, backgroundName),
          ),
          `${modeKey(resolvedMode)} ${foregroundName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const foregroundName of [
        "color.focus.ring",
        "color.border.default",
        "color.border.strong",
        "color.status.success",
        "color.status.warning",
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
      '--artemis-typography-body-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", sans-serif;',
    );
    expect(artemisThemeCss).toContain(
      '--artemis-typography-mono-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;',
    );
    expect(artemisThemeCss).toContain(
      "--artemis-shadow-composer: 0 10px 36px #0000002e;",
    );
    expect(artemisThemeCss).toContain(
      "--artemis-shadow-composer: 0 10px 36px #00000066;",
    );
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
