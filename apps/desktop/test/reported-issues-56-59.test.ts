import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const appSource = source("../src/renderer/App.tsx");
const apiSource = source("../src/shared/api.ts");
const mainSource = source("../src/main/main.ts");
const preloadSource = source("../src/preload/preload.ts");
const settingsStoreSource = source("../src/main/encrypted-settings-store.ts");
const stylesSource = source("../src/renderer/styles.css");

function sectionBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return appSource.slice(startIndex, endIndex);
}

describe("reported issues #56–#59", () => {
  it("persists and renders the temporary-conversation disclosure state", () => {
    const temporarySection = sectionBetween(
      'className="project-group temporary-conversations"',
      '<div className="sidebar-footer">',
    );

    expect(appSource).toContain(
      "const [temporaryConversationsOpen, setTemporaryConversationsOpen] =",
    );
    expect(appSource).toContain("createBooleanPreferencePersistenceQueue");
    expect(appSource).toContain(
      "window.artemis.setTemporaryConversationsOpen(open)",
    );
    expect(apiSource).toContain(
      "setTemporaryConversationsOpen(open: boolean): Promise<boolean>;",
    );
    expect(preloadSource).toContain("setTemporaryConversationsOpen: (open)");
    expect(mainSource).toContain(
      "settingsStore.setTemporaryConversationsOpen(open)",
    );
    expect(mainSource).toContain(
      ".temporary-conversations .project-new-thread",
    );
    expect(mainSource).toContain("view === 'temporary-collapsed'");
    expect(mainSource).toContain("view === 'temporary-double-toggle'");
    expect(
      mainSource.match(/\.temporary-conversations \.project-group-select/gu),
    ).toHaveLength(3);
    expect(mainSource).not.toContain(
      ".temporary-conversations .project-select",
    );
    expect(mainSource).toContain("temporaryConversationsOpen:");
    expect(settingsStoreSource).toContain(
      "const snapshot = structuredClone(settings);",
    );
    expect(settingsStoreSource).toContain(
      "const operation = this.persistence.then(async () =>",
    );
    expect(temporarySection).toContain(
      "aria-expanded={temporaryConversationsOpen}",
    );
    expect(temporarySection).toContain('className="project-group-select"');
    expect(temporarySection).not.toContain("<FolderIcon");
    expect(temporarySection).toContain("toggleTemporaryConversations");
    expect(temporarySection).toContain("hidden={!temporaryConversationsOpen}");
    expect(stylesSource).toMatch(
      /\.project-thread-list\[hidden\]\s*\{[^}]*display:\s*none/u,
    );
  });

  it("keeps creation actions beside their owning group", () => {
    const header = sectionBetween(
      '<div className="sidebar-header">',
      '<div\n          aria-label={t.projects}\n          className="project-tree"',
    );
    const projects = sectionBetween(
      'className="project-group project-collection"',
      "{projects.map((project) => {",
    );
    const temporarySection = sectionBetween(
      'className="project-group temporary-conversations"',
      '<div className="sidebar-footer">',
    );

    expect(header).not.toContain("<PlusIcon />");
    expect(header).not.toContain("openProject");
    expect(projects).toContain("onClick={() => void openProject()}");
    expect(projects).toContain("aria-label={t.openProject}");
    expect(temporarySection).toContain("onClick={beginTemporaryConversation}");
    expect(stylesSource).toMatch(
      /\.project-collection \.project-new-thread,[\s\S]*?\.temporary-conversations > \.project-row \.project-new-thread\s*\{[^}]*opacity:\s*1/u,
    );
  });

  it("top-aligns the drawer and has no obsolete global create popover", () => {
    const sidebarRule = stylesSource.match(/\.sidebar\s*\{([^}]*)\}/u)?.[1];
    const treeRule = stylesSource.match(/\.project-tree\s*\{([^}]*)\}/u)?.[1];

    expect(sidebarRule).toContain("flex-direction: column");
    expect(sidebarRule).toContain("justify-content: flex-start");
    expect(treeRule).toMatch(/padding:\s*[1-9]\d*px\s+10px\s+16px/u);
    expect(appSource).not.toContain('className="sidebar-create-menu"');
  });
});
