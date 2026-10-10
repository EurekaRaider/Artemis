import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomAgentDefinition } from "@artemis/protocol";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const captured = vi.hoisted(() => ({ sessions: [] as any[], run: false }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    createAgentSession: async (options: any) => {
      const result = await original.createAgentSession(options);
      if (!captured.run) result.session.prompt = async () => {};
      captured.sessions.push(options);
      return result;
    },
  };
});
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

const paths: string[] = [];
const hosts: ArtemisAgentHost[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  captured.run = false;
  for (const host of hosts.splice(0)) host.dispose();
  captured.sessions.length = 0;
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(
  toolPolicy: CustomAgentDefinition["toolPolicy"],
  mode: "work" | "codemode" = "work",
) {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-tool-policy-"));
  paths.push(workspace);
  const broker = { request: vi.fn(async () => ({ approved: true, data: {} })) };
  const host = new ArtemisAgentHost(broker, { emit() {} });
  hosts.push(host);
  const definition: CustomAgentDefinition = {
    id: "def-1",
    revision: 1,
    name: "reviewer",
    description: "",
    color: "green",
    enabled: true,
    instructions: "Review",
    scope: "all",
    modelPolicy: { kind: "inherit" },
    thinkingPolicy: { kind: "inherit" },
    toolPolicy,
    allowAutomaticInvocation: true,
    triggers: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const internals = host as any;
  await host.configure({
    credentials: captured.run
      ? { "kimi-coding": { type: "api_key", key: "synthetic-test-key" } }
      : {},
    customAgents: [definition],
    selection: {
      providerId: "kimi-coding",
      modelId: "k3",
      thinkingLevel: "off",
    },
  });
  await host.openThread({
    threadId: "thread-1",
    workspacePath: workspace,
    target: "local",
  });
  const thread = internals.threads.get("thread-1");
  thread.currentTurnId = "turn-1";
  thread.currentMode = mode;
  thread.selection = {
    providerId: "kimi-coding",
    modelId: "k3",
    thinkingLevel: "off",
  };
  thread.turnCustomAgents = [definition];
  thread.session.sendCustomMessage = async () => {};
  const spawn = thread.executeTools.find(
    (tool: any) => tool.name === "spawn_agent",
  );
  await spawn.execute("spawn", {
    agent: "def-1",
    task: "review",
    label: "review",
    role: "reviewer",
  });
  const child = [...thread.childAgents.values()][0] as any;
  await child.done;
  expect(child.error).toBeUndefined();
  const options = captured.sessions.at(-1);
  return { options, broker, internals, definition, child };
}

it.each([
  { kind: "allowlist", tools: [] },
  { kind: "allowlist", tools: [{ kind: "builtin", toolId: "read" }] },
] as const)(
  "legacy tool policies do not restrict child business tools: %j",
  async (policy) => {
    const { options } = await setup(
      policy as CustomAgentDefinition["toolPolicy"],
    );
    expect(options.customTools.map((tool: any) => tool.name)).toEqual(
      expect.arrayContaining([
        "read",
        "web_search",
        "attachment_read",
        "shell",
        "write",
        "classify",
        "generate_image",
      ]),
    );
  },
);

it("legacy live and frozen allowlists do not restrict tools, while Plan still denies writes", async () => {
  const { child, internals, definition } = await setup({
    kind: "allowlist",
    tools: [],
  });
  internals.configuration.customAgents = [
    { ...definition, toolPolicy: { kind: "allowlist", tools: [] } },
  ];
  expect(
    internals.customAgentToolAllowed(
      "web_search",
      child.customAgentSnapshot,
      "work",
    ),
  ).toBe(true);
  expect(
    internals.customAgentToolAllowed(
      "write",
      child.customAgentSnapshot,
      "plan",
    ),
  ).toBe(false);
  expect(
    internals.customAgentToolAllowed(
      "shell",
      child.customAgentSnapshot,
      "plan",
    ),
  ).toBe(false);
});

it("custom children with legacy empty allowlists can call native Pi models in Codemode", async () => {
  captured.run = true;
  const classify = vi
    .spyOn(ModelRuntime.prototype, "classify")
    .mockResolvedValue({
      stopReason: "stop",
      answers: { visible: { type: "bool", value: true } },
    } as never);
  let requests = 0;
  vi.spyOn(ModelRuntime.prototype, "streamSimple").mockImplementation(
    (model) => {
      const tool = requests++ === 0;
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: tool ? "toolUse" : "stop",
        content: tool
          ? [
              {
                type: "toolCall",
                id: "classify-child",
                name: "codemode",
                arguments: {
                  code: 'const model = await models.getModelOfType("classifier", "openai", "gpt-6-luna"); text((await models.classify(model, {state: {}, images: [{type: "image", data: "aW1hZ2U=", mimeType: "image/png"}], questions: {visible: {type: "bool", instructions: "Visible?", criteria: {true: "Yes", false: "No"}}}})).answers);',
                },
              },
            ]
          : [{ type: "text", text: "Classified." }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: message.stopReason, message });
      return stream;
    },
  );
  await setup({ kind: "allowlist", tools: [] }, "codemode");
  expect(classify).toHaveBeenCalledOnce();
  expect(classify.mock.calls[0]?.[1].images).toEqual([
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ]);
  expect(classify.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
});

it("project scope revocation blocks tools on an accepted instance", async () => {
  const { child, internals, definition } = await setup({ kind: "inherit" });
  internals.configuration.customAgents = [{ ...definition, scope: "selected" }];
  internals.configuration.customAgentProjectIds = { "def-1": [] };
  expect(
    internals.customAgentToolAllowed("read", child.customAgentSnapshot, "work"),
  ).toBe(false);
});

it("MCP tools ignore legacy allowlists and reject removed connections", async () => {
  const { child, internals, definition } = await setup({ kind: "inherit" });
  const snapshot = {
    ...child.customAgentSnapshot,
    effectiveCapabilities: ["mcp", "business-read"],
    toolPolicy: {
      kind: "allowlist",
      tools: [{ kind: "mcp", serverId: "server", toolName: "allowed" }],
    },
  };
  internals.configuration.mcpTools = [
    {
      piName: "mcp_allowed",
      serverId: "server",
      toolName: "allowed",
      readOnly: true,
    },
    {
      piName: "mcp_other",
      serverId: "server",
      toolName: "other",
      readOnly: false,
    },
  ];
  internals.configuration.customAgents = [
    { ...definition, toolPolicy: { kind: "inherit" } },
  ];
  expect(
    internals.customAgentToolAllowed("mcp_allowed", snapshot, "work"),
  ).toBe(true);
  expect(internals.customAgentToolAllowed("mcp_other", snapshot, "work")).toBe(
    true,
  );
  expect(internals.customAgentToolAllowed("mcp_other", snapshot, "plan")).toBe(
    false,
  );
  internals.configuration.mcpTools = [];
  expect(
    internals.customAgentToolAllowed("mcp_allowed", snapshot, "work"),
  ).toBe(false);
});
