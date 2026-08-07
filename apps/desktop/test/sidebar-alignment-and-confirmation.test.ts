import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const stylesSource = source("../src/renderer/styles.css");

function sourceBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `Missing source start: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endIndex, `Missing source end: ${end}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

function cssDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.groups?.body ?? "";
}

function rendererConfirmationHelper(actionSource: string): string {
  const match = actionSource.match(
    /await\s+(?<helper>[A-Za-z_$][\w$]*)\(\s*t\.[A-Za-z_$][\w$]*/u,
  );
  expect(
    match,
    "Action must await the renderer confirmation helper",
  ).not.toBeNull();
  return match?.groups?.helper ?? "";
}

describe("Codex sidebar alignment and in-app confirmations", () => {
  it("uses one exact text column for folder and conversation labels while preserving the selected row", () => {
    const projectTree = sourceBetween(
      appSource,
      '<div className="project-tree">',
      '<div className="sidebar-footer">',
    );
    expect(projectTree).toContain(
      '<span className="project-title">{project.name}</span>',
    );

    const sharedGrid = stylesSource.match(
      /\.project-select\s*,\s*\.thread-select\s*\{(?<body>[^}]*)\}/u,
    );
    expect(
      sharedGrid,
      "Project and conversation buttons must share one grid contract",
    ).not.toBeNull();
    expect(sharedGrid?.groups?.body).toContain("display: grid");
    const sharedMarkerColumn = sharedGrid?.groups?.body.match(
      /grid-template-columns:\s*var\((?<name>--[A-Za-z0-9-]+)\)\s+minmax\(0,\s*1fr\)/u,
    );
    expect(sharedMarkerColumn).not.toBeNull();
    expect(stylesSource).toContain(`${sharedMarkerColumn?.groups?.name}:`);

    expect(cssDeclarations(".project-title")).toContain("grid-column: 2");
    expect(cssDeclarations(".thread-select .thread-title")).toContain(
      "grid-column: 2",
    );
    const threadSelect = sourceBetween(
      projectTree,
      'className="thread-select"',
      "</button>",
    );
    expect(threadSelect.indexOf("status-dot")).toBeLessThan(
      threadSelect.indexOf("thread-title"),
    );
    const threadStatusDot = cssDeclarations(".thread-select .status-dot");
    expect(threadStatusDot).toContain("grid-column: 1");
    expect(threadStatusDot).toContain("justify-self: center");
    expect(threadStatusDot).not.toContain("position: absolute");
    expect(threadStatusDot).not.toMatch(/\bright:/u);
    expect(cssDeclarations(".project-thread-list")).toContain(
      "padding-left: 0",
    );
    expect(cssDeclarations(".project-thread-row")).toContain("margin-left: 0");
    expect(cssDeclarations(".project-thread-row")).toContain("padding-left: 0");

    const selectedRow = stylesSource.match(
      /\.project-thread-row:hover\s*,\s*\.project-thread-row\.selected\s*\{(?<body>[^}]*)\}/u,
    );
    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.groups?.body).toContain("background: var(--selected)");
  });

  it("routes delete, archive, project removal, and revert through one styled in-app dialog", () => {
    const actionSources = [
      sourceBetween(
        appSource,
        "const mutateReview = useCallback(",
        "const saveReviewComment = useCallback(",
      ),
      sourceBetween(
        appSource,
        "const removeProject = useCallback(",
        "const beginRenameThread = useCallback(",
      ),
      sourceBetween(
        appSource,
        "const deleteThread = useCallback(",
        "const setThreadArchived = useCallback(",
      ),
      sourceBetween(
        appSource,
        "const setThreadArchived = useCallback(",
        "const forkThread = useCallback(",
      ),
    ];
    const helpers = actionSources.map(rendererConfirmationHelper);

    expect(new Set(helpers).size).toBe(1);
    for (const actionSource of actionSources) {
      expect(actionSource).not.toContain("window.confirm");
      expect(actionSource).not.toContain("confirmResourceAction");
    }

    expect(appSource).toMatch(/role=["{]alertdialog/u);
    expect(appSource).toMatch(/aria-modal=(?:"true"|\{true\})/u);
    expect(appSource).toContain('className="confirmation-backdrop"');
    expect(appSource).toContain(
      "className={`confirmation-dialog ${confirmation.tone}`}",
    );
    expect(appSource).toContain('className="confirmation-actions"');

    const backdrop = cssDeclarations(".confirmation-backdrop");
    expect(backdrop).toContain("position: fixed");
    expect(backdrop).toContain("inset: 0");
    expect(backdrop).toMatch(/background:/u);

    const dialog = cssDeclarations(".confirmation-dialog");
    expect(dialog).toMatch(/border-radius:\s*(?!0(?:px)?;)/u);
    expect(dialog).toMatch(/box-shadow:/u);

    const actions = cssDeclarations(".confirmation-actions");
    expect(actions).toContain("display: flex");
    expect(actions).toContain("justify-content: flex-end");
  });
});
