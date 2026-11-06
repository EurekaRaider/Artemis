import {
  stageOfflineMarketplaceInput,
  githubMarketplaceRepository,
  normalizeGithubMarketplaceUrl,
  marketplaceSourceId,
} from "./marketplace-download.js";

import { verifyMarketplaceIntegrity } from "./marketplace-integrity.js";
import { exists } from "./plugin-files.js";

import {
  MAX_USER_MARKETPLACES,
  BUNDLED_ARTIFACT_PLUGIN_NAMES,
  BUNDLED_MARKETPLACE_ID,
  LOCAL_MARKETPLACE_ID,
} from "./plugin-constants.js";
import type {
  ProgressReporter,
  StoredMarketplaceSource,
  MarketplaceStore,
} from "./plugin-types.js";

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceState,
  ArtemisPluginMarketplaceTrustPreview,
} from "../../shared/api.js";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createMarketplaceManager(
  services: Pick<
    PluginServiceDependencies,
    | "exclusive"
    | "loadGitMarketplaceCore"
    | "marketplaceSnapshot"
    | "loadMarketplaceStore"
    | "saveMarketplaceStore"
    | "isStrictGithubMarketplace"
    | "marketplaceCache"
    | "marketplaceFile"
    | "options"
    | "cloneRepository"
    | "readMarketplace"
    | "readOfflineMarketplaceCandidate"
    | "marketplaceRefreshErrors"
    | "bundledArtifactMarketplaceLocation"
    | "preview"
    | "resolveSource"
  >,
) {
  async function loadGitMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
  ): Promise<ArtemisPluginMarketplace> {
    const url = normalizeGithubMarketplaceUrl(inputUrl);
    return services.exclusive(() =>
      services.loadGitMarketplaceCore(url, onProgress, refresh),
    );
  }

  async function listMarketplaces(
    sourceId?: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(() => services.marketplaceSnapshot(sourceId));
  }

  async function addMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      const url = normalizeGithubMarketplaceUrl(inputUrl);
      const store = await services.loadMarketplaceStore();
      const existing = store.sources.find((source) => source.url === url);
      if (existing) {
        store.selectedView = existing.id;
        await services.saveMarketplaceStore(store);
        onProgress?.(100);
        return services.marketplaceSnapshot();
      }
      if (store.sources.length >= MAX_USER_MARKETPLACES) {
        throw new Error(
          `No more than ${MAX_USER_MARKETPLACES} user plugin marketplaces can be added.`,
        );
      }
      const marketplace = await services.loadGitMarketplaceCore(
        url,
        onProgress,
        true,
        undefined,
        services.isStrictGithubMarketplace(url),
        expectedSigningKeyFingerprint,
      );
      const cachePath = services.marketplaceCache(url);
      const integrity = await verifyMarketplaceIntegrity(
        cachePath,
        await services.marketplaceFile(cachePath),
      );
      if (
        integrity?.signingKeyFingerprint !== expectedSigningKeyFingerprint ||
        (!integrity && expectedSigningKeyFingerprint)
      ) {
        await rm(cachePath, { recursive: true, force: true });
        throw new Error(
          "Marketplace signing key was not confirmed. Inspect and confirm its trust details before adding it.",
        );
      }
      const now = new Date().toISOString();
      const source: StoredMarketplaceSource = {
        id: marketplaceSourceId(url),
        url,
        marketplaceName: marketplace.marketplaceName,
        displayName: marketplace.name,
        addedAt: now,
        mode: "git",
        cachePath,
        ...(integrity
          ? { signingKeyFingerprint: integrity.signingKeyFingerprint }
          : {}),
      };
      store.sources.push(source);
      store.selectedView = source.id;
      await services.saveMarketplaceStore(store);
      return services.marketplaceSnapshot();
    });
  }

  async function inspectMarketplaceTrust(
    inputUrl: string,
  ): Promise<ArtemisPluginMarketplaceTrustPreview> {
    return services.exclusive(async () => {
      const url = normalizeGithubMarketplaceUrl(inputUrl);
      const stage = join(
        services.options.marketplacesRoot,
        `.inspect-${randomUUID()}`,
      );
      await mkdir(services.options.marketplacesRoot, { recursive: true });
      try {
        await services.cloneRepository(url, stage);
        const marketplace = await services.readMarketplace(stage, url, {
          strict: services.isStrictGithubMarketplace(url),
          validatePluginFiles: services.isStrictGithubMarketplace(url),
        });
        const integrity = await verifyMarketplaceIntegrity(
          stage,
          await services.marketplaceFile(stage),
        );
        return {
          url,
          repository: githubMarketplaceRepository(url),
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          signed: Boolean(integrity),
          ...(integrity
            ? { signingKeyFingerprint: integrity.signingKeyFingerprint }
            : {}),
        };
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async function inspectOfflineMarketplace(
    inputPath: string,
  ): Promise<ArtemisPluginMarketplaceTrustPreview> {
    return services.exclusive(async () => {
      const stage = join(
        services.options.marketplacesRoot,
        `.inspect-offline-${randomUUID()}`,
      );
      await mkdir(services.options.marketplacesRoot, { recursive: true });
      try {
        await stageOfflineMarketplaceInput(inputPath, stage);
        const { marketplace, integrity } =
          await services.readOfflineMarketplaceCandidate(stage);
        return {
          url: integrity.sourceUrl,
          repository: githubMarketplaceRepository(integrity.sourceUrl),
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          signed: true,
          signingKeyFingerprint: integrity.signingKeyFingerprint,
        };
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async function addOfflineMarketplace(
    inputPath: string,
    expectedSigningKeyFingerprint: string,
    onProgress?: ProgressReporter,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      const stage = join(
        services.options.marketplacesRoot,
        `.import-offline-${randomUUID()}`,
      );
      await mkdir(services.options.marketplacesRoot, { recursive: true });
      onProgress?.(5);
      let cacheInstalled = false;
      let oldCacheMoved = false;
      let cache = "";
      let backup = "";
      let previousStore: MarketplaceStore | undefined;
      let storeSaved = false;
      try {
        await stageOfflineMarketplaceInput(inputPath, stage);
        onProgress?.(40);
        const { marketplace, integrity } =
          await services.readOfflineMarketplaceCandidate(stage);
        if (
          !expectedSigningKeyFingerprint ||
          integrity.signingKeyFingerprint !== expectedSigningKeyFingerprint
        ) {
          throw new Error(
            "Offline marketplace signing key was not confirmed. Inspect and confirm the package again.",
          );
        }
        const store = await services.loadMarketplaceStore();
        previousStore = structuredClone(store);
        const id = marketplaceSourceId(integrity.sourceUrl);
        const existing = store.sources.find((source) => source.id === id);
        if (!existing && store.sources.length >= MAX_USER_MARKETPLACES) {
          throw new Error(
            `No more than ${MAX_USER_MARKETPLACES} user plugin marketplaces can be added.`,
          );
        }
        cache = services.marketplaceCache(integrity.sourceUrl);
        backup = `${cache}.backup-${randomUUID()}`;
        if (await exists(cache)) {
          await rename(cache, backup);
          oldCacheMoved = true;
        }
        await rename(stage, cache);
        cacheInstalled = true;
        onProgress?.(75);
        const now = new Date().toISOString();
        const source: StoredMarketplaceSource = {
          id,
          url: integrity.sourceUrl,
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          addedAt: existing?.addedAt ?? now,
          mode: "offline",
          cachePath: cache,
          signingKeyFingerprint: integrity.signingKeyFingerprint,
        };
        const nextStore: MarketplaceStore = {
          version: 1,
          selectedView: id,
          sources: existing
            ? store.sources.map((candidate) =>
                candidate.id === id ? source : candidate,
              )
            : [...store.sources, source],
        };
        await services.saveMarketplaceStore(nextStore);
        storeSaved = true;
        const result = await services.marketplaceSnapshot();
        if (oldCacheMoved) {
          await rm(backup, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        onProgress?.(100);
        return result;
      } catch (error) {
        if (cacheInstalled && cache) {
          await rm(cache, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        if (oldCacheMoved && cache && backup && (await exists(backup))) {
          await rename(backup, cache).catch(() => undefined);
        }
        if (storeSaved && previousStore) {
          await services
            .saveMarketplaceStore(previousStore)
            .catch(() => undefined);
        }
        throw error;
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async function selectMarketplace(
    sourceId: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      const store = await services.loadMarketplaceStore();
      if (
        sourceId !== BUNDLED_MARKETPLACE_ID &&
        sourceId !== LOCAL_MARKETPLACE_ID &&
        !store.sources.some((source) => source.id === sourceId)
      ) {
        throw new Error("Plugin marketplace was not found.");
      }
      store.selectedView = sourceId;
      await services.saveMarketplaceStore(store);
      return services.marketplaceSnapshot();
    });
  }

  async function refreshMarketplaceSource(
    sourceId: string,
    onProgress?: ProgressReporter,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      if (
        sourceId === BUNDLED_MARKETPLACE_ID ||
        sourceId === LOCAL_MARKETPLACE_ID
      ) {
        throw new Error("This plugin source does not have a Git marketplace.");
      }
      const store = await services.loadMarketplaceStore();
      const stored = store.sources.find((source) => source.id === sourceId);
      const url = stored?.url;
      if (!url) throw new Error("Plugin marketplace was not found.");
      if (stored?.mode === "offline") {
        throw new Error(
          "Offline marketplaces cannot be refreshed from the network. Import a newer offline package instead.",
        );
      }
      let expectedMarketplaceName = stored?.marketplaceName;
      if (!expectedMarketplaceName) {
        const cache = services.marketplaceCache(url);
        if (await exists(cache)) {
          expectedMarketplaceName = (await services.readMarketplace(cache, url))
            .marketplaceName;
        }
      }
      let marketplace: ArtemisPluginMarketplace;
      try {
        marketplace = await services.loadGitMarketplaceCore(
          url,
          onProgress,
          true,
          expectedMarketplaceName,
          services.isStrictGithubMarketplace(url),
          stored?.signingKeyFingerprint,
        );
        services.marketplaceRefreshErrors.delete(sourceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        services.marketplaceRefreshErrors.set(
          sourceId,
          `Refresh failed. The last cached marketplace was preserved and may be stale. Retry refresh. ${message}`,
        );
        throw error;
      }
      if (stored && stored.displayName !== marketplace.name) {
        stored.displayName = marketplace.name;
        await services.saveMarketplaceStore(store);
      }
      return services.marketplaceSnapshot();
    });
  }

  async function removeMarketplace(
    sourceId: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      if (sourceId === BUNDLED_MARKETPLACE_ID) {
        throw new Error("Bundled plugins cannot be removed.");
      }
      const store = await services.loadMarketplaceStore();
      const source = store.sources.find(
        (candidate) => candidate.id === sourceId,
      );
      if (!source) throw new Error("Plugin marketplace was not found.");
      store.sources = store.sources.filter(
        (candidate) => candidate.id !== sourceId,
      );
      if (store.selectedView === sourceId) {
        store.selectedView = BUNDLED_MARKETPLACE_ID;
      }
      services.marketplaceRefreshErrors.delete(sourceId);
      await services.saveMarketplaceStore(store);
      await rm(services.marketplaceCache(source.url), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      return services.marketplaceSnapshot();
    });
  }

  async function reorderMarketplaces(
    sourceIds: string[],
  ): Promise<ArtemisPluginMarketplaceState> {
    return services.exclusive(async () => {
      const store = await services.loadMarketplaceStore();
      const unique = new Set(sourceIds);
      if (
        sourceIds.length !== store.sources.length ||
        unique.size !== sourceIds.length ||
        store.sources.some((source) => !unique.has(source.id))
      ) {
        throw new Error("Plugin marketplace order is invalid.");
      }
      const byId = new Map(store.sources.map((source) => [source.id, source]));
      store.sources = sourceIds.map((sourceId) => byId.get(sourceId)!);
      await services.saveMarketplaceStore(store);
      return services.marketplaceSnapshot();
    });
  }

  async function loadBundledArtifactMarketplace(): Promise<
    ArtemisPluginMarketplace | undefined
  > {
    return services.exclusive(async () => {
      try {
        const marketplaceRoot =
          await services.bundledArtifactMarketplaceLocation();
        if (!marketplaceRoot) return undefined;
        const marketplace = await services.readMarketplace(
          marketplaceRoot,
          "artemis-bundled://lite-v1",
          {
            allowedPlugins: BUNDLED_ARTIFACT_PLUGIN_NAMES,
            displayName: "Bundled plugins",
            bundledSources: true,
            validatePluginFiles: true,
          },
        );
        const discoveredNames = new Set(
          marketplace.plugins
            .filter((plugin) => plugin.installable)
            .map((plugin) => plugin.name),
        );
        const missingNames = [...BUNDLED_ARTIFACT_PLUGIN_NAMES].filter(
          (name) => !discoveredNames.has(name),
        );
        if (missingNames.length) {
          marketplace.warnings.push(
            `Bundled plugins are unavailable: ${missingNames.join(", ")}.`,
          );
        }
        if (services.options.computerUseRoot) {
          marketplace.plugins = marketplace.plugins.filter(
            (plugin) => plugin.name !== "computer-use",
          );
          marketplace.plugins.push(
            services.preview(
              await services.resolveSource(
                { kind: "builtin", pluginName: "computer-use" },
                false,
              ),
            ),
          );
        }
        return marketplace.plugins.length ? marketplace : undefined;
      } catch {
        return undefined;
      }
    });
  }
  const handlers = {
    loadGitMarketplace,
    listMarketplaces,
    addMarketplace,
    inspectMarketplaceTrust,
    inspectOfflineMarketplace,
    addOfflineMarketplace,
    selectMarketplace,
    refreshMarketplaceSource,
    removeMarketplace,
    reorderMarketplaces,
    loadBundledArtifactMarketplace,
  };
  return handlers;
}
