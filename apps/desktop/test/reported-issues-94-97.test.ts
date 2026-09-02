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
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS selector ${selector}`).not.toBeNull();
  return match?.groups?.body ?? "";
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

  it("moves the completed status row with the environment-safe content column", () => {
    expect(stylesSource).toMatch(
      /:is\(\.timeline,\s*\.turn-status,\s*\.composer-wrap\)/su,
    );
  });

  it("offsets only the environment popover when the workspace dock opens", () => {
    expect(panelSource).toContain('"--environment-panel-dock-offset"');
    expect(panelSource).not.toContain("marginInlineEnd: dockOffset");
    expect(
      cssDeclarations(
        '.environment-control[data-dock-open="true"] .environment-popover',
      ),
    ).toContain("inset-inline-end: var(--environment-panel-dock-offset, 0px)");
    expect(cssDeclarations(".workspace-tool-dock")).toContain(
      "240ms cubic-bezier(0.16, 1, 0.3, 1)",
    );
  });
});
