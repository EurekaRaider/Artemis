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
import { isExecutionMode, type RunMode } from "@artemis/protocol";
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
      | "plugin-unavailable"
      | "revision-missing"
      | "content-hash-mismatch"
      | "grant-missing"
      | "grant-revoked"
      | "mode-denied"
      | "tool-not-declared"
      | "operation-conflict"
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
  mode: RunMode;
  /** Deduplication identity for idempotent operation recording. */
  operationId?: string;
}

export interface DispatchPluginToolStore {
  getThread(threadId: string): unknown;
  listPluginGrants(scopeId: string): Array<Record<string, unknown>>;
  recordPluginOperation(operation: {
    operationId: string;
    threadId: string;
    pluginId: string;
    toolName: string;
    requestDigest: string;
    state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
    resultRef?: string;
    result?: unknown;
    error?: string;
  }): void;
  /** PR#245 P2-12：执行前读取既有操作，做重放判定。 */
  readPluginOperation(operationId: string):
    | {
        threadId: string;
        pluginId: string;
        toolName: string;
        state: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
        requestDigest: string;
        resultRef?: string;
        result?: unknown;
        error?: string;
      }
    | undefined;
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
  windowsHelperPath?: string | undefined;
  store: DispatchPluginToolStore;
  revisionsRoot: string;
  scratchRoot: string;
  /**
   * Fired after an artifact-write tool commits state (apply_edit, undo,
   * redo, restore_version). The panel host uses this to push a fresh
   * snapshot so open panels refresh to the new head automatically.
   */
  onArtifactWrite?: (input: { threadId: string; toolName: string }) => void;
  /**
   * Host-side workspace write (ledger retirement): the runtime worker is
   * sandboxed to its scratch dir and cannot touch the workspace, so the
   * path-based write/edit tools are executed by the HOST through this
   * callback (containment + thin snapshots live there). Returning a string
   * error reports failure to the model.
   */
  writeWorkspacePage?: (input: {
    threadId: string;
    path: string;
    content: string;
    find?: string;
  }) => Promise<
    | { ok: true; path: string; bytes: number; revision?: string }
    | { ok: false; error: string }
  >;
  /**
   * Host-side version ops on the thin-snapshot store (undo/redo/restore/
   * list). Executed host-side for the same sandbox reason as
   * writeWorkspacePage. undo/redo/restore additionally write the workspace
   * file and enforce the Plan gate in the host implementation.
   */
  designVersionOp?: (input: {
    threadId: string;
    toolName: "undo" | "redo" | "restore_version" | "list_versions";
    path: string;
    revision?: string;
  }) => Promise<{ ok: true; result: string } | { ok: false; error: string }>;
  /**
   * Unavailability gate: a non-null reason refuses the tool call before
   * the trust chain runs. The design plugin's removal sets this — a bound
   * revision surviving on disk must not keep a removed plugin usable.
   */
  availabilityGate?: (input: { threadId: string }) => Promise<string | null>;
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
  let disposed = false;

