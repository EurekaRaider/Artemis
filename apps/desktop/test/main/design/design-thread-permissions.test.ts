import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppStore } from "../../../src/main/settings/store.js";

it.each(["plugin-restricted-v1", "plugin-standard-v1", "unknown", null])(
  "reopens legacy Design profile %s using ordinary permissions without losing binding or mode",
  async (profile) => {
    const root = await mkdtemp(join(tmpdir(), "design-permissions-"));
    const path = join(root, "store.sqlite");
    let store = new AppStore(path);
    const now = new Date().toISOString();
    const binding = {
      installationId: "design",
      pluginId: "com.artemis.design",
      typeId: "artemis-design",
      pluginVersion: "0.4.6",
      contentHash: "a".repeat(64),
      bindingRevision: "rev",
    };
    try {
      store.createThread({
        id: "thread",
        title: "Design",
        mode: "plan",
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
        typeBinding: binding,
      });
      store.database
        .prepare("UPDATE threads SET execution_profile = ? WHERE id = ?")
        .run(profile, "thread");
      store.close();
      store = new AppStore(path);
      expect(store.getThread("thread")).toMatchObject({
        mode: "plan",
        typeBinding: binding,
      });
      expect(store.getThread("thread")?.executionProfile).toBeUndefined();
      expect(
        store.database
          .prepare("SELECT execution_profile FROM threads WHERE id = ?")
          .get("thread"),
      ).toEqual({ execution_profile: null });
      store.updateThread("thread", {
        typeBinding: { ...binding, bindingRevision: "new" },
      });
      expect(store.getThread("thread")?.executionProfile).toBeUndefined();
      expect(
        store.database
          .prepare("SELECT execution_profile FROM threads WHERE id = ?")
          .get("thread"),
      ).toEqual({ execution_profile: null });
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
