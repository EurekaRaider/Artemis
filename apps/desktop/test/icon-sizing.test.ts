// @vitest-environment jsdom
//
// D#76 PR9A §5 test matrix: the five-tier icon size token family
// (xs 12 / sm 14 / base 16 / lg 20 / xl 24), the named consumer migrations,
// and the frozen baseline for everything intentionally left on literal
// pixels in this PR.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import "./renderer-test-utils.js";

import * as EnvironmentPanelIcons from "../src/renderer/EnvironmentPanelIcons.js";
import { SemanticResourceIcon } from "../src/renderer/resource-icons.js";

const stylesSource = readFileSync(
  resolve(process.cwd(), "src/renderer/styles.css"),
  "utf8",
);
const publicUiStylesSource = readFileSync(
  resolve(process.cwd(), "../../packages/ui/src/styles.css"),
  "utf8",
);
const iconsSource = readFileSync(
  resolve(process.cwd(), "src/renderer/EnvironmentPanelIcons.tsx"),
  "utf8",
);
const resourceIconsSource = readFileSync(
  resolve(process.cwd(), "src/renderer/resource-icons.tsx"),
  "utf8",
);
const resourceCenterSource = readFileSync(
  resolve(process.cwd(), "src/renderer/ResourceCenter.tsx"),
  "utf8",
);

function cssRuleBlock(styles: string, selector: string, last = false): string {
  const needle = `${selector} {`;
  const at = last ? styles.lastIndexOf(needle) : styles.indexOf(needle);
  if (at === -1) {
    throw new Error(`selector not found in styles.css: ${needle}`);
  }
  const open = styles.indexOf("{", at);
  const close = styles.indexOf("}", open);
  return styles.slice(open + 1, close);
}

const TIER_ORDER = ["xs", "sm", "base", "lg", "xl"] as const;
type Tier = (typeof TIER_ORDER)[number];
const EXPECTED_TIER_PX: Record<Tier, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 24,
};

const rootBlock = cssRuleBlock(stylesSource, ":root");
const tierPx = Object.fromEntries(
  [...rootBlock.matchAll(/--icon-size-([a-z]+):\s*(\d+)px/g)].map((match) => [
    match[1] as string,
    Number(match[2]),
  ]),
) as Partial<Record<Tier, number>>;

function tierValue(tier: Tier): string {
  return String(tierPx[tier]);
}

const iconComponent = (name: string): ComponentType<object> =>
  (EnvironmentPanelIcons as unknown as Record<string, ComponentType<object>>)[
    name
  ];

// Renderer-wide emoji/dingbat scan (§2.5 freeze). Runs once at module scope;
// both facts are asserted below so any drift fails loudly.
const rendererDir = resolve(process.cwd(), "src/renderer");
const dingbats: Record<string, { check: number; star: number }> = {};
let coloredEmojiCount = 0;
let variationSelectorCount = 0;
const scanRendererSources = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      scanRendererSources(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) {
      continue;
    }
    const text = readFileSync(full, "utf8");
    coloredEmojiCount += [...text.matchAll(/\p{Emoji_Presentation}/gu)].length;
    variationSelectorCount += [...text.matchAll(/\uFE0F/gu)].length;
    const check = [...text.matchAll(/\u2713/gu)].length;
    const star = [...text.matchAll(/\u2726/gu)].length;
    if (check > 0 || star > 0) {
      dingbats[full.slice(rendererDir.length + 1)] = { check, star };
    }
  }
};
scanRendererSources(rendererDir);

