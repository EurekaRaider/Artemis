import { findCssDeclarations } from "./css-test-utils.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const panelSource = source("../src/renderer/EnvironmentPanel.tsx");
const stylesSource = source("../src/renderer/styles.css");
const publicUiStylesSource = source("../../../packages/ui/src/styles.css");

function cssDeclarations(selector: string): string {
  const declarations = findCssDeclarations(stylesSource, selector);
  expect(declarations, `Missing CSS selector ${selector}`).toBeDefined();
  return declarations ?? "";
}

function publicUiCssDeclarations(selector: string): string {
  const declarations = findCssDeclarations(publicUiStylesSource, selector);
  expect(declarations, `Missing CSS selector ${selector}`).toBeDefined();
  return declarations ?? "";
}

describe("reported issue regressions #94-#97", () => {
  it("offers copy actions for user and assistant messages and edit for interrupted turns", () => {
    const timeline = appSource.slice(
      appSource.indexOf("function Timeline("),
      appSource.indexOf("function ContextCompactionStatus("),
    );

    expect(timeline).toContain("onCopyText");
    expect(timeline).toContain("onEditUserMessage");
    expect(timeline).toContain('turn?.status === "cancelled"');
    expect(timeline).toContain('turn?.status === "failed"');
    expect(timeline).toContain("<CopyIcon />");
    expect(timeline).toContain("<EditIcon />");
    expect(appSource).toContain("navigator.clipboard.writeText(text)");
    expect(appSource).toContain("input?.focus({ preventScroll: true })");
    expect(appSource).toContain(
      "input?.setSelectionRange(0, input.value.length)",
    );
  });

  it("keeps message actions discoverable by hover and keyboard focus", () => {
    expect(publicUiStylesSource).toMatch(
      /\[data-artemis-component="conversation-message"\]\s*>\s*\[data-part="actions"\]\s*\{[^}]*opacity:\s*0/su,
    );
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="conversation-message"]:focus-within',
    );
    expect(publicUiStylesSource).toContain(
      '> [data-part="actions"]\n    button:is(:hover, :focus-visible)',
    );
  });

  it("keeps the conversation column fixed when the floating environment panel opens", () => {
    expect(stylesSource).not.toMatch(
      /:is\(\.timeline,\s*\.turn-status,\s*\.composer-wrap\)/su,
    );
    expect(
      publicUiCssDeclarations(
        '[data-artemis-component="environment-panel"][data-part="root"]',
      ),
    ).toContain("position: absolute");
    expect(cssDeclarations(".environment-popover")).toContain(
      "top: calc(100% + 18px)",
    );
  });

  it("closes the environment panel with the dock and permits explicitly reopening it", () => {
    expect(appSource).toContain(
      "defaultOpen={Boolean(threadState?.turnOrder.length)}",
    );
    expect(panelSource).toContain("setOpen(false)");
    expect(panelSource).toContain("data-dock-open={dockOpen}");
    expect(panelSource).not.toContain("dockOffset");
    expect(stylesSource).not.toContain("--environment-panel-dock-offset");
    expect(
      publicUiCssDeclarations('[data-artemis-component="workspace-dock"]'),
    ).toMatch(/transition:[\s\S]*var\(--artemis-motion-duration-normal\)/u);
  });
});
