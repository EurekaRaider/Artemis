import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { c as createTar } from "tar";

import { ArtemisPluginService } from "../src/main/artemis-plugin-service.js";
import { McpConfigStore } from "../src/main/mcp-config-store.js";
import type { McpServerConfig } from "../src/shared/api.js";
import { McpClientManager } from "../src/main/mcp-client-manager.js";

it("blocks migrated stdio and HTTP packages before their factory and restores their individual enablement on update", async () => {
  const root = await temporaryRoot();
  const source = join(root, "source");
  await writePlugin(source);
  const first = createService(root);
  const installed = await first.service.install({
    kind: "local",
    path: source,
  });
  const configs = await first.mcpStore.list();
  await first.mcpStore.replaceAll(
    configs.map((config) => ({ ...config, enabled: false })),
  );
  const statePath = join(root, "user-data", "plugins.json");
  const store = JSON.parse(await readFile(statePath, "utf8"));
  store.plugins[0].formatMigrationRequired = true;
  store.plugins[0].formatMigrationEnabledMcpIds = [configs[0].id];
  await writeFile(statePath, JSON.stringify(store));
  const { service, mcpStore } = createService(root);
  expect(await service.hookSources()).toEqual([]);
  let executed = 0;
  const manager = new McpClientManager(
    process.platform,
    undefined,
    async () => {
      executed++;
      throw new Error("factory must not run");
    },
    undefined,
    (config) => service.mcpRuntimeReadOnlyPaths(config),
  );
  for (const config of configs) {
    const status = await manager.connect(config);
    expect(status.error).toMatch(/native format/);
  }
  expect(executed).toBe(0);
  const updated = await service.update(installed.plugin.id);
  expect(updated.plugin.id).toBe(installed.plugin.id);
  expect(updated.plugin.formatMigrationRequired).toBeUndefined();
  expect((await mcpStore.list()).map((config) => config.enabled)).toEqual([
    true,
    false,
  ]);
  expect(await service.hookSources()).toHaveLength(1);
});

