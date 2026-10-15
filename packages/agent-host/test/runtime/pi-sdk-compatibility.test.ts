import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createCodemodeExtension,
  serializeConversation,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { createHooksBridge } from "../../src/tools/hooks-bridge.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function reply(
  model: { api: AssistantMessage["api"]; provider: string; id: string },
  content: AssistantMessage["content"] = [{ type: "text", text: "done" }],
): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
async function fixture(extension: ExtensionFactory) {
  const root = await mkdtemp(join(tmpdir(), "artemis-pi12-"));
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    credentials: {
      read: async () => ({ type: "api_key", key: "test-only" }),
      list: async () => [],
      modify: async () => undefined,
      delete: async () => {},
    },
  });
  const model = modelRuntime.getModel("openai", "gpt-4.1")!;
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    extensionFactories: [extension],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime,
    model,
    noTools: "builtin",
    resourceLoader,
    sessionManager: SessionManager.inMemory(root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
  });
  cleanups.push(async () => {
    session.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const stream = vi
    .spyOn(ModelRuntime.prototype, "streamSimple")
    .mockImplementation((m, _context, options) => {
      const output = createAssistantMessageEventStream();
      queueMicrotask(() =>
        options?.signal?.aborted
          ? output.push({
              type: "error",
              reason: "aborted",
              error: { ...reply(m), stopReason: "aborted" },
            })
          : output.push({ type: "done", reason: "stop", message: reply(m) }),
      );
      return output;
    });
  return { session, stream, model };
}
it.each([false, true])(
  "queues custom messages during startup and honours startup cancellation=%s",
  async (cancel) => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const idleDuringStartup: boolean[] = [];
    const f = await fixture((pi) => {
      pi.on("before_agent_start", async (event, ctx) => {
        events.push(event.messageType);
        idleDuringStartup.push(ctx.isIdle());
        started.resolve();
        await release.promise;
        return {
          message: {
            customType: "setup",
            content: "HOOK_CONTEXT",
            display: false,
          },
        };
      });
    });
    const run = f.session.sendCustomMessage(
      { customType: "trigger", content: "start", display: false },
      { triggerTurn: true },
    );
    await started.promise;
    expect(f.session.isStreaming).toBe(true);
    await f.session.sendCustomMessage(
      {
        customType: "queued",
        content: "queued while starting",
        display: false,
      },
      { triggerTurn: true },
    );
    const abort = cancel ? f.session.abort() : undefined;
    release.resolve();
    await Promise.all([run, abort]);
    expect(events).toEqual(["custom"]);
    expect(idleDuringStartup).toEqual([false]);
    expect(f.session.isStreaming).toBe(false);
    if (cancel) {
      expect(
        f.stream.mock.calls.every((call) => call[2]?.signal?.aborted),
      ).toBe(true);
      expect(f.session.messages.at(-1)).toMatchObject({
        role: "assistant",
        stopReason: "aborted",
      });
    } else {
      expect(f.stream).toHaveBeenCalled();
      expect(JSON.stringify(f.stream.mock.calls)).toContain("HOOK_CONTEXT");
      expect(JSON.stringify(f.session.messages)).toContain(
        "queued while starting",
      );
    }
  },
);
it("omits thinking from compaction serialization while retaining user text and tool results", () => {
  const assistant = reply(
    { api: "openai-completions", provider: "test", id: "test" },
    [
      { type: "thinking", thinking: "PRIVATE_THINKING" },
      { type: "text", text: "KEEP_ANSWER" },
    ],
  );
  const text = serializeConversation([
    { role: "user", content: "KEEP_REQUEST", timestamp: 0 },
    assistant,
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [{ type: "text", text: "KEEP_TOOL_RESULT" }],
      isError: false,
      timestamp: 0,
    },
  ]);
  expect(text).not.toContain("PRIVATE_THINKING");
  for (const value of ["KEEP_REQUEST", "KEEP_ANSWER", "KEEP_TOOL_RESULT"])
    expect(text).toContain(value);
});
it("executes Codemode with constrained declarations and falsy structured results", async () => {
  const f = await fixture((pi) => {
    createCodemodeExtension({ mode: "only" })(pi);
    pi.registerTool({
      name: "fixture",
      label: "Fixture",
      description: "Fixture",
      parameters: Type.Object({
        n: Type.Integer({ minimum: 0, maximum: 3, default: 0 }),
      }),
      outputSchema: Type.Unknown(),
      execute: async () => ({ content: [], structuredContent: false }),
    });
  });
  f.session.setActiveToolsByName(["codemode", "fixture"]);
  let requests = 0;
  f.stream.mockImplementation((model) => {
    const output = createAssistantMessageEventStream();
    const message = reply(model);
    if (requests++ === 0) {
      message.stopReason = "toolUse";
      message.content = [
        {
          type: "toolCall",
          id: "code",
          name: "codemode",
          arguments: {
            code: 'text(await describeTool("fixture")); text(await tools.fixture({n:0}));',
          },
        },
      ];
    }
    queueMicrotask(() =>
      output.push({
        type: "done",
        reason: message.stopReason as "stop" | "toolUse",
        message,
      }),
    );
    return output;
  });
  await f.session.prompt("run the test");
  expect(requests).toBe(2);
  const results = f.stream.mock.calls
    .at(-1)![1]
    .messages.filter((m) => m.role === "toolResult");
  expect(results).toHaveLength(1);
  expect(results[0]?.isError).toBe(false);
  expect(JSON.stringify(results)).toContain("@integer");
  expect(JSON.stringify(results)).toContain("@maximum 3");
  expect(JSON.stringify(results)).toContain("false");
});

