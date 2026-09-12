import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { patchDesignSource, type DesignSource } from "./design-source.js";

/** This context must come from Main's current task, never from a model tool. */
export interface DesignHostContext {
  projectId: string;
  threadId: string;
  workspaceBinding: string;
  mode: "plan" | "review" | "execute";
}

export interface DesignRevisionRecord {
  revisionId: string;
  documentId: string;
  parentRevision: string | null;
  conflict: boolean;
  digest: string;
}

export interface DesignHostRequest {
  requestId: string;
  turnId: string;
  workflow: "code" | "design";
  context: DesignHostContext;
  text: string;
  status:
    | "pending"
    | "dispatched"
    | "completed"
    | "cancelled"
    | "needs-reconciliation";
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const scope = (context: DesignHostContext) =>
  JSON.stringify([
    context.projectId,
    context.threadId,
    context.workspaceBinding,
  ]);
function requireExecute(context: DesignHostContext): void {
  if (context.mode !== "execute")
    throw new Error("Design mutation requires Execute.");
}

/** P0 persistence core. Not exposed to IPC until the full P0 gate passes. */
export class DesignStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly blobs: string,
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS design_p0_documents (id TEXT PRIMARY KEY, scope TEXT NOT NULL, head TEXT);
      CREATE TABLE IF NOT EXISTS design_p0_revisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS design_p0_operations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS design_p0_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, scope TEXT NOT NULL, record TEXT NOT NULL);
    `);
  }

  private transaction<T>(action: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  save(
    context: DesignHostContext,
    input: {
      operationId: string;
      documentId: string;
      baseRevision: string | null;
      source: DesignSource;
    },
  ): DesignRevisionRecord {
    requireExecute(context);
    const content = JSON.stringify(patchDesignSource(input.source, []));
    const hash = digest(content);
    const fingerprint = digest(
      JSON.stringify([
        scope(context),
        input.documentId,
        input.baseRevision,
        hash,
      ]),
    );
    return this.transaction(() => {
      const previous = this.database
        .prepare("SELECT * FROM design_p0_operations WHERE id=?")
        .get(input.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("Operation ID was reused with different content.");
        const revision = JSON.parse(
          String(previous.result),
        ) as DesignRevisionRecord;
        this.read(context, input.documentId, revision.revisionId);
        return revision;
      }
      const document = this.database
        .prepare("SELECT * FROM design_p0_documents WHERE id=?")
        .get(input.documentId);
      if (document && document.scope !== scope(context))
        throw new Error("Design belongs to a different task or workspace.");
      if (input.baseRevision !== null)
        this.read(context, input.documentId, input.baseRevision);
      if (!document && input.baseRevision !== null)
        throw new Error("Base revision is missing.");
      const count = this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM design_p0_revisions WHERE document_id=?",
        )
        .get(input.documentId);
      if (Number(count!.count) >= 50)
        throw new Error(
          "Design reached the 50 revision limit; draft retained by caller.",
        );
      mkdirSync(this.blobs, { recursive: true });
      // Hash-only filenames. Flush before publishing; abandoned blobs are retained.
      const temporary = join(this.blobs, `${hash}.${randomUUID()}.tmp`);
      const file = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(file, content);
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(temporary, join(this.blobs, hash));
      if (process.platform !== "win32") {
        const directory = openSync(this.blobs, "r");
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
      const revision: DesignRevisionRecord = {
        revisionId: randomUUID(),
        documentId: input.documentId,
        parentRevision: input.baseRevision,
        digest: hash,
        conflict: (document?.head ?? null) !== input.baseRevision,
      };
      const record = JSON.stringify(revision);
      this.database
        .prepare("INSERT INTO design_p0_revisions VALUES(?,?,?)")
        .run(revision.revisionId, input.documentId, record);
      if (!document)
        this.database
          .prepare("INSERT INTO design_p0_documents VALUES(?,?,?)")
          .run(input.documentId, scope(context), revision.revisionId);
      else if (!revision.conflict)
        this.database
          .prepare("UPDATE design_p0_documents SET head=? WHERE id=?")
          .run(revision.revisionId, input.documentId);
      this.database
        .prepare("INSERT INTO design_p0_operations VALUES(?,?,?)")
        .run(input.operationId, fingerprint, record);
      return revision;
    });
  }

  head(context: DesignHostContext, documentId: string): string | null {
    const row = this.database
      .prepare("SELECT * FROM design_p0_documents WHERE id=?")
      .get(documentId);
    if (!row || row.scope !== scope(context))
      throw new Error("Design does not belong to this task and workspace.");
    return row.head === null ? null : String(row.head);
  }

  read(
    context: DesignHostContext,
    documentId: string,
    revisionId: string,
  ): DesignSource {
    this.head(context, documentId);
    const row = this.database
      .prepare(
        "SELECT record FROM design_p0_revisions WHERE id=? AND document_id=?",
      )
      .get(revisionId, documentId);
    if (!row) throw new Error("Design revision is missing.");
    const revision = JSON.parse(String(row.record)) as DesignRevisionRecord;
    if (!/^[a-f0-9]{64}$/.test(revision.digest))
      throw new Error("Invalid design digest.");
    const content = readFileSync(join(this.blobs, revision.digest), "utf8");
    if (digest(content) !== revision.digest)
      throw new Error("Design content integrity check failed.");
    return JSON.parse(content) as DesignSource;
  }

  enqueue(
    context: DesignHostContext,
    requestId: string,
    workflow: "code" | "design",
    text: string,
  ): DesignHostRequest {
    requireExecute(context);
    const fingerprint = digest(
      JSON.stringify([scope(context), context.mode, workflow, text]),
    );
    return this.transaction(() => {
      const previous = this.database
        .prepare("SELECT * FROM design_p0_requests WHERE id=?")
        .get(requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("Request ID was reused with different content.");
        return JSON.parse(String(previous.record)) as DesignHostRequest;
      }
      const request: DesignHostRequest = {
        requestId,
        turnId: randomUUID(),
        workflow,
        context: structuredClone(context),
        text,
        status: "pending",
      };
      this.database
        .prepare("INSERT INTO design_p0_requests VALUES(?,?,?,?)")
        .run(requestId, fingerprint, scope(context), JSON.stringify(request));
      return request;
    });
  }

  /** Caller supplies host-wide activity including descendant tools, not just Pi. */
  claim(
    context: DesignHostContext,
    active: { turn: boolean; tools: boolean; children: boolean },
  ): DesignHostRequest | undefined {
    requireExecute(context);
    if (active.turn || active.tools || active.children) return undefined;
    return this.transaction(() => {
      const rows = this.database
        .prepare(
          "SELECT record FROM design_p0_requests WHERE scope=? ORDER BY rowid",
        )
        .all(scope(context));
      const requests = rows.map(
        (row) => JSON.parse(String(row.record)) as DesignHostRequest,
      );
      if (
        requests.some((request) =>
          ["dispatched", "needs-reconciliation"].includes(request.status),
        )
      )
        return undefined;
      const request = requests.find((request) => request.status === "pending");
      if (!request) return undefined;
      request.status = "dispatched";
      this.database
        .prepare("UPDATE design_p0_requests SET record=? WHERE id=?")
        .run(JSON.stringify(request), request.requestId);
      return request;
    });
  }

  complete(
    context: DesignHostContext,
    requestId: string,
    turnId: string,
  ): void {
    requireExecute(context);
    this.transaction(() => {
      const row = this.database
        .prepare("SELECT * FROM design_p0_requests WHERE id=?")
        .get(requestId);
      if (!row || row.scope !== scope(context))
        throw new Error("Request belongs to a different task or workspace.");
      const request = JSON.parse(String(row.record)) as DesignHostRequest;
      if (request.turnId !== turnId)
        throw new Error("Completion belongs to a different turn.");
      if (request.status === "completed") return;
      if (request.status !== "dispatched")
        throw new Error("Request must be reconciled before completion.");
      request.status = "completed";
      this.database
        .prepare("UPDATE design_p0_requests SET record=? WHERE id=?")
        .run(JSON.stringify(request), requestId);
    });
  }

  /** Restart cannot prove dispatch acceptance. Never replay an ambiguous request. */
  recover(): DesignHostRequest[] {
    return this.transaction(() => {
      const rows = this.database
        .prepare("SELECT record FROM design_p0_requests ORDER BY rowid")
        .all();
      return rows.map((row) => {
        const request = JSON.parse(String(row.record)) as DesignHostRequest;
        if (request.status === "dispatched") {
          request.status = "needs-reconciliation";
          this.database
            .prepare("UPDATE design_p0_requests SET record=? WHERE id=?")
            .run(JSON.stringify(request), request.requestId);
        }
        return request;
      });
    });
  }
}
