// S1 tests: PluginRevisionStore immutability and validation rules.

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginRevisionStore } from "../src/main/design-plugin-revision-store.js";

let directory: string;
let revisionsRoot: string;
let sourceRoot: string;

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: "com.artemis.design",
  version: "0.1.0",
  engines: { artemisPluginApi: "1" },
  projectTypes: [
    {
      id: "artemis-design",
      title: { "zh-CN": "设计", en: "Design" },
      targets: ["project", "temporary"],
      panelIds: ["workspace"],
    },
  ],
  panels: [{ id: "workspace", entry: "panel/index.html" }],
  runtime: { entry: "runtime/index.mjs", protocolVersion: 1 },
  tools: [
    {
      name: "create_document",
      description: "Create a design document artifact",
      effect: "artifact-write",
    },
  ],
  capabilities: {
    artifactStore: "thread",
    projectFiles: "explicit-import",
    network: "none",
    sessionInput: "host-user-action",
  },
};

async function writeSource(overrides: Record<string, unknown> = {}) {
  await mkdir(join(sourceRoot, "panel"), { recursive: true });
  await mkdir(join(sourceRoot, "runtime"), { recursive: true });
  await writeFile(
    join(sourceRoot, "artemis.plugin.json"),
    JSON.stringify({ ...VALID_MANIFEST, ...overrides }, null, 2),
  );
  await writeFile(
    join(sourceRoot, "panel", "index.html"),
    "<!doctype html><title>panel</title>",
  );
  await writeFile(
    join(sourceRoot, "runtime", "index.mjs"),
    "console.error('runtime');",
  );
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s1-revisions-"));
  revisionsRoot = join(directory, "plugin-revisions");
  sourceRoot = join(directory, "source-pkg");
  await writeSource();
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("PluginRevisionStore", () => {
  it("publishes a revision with a parseable manifest and content hash", async () => {
    const store = new PluginRevisionStore(revisionsRoot);
    const contentHash =
      await PluginRevisionStore.computeContentHash(sourceRoot);
    const published = await store.publish({
      installationId: "com.artemis.design",
      contentHash,
      sourceRoot,
    });
    expect(published.manifest.id).toBe("com.artemis.design");
    expect(published.contentHash).toBe(contentHash);
    expect(published.revisionRoot).toBe(
      join(revisionsRoot, "com.artemis.design", contentHash),
    );
  });

  it("is idempotent when republishing identical content", async () => {
    const store = new PluginRevisionStore(revisionsRoot);
    const contentHash =
      await PluginRevisionStore.computeContentHash(sourceRoot);
    const first = await store.publish({
      installationId: "com.artemis.design",
      contentHash,
      sourceRoot,
    });
    const second = await store.publish({
      installationId: "com.artemis.design",
      contentHash,
      sourceRoot,
    });
    expect(second.revisionRoot).toBe(first.revisionRoot);
  });

  it("refuses the same content hash with different content", async () => {
    const store = new PluginRevisionStore(revisionsRoot);
    const contentHash =
      await PluginRevisionStore.computeContentHash(sourceRoot);
    // Tamper with the source but keep the stale hash.
    await writeFile(
      join(sourceRoot, "panel", "index.html"),
      "<!doctype html><title>tampered</title>",
    );
    await expect(
      store.publish({
        installationId: "com.artemis.design",
        contentHash,
        sourceRoot,
      }),
    ).rejects.toThrow(/different content/);
    // Restore for later tests.
    await writeSource();
  });

  it("rejects a broken manifest", async () => {
    const brokenRoot = join(directory, "broken-pkg");
    await mkdir(brokenRoot, { recursive: true });
    await writeFile(
      join(brokenRoot, "artemis.plugin.json"),
      '{"schemaVersion": 999}',
    );
    const store = new PluginRevisionStore(revisionsRoot);
    await expect(
      store.publish({
        installationId: "broken",
        contentHash: "deadbeef",
        sourceRoot: brokenRoot,
      }),
    ).rejects.toThrow();
  });

  it("rejects missing manifest", async () => {
    const emptyRoot = join(directory, "empty-pkg");
    await mkdir(emptyRoot, { recursive: true });
    const store = new PluginRevisionStore(revisionsRoot);
    await expect(
      store.publish({
        installationId: "empty",
        contentHash: "cafe",
        sourceRoot: emptyRoot,
      }),
    ).rejects.toThrow(/no artemis\.plugin\.json/);
  });

  it("rejects symbolic links in the package", async () => {
    const linkRoot = join(directory, "link-pkg");
    await mkdir(join(linkRoot, "panel"), { recursive: true });
    await writeFile(
      join(linkRoot, "artemis.plugin.json"),
      JSON.stringify(VALID_MANIFEST),
    );
    await symlink(
      join(sourceRoot, "panel", "index.html"),
      join(linkRoot, "panel", "index.html"),
    );
    const store = new PluginRevisionStore(revisionsRoot);
    await expect(
      store.publish({
        installationId: "link",
        contentHash: "abcd",
        sourceRoot: linkRoot,
      }),
    ).rejects.toThrow(/Symbolic link/);
  });

  it("rejects packages over 500 files", async () => {
    const manyRoot = join(directory, "many-pkg");
    await mkdir(manyRoot, { recursive: true });
    await writeFile(
      join(manyRoot, "artemis.plugin.json"),
      JSON.stringify(VALID_MANIFEST),
    );
    for (let index = 0; index < 501; index += 1) {
      await writeFile(join(manyRoot, `f-${index}.txt`), "x");
    }
    const store = new PluginRevisionStore(revisionsRoot);
    await expect(
      store.publish({
        installationId: "many",
        contentHash: "abcd",
        sourceRoot: manyRoot,
      }),
    ).rejects.toThrow(/500/);
  });

  it("lists revisions and picks a deterministic latest", async () => {
    const store = new PluginRevisionStore(revisionsRoot);
    // Publish a second, different version of the package.
    const secondRoot = join(directory, "source-pkg-v2");
    await mkdir(join(secondRoot, "panel"), { recursive: true });
    await mkdir(join(secondRoot, "runtime"), { recursive: true });
    await writeFile(
      join(secondRoot, "artemis.plugin.json"),
      JSON.stringify({ ...VALID_MANIFEST, version: "0.2.0" }),
    );
    await writeFile(join(secondRoot, "panel", "index.html"), "<p>v2</p>");
    await writeFile(join(secondRoot, "runtime", "index.mjs"), "// v2");
    const hash2 = await PluginRevisionStore.computeContentHash(secondRoot);
    await store.publish({
      installationId: "com.artemis.design",
      contentHash: hash2,
      sourceRoot: secondRoot,
    });

    const revisions = await store.list("com.artemis.design");
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    const latest = await store.latest("com.artemis.design");
    expect(latest).toBeDefined();
    const hashes = revisions.map((r) => r.contentHash).sort();
    expect(latest!.contentHash).toBe(hashes.at(-1));
    // Calling latest twice returns the same answer.
    const again = await store.latest("com.artemis.design");
    expect(again!.contentHash).toBe(latest!.contentHash);
  });
});
