import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentPayload } from "@artemis/protocol";

const childBehavior = vi.hoisted(() => ({
  prompt: undefined as ((session: AgentSession) => Promise<void>) | undefined,
}));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    createAgentSession: async (
      ...args: Parameters<typeof original.createAgentSession>
    ) => {
      const result = await original.createAgentSession(...args);
      result.session.prompt = async () =>
        childBehavior.prompt?.(result.session);
      return result;
    },
  };
});
import { ArtemisAgentHost, type AgentTeamSnapshot } from "../src/runtime.js";

interface Tool {
  name: string;
  execute(
    id: string,
    params: Record<string, unknown>,
  ): Promise<{
    details: AgentTeamSnapshot & { agentId: string };
    content: { text: string }[];
  }>;
}
interface Thread {
  currentTurnId?: string;
  currentMode?: string;
  session: AgentSession;
  executeTools: Tool[];
  childAgents: Map<
    string,
    {
      status: string;
      lastActivityAt: number;
      session?: AgentSession;
      subtreeIntegrated: boolean;
    }
  >;
}
const paths: string[] = [];
const hosts: ArtemisAgentHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose();
  childBehavior.prompt = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup(timeout = 300_000) {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-team-recovery-"));
  paths.push(workspace);
  const events: AgentPayload[] = [];
  const host = new ArtemisAgentHost(
    { request: async () => ({ approved: false }) },
    {
      emit(_thread, _turn, payload) {
        events.push(payload);
      },
    },
    {
      agentDir: join(workspace, "agent"),
      agentConcurrencyLimit: 2,
      modelStreamIdleTimeoutMs: timeout,
    },
  );
  hosts.push(host);
  await host.openThread({
    threadId: "recovery",
    workspacePath: workspace,
    target: "local",
  });
  const thread = (
    host as unknown as { threads: Map<string, Thread> }
  ).threads.get("recovery")!;
  thread.currentTurnId = "turn";
  thread.currentMode = "execute";
  thread.session.sendCustomMessage = async () => undefined;
  const call = (name: string, params: Record<string, unknown> = {}) =>
    thread.executeTools
      .find((tool) => tool.name === name)!
      .execute(name, params);
  const spawn = async (label = "worker", path = label) =>
    (
      await call("spawn_agent", {
        label,
        task: "Produce a report",
        write_paths: [path],
      })
    ).details.agentId;
  return { host, thread, call, spawn, workspace, events };
}
function holdTool(session: AgentSession): Promise<void> {
  // Simulate an in-flight tool which acknowledges abort, without a provider.
  (session as unknown as { _emit(event: unknown): void })._emit({
    type: "tool_execution_start",
    toolCallId: "held",
    toolName: "read",
    args: {},
  });
  return new Promise((resolve) => {
    session.abort = async () => resolve();
  });
}

