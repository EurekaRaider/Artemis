import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DesignContent,
  DesignInspection,
  DesignQueuedRequest,
  DesignRef,
  DesignRevision,
  DesignSummary,
  DesignWorkflow,
  PromptAttachment,
} from "@artemis/protocol";
import type { DesignHostContext } from "./design-store.js";
import { normalizeDesignContent } from "./design-document-source.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const scope = (context: DesignHostContext) =>
  JSON.stringify([
    context.projectId,
    context.threadId,
    context.workspaceBinding,
  ]);
export function requireDesignExecute(context: DesignHostContext) {
  if (context.mode !== "execute")
    throw new Error(
      "Design writes, previews, export and implementation require Execute.",
    );
}
type RevisionRow = {
  id: string;
  document_id: string;
  parent: string | null;
  digest: string;
  conflict: number;
  created_at: string;
  bytes: number;
};

export class DesignRepository {
  private readonly db: DatabaseSync;
  private inTransaction = false;
  private readonly blobs: string;
  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.blobs = join(root, "blobs");
    mkdirSync(this.blobs, { recursive: true });
    this.db = new DatabaseSync(join(root, "design.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL, head TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, parent TEXT, digest TEXT NOT NULL, conflict INTEGER NOT NULL, created_at TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS revisions_document ON revisions(document_id);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision_id TEXT NOT NULL, document_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, envelope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inspections(revision_id TEXT NOT NULL, variant_id TEXT NOT NULL, page_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(revision_id,variant_id,page_id));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, fingerprint TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts(thread_id TEXT PRIMARY KEY, workflow TEXT NOT NULL);
    `);
    this.transaction(() => {
      for (const request of this.requests())
        if (request.status === "dispatched")
          this.updateRequest({
            ...request,
            status: "needs-reconciliation",
            error:
              "The process ended after dispatch. Inspect the existing turn before retrying.",
          });
    });
    this.collectOrphans();
  }
  close() {
    this.db.close();
  }
  private transaction<T>(action: () => T): T {
    if (this.inTransaction) return action();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
  private blob(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Invalid design content digest.");
    const text = readFileSync(join(this.blobs, digest), "utf8");
    if (hash(text) !== digest)
      throw new Error("Design content integrity check failed.");
    return text;
  }
  private writeBlob(text: string): string {
    const digest = hash(text);
    const destination = join(this.blobs, digest);
    if (existsSync(destination)) {
      this.blob(digest);
      return digest;
    }
    const temporary = join(this.blobs, `${digest}.${randomUUID()}.tmp`);
    const file = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(file, text);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, destination);
    if (process.platform !== "win32") {
      const directory = openSync(this.blobs, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
    return digest;
  }
  private document(context: DesignHostContext, id: string) {
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id);
    if (!row || row.scope !== scope(context))
      throw new Error(
        "Design does not belong to the current task and workspace.",
      );
    return row;
  }
  list(context: DesignHostContext): DesignSummary[] {
    return this.db
      .prepare("SELECT * FROM documents WHERE scope=? ORDER BY updated_at DESC")
      .all(scope(context))
      .map((row) => ({
        documentId: String(row.id),
        title: String(row.title),
        revisionId: String(row.head),
        updatedAt: String(row.updated_at),
      }));
  }
  history(
    context: DesignHostContext,
    documentId: string,
  ): Array<Omit<DesignRevision, "content">> {
    this.document(context, documentId);
    return (
      this.db
        .prepare(
          "SELECT * FROM revisions WHERE document_id=? ORDER BY rowid DESC",
        )
        .all(documentId) as unknown as RevisionRow[]
    ).map((row) => ({
      documentId,
      revisionId: row.id,
      parentRevision: row.parent,
      digest: row.digest,
      conflict: Boolean(row.conflict),
      createdAt: row.created_at,
    }));
  }
  read(
    context: DesignHostContext,
    documentId: string,
    revisionId?: string,
  ): DesignRevision {
    const document = this.document(context, documentId);
    const row = this.db
      .prepare("SELECT * FROM revisions WHERE id=? AND document_id=?")
      .get(revisionId ?? document.head!, documentId) as unknown as
      RevisionRow | undefined;
    if (!row) throw new Error("Design revision is missing.");
    return {
      documentId,
      revisionId: row.id,
      parentRevision: row.parent,
      digest: row.digest,
      conflict: Boolean(row.conflict),
      createdAt: row.created_at,
      content: normalizeDesignContent(JSON.parse(this.blob(row.digest))),
    };
  }
  save(
    context: DesignHostContext,
    input: {
      operationId: string;
      documentId?: string;
      baseRevision: string | null;
      content: DesignContent;
    },
  ): DesignRevision {
    requireDesignExecute(context);
    if (!input.operationId || input.operationId.length > 128)
      throw new Error("A bounded operation ID is required.");
    const content = normalizeDesignContent(input.content);
    const text = JSON.stringify(content);
    const digest = hash(text);
    const fingerprint = hash(
      JSON.stringify([
        scope(context),
        input.documentId ?? null,
        input.baseRevision,
        digest,
      ]),
    );
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM operations WHERE id=?")
        .get(input.operationId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("Operation ID reused with different content.");
        return this.read(
          context,
          String(existing.document_id),
          String(existing.revision_id),
        );
      }
      const documentId = input.documentId ?? randomUUID();
      const document = input.documentId
        ? this.document(context, documentId)
        : undefined;
      if (input.baseRevision)
        this.read(context, documentId, input.baseRevision);
      else if (!document && input.documentId)
        throw new Error("Document is missing.");
      const rows = this.db
        .prepare(
          "SELECT digest,MAX(bytes) AS bytes FROM revisions WHERE document_id=? GROUP BY digest",
        )
        .all(documentId);
      const count = this.db
        .prepare("SELECT COUNT(*) AS n FROM revisions WHERE document_id=?")
        .get(documentId)!;
      const evidenceBytes = Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(length(CAST(record AS BLOB))),0) AS bytes FROM inspections WHERE revision_id IN (SELECT id FROM revisions WHERE document_id=?)",
          )
          .get(documentId)!.bytes,
      );
      const physicalBytes =
        evidenceBytes +
        rows.reduce((sum, row) => sum + Number(row.bytes), 0) +
        (rows.some((row) => row.digest === digest)
          ? 0
          : Buffer.byteLength(text));
      if (Number(count.n) >= 50 || physicalBytes > 200 * 1024 * 1024)
        throw new Error(
          "Document history limit reached. Keep the draft and create another document or export history.",
        );
      this.writeBlob(text);
      const revisionId = randomUUID();
      const now = new Date().toISOString();
      const conflict = (document?.head ?? null) !== input.baseRevision;
      this.db
        .prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?)")
        .run(
          revisionId,
          documentId,
          input.baseRevision,
          digest,
          Number(conflict),
          now,
          Buffer.byteLength(text),
        );
      if (!document)
        this.db
          .prepare("INSERT INTO documents VALUES(?,?,?,?,?)")
          .run(documentId, scope(context), content.title, revisionId, now);
      else if (!conflict)
        this.db
          .prepare(
            "UPDATE documents SET head=?,title=?,updated_at=? WHERE id=?",
          )
          .run(revisionId, content.title, now, documentId);
      this.db
        .prepare("INSERT INTO operations VALUES(?,?,?,?)")
        .run(input.operationId, fingerprint, revisionId, documentId);
      const eventId = randomUUID();
      this.db.prepare("INSERT INTO events VALUES(?,?,?)").run(
        eventId,
        documentId,
        JSON.stringify({
          schemaVersion: 1,
          eventId,
          type: "design.revision.saved",
          documentId,
          revisionId,
          parentRevision: input.baseRevision,
          conflict,
          timestamp: now,
        }),
      );
      return this.read(context, documentId, revisionId);
    });
  }
  recordInspection(
    context: DesignHostContext,
    documentId: string,
    inspection: DesignInspection,
  ) {
    requireDesignExecute(context);
    const revision = this.read(context, documentId, inspection.revisionId);
    if (
      !revision.content.variants
        .find((item) => item.id === inspection.variantId)
        ?.pages.some((item) => item.id === inspection.pageId)
    )
      throw new Error("Inspection page is missing.");
    if (
      Buffer.byteLength(inspection.screenshot) > 8 * 1024 * 1024 ||
      inspection.errors.length > 100 ||
      Buffer.byteLength(inspection.errors.join("\n")) > 65536
    )
      throw new Error("Inspection evidence exceeds limits.");
    const text = JSON.stringify(inspection);
    const sourceBytes = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(bytes),0) AS bytes FROM (SELECT MAX(bytes) AS bytes FROM revisions WHERE document_id=? GROUP BY digest)",
        )
        .get(documentId)!.bytes,
    );
    const evidenceBytes = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(record AS BLOB))),0) AS bytes FROM inspections WHERE revision_id IN (SELECT id FROM revisions WHERE document_id=?) AND NOT(revision_id=? AND variant_id=? AND page_id=?)",
        )
        .get(
          documentId,
          inspection.revisionId,
          inspection.variantId,
          inspection.pageId,
        )!.bytes,
    );
    if (
      sourceBytes + evidenceBytes + Buffer.byteLength(text) >
      200 * 1024 * 1024
    )
      throw new Error(
        "Inspection evidence exceeds the document storage limit.",
      );
    this.db
      .prepare("INSERT OR REPLACE INTO inspections VALUES(?,?,?,?)")
      .run(
        inspection.revisionId,
        inspection.variantId,
        inspection.pageId,
        text,
      );
  }
  inspection(
    context: DesignHostContext,
    documentId: string,
    revisionId: string,
    variantId: string,
    pageId: string,
  ): DesignInspection | undefined {
    this.read(context, documentId, revisionId);
    const row = this.db
      .prepare(
        "SELECT record FROM inspections WHERE revision_id=? AND variant_id=? AND page_id=?",
      )
      .get(revisionId, variantId, pageId);
    return row ? JSON.parse(String(row.record)) : undefined;
  }
  inspections(
    context: DesignHostContext,
    documentId: string,
    revisionId: string,
  ): DesignInspection[] {
    this.read(context, documentId, revisionId);
    return this.db
      .prepare("SELECT record FROM inspections WHERE revision_id=?")
      .all(revisionId)
      .map((row) => JSON.parse(String(row.record)));
  }
  workflow(threadId: string): DesignWorkflow {
    return this.db
      .prepare("SELECT workflow FROM contexts WHERE thread_id=?")
      .get(threadId)?.workflow === "design"
      ? "design"
      : "code";
  }
  setWorkflow(threadId: string, workflow: DesignWorkflow) {
    this.db
      .prepare("INSERT OR REPLACE INTO contexts VALUES(?,?)")
      .run(threadId, workflow);
  }
  enqueue(
    context: DesignHostContext,
    input: {
      requestId: string;
      workflow: DesignWorkflow;
      text: string;
      attachments?: PromptAttachment[];
      designRef?: DesignRef;
      source?: "user" | "goal-continuation";
      expectedGoalId?: string;
    },
  ): DesignQueuedRequest {
    if (
      !input.requestId ||
      input.requestId.length > 128 ||
      !input.text.trim() ||
      Buffer.byteLength(input.text) > 128 * 1024 ||
      !["code", "design"].includes(input.workflow)
    )
      throw new Error("Invalid design request identity or text.");
    if (input.designRef) {
      requireDesignExecute(context);
      const revision = this.read(
        context,
        input.designRef.documentId,
        input.designRef.revisionId,
      );
      const variant = revision.content.variants.find(
        (item) => item.id === input.designRef!.variantId,
      );
      if (
        !variant ||
        !input.designRef.pageIds.length ||
        new Set(input.designRef.pageIds).size !==
          input.designRef.pageIds.length ||
        input.designRef.pageIds.some(
          (id) => !variant.pages.some((page) => page.id === id),
        )
      )
        throw new Error("Implementation references invalid pages.");
    }
    const fingerprint = hash(JSON.stringify([context, input]));
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM requests WHERE id=?")
        .get(input.requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("Request ID reused with different content.");
        return JSON.parse(String(existing.record));
      }
      const request: DesignQueuedRequest = {
        ...context,
        ...structuredClone(input),
        turnId: randomUUID(),
        status: "pending",
      };
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?,?)")
        .run(
          request.requestId,
          context.threadId,
          fingerprint,
          JSON.stringify(request),
        );
      this.setWorkflow(context.threadId, input.workflow);
      return request;
    });
  }
  requests(threadId?: string): DesignQueuedRequest[] {
    const rows = threadId
      ? this.db
          .prepare(
            "SELECT record FROM requests WHERE thread_id=? ORDER BY rowid",
          )
          .all(threadId)
      : this.db.prepare("SELECT record FROM requests ORDER BY rowid").all();
    return rows.map(
      (row) => JSON.parse(String(row.record)) as DesignQueuedRequest,
    );
  }
  private updateRequest(request: DesignQueuedRequest) {
    this.db
      .prepare("UPDATE requests SET record=? WHERE id=?")
      .run(JSON.stringify(request), request.requestId);
  }
  claim(context: DesignHostContext): DesignQueuedRequest | undefined {
    return this.transaction(() => {
      const requests = this.requests(context.threadId);
      if (
        requests.some((item) =>
          ["dispatched", "needs-reconciliation", "paused"].includes(
            item.status,
          ),
        )
      )
        return;
      const request = requests.find((item) => item.status === "pending");
      if (!request) return;
      if (
        request.workspaceBinding !== context.workspaceBinding ||
        request.projectId !== context.projectId ||
        request.mode !== context.mode
      ) {
        this.updateRequest({
          ...request,
          status: "paused",
          error:
            "Mode or workspace changed. Reconfirm the destination before continuing.",
        });
        return;
      }
      if (request.designRef) {
        requireDesignExecute(context);
        this.read(
          context,
          request.designRef.documentId,
          request.designRef.revisionId,
        );
      }
      const claimed = { ...request, status: "dispatched" as const };
      this.updateRequest(claimed);
      return claimed;
    });
  }
  reconcile(turnId: string) {
    const request = this.requests().find((item) => item.turnId === turnId);
    if (request?.status === "dispatched")
      this.updateRequest({
        ...request,
        status: "needs-reconciliation",
        error:
          "Execution ended without a confirmed result. Inspect the original turn before retrying.",
      });
  }
  settle(turnId: string, status: "completed" | "failed", error?: string) {
    const request = this.requests().find((item) => item.turnId === turnId);
    if (request?.status === "dispatched")
      this.updateRequest({ ...request, status, ...(error ? { error } : {}) });
  }
  cancel(threadId: string, requestId: string) {
    const request = this.requests(threadId).find(
      (item) => item.requestId === requestId,
    );
    if (!request || request.status === "dispatched")
      throw new Error("Stop the active turn before cancelling it.");
    this.updateRequest({ ...request, status: "cancelled" });
  }
  edit(context: DesignHostContext, requestId: string, text: string) {
    const request = this.requests(context.threadId).find(
      (item) => item.requestId === requestId,
    );
    if (!text.trim() || Buffer.byteLength(text) > 128 * 1024)
      throw new Error("Invalid queued prompt.");
    if (!request || request.status !== "pending" || request.designRef)
      throw new Error("Only pending conversation requests can be edited.");
    this.updateRequest({ ...request, text });
  }
  retry(context: DesignHostContext, requestId: string): DesignQueuedRequest {
    const request = this.requests(context.threadId).find(
      (item) => item.requestId === requestId,
    );
    if (
      !request ||
      !["paused", "needs-reconciliation", "failed"].includes(request.status)
    )
      throw new Error("This request cannot be retried.");
    requireDesignExecute(context);
    if (scope(request) !== scope(context))
      throw new Error(
        "Return to the original workspace before retrying this request.",
      );
    // A trusted explicit retry always has a new identity. It cannot masquerade as
    // delivery of the previous turn after an uncertain dispatch.
    return this.transaction(() => {
      const next = this.enqueue(context, {
        requestId: randomUUID(),
        workflow: request.workflow,
        text: request.text,
        ...(request.attachments ? { attachments: request.attachments } : {}),
        ...(request.designRef ? { designRef: request.designRef } : {}),
        ...(request.source ? { source: request.source } : {}),
        ...(request.expectedGoalId
          ? { expectedGoalId: request.expectedGoalId }
          : {}),
      });
      this.cancel(context.threadId, requestId);
      return next;
    });
  }
  reorder(threadId: string, requestIds: string[]) {
    this.transaction(() => {
      const pending = this.requests(threadId).filter(
        (item) => item.status === "pending",
      );
      if (
        requestIds.length !== pending.length ||
        new Set(requestIds).size !== pending.length ||
        pending.some((item) => !requestIds.includes(item.requestId))
      )
        throw new Error("Queue changed before reordering. Refresh and retry.");
      const rows = requestIds.map((id) =>
        this.db
          .prepare("SELECT * FROM requests WHERE id=? AND thread_id=?")
          .get(id, threadId)!,
      );
      for (const row of rows)
        this.db.prepare("DELETE FROM requests WHERE id=?").run(row.id!);
      for (const row of rows)
        this.db
          .prepare("INSERT INTO requests VALUES(?,?,?,?)")
          .run(row.id!, row.thread_id!, row.fingerprint!, row.record!);
    });
  }
  collectOrphans(now = Date.now()) {
    const used = new Set(
      this.db
        .prepare("SELECT DISTINCT digest FROM revisions")
        .all()
        .map((row) => row.digest),
    );
    for (const name of readdirSync(this.blobs))
      if (
        /^[a-f0-9]{64}(?:\.[a-f0-9-]+\.tmp)?$/.test(name) &&
        !used.has(name) &&
        now - statSync(join(this.blobs, name)).mtimeMs > 86400000
      )
        unlinkSync(join(this.blobs, name));
  }
}
