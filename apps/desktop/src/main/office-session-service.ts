import { randomUUID } from "node:crypto";
import { watchFile, unwatchFile } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  artifactOperationSchema,
  artifactSessionRequestSchema,
  artifactSnapshotSchema,
  type ArtifactEvent,
  type ArtifactOperation,
  type ArtifactSelection,
  type ArtifactSessionRequest,
  type ArtifactSnapshot,
  type RunMode,
} from "@artemis/protocol";
import { z } from "zod";
import { atomicWrite, fileSha256, sha256 } from "./office-file-utils.js";

export interface OfficeEngineSnapshot {
  targets: ArtifactSnapshot["targets"];
  sheets: string[];
  warnings: string[];
}
export interface OfficeEngine {
  version: string;
  open(
    path: string,
    format: "word" | "powerpoint" | "excel",
  ): Promise<OfficeEngineSnapshot>;
  apply(change: ArtifactOperation): Promise<void>;
  snapshot(): Promise<OfficeEngineSnapshot>;
  render(path: string): Promise<void>;
  save(path: string): Promise<void>;
  close(): Promise<void>;
}
export interface OfficeSessionContext {
  threadId: string;
  workspacePath: string;
  mode: RunMode;
}
const operationRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    baseVersion: z.number().int().nonnegative(),
    change: artifactOperationSchema,
  })
  .strict();
const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    threadId: z.string().min(1).max(200),
    workspace: z.string(),
    original: z.string(),
    baseline: z.string().regex(/^original\.(docx|xlsx|pptx)$/u),
    baselineHash: z.string().regex(/^[a-f0-9]{64}$/u),
    diskHash: z.string().regex(/^[a-f0-9]{64}$/u),
    snapshot: artifactSnapshotSchema,
    operations: z.array(operationRecordSchema).max(10_000),
    pending: operationRecordSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.operations.length === value.snapshot.session.version &&
      new Set(value.operations.map((op) => op.id)).size ===
        value.operations.length &&
      value.operations.every((op, index) => op.baseVersion === index),
  );
type Journal = z.infer<typeof journalSchema>;
interface LiveSession {
  journal: Journal;
  engine: OfficeEngine;
  directory: string;
  watcher?: { close(): void };
  externalTimer?: ReturnType<typeof setTimeout>;
  rendering?: Promise<void>;
}
interface OfficeSessionOptions {
  root: string;
  createEngine(): Promise<OfficeEngine>;
  emit(threadId: string, event: ArtifactEvent): void;
  /** Fail closed until the native compatibility gate accepts the imported file. */
  canSaveOriginal(
    path: string,
    format: ArtifactSessionRequest["format"],
  ): Promise<boolean>;
}

function selectionFor(change: ArtifactOperation): ArtifactSelection {
  if (change.type === "replace-text")
    return {
      kind: "paragraph",
      index: change.paragraph,
      start: change.start,
      end: change.start + change.text.length,
    };
  if (change.type === "set-object-text")
    return { kind: "object", page: change.page, index: change.object };
  const columnName = (column: number): string => {
    let name = "";
    for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    return name;
  };
  const start = `${columnName(change.column)}${change.row}`;
  const end =
    change.type === "set-cells"
      ? `${columnName(change.column + change.values[0]!.length - 1)}${change.row + change.values.length - 1}`
      : start;
  return {
    kind: "cells",
    sheet: change.sheet,
    range: start === end ? start : `${start}:${end}`,
  };
}

export class OfficeSessionService {
  private sessions = new Map<string, LiveSession>();
  private queues = new Map<string, Promise<unknown>>();
  private opening = new Map<string, Promise<ArtifactSnapshot>>();
  private disposed = false;

  constructor(private readonly options: OfficeSessionOptions) {}

  private directory(sessionId: string): string {
    return join(this.options.root, sha256(sessionId));
  }

