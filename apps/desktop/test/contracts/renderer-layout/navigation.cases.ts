import { readDesktopStyles } from "../../fixtures/application/styles-source.js";

import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "../css-test-utils.js";

import { describe, expect, it } from "vitest";

import {
  appSource,
  archivePageSource,
  stylesSource,
  nocturneStylesSource,
  publicUiStylesSource,
  publicUiSurfacesSource,
  apiSource,
  preloadSource,
  workspaceDockLayoutSource,
  mainProcessSource,
  smokeSource,
  cssRule,
  publicUiCssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("extends the macOS sidebar to the native lights and keeps controls outside drag regions", () => {
    const composition = readDesktopStyles("desktop-composition");
    expect(appSource).toContain("data-platform={snapshot.platform}");
    expect(mainProcessSource).toMatch(
      /titleBarStyle:\s*process\.platform === "darwin"\s*\? "hiddenInset"\s*:\s*process\.platform === "win32"\s*\? "hidden"\s*: "default"/u,
    );
    expect(mainProcessSource).toContain(
      "trafficLightPosition: { x: 18, y: 17 }",
    );
    expect(stylesSource).not.toContain(
      '.app-shell[data-platform="darwin"]::before',
    );
    expect(composition).toContain("-webkit-app-region: no-drag");
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        '.app-shell[data-platform="darwin"] .sidebar[data-state="ready"] .sidebar-top',
      ),
    ).toContain("padding-block-start: 7px");
    // 新建会话与项目列表之间不再画分隔线，列表上移。
    const sidebarTop = findCssDeclarations(composition, ".sidebar-top");
    expect(sidebarTop).toContain("padding: 10px 10px 2px");
    expect(sidebarTop).not.toContain("border-block-end");
    // 深色模式：导航行与会话行提白，项目文件夹行维持 --muted 现状。
    expect(
      findCssDeclarations(
        composition,
        '[data-artemis-theme="dark"] .project-thread-row',
      ),
    ).toContain("color: var(--text)");
    expect(
      findCssDeclarations(
        composition,
        '[data-artemis-theme="dark"] .project-row',
      ),
    ).toBeUndefined();
    expect(publicUiStylesSource).not.toMatch(
      /data-platform|-webkit-app-region/u,
    );
  });
  it("keeps the rail operable and lets it pin the collapsed sidebar", () => {
    expect(appSource).toContain('layout="integrated"');
    expect(appSource).toContain('className="rail-brand"');
    expect(appSource).toContain('className="rail-anchor"');
    expect(appSource).toContain("changeSidebarOpen(true)");
    expect(appSource).toContain("peek={sidebarPeek && !sidebarOpen}");
    expect(publicUiSurfacesSource).toContain('data-part="rail"');
  });
  it("keeps archived conversations out of the task sidebar and opens them from a library", () => {
    expect(appSource).toContain(
      "thread.projectId === project.id && !thread.archived",
    );
    expect(appSource).toContain("<ArchivePage");
    expect(appSource).toContain('activeView === "archive"');
    expect(appSource).toContain("setThreadArchived(thread, false)");
    expect(archivePageSource).toContain("<DataSurface");
    expect(archivePageSource).toContain('from "@artemis/ui/data"');
    expect(archivePageSource).toContain('className="archive-header"');
    expect(archivePageSource).toContain('className="archive-toolbar"');
    expect(archivePageSource).toContain('className="archive-search"');
    expect(archivePageSource).toContain("<SearchField");
    expect(archivePageSource).toContain('from "@artemis/ui/forms"');
    expect(archivePageSource).toContain('className="archive-empty"');
    expect(archivePageSource).toContain("t.archiveNoResultsTitle");
    expect(archivePageSource).toContain("t.archiveSearch");
    expect(archivePageSource).toContain('onClick={() => setQuery("")}');
    expect(archivePageSource).not.toContain('className="library-hero"');
    expect(cssRule(".archive-page")).toContain("overflow: hidden");
    expect(cssRule(".archive-page")).not.toContain("justify-content: center");
    expect(cssRule('.archive-page > [data-part="content"]')).toContain(
      "overflow-y: auto",
    );
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="data-surface"]',
    );
    expect(cssRule(".archive-results")).not.toContain("border:");
    expect(cssRule(".archive-empty")).not.toContain("border: 1px dashed");
  });
  it("keeps projectless temporary conversations visible and composable", () => {
    expect(appSource).toContain(
      'className="project-group temporary-conversations"',
    );
    expect(appSource).toContain("!thread.projectId && !thread.archived");
    expect(appSource).toContain("beginTemporaryConversation");
    expect(appSource).toContain("{!activeThread?.archived && (");
    expect(appSource).not.toContain(
      "{activeProject && !activeThread?.archived && (",
    );
    expect(appSource).toContain("if (!activeProjectId) return;");
    expect(appSource).toContain("...(activeProject");
    expect(appSource).toContain("{activeProject && (");
    expect(archivePageSource).toContain("t.archiveTemporary");
  });
  it("gives every project a removable sidebar action", () => {
    expect(appSource).toContain('className="project-action"');
    expect(appSource).toContain("removeProject(project)");
    expect(appSource).toContain('className="project-menu"');
  });
  it("keeps fixed composer controls and the trailing send action visible in a narrow workspace", () => {
    const composerStart = appSource.indexOf('className="composer-toolbar"');
    const composerEnd = appSource.indexOf(
      "<WorkspaceDockResizer",
      composerStart,
    );
    const composerSource = appSource.slice(composerStart, composerEnd);

    expect(composerStart).toBeGreaterThan(-1);
    expect(composerEnd).toBeGreaterThan(composerStart);
    expect(composerSource.indexOf('className="composer-leading"')).toBeLessThan(
      composerSource.indexOf('className="composer-trailing"'),
    );
    expect(composerSource.indexOf("<ContextUsageIndicator")).toBeLessThan(
      composerSource.indexOf('className="model-button"'),
    );
    expect(composerSource.indexOf('className="model-button"')).toBeLessThan(
      composerSource.indexOf('className="send-button'),
    );

    expect(
      publicUiCssRule('[data-artemis-component="conversation-surface"]'),
    ).toMatch(/\bcontainer-type:\s*inline-size/u);
    expect(cssRule(".composer-trailing")).toMatch(/\bflex:\s*1\s+1\s+0/u);
    expect(cssRule(".composer-trailing")).toMatch(/\bmargin-left:\s*auto/u);
    expect(stylesSource).toMatch(
      /\.composer-icon-button,\s*\.context-usage-indicator,\s*\.send-button,\s*\.run-actions\s*\{[^}]*\bflex:\s*0\s+0\s+auto/isu,
    );
  });
  it("renames sidebar tasks in a focused dialog without a browser prompt", () => {
    expect(appSource).not.toContain("window.prompt(t.taskNamePrompt");
    expect(appSource).toContain(
      "const [threadRename, setThreadRename] = useState",
    );
    expect(appSource).toContain('className="thread-rename-dialog"');
    expect(appSource).toContain("initialFocusRef={threadRenameInput}");
    expect(appSource).toContain("returnFocusRef={threadMenuAnchor}");
    expect(appSource).toContain('className="thread-rename-input"');
    expect(appSource).toContain("beginRenameThread(thread)");
    expect(appSource).toContain('event.key === "Escape"');
    expect(appSource).toContain("window.artemis.renameThread(");
    // The dialog-based rename keeps a neutral border; accent-blue borders
    // were retired with the monochrome accent direction.
    expect(cssRule(".thread-rename-input")).toMatch(
      /\bborder:\s*1px solid var\(--border\)/u,
    );
  });
  it("keeps expanded task steps inside the conversation when the right sidebar opens", () => {
    const taskPlanList = cssRule('.task-plan-progress [data-part="steps"]');

    expect(
      publicUiCssRule('[data-artemis-component="conversation-surface"]'),
    ).toMatch(/\bcontainer-type:\s*inline-size/u);
    expect(
      findCssDeclarations(
        nocturneStylesSource,
        '.app-shell .task-plan-progress [data-part="steps"]',
      ),
    ).toContain(
      "width: min(520px, calc(var(--conversation-column-width, 100cqi) - 40px))",
    );
    expect(taskPlanList).not.toMatch(/100vw/u);
    expect(taskPlanList).toMatch(/\bz-index:\s*1/u);
  });
  it("loads task history lazily and batches live renderer updates", () => {
    const agentWarmupIndex = mainProcessSource.indexOf(
      "agentRuntimeReady = applyAgentRuntime()",
    );
    const windowCreationIndex = mainProcessSource.lastIndexOf(
      "mainWindow = createMainWindow()",
    );

    expect(mainProcessSource).toContain("includeEvents: false");
    expect(agentWarmupIndex).toBeGreaterThan(-1);
    expect(windowCreationIndex).toBeGreaterThan(agentWarmupIndex);
    expect(
      mainProcessSource.slice(agentWarmupIndex, windowCreationIndex),
    ).not.toContain("await agentRuntimeReady");
    expect(appSource).toContain(".getThreadEvents(threadId)");
    expect(appSource).toContain("reduceAgentEventBatch");
    expect(appSource).toContain(
      "window.requestAnimationFrame(flushAgentEvents)",
    );
    expect(appSource).toContain(
      "Promise.all([loadResourceCenter(), loadSettingsPanel()])",
    );
    expect(appSource).toContain(
      "const idleCallback = window.requestIdleCallback(",
    );
    expect(appSource).toContain('import("../terminal/TerminalPanel.js")');
    expect(stylesSource).toContain("content-visibility: auto");
  });
  it("docks selected right-sidebar content beside the conversation", () => {
    const workspaceContentIndex = appSource.indexOf(
      'className="workspace-content"',
    );
    const reviewIndex = appSource.indexOf("<ReviewSurface");
    const terminalIndex = appSource.indexOf("<TerminalPanel");
    const terminalPanel = publicUiCssRule(
      '[data-artemis-component="terminal-surface"]',
    );
    const resizer = publicUiCssRule(
      '[data-artemis-component="workspace-dock-resizer"]',
    );

    expect(workspaceContentIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(workspaceContentIndex);
    expect(terminalIndex).toBeGreaterThan(workspaceContentIndex);
    expect(resizer).toMatch(/\bcursor:\s*col-resize/u);
    expect(resizer).toMatch(/\btouch-action:\s*none/u);
    expect(terminalPanel).toMatch(/\bmin-inline-size:\s*0/u);
    expect(terminalPanel).toMatch(/\bblock-size:\s*100%/u);
    expect(terminalPanel).not.toMatch(/\bblock-size:\s*190px/u);
    expect(terminalPanel).not.toMatch(/\bborder-block-start:/u);
  });
  it("keeps both sidebars compact, directly toggleable, and smoothly animated", () => {
    const shell = publicUiCssRule(
      '[data-artemis-component="application-shell"]',
    );
    const sidebar = publicUiCssRule(
      '[data-artemis-component="navigation-sidebar"]',
    );
    const collapsedSidebar = publicUiCssRule(
      '[data-artemis-component="navigation-sidebar"][data-state="collapsed"]',
    );
    const dock = publicUiCssRule('[data-artemis-component="workspace-dock"]');
    const resizer = publicUiCssRule(
      '[data-artemis-component="workspace-dock-resizer"]',
    );
    const projectSidebarResizer = publicUiCssRule(
      '[data-artemis-component="application-shell-resizer"]',
    );
    const closedDock = publicUiCssRule(
      '[data-artemis-component="workspace-dock"][data-state="closed"]',
    );

    expect(appSource).toContain("function LeftSidebarIcon()");
    expect(uiText("en", "App_copy.leftSidebar")).toBe("Left sidebar");
    expect(uiText("zh-CN", "App_copy.leftSidebar")).toBe("左侧边栏");
    expect(appSource).toContain('className="left-sidebar-toggle"');
    expect(appSource).toContain('className="status-pill-label"');
    expect(appSource).toContain("aria-expanded={sidebarOpen}");
    expect(appSource).toContain(
      "onClick={() => changeSidebarOpen((open) => !open)}",
    );
    expect(appSource).toContain("open={workspaceDockOpen}");
    expect(appSource).toContain('controls="conversation workspace-tool-dock"');
    expect(appSource).toContain("onPointerDown={beginWorkspaceDockResize}");
    expect(appSource).toContain("onKeyDown={resizeWorkspaceDockFromKeyboard}");
    expect(appSource).toContain("workspaceDockWidthAfterKey(");
    expect(workspaceDockLayoutSource).toContain('if (key === "Home")');
    expect(workspaceDockLayoutSource).toContain("DEFAULT_WORKSPACE_DOCK_WIDTH");
    expect(workspaceDockLayoutSource).toContain(
      'if (key === "End") return bounds.max',
    );
    expect(workspaceDockLayoutSource).toContain(
      'direction === "rtl" ? "ArrowRight" : "ArrowLeft"',
    );
    expect(apiSource).toContain("setWorkspaceDockWidth(width: number)");
    expect(preloadSource).toContain("setWorkspaceDockWidth: (width)");
    expect(appSource).toContain("onPointerDown={beginProjectSidebarResize}");
    expect(appSource).toContain("onKeyDown={resizeProjectSidebarFromKeyboard}");
    expect(appSource).toContain("<ApplicationShellResizer");
    expect(appSource).toContain("<NavigationSidebar");
    expect(apiSource).toContain("setProjectSidebarWidth(width: number)");
    expect(preloadSource).toContain("setProjectSidebarWidth: (width)");
    expect(appSource).toMatch(
      /sidebarSize=\{projectSidebarWidth \?\? defaultProjectSidebarWidth\}/u,
    );
    expect(appSource).not.toContain("sidebar-collapsed");
    expect(stylesSource).not.toContain("--project-sidebar-width");
    expect(smokeSource).toContain("Math.max(980");
    expect(mainProcessSource).toContain("minWidth: 980");
    expect(stylesSource).toContain(
      "@container workspace-header (max-width: 290px)",
    );

    expect(shell).toMatch(/--_artemis-application-shell-rail-size:\s*46px/u);
    expect(shell).toMatch(/grid-template-columns:/u);
    expect(shell).toMatch(/transition:\s*grid-template-columns/u);
    expect(sidebar).toMatch(/transition:/u);
    expect(sidebar).toMatch(/\btransform:/u);
    expect(collapsedSidebar).toMatch(/\bopacity:\s*0/u);
    expect(collapsedSidebar).toMatch(/\bvisibility:\s*hidden/u);
    expect(collapsedSidebar).not.toMatch(
      /visibility[^;]*var\(--artemis-motion-duration-normal\)/u,
    );
    expect(collapsedSidebar).toMatch(
      /\btransform:\s*translateX\(calc\(var\(--artemis-space-4\)\s*\*\s*-1\)\)/u,
    );
    expect(projectSidebarResizer).toMatch(/\bcursor:\s*col-resize/u);
    expect(projectSidebarResizer).toMatch(/\btouch-action:\s*none/u);

    expect(dock).toMatch(
      /\bflex:\s*0\s+1\s+var\(--workspace-dock-width,\s*22\.5rem\)/u,
    );
    expect(dock).toMatch(/\binline-size:\s*var\(--workspace-dock-width/u);
    expect(dock).toMatch(/calc\(100%\s*-\s*20\.4375rem\)/u);
    expect(dock).toMatch(/transition:/u);
    expect(resizer).toMatch(
      /\bflex:\s*0\s+0\s+calc\(var\(--artemis-space-1\) \+ 1px\)/u,
    );
    expect(closedDock).toMatch(/\bflex-basis:\s*0/u);
    expect(closedDock).toMatch(/\bopacity:\s*0/u);
    expect(closedDock).toMatch(/\btransform:\s*translateX\(/u);
    expect(stylesSource).toMatch(
      /\.workspace-content\s*\{[^}]*position:\s*relative;/su,
    );
    expect(publicUiStylesSource).toMatch(
      /@media\s*\(max-width:\s*820px\)[\s\S]*workspace-dock[^}]*position:\s*absolute;[^}]*inline-size:\s*100%;/u,
    );
    expect(publicUiStylesSource).toMatch(
      /@media\s*\(max-width:\s*820px\)[\s\S]*review-surface[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );

    expect(publicUiStylesSource).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*application-shell[\s\S]*navigation-sidebar/u,
    );
    expect(publicUiStylesSource).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*workspace-dock[\s\S]*transition:\s*none/u,
    );
  });
  it("keeps temporary chats as a natural root after projects", () => {
    const temporaryRoot = appSource.indexOf(
      'className="project-group temporary-conversations"',
    );
    const projectsRoot = appSource.indexOf(
      'className="project-group project-collection"',
    );
    const nestedProjects = appSource.indexOf(
      "{projects.map((project) => {",
      projectsRoot,
    );

    expect(temporaryRoot).toBeGreaterThan(-1);
    expect(temporaryRoot).toBeGreaterThan(projectsRoot);
    expect(nestedProjects).toBeGreaterThan(projectsRoot);
    expect(temporaryRoot).toBeGreaterThan(nestedProjects);
    expect(cssRule(".project-tree")).not.toContain("display: flex");
    expect(stylesSource).not.toContain(
      ".project-tree > .temporary-conversations",
    );
    expect(uiText("en", "App_copy.temporaryConversations")).toBe(
      "Temporary chats",
    );
    expect(uiText("en", "App_copy.temporaryConversation")).toBe(
      "Temporary chat",
    );
    expect(uiText("en", "App_copy.temporaryConversation")).toBe(
      "Temporary chat",
    );
    expect(uiText("en", "App_copy.temporaryConversation")).toBe(
      "Temporary chat",
    );
    expect(appSource).toContain("`project-group nested-project${");
    expect(appSource).toContain('data-tree-kind="project"');
    expect(appSource).toContain("onClick={() => toggleProjectsExpansion()}");
  });
  it("dismisses sidebar and composer menus from outside clicks or Escape", () => {
    expect(appSource).toContain(
      '".project-menu, .thread-menu, .project-action, .thread-action"',
    );
    expect(appSource).toContain(
      'window.addEventListener("keydown", closeOnEscape)',
    );
    expect(appSource).toContain("modelPickerRoot.current?.contains");
    expect(appSource).not.toContain("modelPickerHoverCloseTimer");
  });
  it("keeps the composer keyboard-focusable after an archived task is restored", () => {
    const archiveHandlerStart = appSource.indexOf(
      "const setThreadArchived = useCallback(",
    );
    const archiveHandlerEnd = appSource.indexOf(
      "\n  const forkThread",
      archiveHandlerStart,
    );
    const archiveHandler = appSource.slice(
      archiveHandlerStart,
      archiveHandlerEnd,
    );

    expect(archiveHandlerStart).toBeGreaterThan(-1);
    expect(archiveHandlerEnd).toBeGreaterThan(archiveHandlerStart);
    expect(archiveHandler).not.toContain("window.confirm(");
    expect(archiveHandler).toContain(
      "await requestConfirmation(t.archiveConfirm)",
    );
    expect(archiveHandler).toMatch(
      /setActiveThreadId\(updated\.id\);[\s\S]*?requestAnimationFrame\(\(\) =>\s*promptInput\.current\?\.focus\(\)/u,
    );
  });
});
