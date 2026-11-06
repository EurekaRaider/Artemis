import { parseDesignPluginManifest } from "./plugin-validation.js";

import {
  rejectedLegacyConnectors,
  unavailableConnectorNames,
  blockingUnavailableConnectorNames,
  parseMcpServer,
  mcpServerMap,
  previewMcp,
} from "./plugin-mcp.js";

import {
  exists,
  readJson,
  readPluginText,
  readPluginIcon,
  canonicalDirectory,
  declaredPath,
  collectFiles,
  collectedHash,
  discoverSkillRoots,
  manifestPaths,
} from "./plugin-files.js";
import { record, text, portableRelative, pluginId } from "./plugin-values.js";
import {
  MAX_MANIFEST_BYTES,
  MAX_PLUGIN_FILES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_PLUGIN_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_BYTES,
} from "./plugin-constants.js";
import type {
  ParsedSkill,
  ParsedMcpServer,
  StoredSkin,
  ParsedPlugin,
} from "./plugin-types.js";

import { normalizeResourceManifest } from "@artemis/plugin-contract";
import { loadSkinPackage } from "../appearance/skin-package.js";
import { isSkinRelativePath } from "@artemis/theme-contract";
import { capabilityDependencySchema } from "@artemis/protocol";

import { parsePluginLocalizations } from "../../shared/i18n/plugin-localization.js";

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  ArtemisPluginPreview,
  ArtemisPluginSource,
} from "../../shared/api.js";

import { parseSkillFrontmatter } from "./resource-catalog.js";

