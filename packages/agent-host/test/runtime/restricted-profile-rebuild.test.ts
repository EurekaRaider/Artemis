// PR#245 P1-5 live evidence: binding the design plugin must TIGHTEN the
// actually-hosted session, not just the database row.
//
// A thread opened with a normal profile gets a full tool set (bash etc.).
// Re-opening it with the plugin-restricted profile must atomically rebuild
// the session (same threadId, new session object) so the restricted allow
// list is what the model sees — the reuse path may not hand back the stale
// unrestricted session. An active turn blocks the rebuild fail-closed.

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

describe("P1-5 restricted-profile session rebuild on openThread reuse", () => {
  it("a normal session starts with the full tool set (bash present)", async () => {
    const { thread } = await openHost();
    const names = [
      ...thread().executeTools.map((tool) => tool.name),
      ...thread().delegatedTools.map((tool) => tool.name),
    ];
    expect(names).toContain("shell");
    expect(thread().executionProfile).toBeUndefined();
  });

  it("re-open with the restricted profile rebuilds into the allow list", async () => {
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
    expect(after.executionProfile).toBe(RESTRICTED_PROFILE_ID);
    // 受限 allow list：bash/read/write 等被拒类别不在模型可见集合里，
    // plugin_ 工具在。
    const names = [
      ...after.executeTools.map((tool) => tool.name),
      ...after.delegatedTools.map((tool) => tool.name),
    ];
    expect(names).not.toContain("shell");
    expect(names).not.toContain("write");
    expect(names).not.toContain("read");
    expect(names.some((name) => name.startsWith("plugin_"))).toBe(true);
  });

  it("re-open with the same profile reuses the session unchanged", async () => {
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

  it("an active turn blocks the profile switch fail-closed", async () => {
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
