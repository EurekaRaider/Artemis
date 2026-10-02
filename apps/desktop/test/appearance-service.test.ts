import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artemisThemeManifest,
  artemisTokenDocuments,
} from "../../../packages/theme-artemis/src/index.js";
import { ArtemisPluginService } from "../src/main/artemis-plugin-service.js";
import { McpConfigStore } from "../src/main/mcp-config-store.js";
import { AppearanceService } from "../src/main/appearance-service.js";
import type { SkinSelection } from "../src/shared/appearance.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function writePlugin(
  root: string,
  name = "ocean",
  id = "com.example.ocean",
) {
  const skin = join(root, "skins", "ocean.artemis-skin");
  await mkdir(join(skin, "assets"), { recursive: true });
  await writeFile(
    join(root, "artemis.plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      name,
      version: "1.0.0",
      skins: ["./skins/ocean.artemis-skin/"],
    }),
  );
  const manifest = {
    ...artemisThemeManifest,
    id,
    schemaVersion: 2,
    assets: { wallpaper: { path: "assets/a.png", kind: "image" } },
    backgrounds: {
      light: { type: "image", asset: "wallpaper" },
      dark: { type: "image", asset: "wallpaper" },
    },
  };
  const data: Record<string, Buffer> = {
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    ...Object.fromEntries(
      Object.entries(artemisTokenDocuments).map(([p, v]) => [
        p,
        Buffer.from(JSON.stringify({ ...v, skinId: id })),
      ]),
    ),
    "assets/a.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  };
  for (const [p, bytes] of Object.entries(data))
    await writeFile(join(skin, p), bytes);
  await writeFile(
    join(skin, "integrity.json"),
    JSON.stringify({
      schemaVersion: 2,
      algorithm: "sha256",
      files: Object.fromEntries(
        Object.entries(data).map(([p, b]) => [
          p,
          createHash("sha256").update(b).digest("hex"),
        ]),
      ),
    }),
  );
}
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "appearance-test-")),
  );
  roots.push(root);
  let selected: SkinSelection | null = null;
  let appearance: AppearanceService;
  const service = new ArtemisPluginService({
    skillsRoot: join(root, "skills"),
    pluginsRoot: join(root, "plugins"),
    marketplacesRoot: join(root, "markets"),
    marketplaceStatePath: join(root, "markets.json"),
    statePath: join(root, "plugins.json"),
    mcpWorkspaceRoot: join(root, "mcp"),
    mcpStore: new McpConfigStore(join(root, "mcp.json")),
    beforeSnapshotChange: (id) => appearance.beforePluginChange(id),
    afterSnapshotChange: async () => {
      await appearance.refresh();
    },
  });
  appearance = new AppearanceService({
    plugins: service,
    getSelection: async () => selected,
    saveSelection: async (v) => {
      selected = v;
    },
    getTheme: async () => "dark",
    changed: () => {},
  });
  await writePlugin(join(root, "source"));
  await appearance.refresh();
  const { plugin } = await service.install({
    kind: "local",
    path: join(root, "source"),
  });
  return { root, service, appearance, plugin };
}
describe("skin lifecycle and opaque resource protocol", () => {
  it("revokes requests still opening files before snapshot replacement", async () => {
    const { appearance, plugin } = await fixture();
    const resolved = await appearance.resolve(7, {
      pluginId: plugin.id,
      skinId: "com.example.ocean",
    });
    const pending = appearance.respond(
      new Request(resolved.assets.wallpaper!.url),
    );
    await appearance.beforePluginChange(plugin.id);
    expect((await pending).status).toBe(409);
    expect(
      (await appearance.respond(new Request(resolved.assets.wallpaper!.url)))
        .status,
    ).toBe(404);
  });
  it("bounds simultaneous resource preparations as well as active leases", async () => {
    const { appearance, plugin } = await fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        appearance.resolve(7, {
          pluginId: plugin.id,
          skinId: "com.example.ocean",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(8);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    await appearance.dispose();
  });
  it("installs a pure skin, permits reinstall, rejects another owner's ID without replacing it", async () => {
    const { root, service, plugin } = await fixture();
    expect(plugin.skins).toHaveLength(1);
    expect(plugin.skinsEnabled).toBe(true);
    const reinstalled = await service.install(plugin.source);
    expect(reinstalled.plugin.id).toBe(plugin.id);
    await writePlugin(join(root, "other"), "other");
    await expect(
      service.install({ kind: "local", path: join(root, "other") }),
    ).rejects.toThrow(/already installed/);
    expect(await service.listInstalled()).toHaveLength(1);
  });
  it("keeps the selected skin on disable and restores it; remove clears it", async () => {
    const { service, appearance, plugin } = await fixture();
    const selection = { pluginId: plugin.id, skinId: "com.example.ocean" };
    await appearance.select(selection);
    await service.setSkinsEnabled(plugin.id, false);
    expect(appearance.state().selection).toEqual(selection);
    expect(appearance.state().catalog[0]?.available).toBe(false);
    await service.setSkinsEnabled(plugin.id, true);
    expect(appearance.state().catalog[0]?.available).toBe(true);
    await service.remove(plugin.id);
    expect(appearance.state().selection).toBeNull();
  });
  it("serves only issued resources with range support and owner-scoped release", async () => {
    const { appearance, plugin } = await fixture();
    const resolved = await appearance.resolve(7, {
      pluginId: plugin.id,
      skinId: "com.example.ocean",
    });
    const url = resolved.assets.wallpaper!.url;
    expect(
      (await appearance.respond(new Request("artemis-skin://asset/not-issued")))
        .status,
    ).toBe(404);
    const part = await appearance.respond(
      new Request(url, { headers: { Range: "bytes=0-7" } }),
    );
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(8);
    expect(
      (
        await appearance.respond(
          new Request(url, { headers: { Range: "bytes=9999-" } }),
        )
      ).status,
    ).toBe(416);
    expect(
      (
        await appearance.respond(
          new Request(url, { headers: { Range: "bytes=0-1,4-5" } }),
        )
      ).status,
    ).toBe(416);
    await appearance.release(8, resolved.leaseId);
    expect(
      (await appearance.respond(new Request(url, { method: "HEAD" }))).status,
    ).toBe(200);
    await appearance.release(7, resolved.leaseId);
    expect((await appearance.respond(new Request(url))).status).toBe(404);
  });
  it("revokes an active stream before replacing the snapshot and issues a new revision", async () => {
    const { appearance, plugin, service } = await fixture();
    const resolved = await appearance.resolve(7, {
      pluginId: plugin.id,
      skinId: "com.example.ocean",
    });
    const url = resolved.assets.wallpaper!.url;
    const response = await appearance.respond(new Request(url));
    await response.arrayBuffer();
    await service.update(plugin.id);
    expect((await appearance.respond(new Request(url))).status).toBe(404);
    expect(appearance.state().revision).toBeGreaterThan(resolved.revision);
  });
  it("refuses replaced files after issuing a lease", async () => {
    const { appearance, plugin, root } = await fixture();
    const resolved = await appearance.resolve(7, {
      pluginId: plugin.id,
      skinId: "com.example.ocean",
    });
    const url = resolved.assets.wallpaper!.url;
    const file = join(
      root,
      "plugins",
      plugin.id,
      "skins/ocean.artemis-skin/assets/a.png",
    );
    await writeFile(file, await readFile(file));
    expect((await appearance.respond(new Request(url))).status).toBe(409);
    await appearance.dispose();
  });
});
