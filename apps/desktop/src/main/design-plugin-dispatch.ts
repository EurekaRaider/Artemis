// S2 design-plugin trusted dispatch (proposal §7 trust chain, §8 runtime).
//
// The single main-process entry that executes a plugin tool call:
//   1. resolve the thread's typeBinding,
//   2. recompute the published revision's manifest hash from disk
//      (PluginRevisionStore.computeContentHash — trust nothing cached),
//   3. require an unrevoked plugin_grants row for this installation,
//   4. verify the runtime session is allowed in the current run mode,
//   5. dispatch through the thread's ThreadRuntimeManager (sandbox-probed,
//      lifecycle-bound worker),
//   6. record the operation idempotently and commit state atomically.
//
// Every refusal path writes a plugin_events row with kind "dispatch-refused"
// so §13.1 has an auditable trail.

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { PluginRevisionStore } from "./design-plugin-revision-store.js";
import {
  ThreadRuntimeManager,
  SandboxUnavailableError,
} from "./design-plugin-thread-runtime.js";
import { commitPluginStateChange } from "./design-plugin-state-store.js";

/** Typed refusal so callers (and tests) can branch on the reason. */
export class PluginDispatchRefusedError extends Error {
  constructor(
    readonly code:
      | "no-type-binding"
      | "revision-missing"
      | "content-hash-mismatch"
      | "grant-missing"
      | "grant-revoked"
      | "mode-denied"
      | "tool-not-declared"
      | "sandbox-unavailable",
    message: string,
  ) {
    super(`Plugin tool dispatch refused (${code}): ${message}`);
    this.name = "PluginDispatchRefusedError";
  }
}

export interface DispatchPluginToolInput {
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Current run mode of the session issuing the call. */
  mode: "plan" | "execute" | "review";
  /** Deduplication identity for idempotent operation recording. */
  operationId?: string;
}

export interface DispatchPluginToolStore {
  getThread(
    threadId: string,
  ): unknown;
  listPluginGrants(scopeId: string): Array<Record<string, unknown>>;
  recordPluginOperation(operation: {
    operationId: string;
    threadId: string;
    pluginId: string;
    toolName: string;
    requestDigest: string;
    state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
    resultRef?: string;
    error?: string;
  }): void;
  appendPluginEvent(event: {
    eventId: string;
    streamId: string;
    threadId: string;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }): void;
  readPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
  }):
    | {
        stateRevision: string;
        snapshotId: string;
        bindingRevision: string;
        updatedAt: string;
      }
    | undefined;
  upsertPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
    bindingRevision: string;
    stateRevision: string;
    snapshotId: string;
  }): void;
  insertPluginSnapshot(snapshot: {
    snapshotId: string;
    threadId: string;
    pluginId: string;
    files: Array<{ path: string; hash: string }>;
    parentSnapshotId?: string;
    createdByOperationId?: string;
    packageRevision: string;
  }): void;
  commitPluginStateTransaction<T>(work: () => T): T;
}

export interface PluginDispatchHost {
  store: DispatchPluginToolStore;
  revisionsRoot: string;
  scratchRoot: string;
  /**
   * Fired after an artifact-write tool commits state (apply_edit, undo,
   * redo, restore_version). The panel host uses this to push a fresh
   * snapshot so open panels refresh to the new head automatically.
   */
  onArtifactWrite?: (input: { threadId: string; toolName: string }) => void;
  /** Manifest tool declarations, resolved from the published revision. */
  loadPublishedManifest(input: {
    installationId: string;
    contentHash: string;
  }): Promise<
    | {
        tools: Array<{ name: string; effect: string }>;
        runtimeEntry: string;
        revisionRoot: string;
      }
    | undefined
  >;
}

