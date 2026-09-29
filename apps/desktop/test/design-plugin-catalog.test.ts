import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesignPluginCatalog } from "../src/main/design-plugin-catalog.js";

let dir: string;
let notesRoot: string;
let shapesRoot: string;

const notesManifest = {
  schemaVersion: 1,
  id: "com.artemis.s0.test-notes",
  version: "0.1.0",
  engines: { artemisPluginApi: "1" },
  projectTypes: [
    {
      id: "s0-notes",
      title: { "zh-CN": "笔记", en: "Notes" },
      targets: ["project", "temporary"],
      panelIds: ["notes"],
    },
  ],
  panels: [{ id: "notes", entry: "panel/index.html" }],
  runtime: { entry: "runtime/index.mjs", protocolVersion: 1 },
  tools: [
    {
      name: "notes_append",
      description: "Append a note.",
      effect: "artifact-write",
    },
    { name: "notes_list", description: "List notes.", effect: "state-read" },
  ],
  capabilities: {
    artifactStore: "thread",
    projectFiles: "explicit-import",
    network: "none",
    sessionInput: "host-user-action",
  },
};

const shapesManifest = {
  ...notesManifest,
  id: "com.artemis.s0.test-shapes",
  projectTypes: [
    {
      id: "s0-shapes",
      title: { "zh-CN": "图形", en: "Shapes" },
      targets: ["temporary"],
      panelIds: ["shapes"],
    },
  ],
  panels: [{ id: "shapes", entry: "panel/index.html" }],
  tools: [
    {
      name: "shapes_add",
      description: "Add a shape.",
      effect: "artifact-write",
    },
  ],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "s0-catalog-"));
  notesRoot = join(dir, "test-notes");
  shapesRoot = join(dir, "test-shapes");
  await mkdir(notesRoot, { recursive: true });
  await mkdir(shapesRoot, { recursive: true });
  await writeFile(
    join(notesRoot, "artemis.plugin.json"),
    JSON.stringify(notesManifest),
  );
  await writeFile(
    join(shapesRoot, "artemis.plugin.json"),
    JSON.stringify(shapesManifest),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DesignPluginCatalog (S0 generic host proof)", () => {
  it("loads two business-different plugins through one path with no per-plugin branches", async () => {
    const catalog = new DesignPluginCatalog();
    const loaded = await catalog.load(dir);
    expect(loaded.map((p) => p.manifest.id).sort()).toEqual([
      "com.artemis.s0.test-notes",
      "com.artemis.s0.test-shapes",
    ]);
  });

  it("computes distinct content hashes per package", async () => {
    const catalog = new DesignPluginCatalog();
    await catalog.load(dir);
    const [a, b] = catalog.list();
    expect(a.contentHash).not.toBe(b.contentHash);
    expect(a.contentHash).toHaveLength(64);
  });

  it("resolves project types generically", async () => {
    const catalog = new DesignPluginCatalog();
    await catalog.load(dir);
    expect(catalog.findByTypeId("s0-notes")?.manifest.id).toBe(
      "com.artemis.s0.test-notes",
    );
    expect(catalog.findByTypeId("s0-shapes")?.manifest.id).toBe(
      "com.artemis.s0.test-shapes",
    );
    expect(catalog.findByTypeId("nope")).toBeUndefined();
  });

  it("rejects a malformed manifest instead of skipping it silently", async () => {
    const badRoot = join(dir, "bad-plugin");
    await mkdir(badRoot, { recursive: true });
    await writeFile(
      join(badRoot, "artemis.plugin.json"),
      JSON.stringify({ schemaVersion: 1, id: "broken" }),
    );
    const catalog = new DesignPluginCatalog();
    await expect(catalog.load(dir)).rejects.toThrow();
    await rm(badRoot, { recursive: true, force: true });
  });

  it("ignores directories without a manifest", async () => {
    await mkdir(join(dir, "not-a-plugin"), { recursive: true });
    const catalog = new DesignPluginCatalog();
    const loaded = await catalog.load(dir);
    expect(loaded).toHaveLength(2);
    await rm(join(dir, "not-a-plugin"), { recursive: true, force: true });
  });

  it("loads the real S0 resource packages under apps/desktop/resources", async () => {
    const catalog = new DesignPluginCatalog();
    // Resolve from this test file's location so the check works from both the
    // repo root and the workspace root.
    const resourcesDir = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "apps",
      "desktop",
      "resources",
      "s0-plugins",
    );
    const loaded = await catalog.load(resourcesDir);
    expect(loaded.map((p) => p.manifest.id).sort()).toEqual([
      "com.artemis.s0.test-notes",
      "com.artemis.s0.test-shapes",
    ]);
  });
});
