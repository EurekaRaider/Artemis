import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const contextSource = source("../src/renderer/ComposerContextBar.tsx");
const apiSource = source("../src/shared/api.ts");
const preloadSource = source("../src/preload/preload.ts");
const mainSource = source("../src/main/main.ts");
const stylesSource = source("../src/renderer/styles.css");

describe("composer project and Git context menus", () => {
  it("renders the context bar with real project switching actions", () => {
    expect(appSource).toContain("<ComposerContextBar");
    expect(contextSource).toContain("搜索项目");
    expect(contextSource).toContain("新建项目");
    expect(contextSource).toContain("不在项目中工作");
    expect(contextSource).toContain("onSelectProject(project)");
    expect(contextSource).toContain("onOpenProject().catch");
    expect(contextSource).toContain("onClearProject()");
  });

  it("exposes Git inspection and branch mutations only through preload IPC", () => {
    expect(apiSource).toContain("getProjectGitInfo(");
    expect(apiSource).toContain("getProjectPullRequest(");
    expect(apiSource).toContain("threadId?: string");
    expect(apiSource).toContain("switchProjectBranch(");
    expect(apiSource).toContain("createProjectBranch(");
    expect(apiSource).toContain("commitProjectChanges(");
    expect(apiSource).toContain("pushProjectBranch(");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC.projectGitInfo");
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(IPC.projectPullRequest",
    );
    expect(preloadSource).toContain("IPC.projectGitBranchSwitch,");
    expect(preloadSource).toContain("IPC.projectGitBranchCreate,");
    expect(preloadSource).toContain("IPC.projectGitCommit,");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC.projectGitPush");
    expect(mainSource).toContain(
      "commitProjectChanges(\n        context.workspacePath,",
    );
    expect(mainSource).toContain("pushProjectBranch(context.workspacePath)");
    expect(mainSource).not.toContain("pushProjectBranch(project.path");
    expect(contextSource).not.toContain('from "node:child_process"');
  });

  it("guards branch mutations while local tasks are active", () => {
    expect(mainSource).toContain("store?.hasActiveLocalThread(projectId)");
    expect(mainSource).toContain("[...activeTurns.keys()].some");
    expect(mainSource).toContain(
      "assertProjectGitMutationAllowed(context.project.id)",
    );
    expect(contextSource).toContain("branchActionsDisabled");
  });

  it("includes searchable, keyboard-focusable loading, empty, and error states", () => {
    expect(contextSource).toContain('role="menu"');
    expect(contextSource).toContain('role="menuitemradio"');
    expect(contextSource).toContain('event.key !== "Escape"');
    expect(contextSource).toContain('role="status"');
    expect(contextSource).toContain('role="alert"');
    expect(contextSource).toContain("没有匹配的本地分支");
    expect(stylesSource).toContain(".composer-context-menu-skeleton");
    expect(stylesSource).toContain(".composer-context-trigger:focus-visible");
  });
});
