import { validateStoredMarketplaceSource } from "./plugin-validation.js";
import {
  normalizeMarketplaceUrl,
  githubMarketplaceRepository,
  normalizeGithubMarketplaceUrl,
  marketplaceSourceId,
  marketplaceDownloadFailure,
} from "./marketplace-download.js";

import {
  verifyMarketplaceIntegrity,
  validateOfflineMarketplacePackage,
} from "./marketplace-integrity.js";
import {
  exists,
  readJson,
  canonicalDirectory,
  declaredPath,
} from "./plugin-files.js";
import { record, text, strings } from "./plugin-values.js";
import {
  MAX_MARKETPLACE_BYTES,
  MAX_MARKETPLACE_PLUGINS,
  MAX_USER_MARKETPLACES,
  BUNDLED_ARTIFACT_MARKETPLACE_NAME,
  BUNDLED_MARKETPLACE_ID,
  BUNDLED_MARKETPLACE_URL,
  LOCAL_MARKETPLACE_ID,
  OPENAI_MARKETPLACE_URL,
} from "./plugin-constants.js";
import type {
  ProgressReporter,
  StoredMarketplaceSource,
  OfflineMarketplaceCandidate,
  MarketplaceStore,
} from "./plugin-types.js";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceState,
  ArtemisPluginPreview,
  ArtemisPluginSource,
} from "../../shared/api.js";

