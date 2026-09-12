import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomAgentDefinition } from "@artemis/protocol";

const captured = vi.hoisted(() => ({ sessions: [] as any[] }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    createAgentSession: async (options: any) => {
      const result = await original.createAgentSession(options);
      result.session.prompt = async () => {};
      captured.sessions.push(options);
      return result;
    },
  };
});
import { ArtemisAgentHost } from "../src/runtime.js";

const paths: string[] = [];
const hosts: ArtemisAgentHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose();
  captured.sessions.length = 0;
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(toolPolicy: CustomAgentDefinition["toolPolicy"]) {
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
    credentials: {},
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
  thread.currentMode = "execute";
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

it("an empty allowlist exposes only host lifecycle tools", async () => {
  const { options } = await setup({ kind: "allowlist", tools: [] });
  expect(options.customTools.map((tool: any) => tool.name).sort()).toEqual([
    "finish_subteam",
    "list_agents",
    "send_message",
    "wait_agent",
    "wait_team",
  ]);
});

it("a read-only allowlist does not grant other business reads", async () => {
  const { options } = await setup({
    kind: "allowlist",
    tools: [{ kind: "builtin", toolId: "read" }],
  });
  const names = options.customTools.map((tool: any) => tool.name);
  expect(names).toContain("read");
  expect(names).not.toContain("web_search");
  expect(names).not.toContain("attachment_read");
});

it("a live policy revocation rejects an already registered tool before execution", async () => {
  const { options, internals, definition, broker } = await setup({
    kind: "allowlist",
    tools: [{ kind: "builtin", toolId: "read" }],
  });
  internals.configuration.customAgents = [
    { ...definition, toolPolicy: { kind: "allowlist", tools: [] } },
  ];
  const read = options.customTools.find((tool: any) => tool.name === "read");
  broker.request.mockClear();
  await expect(read.execute("read", { path: "test.txt" })).rejects.toThrow(
    /CUSTOM_AGENT_TOOL_DENIED/,
  );
  expect(broker.request).not.toHaveBeenCalled();
});

it("freezes tool references so edits cannot expand an accepted instance", async () => {
  const policy = {
    kind: "allowlist" as const,
    tools: [{ kind: "builtin" as const, toolId: "read" }],
  };
  const { child, internals, definition } = await setup(policy);
  policy.tools.push({ kind: "builtin", toolId: "web_search" });
  internals.configuration.customAgents = [
    { ...definition, toolPolicy: { kind: "inherit" } },
  ];
  expect(
    internals.customAgentToolAllowed(
      "web_search",
      child.customAgentSnapshot,
      "execute",
    ),
  ).toBe(false);
  expect(
    internals.customAgentToolAllowed(
      "read",
      child.customAgentSnapshot,
      "execute",
    ),
  ).toBe(true);
});

it("project scope revocation blocks tools on an accepted instance", async () => {
  const { child, internals, definition } = await setup({ kind: "inherit" });
  internals.configuration.customAgents = [{ ...definition, scope: "selected" }];
  internals.configuration.customAgentProjectIds = { "def-1": [] };
  expect(
    internals.customAgentToolAllowed(
      "read",
      child.customAgentSnapshot,
      "execute",
    ),
  ).toBe(false);
});

it("MCP grants use frozen stable identities and reject removed connections", async () => {
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
      readOnly: true,
    },
  ];
  internals.configuration.customAgents = [
    { ...definition, toolPolicy: { kind: "inherit" } },
  ];
  expect(
    internals.customAgentToolAllowed("mcp_allowed", snapshot, "execute"),
  ).toBe(true);
  expect(
    internals.customAgentToolAllowed("mcp_other", snapshot, "execute"),
  ).toBe(false);
  internals.configuration.mcpTools = [];
  expect(
    internals.customAgentToolAllowed("mcp_allowed", snapshot, "execute"),
  ).toBe(false);
});