it("reports full members on first wait, health changes and timeout, without counting nudges as progress", async () => {
  const { host, thread, spawn, call } = await setup();
  childBehavior.prompt = holdTool;
  const id = await spawn();
  await vi.waitFor(() =>
    expect(thread.childAgents.get(id)?.session).toBeDefined(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.useFakeTimers();
  const initial = await host.waitForAgentTeam("recovery", "parent", 180);
  expect(initial).toMatchObject({
    snapshotKind: "full",
    members: [{ agentId: id }],
  });
  const lastActivityAt = thread.childAgents.get(id)!.lastActivityAt;
  await host.steerChildAgent("recovery", id, "Report progress");
  expect(thread.childAgents.get(id)!.lastActivityAt).toBe(lastActivityAt);
  // Consume the steering event; it is a status change, not worker progress.
  await host.waitForAgentTeam("recovery", "parent", 180);
  const healthWait = host.waitForAgentTeam("recovery", "parent", 180);
  await vi.advanceTimersByTimeAsync(61_000);
  expect(await healthWait).toMatchObject({
    snapshotKind: "full",
    observationExpired: false,
    members: [{ agentId: id, health: "suspect" }],
  });
  const timeoutWait = call("wait_team", { deadline_seconds: 2 });
  await vi.advanceTimersByTimeAsync(2_000);
  const result = await timeoutWait;
  expect(result.details).toMatchObject({
    snapshotKind: "full",
    observationExpired: true,
    members: [{ agentId: id }],
  });
  const text = JSON.parse(result.content[0]!.text);
  expect(text.members[0]).toHaveProperty("lastActivityAt");
  expect(text.observation).toHaveProperty("resumedAt");
  await host.cancelChildAgent("recovery", id);
});

it("keeps cancelled history visible and clears obligations only on explicit takeover", async () => {
  const { host, spawn, call, events } = await setup();
  childBehavior.prompt = holdTool;
  const old = await spawn("old", "tmp");
  await expect(spawn("overlap", "tmp")).rejects.toThrow("overlaps");
  await host.cancelChildAgent("recovery", old);
  const fresh = await spawn("replacement", "tmp/chinese");
  const blocked = await host.waitForAgentTeam("recovery", "parent", 180);
  expect(blocked).toMatchObject({
    snapshotKind: "full",
    team: { status: "blocked" },
    blockingAgentIds: [old],
  });
  expect(blocked.members.map((member) => member.agentId)).toEqual([old, fresh]);
  await call("cancel_agent", {
    agent_id: old,
    take_over_summary: "I will complete the old research.",
  });
  expect(host.listAgentTeam("recovery").team.requiredAgentIds).not.toContain(
    old,
  );
  expect(host.listAgentTeam("recovery").team.memberAgentIds).toContain(old);
  await call("cancel_agent", {
    agent_id: fresh,
    take_over_summary: "I will also complete this research.",
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "agent-team.message",
      content: expect.stringContaining("Parent took over"),
    }),
  );
  expect(
    host.finishAgentTeam("recovery", [], "All work completed by parent").team
      .status,
  ).toBe("completed");
});

it("does not waive a subtree or free its write scope while cancellation is pending", async () => {
  const { host, thread, spawn } = await setup();
  let finish!: () => void;
  childBehavior.prompt = async (session) => {
    session.abort = async () => undefined;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const id = await spawn();
  await vi.waitFor(() => expect(finish).toBeDefined());
  vi.useFakeTimers();
  const takeover = host.takeOverChildAgent("recovery", id, "Finish myself");
  const rejected = expect(takeover).rejects.toThrow(
    "Cancellation is still pending",
  );
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(host.listAgentTeam("recovery").team.requiredAgentIds).toContain(id);
  await expect(spawn("overlap", "worker")).rejects.toThrow("overlaps");
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(thread.childAgents.get(id)?.status).toBe("cancelled");
  await host.takeOverChildAgent("recovery", id, "Finish myself");
});

it("lets the real parent turn recover from silent child tools, take over, write and finish", async () => {
  const { host, thread, spawn, call, workspace, events } = await setup();
  childBehavior.prompt = holdTool;
  thread.session.prompt = async () => {
    const ids = await Promise.all([
      spawn("chinese"),
      spawn("math"),
      spawn("english"),
    ]);
    const first = await call("wait_team", { deadline_seconds: 1 });
    expect(first.details.members).toHaveLength(3);
    // Regardless of worker progress, the root must regain its lease.
    await call("wait_team", { deadline_seconds: 1 });
    for (const id of ids)
      await call("cancel_agent", {
        agent_id: id,
        take_over_summary: "Produce the report in the parent.",
      });
    await writeFile(
      join(workspace, "report.txt"),
      "Parent completed and checked all three workstreams.",
    );
    await call("finish_team", {
      summary: "Verified report.txt contains all three workstreams.",
    });
  };
  await host.prompt("recovery", "turn-e2e", "Complete the reports", "execute");
  expect(await readFile(join(workspace, "report.txt"), "utf8")).toContain(
    "all three workstreams",
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: "agent-team.status", status: "completed" }),
  );
  expect(events.some((event) => event.type === "turn.failed")).toBe(false);
  expect(host.concurrencyStatus()).toMatchObject({
    active: 0,
    waiting: 0,
    queued: 0,
  });
});

