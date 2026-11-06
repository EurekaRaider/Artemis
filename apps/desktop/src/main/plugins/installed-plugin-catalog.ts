import { normalizeMarketplaceUrl } from "./marketplace-download.js";
import { blockingUnavailableConnectorNames } from "./plugin-mcp.js";
import { verifyMarketplaceIntegrity } from "./marketplace-integrity.js";
import {
  exists,
  canonicalDirectory,
  collectFiles,
  collectedHash,
} from "./plugin-files.js";
import {
  pathIsInside,
  stableHash,
  mcpConfigId,
  mcpStructuralHash,
} from "./plugin-values.js";
import {
  MAX_PLUGIN_FILES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_PLUGIN_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_BYTES,
} from "./plugin-constants.js";
import type { StoredPlugin } from "./plugin-types.js";

import type { ConnectorOwner } from "../connectors/connector-service.js";

import { join } from "node:path";

import type {
  InstalledArtemisPlugin,
  McpServerConfig,
} from "../../shared/api.js";

import { isSkillInstallerMetadata } from "./skill-metadata.js";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createInstalledPluginCatalog(
  services: Pick<
    PluginServiceDependencies,
    | "loadStore"
    | "options"
    | "installedPlugin"
    | "loadBundledArtifactMarketplace"
    | "listMarketplaces"
    | "listInstalled"
    | "verifyInstalledResources"
    | "loadMarketplaceStore"
    | "marketplaceCache"
    | "marketplaceFile"
    | "parsePlugin"
  >,
) {
  async function listInstalled(): Promise<InstalledArtemisPlugin[]> {
    const plugins = (await services.loadStore()).plugins
      .filter(
        (plugin) =>
          services.options.computerUseRoot ||
          plugin.source.kind !== "builtin" ||
          plugin.source.pluginName !== "computer-use",
      )
      .map((plugin) => services.installedPlugin(plugin));
    const configuredIds = new Set(
      (await services.options.mcpStore.list()).map((config) => config.id),
    );
    for (const plugin of plugins) {
      if (plugin.mcpServerIds.some((id) => !configuredIds.has(id)))
        plugin.warnings.push(
          "Update plugin and reconnect. Its previous connection cannot execute.",
        );
    }
    const bundledMarketplace = plugins.some(
      (plugin) =>
        plugin.source.kind === "bundled" || plugin.source.kind === "runtime",
    )
      ? await services.loadBundledArtifactMarketplace()
      : undefined;
    const currentBundledPlugins = new Map(
      (bundledMarketplace?.plugins ?? []).map((plugin) => [plugin.id, plugin]),
    );
    return plugins
      .map((plugin) => {
        const bundled = currentBundledPlugins.get(plugin.id);
        if (!bundled) return plugin;
        return {
          ...plugin,
          ...(bundled.brandColor ? { brandColor: bundled.brandColor } : {}),
          ...(bundled.iconDataUrl ? { iconDataUrl: bundled.iconDataUrl } : {}),
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async function installedById(
    pluginIdentifier: string,
  ): Promise<InstalledArtemisPlugin | undefined> {
    const plugin = (await services.loadStore()).plugins.find(
      (candidate) => candidate.id === pluginIdentifier,
    );
    return plugin ? services.installedPlugin(plugin) : undefined;
  }

  async function listConnectorDefinitions() {
    const state = await services.listMarketplaces();
    const installed = await services.listInstalled();
    return state.marketplaces.flatMap(({ marketplace }) =>
      marketplace.plugins.flatMap((plugin) =>
        plugin.mcpServers.flatMap((server) =>
          server.connector
            ? [
                {
                  ...server.connector,
                  serverId: mcpConfigId(plugin.id, server.name),
                  pluginId: plugin.id,
                  installed: installed.some((p) => p.id === plugin.id),
                },
              ]
            : [],
        ),
      ),
    );
  }

  async function isComputerUseServer(
    config: McpServerConfig,
  ): Promise<boolean> {
    const owner = (await services.loadStore()).plugins.find(
      (plugin) =>
        plugin.source.kind === "builtin" &&
        plugin.source.pluginName === "computer-use" &&
        plugin.mcpServers.some(
          (server) =>
            server.id === config.id &&
            server.structuralHash === mcpStructuralHash(config),
        ),
    );
    if (
      !owner ||
      owner.formatMigrationRequired ||
      !services.options.computerUseRoot
    )
      return false;
    await services.verifyInstalledResources(
      owner,
      await services.options.mcpStore.list(),
    );
    return true;
  }

  async function mcpRuntimeReadOnlyPaths(
    config: McpServerConfig,
  ): Promise<string[]> {
    const owner = (await services.loadStore()).plugins.find((plugin) =>
      plugin.mcpServers.some((server) => server.id === config.id),
    );
    if (owner?.formatMigrationRequired)
      throw new Error(
        "Update this plugin to the Artemis native format before connecting.",
      );
    if (config.transport !== "stdio") return [];
    if (!owner) return [];
    const server = owner.mcpServers.find(
      (candidate) => candidate.id === config.id,
    )!;
    if (server.structuralHash !== mcpStructuralHash(config)) {
      throw new Error(
        "Installed plugin MCP configuration changed. Reinstall the plugin before connecting.",
      );
    }
    const root = await canonicalDirectory(
      join(services.options.pluginsRoot, owner.id),
      services.options.pluginsRoot,
    );
    const files = await collectFiles(root, {
      maximumFiles: MAX_PLUGIN_FILES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_PLUGIN_BYTES,
    });
    if (collectedHash(files) !== owner.contentHash) {
      throw new Error(
        "Installed plugin contents changed. Update the plugin and reconnect.",
      );
    }
    return [root];
  }

  async function assertConnectorTrusted(
    config: McpServerConfig,
  ): Promise<ConnectorOwner | void> {
    if (!config.connector) return;
    const store = await services.loadStore();
    const owner = store.plugins.find((plugin) =>
      plugin.mcpServers.some((server) => server.id === config.id),
    );
    if (owner?.formatMigrationRequired)
      throw new Error(
        "Update this plugin to the Artemis native format before connecting.",
      );
    const storedServer = owner?.mcpServers.find(
      (server) => server.id === config.id,
    );
    if (
      !owner ||
      !storedServer ||
      storedServer.structuralHash !== mcpStructuralHash(config) ||
      owner.source.kind !== "git"
    ) {
      throw new Error(
        "This MCP server is not owned by a trusted signed plugin.",
      );
    }
    const installedFiles = await collectFiles(
      join(services.options.pluginsRoot, owner.id),
      {
        maximumFiles: MAX_PLUGIN_FILES,
        maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
        maximumBytes: MAX_PLUGIN_BYTES,
      },
    );
    if (collectedHash(installedFiles) !== owner.contentHash) {
      throw new Error(
        "Installed plugin contents changed. Update the plugin and reconnect.",
      );
    }
    const url = normalizeMarketplaceUrl(owner.source.marketplaceUrl);
    const source = (await services.loadMarketplaceStore()).sources.find(
      (candidate) => candidate.url === url,
    );
    if (!source?.signingKeyFingerprint) {
      throw new Error(
        "The plugin marketplace is not trusted for host credentials.",
      );
    }
    const cache = services.marketplaceCache(url);
    const integrity = await verifyMarketplaceIntegrity(
      cache,
      await services.marketplaceFile(cache),
    );
    if (
      integrity?.signingKeyFingerprint !== source.signingKeyFingerprint ||
      integrity.pluginHashes.get(owner.source.pluginName) !== owner.contentHash
    ) {
      throw new Error(
        "The plugin signature or content digest no longer matches.",
      );
    }
    return {
      pluginId: owner.id,
      marketplaceUrl: url,
      signingKeyFingerprint: source.signingKeyFingerprint,
    };
  }

  function installedPlugin(plugin: StoredPlugin): InstalledArtemisPlugin {
    return {
      id: plugin.id,
      capabilityDependencies: structuredClone(
        plugin.capabilityDependencies ?? [],
      ),
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      description: plugin.description,
      ...(plugin.localizations
        ? { localizations: structuredClone(plugin.localizations) }
        : {}),
      ...(plugin.shortDescription
        ? { shortDescription: plugin.shortDescription }
        : {}),
      ...(plugin.category ? { category: plugin.category } : {}),
      ...(plugin.brandColor ? { brandColor: plugin.brandColor } : {}),
      ...(plugin.iconDataUrl ? { iconDataUrl: plugin.iconDataUrl } : {}),
      source: structuredClone(plugin.source),
      installed: true,
      installable:
        blockingUnavailableConnectorNames(
          plugin.source,
          plugin.appPreviews,
          plugin.mcpPreviews,
        ).length === 0,
      skins: plugin.skins.map(({ path: _path, ...summary }) => summary),
      skinsEnabled: !plugin.formatMigrationRequired && plugin.skinsEnabled,
      skills: structuredClone(plugin.skillPreviews),
      mcpServers: structuredClone(plugin.mcpPreviews),
      apps: structuredClone(plugin.appPreviews),
      hasHooks: plugin.hasHooks ?? plugin.unsupported.includes("Hooks"),
      unsupported: plugin.unsupported.filter((value) => value !== "Hooks"),
      warnings: [
        ...plugin.warnings,
        ...(plugin.formatMigrationRequired
          ? [
              "Update this plugin to the Artemis native format. Its executable services and Hooks are disabled until the verified update completes.",
            ]
          : []),
      ],
      ...(plugin.formatMigrationRequired
        ? {
            formatMigrationRequired: true,
            formatMigrationEnabledMcpIds: [
              ...(plugin.formatMigrationEnabledMcpIds ?? []),
            ],
          }
        : {}),
      contentHash: plugin.contentHash,
      installedAt: plugin.installedAt,
      updatedAt: plugin.updatedAt,
      skillNames: plugin.skills.map((skill) => skill.name),
      mcpServerIds: plugin.mcpServers.map((server) => server.id),
      ...(plugin.designPlugin ? { designPlugin: plugin.designPlugin } : {}),
    };
  }

  function resourceDestinations(plugin: StoredPlugin): string[] {
    const pluginDirectory = join(services.options.pluginsRoot, plugin.id);
    if (!pathIsInside(services.options.pluginsRoot, pluginDirectory)) {
      throw new Error("Managed plugin path is unsafe.");
    }
    return [
      pluginDirectory,
      ...plugin.skills.map((skill) => {
        const path = join(services.options.skillsRoot, skill.name);
        if (!pathIsInside(services.options.skillsRoot, path)) {
          throw new Error("Managed plugin Skill path is unsafe.");
        }
        return path;
      }),
    ];
  }

  async function verifyInstalledResources(
    plugin: StoredPlugin,
    currentMcp: McpServerConfig[],
  ): Promise<void> {
    const pluginDirectory = join(services.options.pluginsRoot, plugin.id);
    if (!(await exists(pluginDirectory))) {
      throw new Error("Managed plugin files are missing.");
    }
    const pluginFiles = await collectFiles(pluginDirectory, {
      maximumFiles: MAX_PLUGIN_FILES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_PLUGIN_BYTES,
    });
    if (collectedHash(pluginFiles) !== plugin.contentHash) {
      throw new Error(
        "Managed plugin files were modified; reinstall manually.",
      );
    }
    for (const skill of plugin.skills) {
      const skillPath = join(services.options.skillsRoot, skill.name);
      if (!(await exists(skillPath))) {
        if (plugin.formatMigrationRequired) continue;
        throw new Error(`Plugin Skill is missing: ${skill.name}`);
      }
      const files = (
        await collectFiles(skillPath, {
          maximumFiles: MAX_SKILL_FILES + 1,
          maximumFileBytes: MAX_SKILL_FILE_BYTES,
          maximumBytes: MAX_SKILL_BYTES,
        })
      ).filter((file) => !isSkillInstallerMetadata(file.relativePath));
      if (collectedHash(files) !== skill.hash) {
        throw new Error(`Plugin Skill was modified: ${skill.name}`);
      }
    }
    for (const server of plugin.mcpServers) {
      const current = currentMcp.find((config) => config.id === server.id);
      if (!current) {
        if (plugin.formatMigrationRequired) continue;
        // The old declaration is inspected only to confirm rejection. Its
        // connection and credentials are never restored or translated.
        const previous = await services.parsePlugin(
          pluginDirectory,
          plugin.source,
          false,
        );
        if (
          previous.apps.some(
            (app) => app.name === "Update plugin and reconnect",
          )
        )
          continue;
        throw new Error(`Plugin MCP server is missing: ${server.id}`);
      }
      // Before versioned Connectors, ordinary HTTP MCP hashes omitted auth.
      // Match that exact legacy shape without weakening Connector trust checks.
      const matchesLegacyHttp =
        current.transport === "streamable-http" &&
        !current.connector &&
        current.resourceKind !== "connector" &&
        stableHash({
          id: current.id,
          name: current.name,
          transport: current.transport,
          url: current.url,
          resourceKind: current.resourceKind,
          connectorId: current.connectorId,
        }) === server.structuralHash;
      if (
        mcpStructuralHash(current) !== server.structuralHash &&
        !matchesLegacyHttp
      ) {
        throw new Error(
          `Plugin MCP server was structurally modified: ${server.id}`,
        );
      }
    }
  }
  const handlers = {
    listInstalled,
    installedById,
    listConnectorDefinitions,
    isComputerUseServer,
    mcpRuntimeReadOnlyPaths,
    assertConnectorTrusted,
    installedPlugin,
    resourceDestinations,
    verifyInstalledResources,
  };
  return handlers;
}
