import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function execution(
  agentId: string,
  parentAgentId: string,
  depth: number,
  status: "running" | "completed" | "failed" = "running",
) {
  const now = Date.now();
  const controller = new AbortController();
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  if (status !== "running") settle();
  return {
    agentId,
    parentAgentId,
    depth,
    turnId: "turn-1",
    mode: "execute" as const,
    label: agentId,
    role: agentId,
    task: `Task for ${agentId}`,
    dependsOnAgentIds: [],
    writePaths: [],
    required: true,
    attempt: 1,
    status,
    controller,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    lastActivityAt: now,
    output: status === "completed" ? `${agentId} complete` : "",
    pendingSteers: [],
    longestObservationMilliseconds: 0,
    subtreeIntegrated: false,
    done,
    settle,
  };
}

describe("agent tree lifecycle", () => {
  it("requires direct children and nested subteams to settle before finish_subteam", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-agent-tree-"));
    cleanupPaths.push(workspace);
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
    );
    const sessionFile = SessionManager.create(
      workspace,
      join(workspace, "sessions"),
    ).getSessionFile();
    await host.openThread({
      threadId: "thread-1",
      workspacePath: workspace,
      target: "local",
      ...(sessionFile ? { sessionFile } : {}),
    });
    const hosted = (
      host as unknown as {
        threads: Map<string, Record<string, unknown>>;
      }
    ).threads.get("thread-1")!;
    const supervisor = execution("supervisor", "parent", 1);
    const child = execution("child", "supervisor", 2);
    const grandchild = execution("grandchild", "child", 3, "completed");
    const childAgents = new Map([
      [supervisor.agentId, supervisor],
      [child.agentId, child],
      [grandchild.agentId, grandchild],
    ]);
    Object.assign(hosted, {
      currentTurnId: "turn-1",
      currentMode: "execute",
      childAgents,
      team: {
        teamId: "team-1",
        turnId: "turn-1",
        mission: "Exercise nested lifecycle gates.",
        status: "running",
        memberAgentIds: [...childAgents.keys()],
        requiredAgentIds: new Set(childAgents.keys()),
        blockedAgentIds: new Set(),
        messageSequence: 0,
        messages: [],
        memberVersions: new Map(),
        observers: new Map(),
        spawnCount: 3,
        updatedAt: Date.now(),
        version: 0,
        waiters: new Set(),
      },
    });
    const session = hosted.session as { steer(text: string): Promise<void> };
    session.steer = async () => undefined;

    await expect(
      host.finishAgentSubteam("thread-1", "supervisor", [], "Integrated."),
    ).rejects.toThrow("still running");
    child.status = "completed";
    child.settle();
    await expect(
      host.finishAgentSubteam("thread-1", "supervisor", [], "Integrated."),
    ).rejects.toThrow("not integrated");
    child.subtreeIntegrated = true;
    await expect(
      host.finishAgentSubteam("thread-1", "supervisor", [], "Integrated."),
    ).resolves.toMatchObject({ subtreeStatus: "integrated" });

    host.dispose();
  });

  it("requires an explicit waiver for a failed required direct child", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-agent-waiver-"));
    cleanupPaths.push(workspace);
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      { emit() {} },
    );
    await host.openThread({
      threadId: "thread-waiver",
      workspacePath: workspace,
      target: "local",
    });
    const hosted = (
      host as unknown as {
        threads: Map<string, Record<string, unknown>>;
      }
    ).threads.get("thread-waiver")!;
    const supervisor = execution("supervisor", "parent", 1);
    const failed = execution("failed", "supervisor", 2, "failed");
    const childAgents = new Map([
      [supervisor.agentId, supervisor],
      [failed.agentId, failed],
    ]);
    Object.assign(hosted, {
      currentTurnId: "turn-1",
      currentMode: "execute",
      childAgents,
      team: {
        teamId: "team-waiver",
        turnId: "turn-1",
        mission: "Exercise failure waivers.",
        status: "blocked",
        memberAgentIds: [...childAgents.keys()],
        requiredAgentIds: new Set(childAgents.keys()),
        blockedAgentIds: new Set([failed.agentId]),
        messageSequence: 0,
        messages: [],
        memberVersions: new Map(),
        observers: new Map(),
        spawnCount: 2,
        updatedAt: Date.now(),
        version: 0,
        waiters: new Set(),
      },
    });
    const session = hosted.session as { steer(text: string): Promise<void> };
    session.steer = async () => undefined;

    await expect(
      host.finishAgentSubteam(
        "thread-waiver",
        "supervisor",
        [],
        "Integrated with a known failure.",
      ),
    ).rejects.toThrow("explicit waiver");
    await expect(
      host.finishAgentSubteam(
        "thread-waiver",
        "supervisor",
        ["failed"],
        "Integrated with a known failure.",
      ),
    ).resolves.toMatchObject({ subtreeStatus: "integrated" });

    host.dispose();
  });
});
