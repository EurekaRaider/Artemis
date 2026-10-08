import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { isRestrictedDesignThread } from "@artemis/protocol";
import { AppStore } from "../../../src/main/settings/store.js";
import { PluginRevisionStore } from "../../../src/main/design/design-plugin-revision-store.js";
import { changeDesignThreadPermissions } from "../../../src/main/design/design-thread-permissions.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "design-permissions-"));
  roots.push(root);
  const path = join(root, "store.sqlite");
  const store = new AppStore(path);
  const source = fileURLToPath(
    new URL(
      "../../../resources/design-plugins/artemis-design",
      import.meta.url,
    ),
  );
  const contentHash = await PluginRevisionStore.computeContentHash(source);
  const revisionsRoot = join(root, "revisions");
  const revision = await new PluginRevisionStore(revisionsRoot).publish({
    installationId: "design",
    contentHash,
    sourceRoot: source,
  });
  const now = new Date().toISOString();
  store.upsertProject({
    id: "project",
    name: "Project",
    path: root,
    createdAt: now,
    updatedAt: now,
  });
  const binding = {
    installationId: "design",
    pluginId: "com.artemis.design",
    typeId: "artemis-design",
    pluginVersion: "0.4.6",
    contentHash,
    bindingRevision: "rev",
  };
  store.createThread({
    id: "thread",
    projectId: "project",
    title: "Design",
    mode: "work",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    typeBinding: binding,
    executionProfile: "plugin-restricted-v1",
  });
  const grantId = randomUUID();
  store.insertPluginGrant({
    grantId,
    installationId: binding.installationId,
    pluginId: binding.pluginId,
    contentHash,
    scope: "thread",
    scopeId: "thread",
    capabilities: { artifactStore: "thread" },
    resourceRefs: { revisionsRoot },
    grantRevision: binding.bindingRevision,
  });
  const closeSession = vi.fn(async () => {
    expect(isRestrictedDesignThread(store.getThread("thread")!)).toBe(true);
  });
  return {
    root,
    path,
    store,
    binding,
    revision,
    grantId,
    input: {
      threadId: "thread",
      permission: "standard" as const,
      store,
      revisionsRoot,
      busy: () => false,
      unavailable: async () => null,
      closeSession,
    },
  };
}
it("upgrades only after closing the old session and persists the explicit choice", async () => {
  const f = await fixture();
  let closed = false;
  try {
    const next = await changeDesignThreadPermissions(f.input);
    expect(next.executionProfile).toBe("plugin-standard-v1");
    expect(f.input.closeSession).toHaveBeenCalledOnce();
    // Content changes still need fresh plugin grants; rebinding never expands permission.
    f.store.updateThread("thread", {
      typeBinding: { ...f.binding, bindingRevision: "new" },
    });
    expect(f.store.getThread("thread")?.executionProfile).toBe(
      "plugin-standard-v1",
    );
    f.store.close();
    closed = true;
    const reopened = new AppStore(f.path);
    expect(reopened.getThread("thread")?.executionProfile).toBe(
      "plugin-standard-v1",
    );
    reopened.close();
  } finally {
    if (!closed) f.store.close();
  }
});
it.each([
  "busy",
  "unavailable",
  "revoked",
  "tampered",
  "race",
  "close-failed",
  "invalid",
])(
  "refuses %s permission changes without upgrading or replaying",
  async (kind) => {
    const f = await fixture();
    try {
      if (kind === "busy") f.input.busy = () => true;
      if (kind === "unavailable")
        f.input.unavailable = async () => "Plugin removed" as never;
      if (kind === "revoked")
        f.store.database
          .prepare("UPDATE plugin_grants SET revoked_at = ? WHERE grant_id = ?")
          .run(new Date().toISOString(), f.grantId);
      if (kind === "tampered")
        await writeFile(
          join(f.revision.revisionRoot, "tampered.txt"),
          "untrusted",
        );
      if (kind === "race")
        f.input.closeSession.mockImplementation(async () => {
          f.input.busy = () => true;
        });
      if (kind === "close-failed")
        f.input.closeSession.mockRejectedValue(new Error("Active old turn"));
      if (kind === "invalid")
        f.input.permission = "from-plugin-message" as never;
      await expect(changeDesignThreadPermissions(f.input)).rejects.toThrow();
      expect(isRestrictedDesignThread(f.store.getThread("thread")!)).toBe(true);
      expect(f.store.getThread("thread")?.executionProfile).toBe(
        "plugin-restricted-v1",
      );
    } finally {
      f.store.close();
    }
  },
);
it.each([undefined, "unknown", "plugin-restricted-v1"])(
  "missing or invalid bound permissions remain restricted: %s",
  (executionProfile) => {
    expect(
      isRestrictedDesignThread({ typeBinding: {}, executionProfile }),
    ).toBe(true);
    expect(isRestrictedDesignThread({})).toBe(false);
  },
);
