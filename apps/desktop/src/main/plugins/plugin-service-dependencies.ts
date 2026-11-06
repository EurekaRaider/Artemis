import type {
  ProgressReporter,
  CloneRepository,
  ParsedPlugin,
  StoredPlugin,
  PluginStore,
  OfflineMarketplaceCandidate,
  MarketplaceStore,
  PreparedPlugin,
  DirectoryMove,
  ArtemisPluginServiceOptions,
} from "./plugin-types.js";
import type { PluginInstallTransaction } from "./plugin-install-transaction.js";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceSource,
  ArtemisPluginMarketplaceState,
  ArtemisPluginPreview,
  ArtemisPluginSource,
  InstalledArtemisPlugin,
  McpServerConfig,
} from "../../shared/api.js";
export interface PluginServiceDependencies {
  loadStore(): Promise<PluginStore>;
  readonly options: ArtemisPluginServiceOptions;
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  saveStore(value: PluginStore): Promise<void>;
  installedPlugin(plugin: StoredPlugin): InstalledArtemisPlugin;
  loadBundledArtifactMarketplace(): Promise<
    ArtemisPluginMarketplace | undefined
  >;
  listMarketplaces(sourceId?: string): Promise<ArtemisPluginMarketplaceState>;
  listInstalled(): Promise<InstalledArtemisPlugin[]>;
  verifyInstalledResources(
    plugin: StoredPlugin,
    currentMcp: McpServerConfig[],
  ): Promise<void>;
  loadMarketplaceStore(): Promise<MarketplaceStore>;
  marketplaceCache(url: string): string;
  marketplaceFile(root: string): Promise<string>;
  parsePlugin(
    root: string,
    source: ArtemisPluginSource,
    prepare: boolean,
  ): Promise<ParsedPlugin>;
  loadGitMarketplaceCore(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh?: boolean,
    expectedMarketplaceName?: string,
    strict?: boolean,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace>;
  marketplaceSnapshot(
    sourceId?: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  saveMarketplaceStore(value: MarketplaceStore): Promise<void>;
  isStrictGithubMarketplace(url: string): boolean;
  readonly cloneRepository: CloneRepository;
  readMarketplace(
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
  ): Promise<ArtemisPluginMarketplace>;
  readOfflineMarketplaceCandidate(
    root: string,
  ): Promise<OfflineMarketplaceCandidate>;
  readonly marketplaceRefreshErrors: Map<string, string>;
  bundledArtifactMarketplaceLocation(): Promise<string | undefined>;
  preview(parsed: ParsedPlugin): ArtemisPluginPreview;
  resolveSource(
    source: ArtemisPluginSource,
    requireFreshLocal: boolean,
  ): Promise<ParsedPlugin>;
  refreshMarketplace(
    url: string,
    onProgress?: ProgressReporter,
    expectedMarketplaceName?: string,
    strict?: boolean,
    expectedSigningKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplace>;
  marketplaceSources(store: MarketplaceStore): ArtemisPluginMarketplaceSource[];
  marketplaceState: MarketplaceStore | undefined;
  legacyMarketplaceCache(url: string): string;
  marketplacePluginRoot(
    marketplaceRoot: string,
    expectedMarketplaceName: string,
    pluginName: string,
  ): Promise<string>;
  state: PluginStore | undefined;
  update(
    pluginIdentifier: string,
    onProgress?: ProgressReporter,
    options?: {
      newServicesEnabled: boolean;
    },
  ): Promise<{
    plugin: InstalledArtemisPlugin;
    warnings: string[];
  }>;
  commitInstall(
    parsed: ParsedPlugin,
    existing: StoredPlugin | undefined,
    onProgress?: ProgressReporter,
    newServicesEnabledInput?: boolean,
  ): Promise<{
    plugin: InstalledArtemisPlugin;
    warnings: string[];
  }>;
  assertSupportedAppConnectors(parsed: ParsedPlugin): void;
  resourceDestinations(plugin: StoredPlugin): string[];
  commitMoves(
    moves: DirectoryMove[],
    previousMcp: McpServerConfig[],
    nextMcp: McpServerConfig[],
    nextStore: PluginStore,
  ): Promise<void>;
  buildMcpConfigs(
    parsed: ParsedPlugin,
    pluginDirectory: string,
  ): Promise<McpServerConfig[]>;
  preparePlugin(parsed: ParsedPlugin): Promise<PreparedPlugin>;
  mergeMcpUserSettings(
    next: McpServerConfig,
    current: McpServerConfig | undefined,
  ): McpServerConfig;
  publishDesignPluginRevision(
    parsed: ParsedPlugin,
  ): Promise<NonNullable<StoredPlugin["designPlugin"]>>;
  installTransaction(): PluginInstallTransaction<
    PluginStore,
    McpServerConfig[]
  >;
  connectorTrusted(parsed: ParsedPlugin): Promise<boolean>;
  operation: Promise<void>;
}
