import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { c as createTar } from "tar";

import { CodexPluginService } from "../src/main/codex-plugin-service.js";
import { McpConfigStore } from "../src/main/mcp-config-store.js";
import type { McpServerConfig } from "../src/shared/api.js";

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

async function temporaryRoot(prefix = "artemis-codex-plugin-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

function createService(
  root: string,
  options: {
    mcpStore?: McpConfigStore;
    bundledArtifactRoot?: string;
    cloneRepository?: (url: string, destination: string) => Promise<void>;
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  const mcpStore =
    options.mcpStore ?? new McpConfigStore(join(root, "user-data", "mcp.json"));
  return {
    mcpStore,
    service: new CodexPluginService({
      skillsRoot: join(root, "home", ".pi", "agent", "skills"),
      pluginsRoot: join(root, "user-data", "codex-plugins"),
      marketplacesRoot: join(root, "user-data", "codex-marketplaces"),
      marketplaceStatePath: join(
        root,
        "user-data",
        "codex-plugin-marketplaces.json",
      ),
      statePath: join(root, "user-data", "codex-plugins.json"),
      mcpWorkspaceRoot: join(root, "user-data", "mcp-workspaces"),
      mcpStore,
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
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "hello", "references"), {
    recursive: true,
  });
  await mkdir(join(pluginRoot, "mcp"), { recursive: true });
  await mkdir(join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "demo-tools",
      version: options.version ?? "1.0.0",
      description: "A portable Codex plugin.",
      skills: "./skills/",
      ...(options.declareMcp === false ? {} : { mcpServers: "./.mcp.json" }),
      apps: "./.app.json",
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
  await writeFile(join(pluginRoot, ".app.json"), '{"apps":{}}\n');
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
  await mkdir(join(repository, ".agents", "plugins"), { recursive: true });
  await writeFile(
    join(repository, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify({
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

describe("CodexPluginService", () => {
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
      join(userData, "codex-plugin-marketplaces.json"),
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

  it("exposes bounded plugin branding and declared Apps for the Codex-style UI", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "branded-tools");
    await writePlugin(source);
    const manifestPath = join(source, ".codex-plugin", "plugin.json");
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
    await writeFile(
      join(source, ".app.json"),
      JSON.stringify({
        apps: {
          branded: {
            id: "connector_demo",
            url: "https://connector.example.test/mcp",
            auth: "none",
          },
        },
      }),
    );
    const { service } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(preview).toMatchObject({
      displayName: "Branded Tools",
      shortDescription: "A polished plugin preview.",
      category: "Productivity",
      brandColor: "#4285F4",
      apps: [
        {
          name: "branded",
          connectorId: "connector_demo",
          url: "https://connector.example.test/mcp",
          auth: "none",
        },
      ],
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
      {
        name: "gmail",
        connectorId: "connector_gmail",
      },
    ]);
    await expect(service.install(preview.source)).rejects.toThrow(
      "requires a Connector endpoint that is unavailable: gmail",
    );
  });

  it("keeps plugins that provide an importable MCP fallback for the declared App", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "figma-tools");
    await writePlugin(source);
    await writeFile(
      join(source, ".app.json"),
      JSON.stringify({
        apps: {
          docs: { id: "connector_docs" },
        },
      }),
    );
    const { service } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(preview.installable).toBe(true);
    expect(preview.unsupported).not.toContain("Unavailable Connectors");
  });

  it("installs executable Connector declarations through the existing MCP broker", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "connector-tools");
    await writePlugin(source, { declareMcp: false });
    const manifestPath = join(source, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete manifest.apps;
    manifest.connectors = "./.connector.json";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await writeFile(
      join(source, ".connector.json"),
      JSON.stringify({
        connectors: {
          mail: {
            id: "mail",
            url: "https://connector.example.test/mcp",
            auth: "oauth",
            required: true,
          },
        },
      }),
    );
    const { service, mcpStore } = createService(root);

    const preview = await service.inspectLocal(source);

    expect(preview.installable).toBe(true);
    expect(preview.apps).toEqual([
      {
        name: "mail",
        connectorId: "mail",
        url: "https://connector.example.test/mcp",
        auth: "oauth",
        required: true,
      },
    ]);
    const installed = await service.install(preview.source);
    const connector = (await mcpStore.list()).find(
      (config) => config.resourceKind === "connector",
    );
    expect(connector).toMatchObject({
      id: installed.plugin.mcpServerIds[0],
      name: "Demo Tools: mail",
      transport: "streamable-http",
      enabled: false,
      url: "https://connector.example.test/mcp",
      auth: "oauth",
      resourceKind: "connector",
      connectorId: "mail",
    });

    await service.remove(installed.plugin.id);
    expect(await mcpStore.list()).toEqual([]);
  });

  it("rejects remote Connector endpoints that do not use HTTPS", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "unsafe-connector-tools");
    await writePlugin(source, { declareMcp: false });
    const manifestPath = join(source, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete manifest.apps;
    manifest.connectors = {
      unsafe: {
        url: "http://connector.example.test/mcp",
        auth: "none",
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const { service } = createService(root);

    await expect(service.inspectLocal(source)).rejects.toThrow(
      "Connector URL must use HTTPS or loopback HTTP",
    );
  });

  it("previews and atomically installs portable Skills and disabled MCP servers", async () => {
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
      unsupported: ["Hooks"],
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
    expect(servers.find((server) => server.id === "existing")).toBeDefined();
    const local = servers.find(
      (server): server is Extract<McpServerConfig, { transport: "stdio" }> =>
        server.transport === "stdio",
    );
    expect(local).toMatchObject({
      enabled: false,
      command: "node",
      env: {},
      envVars: ["API_TOKEN"],
    });
    expect(local?.args[0]).toContain(
      join("codex-plugins", installed.plugin.id, "mcp", "server.mjs"),
    );
    expect(
      servers.find(
        (server) =>
          server.transport === "streamable-http" &&
          server.url === "https://docs.example.test/mcp",
      ),
    ).toMatchObject({ enabled: false, auth: "oauth" });

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

  it("disables a remote MCP server when an update changes its endpoint", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source", "demo-tools");
    await writePlugin(source);
    const { service, mcpStore } = createService(root);
    const first = await service.install({ kind: "local", path: source });
    await mcpStore.replaceAll(
      (await mcpStore.list()).map((server) => ({
        ...server,
        enabled: true,
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
      enabled: false,
      url: "https://new-docs.example.test/mcp",
      auth: "oauth",
    });
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
    await mkdir(join(source, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(source, ".codex-plugin", "plugin.json"),
      JSON.stringify({
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
    await symlink(external, join(source, "skills", "hello", "linked"));
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
    await mkdir(join(repository, ".agents", "plugins"), { recursive: true });
    await writeFile(
      join(repository, ".agents", "plugins", "marketplace.json"),
      `${JSON.stringify({
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
    expect(marketplace.plugins).toHaveLength(2);
    expect(
      marketplace.plugins.some(
        (candidate) => candidate.name === "unavailable-tools",
      ),
    ).toBe(false);
    expect(
      marketplace.plugins.map((candidate) =>
        candidate.source.kind === "git" ? candidate.source.pluginName : "local",
      ),
    ).toEqual(expect.arrayContaining(["demo-tools", "demo-tools-alias"]));
    expect(marketplace.warnings.join("\n")).toContain("remote-only");
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
        (candidate) => candidate.name === "unavailable-tools",
      ),
    ).toBe(false);
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
    await mkdir(join(repository, ".agents", "plugins"), { recursive: true });
    await writeFile(
      join(repository, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({
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
      join(repository, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({
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
      join(repository, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({
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
          plugin.version === "1.0.1" &&
          plugin.iconDataUrl?.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
    expect(marketplace?.plugins.every((plugin) => !plugin.apps.length)).toBe(
      true,
    );
    for (const plugin of marketplace?.plugins ?? []) {
      expect(plugin.skills.map((skill) => skill.name)).toEqual([plugin.name]);
      await expect(service.install(plugin.source)).resolves.toMatchObject({
        plugin: { name: plugin.name, installed: true },
      });
      const skillSource = await readFile(
        join(root, "home", ".pi", "agent", "skills", plugin.name, "SKILL.md"),
        "utf8",
      );
      expect(skillSource).toContain("`office_document`");
      expect(skillSource).toContain(
        "Do not call `load_workspace_dependencies`",
      );
    }
    expect(
      (await service.listInstalled()).map((plugin) => plugin.name),
    ).toEqual(["documents", "pdf", "presentations", "spreadsheets"]);
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
      ).resolves.toContain(`"source": "codex-plugin:${plugin.name}"`);
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
    const statePath = join(root, "user-data", "codex-plugins.json");
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
    const statePath = join(root, "user-data", "codex-plugins.json");
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