  private async source(
    context: OfficeSessionContext,
    path: string,
  ): Promise<{ workspace: string; original: string }> {
    const workspace = await realpath(context.workspacePath);
    const original = await realpath(resolve(workspace, path));
    const local = relative(workspace, original);
    if (
      !local ||
      local === ".." ||
      local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(local)
    )
      throw new Error("Office document escapes its workspace");
    const info = await stat(original);
    if (!info.isFile() || info.size > 256 * 1024 * 1024)
      throw new Error("Office document is not a supported regular file");
    return { workspace, original };
  }

  private async persist(live: LiveSession): Promise<void> {
    await this.writeJournal(live.directory, live.journal);
  }

  private async writeJournal(
    directory: string,
    journal: Journal,
  ): Promise<void> {
    const bytes = JSON.stringify(journal);
    if (Buffer.byteLength(bytes) > 32 * 1024 * 1024)
      throw new Error(
        "Office recovery log exceeds limit; preserve this draft before starting another session",
      );
    await atomicWrite(join(directory, "session.json"), bytes);
  }

  private async publish(
    live: LiveSession,
    kind: ArtifactEvent["kind"],
    extra: Pick<ArtifactEvent, "operationId" | "selection"> = {},
  ): Promise<void> {
    live.journal.snapshot.session.sequence++;
    await this.persist(live);
    this.options.emit(live.journal.threadId, {
      protocolVersion: 1,
      eventId: randomUUID(),
      kind,
      session: structuredClone(live.journal.snapshot.session),
      ...extra,
    });
  }

