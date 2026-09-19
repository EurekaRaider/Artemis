import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CodexPluginService } from "../src/main/codex-plugin-service.js";
import { McpConfigStore } from "../src/main/mcp-config-store.js";

// Set this to the paired Shop release archive for cross-repository acceptance.
// All installation data is isolated; this never opens or authorizes an account.
const archive = process.env.ARTEMIS_CONNECTOR_MARKETPLACE_ARCHIVE;
it.skipIf(!archive)(
  "installs and verifies all ten connectors from the paired signed offline package",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-shop-acceptance-"));
    try {
      const mcpStore = new McpConfigStore(join(root, "mcp.json"));
      const service = new CodexPluginService({
        skillsRoot: join(root, "skills"),
        pluginsRoot: join(root, "plugins"),
        marketplacesRoot: join(root, "marketplaces"),
        marketplaceStatePath: join(root, "marketplaces.json"),
        statePath: join(root, "plugins.json"),
        mcpWorkspaceRoot: join(root, "workspaces"),
        mcpStore,
        cloneRepository: async () => {
          throw new Error("Offline acceptance must not clone a repository.");
        },
      });
      const trust = await service.inspectOfflineMarketplace(archive!);
      expect(trust.signed).toBe(true);
      const imported = await service.addOfflineMarketplace(
        archive!,
        trust.signingKeyFingerprint!,
      );
      const source = imported.sources.find((entry) => entry.offline)!;
      const market = (
        await service.listMarketplaces(source.id)
      ).marketplaces.find((entry) => entry.sourceId === source.id)!.marketplace;
      expect(market.plugins).toHaveLength(10);
      for (const plugin of market.plugins) {
        expect(
          plugin.installable,
          `${plugin.name}: ${plugin.unsupported.join(", ")}`,
        ).toBe(true);
        expect(
          plugin.mcpServers.filter((server) => server.connector),
        ).toHaveLength(1);
        await service.install(plugin.source);
      }
      const configs = await mcpStore.list();
      expect(configs).toHaveLength(10);
      expect(new Set(configs.map((config) => config.connector!.id)).size).toBe(
        10,
      );
      for (const config of configs) {
        expect(config.enabled).toBe(false);
        expect(config.connector?.version).toBe(1);
        await service.assertConnectorTrusted(config);
      }
      expect(await service.listInstalled()).toHaveLength(10);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
