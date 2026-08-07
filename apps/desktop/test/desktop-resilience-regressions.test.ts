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

    const cleanupRequest = deleteHandler.indexOf('type: "thread.delete"');
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

  it("keeps the bundled model catalog available when the Agent Host is unavailable", () => {
    const settingsSnapshot = sourceBetween(
      mainSource,
      "async function getSettingsSnapshot",
      "async function getMcpServerStatuses",
    );

    expect(settingsSnapshot).not.toContain("!agentProcess ||");
    expect(settingsSnapshot).toMatch(
      /(?:let|const)\s+catalog\s*:\s*AgentRuntimeCatalog\s*=\s*\{\s*models:\s*\[\]\s*\}/u,
    );
    expect(settingsSnapshot).toContain('type: "runtime.catalog"');
    expect(settingsSnapshot).toContain("loadBundledModelCatalog()");
    expect(settingsSnapshot).toMatch(
      /if\s*\(\s*agentProcess\s*\)[\s\S]*?try\s*\{[\s\S]*?runtime\.catalog[\s\S]*?\}\s*catch/u,
    );
    expect(settingsSnapshot.indexOf("catch")).toBeLessThan(
      settingsSnapshot.indexOf("return {"),
    );
    expect(settingsSnapshot).toContain(
      "const providers = await settingsStore.providerConnections()",
    );
    expect(settingsSnapshot).toContain(
      "const credentials = await settingsStore.credentialSummaries()",
    );
    expect(settingsSnapshot).toContain(
      "const persistedSelection = await settingsStore.modelSelection()",
    );
    expect(settingsSnapshot).toContain(
      "catalog.selection ?? persistedSelection",
    );
    expect(settingsSnapshot).toMatch(/\n\s*providers,\n/u);
    expect(settingsSnapshot).toMatch(/\n\s*credentials,\n/u);
    expect(settingsSnapshot).toContain(
      "mcpServers: await getMcpServerStatuses()",
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
