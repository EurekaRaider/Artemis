import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "../css-test-utils.js";

import { describe, expect, it } from "vitest";
import { contextMenuLayout } from "../../../src/renderer/conversation/ComposerContextBar.js";
import {
  appSource,
  userInputSource,
  composerContextSource,
  automationPageSource,
  stylesSource,
  nocturneStylesSource,
  compositionStylesSource,
  publicUiStylesSource,
  publicUiSurfacesSource,
  settingsSource,
  resourceCenterSource,
  mcpServerEditorSource,
  apiSource,
  preloadSource,
  mainProcessSource,
  runtimeSource,
  codexSelectSource,
  uiFormsSource,
  uiStylesSource,
  promptHistorySource,
  toolActivityGroupsSource,
  cssRule,
  publicUiCssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("offers Plan, Work, and Codemode in that order", () => {
    const plan = composerContextSource.indexOf('["plan", "plan"]');
    const work = composerContextSource.indexOf('["work", "work"]');
    const codemode = composerContextSource.indexOf('["codemode", "code"]');
    expect(plan).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(plan);
    expect(codemode).toBeGreaterThan(work);
    expect(automationPageSource).toContain(
      '["plan", "work", "codemode"] as const',
    );
    expect(runtimeSource).toContain('name: "office_document"');
    expect(runtimeSource).toContain("hosted.executeTools");
  });
  it("keeps the workspace and conversation height-constrained", () => {
    expect(cssRule(".workspace")).toMatch(/\bheight:\s*100%/u);
    expect(
      findCssDeclarations(compositionStylesSource, ".app-shell .workspace"),
    ).toContain("overflow: visible");
    // clip also prevents focus in a translated Dock from scrolling the shell.
    expect(cssRule(".workspace-content")).toMatch(
      /\boverflow:\s*(?:hidden|clip)/u,
    );
    const conversation = publicUiCssRule(
      '[data-artemis-component="conversation-surface"]',
    );
    expect(conversation).toMatch(/\bmin-block-size:\s*0/u);
    expect(conversation).toMatch(/\boverflow:\s*hidden/u);
  });
  it("keeps the composer in a fixed layout row instead of a sticky overlay", () => {
    const composer = cssRule(".composer-wrap");
    const conversation = publicUiCssRule(
      '[data-artemis-component="conversation-surface"]',
    );

    expect(composer).not.toMatch(/\bposition:\s*sticky/u);
    expect(`${composer}\n${conversation}`).toMatch(
      /\bflex:\s*0\s+0\s+auto|\bgrid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/u,
    );
  });
  it("places transient notices above the composer without covering the task-step capsule", () => {
    const composerStart = appSource.indexOf('<div className="composer-wrap">');
    const taskPlanIndex = appSource.indexOf("<TaskPlanProgress", composerStart);
    const noticeIndex = appSource.indexOf("<TransientNotice", taskPlanIndex);
    const contextIndex = appSource.indexOf("<ComposerContextBar", noticeIndex);

    expect(taskPlanIndex).toBeGreaterThan(composerStart);
    expect(noticeIndex).toBeGreaterThan(taskPlanIndex);
    expect(contextIndex).toBeGreaterThan(noticeIndex);
    expect(appSource).toContain("const TOAST_VISIBLE_MILLISECONDS = 10_000;");
    expect(appSource).toContain("const TOAST_FADE_MILLISECONDS = 600;");
    expect(appSource).toContain("setToastState((current) =>");
    expect(appSource).toContain("fading: true");
    expect(cssRule(".composer-notice")).not.toMatch(
      /\bposition:\s*(?:fixed|absolute)/u,
    );
    expect(cssRule(".transient-notice")).toMatch(
      /\btransition:[\s\S]*\bopacity\s+600ms\s+ease/u,
    );
    expect(cssRule(".transient-notice.fading")).toMatch(/\bopacity:\s*0/u);
    expect(stylesSource).not.toMatch(/\.toast\s*\{[^}]*\bbottom:/su);
  });
  it("preserves the former command menu actions through their existing entry points", () => {
    expect(appSource).toContain("onClick={() => void openProject()}");
    expect(appSource).toContain('selectComposerCommand("/goal ")');
    expect(appSource).toContain("onActivate={openReviewPanel}");
    expect(appSource).toContain("onActivate={openTerminalPanel}");
    expect(appSource).toContain("toggleReviewPanel();");
    expect(appSource).toContain("toggleTerminalPanel();");
  });
  it("uses a Codex-style context strip and compact composer toolbar", () => {
    const contextIndex = appSource.indexOf("<ComposerContextBar");
    const composerIndex = appSource.indexOf('className="composer"');

    expect(contextIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(contextIndex);
    expect(appSource).toContain('className="composer-leading"');
    expect(appSource).toContain('className="composer-trailing"');
    expect(appSource).toContain("selectPromptAttachments()");
    expect(appSource).toContain("<ComposerAttachments");
    expect(cssRule(".attachment-image-strip")).toContain("overflow-x: auto");
    expect(cssRule(".composer-context")).toMatch(/\bdisplay:\s*flex/u);
    expect(cssRule(".composer-context-trigger")).toMatch(
      /\bmax-width:\s*100%[\s\S]*\boverflow:\s*hidden[\s\S]*\bwidth:\s*100%/u,
    );
    expect(
      findCssDeclarations(nocturneStylesSource, ".composer-run-modes"),
    ).toMatch(/\bflex:\s*0\s+0\s+auto/u);
    expect(uiStylesSource).toContain(
      '[data-artemis-component="select"] [data-part="menu"]',
    );
    expect(
      publicUiCssRule('[data-artemis-component="select"] [data-part="menu"]'),
    ).toContain("inset-inline-start: 0");
    expect(
      publicUiCssRule('[data-artemis-component="select"] [data-part="menu"]'),
    ).toContain("inline-size: max-content");
    expect(cssRule(".composer-context-menu")).toMatch(
      /\bdisplay:\s*flex[\s\S]*\bwidth:\s*min\(280px,\s*calc\(100cqi\s*-\s*64px\)\)/u,
    );
    expect(
      findCssDeclarations(compositionStylesSource, ".composer-wrap"),
    ).toMatch(/\bz-index:\s*20/u);
    expect(composerContextSource).toContain(
      "new ResizeObserver(updateMenuLayout)",
    );
    expect(composerContextSource).toContain("focus({ preventScroll: true })");
    expect(composerContextSource).toContain("conversation.scrollLeft = 0");
    const composerSurface = publicUiCssRule(
      '[data-artemis-component="composer-surface"]',
    );
    expect(composerSurface).toMatch(
      /\bborder-radius:\s*var\(--artemis-radius-composer\)/u,
    );
    expect(composerSurface).toMatch(
      /border:\s*var\(--artemis-border-width-default\) solid[\s\S]*var\(--artemis-color-border-surface\)/u,
    );
    expect(cssRule(".composer-context")).toContain("margin: 0;");
    expect(
      publicUiCssRule(
        '[data-artemis-component="composer-surface"] > [data-part="context"]',
      ),
    ).toContain("background: var(--artemis-color-surface-sunken)");
  });
  it("keeps context menus inside the resized conversation", () => {
    expect(contextMenuLayout(260, 0, 500)).toEqual({
      left: 0,
      maxHeight: 484,
      width: 260,
    });
    expect(contextMenuLayout(260, 120, 500)).toEqual({
      left: -120,
      maxHeight: 484,
      width: 260,
    });
    expect(contextMenuLayout(500, 400, 500)).toEqual({
      left: -180,
      maxHeight: 484,
      width: 280,
    });
  });
  it("keeps the task mode select from scrolling the conversation", () => {
    expect(codexSelectSource).toContain('from "@artemis/ui/forms"');
    expect(uiFormsSource).toContain("focus({ preventScroll: true })");
    expect(uiFormsSource).toContain("listboxElement.scrollTop");
    expect(uiFormsSource).not.toContain(".scrollIntoView(");
    expect(uiFormsSource).not.toContain("scrollLeft");
    expect(uiFormsSource).not.toContain("document.scrollingElement");
    expect(uiFormsSource).not.toContain("window.scrollTo");
  });
  it("loads persisted prompt history and navigates it with arrow keys", () => {
    expect(apiSource).toContain("getPromptHistory(): Promise<string[]>");
    expect(preloadSource).toContain(
      "getPromptHistory: () => ipcRenderer.invoke(IPC.promptHistory)",
    );
    expect(mainProcessSource).toContain("store.listPromptHistory()");
    expect(appSource).toContain(".getPromptHistory()");
    expect(appSource).toContain('event.key === "ArrowUp"');
    expect(appSource).toContain('event.key === "ArrowDown"');
    expect(appSource).toContain("navigatePromptHistory(");
    expect(promptHistorySource).toContain("state.draft");
  });
  it("renders one recommended workflow choice and wires its resolution", () => {
    expect(apiSource).toContain(
      "resolveUserInput(resolution: UserInputResolution): Promise<void>",
    );
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(IPC.userInputResolve, resolution)",
    );
    expect(mainProcessSource).toContain("USER_INPUT_TIMEOUT_MILLISECONDS");
    expect(mainProcessSource).toContain("selectedOption: recommendedOption");
    expect(mainProcessSource).toContain('        "timeout",');
    expect(appSource).toContain("activePendingDecisionId");
    expect(toolActivityGroupsSource).toContain('"request_user_input"');
    expect(userInputSource).toContain("o.recommended");
    expect(uiText("zh-CN", "App_copy.timeoutHint")).toBe(
      "5 分钟内未选择将自动采用模型推荐项",
    );
  });
  it("creates tasks locally by default and exposes explicit workspace handoff", () => {
    const createThreadStart = appSource.indexOf(
      "const createThread = useCallback",
    );
    const createThreadEnd = appSource.indexOf(
      "const renameThread = useCallback",
      createThreadStart,
    );
    const createThreadSource = appSource.slice(
      createThreadStart,
      createThreadEnd,
    );

    expect(createThreadSource).toContain('target: "local"');
    expect(createThreadSource).not.toContain("workspaceTarget");
    expect(appSource).not.toContain(
      "const changeWorkspaceTarget = useCallback",
    );
    expect(appSource).not.toContain("const branchizeWorktree = useCallback");
    expect(appSource).not.toContain("const cleanupWorktree = useCallback");
    expect(appSource).not.toContain(
      "const restoreWorktreeSnapshot = useCallback",
    );
    expect(appSource).not.toContain("<CodexSelect<WorkspaceTarget>");
    expect(appSource).not.toContain('className="target-switcher"');
    expect(appSource).not.toContain('className="workspace-target-badge"');
    expect(appSource).not.toContain('className="branch-glyph"');
    expect(appSource).toContain("window.artemis.handoffWorkspace");
    expect(appSource).toContain("onWorkspaceHandoff={");
    expect(appSource).toContain("onWorktreesChanged={");
    expect(appSource).not.toContain("window.artemis.branchizeWorktree");
    expect(appSource).not.toContain("window.artemis.cleanupWorktree");
    expect(appSource).not.toContain("window.artemis.restoreWorktreeSnapshot");
  });
  it("accepts dropped files and images through the isolated preload bridge", () => {
    expect(preloadSource).toContain("webUtils.getPathForFile");
    expect(preloadSource).toContain("readPromptAttachments");
    expect(appSource).toContain("onDragEnter={handleAttachmentDragEnter}");
    expect(appSource).toContain("onDragOver={handleAttachmentDragOver}");
    expect(appSource).toContain("onDrop={handleAttachmentDrop}");
    expect(appSource).toContain('className="composer-drop-overlay"');
    expect(cssRule(".composer-drop-overlay")).toMatch(
      /\bposition:\s*absolute/u,
    );
  });
  it("accepts pasted files and images through the attachment bridge", () => {
    expect(appSource).toMatch(
      /onPaste=\{\(event\) => \{\s*composerPrediction\.dismiss\(\);\s*handleAttachmentPaste\(event\);\s*\}\}/u,
    );
    expect(appSource).toContain("event.clipboardData.files");
    expect(preloadSource).toContain("readPromptAttachmentsFromFiles");
  });
  it("uses custom Codex-style context menus and modern UI typography", () => {
    expect(composerContextSource).not.toContain("<select");
    expect(composerContextSource).toContain("<RunModeControl");
    expect(composerContextSource).toContain('from "@artemis/ui/patterns"');
    expect(cssRule(":root").replace(/\s+/gu, " ")).toContain(
      "--ui-font: var(--artemis-typography-body-family);",
    );
    expect(uiStylesSource).toContain(
      '[data-artemis-component="select"] [data-part="menu"]',
    );
    expect(uiStylesSource).toContain(
      '[data-part="option"][aria-selected="true"]',
    );
  });
  it("uses shared selectors for product dropdowns and segments for review scope", () => {
    const rendererSources = `${appSource}\n${settingsSource}\n${mcpServerEditorSource}`;
    const settingsSelectors =
      settingsSource.match(/<Select(?:<[^>]+>)?/gu) ?? [];
    const mcpEditorSelectors =
      mcpServerEditorSource.match(/<Select(?:<[^>]+>)?/gu) ?? [];

    expect(rendererSources).not.toMatch(/<select\b/gu);
    expect(settingsSource).toContain('from "@artemis/ui/forms"');
    expect(mcpServerEditorSource).toContain('from "@artemis/ui/forms"');
    expect(settingsSelectors).toHaveLength(9);
    expect(mcpEditorSelectors).toHaveLength(1);
    expect(uiFormsSource).toContain('data-artemis-component="select"');
    expect(codexSelectSource).toContain('size = "comfortable"');
    expect(composerContextSource).toContain('className="composer-run-modes"');
    expect(appSource).toContain('className="review-scope-select"');
    expect(appSource).toContain('size="compact"');
    expect(composerContextSource).toContain("onValueChange={onModeChange}");
    expect(appSource).toMatch(
      /className="review-scope-select">\s*<SegmentedControl<ReviewScope>/u,
    );
    expect(stylesSource).not.toContain(
      '.review-scope-select [data-artemis-component="select"] [data-part="trigger"]',
    );
    expect(uiStylesSource).toContain("inline-size: 100%");
  });
  it("keeps large custom menus on one keyboard tab stop", () => {
    expect(uiFormsSource).toContain("aria-activedescendant={");
    expect(uiFormsSource).toContain(
      "tabIndex={searchPlaceholder === undefined ? 0 : -1}",
    );
    expect(uiFormsSource).toContain('role="option"');
    expect(uiFormsSource).not.toMatch(/<button[\s\S]{0,500}?role="option"/u);
  });
  it("switches between system, light, and dark themes through the skin host", () => {
    expect(settingsSource).toContain("window.artemis.setTheme(theme)");
    expect(settingsSource).toContain(
      '{ value: "system", label: t.themeSystem }',
    );
    expect(settingsSource).toMatch(
      /value: "light",\s+label: t\.themeLight,\s+icon: <ArtemisIcon name="sun"/u,
    );
    expect(settingsSource).toMatch(
      /value: "dark",\s+label: t\.themeDark,\s+icon: <ArtemisIcon name="moon"/u,
    );
    expect(appSource).toContain("desktopSkinHost.setTheme(theme)");
    expect(stylesSource).toContain(':root[data-theme="light"]');
    expect(stylesSource).toContain(':root[data-theme="dark"]');
    expect(cssRule(":root")).toContain("color-scheme: light dark");
    expect(cssRule(":root")).toContain("light-dark(");
  });
  it("keeps the public reference-slice surface boundary presentation-only", () => {
    expect(appSource).toContain('from "@artemis/ui/surfaces"');
    expect(publicUiSurfacesSource).not.toMatch(
      /@artemis\/protocol|electron|node:/u,
    );
    expect(publicUiSurfacesSource).not.toMatch(/skinId|skin-id/u);
    expect(publicUiSurfacesSource).not.toMatch(
      /setActiveView|resolveApproval|setSidebarOpen|setWorkspaceDock/u,
    );
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="application-shell"]',
    );
    expect(publicUiStylesSource).toContain(
      '[data-artemis-component="composer-surface"]',
    );
    expect(stylesSource).not.toMatch(
      /(?:^|\})\s*\.app-shell\s*\{|(?:^|\})\s*\.composer\s*\{/u,
    );
    expect(publicUiStylesSource).not.toMatch(
      /--_artemis-application-shell-effective-sidebar-size:\s*min\(/u,
    );
  });
  it("aligns conversation content with the wider composer reference line", () => {
    const timeline = publicUiCssRule('[data-artemis-component="timeline"]');
    const composerWrap = cssRule(".composer-wrap");

    expect(timeline).toMatch(/\bmax-inline-size:\s*60rem/u);
    expect(timeline).toMatch(
      /\bpadding:\s*calc\(var\(--artemis-space-6\) \+ var\(--artemis-space-2\) \+ 2px\)\s+var\(--artemis-space-5\) var\(--artemis-space-6\)/u,
    );
    expect(composerWrap).toMatch(/\bmax-width:\s*736px/u);
    expect(
      findCssDeclarations(compositionStylesSource, ".composer-wrap"),
    ).toContain("padding: 0 var(--conversation-padding) 16px");
  });
  it("localizes every task mode in the Simplified Chinese menu", () => {
    expect(uiText("zh-CN", "App_copy.plan")).toBe("计划模式");
    expect(uiText("zh-CN", "App_copy.work")).toBe("执行模式");
    expect(uiText("zh-CN", "App_copy.codemode")).toBe("代码模式");
  });
  it("uses the in-app confirmation dialog while preserving native file-picker focus", () => {
    expect(resourceCenterSource).not.toContain("window.confirm(");
    expect(resourceCenterSource).not.toContain("confirmResourceAction");
    expect(resourceCenterSource).toContain("await onConfirm(");
    expect(appSource).toContain('role="alertdialog"');
    expect(appSource).toContain(
      "className={`confirmation-dialog ${confirmation.tone}`}",
    );
    expect(mainProcessSource).toContain("restoreResourceDialogFocus");
    expect(mainProcessSource).toMatch(
      /selection = await dialog\.showOpenDialog[\s\S]*?restoreResourceDialogFocus\(/u,
    );
  });
  it("keeps public management Select menus above their surfaces", () => {
    for (const surface of ["settings-surface", "mcp-editor-surface"]) {
      expect(publicUiStylesSource).toMatch(
        new RegExp(
          `\\[data-artemis-component="${surface}"\\]\\s+` +
            '\\[data-artemis-component="select"\\]\\s+' +
            '\\[data-part="menu"\\]\\s*\\{[^}]*\\bz-index:\\s*80',
          "u",
        ),
      );
    }
    expect(stylesSource).not.toContain(".settings-codex-select");
  });
  it("uses logical geometry and directional icons in management surfaces", () => {
    expect(cssRule(".mcp-editor-validation ul")).toContain(
      "padding-inline-start: 18px",
    );
    expect(cssRule(".mcp-editor-validation ul")).not.toContain("padding-left");
    expect(cssRule(".resource-switch")).toContain("margin-inline-start: 5px");
    expect(cssRule(".resource-switch")).not.toContain("margin-left");
    expect(mcpServerEditorSource).toContain('<ArtemisIcon name="chev-left"');
    expect(mcpServerEditorSource).not.toContain("← {t.cancel}");
    expect(stylesSource).toContain(".mcp-editor-back svg");
  });
});
