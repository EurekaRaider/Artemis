/**
 * PR5 release-blocking routing tests (D#152 plan section 7).
 *
 * These tests go through the REAL spawn_agent tool execution entry and
 * check state — never just tool description text:
 *
 *  1. A free-text role exactly naming the unique automatic definition
 *     without an id returns CUSTOM_AGENT_REFERENCE_REQUIRED with zero
 *     instances and zero budget spent; retrying with the id succeeds.
 *  2. A task-text trigger hit is advisory only: a legitimate free role
 *     is not rejected, the child is not silently switched, and the
 *     guidance lists the candidate.
 *  3. Multi-candidate ambiguity surfaces every candidate without
 *     auto-picking; an explicit id disambiguates; a reasoned free-role
 *     fallback stays allowed.
 *
 * Controls: allowAutomaticInvocation=false definitions never
 * participate in automatic matching, an empty catalog keeps the old
 * behavior, a catalog overflow disables trigger matching for the turn,
 * and an explicit dispatch is never overridden by trigger words.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { AgentPayload, CustomAgentDefinition } from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

type RoutePayload = Extract<AgentPayload, { type: "custom-agent.route" }>;

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

interface InspectableChild {
  status: string;
  role: string;
  customAgentSnapshot?: { definitionId: string };
}

interface InspectableThread {
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
  selection?: {
    providerId: string;
    modelId: string;
    thinkingLevel: "off";
  };
  turnCustomAgents?: CustomAgentDefinition[];
  childAgents: Map<string, InspectableChild>;
  team?: { teamId: string; spawnCount: number; memberAgentIds: string[] };
  executeTools: InspectableTool[];
  session: {
    sendCustomMessage(message: unknown, options?: unknown): Promise<void>;
  };
}

function definition(
  overrides: Partial<CustomAgentDefinition> = {},
): CustomAgentDefinition {
  return {
    id: "def-1",
    revision: 2,
    name: "code-reviewer",
    description: "Reviews changes",
    color: "green",
    enabled: true,
    instructions: "Review carefully.",
    scope: "all",
    modelPolicy: { kind: "inherit" },
    thinkingPolicy: { kind: "inherit" },
    toolPolicy: { kind: "inherit" },
    allowAutomaticInvocation: true,
    triggers: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

async function setup(definitions: CustomAgentDefinition[]) {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-custom-route-"));
  cleanupPaths.push(workspace);
  const events: Array<{
    threadId: string;
    turnId: string | undefined;
    payload: AgentPayload;
  }> = [];
  const host = new ArtemisAgentHost(
    { request: async () => ({ approved: false }) },
    {
      emit(threadId, turnId, payload) {
        events.push({ threadId, turnId, payload });
      },
    },
  );
  await host.openThread({
    threadId: "thread-1",
    workspacePath: workspace,
    target: "local",
  });
  const internals = host as unknown as {
    configuration: { customAgents?: CustomAgentDefinition[] };
    threads: Map<string, InspectableThread>;
    concurrency: {
      run<T>(kind: "child", task: () => Promise<T>): Promise<T>;
    };
  };
  // The frozen per-turn catalog and the latest global configuration both
  // carry the definitions: dispatch liveness is always cross-checked
  // against the global list.
  internals.configuration.customAgents = definitions;
  const thread = internals.threads.get("thread-1")!;
  thread.currentTurnId = "turn-1";
  thread.currentMode = "execute";
  thread.selection = {
    providerId: "kimi-coding",
    modelId: "k3",
    thinkingLevel: "off",
  };
  thread.turnCustomAgents = definitions;
  thread.session.sendCustomMessage = async () => undefined;
  // Never grant a child execution lease; spawn bookkeeping is synchronous.
  internals.concurrency = {
    run: <T>() => new Promise<T>(() => undefined),
  };
  const spawn = thread.executeTools.find(
    (tool) => tool.name === "spawn_agent",
  )!;
  const routes = (): RoutePayload[] =>
    events
      .filter(
        (event): event is typeof event & { payload: RoutePayload } =>
          event.payload.type === "custom-agent.route",
      )
      .map((event) => event.payload);
  return { host, thread, spawn, routes };
}

describe("custom agent automatic routing (release-blocking)", () => {
  it("① role exact-match without an id demands a reference, spends nothing, then succeeds with the id", async () => {
    const { host, thread, spawn, routes } = await setup([
      definition({
        id: "def-rev",
        name: "code-reviewer",
        triggers: ["security audit"],
      }),
    ]);

    await expect(
      spawn.execute("spawn-1", {
        label: "Review",
        role: "Code-Reviewer",
        task: "review the diff",
      }),
    ).rejects.toThrowError(/CUSTOM_AGENT_REFERENCE_REQUIRED.*def-rev/);

    // Zero instances, zero budget: the rejection runs before team
    // creation and before any spawn-budget deduction.
    expect(thread.childAgents.size).toBe(0);
    expect(thread.team).toBeUndefined();

    const rejection = routes().find(
      (route) => route.decision === "reference-required",
    );
    expect(rejection).toMatchObject({
      invocationSource: "model-automatic",
      selectionBasis: "role-exact",
      catalogSize: 1,
      errorCode: "CUSTOM_AGENT_REFERENCE_REQUIRED",
    });
    expect(rejection?.parentAgentId).toBeTruthy();
    expect(rejection?.candidates).toEqual([
      { definitionId: "def-rev", revision: 2, name: "code-reviewer" },
    ]);
    expect(rejection?.catalogId).toMatch(/^auto:[0-9a-f]{16}$/);

    // Retrying with the explicit id succeeds — and trigger words in the
    // task text never attach an advisory to an explicit dispatch.
    const accepted = await spawn.execute("spawn-2", {
      label: "Review",
      agent: "def-rev",
      task: "run a security audit of the diff",
    });
    expect(thread.childAgents.size).toBe(1);
    expect(thread.team?.spawnCount).toBe(1);
    const agentId = String(accepted.details?.agentId);
    expect(
      thread.childAgents.get(agentId)?.customAgentSnapshot?.definitionId,
    ).toBe("def-rev");
    expect(accepted.content[0]!.text).not.toContain("[Routing]");

    const acceptedRoute = routes().find(
      (route) => route.decision === "accepted",
    );
    expect(acceptedRoute).toMatchObject({
      invocationSource: "model-explicit",
      selectionBasis: "explicit-id",
      selectedDefinitionId: "def-rev",
      selectedRevision: 2,
      instanceId: agentId,
      model: { providerId: "kimi-coding", modelId: "k3" },
    });

    host.dispose();
  });

  it("② a task trigger hit is advisory only and never rejects or rewrites a free role", async () => {
    const { host, thread, spawn, routes } = await setup([
      definition({
        id: "def-sec",
        name: "security-auditor",
        triggers: ["security audit"],
      }),
    ]);

    const result = await spawn.execute("spawn-1", {
      label: "Docs pass",
      role: "generalist",
      task: "run a security audit on the markdown files",
    });

    // The legitimate free role was not rejected and was not switched:
    // the child keeps the requested role and carries no snapshot.
    const agentId = String(result.details?.agentId);
    const child = thread.childAgents.get(agentId)!;
    expect(child.role).toBe("generalist");
    expect(child.customAgentSnapshot).toBeUndefined();

    // The spawn result shows the candidate instead of acting on it.
    expect(result.content[0]!.text).toContain("[Routing]");
    expect(result.content[0]!.text).toContain("def-sec");

    const advisory = routes().find((route) => route.decision === "advisory");
    expect(advisory).toMatchObject({
      invocationSource: "none",
      selectionBasis: "trigger-words",
      instanceId: agentId,
    });
    expect(advisory?.candidates).toEqual([
      { definitionId: "def-sec", revision: 2, name: "security-auditor" },
    ]);
    expect(advisory?.selectedDefinitionId).toBeUndefined();

    host.dispose();
  });

  it("③ ambiguity lists every candidate without picking one; an explicit id disambiguates", async () => {
    const { host, thread, spawn, routes } = await setup([
      definition({
        id: "def-sec",
        name: "security-auditor",
        triggers: ["security audit"],
      }),
      definition({
        id: "def-comp",
        name: "compliance-checker",
        color: "purple",
        triggers: ["compliance review"],
      }),
    ]);

    const ambiguous = await spawn.execute("spawn-1", {
      label: "Wide pass",
      role: "assistant",
      task: "run a security audit and a compliance review",
    });
    // Ambiguity never auto-picks: the child runs as the free role.
    const ambiguousId = String(ambiguous.details?.agentId);
    expect(
      thread.childAgents.get(ambiguousId)?.customAgentSnapshot,
    ).toBeUndefined();
    expect(ambiguous.content[0]!.text).toContain("def-sec");
    expect(ambiguous.content[0]!.text).toContain("def-comp");

    const advisory = routes().find((route) => route.decision === "advisory");
    expect(advisory?.candidates).toEqual([
      { definitionId: "def-sec", revision: 2, name: "security-auditor" },
      { definitionId: "def-comp", revision: 2, name: "compliance-checker" },
    ]);

    // A legal explicit id resolves the ambiguity.
    const disambiguated = await spawn.execute("spawn-2", {
      label: "Compliance",
      agent: "def-comp",
      task: "run the compliance review",
    });
    const disambiguatedId = String(disambiguated.details?.agentId);
    expect(
      thread.childAgents.get(disambiguatedId)?.customAgentSnapshot
        ?.definitionId,
    ).toBe("def-comp");
    expect(
      routes().find(
        (route) =>
          route.decision === "accepted" && route.instanceId === disambiguatedId,
      ),
    ).toMatchObject({ selectedDefinitionId: "def-comp" });

    // A reasoned free-role fallback stays allowed even while triggers hit.
    const fallback = await spawn.execute("spawn-3", {
      label: "General pass",
      role: "generalist",
      task: "security audit credentials handling end to end",
    });
    const fallbackId = String(fallback.details?.agentId);
    expect(
      thread.childAgents.get(fallbackId)?.customAgentSnapshot,
    ).toBeUndefined();
    expect(
      routes().find(
        (route) =>
          route.decision === "advisory" && route.instanceId === fallbackId,
      ),
    ).toBeDefined();

    host.dispose();
  });
});

describe("custom agent automatic routing controls", () => {
  it("manual-only definitions never participate in automatic matching", async () => {
    const { host, thread, spawn, routes } = await setup([
      definition({
        id: "def-manual",
        name: "release-captain",
        allowAutomaticInvocation: false,
        triggers: ["release checklist"],
      }),
    ]);

    // A role exactly naming a manual-only definition is a free role,
    // not a hard stop.
    const named = await spawn.execute("spawn-1", {
      label: "Release",
      role: "release-captain",
      task: "drive the release checklist",
    });
    const namedId = String(named.details?.agentId);
    expect(
      thread.childAgents.get(namedId)?.customAgentSnapshot,
    ).toBeUndefined();
    // Its trigger words produce no advisory either.
    expect(named.content[0]!.text).not.toContain("[Routing]");
    expect(
      routes().find((route) => route.decision === "advisory"),
    ).toBeUndefined();

    // The model cannot target a manual-only definition by id.
    await expect(
      spawn.execute("spawn-2", {
        label: "Release",
        agent: "def-manual",
        task: "drive the release checklist",
      }),
    ).rejects.toThrowError(/CUSTOM_AGENT_NOT_FOUND/);

    host.dispose();
  });

  it("an empty catalog keeps the pre-PR5 free-role behavior", async () => {
    const { host, thread, spawn, routes } = await setup([]);

    const result = await spawn.execute("spawn-1", {
      label: "Helper",
      role: "code-reviewer",
      task: "review the diff",
    });
    const agentId = String(result.details?.agentId);
    expect(thread.childAgents.get(agentId)?.role).toBe("code-reviewer");
    expect(result.content[0]!.text).not.toContain("[Routing]");

    const freeRole = routes().find((route) => route.decision === "free-role");
    expect(freeRole).toMatchObject({
      invocationSource: "none",
      selectionBasis: "none",
      catalogSize: 0,
      instanceId: agentId,
    });

    host.dispose();
  });

  it("a catalog overflow disables trigger matching for the turn instead of silently truncating", async () => {
    const overflowed = Array.from({ length: 21 }, (_, index) =>
      definition({
        id: `def-${index}`,
        name: `agent-${index}`,
        triggers: [`trigger-${index}`],
      }),
    );
    const { host, thread, spawn, routes } = await setup(overflowed);

    const result = await spawn.execute("spawn-1", {
      label: "Helper",
      role: "generalist",
      task: "please run trigger-7 now",
    });
    const agentId = String(result.details?.agentId);
    expect(
      thread.childAgents.get(agentId)?.customAgentSnapshot,
    ).toBeUndefined();
    expect(result.content[0]!.text).not.toContain("[Routing]");
    expect(
      routes().find((route) => route.decision === "advisory"),
    ).toBeUndefined();

    host.dispose();
  });
});

describe("custom agent turn catalog injection", () => {
  async function promptFixture(definitions: CustomAgentDefinition[]) {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-catalog-prompt-"));
    cleanupPaths.push(workspace);
    const payloads: AgentPayload[] = [];
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      {
        emit(_thread, _turn, payload) {
          payloads.push(payload);
        },
      },
    );
    await host.openThread({
      threadId: "thread-1",
      workspacePath: workspace,
      target: "local",
    });
    const thread = (
      host as unknown as {
        threads: Map<
          string,
          { session: { prompt(text: string): Promise<void> } }
        >;
      }
    ).threads.get("thread-1")!;
    // Capture the exact model-bound prompt text; the turn then completes
    // immediately without a provider.
    const seenPrompts: string[] = [];
    thread.session.prompt = async (text: string) => {
      seenPrompts.push(text);
    };
    await host.prompt(
      "thread-1",
      "turn-1",
      "Please review the change.",
      "execute",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      definitions,
    );
    return { host, payloads, seenPrompts };
  }

  it("injects the automatic catalog into the turn prompt with stable ids", async () => {
    const { host, seenPrompts, payloads } = await promptFixture([
      definition({
        id: "def-rev",
        name: "code-reviewer",
        description: "Reviews changes",
      }),
      definition({
        id: "def-manual",
        name: "release-captain",
        allowAutomaticInvocation: false,
      }),
    ]);

    const text = seenPrompts.join("\n");
    expect(text).toContain("[Custom sub-agents]");
    expect(text).toContain("code-reviewer (id: def-rev)");
    // Manual-only definitions are invisible to the model.
    expect(text).not.toContain("release-captain");
    // A normal turn with a catalog emits no catalog-disabled audit.
    expect(
      payloads.some(
        (payload) =>
          payload.type === "custom-agent.route" &&
          payload.decision === "catalog-disabled",
      ),
    ).toBe(false);

    host.dispose();
  });

  it("an over-budget catalog disables automatic routing for the turn with a durable audit", async () => {
    const overflowed = Array.from({ length: 21 }, (_, index) =>
      definition({ id: `def-${index}`, name: `agent-${index}` }),
    );
    const { host, seenPrompts, payloads } = await promptFixture(overflowed);

    // No silent truncation: the note is withheld entirely.
    expect(seenPrompts.join("\n")).not.toContain("[Custom sub-agents]");
    const audit = payloads.find(
      (payload): payload is RoutePayload =>
        payload.type === "custom-agent.route",
    );
    expect(audit).toMatchObject({
      decision: "catalog-disabled",
      invocationSource: "none",
      selectionBasis: "none",
      catalogSize: 21,
    });
    expect(audit?.catalogId).toMatch(/^auto:[0-9a-f]{16}$/);

    host.dispose();
  });
});

it("rejects an unavailable fixed model before registering a child or spending budget", async () => {
  const { host, thread, spawn } = await setup([
    definition({
      modelPolicy: {
        kind: "fixed",
        providerId: "missing-provider",
        modelId: "missing-model",
      },
    }),
  ]);
  try {
    await expect(
      spawn.execute("missing", {
        agent: "def-1",
        task: "review",
        label: "review",
      }),
    ).rejects.toThrow(/CUSTOM_AGENT_MODEL_UNAVAILABLE/);
    expect(thread.childAgents.size).toBe(0);
    expect(thread.team?.spawnCount ?? 0).toBe(0);
  } finally {
    host.dispose();
  }
});

it("rejects a definition removed from this project after the catalog froze", async () => {
  const { host, thread, spawn } = await setup([
    definition({ scope: "selected" }),
  ]);
  try {
    await expect(
      spawn.execute("scope", {
        agent: "def-1",
        task: "review",
        label: "review",
      }),
    ).rejects.toThrow(/CUSTOM_AGENT_OUT_OF_SCOPE/);
    expect(thread.childAgents.size).toBe(0);
    expect(thread.team?.spawnCount ?? 0).toBe(0);
  } finally {
    host.dispose();
  }
});

it("catalog overflow disables both model IDs and exact-role correction", async () => {
  const { host, thread, spawn } = await setup(
    Array.from({ length: 21 }, (_, index) =>
      definition({ id: `def-${index}`, name: `reviewer-${index}` }),
    ),
  );
  try {
    await spawn.execute("free", {
      role: "reviewer-0",
      task: "review",
      label: "review",
    });
    expect(thread.childAgents.size).toBe(1);
    await expect(
      spawn.execute("explicit", {
        agent: "def-0",
        task: "review",
        label: "review",
      }),
    ).rejects.toThrow(/automatic routing is disabled/);
    expect(thread.childAgents.size).toBe(1);
    expect(thread.team?.spawnCount).toBe(1);
  } finally {
    host.dispose();
  }
});
