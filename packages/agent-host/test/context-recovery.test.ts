import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import type { AgentPayload } from "@artemis/protocol";
import { ArtemisAgentHost } from "../src/runtime.js";
import { estimateRequestTokens } from "../src/attachment-context.js";

const roots: string[] = [];
const hosts: ArtemisAgentHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.dispose());
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function answer(
  model: Model<Api>,
  text: string,
  input = 1000,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: "stop",
    usage: {
      input,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
async function fixture(historyCharacters: number) {
  const root = await mkdtemp(join(tmpdir(), "artemis-context-recovery-"));
  roots.push(root);
  const payloads: AgentPayload[] = [];
  const host = new ArtemisAgentHost(
    {
      async request() {
        throw new Error("No tools should execute");
      },
    },
    {
      emit(_thread, _turn, payload) {
        payloads.push(payload);
      },
    },
    { agentDir: join(root, "agent") },
  );
  hosts.push(host);
  const selection = {
    providerId: "local-context-test",
    modelId: "small",
    thinkingLevel: "off" as const,
  };
  await host.configure({
    credentials: {},
    providers: [
      {
        id: selection.providerId,
        name: "Test",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: [128000, 256000].map((size, i) => ({
          id: i ? "large" : "small",
          name: "Test",
          reasoning: false,
          input: ["text"],
          contextWindow: size,
          maxTokens: 16000,
        })),
      },
    ],
    selection,
  });
  const manager = SessionManager.create(root, join(root, "sessions"));
  for (let i = 0; i < 4; i++) {
    manager.appendMessage({
      role: "user",
      content: `History ${i}\n${"x".repeat(historyCharacters / 4)}`,
      timestamp: i * 2 + 1,
    });
    manager.appendMessage({
      ...answer(
        {
          api: "openai-completions",
          provider: selection.providerId,
          id: "small",
        } as Model<Api>,
        "Recorded work",
        60000,
      ),
      timestamp: i * 2 + 2,
    });
  }
  await host.openThread({
    threadId: "task",
    workspacePath: root,
    target: "local",
    sessionFile: manager.getSessionFile()!,
    selection,
  });
  const session = (
    host as unknown as { threads: Map<string, { session: AgentSession }> }
  ).threads.get("task")!.session;
  const calls: { compacting: boolean; model: string }[] = [];
  const provider = vi
    .spyOn(ModelRuntime.prototype, "streamSimple")
    .mockImplementation((model, context) => {
      calls.push({ compacting: session.isCompacting, model: model.id });
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: answer(
          model,
          session.isCompacting
            ? "Preserved decisions and completed work."
            : "Continued successfully.",
          estimateRequestTokens(model, context),
        ),
      });
      return stream;
    });
  return { host, session, payloads, calls, provider, selection };
}
describe("context recovery through the real Pi session", () => {
  it("uses text token estimates when a long prompt also carries an attachment reference", async () => {
    const f = await fixture(0);
    await f.host.prompt(
      "task",
      "with-attachment",
      "The quick brown fox jumps over the lazy dog. ".repeat(5000),
      "plan",
      [
        {
          type: "attachment",
          id: "11111111-1111-4111-8111-111111111111",
          kind: "file",
          name: "unavailable.txt",
          mimeType: "text/plain",
          size: 0,
          status: "error",
          error: "Synthetic extraction failure",
        },
      ],
    );
    expect(f.calls.some((call) => call.compacting)).toBe(false);
    expect(f.payloads.some((p) => p.type === "turn.completed")).toBe(true);
  });
  it("stops bounded recovery for a single oversized request and recovers after switching models", async () => {
    const f = await fixture(0);
    let compactions = 0;
    f.session.subscribe((event) => {
      if (event.type === "compaction_start") compactions++;
    });
    await f.host.prompt(
      "task",
      "too-large",
      "Original request. " + "x".repeat(600000),
      "plan",
    );
    expect(f.payloads.some((p) => p.type === "turn.failed")).toBe(true);
    expect(compactions).toBeLessThanOrEqual(1);
    expect(f.session.isCompacting).toBe(false);
    await f.host.setThreadModel(
      "task",
      { ...f.selection, modelId: "large" },
      256000,
    );
    f.payloads.length = 0;
    await f.host.prompt(
      "task",
      "switched",
      "Continue the original request",
      "plan",
    );
    expect(f.payloads.some((p) => p.type === "turn.failed")).toBe(false);
    expect(f.payloads.some((p) => p.type === "turn.completed")).toBe(true);
    expect(f.calls.at(-1)?.model).toBe("large");
  });
  it("automatically compacts local overflow and continues the same turn without duplicate user messages", async () => {
    const f = await fixture(420000);
    const reasons: string[] = [];
    f.session.subscribe((event) => {
      if (event.type === "compaction_start") reasons.push(event.reason);
    });
    const prompt = "Continue this request exactly once.";
    await f.host.prompt("task", "turn", prompt, "plan");
    expect(f.payloads.filter((p) => p.type === "turn.failed")).toEqual([]);
    expect(f.payloads).toContainEqual(
      expect.objectContaining({ type: "turn.completed" }),
    );
    expect(f.calls.some((call) => call.compacting)).toBe(true);
    expect(f.calls.filter((call) => !call.compacting)).toHaveLength(1);
    expect(
      f.session.sessionManager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "user" &&
            JSON.stringify(entry.message.content).includes(prompt),
        ),
    ).toHaveLength(1);
    expect(reasons).toContain("overflow");
    expect(f.session.isCompacting).toBe(false);
    await f.host.prompt("task", "next-turn", "Continue again", "plan");
    expect(f.payloads.filter((p) => p.type === "turn.failed")).toEqual([]);
  });
  it("manually compacts oversized history, then switches model and continues the existing task", async () => {
    const f = await fixture(1100000);
    await f.host.compact("task", "Preserve decisions");
    expect(f.calls.length).toBeGreaterThan(2);
    expect(
      f.session.sessionManager
        .getBranch()
        .some((entry) => entry.type === "compaction"),
    ).toBe(true);
    await f.host.setThreadModel(
      "task",
      { ...f.selection, modelId: "large" },
      256000,
    );
    await f.host.prompt("task", "after-compact", "Continue", "plan");
    expect(f.calls.at(-1)).toEqual({ compacting: false, model: "large" });
    expect(f.payloads.filter((p) => p.type === "turn.failed")).toEqual([]);
  });
  it("preserves durable history on summary failure and allows a later manual retry", async () => {
    const f = await fixture(1100000);
    const before = JSON.stringify(f.session.sessionManager.getBranch());
    const implementation = f.provider.getMockImplementation()!;
    f.provider.mockImplementation(() => {
      throw new Error("401 Invalid credentials");
    });
    await expect(f.host.compact("task")).rejects.toThrow(/401/);
    expect(JSON.stringify(f.session.sessionManager.getBranch())).toBe(before);
    expect(f.session.isCompacting).toBe(false);
    expect(f.payloads).toContainEqual(
      expect.objectContaining({
        type: "context.usage",
        compactionResult: expect.objectContaining({ status: "failed" }),
      }),
    );
    f.provider.mockImplementation(implementation);
    await f.host.compact("task");
    await f.host.prompt("task", "retry", "Continue", "plan");
    expect(f.payloads.filter((p) => p.type === "turn.failed")).toEqual([]);
  });
});
