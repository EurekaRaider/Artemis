import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);

function modelHandler() {
  const start = source.indexOf("    IPC.threadModelSet,");
  const end = source.indexOf("  ipcMain.handle(IPC.threadPrepare", start);
  const thread = {
    id: "current",
    status: "idle",
    modelSelection: {
      providerId: "openai",
      modelId: "model-a",
      thinkingLevel: "high",
    },
  };
  const store = {
    getThread: vi.fn(() => thread),
    updateThread: vi.fn((_id, update) => Object.assign(thread, update)),
  };
  const settingsStore = { setModel: vi.fn().mockResolvedValue(undefined) };
  const agentProcess = { request: vi.fn().mockResolvedValue(undefined) };
  let handler: (...args: any[]) => Promise<any>;
  const dependencies = {
    ipcMain: {
      handle: (_channel: string, value: typeof handler) => {
        handler = value;
      },
    },
    IPC: { threadModelSet: "thread-model-set" },
    store,
    settingsStore,
    agentProcess,
    activeTurns: new Set(),
    compactingThreads: new Set(),
    openedThreads: new Set([thread.id]),
    resolveModelSelection: async (selection: unknown) => ({
      selection,
      contextWindow: 200_000,
    }),
    parseThreadCommand: (command: unknown) => command,
    randomUUID: () => "request-id",
  };
  const compiled = transformSync(`ipcMain.handle(${source.slice(start, end)}`, {
    loader: "ts",
    target: "es2022",
  }).code;
  new Function(...Object.keys(dependencies), compiled)(
    ...Object.values(dependencies),
  );
  return {
    run: (selection: unknown) => handler(undefined, thread.id, selection),
    thread,
    settingsStore,
    agentProcess,
    store,
  };
}

describe("manual conversation model defaults", () => {
  it.each([
    { providerId: "openai", modelId: "model-b", thinkingLevel: "high" },
    { providerId: "openai", modelId: "model-a", thinkingLevel: "low" },
    {
      providerId: "openai",
      modelId: "model-a",
      thinkingLevel: "max",
      ultraMode: true,
    },
  ])(
    "remembers $modelId / $thinkingLevel and updates only the current conversation",
    async (selection) => {
      const { run, thread, settingsStore, store } = modelHandler();
      await run(selection);
      expect(settingsStore.setModel).toHaveBeenCalledExactlyOnceWith(
        selection,
        200_000,
      );
      expect(thread.modelSelection).toEqual(selection);
      expect(store.updateThread).toHaveBeenCalledExactlyOnceWith("current", {
        modelSelection: selection,
        contextWindow: 200_000,
      });
    },
  );

  it("does not remember a model when switching the agent fails", async () => {
    const { run, agentProcess, settingsStore, store } = modelHandler();
    agentProcess.request.mockRejectedValueOnce(new Error("switch failed"));
    await expect(
      run({ providerId: "openai", modelId: "model-b", thinkingLevel: "low" }),
    ).rejects.toThrow("switch failed");
    expect(settingsStore.setModel).not.toHaveBeenCalled();
    expect(store.updateThread).not.toHaveBeenCalled();
  });

  it("does not remember a selection while a conversation is running", async () => {
    const { run, thread, settingsStore } = modelHandler();
    thread.status = "running";
    await expect(run(thread.modelSelection)).rejects.toThrow(
      "Stop the active task",
    );
    expect(settingsStore.setModel).not.toHaveBeenCalled();
  });
});
