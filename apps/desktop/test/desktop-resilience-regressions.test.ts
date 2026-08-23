import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const appSource = source("../src/renderer/App.tsx");
const mainSource = source("../src/main/main.ts");
const buildSource = source("../scripts/build-electron.mjs");

function sourceBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `Missing source start: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endIndex, `Missing source end: ${end}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

describe("desktop resilience regressions", () => {
  it("deletes SQLite and refreshes the UI even when the agent host cannot clean up Pi JSONL", () => {
    const deleteHandler = sourceBetween(
      mainSource,
      "IPC.threadDelete,",
      "IPC.threadFork,",
    );
    const deleteAction = sourceBetween(
      appSource,
      "const deleteThread = useCallback(",
      "const setThreadArchived = useCallback(",
    );

    expect(deleteHandler).toContain("if (!store)");
    expect(deleteHandler).not.toContain("!store || !agentProcess");
    expect(deleteHandler).toContain("activeTurns.has(threadId)");
    expect(deleteHandler).toContain('type: "thread.delete"');
    expect(deleteHandler).toMatch(
      /if\s*\(\s*agentProcess\s*\)|agentProcess\?\./u,
    );

    const hostCleanupStart = deleteHandler.indexOf(
      "if (agentProcess?.available)",
    );
    const cleanupRequest = deleteHandler.indexOf(
      'type: "thread.delete"',
      hostCleanupStart,
    );
    const cleanupFailureBoundary = deleteHandler.indexOf(
      "catch",
      cleanupRequest,
    );
    const sqliteDelete = deleteHandler.indexOf("store.deleteThread(threadId)");
    expect(cleanupRequest).toBeGreaterThanOrEqual(0);
    expect(cleanupFailureBoundary).toBeGreaterThan(cleanupRequest);
    expect(sqliteDelete).toBeGreaterThan(cleanupFailureBoundary);
    expect(
      deleteHandler.slice(cleanupFailureBoundary, sqliteDelete),
    ).not.toContain("throw");

    const rendererDelete = deleteAction.indexOf(
      "window.artemis.deleteThread(thread.id)",
    );
    const snapshotRefresh = deleteAction.indexOf(
      "window.artemis.getSnapshot()",
      rendererDelete,
    );
    const snapshotCommit = deleteAction.indexOf(
      "setSnapshot((current) => preserveLoadedEvents(refreshed, current))",
      snapshotRefresh,
    );
    expect(rendererDelete).toBeGreaterThanOrEqual(0);
    expect(snapshotRefresh).toBeGreaterThan(rendererDelete);
    expect(snapshotCommit).toBeGreaterThan(snapshotRefresh);
    expect(deleteAction).toContain(
      "loadedEventThreads.current.delete(thread.id)",
    );
    expect(deleteAction).toContain(
      "threadStateCache.current.delete(thread.id)",
    );
    expect(deleteAction).toContain("delete next[thread.id]");
  });

  it("closes Agent Host and terminal processes before removing a temporary workspace", () => {
    const deleteHandler = sourceBetween(
      mainSource,
      "IPC.threadDelete,",
      "IPC.threadFork,",
    );
    const closeAgent = deleteHandler.indexOf('type: "thread.close"');
    const closeTerminal = deleteHandler.indexOf(
      "terminalService?.closeThread(threadId)",
      closeAgent,
    );
    const removeWorkspace = deleteHandler.indexOf(
      "await removeTemporaryConversationWorkspace(",
      closeTerminal,
    );
    const deleteTranscript = deleteHandler.indexOf(
      'type: "thread.delete"',
      removeWorkspace,
    );
    const deleteSqlite = deleteHandler.indexOf(
      "store.deleteThread(threadId)",
      deleteTranscript,
    );

    expect(closeAgent).toBeGreaterThanOrEqual(0);
    expect(closeTerminal).toBeGreaterThan(closeAgent);
    expect(removeWorkspace).toBeGreaterThan(closeTerminal);
    expect(deleteTranscript).toBeGreaterThan(removeWorkspace);
    expect(deleteSqlite).toBeGreaterThan(deleteTranscript);
    expect(deleteHandler.slice(closeAgent, removeWorkspace)).toContain(
      "throw new Error(",
    );
    expect(deleteHandler.slice(removeWorkspace, deleteSqlite)).toContain(
      "throw new Error(",
    );
  });

  it("keeps the bundled model catalog available when the Agent Host is unavailable", () => {
    const settingsSnapshot = sourceBetween(
      mainSource,
      "async function getModelSettingsSnapshot",
      "async function getMcpServerStatuses",
    );

    expect(settingsSnapshot).not.toContain("!agentProcess ||");
    expect(settingsSnapshot).not.toContain("optionalCapabilitiesReady");
    expect(settingsSnapshot).not.toContain("agentProcess.request");
    expect(settingsSnapshot).toContain("loadBundledModelCatalog()");
    expect(settingsSnapshot).toContain("mergeBundledModelCatalog(");
    expect(settingsSnapshot).toContain("cachedAgentCatalog.models");
    expect(settingsSnapshot).toContain("settingsStore.providerConnections(),");
    expect(settingsSnapshot).toContain("settingsStore.credentialSummaries(),");
    expect(settingsSnapshot).toContain("settingsStore.modelSelection(),");
    expect(settingsSnapshot).toContain(
      "const availableSelection = persistedSelection",
    );
    expect(settingsSnapshot).toMatch(/\n\s*providers,\n/u);
    expect(settingsSnapshot).toMatch(/\n\s*credentials,\n/u);
    expect(settingsSnapshot).toContain("getMcpServerStatuses(),");
  });

  it("removes a model by migrating or clearing conversations that reference it", () => {
    const modelDeleteHandler = sourceBetween(
      mainSource,
      "IPC.settingsModelDelete,",
      "IPC.settingsModelSet,",
    );

    expect(modelDeleteHandler).not.toContain(
      "Switch conversations using this model before deleting it.",
    );
    expect(modelDeleteHandler).toContain("const referencingThreads =");
    expect(modelDeleteHandler).toContain(
      "await resetAgentThreadsForToolChange()",
    );
    expect(modelDeleteHandler).toContain("store?.updateThread(thread.id, {");
    expect(modelDeleteHandler).toContain(
      "modelSelection: replacement?.selection ?? null",
    );
    expect(modelDeleteHandler).toContain(
      "contextWindow: replacement?.contextWindow ?? null",
    );
  });

  it("removes a provider by migrating or clearing conversations that reference it", () => {
    const providerDeleteHandler = sourceBetween(
      mainSource,
      "IPC.settingsProviderDelete,",
      "IPC.settingsCredentialDelete,",
    );

    expect(providerDeleteHandler).not.toContain(
      "Switch conversations using this provider before deleting it.",
    );
    expect(providerDeleteHandler).toContain("const referencingThreads =");
    expect(providerDeleteHandler).toContain("activeTurns.size > 0");
    expect(providerDeleteHandler).toContain(
      "Stop the active turn before deleting its provider.",
    );
    expect(providerDeleteHandler).toContain(
      "await resetAgentThreadsForToolChange()",
    );
    expect(providerDeleteHandler).toContain("store?.updateThread(thread.id, {");
    expect(providerDeleteHandler).toContain(
      "modelSelection: replacement?.selection ?? null",
    );
    expect(providerDeleteHandler).toContain(
      "contextWindow: replacement?.contextWindow ?? null",
    );
  });

  it("builds the packaged ESM agent worker with a Node require bridge for @vercel/oidc", () => {
    const agentWorkerBuild = sourceBetween(
      buildSource,
      'entryPoints: ["src/agent/agent-worker.ts"]',
      'entryPoints: ["src/extension/extension-worker.ts"]',
    );

    expect(agentWorkerBuild).toContain('format: "esm"');
    expect(agentWorkerBuild).toMatch(/banner\s*:/u);
    expect(buildSource).toMatch(
      /import\s*\{\s*createRequire\s*\}\s*from\s*["']node:module["']/u,
    );
    expect(buildSource).toContain("createRequire(import.meta.url)");
  });
});
