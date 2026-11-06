import {
  canonicalDirectory,
  collectFiles,
  collectedHash,
} from "./plugin-files.js";
import { pluginId } from "./plugin-values.js";
import {
  MAX_PLUGIN_FILES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_PLUGIN_BYTES,
} from "./plugin-constants.js";

import { join } from "node:path";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginSkinRuntime(
  services: Pick<
    PluginServiceDependencies,
    "loadStore" | "options" | "exclusive" | "saveStore"
  >,
) {
  async function skinSources() {
    return (await services.loadStore()).plugins
      .filter((plugin) => !plugin.formatMigrationRequired)
      .map((plugin) => ({
        pluginId: plugin.id,
        pluginName: plugin.displayName,
        contentHash: plugin.contentHash,
        enabled: plugin.skinsEnabled,
        root: join(services.options.pluginsRoot, plugin.id),
        skins: structuredClone(plugin.skins),
      }));
  }

  async function assertSkinSnapshot(
    pluginId: string,
    contentHash: string,
  ): Promise<void> {
    const plugin = (await services.loadStore()).plugins.find(
      (p) => p.id === pluginId,
    );
    if (
      !plugin ||
      plugin.formatMigrationRequired ||
      !plugin.skinsEnabled ||
      plugin.contentHash !== contentHash
    )
      throw new Error("Skin plugin is no longer available.");
    const files = await collectFiles(
      await canonicalDirectory(
        join(services.options.pluginsRoot, plugin.id),
        services.options.pluginsRoot,
      ),
      {
        maximumFiles: MAX_PLUGIN_FILES,
        maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
        maximumBytes: MAX_PLUGIN_BYTES,
      },
    );
    if (collectedHash(files) !== contentHash)
      throw new Error("Installed skin plugin contents changed.");
  }

  async function setSkinsEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<void> {
    if (typeof enabled !== "boolean")
      throw new Error("Invalid skin enablement.");
    await services.exclusive(async () => {
      const store = await services.loadStore(),
        plugin = store.plugins.find((p) => p.id === pluginId);
      if (!plugin || plugin.formatMigrationRequired)
        throw new Error("Skin plugin is not available.");
      try {
        if (!enabled) await services.options.beforeSnapshotChange?.(pluginId);
        await services.saveStore({
          ...store,
          plugins: store.plugins.map((p) =>
            p.id === pluginId ? { ...p, skinsEnabled: enabled } : p,
          ),
        });
      } finally {
        await services.options.afterSnapshotChange?.();
      }
    });
  }

  async function hookSources(): Promise<
    Array<{ id: string; name: string; root: string; contentHash: string }>
  > {
    const plugins = (await services.loadStore()).plugins;
    return plugins
      .filter((plugin) => !plugin.formatMigrationRequired)
      .map((plugin) => ({
        id: plugin.id,
        root: join(services.options.pluginsRoot, plugin.id),
        name: plugin.displayName || plugin.name,
        contentHash: plugin.contentHash,
      }));
  }
  const handlers = {
    skinSources,
    assertSkinSnapshot,
    setSkinsEnabled,
    hookSources,
  };
  return handlers;
}
