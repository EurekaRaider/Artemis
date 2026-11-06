import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
import { createInstalledPluginRepository } from "./installed-plugin-repository.js";
import { createPluginMcpConfiguration } from "./plugin-mcp-configuration.js";
import { createPluginInstallCommit } from "./plugin-install-commit.js";
import { createPluginInstallCoordinator } from "./plugin-install-coordinator.js";
import { createPluginManifestReader } from "./plugin-manifest-reader.js";
import { createPluginSourceResolver } from "./plugin-source-resolver.js";
import { createMarketplaceRepository } from "./marketplace-repository.js";
import { createMarketplaceManager } from "./marketplace-manager.js";
import { createInstalledPluginCatalog } from "./installed-plugin-catalog.js";
import { createPluginSkinRuntime } from "./plugin-skin-runtime.js";

import { defaultDownloadRepository } from "./marketplace-download.js";

import { pluginId } from "./plugin-values.js";

import type {
  ProgressReporter,
  CloneRepository,
  StoredSkin,
  ParsedPlugin,
  StoredPlugin,
  PluginStore,
  OfflineMarketplaceCandidate,
  MarketplaceStore,
  PreparedPlugin,
  DirectoryMove,
  ArtemisPluginServiceOptions,
} from "./plugin-types.js";
import { PluginInstallTransaction } from "./plugin-install-transaction.js";

import type { ConnectorOwner } from "../connectors/connector-service.js";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceState,
  ArtemisPluginMarketplaceTrustPreview,
  ArtemisPluginPreview,
  ArtemisPluginSource,
  InstalledArtemisPlugin,
  McpServerConfig,
} from "../../shared/api.js";

export class ArtemisPluginService {
  private readonly pluginSkinRuntime = createPluginSkinRuntime(
    this.runtimeDependencies(),
  );
  private readonly installedPluginCatalog = createInstalledPluginCatalog(
    this.runtimeDependencies(),
  );
  private readonly marketplaceManager = createMarketplaceManager(
    this.runtimeDependencies(),
  );
  private readonly marketplaceRepository = createMarketplaceRepository(
    this.runtimeDependencies(),
  );
  private readonly pluginSourceResolver = createPluginSourceResolver(
    this.runtimeDependencies(),
  );
  private readonly pluginManifestReader = createPluginManifestReader(
    this.runtimeDependencies(),
  );
  private readonly pluginInstallCoordinator = createPluginInstallCoordinator(
    this.runtimeDependencies(),
  );
  private readonly pluginInstallCommit = createPluginInstallCommit(
    this.runtimeDependencies(),
  );
  private readonly pluginMcpConfiguration = createPluginMcpConfiguration(
    this.runtimeDependencies(),
  );
  private readonly installedPluginRepository = createInstalledPluginRepository(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): PluginServiceDependencies {
    const host = this;
    return {
      get loadStore() {
        return host.loadStore.bind(host);
      },
      get options() {
        return host.options;
      },
      get exclusive() {
        return host.exclusive.bind(host);
      },
      get saveStore() {
        return host.saveStore.bind(host);
      },
      get installedPlugin() {
        return host.installedPlugin.bind(host);
      },
      get loadBundledArtifactMarketplace() {
        return host.loadBundledArtifactMarketplace.bind(host);
      },
      get listMarketplaces() {
        return host.listMarketplaces.bind(host);
      },
      get listInstalled() {
        return host.listInstalled.bind(host);
      },
      get verifyInstalledResources() {
        return host.verifyInstalledResources.bind(host);
      },
      get loadMarketplaceStore() {
        return host.loadMarketplaceStore.bind(host);
      },
      get marketplaceCache() {
        return host.marketplaceCache.bind(host);
      },
      get marketplaceFile() {
        return host.marketplaceFile.bind(host);
      },
      get parsePlugin() {
        return host.parsePlugin.bind(host);
      },
      get loadGitMarketplaceCore() {
        return host.loadGitMarketplaceCore.bind(host);
      },
      get marketplaceSnapshot() {
        return host.marketplaceSnapshot.bind(host);
      },
      get saveMarketplaceStore() {
        return host.saveMarketplaceStore.bind(host);
      },
      get isStrictGithubMarketplace() {
        return host.isStrictGithubMarketplace.bind(host);
      },
      get cloneRepository() {
        return host.cloneRepository;
      },
      get readMarketplace() {
        return host.readMarketplace.bind(host);
      },
      get readOfflineMarketplaceCandidate() {
        return host.readOfflineMarketplaceCandidate.bind(host);
      },
      get marketplaceRefreshErrors() {
        return host.marketplaceRefreshErrors;
      },
      get bundledArtifactMarketplaceLocation() {
        return host.bundledArtifactMarketplaceLocation.bind(host);
      },
      get preview() {
        return host.preview.bind(host);
      },
      get resolveSource() {
        return host.resolveSource.bind(host);
      },
      get refreshMarketplace() {
        return host.refreshMarketplace.bind(host);
      },
      get marketplaceSources() {
        return host.marketplaceSources.bind(host);
      },
      get marketplaceState() {
        return host.marketplaceState;
      },
      set marketplaceState(
        value: PluginServiceDependencies["marketplaceState"],
      ) {
        host.marketplaceState = value;
      },
      get legacyMarketplaceCache() {
        return host.legacyMarketplaceCache.bind(host);
      },
      get marketplacePluginRoot() {
        return host.marketplacePluginRoot.bind(host);
      },
      get state() {
        return host.state;
      },
      set state(value: PluginServiceDependencies["state"]) {
        host.state = value;
      },
      get update() {
        return host.update.bind(host);
      },
      get commitInstall() {
        return host.commitInstall.bind(host);
      },
      get assertSupportedAppConnectors() {
        return host.assertSupportedAppConnectors.bind(host);
      },
      get resourceDestinations() {
        return host.resourceDestinations.bind(host);
      },
      get commitMoves() {
        return host.commitMoves.bind(host);
      },
      get buildMcpConfigs() {
        return host.buildMcpConfigs.bind(host);
      },
      get preparePlugin() {
        return host.preparePlugin.bind(host);
      },
      get mergeMcpUserSettings() {
        return host.mergeMcpUserSettings.bind(host);
      },
      get publishDesignPluginRevision() {
        return host.publishDesignPluginRevision.bind(host);
      },
      get installTransaction() {
        return host.installTransaction.bind(host);
      },
      get connectorTrusted() {
        return host.connectorTrusted.bind(host);
      },
      get operation() {
        return host.operation;
      },
      set operation(value: PluginServiceDependencies["operation"]) {
        host.operation = value;
      },
    };
  }