describe("icon size tier tokens (D#76 PR9A §5)", () => {
  it("defines exactly the five size tier tokens in :root", () => {
    expect(Object.keys(tierPx).sort()).toEqual([...TIER_ORDER].sort());
    const names = [
      ...new Set(stylesSource.match(/--icon-size-[a-z0-9-]*/g) ?? []),
    ].sort();
    expect(names).toEqual(
      [...TIER_ORDER].map((tier) => `--icon-size-${tier}`).sort(),
    );
    // MIG5A moved two Resource Center consumers to the public action/icon
    // contract. The renderer-local family therefore has 5 declarations plus
    // 2 references (width/height) in each of the 11 remaining consumers.
    expect(stylesSource.match(/--icon-size-/g)?.length ?? 0).toBe(27);
  });

  it("keeps tier values distinct and strictly increasing", () => {
    const values = TIER_ORDER.map((tier) => tierPx[tier]);
    expect(values).toEqual([12, 14, 16, 20, 24]);
    for (let index = 1; index < values.length; index += 1) {
      expect((values[index] ?? 0) > (values[index - 1] ?? 0)).toBe(true);
    }
    expect(new Set(values).size).toBe(TIER_ORDER.length);
    expect(EXPECTED_TIER_PX).toEqual({
      xs: tierPx.xs,
      sm: tierPx.sm,
      base: tierPx.base,
      lg: tierPx.lg,
      xl: tierPx.xl,
    });
  });

  const SQUARE_ICONS: Array<[string, Tier, string]> = [
    ["EnvironmentAddIcon", "lg", "0 0 20 20"],
    ["EnvironmentBranchIcon", "lg", "0 0 20 20"],
    ["EnvironmentChangesIcon", "lg", "0 0 20 20"],
    ["EnvironmentCommitIcon", "lg", "0 0 20 20"],
    ["EnvironmentGithubIcon", "lg", "0 0 20 20"],
    ["EnvironmentSourcesIcon", "lg", "0 0 20 20"],
    ["EnvironmentWebIcon", "lg", "0 0 20 20"],
    ["EnvironmentLocalIcon", "lg", "0 0 21 21"],
    ["EnvironmentExternalIcon", "base", "0 0 16 16"],
    ["EnvironmentSearchIcon", "base", "0 0 16 16"],
    ["EnvironmentCheckIcon", "base", "0 0 17 17"],
  ];

  it.each(SQUARE_ICONS)(
    "%s renders width/height at its tier with an unchanged viewBox",
    (name: string, tier: Tier, viewBox: string) => {
      const { container } = render(
        createElement(iconComponent(name), { "aria-hidden": "true" }),
      );
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe(viewBox);
      expect(svg?.getAttribute("width")).toBe(tierValue(tier));
      expect(svg?.getAttribute("height")).toBe(tierValue(tier));
    },
  );

  it("EnvironmentChevronIcon pins width to lg and keeps height 21 (§9-4 non-square viewBox)", () => {
    const { container } = render(
      createElement(EnvironmentPanelIcons.EnvironmentChevronIcon, {
        "aria-hidden": "true",
      }),
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 20 21");
    expect(svg?.getAttribute("width")).toBe(tierValue("lg"));
    // Sanctioned exemption: viewBox 0 0 20 21 is not square, so height stays
    // 21 to preserve the 20:21 aspect ratio instead of squashing the glyph.
    expect(svg?.getAttribute("height")).toBe("21");
  });

  const MIGRATED_RULES: Array<[string, Tier, number]> = [
    // The row-icon rule shares its declaration block with a leading
    // ".environment-trigger svg," selector; the trigger keeps its effective
    // size from its own later standalone rule, which the unmigrated
    // baseline below locks at a literal 20px.
    [".environment-row-icon svg:not(.child-agent-mark)", "lg", 18],
    [".environment-header-action svg", "lg", 18],
    [".environment-chevron svg,\n.environment-external svg", "base", 16],
    [".environment-branch-search > svg", "sm", 14],
    [".environment-branch-list > button > svg", "base", 16],
    [".environment-branch-list > button > i > svg", "base", 16],
    [".environment-branch-actions > button > svg", "lg", 18],
    [
      ".environment-git-destination-trigger svg,\n.environment-git-destination-menu svg,\n.environment-git-actions svg",
      "lg",
      20,
    ],
    [".environment-view-all svg", "lg", 18],
    [".resource-avatar svg", "lg", 20],
    [".resource-avatar .resource-semantic-icon", "xl", 22],
  ];

  it.each(MIGRATED_RULES)(
    "%s sizes icons through its tier token",
    (selector: string, tier: Tier, oldPx: number) => {
      const block = cssRuleBlock(stylesSource, selector);
      expect(block).toContain(`width: var(--icon-size-${tier})`);
      expect(block).toContain(`height: var(--icon-size-${tier})`);
      expect(block).not.toMatch(new RegExp(`(?<![a-z-])width:\\s*${oldPx}px`));
      expect(block).not.toMatch(new RegExp(`(?<![a-z-])height:\\s*${oldPx}px`));
    },
  );

  it("delegates Resource Center action icon sizing and flex defense to public UI", () => {
    const icon = cssRuleBlock(
      publicUiStylesSource,
      '[data-artemis-component="icon"]',
    );
    const svg = cssRuleBlock(
      publicUiStylesSource,
      '[data-artemis-component="icon"] > svg',
    );
    expect(icon).toContain("flex: 0 0 auto");
    expect(icon).toContain("inline-size: 1em");
    expect(icon).toContain("block-size: 1em");
    expect(svg).toContain("inline-size: 1em");
    expect(svg).toContain("block-size: 1em");
  });

  it("keeps Resource Center line icons visible without private SVG CSS", () => {
    for (const name of [
      "SearchIcon",
      "GearIcon",
      "RefreshIcon",
      "PlusIcon",
      "TrashIcon",
      "BackIcon",
    ]) {
      const start = resourceCenterSource.indexOf(`function ${name}()`);
      const end = resourceCenterSource.indexOf("\nfunction ", start + 1);
      const component = resourceCenterSource.slice(start, end);
      expect(start).toBeGreaterThan(-1);
      expect(component).toContain('stroke="currentColor"');
      expect(component).toContain('strokeLinecap="round"');
      expect(component).toContain('strokeLinejoin="round"');
      expect(component).toContain('strokeWidth="1.55"');
    }
  });

  const UNMIGRATED_RULES: Array<[string, number, boolean]> = [
    [".environment-trigger svg", 20, false],
    [".agent-team-member-disclosure svg", 12, false],
    [
      ".workspace-file-kind .seti-file-icon,\n.workspace-file-kind .seti-file-icon svg",
      21,
      false,
    ],
    [".workspace-tab-menu svg", 17, false],
    [".sources-panel-icon svg", 22, false],
    [
      ".library-hero-icon svg,\n.catalog-tabs svg,\n.catalog-card-icon svg,\n.library-search svg,\n.catalog-search svg",
      24,
      false,
    ],
    [".catalog-tabs svg", 16, true],
    [".catalog-card-icon svg", 19, true],
    [".archive-header-icon svg", 23, true],
    [".archive-empty-icon svg", 23, true],
  ];

  it.each(UNMIGRATED_RULES)(
    "%s keeps its literal pixel size (unmigrated baseline)",
    (selector: string, px: number, last: boolean) => {
      const block = cssRuleBlock(stylesSource, selector, last);
      expect(block).toMatch(new RegExp(`(?<![a-z-])width:\\s*${px}px`));
      expect(block).toMatch(new RegExp(`(?<![a-z-])height:\\s*${px}px`));
    },
  );

  it("keeps every EnvironmentPanelIcons attribute value inside the tier set", () => {
    const tierSet = new Set(TIER_ORDER.map((tier) => tierPx[tier]));
    const widths = [...iconsSource.matchAll(/width="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    const heights = [...iconsSource.matchAll(/height="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(widths.length).toBeGreaterThanOrEqual(12);
    expect(heights.length).toBeGreaterThanOrEqual(12);
    for (const px of widths) {
      expect(tierSet.has(px)).toBe(true);
    }
    for (const px of heights) {
      // 21 is the sanctioned Chevron exemption (§9-4).
      expect(tierSet.has(px) || px === 21).toBe(true);
    }
  });

  it("ships zero colored emoji across renderer sources", () => {
    expect(coloredEmojiCount).toBe(0);
    expect(variationSelectorCount).toBe(0);
  });

  it("freezes the remaining ✓/✦ text dingbat inventory after icon migration", () => {
    expect(dingbats).toEqual({
      "App.tsx": { check: 7, star: 2 },
      "EnvironmentPanel.tsx": { check: 1, star: 0 },
    });
    const total = Object.values(dingbats).reduce(
      (sum, counts) => sum + counts.check + counts.star,
      0,
    );
    expect(total).toBe(10);
    expect(
      readFileSync(resolve(process.cwd(), "src/renderer/App.tsx"), "utf8"),
    ).toContain('<MagicWandIcon aria-hidden="true" size={16} />');
  });

  it("keeps the renderer-layout resource icon source assertions intact", () => {
    expect(resourceIconsSource).toContain("MagicWandIcon");
    expect(resourceIconsSource).toContain("PlugsConnectedIcon");
    expect(resourceIconsSource).toContain('weight="duotone"');
    expect(stylesSource).toContain(
      ".resource-avatar[data-icon] .resource-semantic-icon path[opacity]",
    );
  });

  it("SemanticResourceIcon stays CSS-driven with em-relative attributes and no size prop", () => {
    const { container } = render(
      createElement(SemanticResourceIcon, { icon: "lightbulb" }),
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Phosphor defaults to 1em — sizing is delegated entirely to CSS, so the
    // tier tokens in styles.css stay the single source of rendered size.
    expect(svg?.getAttribute("width")).toBe("1em");
    expect(svg?.getAttribute("height")).toBe("1em");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.classList.contains("resource-semantic-icon")).toBe(true);
    expect(resourceIconsSource).not.toContain("size={");
  });
});
