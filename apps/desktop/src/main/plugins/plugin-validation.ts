import { isSkinRelativePath } from "@artemis/theme-contract";
import { capabilityDependencySchema } from "@artemis/protocol";
import { parsePluginLocalizations } from "../../shared/i18n/plugin-localization.js";
import { isAbsolute } from "node:path";
import { pluginManifestSchema, type PluginManifest } from "@artemis/protocol";
import type {
  ArtemisPluginPreview,
  ArtemisPluginSource,
} from "../../shared/api.js";
import {
  BUNDLED_ARTIFACT_PLUGIN_NAMES,
  MAX_ICON_BYTES,
} from "./plugin-constants.js";
import {
  normalizeMarketplaceUrl,
  normalizeGithubMarketplaceUrl,
  marketplaceSourceId,
} from "./marketplace-download.js";
import { record, text, strings } from "./plugin-values.js";
import {
  type StoredMarketplaceSource,
  type StoredSkill,
  type StoredMcpServer,
  type StoredSkin,
  type StoredPlugin,
} from "./plugin-types.js";
/**
 * A package carries a design-plugin manifest only when it declares the
 * artemisPluginApi engine. Native plugins and skins share the
 * artemis.plugin.json filename with a different contract — they are not
 * design plugins and must never hit the strict design schema.
 */
export function parseDesignPluginManifest(
  value: unknown,
): PluginManifest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const engines = (value as { engines?: { artemisPluginApi?: unknown } })
    .engines;
  if (
    !engines ||
    typeof engines !== "object" ||
    engines.artemisPluginApi !== "1"
  )
    return undefined;
  return pluginManifestSchema.parse(value);
}

export function validateSource(
  source: ArtemisPluginSource,
): ArtemisPluginSource {
  if (source.kind === "builtin") {
    if (source.pluginName !== "computer-use")
      throw new Error("Unknown built-in plugin.");
    return { kind: "builtin", pluginName: "computer-use" };
  }
  if (source.kind === "local") {
    if (!isAbsolute(source.path) || !source.path.trim()) {
      throw new Error("Local plugin source path is invalid.");
    }
    return { kind: "local", path: source.path };
  }
  if (source.kind === "bundled" || source.kind === "runtime") {
    if (!BUNDLED_ARTIFACT_PLUGIN_NAMES.has(source.pluginName)) {
      throw new Error("Bundled artifact plugin source is invalid.");
    }
    return { kind: source.kind, pluginName: source.pluginName };
  }
  if (
    !source.marketplaceName.trim() ||
    !source.pluginName.trim() ||
    source.marketplaceName.length > 120 ||
    source.pluginName.length > 120
  ) {
    throw new Error("Git plugin source is invalid.");
  }
  return {
    kind: "git",
    marketplaceUrl: normalizeMarketplaceUrl(source.marketplaceUrl),
    marketplaceName: source.marketplaceName.trim(),
    pluginName: source.pluginName.trim(),
  };
}

export function validateStoredMarketplaceSource(
  value: unknown,
): StoredMarketplaceSource {
  const input = record(value);
  const id = text(input?.id);
  const marketplaceName = text(input?.marketplaceName);
  const displayName = text(input?.displayName);
  const addedAt = text(input?.addedAt);
  const cachePath = text(input?.cachePath);
  const signingKeyFingerprint = text(input?.signingKeyFingerprint);
  const modeInput = text(input?.mode);
  const mode: "git" | "offline" =
    modeInput === undefined || modeInput === "git" ? "git" : "offline";
  const url = normalizeGithubMarketplaceUrl(text(input?.url) ?? "");
  if (
    (modeInput !== undefined &&
      modeInput !== "git" &&
      modeInput !== "offline") ||
    !id ||
    id !== marketplaceSourceId(url) ||
    !marketplaceName ||
    !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(marketplaceName) ||
    !displayName ||
    displayName.length > 120 ||
    !addedAt
  ) {
    throw new Error("Plugin marketplace source is invalid.");
  }
  if (signingKeyFingerprint && !/^[a-f0-9]{64}$/u.test(signingKeyFingerprint)) {
    throw new Error("Plugin marketplace signing key fingerprint is invalid.");
  }
  return {
    id,
    url,
    marketplaceName,
    displayName,
    addedAt,
    mode,
    ...(cachePath ? { cachePath } : {}),
    ...(signingKeyFingerprint ? { signingKeyFingerprint } : {}),
  };
}

