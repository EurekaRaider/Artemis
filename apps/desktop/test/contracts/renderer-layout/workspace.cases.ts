import { readRendererController } from "../../fixtures/application/renderer-source.js";

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  appSource,
  publicUiProfessionalSource,
  apiSource,
  browserLocaleSource,
  preloadSource,
  terminalSource,
  workspacePreviewSource,
  workspaceFilesSource,
  mainProcessSource,
  rendererHtmlSource,
  cssRule,
  publicUiCssRule,
  publicUiCssDeclarationsForSelector,
  hexProperty,
  relativeLuminance,
  contrastRatio,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("keeps the terminal and native window chrome aligned with the theme", () => {
    expect(appSource).toContain('theme={runtimeSettings?.theme ?? "system"}');
    expect(terminalSource).toContain(
      'window.matchMedia("(prefers-color-scheme: dark)")',
    );
    expect(terminalSource).toContain("terminal.options.theme =");
    expect(
      publicUiCssRule('[data-artemis-component="terminal-surface"]'),
    ).toMatch(/\bbackground:\s*var\(--artemis-color-terminal-background\)/u);
    expect(
      publicUiCssRule('[data-artemis-component="terminal-header"]'),
    ).toMatch(/\bbackground:\s*var\(--artemis-color-surface-raised\)/u);
    expect(terminalSource).toContain('"--artemis-color-terminal-background"');
    expect(terminalSource).toContain('"--artemis-color-terminal-foreground"');
    expect(mainProcessSource).toContain("nativeTheme.themeSource = theme");
    expect(mainProcessSource).toContain("window.setBackgroundColor");
  });
  it("keeps xterm text themed and overlay canvases transparent", () => {
    const darkTheme = terminalSource.match(
      /\bdark:\s*\{(?<declarations>[^}]*)\}/u,
    )?.groups?.declarations;

    expect(darkTheme).toBeDefined();
    const background = hexProperty(darkTheme!, "background");
    const foreground = hexProperty(darkTheme!, "foreground");
    expect(relativeLuminance(background)).toBeLessThan(0.02);
    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(7);

    for (const selector of [
      '[data-artemis-component="terminal-host"] .xterm-screen',
      '[data-artemis-component="terminal-host"] .xterm-rows',
      '[data-artemis-component="terminal-host"] .xterm .xterm-viewport',
    ]) {
      const declarations = publicUiCssDeclarationsForSelector(selector);
      expect
        .soft(declarations, `Missing CSS rule for ${selector}`)
        .toBeDefined();
      expect
        .soft(declarations ?? "", `Wrong background for ${selector}`)
        .toMatch(
          /\bbackground(?:-color)?:\s*var\(--artemis-color-terminal-background\)/u,
        );
    }

    for (const selector of [
      '[data-artemis-component="terminal-host"] .xterm-screen canvas',
      '[data-artemis-component="terminal-host"] .xterm-helper-textarea',
    ]) {
      expect(publicUiCssDeclarationsForSelector(selector)).toMatch(
        /\bbackground:\s*transparent\s*;/u,
      );
    }

    for (const selector of [
      '[data-artemis-component="terminal-host"] .xterm-screen',
      '[data-artemis-component="terminal-host"] .xterm-rows',
    ]) {
      const declarations = publicUiCssDeclarationsForSelector(selector);
      expect
        .soft(declarations ?? "", `Wrong foreground for ${selector}`)
        .toMatch(/\bcolor:\s*var\(--artemis-color-terminal-foreground\)/u);
    }
  });
  it("fits the terminal with xterm cell measurements instead of hand-estimated dimensions", () => {
    expect(terminalSource).toContain('from "@xterm/addon-fit"');
    expect(terminalSource).toContain("new FitAddon()");
    expect(terminalSource).toContain("terminal.loadAddon(fitAddon)");
    expect(terminalSource).toContain("fitAddon.fit()");
    expect(terminalSource).not.toContain("function terminalDimensions");
    expect(terminalSource).not.toMatch(
      /client(?:Width|Height)\s*\/\s*\d+(?:\.\d+)?/u,
    );
  });
  it("keeps the completed terminal transcript visible after its process exits", () => {
    expect(terminalSource).toContain('setState("exited");');
    expect(terminalSource).toMatch(
      /\(state === "connecting" \|\|[\s\S]*state === "empty" \|\|[\s\S]*state === "error"\) && \(/u,
    );
    expect(terminalSource).toContain(
      'disabled={state !== "ready" && state !== "exited"}',
    );
    expect(terminalSource).not.toMatch(/state !== "ready" && \(/u);
  });
  it("caches Review data for scope switching without eager prefetching", () => {
    expect(appSource).toContain("useTransition");
    expect(appSource).toContain(
      "const reviewDiffCache = useRef(new Map<string, ReviewDiff>());",
    );
    expect(appSource).toContain("const reviewDiffInFlight = useRef(");
    expect(appSource).not.toContain("prefetchReviewDiffs");
    expect(appSource).toMatch(
      /selectReviewScope\s*=\s*\([^)]*scope[^)]*\)\s*=>\s*\{[\s\S]*?setReviewScope\(scope\);[\s\S]*?reviewDiffCache\.current\.get\([\s\S]*?setReviewDiff\(cached\);[\s\S]*?\}/u,
    );
    expect(appSource).toContain("onValueChange={selectReviewScope}");
    expect(appSource).toMatch(
      /startReviewTransition\(\(\)\s*=>\s*\{?[\s\S]*?setReviewDiff\(diff\);?[\s\S]*?\}?\);/u,
    );
    const refreshDiff = appSource.slice(
      appSource.indexOf("const refreshDiff = useCallback"),
      appSource.indexOf(
        "const selectReviewScope",
        appSource.indexOf("const refreshDiff = useCallback"),
      ),
    );
    expect(refreshDiff).not.toMatch(
      /Promise\.all\(\[[\s\S]*?getReviewDiff[\s\S]*?listReviewComments/u,
    );
  });
  it("initializes both Review scopes to branch by default", () => {
    expect.soft(appSource).toContain('useState<ReviewScope>("branch")');
    expect
      .soft(appSource)
      .toMatch(
        /useState<ReviewDiff \| undefined>\(\{[\s\S]*?scope:\s*"branch"/u,
      );
  });
  it("lays out Review as a comparison toolbar, central diff reader, and searchable file sidebar", () => {
    const reviewStart = appSource.indexOf("<ReviewSurface");
    const reviewEnd = appSource.indexOf(
      '{tab.kind === "terminal"',
      reviewStart,
    );
    const reviewSource = appSource.slice(reviewStart, reviewEnd);
    const toolbar = reviewSource.indexOf("<ReviewToolbar");
    const reader = reviewSource.indexOf("<ReviewDiffReader");
    const sidebar = reviewSource.indexOf("<ReviewFileSidebar");

    expect(reviewStart).toBeGreaterThan(-1);
    expect(reviewEnd).toBeGreaterThan(reviewStart);
    expect(toolbar).toBeGreaterThan(-1);
    expect(reader).toBeGreaterThan(toolbar);
    expect(sidebar).toBeGreaterThan(toolbar);
    expect(reader).toBeGreaterThan(sidebar);
    expect(reviewSource).toContain('className="review-scope-select"');
    expect(reviewSource).toContain('className="review-file-filter"');
    expect(reviewSource).toContain("setReviewFileQuery");
    expect(reviewSource).toContain("setSelectedReviewFilePath(file.path)");
    expect(reviewSource).toContain('className="review-empty-illustration"');
    expect(reviewSource).toContain("{t.changesAppearHere}");
    expect(reviewSource).not.toContain('className="review-scopes"');
    expect(appSource).toMatch(
      /file\.path\.toLowerCase\(\)\.includes\(normalizedQuery\)/u,
    );
    for (const preservedAction of [
      'mutateReview("stage"',
      'mutateReview("unstage"',
      "saveReviewComment(",
    ]) {
      expect(reviewSource).toContain(preservedAction);
    }
    expect(reviewSource).toMatch(/mutateReview\(\s*"revert"/u);

    const workspace = publicUiCssRule(
      '[data-artemis-component="review-surface"][data-part="workspace"]',
    );
    const fileSidebar = publicUiCssRule(
      '[data-artemis-component="review-surface"][data-part="files"]',
    );
    expect(workspace).toMatch(/\bdisplay:\s*(?:flex|grid)/u);
    expect(workspace).toMatch(/\bgrid-template-columns:/u);
    expect(fileSidebar).toMatch(/\bborder-inline-start:/u);
  });
  it("lets the Review viewport reach long lines and renders the selected diff once", () => {
    const reviewFile = cssRule(".review-file");

    expect(reviewFile).toMatch(/\boverflow:\s*visible/u);
    expect(reviewFile).not.toMatch(/\bcontent-visibility:\s*auto/u);
    expect(appSource).not.toMatch(
      /<pre[^>]*className="diff-view"[^>]*>[\s\S]*?reviewDiff\.text[\s\S]*?<\/pre>/u,
    );
  });
  it("opens a tabbed workspace launcher before mounting Review or Terminal", () => {
    const launcher = publicUiCssRule(
      '[data-artemis-component="workspace-launcher"]',
    );
    const launcherItem = publicUiCssRule(
      '[data-artemis-component="workspace-launcher"] [data-part="action"]',
    );
    const resizer = publicUiCssRule(
      '[data-artemis-component="workspace-dock-resizer"]',
    );
    const launcherStart = appSource.indexOf("<WorkspaceLauncher");
    const launcherEnd = appSource.indexOf(
      "{workspaceTabs.tabs.map((tab) => (",
      launcherStart,
    );
    const launcherSource = appSource.slice(launcherStart, launcherEnd);

    expect(appSource).toContain('from "../workspace/workspace-tabs.js"');
    expect(appSource).toContain("tabsByThread: workspaceTabsByThread");
    expect(appSource).toContain("useWorkspaceUiState(activeThreadId)");
    expect(appSource).toContain('className="right-sidebar-toggle"');
    expect(appSource).toContain("<WorkspaceTabBar");
    expect(appSource).toContain("workspaceTabs.tabs.length === 0");
    expect(appSource).toContain('tab.kind === "review"');
    expect(appSource).toContain('tab.kind === "terminal"');
    expect(appSource).toContain('tab.kind === "browser"');
    expect(appSource).toContain('tab.kind === "markdown"');
    expect(appSource).toContain('tab.kind === "file"');
    expect(appSource).toContain("onActivate={openReviewPanel}");
    expect(appSource).toContain("onActivate={openTerminalPanel}");
    expect(appSource).toContain("onActivate={openBrowserPanel}");
    expect(appSource).toContain("onActivate={openFilesPanel}");
    expect(launcherStart).toBeGreaterThan(-1);
    expect(launcherEnd).toBeGreaterThan(launcherStart);
    expect(launcherSource).not.toContain("openMarkdownPanel");
    expect(launcherSource).not.toContain("{t.markdownReader}");
    expect(appSource).not.toContain("const [reviewOpen");
    expect(appSource).not.toContain("const [terminalOpen");
    expect(resizer).toMatch(/\bcursor:\s*col-resize/u);
    expect(launcher).toMatch(/\bmin-inline-size:/u);
    expect(launcherItem).toMatch(/\bgrid-template-columns:/u);
  });
  it("materializes a task before opening workspace tools from a fresh conversation", () => {
    const createThreadStart = appSource.indexOf(
      "const createThread = useCallback(",
    );
    const createThreadEnd = appSource.indexOf(
      "const ensureWorkspaceThread =",
      createThreadStart,
    );
    const createThreadSource = appSource.slice(
      createThreadStart,
      createThreadEnd,
    );
    const openWorkspaceTabStart = appSource.indexOf(
      "const openWorkspaceTab = useCallback(",
    );
    const openWorkspaceTabEnd = appSource.indexOf(
      "const openResolvedWorkspaceFile =",
      openWorkspaceTabStart,
    );
    const openWorkspaceTabSource = appSource.slice(
      openWorkspaceTabStart,
      openWorkspaceTabEnd,
    );

    expect(openWorkspaceTabStart).toBeGreaterThan(-1);
    expect(openWorkspaceTabEnd).toBeGreaterThan(openWorkspaceTabStart);
    expect(createThreadSource).toContain("isWorkspaceDraftThread(thread)");
    expect(createThreadSource).toContain("reusableWorkspaceDraft");
    expect(openWorkspaceTabSource).toContain("ensureWorkspaceThread()");
    expect(openWorkspaceTabSource).not.toContain("if (!activeThreadId) return");
    expect(appSource).toContain("moveComposerDraft(");
    expect(appSource).toMatch(
      /\.filter\(\s*\(thread\) =>\s*!isWorkspaceDraftThread\(thread\) &&\s*\(!imThreadStatus\[thread.id\]\?\.group\?\.native\s*\|\|\s*!!imThreadStatus\[thread.id\]\?\.group\?\.retired\s*\|\|\s*!!imThreadStatus\[thread.id\]\?\.parentThreadId\)/u,
    );
  });
  it("opens HTML from explicit file links without auto-opening file changes", () => {
    const conversationState = readRendererController("use-conversation-state");
    const workspaceTabs = readRendererController(
      "use-workspace-tabs-controller",
    );
    const conversationLinks = readRendererController("use-conversation-links");

    expect(conversationState).toContain("const latestHtmlChange =");
    expect(conversationState).not.toContain('openWorkspaceTab("browser"');
    expect(appSource).not.toContain("autoOpenedHtmlChanges");
    expect(workspaceTabs).toContain("const openResolvedWorkspaceFile =");
    expect(workspaceTabs).toContain(
      "openWorkspaceTab(file.viewer, { path: file.path });",
    );
    expect(conversationLinks).toContain("inspectWorkspaceFileLink(");
    expect(conversationLinks).toContain("openResolvedWorkspaceFile(file)");
    expect(workspacePreviewSource).toContain("<PreviewCanvas");
    expect(workspacePreviewSource).not.toContain("<webview");
    expect(workspacePreviewSource).toContain("<BrowserSurface");
    expect(workspacePreviewSource).toContain("<BrowserToolbar");
    expect(workspacePreviewSource).toContain("<BrowserNavigationButton");
    expect(workspacePreviewSource).toContain("<BrowserAddressInput");
    expect(workspacePreviewSource).toContain("<BrowserViewport");
    expect(workspacePreviewSource).not.toMatch(/[←→↻]/u);
    expect(publicUiProfessionalSource).not.toMatch(
      /window\.artemis|electron|node:/u,
    );
    expect(publicUiProfessionalSource).toContain(
      "caller-owns-webview-navigation-session-and-security",
    );
    expect(workspacePreviewSource).toContain("normalizeBrowserAddress");
    expect(workspacePreviewSource).toContain("window.artemis.browserSession");
    expect(workspacePreviewSource).toContain("window.artemis.onBrowserSession");
    expect(workspacePreviewSource).toContain(
      "shouldReloadBrowserForLocaleChange",
    );
    expect(workspacePreviewSource).toContain('command("reload")');
    const sessionSource = readFileSync(
      new URL(
        "../../../src/main/workspace/browser-session-host.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sessionSource).toContain("partition: BROWSER_SESSION_PARTITION");
    expect(sessionSource).toMatch(/sandbox: true,\s+contextIsolation: true/u);
    expect(sessionSource).toContain("offscreen: { useSharedTexture: true }");
    expect(appSource).toMatch(
      /<WorkspaceBrowserPanel[\s\S]*?locale=\{locale\}[\s\S]*?\/>/u,
    );
    expect(sessionSource).toContain('"did-navigate"');
    expect(workspacePreviewSource).not.toContain("<iframe");
    expect(workspacePreviewSource).not.toContain("connect-src 'none'");
    expect(mainProcessSource).toContain("webviewTag: true");
    expect(mainProcessSource).toContain('"will-attach-webview"');
    expect(mainProcessSource).toContain("delete webPreferences.preload");
    expect(mainProcessSource).toContain(
      "webPreferences.nodeIntegration = false",
    );
    expect(mainProcessSource).toContain(
      "webPreferences.contextIsolation = true",
    );
    expect(mainProcessSource).toContain("webPreferences.sandbox = true");
    expect(mainProcessSource).toContain("configureBrowserLocaleSession();");
    expect(mainProcessSource).toMatch(
      /electronSession\.fromPartition\(\s*BROWSER_SESSION_PARTITION,?\s*\)/u,
    );
    expect(mainProcessSource).toContain('urls: ["http://*/*", "https://*/*"]');
    expect(browserLocaleSource).toContain("withBrowserAcceptLanguage");
    expect(apiSource).toContain("readWorkspaceTextFile(");
    expect(preloadSource).toContain("IPC.workspaceTextFileRead");
    expect(mainProcessSource).toContain("IPC.workspaceTextFileRead");
  });
  it("opens assistant HTTP links in the reusable Artemis Browser tab", () => {
    const externalLinkStart = appSource.indexOf(
      "const openConversationExternalLink =",
    );
    const externalLinkEnd = appSource.indexOf(
      "const openConversationFileLinkMenu =",
      externalLinkStart,
    );
    const externalLinkSource = appSource.slice(
      externalLinkStart,
      externalLinkEnd,
    );

    expect(externalLinkStart).toBeGreaterThan(-1);
    expect(externalLinkEnd).toBeGreaterThan(externalLinkStart);
    expect(externalLinkSource).toContain(
      "normalizeBrowserAddress(href, locale)",
    );
    expect(externalLinkSource).toContain('openWorkspaceTab("browser"');
    expect(externalLinkSource).toContain("reuseKind: true");
    expect(externalLinkSource).toContain("url");
    expect(appSource).toContain(
      "onExternalLink={openConversationExternalLink}",
    );
    expect(appSource).toContain("initialUrl={tab.url}");
    expect(workspacePreviewSource).toContain("initialUrl?: string");
    expect(workspacePreviewSource).toContain(
      "props.initialUrl ? { url: props.initialUrl } : {}",
    );
  });
  it("switches the Markdown reader between rich and source views", () => {
    expect(workspacePreviewSource).toContain("<MarkdownContent");
    expect(workspacePreviewSource).toMatch(
      /usePersistentUiState\(\s*"artemis-markdown-view",\s*markdownViewState,\s*"rich",?\s*\)/u,
    );
    expect(workspacePreviewSource).toContain("onChange: setView");
    expect(workspacePreviewSource).toContain("richLabel: props.richLabel");
    expect(workspacePreviewSource).toContain("sourceLabel: props.sourceLabel");
    expect(workspacePreviewSource).toContain("<WorkspacePreview");
    expect(workspacePreviewSource).toContain("<WorkspaceSourceEditor");
    expect(workspacePreviewSource).toContain("readWorkspaceImage(");
    expect(workspacePreviewSource).toContain("resolveImage={resolveImage}");
    expect(apiSource).toContain("readWorkspaceImage(");
    expect(preloadSource).toContain("IPC.workspaceImageRead");
    expect(mainProcessSource).toContain("IPC.workspaceImageRead");
    expect(rendererHtmlSource).toMatch(/img-src[^;]*https:[^;]*http:/u);
  });
  it("routes HTML to Browser and opens Markdown in place through the file reader", () => {
    const openFileStart = workspaceFilesSource.indexOf(
      "const openFile = (entry:",
    );
    const openFileEnd = workspaceFilesSource.indexOf(
      "const saveFile =",
      openFileStart,
    );
    const openFileSource = workspaceFilesSource.slice(
      openFileStart,
      openFileEnd,
    );

    expect(openFileStart).toBeGreaterThan(-1);
    expect(openFileEnd).toBeGreaterThan(openFileStart);
    expect(workspaceFilesSource).toContain("listWorkspaceDirectory");
    expect(openFileSource).toContain("onOpenHtml(entry.path)");
    expect(openFileSource).toContain("readWorkspaceFile(threadId, entry.path)");
    expect(openFileSource).not.toContain("onOpenMarkdown");
    expect(workspaceFilesSource).not.toContain(
      "onOpenMarkdown(path: string): void",
    );
    expect(workspaceFilesSource).toContain("<WorkspaceFileTree");
    expect(appSource).toContain('tab.kind === "file"');
    expect(appSource).toContain('openWorkspaceTab("browser"');
    expect(apiSource).toContain("listWorkspaceDirectory(");
    expect(apiSource).toContain("readWorkspaceFile(");
  });
  it("keeps PowerShell input legible and prevents an xterm horizontal scrollbar", () => {
    const viewport = publicUiCssRule(
      '[data-artemis-component="terminal-host"] .xterm .xterm-viewport',
    );

    expect(terminalSource).toContain('brightYellow: "#6b5700"');
    expect(terminalSource).toContain('cursorStyle: "bar"');
    expect(viewport).toMatch(/\boverflow-x:\s*hidden/u);
  });
});
