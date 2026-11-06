import {
  parseDesignPluginManifest,
  validateSource,
} from "./plugin-validation.js";
import { normalizeMarketplaceUrl } from "./marketplace-download.js";

import { readJson, canonicalDirectory } from "./plugin-files.js";
import { pathIsInside } from "./plugin-values.js";
import { MAX_MANIFEST_BYTES } from "./plugin-constants.js";
import type { ProgressReporter, PluginStore } from "./plugin-types.js";

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  ArtemisPluginSource,
  InstalledArtemisPlugin,
} from "../../shared/api.js";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginInstallCoordinator(
  services: Pick<
    PluginServiceDependencies,
    | "loadStore"
    | "update"
    | "exclusive"
    | "parsePlugin"
    | "commitInstall"
    | "options"
    | "resolveSource"
    | "assertSupportedAppConnectors"
    | "loadMarketplaceStore"
    | "refreshMarketplace"
    | "isStrictGithubMarketplace"
    | "verifyInstalledResources"
    | "resourceDestinations"
    | "commitMoves"
  >,
) {
  async function upgradeMigratedBundledPlugins(): Promise<string[]> {
    const pending = (await services.loadStore()).plugins.filter(
      (plugin) =>
        plugin.formatMigrationRequired &&
        ["builtin", "bundled", "runtime"].includes(plugin.source.kind),
    );
    const warnings: string[] = [];
    for (const plugin of pending) {
      try {
        await services.update(plugin.id);
      } catch {
        warnings.push(
          `${plugin.displayName}: native plugin update is required.`,
        );
      }
    }
    return warnings;
  }

  async function installComputerUseFromRoot(
    root: string,
    version: string,
  ): Promise<InstalledArtemisPlugin> {
    return services.exclusive(async () => {
      const parsed = await services.parsePlugin(
        await canonicalDirectory(root),
        { kind: "builtin", pluginName: "computer-use" },
        true,
      );
      if (parsed.name !== "computer-use" || parsed.version !== version)
        throw new Error("Computer Use plugin and helper versions must match.");
      const store = await services.loadStore();
      const existing = store.plugins.find((plugin) => plugin.id === parsed.id);
      const installed = await services.commitInstall(parsed, existing);
      return installed.plugin;
    });
  }

  async function install(
    sourceInput: ArtemisPluginSource,
    onProgress?: ProgressReporter,
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    return services.exclusive(async () => {
      if (
        services.options.computerUseManagedRuntime &&
        sourceInput.kind === "builtin"
      )
        throw new Error(
          "Computer Use must be installed through its verified native runtime.",
        );
      const parsed = await services.resolveSource(
        validateSource(sourceInput),
        false,
      );
      services.assertSupportedAppConnectors(parsed);
      const store = await services.loadStore();
      const existing = store.plugins.find((plugin) => plugin.id === parsed.id);
      if (existing && !parsed.skins.length && !existing.skins.length) {
        throw new Error("Plugin is already installed. Use Update instead.");
      }
      return services.commitInstall(parsed, existing, onProgress);
    });
  }

  async function update(
    pluginIdentifier: string,
    onProgress?: ProgressReporter,
    options?: { newServicesEnabled: boolean },
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    return services.exclusive(async () => {
      const store = await services.loadStore();
      const existing = store.plugins.find(
        (plugin) => plugin.id === pluginIdentifier,
      );
      if (!existing) throw new Error("Installed plugin was not found.");
      if (
        services.options.computerUseManagedRuntime &&
        existing.source.kind === "builtin"
      )
        throw new Error(
          "Computer Use must be updated through its verified native runtime.",
        );
      if (existing.source.kind === "git") {
        const gitSource = existing.source;
        const trustedSource = (
          await services.loadMarketplaceStore()
        ).sources.find(
          (source) =>
            source.url === normalizeMarketplaceUrl(gitSource.marketplaceUrl),
        );
        if (trustedSource?.mode !== "offline") {
          await services.refreshMarketplace(
            gitSource.marketplaceUrl,
            onProgress,
            gitSource.marketplaceName,
            services.isStrictGithubMarketplace(gitSource.marketplaceUrl),
            trustedSource?.signingKeyFingerprint,
          );
        }
      }
      const parsed = await services.resolveSource(existing.source, true);
      services.assertSupportedAppConnectors(parsed);
      if (parsed.id !== existing.id) {
        throw new Error(
          "Plugin source identity changed and cannot be updated in place.",
        );
      }
      return services.commitInstall(
        parsed,
        existing,
        onProgress,
        options?.newServicesEnabled,
      );
    });
  }

  async function remove(
    pluginIdentifier: string,
  ): Promise<{ warnings: string[] }> {
    return services.exclusive(async () => {
      const store = await services.loadStore();
      const existing = store.plugins.find(
        (plugin) => plugin.id === pluginIdentifier,
      );
      if (!existing) throw new Error("Installed plugin was not found.");
      const currentMcp = await services.options.mcpStore.list();
      await services.verifyInstalledResources(existing, currentMcp);
      const designManifest = parseDesignPluginManifest(
        await readJson(
          join(
            services.options.pluginsRoot,
            existing.id,
            "artemis.plugin.json",
          ),
          MAX_MANIFEST_BYTES,
        ),
      );
      const moves = services
        .resourceDestinations(existing)
        .map((destination) => ({
          destination,
          backup: `${destination}.remove-${randomUUID()}`,
        }));
      const nextMcp = currentMcp.filter(
        (config) =>
          !existing.mcpServers.some((server) => server.id === config.id),
      );
      const nextStore: PluginStore = {
        version: 1,
        plugins: store.plugins.filter((plugin) => plugin.id !== existing.id),
      };
      await services.commitMoves(moves, currentMcp, nextMcp, nextStore);
      const warnings: string[] = [];
      if (designManifest) {
        try {
          // Revisions use the manifest ID, not the source-derived store ID.
          // Several installed sources can share that revision namespace.
          let shared = false;
          for (const plugin of nextStore.plugins) {
            const manifest = parseDesignPluginManifest(
              await readJson(
                join(
                  services.options.pluginsRoot,
                  plugin.id,
                  "artemis.plugin.json",
                ),
                MAX_MANIFEST_BYTES,
              ),
            );
            if (manifest?.id === designManifest.id) {
              shared = true;
              break;
            }
          }
          const revisionsRoot =
            services.options.designRevisionsRoot ??
            join(services.options.pluginsRoot, "plugin-revisions");
          const path = join(revisionsRoot, designManifest.id);
          if (!pathIsInside(revisionsRoot, path) || path === revisionsRoot)
            throw new Error("Managed plugin revision path is unsafe.");
          if (!shared) await rm(path, { recursive: true, force: true });
        } catch (error) {
          warnings.push(`Failed to remove plugin revisions: ${String(error)}`);
        }
      }
      return { warnings };
    });
  }
  const handlers = {
    upgradeMigratedBundledPlugins,
    installComputerUseFromRoot,
    install,
    update,
    remove,
  };
  return handlers;
}
