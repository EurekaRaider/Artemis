import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
  "utf8",
);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)),
  "utf8",
);
const apiSource = readFileSync(
  fileURLToPath(new URL("../src/shared/api.ts", import.meta.url)),
  "utf8",
);
const preloadSource = readFileSync(
  fileURLToPath(new URL("../src/preload/preload.ts", import.meta.url)),
  "utf8",
);
const mainSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);
const storeSource = readFileSync(
  fileURLToPath(new URL("../src/main/store.ts", import.meta.url)),
  "utf8",
);
const agentWorkerSource = readFileSync(
  fileURLToPath(new URL("../src/agent/agent-worker.ts", import.meta.url)),
  "utf8",
);
const agentRuntimeSource = readFileSync(
  fileURLToPath(
    new URL("../../../packages/agent-host/src/runtime.ts", import.meta.url),
  ),
  "utf8",
);
const hostMessagesSource = readFileSync(
  fileURLToPath(
    new URL("../../../packages/protocol/src/host-messages.ts", import.meta.url),
  ),
  "utf8",
);

function cssDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = stylesSource.match(
    new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, "u"),
  );
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.groups?.body ?? "";
}

function cssVariable(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = stylesSource.match(
    new RegExp(`${escaped}:\\s*(?<value>#[\\da-f]{6})\\s*;`, "iu"),
  )?.groups?.value;
  expect(value, `Missing hex CSS variable ${name}`).toBeDefined();
  return value!;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/[\da-f]{2}/giu)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `Missing source start: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endIndex, `Missing source end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Codex conversation shell contract", () => {
  it("toggles each project's conversations from its folder or name and previews only five until expanded", () => {
    const projectTree = sourceBetween(
      appSource,
      "{projects.map((project) => {",
      '<div className="sidebar-footer">',
    );

    expect(appSource).toContain("const PROJECT_THREAD_PREVIEW_LIMIT = 5;");
    expect(projectTree).toContain("thread.projectId === project.id");
    expect(projectTree).toContain("!thread.archived");
    expect(projectTree).toContain(
      "const projectThreads = orderProjectThreadsByPreference(",
    );
    expect(projectTree).toContain("sortProjectThreads(");
    expect(projectTree).toContain(
      "runtimeSettings?.projectThreadOrder?.[project.id]",
    );
    expect(projectTree).toContain("promptSubmittedAtByThread");
    expect(projectTree).toContain("PROJECT_THREAD_PREVIEW_LIMIT");
    expect(projectTree).toContain("expandedProjectIds");
    expect(projectTree).toContain("collapsedProjectIds");
    expect(projectTree).toContain(
      "const projectOpen = !collapsedProjectIds.has(project.id);",
    );
    expect(projectTree).toContain('className="project-toggle"');
    expect(projectTree).toContain("aria-expanded={projectOpen}");
    expect(projectTree).toContain("<FolderIcon open={projectOpen} />");
    expect(projectTree).toMatch(
      /className="project-toggle"[\s\S]*?onClick=\{\(\)\s*=>\s*toggleProjectHistory\(project\.id\)\}/u,
    );
    expect(projectTree).toMatch(
      /className="project-select"[\s\S]*?onClick=\{\(\)\s*=>\s*toggleProjectHistory\(project\.id\)\}/u,
    );
    expect(projectTree).toContain("{projectOpen && (");
    expect(projectTree).toContain('className="project-thread-list"');
    expect(projectTree).toContain('className="project-expand-toggle"');
    expect(projectTree).toMatch(
      /const visibleThreads\s*=\s*expanded\s*\?\s*projectThreads\s*:\s*projectThreads\.slice\(0,\s*PROJECT_THREAD_PREVIEW_LIMIT\)/u,
    );
    expect(projectTree.indexOf('className="project-select"')).toBeLessThan(
      projectTree.indexOf('className="project-thread-list"'),
    );

    expect(appSource).toMatch(
      /function FolderIcon\(\{\s*open = false\s*\}:[^)]*\)[\s\S]*?open\s*\?/u,
    );
    expect(cssDeclarations(".project-toggle")).toMatch(
      /\bposition:\s*absolute/u,
    );
    const nestedThreads = cssDeclarations(".project-thread-list");
    expect(nestedThreads).toMatch(/\bpadding-left:\s*0/u);
    expect(cssDeclarations(".project-thread-row")).toMatch(
      /\bmin-height:\s*(?:2[8-9]|3\d)px/u,
    );
    expect(cssDeclarations(".project-expand-toggle")).toMatch(
      /\bcolor:\s*var\(--muted/u,
    );
  });

  it("keeps a new conversation local until its first submitted message", () => {
    const conversation = sourceBetween(
      appSource,
      '<section className="conversation">',
      '<div className="composer-wrap">',
    );
    const startup = sourceBetween(
      appSource,
      "void window.artemis.getSnapshot().then((value) => {",
      "void window.artemis\n      .getSettings()",
    );
    const beginNewConversation = sourceBetween(
      appSource,
      "const beginNewConversation = useCallback",
      "const discardNewConversationDraft",
    );
    const createThread = sourceBetween(
      appSource,
      "const createThread = useCallback",
      "const beginRenameThread",
    );
    const sendPrompt = sourceBetween(
      appSource,
      "const sendPrompt = useCallback",
      "const deleteQueuedMessage",
    );

    expect(startup).toContain("setActiveThreadId(undefined)");
    expect(startup).not.toContain("value.threads.find");
    expect(beginNewConversation).toContain("setActiveThreadId(undefined)");
    expect(beginNewConversation).toContain("clearComposerDraft(");
    expect(beginNewConversation).toContain(
      "conversationDraftKey(projectId, undefined)",
    );
    expect(beginNewConversation).not.toContain('setPrompt("")');
    expect(beginNewConversation).not.toContain("setAttachments([])");
    expect(beginNewConversation).not.toContain("window.artemis.createThread");
    expect(appSource).toContain(
      "const activeComposerDraftKey = conversationDraftKey(",
    );
    expect(appSource).toContain(
      "const activeComposerDraft = composerDraftFor(",
    );
    expect(createThread).toContain("setActiveThreadId(thread.id)");
    expect(conversation).toContain("activeEvents.length === 0");
    expect(conversation).toContain("<ArtemisMark />");
    expect(appSource).toContain(
      'emptyConversationPrompt: "What should we build in {{workspace}}?"',
    );
    expect(appSource).toContain(
      'emptyConversationPrompt: "想在 {{workspace}} 中构建什么？"',
    );
    expect(conversation).toContain("emptyConversationLabel");
    expect(conversation).toContain("emptyConversationPrefix");
    expect(conversation).toContain("emptyConversationSuffix");
    expect(conversation).not.toContain("What should we build in");
    expect(conversation).toContain('className="conversation-empty-state"');
    expect(conversation.indexOf("activeEvents.length === 0")).toBeLessThan(
      conversation.indexOf("<Timeline"),
    );
    expect(sendPrompt).toContain("window.artemis.startTurn({");
    expect(sendPrompt).toContain("clearSubmittedPrompt(rawPrompt)");
    expect(sendPrompt.indexOf("if (!text || busy) return;")).toBeLessThan(
      sendPrompt.indexOf("await createThread()"),
    );
    expect(appSource).toContain(
      "onClick={() => beginNewConversation(project.id)}",
    );
    expect(appSource).toContain("beginNewConversation();");
    expect(appSource).toContain("discardNewConversationDraft();");
  });

  it("routes /compact directly to Pi while preserving automatic compaction", () => {
    const sendPrompt = sourceBetween(
      appSource,
      "const sendPrompt = useCallback",
      "const deleteQueuedMessage",
    );
    const compactBranch = sourceBetween(
      sendPrompt,
      "if (compactMatch && activeThread) {",
      "if (goalMatch && clearingGoal && activeThread) {",
    );

    expect(sendPrompt).toContain("compactMatch");
    expect(sendPrompt).toContain("window.artemis.compactThread(");
    expect(sendPrompt.indexOf("compactThread(")).toBeLessThan(
      sendPrompt.indexOf("await createThread()"),
    );
    expect(
      compactBranch.indexOf("clearSubmittedPrompt(rawPrompt)"),
    ).toBeLessThan(
      compactBranch.indexOf("await window.artemis.compactThread("),
    );
    expect(compactBranch).not.toContain("setToast(t.contextCompacted)");
    expect(apiSource).toContain(
      "compactThread(threadId: string, instructions?: string): Promise<void>",
    );
    expect(preloadSource).toContain("IPC.threadCompact");
    expect(mainSource).toContain("IPC.threadCompact");
    expect(mainSource).toContain('type: "thread.compact"');
    expect(hostMessagesSource).toContain('type: "thread.compact"');
    expect(agentWorkerSource).toContain('case "thread.compact"');
    expect(agentRuntimeSource).toContain(
      "await hosted.session.compact(customInstructions)",
    );
    expect(agentRuntimeSource).toContain(
      "compactionSettingsForContextWindow(contextWindow)",
    );
    expect(agentRuntimeSource).toContain('event.type === "compaction_start"');
    expect(agentRuntimeSource).toContain("this.emitContextUsage(hosted, true)");
    expect(agentRuntimeSource).toContain('event.type === "compaction_end"');
    expect(agentRuntimeSource).toContain('event.type === "turn_end"');
    expect(agentRuntimeSource).toContain("event.result?.estimatedTokensAfter");
  });

  it("switches task modes from slash commands without weakening active-turn boundaries", () => {
    const sendPrompt = sourceBetween(
      appSource,
      "const sendPrompt = useCallback",
      "const deleteQueuedMessage",
    );
    const multipleCommandGuard = sourceBetween(
      sendPrompt,
      'runModeCommand.kind === "multiple"',
      'runModeCommand.kind === "command"',
    );

    expect(sendPrompt).toContain("parseRunModeCommand(rawPrompt)");
    expect(multipleCommandGuard).toContain("t.multipleModeCommands");
    expect(multipleCommandGuard).toContain("return;");
    expect(sendPrompt).toContain("setMode(submittedMode)");
    expect(sendPrompt).toContain("mode: submittedMode");
    expect(sendPrompt).toContain("t.modeCommandWhileRunning");
    expect(sendPrompt.indexOf("t.modeCommandWhileRunning")).toBeLessThan(
      sendPrompt.indexOf("window.artemis.followUpTurn({"),
    );
    expect(appSource).toMatch(
      /multipleModeCommands:\s*"Only one \/plan, \/execute, or \/review command is allowed per message\."/u,
    );
    expect(appSource).toMatch(
      /multipleModeCommands:\s*"每条消息只能包含一个 \/plan、\/execute 或 \/review 指令。"/u,
    );
    expect(appSource).toContain("selectComposerCommand(`/${mode} `)");
    expect(appSource).toMatch(
      /selectComposerCommand\(\s*`\/\$\{suggestion\.kind\} `,?\s*\)/u,
    );
  });

  it("cycles task modes with Shift+Tab only while the composer can switch modes", () => {
    expect(appSource).toMatch(
      /event\.key === "Tab" &&[\s\S]{0,160}event\.shiftKey &&[\s\S]{0,240}!turnActive &&[\s\S]{0,80}!busy/u,
    );
    expect(appSource).toContain("setMode((current) => nextRunMode(current))");
  });

  it("uses Codex shell tones, typography, and the rounded workspace boundary", () => {
    const sidebar = cssVariable("--codex-sidebar-bg");
    const workspace = cssVariable("--codex-workspace-bg");

    expect(relativeLuminance(sidebar)).toBeGreaterThan(
      relativeLuminance(workspace),
    );
    expect(relativeLuminance(workspace)).toBeLessThan(0.015);
    expect(stylesSource).toContain(
      '--ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    );
    expect(cssDeclarations(".activity-bar")).toMatch(
      /\bbackground:\s*var\(--codex-sidebar-bg\)/u,
    );
    expect(cssDeclarations(".sidebar")).toMatch(
      /\bbackground:\s*var\(--codex-sidebar-bg\)/u,
    );
    for (const selector of [
      ".workspace",
      ".workspace-header",
      ".conversation",
      ".workspace-tool-dock",
    ]) {
      expect(cssDeclarations(selector)).toMatch(
        /\bbackground:\s*var\(--codex-workspace-bg\)/u,
      );
    }
    expect(cssDeclarations(".workspace")).toMatch(
      /\bborder-top-left-radius:\s*0/u,
    );
    expect(cssDeclarations(".conversation-empty-state")).toMatch(
      /\bfont-family:\s*var\(--ui-font\)/u,
    );
    expect(cssDeclarations(".conversation-empty-state h1")).toMatch(
      /\bfont-weight:\s*(?:400|normal)/u,
    );
  });

  it("keeps the compact task status horizontal when the title needs space", () => {
    expect(cssDeclarations(".workspace-header-leading")).toMatch(
      /\bflex:\s*1 1 auto/u,
    );
    expect(cssDeclarations(".header-actions")).toMatch(/\bflex:\s*0 0 auto/u);
    const status = cssDeclarations(".status-pill");
    expect(status).toMatch(/\bflex:\s*0 0 auto/u);
    expect(status).toMatch(/\bwhite-space:\s*nowrap/u);
  });

  it("deletes a conversation through confirmation, preload IPC, and the store with an active-turn guard", () => {
    expect(apiSource).toContain(
      "deleteThread(threadId: string): Promise<void>;",
    );
    expect(apiSource).toContain('threadDelete: "artemis:thread-delete"');
    expect(preloadSource).toContain(
      "deleteThread: (threadId) => ipcRenderer.invoke(IPC.threadDelete, threadId)",
    );

    const mainHandler = sourceBetween(
      mainSource,
      "IPC.threadDelete",
      "IPC.threadFork",
    );
    expect(mainHandler).toContain("activeTurns.has(threadId)");
    expect(mainHandler).toContain("store.deleteThread(threadId)");
    expect(mainHandler).toContain("openedThreads.delete(threadId)");
    expect(mainHandler).toContain('type: "thread.delete"');
    expect(mainHandler).toContain("sessionFile: thread.sessionFile");
    expect(mainHandler.indexOf('type: "thread.delete"')).toBeLessThan(
      mainHandler.indexOf("store.deleteThread(threadId)"),
    );
    expect(mainHandler).not.toMatch(/\brm\(\s*thread\.sessionFile/u);
    expect(storeSource).toContain("deleteThread(threadId: string)");
    expect(hostMessagesSource).toContain('type: "thread.delete"');
    expect(hostMessagesSource).toContain("sessionFile?: string");
    expect(agentWorkerSource).toContain('case "thread.delete":');
    expect(agentWorkerSource).toContain(
      "await host.deleteThread(command.threadId, command.sessionFile)",
    );
    expect(agentRuntimeSource).toContain(
      "async deleteThread(threadId: string, sessionFile?: string)",
    );
    expect(agentRuntimeSource).toMatch(
      /await deletePiSessionTranscript\(\s*sessionFile,\s*join\(this\.agentDir, "sessions"\),?\s*\)/u,
    );

    const rendererDelete = sourceBetween(
      appSource,
      "const deleteThread = useCallback",
      "const setThreadArchived",
    );
    expect(rendererDelete).toMatch(
      /await requestConfirmation\(\s*t\.deleteTaskConfirm,\s*"danger",?\s*\)/u,
    );
    expect(rendererDelete).not.toContain("confirmResourceAction");
    expect(rendererDelete).not.toContain("window.confirm(");
    expect(rendererDelete).toContain(
      "await window.artemis.deleteThread(thread.id)",
    );
    expect(rendererDelete).toMatch(
      /findIndex\(\s*\(item\)\s*=>\s*item\.id\s*===\s*thread\.id,?\s*\)/u,
    );
    expect(rendererDelete).toMatch(
      /filter\(\s*\(item\)\s*=>\s*item\.id\s*!==\s*thread\.id,?\s*\)/u,
    );
    expect(rendererDelete).toMatch(
      /\[\s*Math\.min\(\s*deletedIndex,\s*remainingThreads\.length\s*-\s*1\s*\)\s*\]/u,
    );

    const threadMenu = sourceBetween(
      appSource,
      "{threadMenuId === thread.id && (",
      "</div>",
    );
    expect(threadMenu).toContain("void deleteThread(thread)");
    expect(threadMenu).toContain("{t.deleteTask}");
  });

  it("copies a temporary workspace and rolls back both fork artifacts on failure", () => {
    const forkHandler = sourceBetween(
      mainSource,
      "IPC.threadFork",
      "IPC.threadCompact",
    );
    const copyWorkspace = forkHandler.indexOf(
      "await copyTemporaryConversationWorkspace(",
    );
    const persistFork = forkHandler.indexOf(
      "return store.createForkedThread(forkedThread, source.id)",
      copyWorkspace,
    );
    const removeWorkspace = forkHandler.indexOf(
      "await removeTemporaryConversationWorkspace(",
      persistFork,
    );
    const removeTranscript = forkHandler.indexOf(
      "await deletePiSessionTranscript(",
      removeWorkspace,
    );
    expect(copyWorkspace).toBeGreaterThanOrEqual(0);
    expect(persistFork).toBeGreaterThan(copyWorkspace);
    expect(removeWorkspace).toBeGreaterThan(persistFork);
    expect(removeTranscript).toBeGreaterThan(removeWorkspace);
    expect(forkHandler.slice(removeTranscript)).toContain(
      'piSessionsRoot(process.env, app.getPath("home"))',
    );
  });

  it("routes every newly projectless broker path through the tested workspace policy", () => {
    const brokerSections = [
      sourceBetween(
        mainSource,
        "async function handleShellBrokerRequest",
        "async function openAgentThread",
      ),
      sourceBetween(
        mainSource,
        "async function handleBrokerRequest",
        "async function handleMemoryAppendBrokerRequest",
      ),
      sourceBetween(
        mainSource,
        "async function handleMemoryAppendBrokerRequest",
        "async function handleOfficeDocumentBrokerRequest",
      ),
      sourceBetween(
        mainSource,
        "async function handleOfficeDocumentBrokerRequest",
        "async function handleMcpBrokerRequest",
      ),
      sourceBetween(
        mainSource,
        "async function handleMcpBrokerRequest",
        "async function handleExtensionBrokerRequest",
      ),
      sourceBetween(
        mainSource,
        "async function handleExtensionBrokerRequest",
        "function rejectBrokerRequest",
      ),
    ];
    for (const section of brokerSections) {
      expect(section).toContain("conversationWorkspaceMatches(");
    }
    expect(mainSource).toContain("assertConversationTarget(");
    expect(mainSource).toContain("conversationApprovalScopes(");
    expect(mainSource).toContain("conversationMemoryScopeAllowed(");
    expect(mainSource).toContain("conversationSupportsProjectFeatures(");
    expect(mainSource).toContain("removeTemporaryConversationWorkspace(");
  });
});