  private readonly cloneRepository: CloneRepository;
  private readonly marketplaceRefreshErrors = new Map<string, string>();
  private state: PluginStore | undefined;
  private marketplaceState: MarketplaceStore | undefined;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly options: ArtemisPluginServiceOptions) {
    const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.cloneRepository =
      options.cloneRepository ??
      ((url, destination) =>
        defaultDownloadRepository(url, destination, fetcher));
  }

  skinSources(): Promise<
    {
      pluginId: string;
      pluginName: string;
      contentHash: string;
      enabled: boolean;
      root: string;
      skins: StoredSkin[];
    }[]
  > {
    return this.pluginSkinRuntime.skinSources();
  }

  assertSkinSnapshot(pluginId: string, contentHash: string): Promise<void> {
    return this.pluginSkinRuntime.assertSkinSnapshot(pluginId, contentHash);
  }

  setSkinsEnabled(pluginId: string, enabled: boolean): Promise<void> {
    return this.pluginSkinRuntime.setSkinsEnabled(pluginId, enabled);
  }

  hookSources(): Promise<
    Array<{ id: string; name: string; root: string; contentHash: string }>
  > {
    return this.pluginSkinRuntime.hookSources();
  }

  listInstalled(): Promise<InstalledArtemisPlugin[]> {
    return this.installedPluginCatalog.listInstalled();
  }

  inspectLocal(sourcePath: string): Promise<ArtemisPluginPreview> {
    return this.pluginSourceResolver.inspectLocal(sourcePath);
  }

  upgradeMigratedBundledPlugins(): Promise<string[]> {
    return this.pluginInstallCoordinator.upgradeMigratedBundledPlugins();
  }

  loadGitMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
  ): Promise<ArtemisPluginMarketplace> {
    return this.marketplaceManager.loadGitMarketplace(
      inputUrl,
      onProgress,
      refresh,
    );
  }

  listMarketplaces(sourceId?: string): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.listMarketplaces(sourceId);
  }

  addMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.addMarketplace(
      inputUrl,
      onProgress,
      expectedSigningKeyFingerprint,
    );
  }

  inspectMarketplaceTrust(
    inputUrl: string,
  ): Promise<ArtemisPluginMarketplaceTrustPreview> {
    return this.marketplaceManager.inspectMarketplaceTrust(inputUrl);
  }

  inspectOfflineMarketplace(
    inputPath: string,
  ): Promise<ArtemisPluginMarketplaceTrustPreview> {
    return this.marketplaceManager.inspectOfflineMarketplace(inputPath);
  }

  addOfflineMarketplace(
    inputPath: string,
    expectedSigningKeyFingerprint: string,
    onProgress?: ProgressReporter,
  ): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.addOfflineMarketplace(
      inputPath,
      expectedSigningKeyFingerprint,
      onProgress,
    );
  }

  selectMarketplace(sourceId: string): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.selectMarketplace(sourceId);
  }

  refreshMarketplaceSource(
    sourceId: string,
    onProgress?: ProgressReporter,
  ): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.refreshMarketplaceSource(
      sourceId,
      onProgress,
    );
  }

  removeMarketplace(sourceId: string): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.removeMarketplace(sourceId);
  }

  reorderMarketplaces(
    sourceIds: string[],
  ): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceManager.reorderMarketplaces(sourceIds);
  }

  loadBundledArtifactMarketplace(): Promise<
    ArtemisPluginMarketplace | undefined
  > {
    return this.marketplaceManager.loadBundledArtifactMarketplace();
  }

  /** Host-only entry, called with the root of a verified native capability pack. */
  installComputerUseFromRoot(
    root: string,
    version: string,
  ): Promise<InstalledArtemisPlugin> {
    return this.pluginInstallCoordinator.installComputerUseFromRoot(
      root,
      version,
    );
  }

  install(
    sourceInput: ArtemisPluginSource,
    onProgress?: ProgressReporter,
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    return this.pluginInstallCoordinator.install(sourceInput, onProgress);
  }

  update(
    pluginIdentifier: string,
    onProgress?: ProgressReporter,
    options?: { newServicesEnabled: boolean },
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    return this.pluginInstallCoordinator.update(
      pluginIdentifier,
      onProgress,
      options,
    );
  }

  remove(pluginIdentifier: string): Promise<{ warnings: string[] }> {
    return this.pluginInstallCoordinator.remove(pluginIdentifier);
  }

  installedById(
    pluginIdentifier: string,
  ): Promise<InstalledArtemisPlugin | undefined> {
    return this.installedPluginCatalog.installedById(pluginIdentifier);
  }

  listConnectorDefinitions(): Promise<
    {
      version: 1 | 2;
      oauth?: import("../../shared/connector-oauth.js").ConnectorOAuth;
      id: string;
      provider: import("../../shared/connector-types.js").ConnectorProvider;
      displayName: string;
      auth: import("../../shared/connector-types.js").ConnectorAuth;
      scopes: string[];
      capabilities?: Array<"read" | "write">;
      requiredHostCapabilities?: string[];
      setup?: "browser" | "device-code" | "authorization-code" | "desktop-mcp";
      serverId: string;
      pluginId: string;
      installed: boolean;
    }[]
  > {
    return this.installedPluginCatalog.listConnectorDefinitions();
  }

  isComputerUseServer(config: McpServerConfig): Promise<boolean> {
    return this.installedPluginCatalog.isComputerUseServer(config);
  }

  mcpRuntimeReadOnlyPaths(config: McpServerConfig): Promise<string[]> {
    return this.installedPluginCatalog.mcpRuntimeReadOnlyPaths(config);
  }

  assertConnectorTrusted(
    config: McpServerConfig,
  ): Promise<ConnectorOwner | void> {
    return this.installedPluginCatalog.assertConnectorTrusted(config);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    return this.installedPluginRepository.exclusive<T>(task);
  }

  private loadGitMarketplaceCore(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace> {
    return this.marketplaceRepository.loadGitMarketplaceCore(
      inputUrl,
      onProgress,
      refresh,
      expectedMarketplaceName,
      strict,
      expectedSigningKeyFingerprint,
    );
  }

  private marketplaceSnapshot(
    sourceId?: string,
  ): Promise<ArtemisPluginMarketplaceState> {
    return this.marketplaceRepository.marketplaceSnapshot(sourceId);
  }

  private marketplaceSources(
    store: MarketplaceStore,
  ): ArtemisPluginMarketplaceSource[] {
    return this.marketplaceRepository.marketplaceSources(store);
  }

  private loadMarketplaceStore(): Promise<MarketplaceStore> {
    return this.marketplaceRepository.loadMarketplaceStore();
  }

  private saveMarketplaceStore(value: MarketplaceStore): Promise<void> {
    return this.marketplaceRepository.saveMarketplaceStore(value);
  }

  private marketplaceCache(url: string): string {
    return this.marketplaceRepository.marketplaceCache(url);
  }

  private legacyMarketplaceCache(url: string): string {
    return this.marketplaceRepository.legacyMarketplaceCache(url);
  }

  private isStrictGithubMarketplace(url: string): boolean {
    return this.marketplaceRepository.isStrictGithubMarketplace(url);
  }

  private bundledArtifactMarketplaceLocation(): Promise<string | undefined> {
    return this.marketplaceRepository.bundledArtifactMarketplaceLocation();
  }

  private refreshMarketplace(
    url: string,
    onProgress?: ProgressReporter,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace> {
    return this.marketplaceRepository.refreshMarketplace(
      url,
      onProgress,
      expectedMarketplaceName,
      strict,
      expectedSigningKeyFingerprint,
    );
  }

  private marketplaceFile(root: string): Promise<string> {
    return this.marketplaceRepository.marketplaceFile(root);
  }

  private readOfflineMarketplaceCandidate(
    root: string,
  ): Promise<OfflineMarketplaceCandidate> {
    return this.marketplaceRepository.readOfflineMarketplaceCandidate(root);
  }

  private readMarketplace(
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
    return this.marketplaceRepository.readMarketplace(root, url, options);
  }

  private resolveSource(
    source: ArtemisPluginSource,
    requireFreshLocal: boolean,
  ): Promise<ParsedPlugin> {
    return this.pluginSourceResolver.resolveSource(source, requireFreshLocal);
  }

  private marketplacePluginRoot(
    marketplaceRoot: string,
    expectedMarketplaceName: string,
    pluginName: string,
  ): Promise<string> {
    return this.pluginSourceResolver.marketplacePluginRoot(
      marketplaceRoot,
      expectedMarketplaceName,
      pluginName,
    );
  }

  private parsePlugin(
    root: string,
    source: ArtemisPluginSource,
    prepare: boolean,
  ): Promise<ParsedPlugin> {
    return this.pluginManifestReader.parsePlugin(root, source, prepare);
  }

  private preview(parsed: ParsedPlugin): ArtemisPluginPreview {
    return this.pluginManifestReader.preview(parsed);
  }

  private assertSupportedAppConnectors(parsed: ParsedPlugin): void {
    return this.pluginManifestReader.assertSupportedAppConnectors(parsed);
  }

  private installedPlugin(plugin: StoredPlugin): InstalledArtemisPlugin {
    return this.installedPluginCatalog.installedPlugin(plugin);
  }

  private buildMcpConfigs(
    parsed: ParsedPlugin,
    pluginDirectory: string,
  ): Promise<McpServerConfig[]> {
    return this.pluginMcpConfiguration.buildMcpConfigs(parsed, pluginDirectory);
  }

  private connectorTrusted(parsed: ParsedPlugin): Promise<boolean> {
    return this.pluginMcpConfiguration.connectorTrusted(parsed);
  }

  private mergeMcpUserSettings(
    next: McpServerConfig,
    current: McpServerConfig | undefined,
  ): McpServerConfig {
    return this.pluginMcpConfiguration.mergeMcpUserSettings(next, current);
  }

  private preparePlugin(parsed: ParsedPlugin): Promise<PreparedPlugin> {
    return this.pluginInstallCommit.preparePlugin(parsed);
  }

  private commitInstall(
    parsed: ParsedPlugin,
    existing: StoredPlugin | undefined,
    onProgress?: ProgressReporter,
    newServicesEnabledInput?: boolean,
  ): Promise<{ plugin: InstalledArtemisPlugin; warnings: string[] }> {
    return this.pluginInstallCommit.commitInstall(
      parsed,
      existing,
      onProgress,
      newServicesEnabledInput,
    );
  }

  /**
   * S2: publish the parsed package's design-plugin payload as an immutable
   * revision under plugin-revisions/<installationId>/<contentHash>/.
   */
  private publishDesignPluginRevision(
    parsed: ParsedPlugin,
  ): Promise<NonNullable<StoredPlugin["designPlugin"]>> {
    return this.pluginInstallCommit.publishDesignPluginRevision(parsed);
  }

  private resourceDestinations(plugin: StoredPlugin): string[] {
    return this.installedPluginCatalog.resourceDestinations(plugin);
  }

  private verifyInstalledResources(
    plugin: StoredPlugin,
    currentMcp: McpServerConfig[],
  ): Promise<void> {
    return this.installedPluginCatalog.verifyInstalledResources(
      plugin,
      currentMcp,
    );
  }

  private commitMoves(
    moves: DirectoryMove[],
    previousMcp: McpServerConfig[],
    nextMcp: McpServerConfig[],
    nextStore: PluginStore,
  ): Promise<void> {
    return this.pluginInstallCommit.commitMoves(
      moves,
      previousMcp,
      nextMcp,
      nextStore,
    );
  }

  private installTransaction(): PluginInstallTransaction<
    PluginStore,
    McpServerConfig[]
  > {
    return this.pluginInstallCommit.installTransaction();
  }

  private loadStore(): Promise<PluginStore> {
    return this.installedPluginRepository.loadStore();
  }

  private saveStore(value: PluginStore): Promise<void> {
    return this.installedPluginRepository.saveStore(value);
  }
}

export { type ArtemisPluginServiceOptions } from "./plugin-types.js";
