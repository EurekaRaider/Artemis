import { imSettingsSchema } from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
import type { DatabaseSync } from "node:sqlite";
import type { Receipt } from "./im-runtime-types.js";

const completedNative = `namespace='receipts' AND json_extract(value,'$.state')='done'
  AND json_extract(value,'$.request.nativeTaskId') IS NOT NULL AND json_extract(value,'$.threadId') IS NOT NULL`;

export function initializeReceiptIndexes(db: DatabaseSync): void {
  db.exec(`CREATE INDEX IF NOT EXISTS ix_im_receipt_state ON im_state(json_extract(value,'$.state'),json_extract(value,'$.threadId')) WHERE namespace='receipts';
    CREATE INDEX IF NOT EXISTS ix_im_native_receipt_id ON im_state(id) WHERE ${completedNative}`);
}

export function queueNativeDeletions(db: DatabaseSync, threadId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO im_state(namespace,id,value)
    SELECT 'pending-native-deletions',id,json_object('invocationId',id,'threadId',?)
    FROM im_state WHERE ${completedNative} AND json_extract(value,'$.threadId')=?`,
  ).run(threadId, threadId);
}

export function nativeReceiptPage(
  db: DatabaseSync,
  after: string,
  limit: number,
) {
  return db
    .prepare(
      `SELECT id,json_extract(value,'$.threadId') AS threadId FROM im_state
    WHERE ${completedNative} AND id > ? ORDER BY id LIMIT ?`,
    )
    .all(after, limit) as { id: string; threadId: string }[];
}

export function createImStateRepository(
  services: Pick<
    ImCoordinatorDependencies,
    "db" | "decodeState" | "secure" | "get" | "text"
  >,
) {
  function get<T>(namespace: string, id: string): T | undefined {
    const row = services.db
      .prepare("SELECT value,version FROM im_state WHERE namespace=? AND id=?")
      .get(namespace, id);
    if (!row) return undefined;
    if (row.version !== 1) throw new Error("Unsupported IM state version.");
    return services.decodeState<T>(String(row.value));
  }

  function decodeState<T>(raw: string): T {
    const value = JSON.parse(raw);
    return value?.encryptedImState === 2
      ? (JSON.parse(
          services.secure.decryptString(Buffer.from(value.sealed, "base64")),
        ) as T)
      : (value as T);
  }

  function put(namespace: string, id: string, value: unknown): void {
    if (namespace === "settings" && id === "current") {
      const config = imSettingsSchema.parse(value);
      // Old applications see a paused, ungranted IM configuration. The complete
      // v2 configuration remains available when the user upgrades again.
      const legacy = {
        ...config,
        enabled: false,
        defaultProjectId: "",
        grants: [],
      };
      services.db.exec("SAVEPOINT im_settings_migration");
      try {
        const write = services.db.prepare(
          "INSERT INTO im_state(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value",
        );
        write.run("settings", "current", JSON.stringify(legacy));
        const guarded = !!services.get("migrations", "authorization-v1");
        write.run(
          "settings-v2",
          "current",
          JSON.stringify(guarded ? legacy : config),
        );
        if (guarded)
          write.run("settings-v3", "current", JSON.stringify(config));
        services.db.exec("RELEASE im_settings_migration");
      } catch (error) {
        services.db.exec(
          "ROLLBACK TO im_settings_migration; RELEASE im_settings_migration",
        );
        throw error;
      }
      return;
    }
    if (["actions", "operations"].includes(namespace)) {
      if (!services.secure.isEncryptionAvailable())
        throw new Error(services.text("encryptionUnavailable"));
      value = {
        encryptedImState: 2,
        sealed: services.secure
          .encryptString(JSON.stringify(value))
          .toString("base64"),
      };
    }
    services.db
      .prepare(
        "INSERT INTO im_state(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value",
      )
      .run(namespace, id, JSON.stringify(value));
  }

  function list<T>(namespace: string): T[] {
    return services.db
      .prepare("SELECT value FROM im_state WHERE namespace=? ORDER BY rowid")
      .all(namespace)
      .map((row) => services.decodeState<T>(String(row.value)));
  }

  function receipts(state: Receipt["state"]): Receipt[] {
    return services.db
      .prepare(
        "SELECT value FROM im_state WHERE namespace='receipts' AND json_extract(value,'$.state')=? ORDER BY rowid",
      )
      .all(state)
      .map((row) => services.decodeState<Receipt>(String(row.value)));
  }

  function remove(namespace: string, id: string): void {
    services.db
      .prepare("DELETE FROM im_state WHERE namespace=? AND id=?")
      .run(namespace, id);
  }
  const handlers = { get, decodeState, put, list, receipts, remove };
  return handlers;
}