export function validateStoredPlugin(value: unknown): StoredPlugin {
  const input = record(value);
  if (!input) throw new Error("Installed plugin record is invalid.");
  const id = text(input.id);
  const name = text(input.name);
  const displayName = text(input.displayName);
  const version = text(input.version);
  const description =
    typeof input.description === "string" ? input.description : "";
  const localizations = parsePluginLocalizations(input.localizations);
  const shortDescription = text(input.shortDescription);
  const category = text(input.category);
  const brandColor = text(input.brandColor);
  const iconDataUrl = text(input.iconDataUrl);
  const contentHash = text(input.contentHash);
  const installedAt = text(input.installedAt);
  const updatedAt = text(input.updatedAt);
  if (
    !id ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id) ||
    !name ||
    !displayName ||
    !version ||
    !contentHash ||
    !/^[a-f0-9]{64}$/u.test(contentHash) ||
    !installedAt ||
    !updatedAt ||
    (shortDescription !== undefined && shortDescription.length > 300) ||
    (category !== undefined && category.length > 80) ||
    (brandColor !== undefined && !/^#[a-f0-9]{6}$/iu.test(brandColor)) ||
    (iconDataUrl !== undefined &&
      (!/^data:image\/png;base64,[a-z0-9+/]+=*$/iu.test(iconDataUrl) ||
        iconDataUrl.length > Math.ceil((MAX_ICON_BYTES * 4) / 3) + 64))
  ) {
    throw new Error("Installed plugin record is invalid.");
  }
  const source = validateSource(input.source as ArtemisPluginSource);
  const skills = Array.isArray(input.skills)
    ? input.skills.map((entry): StoredSkill => {
        const skill = record(entry);
        const skillName = text(skill?.name);
        const hash = text(skill?.hash);
        if (!skillName || !hash || !/^[a-f0-9]{64}$/u.test(hash)) {
          throw new Error("Installed plugin Skill record is invalid.");
        }
        return { name: skillName, hash };
      })
    : [];
  const mcpServers = Array.isArray(input.mcpServers)
    ? input.mcpServers.map((entry): StoredMcpServer => {
        const server = record(entry);
        const serverId = text(server?.id);
        const structuralHash = text(server?.structuralHash);
        if (
          !serverId ||
          !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(serverId) ||
          !structuralHash ||
          !/^[a-f0-9]{64}$/u.test(structuralHash)
        ) {
          throw new Error("Installed plugin MCP record is invalid.");
        }
        return { id: serverId, structuralHash };
      })
    : [];
  const skins: StoredSkin[] = Array.isArray(input.skins)
    ? input.skins.map((entry) => {
        const skin = record(entry);
        if (
          !skin ||
          !isSkinRelativePath(skin.path) ||
          typeof skin.id !== "string" ||
          typeof skin.name !== "string" ||
          typeof skin.version !== "string" ||
          ![1, 2].includes(Number(skin.schemaVersion))
        )
          throw new Error("Installed skin record is invalid.");
        return {
          id: skin.id,
          name: skin.name,
          version: skin.version,
          schemaVersion: skin.schemaVersion as 1 | 2,
          path: skin.path,
        };
      })
    : [];
  const appPreviews: ArtemisPluginPreview["apps"] = [];

  return {
    id,
    capabilityDependencies: capabilityDependencySchema
      .array()
      .max(10)
      .parse(input.capabilityDependencies ?? []),
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
    contentHash,
    installedAt,
    updatedAt,
    skills,
    mcpServers,
    skillPreviews: Array.isArray(input.skillPreviews)
      ? (input.skillPreviews as ArtemisPluginPreview["skills"])
      : [],
    mcpPreviews: Array.isArray(input.mcpPreviews)
      ? (input.mcpPreviews as ArtemisPluginPreview["mcpServers"])
      : [],
    appPreviews,
    skins,
    skinsEnabled: input.skinsEnabled !== false,
    hasHooks:
      input.hasHooks === true || strings(input.unsupported).includes("Hooks"),
    unsupported: strings(input.unsupported),
    warnings: strings(input.warnings),
    ...(input.formatMigrationRequired === true
      ? {
          formatMigrationRequired: true,
          formatMigrationEnabledMcpIds: strings(
            input.formatMigrationEnabledMcpIds,
          ),
        }
      : {}),
  };
}
