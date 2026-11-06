import { previewMcp } from "./plugin-mcp.js";
import { installedSkillMatchesHash } from "./marketplace-integrity.js";
import { exists, copyCollectedFiles } from "./plugin-files.js";
import { safeSlug, mcpStructuralHash } from "./plugin-values.js";

import type {
  ProgressReporter,
  ParsedPlugin,
  StoredPlugin,
  PluginStore,
  PreparedPlugin,
  DirectoryMove,
} from "./plugin-types.js";
import { PluginInstallTransaction } from "./plugin-install-transaction.js";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PluginRevisionStore } from "../design/design-plugin-revision-store.js";
import type {
  InstalledArtemisPlugin,
  McpServerConfig,
} from "../../shared/api.js";

import { SKILL_METADATA_FILE } from "./skill-metadata.js";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginInstallCommit(
  services: Pick<
    PluginServiceDependencies,
    | "options"
    | "buildMcpConfigs"
    | "preparePlugin"
    | "loadStore"
    | "verifyInstalledResources"
    | "mergeMcpUserSettings"
    | "publishDesignPluginRevision"
    | "commitMoves"
    | "installedPlugin"
    | "installTransaction"
    | "saveStore"
  >,
) {
  async function preparePlugin(parsed: ParsedPlugin): Promise<PreparedPlugin> {
    if (!parsed.files || !parsed.contentHash) {
      throw new Error("Plugin was not fully prepared for installation.");
    }
    const pluginDirectory = join(services.options.pluginsRoot, parsed.id);
    const skills = parsed.skills.map((skill) => {
      if (!skill.hash || !skill.files) {
        throw new Error(`Plugin Skill was not prepared: ${skill.name}`);
      }
      return { ...skill, hash: skill.hash, files: skill.files };
    });
    return {
      parsed,
      pluginDirectory,
      skills,
      mcpConfigs: await services.buildMcpConfigs(parsed, pluginDirectory),
    };
  }

  async function commitInstall(
    parsed: ParsedPlugin,
    existing: StoredPlugin | undefined,
    onProgress?: ProgressReporter,
    newServicesEnabledInput?: boolean,
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    const prepared = await services.preparePlugin(parsed);
    const store = await services.loadStore();
    const currentMcp = await services.options.mcpStore.list();
    if (existing) await services.verifyInstalledResources(existing, currentMcp);
    for (const skin of parsed.skins) {
      const owner = store.plugins.find(
        (plugin) =>
          plugin.id !== parsed.id &&
          plugin.skins.some((candidate) => candidate.id === skin.id),
      );
      if (owner)
        throw new Error(
          `Skin ID "${skin.id}" is already installed by "${owner.displayName}".`,
        );
    }
    onProgress?.(55);

    const oldSkillNames = new Set(
      existing?.skills.map((skill) => skill.name) ?? [],
    );
    for (const skill of prepared.skills) {
      const destination = join(services.options.skillsRoot, skill.name);
      const destinationExists = await exists(destination);
      const matchingBundledSkill =
        destinationExists &&
        !existing &&
        parsed.source.kind === "bundled" &&
        parsed.source.pluginName === skill.name &&
        (await installedSkillMatchesHash(destination, skill.hash));
      if (
        destinationExists &&
        !oldSkillNames.has(skill.name) &&
        !matchingBundledSkill
      ) {
        const owner = store.plugins.find(
          (plugin) =>
            plugin.id !== existing?.id &&
            plugin.skills.some((candidate) => candidate.name === skill.name),
        );
        throw new Error(
          owner
            ? `Skill "${skill.name}" is already installed by "${owner.displayName}".`
            : `Skill "${skill.name}" is already installed by another source.`,
        );
      }
    }
    if ((await exists(prepared.pluginDirectory)) && !existing) {
      throw new Error("Managed plugin destination already exists.");
    }

    const oldMcpIds = new Set(
      existing?.mcpServers.map((server) => server.id) ?? [],
    );
    for (const config of prepared.mcpConfigs) {
      if (
        currentMcp.some((current) => current.id === config.id) &&
        !oldMcpIds.has(config.id)
      ) {
        throw new Error(`MCP server ID is already installed: ${config.id}`);
      }
    }
    const currentById = new Map(
      currentMcp.map((config) => [config.id, config]),
    );
    const newServicesEnabled =
      newServicesEnabledInput ??
      ((existing?.formatMigrationRequired &&
        Boolean(existing.formatMigrationEnabledMcpIds?.length)) ||
        !existing ||
        oldMcpIds.size === 0 ||
        currentMcp.some(
          (config) => oldMcpIds.has(config.id) && config.enabled,
        ));
    const mergedMcp = prepared.mcpConfigs.map((config) =>
      services.mergeMcpUserSettings(
        { ...config, enabled: newServicesEnabled },
        existing?.formatMigrationRequired && currentById.has(config.id)
          ? {
              ...currentById.get(config.id)!,
              enabled:
                newServicesEnabledInput !== false &&
                Boolean(
                  existing.formatMigrationEnabledMcpIds?.includes(config.id),
                ),
            }
          : currentById.get(config.id),
      ),
    );
    const nextMcp = [
      ...currentMcp.filter((config) => !oldMcpIds.has(config.id)),
      ...mergedMcp,
    ];

    await mkdir(services.options.pluginsRoot, { recursive: true });
    await mkdir(services.options.skillsRoot, { recursive: true });
    const pluginStage = join(
      services.options.pluginsRoot,
      `.install-${randomUUID()}`,
    );
    await copyCollectedFiles(pluginStage, parsed.files!);
    const skillStages = new Map<string, string>();
    try {
      for (const skill of prepared.skills) {
        const stage = join(
          services.options.skillsRoot,
          `.install-${randomUUID()}`,
        );
        await copyCollectedFiles(stage, skill.files);
        await writeFile(
          join(stage, SKILL_METADATA_FILE),
          `${JSON.stringify(
            {
              version: 1,
              id: `artemis-plugin/${parsed.id}/${skill.name}`,
              source: `artemis-plugin:${parsed.name}`,
              installedAt: new Date().toISOString(),
            },
            undefined,
            2,
          )}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        skillStages.set(skill.name, stage);
      }
    } catch (error) {
      await rm(pluginStage, { recursive: true, force: true });
      await Promise.all(
        [...skillStages.values()].map((stage) =>
          rm(stage, { recursive: true, force: true }),
        ),
      );
      throw error;
    }
    onProgress?.(75);

    const skillNames = new Set([
      ...(existing?.skills.map((skill) => skill.name) ?? []),
      ...prepared.skills.map((skill) => skill.name),
    ]);
    const moves: DirectoryMove[] = [
      {
        destination: prepared.pluginDirectory,
        backup: `${prepared.pluginDirectory}.backup-${randomUUID()}`,
        stage: pluginStage,
      },
      ...[...skillNames].map((name) => {
        const stage = skillStages.get(name);
        return {
          destination: join(services.options.skillsRoot, name),
          backup: join(
            services.options.skillsRoot,
            `.backup-${safeSlug(name)}-${randomUUID()}`,
          ),
          ...(stage ? { stage } : {}),
        };
      }),
    ];
    const now = new Date().toISOString();
    const stored: StoredPlugin = {
      id: parsed.id,
      capabilityDependencies: structuredClone(
        parsed.capabilityDependencies ?? [],
      ),
      name: parsed.name,
      displayName: parsed.displayName,
      version: parsed.version,
      description: parsed.description,
      ...(parsed.localizations
        ? { localizations: structuredClone(parsed.localizations) }
        : {}),
      ...(parsed.shortDescription
        ? { shortDescription: parsed.shortDescription }
        : {}),
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.brandColor ? { brandColor: parsed.brandColor } : {}),
      ...(parsed.iconDataUrl ? { iconDataUrl: parsed.iconDataUrl } : {}),
      source: structuredClone(parsed.source),
      contentHash: parsed.contentHash!,
      skins: structuredClone(parsed.skins),
      skinsEnabled: newServicesEnabledInput ?? existing?.skinsEnabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      skills: prepared.skills.map((skill) => ({
        name: skill.name,
        hash: skill.hash,
      })),
      mcpServers: mergedMcp.map((config) => ({
        id: config.id,
        structuralHash: mcpStructuralHash(config),
      })),
      skillPreviews: prepared.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      mcpPreviews: parsed.mcpServers.map(previewMcp),
      appPreviews: structuredClone(parsed.apps),
      hasHooks: parsed.hasHooks ?? false,
      unsupported: [...parsed.unsupported],
      warnings: [...parsed.warnings],
      // S2: publish an immutable revision for design-plugin packages so
      // thread bindings and the dispatcher have a verifiable target.
      ...(parsed.designPluginManifest
        ? { designPlugin: await services.publishDesignPluginRevision(parsed) }
        : {}),
    };
    const nextStore: PluginStore = {
      version: 1,
      plugins: [
        ...store.plugins.filter((plugin) => plugin.id !== parsed.id),
        stored,
      ],
    };
    await services.commitMoves(moves, currentMcp, nextMcp, nextStore);
    onProgress?.(100);
    return {
      plugin: services.installedPlugin(stored),
      warnings: [...stored.warnings],
    };
  }

  async function publishDesignPluginRevision(
    parsed: ParsedPlugin,
  ): Promise<NonNullable<StoredPlugin["designPlugin"]>> {
    const manifest = parsed.designPluginManifest!;
    const revisionsRoot =
      services.options.designRevisionsRoot ??
      join(services.options.pluginsRoot, "plugin-revisions");
    const revisionStore = new PluginRevisionStore(revisionsRoot);
    // The revision content is the plugin directory the install parsed
    // (artemis.plugin.json + panel + runtime + schema).
    const sourceRoot = parsed.root;
    const contentHash =
      await PluginRevisionStore.computeContentHash(sourceRoot);
    const published = await revisionStore.publish({
      installationId: manifest.id,
      contentHash,
      sourceRoot,
    });
    return {
      installationId: manifest.id,
      contentHash: published.contentHash,
      revisionRoot: published.revisionRoot,
      version: manifest.version,
    };
  }

  async function commitMoves(
    moves: DirectoryMove[],
    previousMcp: McpServerConfig[],
    nextMcp: McpServerConfig[],
    nextStore: PluginStore,
  ): Promise<void> {
    for (const move of moves) {
      if (dirname(move.destination) === services.options.pluginsRoot)
        await services.options.beforeSnapshotChange?.(
          basename(move.destination),
        );
    }
    const previousStore = structuredClone(await services.loadStore());
    try {
      await services
        .installTransaction()
        .commit(moves, previousStore, nextStore, previousMcp, nextMcp);
    } finally {
      await services.options.afterSnapshotChange?.();
    }
  }

  function installTransaction() {
    return new PluginInstallTransaction<PluginStore, McpServerConfig[]>({
      journalPath: `${services.options.statePath}.transaction.json`,
      statePath: services.options.statePath,
      roots: [services.options.pluginsRoot, services.options.skillsRoot],
      saveStore: (value) => services.saveStore(value),
      saveMcp: async (value) => {
        await services.options.mcpStore.replaceAll(value);
      },
    });
  }
  const handlers = {
    preparePlugin,
    commitInstall,
    publishDesignPluginRevision,
    commitMoves,
    installTransaction,
  };
  return handlers;
}