it("fails a child with no stream activity and preserves its failure for takeover", async () => {
  const { host, spawn, thread, events } = await setup(30);
  let started = false;
  childBehavior.prompt = async (session) => {
    started = true;
    session.abort = async () => undefined;
    await new Promise<void>(() => {});
  };
  const id = await spawn();
  await vi.waitFor(() => expect(started).toBe(true));
  await vi.waitFor(() =>
    expect(thread.childAgents.get(id)?.status).toBe("failed"),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "child-agent.status",
      agentId: id,
      status: "failed",
      error: expect.stringContaining("no streaming activity"),
    }),
  );
  await host.takeOverChildAgent("recovery", id, "Complete the report locally.");
  expect(host.listAgentTeam("recovery").blockingAgentIds).toEqual([]);
});

it("cancels a queued dependency waiter without waiting for its stuck prerequisite", async () => {
  const { host, spawn, call } = await setup();
  childBehavior.prompt = holdTool;
  const prerequisite = await spawn("prerequisite");
  const dependent = (
    await call("spawn_agent", {
      label: "dependent",
      task: "Wait for prerequisite",
      depends_on_agent_ids: [prerequisite],
      write_paths: ["dependent"],
    })
  ).details.agentId;
  vi.useFakeTimers();
  const cancellation = host.cancelChildAgent("recovery", dependent);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await cancellation).toMatchObject({ status: "cancelled" });
  expect(host.childAgentStatus("recovery", prerequisite).status).not.toBe(
    "cancelled",
  );
  await host.takeOverChildAgent(
    "recovery",
    dependent,
    "Do the dependent work after the prerequisite is resolved.",
  );
  // Abort the prerequisite during setup as well; it must never start afterwards.
  vi.useRealTimers();
  await host.cancelChildAgent("recovery", prerequisite);
});

it("takes over a stopped nested subtree without losing history or requiring abandoned integration", async () => {
  const { host, thread, spawn } = await setup();
  childBehavior.prompt = holdTool;
  const supervisor = await spawn("supervisor");
  await vi.waitFor(() =>
    expect(thread.childAgents.get(supervisor)?.session).toBeDefined(),
  );
  const nestedSpawn = thread.childAgents
    .get(supervisor)!
    .session!.agent.state.tools.find((tool) => tool.name === "spawn_agent")!;
  const nested = await nestedSpawn.execute("nested", {
    label: "nested",
    task: "Nested work",
    write_paths: ["nested"],
  });
  const nestedId = (nested.details as { agentId: string }).agentId;
  await host.takeOverChildAgent(
    "recovery",
    supervisor,
    "Complete and verify both workstreams myself.",
  );
  const snapshot = host.listAgentTeam("recovery");
  expect(snapshot.team.memberAgentIds).toEqual([supervisor, nestedId]);
  expect(snapshot.team.requiredAgentIds).toEqual([]);
  expect(
    snapshot.members.every((member) => member.status === "cancelled"),
  ).toBe(true);
  expect(
    host.finishAgentTeam("recovery", [], "Parent verified both workstreams.")
      .team.status,
  ).toBe("completed");
});

it("lets the provider retry watchdog own child streams without a competing idle timeout", async () => {
  const { host, thread, spawn } = await setup(30);
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: () => void;
  const end = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const recovery = host as unknown as {
    handleConnectionRecovery(
      sessionId: string,
      update: { phase: "stream-started" | "stream-finished" },
    ): void;
  };
  childBehavior.prompt = async (session) => {
    recovery.handleConnectionRecovery(session.sessionId, {
      phase: "stream-started",
    });
    started();
    await end;
    recovery.handleConnectionRecovery(session.sessionId, {
      phase: "stream-finished",
    });
  };
  vi.useFakeTimers();
  const id = await spawn();
  await start;
  await vi.advanceTimersByTimeAsync(100);
  expect(thread.childAgents.get(id)?.status).toBe("running");
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(thread.childAgents.get(id)?.status).toBe("completed");
});