export function createDispatchPluginTool(host: PluginDispatchHost) {
  const revisionStore = new PluginRevisionStore(host.revisionsRoot);
  const managers = new Map<string, ThreadRuntimeManager>();

  const managerFor = (threadId: string): ThreadRuntimeManager => {
    let manager = managers.get(threadId);
    if (!manager) {
      manager = new ThreadRuntimeManager({
        threadId,
        scratchRoot: host.scratchRoot,
        revisionsRoot: host.revisionsRoot,
      });
      managers.set(threadId, manager);
    }
    return manager;
  };

  async function dispatch(
    input: DispatchPluginToolInput,
  ): Promise<{ status: string; result?: unknown; error?: string }> {
    const store = host.store;
    const thread = store.getThread(input.threadId) as
      | {
          typeBinding?: {
            installationId: string;
            pluginId: string;
            typeId: string;
            contentHash: string;
            bindingRevision: string;
            pluginVersion: string;
          };
          executionProfile?: string;
          archived: boolean;
        }
      | undefined;
    const binding = thread?.typeBinding;
    if (!thread || !binding) {
      return refuse(store, input, "no-type-binding", "thread has no type binding");
    }

    // Trust chain step 1: the revision directory must exist and its
    // recomputed manifest hash must equal the frozen binding hash.
    const revisionRoot = join(
      host.revisionsRoot,
      binding.installationId,
      binding.contentHash,
    );
    const published = await host.loadPublishedManifest({
      installationId: binding.installationId,
      contentHash: binding.contentHash,
    });
    if (!published) {
      return refuse(
        store,
        input,
        "revision-missing",
        `no published revision at ${revisionRoot}`,
      );
    }
    const actualHash = await PluginRevisionStore.computeContentHash(revisionRoot);
    if (actualHash !== binding.contentHash) {
      return refuse(
        store,
        input,
        "content-hash-mismatch",
        `binding hash ${binding.contentHash} but revision on disk hashes to ${actualHash}`,
      );
    }

    // Trust chain step 2: unrevoked grant for this installation+thread.
    const grants = store.listPluginGrants(input.threadId);
    const matching = grants.filter(
      (grant) => grant.installation_id === binding.installationId,
    );
    if (matching.length === 0) {
      return refuse(store, input, "grant-missing", "no plugin grant for this thread");
    }
    if (matching.every((grant) => grant.revoked_at != null)) {
      return refuse(store, input, "grant-revoked", "all grants are revoked");
    }

    // Profile/mode gate: plugin runtimes only run in execute mode.
    if (input.mode !== "execute") {
      return refuse(
        store,
        input,
        "mode-denied",
        `mode ${input.mode} may not run plugin tools`,
      );
    }

    // The tool must be declared by the published manifest.
    const declared = published.tools.find((tool) => tool.name === input.toolName);
    if (!declared) {
      return refuse(
        store,
        input,
        "tool-not-declared",
        `tool ${input.toolName} is not declared by the published manifest`,
      );
    }

    const operationId = input.operationId ?? randomUUID();
    const requestDigest = `${actualHash}:${input.toolName}:${JSON.stringify(input.args)}`;
    store.recordPluginOperation({
      operationId,
      threadId: input.threadId,
      pluginId: binding.pluginId,
      toolName: input.toolName,
      requestDigest,
      state: "running",
    });

    try {
      const manager = managerFor(input.threadId);
      const result = (await manager.invoke({
        entry: published.runtimeEntry,
        pluginId: binding.pluginId,
        contentHash: binding.contentHash,
        toolName: input.toolName,
        args: input.args,
      })) as { status?: string } | undefined;

      store.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: binding.pluginId,
        toolName: input.toolName,
        requestDigest,
        state: "succeeded",
        resultRef: `op://${operationId}`,
      });

      // State commit for artifact-writing tools (CAS + atomic).
      if (declared.effect === "artifact-write") {
        const head = store.readPluginStateHead({
          threadId: input.threadId,
          pluginId: binding.pluginId,
          stateSchemaVersion: 1,
        });
        const nextStateRevision = `state-${randomUUID()}`;
        if (head && head.stateRevision === nextStateRevision) {
          throw new Error("State revision collision; refusing.");
        }
        commitPluginStateChange(store, {
          threadId: input.threadId,
          pluginId: binding.pluginId,
          expectedStateRevision: head?.stateRevision ?? "none",
          bindingRevision: binding.bindingRevision,
          stateSchemaVersion: 1,
          nextStateRevision,
          snapshot: {
            files: [
              {
                path: "design-documents.jsonl",
                hash: actualHash,
              },
            ],
            createdByOperationId: operationId,
            packageRevision: binding.contentHash,
          },
          event: {
            streamId: `thread/${input.threadId}/${binding.pluginId}`,
            schemaVersion: 1,
            payload: {
              kind: "tool-succeeded",
              operationId,
              toolName: input.toolName,
            },
          },
        });
        try {
          host.onArtifactWrite?.({ threadId: input.threadId, toolName: input.toolName });
        } catch {
          // Panel refresh is best-effort; never fail the tool result for it.
        }
      }

      store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/${binding.pluginId}`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "tool-succeeded",
          operationId,
          toolName: input.toolName,
        },
      });
      return { status: "succeeded", result };
    } catch (error) {
      const isSandboxRefusal = error instanceof SandboxUnavailableError;
      store.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: binding.pluginId,
        toolName: input.toolName,
        requestDigest,
        state: "failed",
        error: String(error),
      });
      if (isSandboxRefusal) {
        return refuse(store, input, "sandbox-unavailable", String(error));
      }
      return { status: "failed", error: String(error) };
    }
  }

  function refuse(
    store: DispatchPluginToolStore,
    input: DispatchPluginToolInput,
    code: PluginDispatchRefusedError["code"],
    detail: string,
  ): { status: string; error: string } {
    store.appendPluginEvent({
      eventId: randomUUID(),
      streamId: `thread/${input.threadId}/dispatch`,
      threadId: input.threadId,
      schemaVersion: 1,
      payload: {
        kind: "dispatch-refused",
        code,
        toolName: input.toolName,
        detail,
      },
    });
    return { status: "refused", error: `${code}: ${detail}` };
  }

  /** Thread closed/archived: dispose its runtime manager. */
  function closeThread(threadId: string): number {
    const manager = managers.get(threadId);
    if (!manager) return 0;
    managers.delete(threadId);
    return manager.closeThread();
  }

  return { dispatch, closeThread, revisionStore };
}

export type PluginDispatch = ReturnType<typeof createDispatchPluginTool>;
