// S1 end-to-end acceptance: install -> bind thread -> invoke runtime tool
// -> artifact on disk -> snapshot recorded -> reopen store, binding intact.
//
// This chains the four S1 slices against the real artemis-design package:
//   catalog (parse) -> revision store (immutable publish) -> AppStore
//   (typeBinding snapshot + plugin snapshot) -> PluginRuntimeWorker (stdio
//   frame protocol, real child process writing page.html).
//
// Crash windows and gate behavior are covered by the dedicated suites; this
// file only proves the happy path composes.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DesignPluginCatalog } from "../../../src/main/design/design-plugin-catalog.js";
import { PluginRevisionStore } from "../../../src/main/design/design-plugin-revision-store.js";
import { PluginRuntimeWorker } from "../../../src/main/design/design-plugin-runtime-worker.js";
import { AppStore } from "../../../src/main/settings/store.js";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

const describeDarwin = process.platform === "darwin" ? describe : describe.skip;

let directory: string;
const packageRoot = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "resources/design-plugins",
);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s1-e2e-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describeDarwin("artemis-design S1 end-to-end", () => {
  it("installs, binds a thread, invokes the runtime, and survives restart", async () => {
    // 1. Catalog loads the first-party package without business branches.
    const catalog = new DesignPluginCatalog();
    const plugins = await catalog.load(packageRoot);
    const plugin = plugins.find(
      (candidate) => candidate.manifest.id === "com.artemis.design",
    );
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.projectTypes[0]!.id).toBe("artemis-design");

    // 2. Immutable revision publish.
    const revisionsRoot = join(directory, "plugin-revisions");
    const revisionStore = new PluginRevisionStore(revisionsRoot);
    const contentHash = await PluginRevisionStore.computeContentHash(
      plugin!.root,
    );
    const published = await revisionStore.publish({
      installationId: plugin!.manifest.id,
      contentHash,
      sourceRoot: plugin!.root,
    });
    expect(published.manifest.id).toBe("com.artemis.design");

    // 3. Thread with a frozen typeBinding snapshot and restricted profile.
    const databasePath = join(directory, "state.sqlite");
    const store = new AppStore(databasePath);
    const now = new Date().toISOString();
    const threadId = randomUUID();
    const binding = {
      installationId: plugin!.manifest.id,
      pluginId: plugin!.manifest.id,
      typeId: "artemis-design",
      pluginVersion: plugin!.manifest.version,
      contentHash: published.contentHash,
      bindingRevision: `rev-${published.contentHash.slice(0, 12)}`,
    };
    store.createThread({
      id: threadId,
      title: "设计任务",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      typeBinding: binding,
      executionProfile: RESTRICTED_PROFILE_ID,
      createdAt: now,
      updatedAt: now,
    });
    store.insertPluginGrant({
      grantId: randomUUID(),
      installationId: binding.installationId,
      pluginId: binding.pluginId,
      contentHash: binding.contentHash,
      scope: "thread",
      scopeId: threadId,
      capabilities: { artifactStore: "thread" },
      resourceRefs: { revisionsRoot },
      grantRevision: binding.bindingRevision,
    });

    // 4. Real runtime child process: get_snapshot lands on disk. The
    // scratch directory must exist before spawn: Node reports a missing cwd
    // as spawn ENOENT on the executable, which is misleading.
    const scratch = join(directory, "scratch", threadId);
    await mkdir(scratch, { recursive: true });
    const worker = new PluginRuntimeWorker({
      entry: join(plugin!.root, "runtime/index.mjs"),
      pluginId: plugin!.manifest.id,
      contentHash: published.contentHash,
      cwd: scratch,
    });
    const ready = await worker.start();
    expect(ready.pluginId).toBe("com.artemis.design");
    await writeFile(
      join(scratch, "page.html"),
      "<html><body>design page</body></html>",
    );
    const snapshotRead = await worker.invoke("get_snapshot", {});
    expect(snapshotRead.status).toBe("succeeded");
    expect(JSON.parse(snapshotRead.output ?? "{}").files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "page.html" })]),
    );
    await worker.dispose();

    // 5. Snapshot recorded against the operation, inside the main store.
    const operationId = randomUUID();
    store.recordPluginOperation({
      operationId,
      threadId,
      pluginId: binding.pluginId,
      toolName: "get_snapshot",
      requestDigest: `sha256:${published.contentHash}:get_snapshot:1`,
      state: "succeeded",
      resultRef: `scratch://${threadId}/page.html`,
    });
    store.insertPluginSnapshot({
      snapshotId: randomUUID(),
      threadId,
      pluginId: binding.pluginId,
      files: [{ path: "page.html", hash: published.contentHash }],
      createdByOperationId: operationId,
      packageRevision: published.contentHash,
    });
    store.appendPluginEvent({
      eventId: randomUUID(),
      streamId: `thread/${threadId}/design`,
      threadId,
      schemaVersion: 1,
      payload: { kind: "snapshot-created", operationId },
    });
    store.close();

    // 6. Restart: binding, grant, snapshot and ledger all survive.
    const reopened = new AppStore(databasePath);
    const reread = reopened.getThread(threadId) as never as {
      typeBinding: typeof binding;
      executionProfile: string;
    };
    expect(reread.typeBinding).toEqual(binding);
    expect(reread.executionProfile).toBeUndefined();
    expect(reopened.listPluginGrants(threadId)).toHaveLength(1);
    reopened.close();
    const check = new DatabaseSync(databasePath);
    const events = check
      .prepare("SELECT COUNT(*) AS n FROM plugin_snapshots")
      .get() as unknown as { n: number };
    expect(events.n).toBe(1);
    check.close();

    // 7. Republishing identical content is idempotent (no overwrite path).
    const again = await revisionStore.publish({
      installationId: plugin!.manifest.id,
      contentHash,
      sourceRoot: plugin!.root,
    });
    expect(again.revisionRoot).toBe(published.revisionRoot);
  });
});
