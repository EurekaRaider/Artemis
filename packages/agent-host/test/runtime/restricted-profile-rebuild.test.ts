import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../../src/runtime/runtime.js";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

interface InspectableTool {
  name: string;
}

interface InspectableThread {
  executionProfile?: string;
  executeTools: InspectableTool[];
  delegatedTools: InspectableTool[];
  currentTurnId?: string;
  session: { sessionId: string };
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function openHost(): Promise<{
  host: ArtemisAgentHost;
  workspace: string;
  threadId: string;
  thread(): InspectableThread;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-restricted-"));
  cleanupPaths.push(workspace);
  const host = new ArtemisAgentHost(
    {
      async request() {
        return { approved: true };
      },
    },
    { emit() {} },
  );
  const threadId = randomUUID();
  await host.openThread({
    threadId,
    workspacePath: workspace,
    target: "local",
  });
  const thread = () =>
    (
      host as unknown as { threads: Map<string, InspectableThread> }
    ).threads.get(threadId)!;
  return { host, workspace, threadId, thread };
}

const binding = {
  installationId: "com.artemis.design",
  pluginId: "com.artemis.design",
  typeId: "artemis-design",
  pluginVersion: "0.2.0",
  contentHash: "a".repeat(64),
  bindingRevision: "rev-test",
};

const pluginTools = [
  {
    name: "create_document",
    description: "Create a design document artifact.",
    effect: "artifact-write" as const,
  },
];

describe("Design binding session reuse", () => {
  it("a normal session starts with the full tool set (bash present)", async () => {
    const { thread } = await openHost();
    const names = [
      ...thread().executeTools.map((tool) => tool.name),
      ...thread().delegatedTools.map((tool) => tool.name),
    ];
    expect(names).toContain("shell");
    expect(thread().executionProfile).toBeUndefined();
  });

  it("binding a legacy restricted thread retains ordinary and plugin tools", async () => {
    const { host, workspace, threadId, thread } = await openHost();
    const before = thread();
    const sessionIdBefore = before.session.sessionId;

    await host.openThread({
      threadId,
      workspacePath: workspace,
      target: "local",
      typeBinding: binding,
      executionProfile: RESTRICTED_PROFILE_ID,
      pluginTools,
    });

    const after = thread();
    // 会话真的换了（同 threadId，新 session 对象）。
    expect(after).not.toBe(before);
    expect(after.session.sessionId).not.toBe(sessionIdBefore);
    expect(after.executionProfile).toBeUndefined();
    // Legacy Design profiles no longer narrow the ordinary tool set.
    const names = [
      ...after.executeTools.map((tool) => tool.name),
      ...after.delegatedTools.map((tool) => tool.name),
    ];
    expect(names).toContain("shell");
    expect(names).toContain("write");
    expect(names).toContain("read");
    expect(names.some((name) => name.startsWith("plugin_"))).toBe(true);
  });

  it("re-open with the same binding reuses the session unchanged", async () => {
    const { host, workspace, threadId, thread } = await openHost();
    const first = thread();
    const result = await host.openThread({
      threadId,
      workspacePath: workspace,
      target: "local",
    });
    expect(thread()).toBe(first);
    expect(result).toEqual({});
  });

  it("an active turn blocks rebinding without disrupting the session", async () => {
    const { host, workspace, threadId, thread } = await openHost();
    thread().currentTurnId = "turn-in-flight";
    await expect(
      host.openThread({
        threadId,
        workspacePath: workspace,
        target: "local",
        typeBinding: binding,
        executionProfile: RESTRICTED_PROFILE_ID,
        pluginTools,
      }),
    ).rejects.toThrow(/while a turn is active/);
    // 原会话未被破坏。
    expect(thread().executionProfile).toBeUndefined();
  });
});

it("ignores legacy profile changes without rebuilding an active bound session", async () => {
  const { host, workspace, threadId, thread } = await openHost();
  await host.openThread({
    threadId,
    workspacePath: workspace,
    target: "local",
    typeBinding: binding,
    executionProfile: RESTRICTED_PROFILE_ID,
    pluginTools,
  });
  const before = thread();
  thread().currentTurnId = "active";
  await host.openThread({
    threadId,
    workspacePath: workspace,
    target: "local",
    typeBinding: binding,
    executionProfile: "plugin-standard-v1",
    pluginTools,
  });
  expect(thread()).toBe(before);
  expect(thread().executionProfile).toBeUndefined();
  expect(thread().executeTools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "shell",
      "local_file_write",
      "plugin_create_document",
    ]),
  );
});
it.each([undefined, "unknown-profile"])(
  "bound sessions use ordinary tools for profile %s",
  async (executionProfile) => {
    const { host, workspace, threadId, thread } = await openHost();
    await host.openThread({
      threadId,
      workspacePath: workspace,
      target: "local",
      typeBinding: binding,
      executionProfile,
      pluginTools,
    });
    expect(thread().executeTools.map((tool) => tool.name)).toContain("shell");
  },
);
