import { imSettingsSchema } from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
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

  function remove(namespace: string, id: string): void {
    services.db
      .prepare("DELETE FROM im_state WHERE namespace=? AND id=?")
      .run(namespace, id);
  }
  const handlers = { get, decodeState, put, list, remove };
  return handlers;
}