import { assertNativeManifestVersion } from "../../shared/plugin-manifest.js";
import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginManifestReader(
  services: Pick<PluginServiceDependencies, "state">,
) {
  async function parsePlugin(
    root: string,
    source: ArtemisPluginSource,
    prepare: boolean,
  ): Promise<ParsedPlugin> {
    const manifestPath = join(root, "artemis.plugin.json");
    if (!(await exists(manifestPath)))
      throw new Error(
        "Artemis plugins require artemis.plugin.json with schemaVersion: 1. Convert this plugin before installing.",
      );
    const input = await readJson(manifestPath, MAX_MANIFEST_BYTES);
    assertNativeManifestVersion(input, "plugin");
    const manifest = normalizeResourceManifest(input);
    if (!manifest) {
      throw new Error("Plugin manifest must be a JSON object.");
    }
    const name = text(manifest.name);
    if (!name || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(name)) {
      throw new Error("Plugin manifest name is invalid.");
    }
    const capabilityDependencies = capabilityDependencySchema
      .array()
      .max(10)
      .parse(manifest.capabilityDependencies ?? []);
    const localizations = parsePluginLocalizations(manifest.localizations);
    const interfaceValue = record(manifest?.interface);
    const displayName =
      text(interfaceValue?.displayName) ??
      text(interfaceValue?.display_name) ??
      name;
    const version = text(manifest.version);
    if (!version)
      throw new Error("Artemis plugin manifest version is required.");
    const description = text(manifest?.description) ?? "";
    const shortDescription =
      text(interfaceValue?.shortDescription) ??
      text(interfaceValue?.short_description);
    const category = text(interfaceValue?.category);
    const brandColorInput = text(interfaceValue?.brandColor);
    const brandColor =
      brandColorInput && /^#[a-f0-9]{6}$/iu.test(brandColorInput)
        ? brandColorInput
        : undefined;
    if (
      displayName.length > 120 ||
      version.length > 64 ||
      description.length > 2_000 ||
      (shortDescription !== undefined && shortDescription.length > 300) ||
      (category !== undefined && category.length > 80)
    ) {
      throw new Error("Plugin manifest metadata is too large.");
    }
    const warnings: string[] = [];
    let hasHooks = false;
    const unsupported: string[] = [];
    const apps = await rejectedLegacyConnectors(root, manifest);
    const iconDataUrl = await readPluginIcon(
      root,
      interfaceValue?.logo ?? interfaceValue?.composerIcon,
    );
    if (
      manifest?.schemaVersion === 2
        ? Array.isArray(manifest.hooks) && manifest.hooks.length > 0
        : manifest?.hooks !== undefined ||
          (await exists(join(root, "hooks", "hooks.json"))) ||
          (await exists(join(root, "hooks.json")))
    ) {
      hasHooks = true;
      warnings.push(
        "Command hooks require separate review and trust in Settings → Hooks.",
      );
    }
    for (const [field, label] of [
      ["commands", "Commands"],
      ["agents", "Agents"],
      ["browserExtensions", "Browser extensions"],
      ["scheduledTasks", "Scheduled task templates"],
    ] as const) {
      if (manifest?.[field] !== undefined) unsupported.push(label);
    }

    if (
      manifest.skins !== undefined &&
      (!Array.isArray(manifest.skins) ||
        manifest.skins.length > 32 ||
        manifest.skins.some((entry) => typeof entry !== "string"))
    )
      throw new Error(
        "Plugin skins must be an array of at most 32 package directories.",
      );
    const skins: StoredSkin[] = [];
    for (const declaration of (manifest.skins ?? []) as string[]) {
      const directory = await canonicalDirectory(
        declaredPath(root, declaration, "Skin"),
        root,
      );
      const path = portableRelative(relative(root, directory));
      if (!isSkinRelativePath(path))
        throw new Error("Invalid skin package directory.");
      const { data } = await loadSkinPackage(directory);
      const { id, name, version, schemaVersion } = data.manifest;
      if (
        id === "com.artemis.default" ||
        skins.some((skin) => skin.id === id || skin.path === path)
      )
        throw new Error(`Duplicate or reserved skin ID: ${id}`);
      skins.push({ id, name, version, schemaVersion, path });
    }

    const skillDeclarations = manifestPaths(manifest?.skills);
    if (
      manifest.schemaVersion === 1 &&
      !skillDeclarations.length &&
      (await exists(join(root, "skills")))
    ) {
      skillDeclarations.push("./skills/");
    }
    const skills: ParsedSkill[] = [];
    const skillNames = new Set<string>();
    for (const declaration of skillDeclarations) {
      const path = declaredPath(root, declaration, "Skill");
      const directory = await canonicalDirectory(path, root);
      for (const skillRoot of manifest.schemaVersion === 2
        ? [directory]
        : await discoverSkillRoots(directory)) {
        const frontmatter = parseSkillFrontmatter(
          await readPluginText(
            join(skillRoot, "SKILL.md"),
            MAX_SKILL_FILE_BYTES,
          ),
        );
        if (skillNames.has(frontmatter.name)) {
          throw new Error(
            `Plugin contains duplicate Skill: ${frontmatter.name}`,
          );
        }
        skillNames.add(frontmatter.name);
        if (prepare) {
          const files = await collectFiles(skillRoot, {
            maximumFiles: MAX_SKILL_FILES,
            maximumFileBytes: MAX_SKILL_FILE_BYTES,
            maximumBytes: MAX_SKILL_BYTES,
            rejectInstallerMetadata: true,
          });
          skills.push({
            ...frontmatter,
            root: skillRoot,
            files,
            hash: collectedHash(files),
          });
        } else {
          skills.push({ ...frontmatter, root: skillRoot });
        }
      }
    }

    const mcpInputs: unknown[] = [];
    if (
      typeof manifest.mcpServers === "string" ||
      Array.isArray(manifest.mcpServers)
    ) {
      for (const declaration of manifestPaths(manifest.mcpServers)) {
        const path = declaredPath(root, declaration, "MCP");
        mcpInputs.push(await readJson(path, MAX_MANIFEST_BYTES));
      }
    } else if (record(manifest?.mcpServers)) {
      mcpInputs.push(manifest.mcpServers);
    }
    const mcpServers: ParsedMcpServer[] = [];
    const mcpNames = new Set<string>();
    for (const input of mcpInputs) {
      for (const [serverName, definition] of Object.entries(
        mcpServerMap(input),
      )) {
        if (mcpNames.has(serverName)) {
          throw new Error(
            `Plugin contains duplicate MCP server: ${serverName}`,
          );
        }
        mcpNames.add(serverName);
        mcpServers.push(parseMcpServer(serverName, definition, warnings));
      }
    }
    if (
      mcpServers.some((server) =>
        [
          "Update plugin and reconnect",
          "Unsupported connector declaration",
        ].includes(server.endpoint),
      )
    )
      apps.push({ name: "Update plugin and reconnect", required: true });
    if (unavailableConnectorNames(apps, mcpServers).length) {
      unsupported.push("Unavailable Connectors");
    }
    const files = prepare
      ? await collectFiles(root, {
          maximumFiles: MAX_PLUGIN_FILES,
          maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
          maximumBytes: MAX_PLUGIN_BYTES,
        })
      : undefined;
    // S1: parallel design-plugin contract. A package may carry both a
    // .codex-plugin/plugin.json (market metadata) and an artemis.plugin.json
    // (design-plugin contract); the latter is strictly validated here so a
    // broken manifest never reaches the revision store or thread bindings.
    // Native plugins/skins (v1.6.18+) use the same filename with a different
    // contract — they lack the artemisPluginApi engine marker and are left
    // to the native machinery, never fed to the design schema.
    const designManifestPath = join(root, "artemis.plugin.json");
    const designPluginManifest = (await exists(designManifestPath))
      ? parseDesignPluginManifest(
          JSON.parse((await readFile(designManifestPath)).toString("utf8")),
        )
      : undefined;
    return {
      root,
      capabilityDependencies,
      ...(designPluginManifest ? { designPluginManifest } : {}),
      id: pluginId(name, source),
      name,
      displayName,
      version,
      description,
      ...(shortDescription ? { shortDescription } : {}),
      ...(localizations ? { localizations } : {}),
      ...(category ? { category } : {}),
      ...(brandColor ? { brandColor } : {}),
      ...(iconDataUrl ? { iconDataUrl } : {}),
      source,
      hasHooks,
      skills,
      skins,
      mcpServers,
      apps,
      unsupported,
      warnings,
      ...(files ? { files, contentHash: collectedHash(files) } : {}),
    };
  }

  function preview(parsed: ParsedPlugin): ArtemisPluginPreview {
    const installed = Boolean(
      services.state?.plugins.some((plugin) => plugin.id === parsed.id),
    );
    return {
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
      installed,
      installable:
        blockingUnavailableConnectorNames(
          parsed.source,
          parsed.apps,
          parsed.mcpServers,
        ).length === 0 &&
        (parsed.hasHooks ||
          parsed.skins.length > 0 ||
          parsed.skills.length > 0 ||
          parsed.mcpServers.some((server) => server.importable) ||
          parsed.apps.some((connector) => connector.url)),
      skins: parsed.skins.map(({ path: _path, ...summary }) => summary),
      skills: parsed.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      mcpServers: parsed.mcpServers.map(previewMcp),
      apps: structuredClone(parsed.apps),
      hasHooks: parsed.hasHooks ?? false,
      unsupported: [...parsed.unsupported],
      warnings: [...parsed.warnings],
    };
  }

  function assertSupportedAppConnectors(parsed: ParsedPlugin): void {
    const requiredApps = blockingUnavailableConnectorNames(
      parsed.source,
      parsed.apps,
      parsed.mcpServers,
    );
    if (!requiredApps.length) return;
    throw new Error(
      `Plugin requires a Connector endpoint that is unavailable: ${requiredApps.join(", ")}.`,
    );
  }
  const handlers = { parsePlugin, preview, assertSupportedAppConnectors };
  return handlers;
}
