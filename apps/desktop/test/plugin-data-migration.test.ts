import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  migratePluginUserData,
  rollbackPluginUserData,
} from "../src/main/plugin-data-migration.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-plugin-migration-"));
  roots.push(root);
  const skillsRoot = join(root, "skills");
  const id = "demo-0123456789";
  const cache = join(root, "codex-plugin-marketplaces", "cache");
  const plugin = {
    id,
    name: "demo",
    version: "1.0.0",
    contentHash: "a".repeat(64),
    source: {
      kind: "git",
      marketplaceUrl: "https://github.com/acme/shop.git",
      marketplaceName: "shop",
      pluginName: "demo",
    },
    skills: [{ name: "demo-skill", hash: "b".repeat(64) }],
    mcpServers: [
      { id: "plugin-demo-12345678", structuralHash: "c".repeat(64) },
    ],
  };
  await mkdir(join(root, "codex-plugins", id, ".codex-plugin"), {
    recursive: true,
  });
  await mkdir(cache, { recursive: true });
  await mkdir(join(skillsRoot, "demo-skill"), { recursive: true });
  await writeFile(
    join(root, "codex-plugins", id, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "demo" }),
  );
  await writeFile(join(cache, "signed.txt"), "original signed bytes");
  await writeFile(
    join(root, "codex-plugins.json"),
    JSON.stringify({ version: 1, plugins: [plugin] }),
  );
  await writeFile(
    join(root, "codex-plugin-marketplaces.json"),
    JSON.stringify({
      version: 1,
      selectedView: "shop-id",
      sources: [
        {
          id: "shop-id",
          cachePath: cache,
          signingKeyFingerprint: "fingerprint",
        },
      ],
    }),
  );
  await writeFile(
    join(root, "mcp.json"),
    JSON.stringify({
      version: 3,
      servers: [
        {
          id: "plugin-demo-12345678",
          enabled: true,
          args: [join(root, "codex-plugins", id, "server.mjs")],
        },
        { id: "unrelated", enabled: true },
      ],
    }),
  );
  await writeFile(
    join(skillsRoot, "demo-skill", ".artemis-skill.json"),
    JSON.stringify({
      version: 1,
      id: `codex-plugin/${id}/demo-skill`,
      source: "codex-plugin:demo",
      installedAt: "2026-10-02",
    }),
  );
  return { root, skillsRoot, id };
}

it("preserves identity, signed bytes and unrelated configuration while quarantining legacy executors", async () => {
  const f = await fixture();
  const result = await migratePluginUserData(f.root, f.skillsRoot);
  expect(result.migratedPlugins).toBe(1);
  const store = JSON.parse(
    await readFile(join(f.root, "plugins.json"), "utf8"),
  );
  expect(store.plugins[0]).toMatchObject({
    id: f.id,
    contentHash: "a".repeat(64),
    formatMigrationRequired: true,
    formatMigrationEnabledMcpIds: ["plugin-demo-12345678"],
  });
  expect(
    await readFile(
      join(f.root, "plugins", f.id, ".codex-plugin", "plugin.json"),
      "utf8",
    ),
  ).toBe('{"name":"demo"}');
  const marketplaces = JSON.parse(
    await readFile(join(f.root, "plugin-marketplaces.json"), "utf8"),
  );
  expect(marketplaces.selectedView).toBe("shop-id");
  expect(marketplaces.sources[0]).toMatchObject({
    cachePath: join(f.root, "plugin-marketplaces", "cache"),
    signingKeyFingerprint: "fingerprint",
  });
  expect(
    await readFile(
      join(f.root, "plugin-marketplaces", "cache", "signed.txt"),
      "utf8",
    ),
  ).toBe("original signed bytes");
  const mcp = JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8"));
  expect(mcp.servers.map((s: { enabled: boolean }) => s.enabled)).toEqual([
    false,
    true,
  ]);
  const skill = JSON.parse(
    await readFile(
      join(f.skillsRoot, "demo-skill", ".artemis-skill.json"),
      "utf8",
    ),
  );
  expect(skill.id).toBe(`artemis-plugin/${f.id}/demo-skill`);
  expect(skill.source).toBe("artemis-plugin:demo");
  expect(
    JSON.parse(await readFile(join(result.backupPath!, "mcp.json"), "utf8"))
      .servers[0].enabled,
  ).toBe(true);
});

it("is idempotent and does not overwrite later native changes", async () => {
  const f = await fixture();
  await migratePluginUserData(f.root, f.skillsRoot);
  await writeFile(join(f.root, "plugins.json"), "native changes");
  expect(
    (await migratePluginUserData(f.root, f.skillsRoot)).migratedPlugins,
  ).toBe(0);
  expect(await readFile(join(f.root, "plugins.json"), "utf8")).toBe(
    "native changes",
  );
});