it.each([null, false, { value: 42 }])(
  "keeps Codemode structured output %j when PostToolUse adds context",
  async (structuredContent) => {
    const f = await fixture((pi) => {
      createCodemodeExtension({ mode: "only" })(pi);
      createHooksBridge({
        broker: {
          async request(request) {
            return {
              approved: true,
              data:
                request.kind === "hook.run" &&
                request.invocation.hook_event_name === "PostToolUse"
                  ? { context: "POST_TOOL_CONTEXT" }
                  : {},
            };
          },
        },
        threadId: "test",
        cwd: tmpdir(),
        enabled: () => true,
        mode: () => "work",
        turnId: () => "turn",
        canContinue: () => true,
      }).factory(pi);
      pi.registerTool({
        name: "fixture",
        label: "Fixture",
        description: "Fixture",
        parameters: Type.Object({}),
        outputSchema: Type.Unknown(),
        execute: async () => ({
          content: [{ type: "text", text: "original" }],
          structuredContent,
        }),
      });
    });
    f.session.setActiveToolsByName(["codemode", "fixture"]);
    let requests = 0;
    f.stream.mockImplementation((model) => {
      const output = createAssistantMessageEventStream();
      const message = reply(model);
      if (requests++ === 0) {
        message.stopReason = "toolUse";
        message.content = [
          {
            type: "toolCall",
            id: "code",
            name: "codemode",
            arguments: {
              code: `const result = await tools.fixture({}); if (JSON.stringify(result) !== ${JSON.stringify(JSON.stringify(structuredContent))}) throw new Error("STRUCTURED_VALUE_LOST"); text("STRUCTURED_VALUE_OK");`,
            },
          },
        ];
      }
      queueMicrotask(() =>
        output.push({
          type: "done",
          reason: message.stopReason as "stop" | "toolUse",
          message,
        }),
      );
      return output;
    });
    await f.session.prompt("run the hook test");
    expect(requests).toBe(2);
    const context = f.stream.mock.calls.at(-1)![1];
    const results = context.messages.filter((m) => m.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(false);
    expect(JSON.stringify(results)).toContain("STRUCTURED_VALUE_OK");
    expect(JSON.stringify(context.messages)).toContain("POST_TOOL_CONTEXT");
  },
);
