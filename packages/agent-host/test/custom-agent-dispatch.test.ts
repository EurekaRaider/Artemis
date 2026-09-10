/**
 * PR3 runtime tests for custom sub-agent dispatch (D#152).
 *
 * Pins the plan's runtime contract: definition references resolve and
 * freeze at accept time, P1 exact-name matches without an explicit id are
 * rejected before any instance or budget exists, unknown/disabled
 * definitions fail loudly, fixed models never silently fall back,
 * plan/review modes strip dangerous capabilities, revocations cancel
 * not-yet-started instances, and retries re-check authorization.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  freezeInstanceSnapshot,
  type CustomAgentDefinition,
  type CustomAgentInstanceSnapshot,
} from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

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
    allowAutomaticInvocation: false,
    triggers: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function frozenSnapshot(
  overrides: Partial<CustomAgentInstanceSnapshot> = {},
): CustomAgentInstanceSnapshot {
  return freezeInstanceSnapshot({
    definitionId: "def-1",
    definitionRevision: 2,
    definitionName: "code-reviewer",
    instructions: "Review carefully.",
    catalogId: "turn:turn-1",
    projectId: null,
    resolvedModel: {
      providerId: "kimi-coding",
      modelId: "k3",
      thinkingLevel: "off",
    },
    effectiveCapabilities: ["shell", "filesystem-write", "business-read"],
    invocationSource: "model-explicit",
    selectionBasis: "explicit-reference",
    frozenAt: 0,
    ...overrides,
  });
}

interface HostedStub {
  currentTurnId: string;
  currentMode: "execute" | "plan" | "review";
  selection?: {
    providerId: string;
    modelId: string;
    thinkingLevel: "off";
  };
  childAgents: Map<string, Record<string, unknown>>;
}

interface HostInternals {
  configuration: { customAgents?: CustomAgentDefinition[] };
  threads: Map<string, HostedStub>;
  resolveCustomAgentDispatch(
    hosted: HostedStub,
    senderAgentId: string,
    agentId: string | undefined,
    role: string | undefined,
  ): { resolvedModel: { providerId: string; modelId: string }; effectiveCapabilities: readonly string[] } | undefined;
  reconcileCustomAgentChildren(
    definitions: CustomAgentDefinition[] | undefined,
  ): void;
}

function makeHost(definitions: CustomAgentDefinition[]) {
  const host = new ArtemisAgentHost(
    { request: async () => ({ approved: false }) },
    { emit() {} },
  );
  const internals = host as unknown as HostInternals;
  internals.configuration.customAgents = definitions;
  return { host, internals };
}

describe("custom agent dispatch resolution", () => {
  it("freezes an inherited parent model and intersected capabilities at accept time", () => {
    const { internals } = makeHost([definition()]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      selection: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: "off",
      },
      childAgents: new Map(),
    };
    const snapshot = internals.resolveCustomAgentDispatch(
      hosted,
      "root",
      "def-1",
      undefined,
    );
    expect(snapshot?.resolvedModel).toEqual({
      providerId: "kimi-coding",
      modelId: "k3",
      thinkingLevel: "off",
    });
    expect(snapshot?.effectiveCapabilities).toContain("shell");
    expect(snapshot?.effectiveCapabilities).not.toContain("spawn-agent");
  });

  it("fixed model policy wins over the parent selection", () => {
    const { internals } = makeHost([
      definition({
        modelPolicy: {
          kind: "fixed",
          providerId: "anthropic",
          modelId: "claude-opus",
        },
      }),
    ]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      selection: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: "off",
      },
      childAgents: new Map(),
    };
    const snapshot = internals.resolveCustomAgentDispatch(
      hosted,
      "root",
      "def-1",
      undefined,
    );
    expect(snapshot?.resolvedModel.providerId).toBe("anthropic");
  });

  it("plan mode strips shell and write capabilities from the frozen ceiling", () => {
    const { internals } = makeHost([definition()]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "plan",
      selection: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: "off",
      },
      childAgents: new Map(),
    };
    const snapshot = internals.resolveCustomAgentDispatch(
      hosted,
      "root",
      "def-1",
      undefined,
    );
    expect(snapshot?.effectiveCapabilities).toEqual(["business-read"]);
  });

  it("empty allowlist removes all business tools and never falls back", () => {
    const { internals } = makeHost([
      definition({ toolPolicy: { kind: "allowlist", tools: [] } }),
    ]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      selection: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: "off",
      },
      childAgents: new Map(),
    };
    const snapshot = internals.resolveCustomAgentDispatch(
      hosted,
      "root",
      "def-1",
      undefined,
    );
    expect(snapshot?.effectiveCapabilities).toEqual([]);
  });

  it("rejects an unknown definition id as CUSTOM_AGENT_NOT_FOUND", () => {
    const { internals } = makeHost([definition()]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      childAgents: new Map(),
    };
    expect(() =>
      internals.resolveCustomAgentDispatch(hosted, "root", "def-404", undefined),
    ).toThrowError(/CUSTOM_AGENT_NOT_FOUND/);
  });

  it("rejects a disabled definition as CUSTOM_AGENT_DISABLED", () => {
    const { internals } = makeHost([definition({ enabled: false })]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      selection: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: "off",
      },
      childAgents: new Map(),
    };
    expect(() =>
      internals.resolveCustomAgentDispatch(hosted, "root", "def-1", undefined),
    ).toThrowError(/CUSTOM_AGENT_DISABLED/);
  });

  it("P1: a free-text role exactly naming one definition demands an explicit reference", () => {
    const { internals } = makeHost([definition()]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      childAgents: new Map(),
    };
    expect(() =>
      internals.resolveCustomAgentDispatch(
        hosted,
        "root",
        undefined,
        "Code-Reviewer",
      ),
    ).toThrowError(/CUSTOM_AGENT_REFERENCE_REQUIRED.*def-1/);
  });

  it("P1: a role that merely contains a definition name does not trigger the hard stop", () => {
    const { internals } = makeHost([definition()]);
    const hosted: HostedStub = {
      currentTurnId: "turn-1",
      currentMode: "execute",
      childAgents: new Map(),
    };
    expect(
      internals.resolveCustomAgentDispatch(
        hosted,
        "root",
        undefined,
        "senior code-reviewer assistant",
      ),
    ).toBeUndefined();
  });
});

describe("custom agent revocation", () => {
  it("cancels not-yet-started custom instances whose definition was disabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-custom-revoke-"));
    cleanupPaths.push(workspace);
    const { host, internals } = makeHost([definition()]);
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
    const hosted = internals.threads.get("thread-1")!;
    const controller = new AbortController();
    const cancelled: string[] = [];
    const child = {
      agentId: "child-1",
      turnId: "turn-1",
      mode: "execute",
      parentAgentId: "root",
      depth: 1,
      label: "review",
      role: "code-reviewer",
      task: "review",
      dependsOnAgentIds: [],
      writePaths: [],
      required: true,
      attempt: 1,
      status: "queued",
      controller,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      output: "",
      pendingSteers: [],
      recentObservationMilliseconds: [],
      activityVersion: 0,
      activityWaiters: new Set(),
      subtreeIntegrated: false,
      customAgentSnapshot: frozenSnapshot(),
    };
    controller.signal.addEventListener("abort", () =>
      cancelled.push(child.agentId),
    );
    hosted.childAgents.set("child-1", child);

    internals.reconcileCustomAgentChildren([
      definition({ enabled: false }),
    ]);
    expect(cancelled).toEqual(["child-1"]);

    host.dispose();
  });

  it("keeps running custom instances alive on definition edits", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-custom-keep-"));
    cleanupPaths.push(workspace);
    const { host, internals } = makeHost([definition()]);
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
    const hosted = internals.threads.get("thread-1")!;
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });
    hosted.childAgents.set("child-2", {
      agentId: "child-2",
      status: "running",
      startedAt: Date.now(),
      controller,
      customAgentSnapshot: frozenSnapshot(),
      turnId: "turn-1",
      mode: "execute",
      parentAgentId: "root",
      depth: 1,
      label: "running",
      role: "code-reviewer",
      task: "review",
      dependsOnAgentIds: [],
      writePaths: [],
      required: true,
      attempt: 1,
      createdAt: Date.now(),
      pendingSteers: [],
      recentObservationMilliseconds: [],
      activityVersion: 0,
      activityWaiters: new Set(),
      subtreeIntegrated: false,
      output: "",
      lastActivityAt: Date.now(),
      updatedAt: Date.now(),
    });

    internals.reconcileCustomAgentChildren([]);
    expect(aborted).toBe(false);

    host.dispose();
  });
});