import { assertNativeManifestVersion } from "../../shared/plugin-manifest.js";
import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createMarketplaceRepository(
  services: Pick<
    PluginServiceDependencies,
    | "options"
    | "marketplaceCache"
    | "readMarketplace"
    | "refreshMarketplace"
    | "loadMarketplaceStore"
    | "marketplaceSources"
    | "marketplaceRefreshErrors"
    | "isStrictGithubMarketplace"
    | "marketplaceState"
    | "loadStore"
    | "legacyMarketplaceCache"
    | "saveMarketplaceStore"
    | "marketplaceFile"
    | "cloneRepository"
    | "preview"
    | "parsePlugin"
  >,
) {
  async function loadGitMarketplaceCore(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace> {
    const url = normalizeMarketplaceUrl(inputUrl);
    await mkdir(services.options.marketplacesRoot, { recursive: true });
    const cache = services.marketplaceCache(url);
    if (!refresh && (await exists(cache))) {
      onProgress?.(100);
      return services.readMarketplace(cache, url, {
        ...(expectedSigningKeyFingerprint
          ? { expectedSigningKeyFingerprint }
          : {}),
      });
    }
    const marketplace = await services.refreshMarketplace(
      url,
      onProgress,
      expectedMarketplaceName,
      strict,
      expectedSigningKeyFingerprint,
    );
    onProgress?.(100);
    return marketplace;
  }

  async function marketplaceSnapshot(
    sourceId?: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    const store = await services.loadMarketplaceStore();
    const sources = services.marketplaceSources(store);
    if (
      sourceId &&
      sourceId !== LOCAL_MARKETPLACE_ID &&
      !sources.some((source) => source.id === sourceId)
    ) {
      throw new Error("Plugin marketplace was not found.");
    }
    const sourcesToLoad = sourceId
      ? sources.filter((source) => source.id === sourceId)
      : sources;
    const marketplaces: ArtemisPluginMarketplaceState["marketplaces"] = [];
    const errors: ArtemisPluginMarketplaceState["errors"] = [];
    for (const source of sourcesToLoad) {
      if (source.builtIn) continue;
      let errorMessage = services.marketplaceRefreshErrors.get(source.id);
      const cache = services.marketplaceCache(source.url);
      if (!(await exists(cache))) {
        errors.push({
          sourceId: source.id,
          message:
            errorMessage ??
            "Marketplace cache unavailable. Refresh it manually to load plugins.",
        });
        continue;
      }
      try {
        const marketplace = await services.readMarketplace(cache, source.url, {
          strict:
            source.offline || services.isStrictGithubMarketplace(source.url),
          ...(source.signingKeyFingerprint
            ? {
                expectedSigningKeyFingerprint: source.signingKeyFingerprint,
              }
            : {}),
        });
        if (
          !source.builtIn &&
          marketplace.marketplaceName !== source.marketplaceName
        ) {
          throw new Error(
            "Plugin marketplace identity changed. Remove and add it again.",
          );
        }
        marketplaces.push({ sourceId: source.id, marketplace });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errorMessage = `Marketplace cache unavailable. Refresh it manually. ${detail}`;
      }
      if (errorMessage) {
        errors.push({ sourceId: source.id, message: errorMessage });
      }
    }
    return {
      selectedView: store.selectedView,
      sources,
      marketplaces,
      errors,
    };
  }

  function marketplaceSources(
    store: MarketplaceStore,
  ): ArtemisPluginMarketplaceSource[] {
    return [
      {
        id: BUNDLED_MARKETPLACE_ID,
        url: BUNDLED_MARKETPLACE_URL,
        marketplaceName: BUNDLED_ARTIFACT_MARKETPLACE_NAME,
        displayName: "Bundled plugins",
        repository: "Artemis",
        builtIn: true,
        removable: false,
        offline: false,
        refreshable: false,
        order: 0,
      },
      ...store.sources.map((source, index) => ({
        ...source,
        repository: githubMarketplaceRepository(source.url),
        builtIn: false,
        removable: true,
        offline: source.mode === "offline",
        refreshable: source.mode !== "offline",
        order: index + 1,
      })),
    ];
  }

  async function loadMarketplaceStore(): Promise<MarketplaceStore> {
    if (services.marketplaceState) return services.marketplaceState;
    try {
      const input = record(
        await readJson(services.options.marketplaceStatePath, 1024 * 1024),
      );
      if (
        input?.version !== 1 ||
        !Array.isArray(input.sources) ||
        input.sources.length > MAX_USER_MARKETPLACES
      ) {
        throw new Error("Plugin marketplace store is invalid.");
      }
      const sources = input.sources.map(validateStoredMarketplaceSource);
      if (new Set(sources.map((source) => source.id)).size !== sources.length) {
        throw new Error("Plugin marketplace store contains duplicates.");
      }
      const selectedInput = text(input.selectedView);
      const selectedView =
        selectedInput === BUNDLED_MARKETPLACE_ID ||
        selectedInput === LOCAL_MARKETPLACE_ID ||
        sources.some((source) => source.id === selectedInput)
          ? selectedInput!
          : BUNDLED_MARKETPLACE_ID;
      services.marketplaceState = { version: 1, selectedView, sources };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const sources: StoredMarketplaceSource[] = [];
      const seen = new Set<string>();
      for (const plugin of (await services.loadStore()).plugins) {
        if (
          plugin.source.kind !== "git" ||
          sources.length >= MAX_USER_MARKETPLACES
        ) {
          continue;
        }
        try {
          const legacyUrl = normalizeMarketplaceUrl(
            plugin.source.marketplaceUrl,
          );
          const url = normalizeGithubMarketplaceUrl(
            plugin.source.marketplaceUrl,
          );
          if (url === OPENAI_MARKETPLACE_URL || seen.has(url)) continue;
          seen.add(url);
          let displayName = plugin.source.marketplaceName;
          const cache = services.marketplaceCache(url);
          const legacyCache = services.legacyMarketplaceCache(legacyUrl);
          if (
            legacyCache !== cache &&
            (await exists(legacyCache)) &&
            !(await exists(cache))
          ) {
            await rename(legacyCache, cache);
          }
          if (await exists(cache)) {
            try {
              const cached = await services.readMarketplace(cache, url);
              if (cached.marketplaceName === plugin.source.marketplaceName) {
                displayName = cached.name;
              }
            } catch {
              // Keep the persisted marketplace identity when its cache is stale.
            }
          }
          sources.push({
            id: marketplaceSourceId(url),
            url,
            marketplaceName: plugin.source.marketplaceName,
            displayName,
            addedAt: plugin.installedAt,
            mode: "git",
            cachePath: cache,
          });
        } catch {
          // Legacy non-GitHub sources remain installed but are not subscribed.
        }
      }
      services.marketplaceState = {
        version: 1,
        selectedView: BUNDLED_MARKETPLACE_ID,
        sources,
      };
      await services.saveMarketplaceStore(services.marketplaceState);
    }
    return services.marketplaceState;
  }

  async function saveMarketplaceStore(value: MarketplaceStore): Promise<void> {
    await mkdir(dirname(services.options.marketplaceStatePath), {
      recursive: true,
    });
    const temporaryPath = `${services.options.marketplaceStatePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, services.options.marketplaceStatePath);
    services.marketplaceState = value;
  }

  function marketplaceCache(url: string): string {
    let identity = url;
    try {
      identity = normalizeGithubMarketplaceUrl(url);
    } catch {
      // Existing non-GitHub installation records retain their legacy cache key.
    }
    return services.legacyMarketplaceCache(identity);
  }

  function legacyMarketplaceCache(url: string): string {
    const digest = createHash("sha256").update(url).digest("hex").slice(0, 20);
    return join(services.options.marketplacesRoot, digest);
  }

  function isStrictGithubMarketplace(url: string): boolean {
    try {
      return normalizeGithubMarketplaceUrl(url) !== OPENAI_MARKETPLACE_URL;
    } catch {
      return false;
    }
  }

  async function bundledArtifactMarketplaceLocation(): Promise<
    string | undefined
  > {
    const configuredRoot = services.options.bundledArtifactRoot;
    if (!configuredRoot || !(await exists(configuredRoot))) return undefined;
    const marketplaceRoot = await canonicalDirectory(configuredRoot);
    const marketplace = record(
      await readJson(
        await services.marketplaceFile(marketplaceRoot),
        MAX_MARKETPLACE_BYTES,
      ),
    );
    if (text(marketplace?.name) !== BUNDLED_ARTIFACT_MARKETPLACE_NAME) {
      return undefined;
    }
    return marketplaceRoot;
  }

  async function refreshMarketplace(
    url: string,
    onProgress?: ProgressReporter,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace> {
    const normalized = normalizeMarketplaceUrl(url);
    await mkdir(services.options.marketplacesRoot, { recursive: true });
    const cache = services.marketplaceCache(normalized);
    const stage = join(
      services.options.marketplacesRoot,
      `.clone-${randomUUID()}`,
    );
    const backup = `${cache}.backup-${randomUUID()}`;
    let movedOld = false;
    onProgress?.(5);
    try {
      await services.cloneRepository(normalized, stage);
      onProgress?.(45);
      const candidate = await services.readMarketplace(stage, normalized, {
        strict,
        validatePluginFiles: strict,
        ...(expectedSigningKeyFingerprint
          ? { expectedSigningKeyFingerprint }
          : {}),
      });
      if (
        expectedMarketplaceName &&
        candidate.marketplaceName !== expectedMarketplaceName
      ) {
        throw new Error(
          "Plugin marketplace identity changed. Remove and add it again.",
        );
      }
      if (await exists(cache)) {
        await rename(cache, backup);
        movedOld = true;
      }
      await rename(stage, cache);
      if (movedOld) {
        await rm(backup, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      return candidate;
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      if (movedOld && !(await exists(cache)) && (await exists(backup))) {
        await rename(backup, cache);
      }
      throw marketplaceDownloadFailure(error);
    }
  }

  async function marketplaceFile(root: string): Promise<string> {
    const path = join(root, ".artemis", "marketplace.json");
    if (await exists(path)) return path;
    throw new Error(
      "Git repository does not contain .artemis/marketplace.json.",
    );
  }

  async function readOfflineMarketplaceCandidate(
    root: string,
  ): Promise<OfflineMarketplaceCandidate> {
    const filePath = await services.marketplaceFile(root);
    const integrity = await verifyMarketplaceIntegrity(root, filePath);
    if (!integrity?.sourceUrl) {
      throw new Error(
        "Offline marketplace package must be signed and declare its GitHub source URL.",
      );
    }
    await validateOfflineMarketplacePackage(root, integrity);
    const marketplace = await services.readMarketplace(
      root,
      integrity.sourceUrl,
      {
        strict: true,
        validatePluginFiles: true,
        expectedSigningKeyFingerprint: integrity.signingKeyFingerprint,
      },
    );
    return {
      marketplace,
      integrity: { ...integrity, sourceUrl: integrity.sourceUrl },
    };
  }

  async function readMarketplace(
    root: string,
    url: string,
    options?: {
      allowedPlugins?: ReadonlySet<string>;
      displayName?: string;
      bundledSources?: boolean;
      strict?: boolean;
      validatePluginFiles?: boolean;
      expectedSigningKeyFingerprint?: string;
    },
  ): Promise<ArtemisPluginMarketplace> {
    await services.loadStore();
    const filePath = await services.marketplaceFile(root);
    const integrity = await verifyMarketplaceIntegrity(root, filePath);
    if (
      options?.expectedSigningKeyFingerprint &&
      integrity?.signingKeyFingerprint !== options.expectedSigningKeyFingerprint
    ) {
      throw new Error(
        "Marketplace signing key changed or the signature was removed. Remove the source and explicitly trust it again.",
      );
    }
    const input = record(await readJson(filePath, MAX_MARKETPLACE_BYTES));
    assertNativeManifestVersion(input, "marketplace");
    const marketplaceName = text(input?.name);
    if (
      !marketplaceName ||
      marketplaceName.length > 120 ||
      !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(marketplaceName)
    ) {
      throw new Error("Git marketplace name is missing or invalid.");
    }
    const displayName =
      text(record(input?.interface)?.displayName) ?? marketplaceName;
    if (displayName.length > 120) {
      throw new Error("Git marketplace display name is too large.");
    }
    const entries = input?.plugins;
    if (!Array.isArray(entries) || entries.length > MAX_MARKETPLACE_PLUGINS) {
      throw new Error("Git marketplace plugin list is invalid or too large.");
    }
    const warnings: string[] = [];
    const plugins: ArtemisPluginPreview[] = [];
    const entryNames = new Set<string>();
    for (const entryValue of entries) {
      const entry = record(entryValue);
      const entryName = text(entry?.name);
      if (
        !entryName ||
        entryName.length > 120 ||
        !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(entryName)
      ) {
        if (options?.strict) {
          throw new Error("Marketplace contains an invalid plugin name.");
        }
        warnings.push("A marketplace entry with an invalid name was skipped.");
        continue;
      }
      if (entryNames.has(entryName)) {
        if (options?.strict) {
          throw new Error(
            `Marketplace contains duplicate plugin: ${entryName}`,
          );
        }
        warnings.push(`${entryName} is duplicated and was skipped.`);
        continue;
      }
      entryNames.add(entryName);
      if (options?.allowedPlugins && !options.allowedPlugins.has(entryName)) {
        continue;
      }
      const policy = record(entry?.policy);
      if (text(policy?.installation) === "NOT_AVAILABLE") {
        continue;
      }
      const products = strings(policy?.products);
      if (products.length && !products.includes("ARTEMIS")) {
        continue;
      }
      const sourceValue = entry?.source;
      const source = record(sourceValue);
      const sourcePath =
        typeof sourceValue === "string"
          ? text(sourceValue)
          : source?.source === "local"
            ? text(source.path)
            : undefined;
      if (!sourcePath) {
        if (entryName) {
          if (options?.strict) {
            throw new Error(
              `${entryName} must use a plugin directory inside the marketplace repository.`,
            );
          }
          warnings.push(
            `${entryName} uses a non-local marketplace source and was skipped.`,
          );
        }
        continue;
      }
      try {
        const pluginPath = declaredPath(root, sourcePath, "Marketplace plugin");
        const canonical = await canonicalDirectory(pluginPath, root);
        const pluginSource: ArtemisPluginSource = options?.bundledSources
          ? { kind: "bundled", pluginName: entryName }
          : {
              kind: "git",
              marketplaceUrl: url,
              marketplaceName,
              pluginName: entryName,
            };
        const preview = services.preview(
          await services.parsePlugin(
            canonical,
            pluginSource,
            options?.validatePluginFiles ?? false,
          ),
        );
        if (!preview.installable) {
          if (
            preview.apps.some(
              (app) => app.name === "Update plugin and reconnect",
            )
          ) {
            plugins.push(preview);
            continue;
          }
          if (options?.strict) {
            throw new Error(
              `${entryName} must contain an installable Skill, MCP server, or Connector URL.`,
            );
          }
          continue;
        }
        const entryCategory = text(entry?.category);
        plugins.push({
          ...preview,
          ...(entryCategory && entryCategory.length <= 80
            ? { category: entryCategory }
            : {}),
        });
      } catch (error) {
        if (options?.strict) throw error;
        warnings.push(
          `${entryName} was skipped: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (options?.strict && plugins.length === 0) {
      throw new Error("Marketplace contains no installable plugins.");
    }
    return {
      name: options?.displayName ?? displayName,
      marketplaceName,
      url,
      plugins: plugins.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
      warnings,
    };
  }
  const handlers = {
    loadGitMarketplaceCore,
    marketplaceSnapshot,
    marketplaceSources,
    loadMarketplaceStore,
    saveMarketplaceStore,
    marketplaceCache,
    legacyMarketplaceCache,
    isStrictGithubMarketplace,
    bundledArtifactMarketplaceLocation,
    refreshMarketplace,
    marketplaceFile,
    readOfflineMarketplaceCandidate,
    readMarketplace,
  };
  return handlers;
}