it("rejects legacy-only packages and unknown native schema versions before installation", async () => {
  const root = await temporaryRoot();
  const source = join(root, "source");
  await mkdir(join(source, ".codex-plugin"), { recursive: true });
  await writeFile(
    join(source, ".codex-plugin", "plugin.json"),
    '{"name":"legacy"}',
  );
  const { service, mcpStore } = createService(root);
  await expect(
    service.install({ kind: "local", path: source }),
  ).rejects.toThrow(/artemis\.plugin\.json/);
  await writePlugin(source);
  const path = join(source, "artemis.plugin.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.schemaVersion = 2;
  await writeFile(path, JSON.stringify(manifest));
  await expect(
    service.install({ kind: "local", path: source }),
  ).rejects.toThrow(/schema version/i);
  expect(await mcpStore.list()).toEqual([]);
  expect(await service.listInstalled()).toEqual([]);
});

it("restores a missing owned Skill during native migration while ordinary updates reject it", async () => {
  const root = await temporaryRoot();
  const source = join(root, "source");
  await writePlugin(source);
  const first = createService(root);
  const installed = await first.service.install({
    kind: "local",
    path: source,
  });
  const skillPath = join(
    root,
    "home",
    ".pi",
    "agent",
    "skills",
    "hello-plugin",
  );
  await rm(skillPath, { recursive: true });
  await expect(first.service.update(installed.plugin.id)).rejects.toThrow(
    /Skill is missing/,
  );
  const statePath = join(root, "user-data", "plugins.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.plugins[0].formatMigrationRequired = true;
  await writeFile(statePath, JSON.stringify(state));
  const migrated = createService(root).service;
  const updated = await migrated.update(installed.plugin.id);
  expect(updated.plugin.id).toBe(installed.plugin.id);
  expect(updated.plugin.formatMigrationRequired).toBeUndefined();
  expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toContain(
    "name: hello",
  );
});

it("keeps a modified owned Skill intact during native migration", async () => {
  const root = await temporaryRoot();
  const source = join(root, "source");
  await writePlugin(source);
  const first = createService(root);
  const installed = await first.service.install({
    kind: "local",
    path: source,
  });
  const skillPath = join(
    root,
    "home",
    ".pi",
    "agent",
    "skills",
    "hello-plugin",
    "SKILL.md",
  );
  await writeFile(skillPath, "User changes");
  const statePath = join(root, "user-data", "plugins.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.plugins[0].formatMigrationRequired = true;
  await writeFile(statePath, JSON.stringify(state));
  await expect(
    createService(root).service.update(installed.plugin.id),
  ).rejects.toThrow(/Skill was modified/);
  expect(await readFile(skillPath, "utf8")).toBe("User changes");
});

const temporaryDirectories: string[] = [];
const bundledArtifactRoot = fileURLToPath(
  new URL("../resources/bundled-artifact-plugins", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(prefix = "artemis-plugin-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

function createService(
  root: string,
  options: {
    mcpStore?: McpConfigStore;
    bundledArtifactRoot?: string;
    computerUseRoot?: string;
    cloneRepository?: (url: string, destination: string) => Promise<void>;
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  const mcpStore =
    options.mcpStore ?? new McpConfigStore(join(root, "user-data", "mcp.json"));
  return {
    mcpStore,
    service: new ArtemisPluginService({
      skillsRoot: join(root, "home", ".pi", "agent", "skills"),
      pluginsRoot: join(root, "user-data", "plugins"),
      marketplacesRoot: join(root, "user-data", "plugin-marketplaces"),
      marketplaceStatePath: join(root, "user-data", "plugin-marketplaces.json"),
      statePath: join(root, "user-data", "plugins.json"),
      mcpWorkspaceRoot: join(root, "user-data", "mcp-workspaces"),
      mcpStore,
      ...(options.computerUseRoot
        ? { computerUseRoot: options.computerUseRoot }
        : {}),
      ...(options.bundledArtifactRoot
        ? { bundledArtifactRoot: options.bundledArtifactRoot }
        : {}),
      ...(options.cloneRepository
        ? { cloneRepository: options.cloneRepository }
        : {}),
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    }),
  };
}

async function writePlugin(
  pluginRoot: string,
  options: {
    version?: string;
    skillBody?: string;
    mcpUrl?: string;
    declareMcp?: boolean;
  } = {},
) {
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(join(pluginRoot, "skills", "hello", "references"), {
    recursive: true,
  });
  await mkdir(join(pluginRoot, "mcp"), { recursive: true });
  await mkdir(join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    join(pluginRoot, "artemis.plugin.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: "demo-tools",
      version: options.version ?? "1.0.0",
      description: "A portable Artemis plugin.",
      skills: "./skills/",
      ...(options.declareMcp === false ? {} : { mcpServers: "./.mcp.json" }),
      hooks: "./hooks/hooks.json",
      interface: { displayName: "Demo Tools" },
    })}\n`,
  );
  await writeFile(
    join(pluginRoot, "skills", "hello", "SKILL.md"),
    `---\nname: hello-plugin\ndescription: Use the portable plugin.\n---\n\n${
      options.skillBody ?? "Version one"
    }\n`,
  );
  await writeFile(
    join(pluginRoot, "skills", "hello", "references", "usage.md"),
    "Use it carefully.",
  );
  await writeFile(join(pluginRoot, "mcp", "server.mjs"), "// server\n");
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    `${JSON.stringify({
      mcpServers: {
        local: {
          command: "node",
          args: ["\${PLUGIN_ROOT}/mcp/server.mjs"],
          env: { API_TOKEN: "$API_TOKEN", LITERAL_SECRET: "do-not-copy" },
        },
        docs: {
          type: "http",
          url: options.mcpUrl ?? "https://docs.example.test/mcp",
          oauth_resource: options.mcpUrl ?? "https://docs.example.test/mcp",
        },
      },
    })}\n`,
  );
  await writeFile(join(pluginRoot, "hooks", "hooks.json"), '{"hooks":{}}\n');
}

async function writeMarketplaceRepository(
  repository: string,
  options: {
    name: string;
    displayName: string;
    pluginDirectory?: string;
  },
) {
  const pluginDirectory = options.pluginDirectory ?? "demo-tools";
  await writePlugin(join(repository, "plugins", pluginDirectory));
  await mkdir(join(repository, ".artemis"), { recursive: true });
  await writeFile(
    join(repository, ".artemis", "marketplace.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: options.name,
      interface: { displayName: options.displayName },
      plugins: [
        {
          name: pluginDirectory,
          source: {
            source: "local",
            path: `./plugins/${pluginDirectory}`,
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Developer Tools",
        },
      ],
    })}\n`,
  );
}

async function signMarketplaceRepository(
  repository: string,
  privateKey: KeyObject = generateKeyPairSync("ed25519").privateKey,
  sourceUrl?: string,
) {
  const marketplacePath = join(repository, ".artemis", "marketplace.json");
  const marketplaceBytes = await readFile(marketplacePath);
  const marketplace = JSON.parse(marketplaceBytes.toString("utf8")) as {
    name: string;
    plugins: Array<{ name: string; source: { path: string } }>;
  };
  const plugins = [];
  for (const entry of marketplace.plugins) {
    const pluginRoot = join(repository, entry.source.path);
    const files: Array<{ path: string; size: number; sha256: string }> = [];
    const visit = async (directory: string, relativeRoot = "") => {
      for (const child of await readdir(directory, { withFileTypes: true })) {
        const relativePath = relativeRoot
          ? `${relativeRoot}/${child.name}`
          : child.name;
        const path = join(directory, child.name);
        if (child.isDirectory()) await visit(path, relativePath);
        else {
          const contents = await readFile(path);
          files.push({
            path: relativePath,
            size: contents.byteLength,
            sha256: createHash("sha256").update(contents).digest("hex"),
          });
        }
      }
    };
    await visit(pluginRoot);
    files.sort((left, right) => left.path.localeCompare(right.path, "en"));
    const digest = createHash("sha256");
    for (const file of files) {
      digest.update(file.path).update("\0").update(file.sha256).update("\0");
    }
    const manifest = JSON.parse(
      await readFile(join(pluginRoot, "artemis.plugin.json"), "utf8"),
    ) as { version: string };
    plugins.push({
      name: entry.name,
      version: manifest.version,
      contentHash: digest.digest("hex"),
      size: files.reduce((sum, file) => sum + file.size, 0),
      files,
    });
  }
  const publicDer = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  const fingerprint = createHash("sha256").update(publicDer).digest("hex");
  const unsigned = {
    schemaVersion: 1,
    marketplaceName: marketplace.name,
    marketplaceHash: createHash("sha256")
      .update(marketplaceBytes)
      .digest("hex"),
    signatureAlgorithm: "Ed25519",
    publicKey: publicDer.toString("base64"),
    signingKeyFingerprint: fingerprint,
    signedAt: "2026-08-09T00:00:00.000Z",
    ...(sourceUrl ? { sourceUrl } : {}),
    plugins,
  };
  const canonical = JSON.stringify(stableObject(unsigned));
  await mkdir(join(repository, ".artemis"), { recursive: true });
  await writeFile(
    join(repository, ".artemis", "integrity.json"),
    `${JSON.stringify({
      ...unsigned,
      signature: sign(null, Buffer.from(canonical), privateKey).toString(
        "base64",
      ),
    })}\n`,
  );
  return { privateKey, fingerprint };
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableObject(child)]),
  );
}

describe("ArtemisPluginService", () => {
  it("grants runtime reads only to the unchanged installed MCP owner", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    const preview = await service.inspectLocal(source);
    const { plugin } = await service.install(preview.source);
    const config = (await mcpStore.list()).find(
      (server) => server.transport === "stdio",
    )!;
    const pluginDirectory = join(root, "user-data", "plugins", plugin.id);
    expect(await service.mcpRuntimeReadOnlyPaths(config)).toEqual([
      await realpath(pluginDirectory),
    ]);
    expect(
      await service.mcpRuntimeReadOnlyPaths({ ...config, id: "unowned" }),
    ).toEqual([]);
    await expect(
      service.mcpRuntimeReadOnlyPaths({
        ...config,
        args: ["/unrelated/server.mjs"],
      } as McpServerConfig),
    ).rejects.toThrow(/configuration changed/);
    await writeFile(join(pluginDirectory, "mcp", "server.mjs"), "modified");
    await expect(service.mcpRuntimeReadOnlyPaths(config)).rejects.toThrow(
      /contents changed/,
    );
  });

  it("replaces an intact historical plugin whose rejected connection was removed from the runtime", async () => {
    const root = await temporaryRoot(),
      repository = join(root, "repository");
    await writeMarketplaceRepository(repository, {
      name: "replacement-tools",
      displayName: "Replacement tools",
    });
    const pluginRoot = join(repository, "plugins", "demo-tools");
    const oldMcp = {
      mcpServers: {
        google: {
          command: "${ARTEMIS_NODE}",
          args: ["${PLUGIN_ROOT}/mcp/server.mjs"],
          "x-artemis": { auth: { provider: "google", grant: "gmail" } },
        },
      },
    };
    await writeFile(join(pluginRoot, ".mcp.json"), JSON.stringify(oldMcp));
    const key = await signMarketplaceRepository(repository);
    const cloneRepository = async (_url: string, destination: string) =>
      cp(repository, destination, { recursive: true });
    const first = createService(root, { cloneRepository });
    const catalog = await first.service.addMarketplace(
      "acme/replacement-tools",
      undefined,
      key.fingerprint,
    );
    const preview = catalog.marketplaces[0]!.marketplace.plugins[0]!;
    expect(preview.installable).toBe(false);
    const integrity = JSON.parse(
      await readFile(join(repository, ".artemis", "integrity.json"), "utf8"),
    );
    await cp(pluginRoot, join(root, "user-data", "plugins", preview.id), {
      recursive: true,
    });
    await writeFile(
      join(root, "user-data", "plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: [
          {
            ...preview,
            skills: [],
            mcpServers: [
              { id: "historical-google", structuralHash: "0".repeat(64) },
            ],
            contentHash: integrity.plugins[0].contentHash,
            installedAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            skillPreviews: [],
            mcpPreviews: preview.mcpServers,
            appPreviews: [],
          },
        ],
      }),
    );
    await writeFile(
      join(root, "user-data", "mcp.json"),
      JSON.stringify({
        version: 3,
        servers: [
          {
            id: "historical-google",
            hostAuth: { provider: "google", grant: "gmail" },
          },
        ],
      }),
    );
    const historicalCredentials = join(
      root,
      "user-data",
      "google-account.json",
    );
    await writeFile(historicalCredentials, "leave-this-historical-file-alone");
    await writeFile(
      join(pluginRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          google: {
            command: "${ARTEMIS_NODE}",
            args: ["${PLUGIN_ROOT}/mcp/server.mjs"],
            "x-artemis": {
              connector: {
                version: 1,
                id: "gmail",
                provider: "google",
                displayName: "Gmail",
                auth: "oauth-pkce",
                scopes: [
                  "openid",
                  "email",
                  "profile",
                  "https://www.googleapis.com/auth/gmail.modify",
                ],
              },
            },
          },
        },
      }),
    );
    await signMarketplaceRepository(repository, key.privateKey);
    const current = createService(root, { cloneRepository });
    await expect(current.service.update(preview.id)).resolves.toBeDefined();
    expect(await current.mcpStore.list()).toEqual([
      expect.objectContaining({
        enabled: false,
        connector: expect.objectContaining({ version: 1, id: "gmail" }),
      }),
    ]);
    expect(await readFile(historicalCredentials, "utf8")).toBe(
      "leave-this-historical-file-alone",
    );
  });
  it("pins signed marketplace trust and gates connector credentials", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    await writeMarketplaceRepository(repository, {
      name: "signed-tools",
      displayName: "Signed Tools",
    });
    await writeFile(
      join(repository, "plugins", "demo-tools", ".mcp.json"),
      `${JSON.stringify({
        mcpServers: {
          google: {
            type: "stdio",
            command: "${ARTEMIS_NODE}",
            args: ["${PLUGIN_ROOT}/mcp/server.mjs"],
            "x-artemis": {
              connector: {
                version: 1,
                id: "gmail",
                displayName: "Gmail",
                auth: "oauth-pkce",
                provider: "google",
                scopes: [
                  "openid",
                  "email",
                  "profile",
                  "https://www.googleapis.com/auth/gmail.modify",
                ],
              },
            },
          },
        },
      })}\n`,
    );
    const firstKey = await signMarketplaceRepository(repository);
    const cloneRepository = async (_url: string, destination: string) =>
      cp(repository, destination, { recursive: true });
    const { service, mcpStore } = createService(root, { cloneRepository });

    const trust = await service.inspectMarketplaceTrust("acme/signed-tools");
    expect(trust).toMatchObject({
      repository: "acme/signed-tools",
      signed: true,
      signingKeyFingerprint: firstKey.fingerprint,
    });
    const state = await service.addMarketplace(
      "acme/signed-tools",
      undefined,
      firstKey.fingerprint,
    );
    expect(state.sources.find((source) => !source.builtIn)).toMatchObject({
      signingKeyFingerprint: firstKey.fingerprint,
    });
    const plugin = state.marketplaces[0]!.marketplace.plugins[0]!;
    await service.install(plugin.source);
    const config = (await mcpStore.list()).find((candidate) =>
      candidate.id.includes("google"),
    );
    expect(config).toMatchObject({
      transport: "stdio",
      command: process.execPath,
      enabled: true,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      connector: { version: 1, provider: "google", id: "gmail" },
    });
    await expect(
      service.assertConnectorTrusted(config!),
    ).resolves.toMatchObject({
      signingKeyFingerprint: firstKey.fingerprint,
      marketplaceUrl: "https://github.com/acme/signed-tools.git",
    });
    await expect(
      service.assertConnectorTrusted({
        ...config!,
        env: {
          ...(config!.transport === "stdio" ? config!.env : {}),
          NODE_OPTIONS: "--require=/tmp/untrusted.cjs",
        },
      } as McpServerConfig),
    ).rejects.toThrow(/not owned by a trusted signed plugin/);

    await mcpStore.upsert({ ...config!, enabled: true });
    const mcpPath = join(repository, "plugins", "demo-tools", ".mcp.json");
    const expandedMcp = JSON.parse(await readFile(mcpPath, "utf8")) as {
      mcpServers: {
        google: { "x-artemis": { connector: { displayName: string } } };
      };
    };
    expandedMcp.mcpServers.google["x-artemis"].connector.displayName =
      "Updated Gmail";
    await writeFile(mcpPath, `${JSON.stringify(expandedMcp)}\n`);
    await signMarketplaceRepository(repository, firstKey.privateKey);
    await service.update(plugin.id);
    expect(
      (await mcpStore.list()).find((candidate) => candidate.id === config!.id),
    ).toMatchObject({ enabled: true });

    const secondKey = await signMarketplaceRepository(repository);
    expect(secondKey.fingerprint).not.toBe(firstKey.fingerprint);
    const source = state.sources.find((candidate) => !candidate.builtIn)!;
    await expect(service.refreshMarketplaceSource(source.id)).rejects.toThrow(
      /signing key changed/,
    );
    const preserved = await service.listMarketplaces(source.id);
    expect(preserved.marketplaces[0]?.marketplace.plugins).toHaveLength(1);
  });

  it("imports a signed offline marketplace archive and installs only from its cache", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "offline-repository");
    const packageRoot = join(root, "offline-package");
    const archivePath = join(root, "ArtemisPluginShop-offline.tgz");
    const sourceUrl = "https://github.com/acme/offline-tools.git";
    await writeMarketplaceRepository(repository, {
      name: "offline-tools",
      displayName: "Offline Tools",
    });
    const signed = await signMarketplaceRepository(
      repository,
      undefined,
      sourceUrl,
    );
    await cp(repository, packageRoot, { recursive: true });
    await createTar({ cwd: root, file: archivePath, gzip: true }, [
      "offline-package",
    ]);
    let clones = 0;
    const createOfflineService = () =>
      createService(root, {
        cloneRepository: async () => {
          clones += 1;
          throw new Error("offline marketplace must not access GitHub");
        },
      }).service;
    const service = createOfflineService();

    const trust = await service.inspectOfflineMarketplace(archivePath);
    expect(trust).toMatchObject({
      url: sourceUrl,
      repository: "acme/offline-tools",
      signed: true,
      signingKeyFingerprint: signed.fingerprint,
    });
    const imported = await service.addOfflineMarketplace(
      archivePath,
      signed.fingerprint,
    );
    const source = imported.sources.find((candidate) => !candidate.builtIn)!;
    expect(source).toMatchObject({
      repository: "acme/offline-tools",
      offline: true,
      refreshable: false,
    });
    expect(clones).toBe(0);
    await rm(repository, { recursive: true, force: true });
    await rm(packageRoot, { recursive: true, force: true });
    await rm(archivePath, { force: true });

    const cached = await service.listMarketplaces(source.id);
    const plugin = cached.marketplaces[0]!.marketplace.plugins[0]!;
    const installed = await service.install(plugin.source);
    expect(installed.plugin.source).toMatchObject({
      kind: "git",
      marketplaceUrl: sourceUrl,
    });
    await expect(service.update(plugin.id)).resolves.toMatchObject({
      plugin: { id: plugin.id },
    });
    await expect(service.refreshMarketplaceSource(source.id)).rejects.toThrow(
      /cannot be refreshed from the network/,
    );
    expect(clones).toBe(0);

    const reloaded = createOfflineService();
    expect(
      (await reloaded.listMarketplaces(source.id)).marketplaces[0]?.marketplace
        .plugins,
    ).toHaveLength(1);
    expect(await reloaded.listInstalled()).toHaveLength(1);
    expect(clones).toBe(0);
    expect(
      await readFile(
        join(root, "user-data", "plugin-marketplaces.json"),
        "utf8",
      ),
    ).not.toContain(archivePath);
  });

  it("rejects unsigned extra files in an offline marketplace package", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "offline-extra-file");
    await writeMarketplaceRepository(repository, {
      name: "offline-extra-file",
      displayName: "Offline Extra File",
    });
    await signMarketplaceRepository(
      repository,
      undefined,
      "https://github.com/acme/offline-extra-file.git",
    );
    await writeFile(join(repository, ".artemis", "signing-key.pem"), "secret");
    const { service } = createService(root);

    await expect(service.inspectOfflineMarketplace(repository)).rejects.toThrow(
      /unsigned file: \.artemis\/signing-key\.pem/,
    );
  });

  it("starts with bundled plugins only and requires external marketplaces to be added", async () => {
    const root = await temporaryRoot();
    const cloneRepository = async () => {
      throw new Error("startup must not download a marketplace");
    };
    const { service } = createService(root, { cloneRepository });

    const initial = await service.listMarketplaces();

    expect(initial.selectedView).toBe("bundled");
    expect(initial.sources).toEqual([
      expect.objectContaining({
        id: "bundled",
        repository: "Artemis",
        builtIn: true,
        removable: false,
      }),
    ]);
    expect(initial.marketplaces).toEqual([]);
    expect(initial.errors).toEqual([]);
  });

  it("migrates the former built-in OpenAI selection to bundled plugins", async () => {
    const root = await temporaryRoot();
    const userData = join(root, "user-data");
    await mkdir(userData, { recursive: true });
    await writeFile(
      join(userData, "plugin-marketplaces.json"),
      `${JSON.stringify({
        version: 1,
        selectedView: "openai",
        sources: [],
      })}\n`,
    );

    const { service } = createService(root);
    const migrated = await service.listMarketplaces();

    expect(migrated.selectedView).toBe("bundled");
    expect(migrated.sources.map((source) => source.id)).toEqual(["bundled"]);
    expect(migrated.marketplaces).toEqual([]);
  });

  it("adds the OpenAI marketplace only after explicit user action", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "openai-marketplace");
    await writeMarketplaceRepository(repository, {
      name: "openai-curated",
      displayName: "OpenAI",
    });
    const clonedUrls: string[] = [];
    const { service } = createService(root, {
      cloneRepository: async (url, destination) => {
        clonedUrls.push(url);
        await cp(repository, destination, { recursive: true });
      },
    });

    const added = await service.addMarketplace("openai/plugins");
    const source = added.sources.find(
      (candidate) => candidate.repository === "openai/plugins",
    );

    expect(clonedUrls).toEqual(["https://github.com/openai/plugins.git"]);
    expect(source).toMatchObject({ builtIn: false, removable: true });
    expect(added.selectedView).toBe(source?.id);
    const removed = await service.removeMarketplace(source!.id);
    expect(removed.selectedView).toBe("bundled");
    expect(removed.sources.map((candidate) => candidate.id)).toEqual([
      "bundled",
    ]);
  });

  it("downloads GitHub marketplaces over HTTPS without requiring Git", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    const archivePath = join(root, "marketplace.tar.gz");
    await writeMarketplaceRepository(repository, {
      name: "openai-curated",
      displayName: "Codex official",
    });
    await createTar(
      {
        cwd: repository,
        file: archivePath,
        gzip: true,
        prefix: "openai-plugins-commit",
      },
      ["."],
    );
    const archive = await readFile(archivePath);
    const requests: string[] = [];
    const { service } = createService(root, {
      fetcher: async (url) => {
        requests.push(url);
        return new Response(archive, {
          headers: { "content-length": String(archive.byteLength) },
          status: 200,
        });
      },
    });

    const marketplace = await service.loadGitMarketplace("openai/plugins");

    expect(requests).toEqual([
      "https://api.github.com/repos/openai/plugins/tarball",
    ]);
    expect(marketplace.marketplaceName).toBe("openai-curated");
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual([
      "demo-tools",
    ]);
  });

  it("retries one short GitHub marketplace rate limit response", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    const archivePath = join(root, "marketplace.tar.gz");
    await writeMarketplaceRepository(repository, {
      name: "openai-curated",
      displayName: "Codex official",
    });
    await createTar(
      {
        cwd: repository,
        file: archivePath,
        gzip: true,
        prefix: "openai-plugins-commit",
      },
      ["."],
    );
    const archive = await readFile(archivePath);
    let requests = 0;
    const { service } = createService(root, {
      fetcher: async () => {
        requests += 1;
        return requests === 1
          ? new Response(undefined, {
              headers: { "retry-after": "0" },
              status: 429,
            })
          : new Response(archive, {
              headers: { "content-length": String(archive.byteLength) },
              status: 200,
            });
      },
    });

    const marketplace = await service.loadGitMarketplace("openai/plugins");

    expect(requests).toBe(2);
    expect(marketplace.marketplaceName).toBe("openai-curated");
  });

  it("reports long GitHub marketplace rate limits with the reset time", async () => {
    const root = await temporaryRoot();
    const resetAt = Math.floor(Date.now() / 1_000) + 3_600;
    let requests = 0;
    const { service } = createService(root, {
      fetcher: async () => {
        requests += 1;
        return new Response(undefined, {
          headers: {
            "retry-after": "3600",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAt),
          },
          status: 403,
        });
      },
    });

    await expect(service.loadGitMarketplace("openai/plugins")).rejects.toThrow(
      /unauthenticated.*per-IP.*Try again after/iu,
    );
    expect(requests).toBe(1);
  });

  it("exposes bounded plugin branding and declared Apps for the Codex-style UI", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "branded-tools");
    await writePlugin(source);
    const manifestPath = join(source, "artemis.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.interface = {
      displayName: "Branded Tools",
      shortDescription: "A polished plugin preview.",
      category: "Productivity",
      brandColor: "#4285F4",
      logo: "./assets/logo.png",
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await mkdir(join(source, "assets"));
    await writeFile(
      join(source, "assets", "logo.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const { service } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(preview).toMatchObject({
      displayName: "Branded Tools",
      shortDescription: "A polished plugin preview.",
      category: "Productivity",
      brandColor: "#4285F4",
      apps: [],
    });
    expect(preview.iconDataUrl).toMatch(/^data:image\/png;base64,/u);
    const installed = await service.install(preview.source);
    expect(installed.plugin.iconDataUrl).toBe(preview.iconDataUrl);
    expect((await service.listInstalled())[0]?.apps).toEqual(preview.apps);
  });

  it("hides ordinary plugins whose App connector has neither a URL nor a matching MCP server", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "gmail-tools");
    await writePlugin(source);
    await writeFile(
      join(source, ".app.json"),
      JSON.stringify({
        apps: {
          gmail: { id: "connector_gmail" },
        },
      }),
    );
    const { service } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(preview.installable).toBe(false);
    expect(preview.apps).toEqual([
      { name: "Update plugin and reconnect", required: true },
    ]);
    await expect(service.install(preview.source)).rejects.toThrow(
      /Update plugin and reconnect/,
    );
  });

  it("refuses legacy aliases even when another MCP server is importable", async () => {
    for (const declaration of ["apps", "connectors"]) {
      const root = await temporaryRoot();
      const source = join(root, "source", "legacy-tools");
      await writePlugin(source);
      const path = join(source, "artemis.plugin.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifest[declaration] = {
        docs: { id: "legacy", url: "https://example.test/mcp" },
      };
      await writeFile(path, JSON.stringify(manifest));
      const { service, mcpStore } = createService(root);
      const preview = await service.inspectLocal(source);
      expect(preview.installable).toBe(false);
      await expect(service.install(preview.source)).rejects.toThrow(
        /Update plugin and reconnect/,
      );
      expect(await mcpStore.list()).toEqual([]);
    }
  });

  it("isolates legacy auth and unsupported connector declarations from unrelated plugins", async () => {
    for (const extension of [
      { auth: { provider: "google", grant: "gmail" } },
      { connector: { version: 99, provider: "google" } },
      {
        connector: {
          version: 1,
          id: "figma",
          provider: "figma",
          displayName: "Figma",
          auth: "none",
          scopes: [],
        },
      },
    ]) {
      const root = await temporaryRoot(),
        source = join(root, "source", "unsupported");
      await writePlugin(source);
      await writeFile(
        join(source, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            bad: {
              command: "node",
              args: ["server.mjs"],
              "x-artemis": extension,
            },
          },
        }),
      );
      const { service, mcpStore } = createService(root);
      const preview = await service.inspectLocal(source);
      expect(preview.installable).toBe(false);
      await expect(service.install(preview.source)).rejects.toThrow(
        /Update plugin and reconnect/,
      );
      expect(await mcpStore.list()).toEqual([]);
    }
  });

  it("trusts only the host-bundled Computer Use source, never a local plugin with the same manifest", async () => {
    const root = await temporaryRoot();
    const computerUseRoot = fileURLToPath(
      new URL("../resources/computer-use", import.meta.url),
    );
    const first = createService(root, { bundledArtifactRoot, computerUseRoot });
    const marketplace = await first.service.loadBundledArtifactMarketplace();
    expect(
      marketplace?.plugins.find((plugin) => plugin.name === "computer-use")
        ?.source,
    ).toEqual({ kind: "builtin", pluginName: "computer-use" });
    const installed = await first.service.install({
      kind: "builtin",
      pluginName: "computer-use",
    });
    const config = (await first.mcpStore.list()).find((server) =>
      installed.plugin.mcpServerIds.includes(server.id),
    )!;
    expect(config.enabled).toBe(true);
    await expect(first.service.isComputerUseServer(config)).resolves.toBe(true);
    await expect(
      first.service.isComputerUseServer({
        ...config,
        url: "https://example.test",
      } as McpServerConfig),
    ).resolves.toBe(false);
    const second = createService(await temporaryRoot(), { computerUseRoot });
    const untrusted = await second.service.install({
      kind: "local",
      path: computerUseRoot,
    });
    const imitation = (await second.mcpStore.list()).find((server) =>
      untrusted.plugin.mcpServerIds.includes(server.id),
    )!;
    await expect(second.service.isComputerUseServer(imitation)).resolves.toBe(
      false,
    );
  });

  it("hides an installed Computer Use plugin when the host has no native support", async () => {
    const root = await temporaryRoot();
    const computerUseRoot = fileURLToPath(
      new URL("../resources/computer-use", import.meta.url),
    );
    const mac = createService(root, { bundledArtifactRoot, computerUseRoot });
    await mac.service.install({ kind: "builtin", pluginName: "computer-use" });
    const unsupported = createService(root, { bundledArtifactRoot });
    expect(
      (
        await unsupported.service.loadBundledArtifactMarketplace()
      )?.plugins.some((p) => p.name === "computer-use"),
    ).toBe(false);
    expect(
      (await unsupported.service.listInstalled()).some(
        (p) => p.name === "computer-use",
      ),
    ).toBe(false);
    expect(await unsupported.mcpStore.listAvailable("win32")).toEqual([]);
    expect(await unsupported.mcpStore.listAvailable("darwin")).toHaveLength(1);
    await expect(
      unsupported.service.install({
        kind: "builtin",
        pluginName: "computer-use",
      }),
    ).rejects.toThrow(/requires the macOS/);
  });

  it("installs enabled MCP servers without enabling unrelated existing servers", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    await mcpStore.upsert({
      id: "existing",
      name: "Existing",
      transport: "streamable-http",
      enabled: false,
      url: "https://existing.example.test/mcp",
      auth: "none",
    });

    const preview = await service.inspectLocal(source);

    expect(preview).toMatchObject({
      name: "demo-tools",
      displayName: "Demo Tools",
      version: "1.0.0",
      installed: false,
      installable: true,
      unsupported: [],
      hasHooks: true,
    });
    expect(preview.skills).toEqual([
      expect.objectContaining({ name: "hello-plugin" }),
    ]);
    expect(preview.mcpServers).toEqual([
      expect.objectContaining({ name: "local", transport: "stdio" }),
      expect.objectContaining({
        name: "docs",
        transport: "streamable-http",
      }),
    ]);
    expect(preview.warnings.join("\n")).toContain("LITERAL_SECRET");
    expect(preview.warnings.join("\n")).not.toContain("do-not-copy");

    const progress: number[] = [];
    const installed = await service.install(preview.source, (percent) =>
      progress.push(percent),
    );

    expect(installed.plugin.skillNames).toEqual(["hello-plugin"]);
    expect(installed.plugin.mcpServerIds).toHaveLength(2);
    expect(progress.at(-1)).toBe(100);
    await expect(
      readFile(
        join(
          root,
          "home",
          ".pi",
          "agent",
          "skills",
          "hello-plugin",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("Version one");
    const servers = await mcpStore.list();
    expect(servers.find((server) => server.id === "existing")?.enabled).toBe(
      false,
    );
    const local = servers.find(
      (server): server is Extract<McpServerConfig, { transport: "stdio" }> =>
        server.transport === "stdio",
    );
    expect(local).toMatchObject({
      enabled: true,
      command: "node",
      env: {},
      envVars: ["API_TOKEN"],
    });
    expect(local?.args[0]?.replaceAll("\\", "/")).toContain(
      ["plugins", installed.plugin.id, "mcp", "server.mjs"].join("/"),
    );
    expect(
      servers.find(
        (server) =>
          server.transport === "streamable-http" &&
          server.url === "https://docs.example.test/mcp",
      ),
    ).toMatchObject({ enabled: true, auth: "oauth" });

    await service.remove(installed.plugin.id);

    expect(await service.listInstalled()).toEqual([]);
    expect((await mcpStore.list()).map((server) => server.id)).toEqual([
      "existing",
    ]);
    await expect(
      readFile(
        join(
          root,
          "home",
          ".pi",
          "agent",
          "skills",
          "hello-plugin",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("updates from the original source while preserving explicit MCP enablement", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    const first = await service.install({ kind: "local", path: source });
    const current = await mcpStore.list();
    await mcpStore.replaceAll(
      current.map((server) => ({ ...server, enabled: true })),
    );
    await writePlugin(source, { version: "1.1.0", skillBody: "Version two" });

    const updated = await service.update(first.plugin.id);

    expect(updated.plugin.version).toBe("1.1.0");
    expect((await mcpStore.list()).every((server) => server.enabled)).toBe(
      true,
    );
    await expect(
      readFile(
        join(
          root,
          "home",
          ".pi",
          "agent",
          "skills",
          "hello-plugin",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).resolves.toContain("Version two");
  });

  it("ignores an undeclared root MCP manifest", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "skills-only");
    await writePlugin(source, { declareMcp: false });
    const { service, mcpStore } = createService(root);

    const preview = await service.inspectLocal(source);
    expect(preview.skills).toHaveLength(1);
    expect(preview.mcpServers).toEqual([]);

    const installed = await service.install(preview.source);
    expect(installed.plugin.mcpServerIds).toEqual([]);
    expect(await mcpStore.list()).toEqual([]);
  });

  it("preserves enablement but drops credential bindings when an endpoint changes", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    const first = await service.install({ kind: "local", path: source });
    await mcpStore.replaceAll(
      (await mcpStore.list()).map((server) => ({
        ...server,
        enabled: true,
        ...(server.transport === "streamable-http"
          ? { credentialProviderId: "old-account" }
          : {}),
      })),
    );
    await writePlugin(source, {
      version: "2.0.0",
      mcpUrl: "https://new-docs.example.test/mcp",
    });

    await service.update(first.plugin.id);

    const servers = await mcpStore.list();
    expect(
      servers.find((server) => server.transport === "stdio")?.enabled,
    ).toBe(true);
    expect(
      servers.find((server) => server.transport === "streamable-http"),
    ).toMatchObject({
      enabled: true,
      url: "https://new-docs.example.test/mcp",
      auth: "oauth",
    });
    expect(
      servers.find((server) => server.transport === "streamable-http"),
    ).not.toHaveProperty("credentialProviderId");
  });

  it("keeps a disabled plugin disabled when an update changes endpoints and adds servers", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    const first = await service.install({ kind: "local", path: source });
    await mcpStore.replaceAll(
      (await mcpStore.list()).map((server) => ({ ...server, enabled: false })),
    );
    await writePlugin(source, {
      version: "2.0.0",
      mcpUrl: "https://changed.example.test/mcp",
    });
    const manifestPath = join(source, ".mcp.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.mcpServers.added = {
      type: "http",
      url: "https://added.example.test/mcp",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await service.update(first.plugin.id);
    expect(await mcpStore.list()).toHaveLength(3);
    expect((await mcpStore.list()).every((server) => !server.enabled)).toBe(
      true,
    );
  });

  it("rejects collisions and rolls back staged files when MCP persistence fails", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const skillsRoot = join(root, "home", ".pi", "agent", "skills");
    await mkdir(join(skillsRoot, "hello-plugin"), { recursive: true });
    await writeFile(
      join(skillsRoot, "hello-plugin", "SKILL.md"),
      "---\nname: hello-plugin\ndescription: Existing Skill.\n---\n",
    );
    const collision = createService(root);

    await expect(
      collision.service.install({ kind: "local", path: source }),
    ).rejects.toThrow("already installed");
    expect(await collision.service.listInstalled()).toEqual([]);

    await rm(join(skillsRoot, "hello-plugin"), { recursive: true });
    class FailingMcpStore extends McpConfigStore {
      override async replaceAll(
        _inputs: McpServerConfig[],
      ): Promise<McpServerConfig[]> {
        throw new Error("simulated persistence failure");
      }
    }
    const failingStore = new FailingMcpStore(
      join(root, "failing-user-data", "mcp.json"),
    );
    const failing = createService(root, { mcpStore: failingStore });

    await expect(
      failing.service.install({ kind: "local", path: source }),
    ).rejects.toThrow("simulated persistence failure");
    expect(await failing.service.listInstalled()).toEqual([]);
    await expect(
      readFile(join(skillsRoot, "hello-plugin", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("rejects path escapes and symbolic links before installation", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "unsafe");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "artemis.plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "unsafe",
        version: "1.0.0",
        skills: "../outside",
      }),
    );
    const { service } = createService(root);

    await expect(service.inspectLocal(source)).rejects.toThrow("escapes");

    await writePlugin(source);
    const external = join(root, "external");
    await mkdir(external);
    await writeFile(join(external, "outside.txt"), "outside");
    await symlink(
      external,
      join(source, "skills", "hello", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      service.install({ kind: "local", path: source }),
    ).rejects.toThrow("links");
  });

  it("does not expose MCP credentials and rejects plugin-root traversal", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "unsafe-mcp");
    await writePlugin(source);
    await writeFile(
      join(source, ".mcp.json"),
      `${JSON.stringify({
        mcpServers: {
          escape: {
            command: "node",
            args: ["\${PLUGIN_ROOT}/../outside.mjs"],
          },
          secret: {
            command: "secret-mcp",
            args: ["--api-key", "super-secret-value"],
          },
          remote: {
            type: "http",
            url: "https://example.test/mcp?token=super-secret-value",
          },
        },
      })}\n`,
    );
    const { service } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(JSON.stringify(preview)).not.toContain("super-secret-value");
    expect(preview.mcpServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "secret", importable: false }),
        expect.objectContaining({
          name: "remote",
          endpoint: "https://example.test/mcp",
          importable: false,
        }),
      ]),
    );
    await expect(service.install(preview.source)).rejects.toThrow(
      "escapes the installed plugin",
    );
  });

  it("loads a Git marketplace and installs its local plugin entry", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    const plugin = join(repository, "plugins", "demo-tools");
    const unavailablePlugin = join(repository, "plugins", "unavailable-tools");
    await writePlugin(plugin);
    await writePlugin(unavailablePlugin);
    await writeFile(
      join(unavailablePlugin, ".app.json"),
      JSON.stringify({
        apps: {
          gmail: { id: "connector_gmail" },
        },
      }),
    );
    await mkdir(join(repository, ".artemis"), { recursive: true });
    await writeFile(
      join(repository, ".artemis", "marketplace.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        name: "openai-curated",
        interface: { displayName: "Codex official" },
        plugins: [
          {
            name: "demo-tools",
            source: { source: "local", path: "./plugins/demo-tools" },
          },
          {
            name: "demo-tools-alias",
            source: "./plugins/demo-tools",
          },
          {
            name: "remote-only",
            source: { source: "git", url: "https://example.test/plugin.git" },
          },
          {
            name: "unavailable-tools",
            source: {
              source: "local",
              path: "./plugins/unavailable-tools",
            },
          },
        ],
      })}\n`,
    );
    const clonedUrls: string[] = [];
    const { service } = createService(root, {
      cloneRepository: async (url, destination) => {
        clonedUrls.push(url);
        await cp(repository, destination, { recursive: true });
      },
    });

    const marketplace = await service.loadGitMarketplace("openai/plugins");

    expect(clonedUrls).toEqual(["https://github.com/openai/plugins.git"]);
    expect(marketplace.name).toBe("Codex official");
    expect(marketplace.plugins).toHaveLength(3);
    expect(
      marketplace.plugins.some(
        (candidate) =>
          candidate.source.kind === "git" &&
          candidate.source.pluginName === "unavailable-tools" &&
          !candidate.installable,
      ),
    ).toBe(true);
    expect(
      marketplace.plugins.map((candidate) =>
        candidate.source.kind === "git" ? candidate.source.pluginName : "local",
      ),
    ).toEqual(expect.arrayContaining(["demo-tools", "demo-tools-alias"]));
    expect(marketplace.warnings.join("\n")).toContain("remote-only");
    expect(marketplace.warnings.join("\n")).not.toContain(
      "Update plugin and reconnect",
    );
    const source = marketplace.plugins.find(
      (candidate) =>
        candidate.source.kind === "git" &&
        candidate.source.pluginName === "demo-tools",
    )!.source;
    expect(source).toMatchObject({
      kind: "git",
      pluginName: "demo-tools",
    });
    await service.loadGitMarketplace("openai/plugins");
    expect(clonedUrls).toHaveLength(1);
    const refreshedMarketplace = await service.loadGitMarketplace(
      "openai/plugins",
      undefined,
      true,
    );
    expect(clonedUrls).toHaveLength(2);
    expect(
      refreshedMarketplace.plugins.some(
        (candidate) =>
          candidate.source.kind === "git" &&
          candidate.source.pluginName === "unavailable-tools" &&
          !candidate.installable,
      ),
    ).toBe(true);
    const installed = await service.install(source);
    expect(installed.plugin.source.kind).toBe("git");
  });

  it("persists, reorders, selects, and removes public GitHub marketplaces", async () => {
    const root = await temporaryRoot();
    const firstRepository = join(root, "first-marketplace");
    const secondRepository = join(root, "second-marketplace");
    await writeMarketplaceRepository(firstRepository, {
      name: "first-marketplace",
      displayName: "Shared Store",
    });
    await writeMarketplaceRepository(secondRepository, {
      name: "second-marketplace",
      displayName: "Shared Store",
    });
    const repositories = new Map([
      ["https://github.com/acme/first.git", firstRepository],
      ["https://github.com/acme/second.git", secondRepository],
    ]);
    const clonedUrls: string[] = [];
    const cloneRepository = async (url: string, destination: string) => {
      clonedUrls.push(url);
      await cp(repositories.get(url)!, destination, { recursive: true });
    };
    const { service } = createService(root, { cloneRepository });

    const first = await service.addMarketplace("acme/first");
    const firstSource = first.sources.find(
      (source) => source.repository === "acme/first",
    )!;
    expect(first.selectedView).toBe(firstSource.id);
    expect(firstSource).toMatchObject({ builtIn: false, removable: true });
    const cachedFirst = await service.listMarketplaces(firstSource.id);
    expect(cachedFirst.marketplaces.map((entry) => entry.sourceId)).toEqual([
      firstSource.id,
    ]);
    expect(clonedUrls).toHaveLength(1);

    const duplicate = await service.addMarketplace(
      "https://github.com/ACME/FIRST.git",
    );
    expect(duplicate.sources).toHaveLength(2);
    expect(clonedUrls).toHaveLength(1);

    const second = await service.addMarketplace("acme/second");
    const secondSource = second.sources.find(
      (source) => source.repository === "acme/second",
    )!;
    const pluginIds = second.marketplaces.flatMap((entry) =>
      entry.marketplace.plugins.map((plugin) => plugin.id),
    );
    expect(new Set(pluginIds).size).toBe(2);

    const reordered = await service.reorderMarketplaces([
      secondSource.id,
      firstSource.id,
    ]);
    expect(reordered.sources.slice(1).map((source) => source.id)).toEqual([
      secondSource.id,
      firstSource.id,
    ]);
    const reloadedSelection = createService(root, {
      cloneRepository,
    }).service;
    const persistedSelection = await reloadedSelection.listMarketplaces();
    expect(persistedSelection.selectedView).toBe(secondSource.id);
    expect(
      persistedSelection.sources.slice(1).map((source) => source.id),
    ).toEqual([secondSource.id, firstSource.id]);
    clonedUrls.splice(0);
    await service.refreshMarketplaceSource(secondSource.id);
    expect(clonedUrls).toEqual(["https://github.com/acme/second.git"]);

    const firstPlugin = reordered.marketplaces.find(
      (entry) => entry.sourceId === firstSource.id,
    )!.marketplace.plugins[0]!;
    const secondPlugin = reordered.marketplaces.find(
      (entry) => entry.sourceId === secondSource.id,
    )!.marketplace.plugins[0]!;
    await service.install(firstPlugin.source);
    await expect(service.install(secondPlugin.source)).rejects.toThrow(
      'already installed by "Demo Tools"',
    );

    await service.selectMarketplace(firstSource.id);
    const removed = await service.removeMarketplace(firstSource.id);
    expect(removed.selectedView).toBe("bundled");
    expect(removed.sources.some((source) => source.id === firstSource.id)).toBe(
      false,
    );
    expect(await service.listInstalled()).toHaveLength(1);
    const updated = await service.update(firstPlugin.id);
    expect(updated.plugin.id).toBe(firstPlugin.id);
    const resubscribed = await service.addMarketplace("acme/first");
    expect(
      resubscribed.sources.find((source) => source.repository === "acme/first")
        ?.id,
    ).toBe(firstSource.id);
    expect(await service.listInstalled()).toHaveLength(1);

    const reloaded = createService(root, { cloneRepository }).service;
    const persisted = await reloaded.listMarketplaces();
    expect(persisted.sources.map((source) => source.repository)).toEqual([
      "Artemis",
      "acme/second",
      "acme/first",
    ]);
    expect(persisted.selectedView).toBe(firstSource.id);
  });

  it("rejects non-GitHub marketplace subscriptions", async () => {
    const root = await temporaryRoot();
    const { service } = createService(root, {
      cloneRepository: async () => {
        throw new Error("clone should not run");
      },
    });

    await expect(
      service.addMarketplace("https://gitlab.example.test/acme/plugins.git"),
    ).rejects.toThrow("public GitHub.com repositories");
    await expect(
      service.loadGitMarketplace(
        "https://gitlab.example.test/acme/plugins.git",
      ),
    ).rejects.toThrow("public GitHub.com repositories");
    for (const input of [
      "http://github.com/acme/plugins.git",
      "https://user@github.com/acme/plugins.git",
      "https://github.com/acme/plugins.git?ref=main",
      "https://github.com/acme/plugins/tree/main",
      "https://github.com/acme/plugins.git#main",
    ]) {
      await expect(service.addMarketplace(input)).rejects.toThrow();
    }
    await expect(service.addMarketplace("acme/missing")).rejects.toThrow(
      "clone should not run",
    );
    expect((await service.listMarketplaces()).sources).toHaveLength(1);
  });

  it("limits persisted user marketplaces to twenty", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "bounded-marketplace");
    await writeMarketplaceRepository(repository, {
      name: "bounded-marketplace",
      displayName: "Bounded Store",
    });
    let clones = 0;
    const { service } = createService(root, {
      cloneRepository: async (_url, destination) => {
        clones += 1;
        await cp(repository, destination, { recursive: true });
      },
    });

    for (let index = 0; index < 20; index += 1) {
      await service.addMarketplace(`acme/store-${index}`);
    }
    await expect(service.addMarketplace("acme/store-20")).rejects.toThrow(
      "No more than 20",
    );
    expect(clones).toBe(20);
    expect((await service.listMarketplaces()).sources).toHaveLength(21);
  });

  it("does not persist a marketplace whose first clone is malformed", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "malformed-marketplace");
    await mkdir(join(repository, ".artemis"), { recursive: true });
    await writeFile(
      join(repository, ".artemis", "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "malformed-marketplace",
        plugins: [
          {
            name: "missing-plugin",
            source: { source: "local", path: "./plugins/missing-plugin" },
          },
        ],
      }),
    );
    const { service } = createService(root, {
      cloneRepository: async (_url, destination) => {
        await cp(repository, destination, { recursive: true });
      },
    });

    await expect(service.addMarketplace("acme/malformed")).rejects.toThrow();
    const state = await service.listMarketplaces();
    expect(state.sources.map((source) => source.id)).toEqual(["bundled"]);
  });

  it("restores subscribed GitHub sources from installed plugin history", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "historical-marketplace");
    await writeMarketplaceRepository(repository, {
      name: "historical-marketplace",
      displayName: "Historical Store",
    });
    let cloneCount = 0;
    const cloneRepository = async (_url: string, destination: string) => {
      cloneCount += 1;
      await cp(repository, destination, { recursive: true });
    };
    const first = createService(root, { cloneRepository }).service;
    const marketplace = await first.loadGitMarketplace("Acme/History");
    await first.install(marketplace.plugins[0]!.source);

    const reloaded = createService(root, { cloneRepository }).service;
    const restored = await reloaded.listMarketplaces();

    expect(restored.selectedView).toBe("bundled");
    expect(restored.sources.map((source) => source.repository)).toEqual([
      "Artemis",
      "acme/history",
    ]);
    expect(
      restored.marketplaces.some(
        (entry) => entry.sourceId === restored.sources[1]?.id,
      ),
    ).toBe(true);
    expect(cloneCount).toBe(1);
  });

  it("keeps the previous cache when a marketplace identity changes", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "identity-marketplace");
    await writeMarketplaceRepository(repository, {
      name: "stable-marketplace",
      displayName: "Stable Store",
    });
    const cloneRepository = async (_url: string, destination: string) => {
      await cp(repository, destination, { recursive: true });
    };
    const { service } = createService(root, { cloneRepository });
    const added = await service.addMarketplace("acme/stable");
    const source = added.sources.find(
      (candidate) => candidate.repository === "acme/stable",
    )!;
    await writeFile(
      join(repository, ".artemis", "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "replacement-marketplace",
        plugins: [
          {
            name: "demo-tools",
            source: { source: "local", path: "./plugins/demo-tools" },
          },
        ],
      }),
    );

    await expect(service.refreshMarketplaceSource(source.id)).rejects.toThrow(
      "identity changed",
    );
    const cached = await service.listMarketplaces();
    expect(
      cached.marketplaces.find((entry) => entry.sourceId === source.id)
        ?.marketplace.marketplaceName,
    ).toBe("stable-marketplace");
    expect(
      cached.errors.find((error) => error.sourceId === source.id)?.message,
    ).toContain("may be stale");
  });

  it("rolls back a user marketplace refresh when a plugin directory is invalid", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "rollback-marketplace");
    await writeMarketplaceRepository(repository, {
      name: "rollback-marketplace",
      displayName: "Rollback Store",
    });
    const cloneRepository = async (_url: string, destination: string) => {
      await cp(repository, destination, { recursive: true });
    };
    const { service } = createService(root, { cloneRepository });
    const added = await service.addMarketplace("acme/rollback");
    const source = added.sources.find(
      (candidate) => candidate.repository === "acme/rollback",
    )!;
    await writeFile(
      join(repository, ".artemis", "marketplace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "rollback-marketplace",
        plugins: [
          {
            name: "demo-tools",
            source: { source: "local", path: "./plugins/missing" },
          },
        ],
      }),
    );

    await expect(service.refreshMarketplaceSource(source.id)).rejects.toThrow();
    const cached = await service.listMarketplaces();
    expect(
      cached.marketplaces.find((entry) => entry.sourceId === source.id)
        ?.marketplace.plugins[0]?.name,
    ).toBe("demo-tools");
    expect(
      cached.errors.find((error) => error.sourceId === source.id)?.message,
    ).toContain("may be stale");
  });

  it("exposes all four Lite plugins from packaged resources without a runtime", async () => {
    const root = await temporaryRoot();
    const { service } = createService(root, {
      bundledArtifactRoot,
    });

    const marketplace = await service.loadBundledArtifactMarketplace();

    expect(marketplace?.name).toBe("Bundled plugins");
    expect(marketplace?.plugins.map((plugin) => plugin.name)).toEqual([
      "documents",
      "pdf",
      "presentations",
      "spreadsheets",
    ]);
    expect(
      marketplace?.plugins.every(
        (plugin) => plugin.installable && plugin.source.kind === "bundled",
      ),
    ).toBe(true);
    expect(
      marketplace?.plugins.every(
        (plugin) =>
          plugin.version === "1.1.0" &&
          plugin.iconDataUrl?.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
    expect(marketplace?.plugins.every((plugin) => !plugin.apps.length)).toBe(
      true,
    );
    for (const plugin of marketplace?.plugins ?? []) {
      expect(plugin.skills.map((skill) => skill.name)).toEqual([plugin.name]);
      expect(plugin.capabilityDependencies ?? []).toEqual(
        plugin.name === "pdf"
          ? []
          : [{ id: "office-core", version: "1.0.0", optional: true }],
      );
      await expect(service.install(plugin.source)).resolves.toMatchObject({
        plugin: { name: plugin.name, installed: true },
      });
      const skillSource = await readFile(
        join(root, "home", ".pi", "agent", "skills", plugin.name, "SKILL.md"),
        "utf8",
      );
      expect(skillSource).toContain("`office_document`");
      if (plugin.name !== "pdf")
        expect(skillSource).toContain(
          "https://github.com/EurekaRaider/ArtemisRelease/releases",
        );
      expect(skillSource).toContain(
        "Do not call `load_workspace_dependencies`",
      );
    }
    expect(
      (await service.listInstalled()).map((plugin) => plugin.name),
    ).toEqual(["documents", "pdf", "presentations", "spreadsheets"]);
    expect(
      (await service.listInstalled()).filter(
        (plugin) => plugin.capabilityDependencies?.[0]?.id === "office-core",
      ),
    ).toHaveLength(3);
    const reloaded = createService(root, { bundledArtifactRoot }).service;
    expect(
      (await reloaded.listInstalled()).map((plugin) => ({
        name: plugin.name,
        dependencies: plugin.capabilityDependencies,
      })),
    ).toEqual(
      (await service.listInstalled()).map((plugin) => ({
        name: plugin.name,
        dependencies: plugin.capabilityDependencies,
      })),
    );
  });

  it("adopts matching standalone Skills when bundled plugins are installed", async () => {
    const root = await temporaryRoot();
    const skillsRoot = join(root, "home", ".pi", "agent", "skills");
    const { service } = createService(root, { bundledArtifactRoot });
    const marketplace = await service.loadBundledArtifactMarketplace();
    expect(marketplace?.plugins).toHaveLength(4);

    for (const plugin of marketplace?.plugins ?? []) {
      await cp(
        join(
          bundledArtifactRoot,
          "plugins",
          plugin.name,
          "skills",
          plugin.name,
        ),
        join(skillsRoot, plugin.name),
        { recursive: true },
      );
      await expect(service.install(plugin.source)).resolves.toMatchObject({
        plugin: {
          name: plugin.name,
          installed: true,
          skillNames: [plugin.name],
        },
      });
      await expect(
        readFile(join(skillsRoot, plugin.name, ".artemis-skill.json"), "utf8"),
      ).resolves.toContain(`"source": "artemis-plugin:${plugin.name}"`);
    }
  });

  it("does not adopt a modified standalone Skill for a bundled plugin", async () => {
    const root = await temporaryRoot();
    const skillsRoot = join(root, "home", ".pi", "agent", "skills");
    const { service } = createService(root, { bundledArtifactRoot });
    const marketplace = await service.loadBundledArtifactMarketplace();
    const documents = marketplace?.plugins.find(
      (plugin) => plugin.name === "documents",
    );
    expect(documents).toBeDefined();
    await mkdir(join(skillsRoot, "documents"), { recursive: true });
    await writeFile(
      join(skillsRoot, "documents", "SKILL.md"),
      "---\nname: documents\ndescription: User modified.\n---\n",
    );

    await expect(service.install(documents!.source)).rejects.toThrow(
      'Skill "documents" is already installed by another source.',
    );
    await expect(
      readFile(join(skillsRoot, "documents", "SKILL.md"), "utf8"),
    ).resolves.toContain("User modified.");
  });

  it("updates legacy runtime plugin records to Lite without changing their IDs", async () => {
    const root = await temporaryRoot();
    const statePath = join(root, "user-data", "plugins.json");
    const firstService = createService(root, { bundledArtifactRoot }).service;
    const marketplace = await firstService.loadBundledArtifactMarketplace();
    const documents = marketplace?.plugins.find(
      (plugin) => plugin.name === "documents",
    );
    expect(documents).toBeDefined();
    const installed = await firstService.install(documents!.source);
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      plugins: Array<{ source: unknown }>;
    };
    state.plugins[0]!.source = { kind: "runtime", pluginName: "documents" };
    await writeFile(statePath, `${JSON.stringify(state, undefined, 2)}\n`);

    const migratedService = createService(root, {
      bundledArtifactRoot,
    }).service;
    const updated = await migratedService.update(installed.plugin.id);

    expect(updated.plugin).toMatchObject({
      id: installed.plugin.id,
      name: "documents",
      source: { kind: "bundled", pluginName: "documents" },
    });
  });

  it("hydrates bundled plugin icons for existing installs without reinstalling", async () => {
    const root = await temporaryRoot();
    const statePath = join(root, "user-data", "plugins.json");
    const firstService = createService(root, { bundledArtifactRoot }).service;
    const marketplace = await firstService.loadBundledArtifactMarketplace();
    const documents = marketplace?.plugins.find(
      (plugin) => plugin.name === "documents",
    );
    expect(documents).toBeDefined();
    const installed = await firstService.install(documents!.source);
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    delete state.plugins[0]!.iconDataUrl;
    state.plugins[0]!.source = {
      kind: "runtime",
      pluginName: "documents",
    };
    await writeFile(statePath, `${JSON.stringify(state, undefined, 2)}\n`);

    const migratedService = createService(root, {
      bundledArtifactRoot,
    }).service;
    const listed = await migratedService.listInstalled();

    expect(listed[0]).toMatchObject({
      id: installed.plugin.id,
      name: "documents",
      source: { kind: "runtime", pluginName: "documents" },
    });
    expect(listed[0]?.iconDataUrl).toMatch(/^data:image\/png;base64,/u);
  });

  it.each([false, true])(
    "handles legacy HTTP hashes without accepting endpoint edits (%s)",
    async (modified) => {
      const root = await temporaryRoot();
      const source = join(root, "source", "demo-tools");
      await writePlugin(source);
      const { service, mcpStore } = createService(root);
      const installed = await service.install({ kind: "local", path: source });
      const servers = await mcpStore.list();
      const remote = servers.find(
        (server) => server.transport === "streamable-http",
      )!;
      if (remote.transport !== "streamable-http")
        throw new Error("Expected HTTP");
      const legacy = {
        id: remote.id,
        name: remote.name,
        transport: remote.transport,
        url: remote.url,
      };
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(legacy).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          ),
        )
        .digest("hex");
      const statePath = join(root, "user-data", "plugins.json");
      const state = JSON.parse(await readFile(statePath, "utf8"));
      state.plugins[0].mcpServers.find(
        (server: { id: string }) => server.id === remote.id,
      ).structuralHash = hash;
      await writeFile(statePath, JSON.stringify(state));
      const { service: restarted } = createService(root, { mcpStore });
      if (modified) {
        await mcpStore.upsert({
          ...remote,
          url: "https://changed.example/mcp",
        });
        await expect(restarted.remove(installed.plugin.id)).rejects.toThrow(
          "structurally modified",
        );
      } else {
        await expect(restarted.remove(installed.plugin.id)).resolves.toEqual({
          warnings: [],
        });
        expect(await restarted.listInstalled()).toEqual([]);
        expect(await mcpStore.list()).toEqual([]);
      }
    },
  );

  it("protects modified managed resources from destructive update or removal", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service } = createService(root);
    const installed = await service.install({ kind: "local", path: source });
    await writeFile(
      join(root, "home", ".pi", "agent", "skills", "hello-plugin", "SKILL.md"),
      "---\nname: hello-plugin\ndescription: User modified.\n---\n",
    );

    await expect(service.remove(installed.plugin.id)).rejects.toThrow(
      "was modified",
    );
    expect(await service.listInstalled()).toHaveLength(1);
  });
});

describe("plugin localization persistence", () => {
  it("retains translations in previews, installed records, reloads and updates", async () => {
    const root = await temporaryRoot();
    const source = join(root, "localized-plugin");
    await writePlugin(source, { declareMcp: false });
    const manifestPath = join(source, "artemis.plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const localizations = {
      en: { displayName: "Demo Tools", description: "English description" },
      "zh-CN": {
        displayName: "示例工具",
        description: "中文描述",
        shortDescription: "中文简介",
      },
      ja: { displayName: "サンプルツール", description: "日本語の説明" },
    };
    manifest.localizations = localizations;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const { service } = createService(root);
    const preview = await service.inspectLocal(source);
    expect(preview.localizations).toEqual(localizations);
    const installed = await service.install(preview.source);
    expect(installed.plugin.localizations).toEqual(localizations);
    const reloaded = createService(root).service;
    expect((await reloaded.listInstalled())[0]?.localizations).toEqual(
      localizations,
    );
    // Changing a returned object must not alter the service's stored translations.
    installed.plugin.localizations!["zh-CN"]!.displayName =
      "Changed externally";
    expect((await service.listInstalled())[0]?.localizations).toEqual(
      localizations,
    );
    manifest.localizations.ja.description = "更新した説明";
    manifest.version = "1.0.1";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const updated = await reloaded.update(preview.id);
    expect(updated.plugin.localizations?.ja?.description).toBe("更新した説明");
    expect(
      (await createService(root).service.listInstalled())[0]?.localizations?.ja
        ?.description,
    ).toBe("更新した説明");
  });
});

it("loads a newly signed provider after the OAuth host was bundled, and retains only valid credentials across restart and updates", async () => {
  const { build } = await import("esbuild");
  const { createRequire } = await import("node:module");
  const { futureConnector } = await import("./fixtures/connector-oauth.js");
  const root = await temporaryRoot();
  const frozen = join(root, "frozen-host.cjs");
  await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/main/connector-service.ts", import.meta.url),
      ),
    ],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: frozen,
  });
  const originalHash = createHash("sha256")
    .update(await readFile(frozen))
    .digest("hex");
  const { ConnectorService } = createRequire(import.meta.url)(frozen);
  const { ConnectorVault } = await import("../src/main/connector-vault.js");
  const repository = join(root, "repository");
  await writeMarketplaceRepository(repository, {
    name: "signed-tools",
    displayName: "Signed Tools",
  });
  await build({
    stdin: {
      contents: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
      import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
      const server = new McpServer({name:"new-signed-platform",version:"1.0.0"});
      server.registerTool("read_records", {description:"Read synthetic records",inputSchema:{}}, async (_args, extra) => {
        const context=extra._meta?.["com.artemis.connector/auth"];
        if(context?.accessToken!=="resource-access" || context?.refreshToken) throw new Error("Invalid private authorization context");
        return {content:[{type:"text",text:"synthetic-record"}]};
      });
      await server.connect(new StdioServerTransport());`,
      resolveDir: fileURLToPath(new URL("../../..", import.meta.url)),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(repository, "plugins/demo-tools/mcp/server.mjs"),
  });
  const declaration = structuredClone(futureConnector);
  declaration.provider = "new-platform-after-host-build";
  declaration.scopes = ["new-records.read"];
  declaration.oauth!.requiredScopes = declaration.scopes;
  const manifest = join(repository, "plugins/demo-tools/.mcp.json");
  const saveManifest = async () =>
    writeFile(
      manifest,
      JSON.stringify({
        mcpServers: {
          future: {
            type: "stdio",
            command: "${ARTEMIS_NODE}",
            args: ["${PLUGIN_ROOT}/mcp/server.mjs"],
            "x-artemis": { connector: declaration },
          },
        },
      }),
    );
  await saveManifest();
  const key = await signMarketplaceRepository(repository);
  const { service: plugins, mcpStore } = createService(root, {
    cloneRepository: (_url, destination) =>
      cp(repository, destination, { recursive: true }),
  });
  const market = await plugins.addMarketplace(
    "acme/signed-tools",
    undefined,
    key.fingerprint,
  );
  const preview = market.marketplaces[0]!.marketplace.plugins[0]!;
  const installed = await plugins.install(preview.source);
  const config = (await mcpStore.list())[0]!;
  const vault = new ConnectorVault(join(root, "credentials.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  });
  const options = {
    vault,
    configs: () => mcpStore.list(),
    assertTrusted: (c: McpServerConfig) => plugins.assertConnectorTrusted(c),
    openExternal: async (value: string) => {
      const auth = new URL(value);
      const callback = new URL(auth.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({
        code: "synthetic-code",
        state: auth.searchParams.get("state")!,
      }).toString();
      await fetch(callback);
    },
    fetcher: async (input: string | URL | Request) =>
      String(input).endsWith("/token")
        ? Response.json({
            access_token: "resource-access",
            refresh_token: "host-private-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          })
        : Response.json({ id: "account", email: "synthetic@example.com" }),
    connectMcp: async () => {},
    disconnectMcp: async () => {},
    checkMailbox: async () => {},
  };
  const host = new ConnectorService(options);
  await host.connect({ serverId: config.id });
  expect((await host.context(config)).accessToken).toBe("resource-access");
  expect((await host.context(config)).refreshToken).toBeUndefined();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  if (config.transport !== "stdio") throw new Error("Expected local adapter");
  const client = new Client({ name: "frozen-host-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: config.args,
      env: { HOME: root, PATH: process.env.PATH ?? "" },
    }),
  );
  try {
    const result = await client.callTool({
      name: "read_records",
      arguments: {},
      _meta: { "com.artemis.connector/auth": await host.context(config) },
    });
    expect(result.content).toEqual([
      { type: "text", text: "synthetic-record" },
    ]);
  } finally {
    await client.close();
  }

  await vault.set(config.id, {
    ...(await vault.get(config.id))!,
    expiresAt: Date.now() - 1,
  });
  await host.context(config);
  const restarted = new ConnectorService(options);
  expect((await restarted.context(config)).accessToken).toBe("resource-access");
  declaration.displayName = "New display text";
  await saveManifest();
  await signMarketplaceRepository(repository, key.privateKey);
  host.invalidate(config.id);
  await plugins.update(installed.plugin.id);
  const updated = (await mcpStore.list())[0]!;
  expect((await restarted.context(updated)).accessToken).toBe(
    "resource-access",
  );
  declaration.oauth!.client = {
    type: "static",
    clientId: "different-registration",
  };
  await saveManifest();
  await signMarketplaceRepository(repository, key.privateKey);
  host.invalidate(config.id);
  await plugins.update(installed.plugin.id);
  await expect(restarted.context((await mcpStore.list())[0]!)).rejects.toThrow(
    /Connect this account/,
  );
  await restarted.disconnect(config.id);
  expect(await vault.get(config.id)).toBeUndefined();
  expect(
    createHash("sha256")
      .update(await readFile(frozen))
      .digest("hex"),
  ).toBe(originalHash);
}, 30000);
