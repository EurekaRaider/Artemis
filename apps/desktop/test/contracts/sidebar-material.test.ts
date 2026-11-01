import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { expect, it } from "vitest";

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? cssFiles(path)
      : path.endsWith(".css")
        ? [path]
        : [];
  });
}

it("limits backdrop material to the sidebar and computer operation overlays", () => {
  const root = new URL("../../src/renderer/", import.meta.url).pathname;
  const violations: string[] = [];
  for (const file of cssFiles(root)) {
    postcss.parse(readFileSync(file, "utf8")).walkDecls((declaration) => {
      if (
        !declaration.prop.endsWith("backdrop-filter") ||
        declaration.value === "none"
      )
        return;
      const selectors: string[] = [];
      for (let parent = declaration.parent; parent; parent = parent.parent)
        if (parent.type === "rule")
          selectors.unshift((parent as postcss.Rule).selector);
      const selector = selectors.join(" ");
      if (
        !/\.sidebar(?:\[[^\]]+\])*\s*>\s*\[data-part="main"\]|\.sidebar-rail\b|\.computer-control\b|\.computer-preview-card::after\b/u.test(
          selector,
        )
      )
        violations.push(
          `${file}:${declaration.source?.start?.line} ${selector}`,
        );
    });
  }
  expect(violations).toEqual([]);
});

it("preserves the computer preview hover blur in embedded and floating windows", () => {
  const embedded = readFileSync(
    new URL(
      "../../src/renderer/computer-use/computer-preview.css",
      import.meta.url,
    ),
    "utf8",
  );
  const floating = readFileSync(
    new URL("../../src/main/computer-use/preview-window.ts", import.meta.url),
    "utf8",
  );
  expect(embedded).toContain("backdrop-filter: blur(10px)");
  expect(embedded).toContain(".computer-preview-card:hover::after");
  expect(floating).toContain("backdrop-filter:blur(10px)");
  expect(floating).toContain("body:hover::after");
});

it("keeps material-specific geometry and lens highlights out of other surfaces", () => {
  const sheet = postcss.parse(
    readFileSync(
      new URL("../../src/renderer/styles/nocturne.css", import.meta.url),
      "utf8",
    ),
  );
  const violations: string[] = [];
  sheet.walkDecls((declaration) => {
    const selectors: string[] = [];
    for (let parent = declaration.parent; parent; parent = parent.parent)
      if (parent.type === "rule")
        selectors.unshift((parent as postcss.Rule).selector);
    const selector = selectors.join(" ");
    if (
      selector.includes('[data-material="glass"]') &&
      !/\.sidebar\b|\.sidebar-rail\b/u.test(selector)
    )
      violations.push(`${selector}: ${declaration.prop}`);
  });
  expect(violations).toEqual([]);
});