  const managerFor = (threadId: string): ThreadRuntimeManager => {
    if (disposed) throw new Error("Plugin dispatch has stopped");
    let manager = managers.get(threadId);
    if (!manager) {
      manager = new ThreadRuntimeManager({
        threadId,
        windowsHelperPath: host.windowsHelperPath,
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
    if (disposed)
      return { status: "refused", error: "Plugin dispatch has stopped" };
    const store = host.store;
    let thread = store.getThread(input.threadId) as
      | {
          mode?: RunMode;
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
      return refuse(
        store,
        input,
        "no-type-binding",
        "thread has no type binding",
      );
    }
    if (thread.archived) {
      return refuse(store, input, "plugin-unavailable", "thread is archived");
    }

    // Step 0: the plugin itself must still be installed. A surviving bound
    // revision on disk does not keep a removed plugin callable.
    if (host.availabilityGate) {
      const unavailable = await host.availabilityGate({
        threadId: input.threadId,
      });
      if (unavailable)
        return refuse(store, input, "plugin-unavailable", unavailable);
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
    const actualHash =
      await PluginRevisionStore.computeContentHash(revisionRoot);
    if (actualHash !== binding.contentHash) {
      return refuse(
        store,
        input,
        "content-hash-mismatch",
        `binding hash ${binding.contentHash} but revision on disk hashes to ${actualHash}`,
      );
    }

    // Hashing and availability checks yield. Re-read the current task before
    // starting a worker so an archive, mode change or rebind cannot race them.
    const current = store.getThread(input.threadId) as
      typeof thread | undefined;
    if (
      !current ||
      current.archived ||
      current.typeBinding?.contentHash !== binding.contentHash ||
      current.typeBinding?.bindingRevision !== binding.bindingRevision
    ) {
      return refuse(
        store,
        input,
        "plugin-unavailable",
        "thread or plugin binding changed during dispatch",
      );
    }
    thread = current;

    // Trust chain step 2: unrevoked grant for this installation+thread.
    const grants = store.listPluginGrants(input.threadId);
    const matching = grants.filter(
      (grant) =>
        grant.installation_id === binding.installationId &&
        grant.plugin_id === binding.pluginId &&
        grant.content_hash === binding.contentHash &&
        grant.grant_revision === binding.bindingRevision,
    );
    if (matching.length === 0) {
      return refuse(
        store,
        input,
        "grant-missing",
        "no plugin grant for this thread",
      );
    }
    if (matching.every((grant) => grant.revoked_at != null)) {
      return refuse(store, input, "grant-revoked", "all grants are revoked");
    }

    // Profile/mode gate: plugin runtimes only run in execution modes
    // (work/codemode, PR#245 P1-7). Both the caller-supplied mode AND the
    // persisted task mode are checked: an execution-mode claim from a Plan
    // task must not reach a filesystem-writing runtime.
    if (!isExecutionMode(input.mode)) {
      return refuse(
        store,
        input,
        "mode-denied",
        `mode ${input.mode} may not run plugin tools`,
      );
    }
    if (!isExecutionMode(thread.mode)) {
      return refuse(
        store,
        input,
        "mode-denied",
        `persisted task mode is ${thread.mode ?? "unknown"}; plugin tools require an execution mode`,
      );
    }

    // The tool must be declared by the published manifest.
    const declared = published.tools.find(
      (tool) => tool.name === input.toolName,
    );
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
    // PR#245 P2-12：重放判定。同 operationId 的重复请求不得再次执行——
    // 已成功直接取回已存结果；进行中/失败/取消的既有操作原样返回状态，
    // 调用方按非 succeeded 处理；digest 冲突（同 ID 不同参数）拒绝。
    const prior = store.readPluginOperation(operationId);
    if (prior) {
      if (
        prior.requestDigest !== requestDigest ||
        prior.threadId !== input.threadId ||
        prior.pluginId !== binding.pluginId ||
        prior.toolName !== input.toolName
      ) {
        return refuse(
          store,
          input,
          "operation-conflict",
          `operation ${operationId} already exists with a different request digest`,
        );
      }
      if (prior.state === "succeeded") {
        return prior.result === undefined
          ? {
              status: "failed",
              error:
                "Stored operation result is unavailable; the operation was not repeated.",
            }
          : { status: "succeeded", result: prior.result };
      }
      return {
        status: prior.state,
        error:
          prior.error ??
          `operation ${operationId} already exists in state ${prior.state}; not re-executed`,
      };
    }
    store.recordPluginOperation({
      operationId,
      threadId: input.threadId,
      pluginId: binding.pluginId,
      toolName: input.toolName,
      requestDigest,
      state: "running",
    });

    // 托管账本退役：路径化写入工具由宿主直接执行（runtime 沙箱只写
    // scratch，碰不到工作区）。失败按 runtime 失败同语义传播。
    const versionOps = new Set([
      "undo",
      "redo",
      "restore_version",
      "list_versions",
    ]);
    if (
      (input.toolName === "write_page" || input.toolName === "apply_edit") &&
      host.writeWorkspacePage
    ) {
      const args = (input.args ?? {}) as {
        path?: unknown;
        content?: unknown;
        find?: unknown;
      };
      const outcome = await host.writeWorkspacePage({
        threadId: input.threadId,
        path: String(args.path ?? ""),
        content: String(args.content ?? ""),
        ...(input.toolName === "apply_edit"
          ? { find: String(args.find ?? "") }
          : {}),
      });
      if (!outcome.ok) {
        store.recordPluginOperation({
          operationId,
          threadId: input.threadId,
          pluginId: binding.pluginId,
          toolName: input.toolName,
          requestDigest,
          state: "failed",
          error: outcome.error,
        });
        return { status: "failed", error: outcome.error };
      }
      store.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: binding.pluginId,
        toolName: input.toolName,
        requestDigest,
        state: "succeeded",
        resultRef: `op://${operationId}`,
      });
      store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/${binding.pluginId}`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "tool-succeeded",
          operationId,
          toolName: input.toolName,
          path: outcome.path,
        },
      });
      host.onArtifactWrite?.({
        threadId: input.threadId,
        toolName: input.toolName,
      });
      return {
        status: "succeeded",
        result: JSON.stringify({
          path: outcome.path,
          bytes: outcome.bytes,
        }),
      };
    }

    if (versionOps.has(input.toolName) && host.designVersionOp) {
      const args = (input.args ?? {}) as {
        path?: unknown;
        revision?: unknown;
      };
      const outcome = await host.designVersionOp({
        threadId: input.threadId,
        toolName: input.toolName as
          | "undo"
          | "redo"
          | "restore_version"
          | "list_versions",
        path: String(args.path ?? ""),
        ...(typeof args.revision === "string"
          ? { revision: args.revision }
          : {}),
      });
      if (!outcome.ok) {
        store.recordPluginOperation({
          operationId,
          threadId: input.threadId,
          pluginId: binding.pluginId,
          toolName: input.toolName,
          requestDigest,
          state: "failed",
          error: outcome.error,
        });
        return { status: "failed", error: outcome.error };
      }
      store.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: binding.pluginId,
        toolName: input.toolName,
        requestDigest,
        state: "succeeded",
        resultRef: `op://${operationId}`,
      });
      host.onArtifactWrite?.({
        threadId: input.threadId,
        toolName: input.toolName,
      });
      return { status: "succeeded", result: outcome.result };
    }

    try {
      const manager = managerFor(input.threadId);
      const result = (await manager.invoke({
        entry: published.runtimeEntry,
        pluginId: binding.pluginId,
        contentHash: binding.contentHash,
        toolName: input.toolName,
        args: input.args,
      })) as { status?: string; error?: string } | undefined;

      // PR#245 P2-11：runtime 以返回值（而非异常）报告失败时必须传播——
      // 失败不记录 succeeded、不推进状态提交、不追加成功事件、不触发
      // 产物刷新。
      const runtimeStatus =
        typeof result?.status === "string" ? result.status : "succeeded";
      if (runtimeStatus !== "succeeded") {
        const runtimeError =
          (typeof result?.error === "string" && result.error) ||
          `runtime reported status ${runtimeStatus}`;
        store.recordPluginOperation({
          operationId,
          threadId: input.threadId,
          pluginId: binding.pluginId,
          toolName: input.toolName,
          requestDigest,
          state: "failed",
          error: runtimeError,
        });
        store.appendPluginEvent({
          eventId: randomUUID(),
          streamId: `thread/${input.threadId}/${binding.pluginId}`,
          threadId: input.threadId,
          schemaVersion: 1,
          payload: {
            kind: "tool-failed",
            operationId,
            toolName: input.toolName,
            error: runtimeError,
          },
        });
        return { status: "failed", error: runtimeError };
      }

      const commitOperation = () => {
        store.recordPluginOperation({
          operationId,
          threadId: input.threadId,
          pluginId: binding.pluginId,
          toolName: input.toolName,
          requestDigest,
          state: "succeeded",
          resultRef: `op://${operationId}`,
          result,
        });
      };
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
        commitPluginStateChange(
          store,
          {
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
          },
          commitOperation,
        );
        try {
          host.onArtifactWrite?.({
            threadId: input.threadId,
            toolName: input.toolName,
          });
        } catch {
          // Panel refresh is best-effort; never fail the tool result for it.
        }
      } else {
        store.commitPluginStateTransaction(() => {
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
          commitOperation();
        });
      }

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

  function dispose(): void {
    disposed = true;
    for (const manager of managers.values()) manager.dispose();
    managers.clear();
  }
  return { dispatch, closeThread, dispose, revisionStore };
}

export type PluginDispatch = ReturnType<typeof createDispatchPluginTool>;