it("preserves Skill metadata belonging to another installer", async () => {
  const f = await fixture();
  const path = join(f.skillsRoot, "demo-skill", ".artemis-skill.json");
  const metadata = JSON.stringify({
    version: 1,
    id: "codex-plugin/another-plugin/demo-skill",
    source: "codex-plugin:another-plugin",
  });
  await writeFile(path, metadata);
  await migratePluginUserData(f.root, f.skillsRoot);
  expect(await readFile(path, "utf8")).toBe(metadata);
});

it("rejects duplicate Skill ownership before disabling services", async () => {
  const f = await fixture();
  const path = join(f.root, "codex-plugins.json");
  const store = JSON.parse(await readFile(path, "utf8"));
  store.plugins.push({ ...store.plugins[0], id: "another-plugin" });
  await writeFile(path, JSON.stringify(store));
  await expect(migratePluginUserData(f.root, f.skillsRoot)).rejects.toThrow(
    /ownership is duplicated/,
  );
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(true);
});

it("restores an unchanged migration and can migrate again without losing its backup", async () => {
  const f = await fixture();
  await migratePluginUserData(f.root, f.skillsRoot);
  await rollbackPluginUserData(f.root, f.skillsRoot);
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(true);
  expect(
    JSON.parse(await readFile(join(f.root, "codex-plugins.json"), "utf8"))
      .plugins[0].id,
  ).toBe(f.id);
  expect(
    (await migratePluginUserData(f.root, f.skillsRoot)).migratedPlugins,
  ).toBe(1);
});

it("refuses rollback after user changes without partially restoring anything", async () => {
  const f = await fixture();
  await migratePluginUserData(f.root, f.skillsRoot);
  await writeFile(join(f.root, "plugins.json"), "user changes");
  await expect(rollbackPluginUserData(f.root, f.skillsRoot)).rejects.toThrow(
    /changed/,
  );
  expect(await readFile(join(f.root, "plugins.json"), "utf8")).toBe(
    "user changes",
  );
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(false);
});

it("resumes a prepared migration after a directory was moved", async () => {
  const f = await fixture();
  const result = await migratePluginUserData(f.root, f.skillsRoot);
  const journalPath = join(f.root, "plugin-format-migration.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.status = "prepared";
  await writeFile(journalPath, JSON.stringify(journal));
  await rm(join(f.root, "plugins.json"));
  await writeFile(
    join(f.root, "mcp.json"),
    await readFile(join(result.backupPath!, "mcp.json")),
  );
  await migratePluginUserData(f.root, f.skillsRoot);
  expect(
    JSON.parse(await readFile(join(f.root, "plugins.json"), "utf8")).plugins[0]
      .id,
  ).toBe(f.id);
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(false);
});

it("fails before mutation when native and legacy destinations conflict", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "plugins"));
  await expect(migratePluginUserData(f.root, f.skillsRoot)).rejects.toThrow(
    /conflict/i,
  );
  expect(
    await readFile(
      join(f.root, "codex-plugins", f.id, ".codex-plugin", "plugin.json"),
      "utf8",
    ),
  ).toBe('{"name":"demo"}');
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(true);
});

it("restarts an interrupted backup preparation without touching original data", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "plugin-format-migration-backup"));
  await writeFile(
    join(f.root, "plugin-format-migration-backup", "incomplete.txt"),
    "partial",
  );
  await writeFile(
    join(f.root, "plugin-format-migration.json"),
    JSON.stringify({
      version: 1,
      status: "preparing",
      migratedPlugins: 1,
      skills: ["demo-skill"],
    }),
  );
  expect(
    (await migratePluginUserData(f.root, f.skillsRoot)).migratedPlugins,
  ).toBe(1);
  expect(
    JSON.parse(await readFile(join(f.root, "plugins.json"), "utf8")).plugins[0]
      .id,
  ).toBe(f.id);
});

it("rejects symlink destinations and unsafe stored skill paths before writing", async () => {
  const f = await fixture();
  await symlink(
    f.skillsRoot,
    join(f.root, "plugins"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(migratePluginUserData(f.root, f.skillsRoot)).rejects.toThrow();
  await rm(join(f.root, "plugins"));
  const store = JSON.parse(
    await readFile(join(f.root, "codex-plugins.json"), "utf8"),
  );
  store.plugins[0].skills[0].name = "../outside";
  await writeFile(join(f.root, "codex-plugins.json"), JSON.stringify(store));
  await expect(migratePluginUserData(f.root, f.skillsRoot)).rejects.toThrow(
    /skill/i,
  );
  expect(
    JSON.parse(await readFile(join(f.root, "mcp.json"), "utf8")).servers[0]
      .enabled,
  ).toBe(true);
});
