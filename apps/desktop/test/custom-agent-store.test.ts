/**
 * PR2 regression tests for the custom sub-agent store (D#152).
 *
 * Exit criteria from the approved plan: old-database upgrade, deleting the
 * last project link never widens scope, project path migration keeps
 * identity-based links, worktree threads share project identity,
 * projectless tasks only see scope=all definitions, revision conflicts are
 * rejected, and invocation dedup records follow the contract state machine.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppStore } from "../src/main/store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function openStore(): Promise<AppStore> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-custom-agents-"));
  temporaryDirectories.push(directory);
  return new AppStore(join(directory, "state.sqlite"));
}

function makeProject(store: AppStore, path: string): string {
  const now = new Date().toISOString();
  const id = `project-${path.replace(/[^a-z]/g, "")}`;
  store.upsertProject({ id, name: path, path, createdAt: now, updatedAt: now });
  return id;
}

describe("custom agent store", () => {
  it("creates definitions with defaults and lists them ordered by name", async () => {
    const store = await openStore();
    const created = store.createCustomAgent({
      name: "Code-Reviewer",
      description: "Reviews changes",
      color: "green",
      instructions: "Be thorough.",
      scope: "all",
    });
    expect(created.revision).toBe(1);
    expect(created.enabled).toBe(true);
    expect(created.modelPolicy).toEqual({ kind: "inherit" });
    expect(created.toolPolicy).toEqual({ kind: "inherit" });
    expect(created.allowAutomaticInvocation).toBe(false);
    expect(store.listCustomAgents().map((a) => a.id)).toEqual([created.id]);
    store.close();
  });

  it("round-trips long Unicode instructions through create, update and disk reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-agent-long-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.sqlite");
    const store = new AppStore(path);
    const instructions = "中文😀\n".repeat(110000);
    const agent = store.createCustomAgent({
      name: "Long",
      description: "",
      color: "green",
      instructions,
      scope: "all",
    });
    expect(store.getCustomAgent(agent.id)?.instructions).toBe(instructions);
    store.updateCustomAgent(agent.id, agent.revision, {
      instructions: instructions + "END",
    });
    store.close();
    const reopened = new AppStore(path);
    expect(reopened.getCustomAgent(agent.id)?.instructions).toBe(
      instructions + "END",
    );
    reopened.close();
  });

  it("rejects duplicate names after normalization", async () => {
    const store = await openStore();
    store.createCustomAgent({
      name: "Code Reviewer",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    expect(() =>
      store.createCustomAgent({
        name: "  code   reviewer ",
        description: "",
        color: "blue",
        instructions: "",
        scope: "all",
      }),
    ).toThrow();
    store.close();
  });

  it("deleting the last project link never widens scope to all", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/alpha");
    const agent = store.createCustomAgent({
      name: "scoped",
      description: "",
      color: "green",
      instructions: "",
      scope: "selected",
      projectIds: [projectId],
    });
    expect(store.listEffectiveCustomAgents(projectId).map((a) => a.id)).toEqual(
      [agent.id],
    );

    // Remove the only link via an update.
    store.updateCustomAgent(agent.id, agent.revision, { projectIds: [] });
    expect(store.listEffectiveCustomAgents(projectId)).toEqual([]);
    expect(store.listEffectiveCustomAgents("other-project")).toEqual([]);
    // And the definition still exists with scope=selected.
    expect(store.getCustomAgent(agent.id)?.scope).toBe("selected");
    store.close();
  });

  it("hiding a project keeps links and never re-widens the definition", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/beta");
    const agent = store.createCustomAgent({
      name: "scoped-beta",
      description: "",
      color: "green",
      instructions: "",
      scope: "selected",
      projectIds: [projectId],
    });
    // Hiding a project is not deleting it: links must survive removal
    // from the sidebar so re-adding restores the association.
    store.removeProject(projectId);
    expect(store.listCustomAgentProjectIds(agent.id)).toEqual([projectId]);
    expect(store.getCustomAgent(agent.id)?.scope).toBe("selected");
    store.close();
  });

  it("links survive project path migration because identity is projectId", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/gamma");
    const agent = store.createCustomAgent({
      name: "scoped-gamma",
      description: "",
      color: "green",
      instructions: "",
      scope: "selected",
      projectIds: [projectId],
    });
    // Re-registering the same path (e.g. after a move back or a rescan)
    // keeps the same project identity, so the link is untouched.
    const now = new Date().toISOString();
    store.upsertProject({
      id: projectId,
      name: "/tmp/gamma",
      path: "/tmp/gamma",
      createdAt: now,
      updatedAt: now,
    });
    expect(store.getProject(projectId)?.path).toBe("/tmp/gamma");
    expect(store.listCustomAgentProjectIds(agent.id)).toEqual([projectId]);
    expect(store.listEffectiveCustomAgents(projectId).map((a) => a.id)).toEqual(
      [agent.id],
    );
    store.close();
  });

  it("projectless tasks only receive scope=all definitions", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/delta");
    store.createCustomAgent({
      name: "global",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    store.createCustomAgent({
      name: "scoped-delta",
      description: "",
      color: "green",
      instructions: "",
      scope: "selected",
      projectIds: [projectId],
    });
    const projectless = store.listEffectiveCustomAgents(null);
    expect(projectless.map((a) => a.name)).toEqual(["global"]);
    store.close();
  });

  it("revision conflicts are rejected without overwriting stored content", async () => {
    const store = await openStore();
    const agent = store.createCustomAgent({
      name: "versioned",
      description: "v1",
      color: "green",
      instructions: "original",
      scope: "all",
    });
    store.updateCustomAgent(agent.id, 1, { description: "v2" });
    expect(() =>
      store.updateCustomAgent(agent.id, 1, { description: "stale write" }),
    ).toThrowError(/CUSTOM_AGENT_REVISION_CONFLICT/);
    expect(store.getCustomAgent(agent.id)?.description).toBe("v2");
    expect(store.getCustomAgent(agent.id)?.revision).toBe(2);
    store.close();
  });

  it("deleting a definition cascades links but invocation history survives", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/epsilon");
    const now = new Date().toISOString();
    store.createThread({
      id: "thread-1",
      projectId,
      title: "t",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const agent = store.createCustomAgent({
      name: "doomed",
      description: "",
      color: "green",
      instructions: "",
      scope: "selected",
      projectIds: [projectId],
    });
    store.upsertCustomAgentInvocation({
      threadId: "thread-1",
      invocationId: "inv-1",
      requestFingerprint: "fp-1",
      definitionId: agent.id,
      definitionRevision: agent.revision,
      definitionName: agent.name,
      turnId: "turn-1",
      instanceId: null,
      status: "pending",
    });
    store.deleteCustomAgent(agent.id);
    expect(store.getCustomAgent(agent.id)).toBeUndefined();
    const history = store.getCustomAgentInvocation("thread-1", "inv-1");
    expect(history?.definitionId).toBe(agent.id);
    expect(history?.definitionName).toBe("doomed");
    store.close();
  });

  it("invocation upsert is idempotent per (threadId, invocationId)", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/zeta");
    const now = new Date().toISOString();
    store.createThread({
      id: "thread-2",
      projectId,
      title: "t",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const agent = store.createCustomAgent({
      name: "dup",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    const base = {
      threadId: "thread-2",
      invocationId: "inv-dup",
      requestFingerprint: "fp-x",
      definitionId: agent.id,
      definitionRevision: 1,
      definitionName: "dup",
      turnId: null,
      instanceId: null,
      status: "pending" as const,
    };
    const first = store.upsertCustomAgentInvocation(base);
    const second = store.upsertCustomAgentInvocation(base);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    // Same id with different content is a conflict, never a silent rebind.
    expect(() =>
      store.upsertCustomAgentInvocation({
        ...base,
        requestFingerprint: "fp-y",
      }),
    ).toThrowError(/INVOCATION_CONFLICT/);
    store.close();
  });

  it("invocation status transitions follow the contract state machine", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/eta");
    const now = new Date().toISOString();
    store.createThread({
      id: "thread-3",
      projectId,
      title: "t",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const agent = store.createCustomAgent({
      name: "sm",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    store.upsertCustomAgentInvocation({
      threadId: "thread-3",
      invocationId: "inv-sm",
      requestFingerprint: "fp",
      definitionId: agent.id,
      definitionRevision: 1,
      definitionName: "sm",
      turnId: null,
      instanceId: null,
      status: "pending",
    });
    const committed = store.transitionCustomAgentInvocation(
      "thread-3",
      "inv-sm",
      "dispatch-committed",
      { turnId: "turn-9", instanceId: "inst-9" },
    );
    expect(committed.status).toBe("dispatch-committed");
    expect(committed.instanceId).toBe("inst-9");
    // outcome-unknown never returns to an executable state.
    const unknown = store.transitionCustomAgentInvocation(
      "thread-3",
      "inv-sm",
      "outcome-unknown",
    );
    expect(unknown.status).toBe("outcome-unknown");
    expect(() =>
      store.transitionCustomAgentInvocation("thread-3", "inv-sm", "pending"),
    ).toThrowError(/INVOCATION_ILLEGAL_TRANSITION/);
    store.close();
  });

  it("migrates an old (pre-v13) database to the new schema on open", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-custom-agents-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.sqlite");
    // First open creates the current schema; downgrade the version marker to
    // simulate an older binary's database, then reopen.
    const first = new AppStore(databasePath);
    first.close();
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(databasePath);
    raw.exec("PRAGMA user_version = 12");
    raw.exec("DROP TABLE IF EXISTS custom_agents");
    raw.exec("DROP TABLE IF EXISTS custom_agent_projects");
    raw.exec("DROP TABLE IF EXISTS custom_agent_invocations");
    raw.close();
    const reopened = new AppStore(databasePath);
    const agent = reopened.createCustomAgent({
      name: "migrated",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    expect(reopened.getCustomAgent(agent.id)?.name).toBe("migrated");
    reopened.close();
  });

  it("binds an invocation instance exactly once while committed", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/bind");
    const now = new Date().toISOString();
    store.createThread({
      id: "thread-bind",
      projectId,
      title: "t",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const agent = store.createCustomAgent({
      name: "binder",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    store.upsertCustomAgentInvocation({
      threadId: "thread-bind",
      invocationId: "inv-bind",
      requestFingerprint: "fp",
      definitionId: agent.id,
      definitionRevision: 1,
      definitionName: "binder",
      turnId: null,
      instanceId: null,
      status: "pending",
    });
    // Pending records are not bound yet — only committed dispatches bind.
    store.bindCustomAgentInvocationInstance(
      "thread-bind",
      "inv-bind",
      "instance-a",
    );
    expect(
      store.getCustomAgentInvocation("thread-bind", "inv-bind")?.instanceId,
    ).toBeNull();
    store.transitionCustomAgentInvocation(
      "thread-bind",
      "inv-bind",
      "dispatch-committed",
      { turnId: "turn-1" },
    );
    store.bindCustomAgentInvocationInstance(
      "thread-bind",
      "inv-bind",
      "instance-a",
    );
    // A second bind never rewrites the first.
    store.bindCustomAgentInvocationInstance(
      "thread-bind",
      "inv-bind",
      "instance-b",
    );
    const bound = store.getCustomAgentInvocation("thread-bind", "inv-bind");
    expect(bound?.instanceId).toBe("instance-a");
    expect(bound?.turnId).toBe("turn-1");
    expect(
      store.listCustomAgentInvocationsForThread("thread-bind"),
    ).toHaveLength(1);
    store.close();
  });

  it("boot sweep marks stale pending invocations outcome-unknown only", async () => {
    const store = await openStore();
    const projectId = makeProject(store, "/tmp/sweep");
    const now = new Date().toISOString();
    store.createThread({
      id: "thread-sweep",
      projectId,
      title: "t",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const agent = store.createCustomAgent({
      name: "swept",
      description: "",
      color: "green",
      instructions: "",
      scope: "all",
    });
    const base = {
      threadId: "thread-sweep",
      requestFingerprint: "fp",
      definitionId: agent.id,
      definitionRevision: 1,
      definitionName: "swept",
      turnId: null,
      instanceId: null,
    };
    store.upsertCustomAgentInvocation({
      ...base,
      invocationId: "inv-pending",
      status: "pending",
    });
    store.upsertCustomAgentInvocation({
      ...base,
      invocationId: "inv-committed",
      status: "pending",
    });
    store.transitionCustomAgentInvocation(
      "thread-sweep",
      "inv-committed",
      "dispatch-committed",
      { turnId: "turn-9" },
    );
    expect(store.markStalePendingCustomAgentInvocations()).toBe(1);
    expect(
      store.getCustomAgentInvocation("thread-sweep", "inv-pending")?.status,
    ).toBe("outcome-unknown");
    // Committed records survive the sweep untouched.
    expect(
      store.getCustomAgentInvocation("thread-sweep", "inv-committed")?.status,
    ).toBe("dispatch-committed");
    expect(store.markStalePendingCustomAgentInvocations()).toBe(0);
    store.close();
  });
});

it("does not persist dedicated instructions in turn recovery checkpoints", async () => {
  const store = await openStore();
  const projectId = makeProject(store, "/tmp/checkpoint");
  const now = new Date().toISOString();
  store.createThread({
    id: "checkpoint-thread",
    projectId,
    title: "t",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  const definition = store.createCustomAgent({
    name: "private",
    description: "",
    color: "green",
    instructions: "private dedicated instructions",
    scope: "all",
  });
  store.saveTurnCheckpoint({
    threadId: "checkpoint-thread",
    turnId: "turn-1",
    text: "review",
    mode: "execute",
    customAgents: [definition],
  });
  const checkpoint = store.getTurnCheckpoint("checkpoint-thread");
  expect(JSON.stringify(checkpoint)).not.toContain(definition.instructions);
  expect(checkpoint?.customAgents).toEqual([]);
  expect(store.getCustomAgent(definition.id)?.instructions).toBe(
    definition.instructions,
  );
  store.close();
});