  private serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.queues.set(key, result);
    void result
      .finally(() => {
        if (this.queues.get(key) === result) this.queues.delete(key);
      })
      .catch(() => undefined);
    return result;
  }

  async execute(
    input: ArtifactSessionRequest,
    context: OfficeSessionContext,
  ): Promise<ArtifactSnapshot> {
    // This precedes schema-dependent paths, storage, engine construction and recovery.
    if (context.mode !== "execute")
      throw new Error(`${context.mode} mode rejects Office sessions`);
    if (this.disposed) throw new Error("Office session host is closed");
    const request = artifactSessionRequestSchema.parse(input);
    const expected = { word: ".docx", excel: ".xlsx", powerpoint: ".pptx" }[
      request.format
    ];
    if (extname(request.path).toLowerCase() !== expected)
      throw new Error("Office session extension mismatch");
    if (request.operation === "open") {
      const key = `${context.threadId}:${resolve(context.workspacePath, request.path)}`;
      const current = this.opening.get(key);
      if (current) return current;
      const pending = this.serialize("open", () =>
        this.open(request, context),
      ).finally(() => this.opening.delete(key));
      this.opening.set(key, pending);
      return pending;
    }
    return this.serialize(request.sessionId, async () => {
      const live = await this.serialize("open", () =>
        this.restore(request.sessionId, context),
      );
      const { session } = live.journal.snapshot;
      if (session.path !== request.path || session.format !== request.format)
        throw new Error("Office session document mismatch");
      if (session.status === "closed")
        throw new Error("Office session is closed");
      if (request.operation === "snapshot")
        return structuredClone(live.journal.snapshot);
      if (request.operation === "apply") return this.apply(live, request);
      if (request.operation === "save")
        return this.save(live, request.expectedVersion);
      if (session.version !== session.savedVersion && !request.discard)
        throw new Error(
          "Office session has unsaved changes; save or explicitly discard them",
        );
      live.watcher?.close();
      if (live.externalTimer) clearTimeout(live.externalTimer);
      await live.engine.close();
      session.status = "closed";
      await this.publish(live, "closed");
      this.sessions.delete(session.sessionId);
      return structuredClone(live.journal.snapshot);
    });
  }

  private async open(
    request: Extract<ArtifactSessionRequest, { operation: "open" }>,
    context: OfficeSessionContext,
  ): Promise<ArtifactSnapshot> {
    const { workspace, original } = await this.source(context, request.path);
    for (const live of this.sessions.values()) {
      if (live.journal.original === original) {
        if (live.journal.threadId !== context.threadId)
          throw new Error("This document is already open in another task");
        return structuredClone(live.journal.snapshot);
      }
    }
    if (this.sessions.size >= 10)
      throw new Error(
        "Close an Office session before opening another document",
      );
    const sessionId = randomUUID();
    const directory = this.directory(sessionId);
    const engine = await this.options.createEngine();
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const baseline = `original${extname(original).toLowerCase()}`;
      const diskHash = await fileSha256(original);
      await copyFile(original, join(directory, baseline));
      if ((await fileSha256(join(directory, baseline))) !== diskHash)
        throw new Error("Document changed while opening; retry");
      const content = await engine.open(
        join(directory, baseline),
        request.format,
      );
      const snapshot = artifactSnapshotSchema.parse({
        session: {
          protocolVersion: 1,
          documentId: sha256(original),
          sessionId,
          path: request.path,
          format: request.format,
          engineVersion: engine.version,
          version: 0,
          savedVersion: 0,
          previewVersion: null,
          sequence: 0,
          status: "saved",
        },
        ...content,
      });
      if (this.disposed) throw new Error("Office session host is closed");
      const live: LiveSession = {
        engine,
        directory,
        journal: {
          schemaVersion: 1,
          threadId: context.threadId,
          workspace,
          original,
          baseline,
          baselineHash: diskHash,
          diskHash,
          snapshot,
          operations: [],
        },
      };
      this.sessions.set(sessionId, live);
      await this.publish(live, "opened");
      this.observe(live);
      this.render(live);
      return structuredClone(snapshot);
    } catch (error) {
      this.sessions.delete(sessionId);
      await engine.close();
      throw error;
    }
  }

  private async restore(
    sessionId: string,
    context: OfficeSessionContext,
  ): Promise<LiveSession> {
    const current = this.sessions.get(sessionId);
    const workspace = await realpath(context.workspacePath);
    if (current) {
      if (
        current.journal.threadId !== context.threadId ||
        current.journal.workspace !== workspace
      )
        throw new Error("Office session belongs to another task or workspace");
      return current;
    }
    const directory = this.directory(sessionId);
    const journal = await this.readJournal(sessionId);
    if (
      journal.schemaVersion !== 1 ||
      journal.snapshot.session.sessionId !== sessionId ||
      journal.threadId !== context.threadId ||
      journal.workspace !== workspace ||
      !/^original(?:-[a-f0-9-]+)?\.(docx|xlsx|pptx)$/u.test(journal.baseline)
    )
      throw new Error("Office recovery identity mismatch");
    if (journal.snapshot.session.status === "closed")
      throw new Error("Office session was closed");
    const source = await this.source(context, journal.snapshot.session.path);
    if (source.original !== journal.original)
      throw new Error("Office document moved outside its session");
    if (
      [...this.sessions.values()].some(
        (live) => live.journal.original === source.original,
      )
    )
      throw new Error("This document is already open in another session");
    if (this.sessions.size >= 10)
      throw new Error(
        "Close an Office session before recovering another document",
      );
    const baseline = join(directory, journal.baseline);
    if (
      !(await lstat(baseline)).isFile() ||
      (await fileSha256(baseline)) !== journal.baselineHash
    )
      throw new Error("Office recovery baseline was changed");
    const engine = await this.options.createEngine();
    const live: LiveSession = { engine, journal, directory };
    try {
      journal.snapshot.session.status = "recovering";
      await this.publish(live, "recovering");
      await engine.open(
        join(directory, journal.baseline),
        journal.snapshot.session.format,
      );
      for (const operation of journal.operations)
        await engine.apply(operation.change);
      const content = await engine.snapshot();
      Object.assign(journal.snapshot, content);
      delete journal.pending;
      delete journal.snapshot.preview;
      journal.snapshot.session.previewVersion = null;
      journal.snapshot.session.status =
        (await fileSha256(journal.original)) !== journal.diskHash
          ? "conflict"
          : journal.snapshot.session.version ===
              journal.snapshot.session.savedVersion
            ? "saved"
            : "editing";
      this.sessions.set(sessionId, live);
      await this.publish(live, "recovered");
      this.observe(live);
      this.render(live);
      return live;
    } catch (error) {
      this.sessions.delete(sessionId);
      await engine.close();
      throw error;
    }
  }

  private async apply(
    live: LiveSession,
    request: Extract<ArtifactSessionRequest, { operation: "apply" }>,
  ): Promise<ArtifactSnapshot> {
    const journal = live.journal;
    const session = journal.snapshot.session;
    const existing = journal.operations.find(
      (operation) => operation.id === request.operationId,
    );
    if (existing) {
      if (
        existing.baseVersion !== request.expectedVersion ||
        JSON.stringify(existing.change) !== JSON.stringify(request.change)
      )
        throw new Error("Operation ID was reused with different content");
      return structuredClone(journal.snapshot);
    }
    if (session.status === "conflict" || session.status === "failed")
      throw new Error(
        "Resolve the document conflict or recover the session before editing",
      );
    if (session.version !== request.expectedVersion)
      throw new Error(
        "Office document version conflict; read a fresh snapshot",
      );
    if (journal.operations.length >= 10_000)
      throw new Error("Office session operation limit reached");
    const operation = {
      id: request.operationId,
      baseVersion: request.expectedVersion,
      change: request.change,
    };
    journal.pending = operation;
    await this.persist(live);
    try {
      await live.engine.apply(request.change);
      const content = await live.engine.snapshot();
      const next = structuredClone(journal);
      next.operations.push(operation);
      delete next.pending;
      next.snapshot = artifactSnapshotSchema.parse({
        ...next.snapshot,
        ...content,
        session: {
          ...session,
          version: session.version + 1,
          status: "editing",
        },
      });
      // Persist the committed operation before acknowledging it or notifying the UI.
      await this.writeJournal(live.directory, next);
      live.journal = next;
      await this.publish(live, "applied", {
        operationId: request.operationId,
        selection: selectionFor(request.change),
      });
      this.render(live);
      return structuredClone(live.journal.snapshot);
    } catch (error) {
      // An engine failure may have partially applied a range. Recovery replays only committed operations.
      live.watcher?.close();
      await live.engine.close();
      this.sessions.delete(session.sessionId);
      throw error;
    }
  }

  private async save(
    live: LiveSession,
    expectedVersion: number,
  ): Promise<ArtifactSnapshot> {
    const journal = live.journal;
    const session = journal.snapshot.session;
    if (
      expectedVersion !== session.version ||
      session.status === "conflict" ||
      session.status === "failed"
    )
      throw new Error("Office document version conflict");
    if (
      (await realpath(journal.original)) !== journal.original ||
      (await realpath(dirname(journal.original))) !== dirname(journal.original)
    )
      throw new Error("Office original path changed");
    if (!(await this.options.canSaveOriginal(journal.original, session.format)))
      throw new Error(
        "Native round-trip compatibility has not been accepted for this original. The original and live draft are preserved; overwrite is blocked.",
      );
    if ((await fileSha256(journal.original)) !== journal.diskHash) {
      session.status = "conflict";
      await this.publish(live, "external-change");
      throw new Error("Original changed outside Artemis; overwrite is blocked");
    }
    session.status = "saving";
    await this.publish(live, "saving");
    const temporary = join(
      dirname(journal.original),
      `.artemis-office-${randomUUID()}${extname(journal.original)}`,
    );
    try {
      await live.engine.save(temporary);
      if ((await fileSha256(journal.original)) !== journal.diskHash)
        throw new Error("Original changed while saving; overwrite is blocked");
      const nextHash = await fileSha256(temporary);
      await rename(temporary, journal.original);
      journal.diskHash = nextHash;
      session.savedVersion = session.version;
      session.status = "saved";
      await this.publish(live, "saved");
      return structuredClone(journal.snapshot);
    } catch (error) {
      session.status = "editing";
      session.error = error instanceof Error ? error.message : String(error);
      await this.publish(live, "failed");
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private render(live: LiveSession): void {
    if (live.rendering) return;
    const session = live.journal.snapshot.session;
    const version = session.version;
    const assetId = randomUUID();
    const path = join(live.directory, `${assetId}.pdf`);
    live.rendering = live.engine
      .render(path)
      .then(async () => {
        await this.serialize(session.sessionId, async () => {
          const latest = live.journal.snapshot.session;
          if (
            this.sessions.get(session.sessionId) !== live ||
            latest.status === "closed" ||
            latest.version !== version
          ) {
            await rm(path, { force: true });
            return;
          }
          const previousAsset = live.journal.snapshot.preview?.assetId;
          live.journal.snapshot.preview = { assetId, version };
          latest.previewVersion = version;
          await this.publish(live, "preview");
          if (previousAsset)
            await rm(join(live.directory, `${previousAsset}.pdf`), {
              force: true,
            });
        });
      })
      .catch(async (error: unknown) => {
        if (this.sessions.get(session.sessionId) !== live) return;
        await this.serialize(session.sessionId, async () => {
          if (this.sessions.get(session.sessionId) !== live) return;
          live.journal.snapshot.session.error = `Preview: ${error instanceof Error ? error.message : String(error)}`;
          await this.publish(live, "failed");
        });
      })
      .finally(() => {
        delete live.rendering;
        if (
          this.sessions.get(session.sessionId) === live &&
          live.journal.snapshot.session.version !== version
        )
          this.render(live);
      });
  }

  private observe(live: LiveSession): void {
    const changed = () => {
      if (live.externalTimer) clearTimeout(live.externalTimer);
      live.externalTimer = setTimeout(() => {
        void this.serialize(
          live.journal.snapshot.session.sessionId,
          async () => {
            const journal = live.journal;
            const hash = await fileSha256(journal.original).catch(
              () => "missing",
            );
            if (
              hash === journal.diskHash ||
              this.sessions.get(journal.snapshot.session.sessionId) !== live
            )
              return;
            // This event is explicitly save-level; no fabricated paragraph/cell operation.
            journal.snapshot.session.status = "conflict";
            journal.snapshot.session.error =
              "The file was changed by another program. Reopen it after preserving or discarding this draft.";
            await this.publish(live, "external-change");
          },
        ).catch(() => undefined);
      }, 200);
    };
    // Stat watching survives atomic replacement and platforms without FSEvents access.
    watchFile(
      live.journal.original,
      { interval: 500, persistent: false },
      changed,
    );
    live.watcher = { close: () => unwatchFile(live.journal.original, changed) };
  }

  async snapshotForUi(
    sessionId: string,
    threadId: string,
  ): Promise<ArtifactSnapshot> {
    const live = this.sessions.get(sessionId);
    if (live?.journal.threadId === threadId)
      return structuredClone(live.journal.snapshot);
    const journal = await this.readJournal(sessionId);
    if (
      journal.threadId !== threadId ||
      journal.snapshot.session.sessionId !== sessionId
    )
      throw new Error("Office session belongs to another task");
    return artifactSnapshotSchema.parse(journal.snapshot);
  }

  private async readJournal(sessionId: string): Promise<Journal> {
    const path = join(this.directory(sessionId), "session.json");
    const info = await lstat(path);
    if (!info.isFile() || info.size > 32 * 1024 * 1024)
      throw new Error(
        "Office recovery log exceeds limit or is not a regular file",
      );
    return journalSchema.parse(JSON.parse(await readFile(path, "utf8")));
  }

  async previewPath(
    sessionId: string,
    threadId: string,
    assetId: string,
  ): Promise<string> {
    const snapshot = await this.snapshotForUi(sessionId, threadId);
    if (
      snapshot.preview?.assetId !== assetId ||
      !/^[a-f0-9-]{36}$/u.test(assetId)
    )
      throw new Error("Office preview is no longer current");
    return join(this.directory(sessionId), `${assetId}.pdf`);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([
      ...this.opening.values(),
      ...this.queues.values(),
    ]);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const live of sessions) {
      live.watcher?.close();
      if (live.externalTimer) clearTimeout(live.externalTimer);
      await live.engine.close();
    }
  }
}
