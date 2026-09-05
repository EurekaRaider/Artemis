import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { imIdentityKey, type ImIdentity } from "@artemis/protocol";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(digest(a));
  const y = Buffer.from(digest(b));
  return timingSafeEqual(x, y);
}
export interface QueueItem<T> {
  id: string;
  recipient: string;
  payload: T;
  attempts: number;
}

/** A single writer owns each Gateway. Transactions never include network I/O. */
export class GatewayStore {
  readonly db: DatabaseSync;
  private readonly key: Buffer;
  private transactionDepth = 0;
  constructor(path: string, encryptionKey: string) {
    if (encryptionKey.length < 32)
      throw new Error(
        "Gateway encryption key must contain at least 32 characters.",
      );
    this.key = createHash("sha256").update(encryptionKey).digest();
    this.db = new DatabaseSync(path);
    try {
      this.db
        .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA locking_mode=EXCLUSIVE;
      CREATE TABLE IF NOT EXISTS state (namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS queue (bucket TEXT NOT NULL, id TEXT NOT NULL, recipient TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bucket,id));
      CREATE INDEX IF NOT EXISTS queue_pending ON queue(bucket,state,available);
      CREATE TABLE IF NOT EXISTS pair_codes (hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, expires INTEGER NOT NULL);
      UPDATE queue SET state='pending' WHERE state='processing' AND bucket='incoming';
      UPDATE queue SET state='uncertain' WHERE state='sending' AND bucket='outgoing';`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM state WHERE namespace=? AND id=?")
      .get(namespace, id);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }
  list<T>(namespace: string): T[] {
    return this.db
      .prepare("SELECT value FROM state WHERE namespace=? ORDER BY id")
      .all(namespace)
      .map((row) => JSON.parse(String(row.value)) as T);
  }
  put(namespace: string, id: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO state(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value",
      )
      .run(namespace, id, JSON.stringify(value));
  }
  delete(namespace: string, id: string): void {
    this.db
      .prepare("DELETE FROM state WHERE namespace=? AND id=?")
      .run(namespace, id);
  }
  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  unseal<T>(value: string): T {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    ) as T;
  }
  register(name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    this.put("devices", id, {
      id,
      name,
      tokenHash: digest(token),
      revoked: false,
    });
    return { id, token };
  }
  authenticate(id: string, token: string): boolean {
    const device = this.get<{ tokenHash: string; revoked: boolean }>(
      "devices",
      id,
    );
    return (
      !!device && !device.revoked && sameSecret(device.tokenHash, digest(token))
    );
  }
  pairCode(deviceId: string, now = Date.now()): string {
    const code = randomBytes(8).toString("hex");
    this.db
      .prepare("DELETE FROM pair_codes WHERE device_id=? OR expires<=?")
      .run(deviceId, now);
    this.db
      .prepare("INSERT INTO pair_codes VALUES(?,?,?)")
      .run(digest(code), deviceId, now + 5 * 60_000);
    return code;
  }
  pair(code: string, identity: ImIdentity, now = Date.now()): string {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT device_id FROM pair_codes WHERE hash=? AND expires>?")
        .get(digest(code), now);
      if (!row) throw new Error("Pairing code is invalid or expired.");
      const deviceId = String(row.device_id);
      if (this.get<{ revoked: boolean }>("devices", deviceId)?.revoked)
        throw new Error("This device has been revoked.");
      const old = this.get<{ deviceId: string }>(
        "identities",
        imIdentityKey(identity),
      );
      if (old && old.deviceId !== deviceId)
        throw new Error("Unpair this identity from its current device first.");
      this.put("identities", imIdentityKey(identity), { deviceId, identity });
      this.db.prepare("DELETE FROM pair_codes WHERE hash=?").run(digest(code));
      return deviceId;
    });
  }
  enqueue(
    bucket: string,
    id: string,
    recipient: string,
    payload: unknown,
  ): boolean {
    return (
      Number(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO queue(bucket,id,recipient,payload) VALUES(?,?,?,?)",
          )
          .run(bucket, id, recipient, JSON.stringify(payload)).changes,
      ) === 1
    );
  }
  pending<T>(
    bucket: string,
    now = Date.now(),
    recipient?: string,
  ): QueueItem<T>[] {
    const rows =
      recipient === undefined
        ? this.db
            .prepare(
              "SELECT * FROM queue WHERE bucket=? AND state='pending' AND available<=? ORDER BY rowid LIMIT 100",
            )
            .all(bucket, now)
        : this.db
            .prepare(
              "SELECT * FROM queue WHERE bucket=? AND state='pending' AND available<=? AND recipient=? ORDER BY rowid LIMIT 100",
            )
            .all(bucket, now, recipient);
    return rows.map((row) => ({
      id: String(row.id),
      recipient: String(row.recipient),
      payload: JSON.parse(String(row.payload)) as T,
      attempts: Number(row.attempts),
    }));
  }
  mark(bucket: string, id: string, state: string, available = 0): void {
    this.db
      .prepare(
        "UPDATE queue SET state=?, available=?, attempts=attempts+1 WHERE bucket=? AND id=?",
      )
      .run(state, available, bucket, id);
  }
  /** Keep per-conversation order even when the oldest message is backing off. */
  outgoing<T>(recipient: string, now = Date.now()): QueueItem<T>[] {
    return this.db
      .prepare(
        `WITH ordered AS (
      SELECT *, rowid AS sequence, row_number() OVER (
        PARTITION BY json_extract(payload,'$.conversation.kind'),json_extract(payload,'$.conversation.id') ORDER BY rowid
      ) AS position FROM queue WHERE bucket='outgoing' AND state='pending' AND recipient=?
    ) SELECT * FROM ordered WHERE position=1 AND available<=? ORDER BY sequence LIMIT 100`,
      )
      .all(recipient, now)
      .map((row) => ({
        id: String(row.id),
        recipient: String(row.recipient),
        payload: JSON.parse(String(row.payload)) as T,
        attempts: Number(row.attempts),
      }));
  }
}
