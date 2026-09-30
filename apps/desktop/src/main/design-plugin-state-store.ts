// S2 design-plugin state transactions (proposal §6.1, §8).
//
// CAS state-head advance + snapshot/event atomic commit, layered on the
// AppStore six-table schema. `commitPluginStateChange` wraps snapshot insert,
// head advance and event append in one BEGIN IMMEDIATE transaction so the
// three rows are always visible together or not at all. The head advance is
// compare-and-swap: a writer that lost the race gets a typed conflict error
// and must reload + retry instead of overwriting.

import { randomUUID } from "node:crypto";

/** CAS race detected: the head moved since the writer read it. */
export class PluginStateConflictError extends Error {
  constructor(
    readonly threadId: string,
    readonly pluginId: string,
    readonly expectedRevision: string,
    readonly actualRevision: string,
  ) {
    super(
      `Plugin state head conflict for ${pluginId} on ${threadId}: expected state revision ${expectedRevision} but found ${actualRevision}.`,
    );
    this.name = "PluginStateConflictError";
  }
}

export interface PluginStateChangeInput {
  threadId: string;
  pluginId: string;
  /** Head revision the writer based its change on (CAS guard). */
  expectedStateRevision: string;
  bindingRevision: string;
  stateSchemaVersion: number;
  /** Next state revision; must differ from expected. */
  nextStateRevision: string;
  snapshot: {
    files: Array<{ path: string; hash: string }>;
    parentSnapshotId?: string;
    createdByOperationId?: string;
    packageRevision: string;
  };
  event: {
    streamId: string;
    schemaVersion: number;
    payload: Record<string, unknown>;
  };
}

export interface PluginStateChangeResult {
  snapshotId: string;
  eventId: string;
  stateRevision: string;
}

export interface PluginStateTransactionStore {
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
  insertPluginSnapshot(snapshot: {
    snapshotId: string;
    threadId: string;
    pluginId: string;
    files: Array<{ path: string; hash: string }>;
    parentSnapshotId?: string;
    createdByOperationId?: string;
    packageRevision: string;
  }): void;
  appendPluginEvent(event: {
    eventId: string;
    streamId: string;
    threadId: string;
    schemaVersion: number;
    payload: Record<string, unknown>;
  }): void;
  upsertPluginStateHead(input: {
    threadId: string;
    pluginId: string;
    stateSchemaVersion: number;
    bindingRevision: string;
    stateRevision: string;
    snapshotId: string;
  }): void;
  commitPluginStateTransaction<T>(work: () => T): T;
}

/**
 * Read-modify-write one plugin state change under CAS + one transaction.
 *
 * The AppStore supplies `commitPluginStateTransaction` which runs the work
 * callback inside BEGIN IMMEDIATE / COMMIT with rollback on throw; SQLite
 * IMMEDIATE takes the write lock at BEGIN so two racing writers serialize,
 * and the second one observes the advanced revision and fails the CAS check.
 */
export function commitPluginStateChange(
  store: PluginStateTransactionStore,
  input: PluginStateChangeInput,
): PluginStateChangeResult {
  return store.commitPluginStateTransaction(() => {
    if (input.nextStateRevision === input.expectedStateRevision) {
      throw new Error(
        "Plugin state revision must advance; refusing a no-op state write.",
      );
    }
    const head = store.readPluginStateHead({
      threadId: input.threadId,
      pluginId: input.pluginId,
      stateSchemaVersion: input.stateSchemaVersion,
    });
    if (head && head.stateRevision !== input.expectedStateRevision) {
      throw new PluginStateConflictError(
        input.threadId,
        input.pluginId,
        input.expectedStateRevision,
        head.stateRevision,
      );
    }
    const snapshotId = randomUUID();
    store.insertPluginSnapshot({
      snapshotId,
      threadId: input.threadId,
      pluginId: input.pluginId,
      files: input.snapshot.files,
      ...(input.snapshot.parentSnapshotId
        ? { parentSnapshotId: input.snapshot.parentSnapshotId }
        : {}),
      ...(input.snapshot.createdByOperationId
        ? { createdByOperationId: input.snapshot.createdByOperationId }
        : {}),
      packageRevision: input.snapshot.packageRevision,
    });
    store.upsertPluginStateHead({
      threadId: input.threadId,
      pluginId: input.pluginId,
      stateSchemaVersion: input.stateSchemaVersion,
      bindingRevision: input.bindingRevision,
      stateRevision: input.nextStateRevision,
      snapshotId,
    });
    const eventId = randomUUID();
    store.appendPluginEvent({
      eventId,
      streamId: input.event.streamId,
      threadId: input.threadId,
      schemaVersion: input.event.schemaVersion,
      payload: input.event.payload,
    });
    return { snapshotId, eventId, stateRevision: input.nextStateRevision };
  });
}
