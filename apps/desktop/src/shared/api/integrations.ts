import type { SkinSummary } from "../appearance.js";
import type { PluginLocalizations } from "../i18n/plugin-localization.js";
import type {
  ConnectorDefinition,
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorConnectInput,
} from "../connectors.js";
import type { InstalledSkill } from "./skills.js";
import type { SettingsSnapshot } from "./settings.js";
export interface IntegrationsApi {
  listArtemisPlugins(): Promise<InstalledArtemisPlugin[]>;
  inspectLocalArtemisPlugin(): Promise<ArtemisPluginPreview | undefined>;
  loadArtemisPluginMarketplace(
    url: string,
    operationId: string,
    refresh?: boolean,
  ): Promise<ArtemisPluginMarketplace>;
  getArtemisPluginMarketplaces(
    sourceId?: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  addArtemisPluginMarketplace(
    url: string,
    operationId: string,
    signingKeyFingerprint?: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  inspectArtemisPluginMarketplaceTrust(
    url: string,
  ): Promise<ArtemisPluginMarketplaceTrustPreview>;
  inspectOfflineArtemisPluginMarketplace(): Promise<
    ArtemisPluginOfflineMarketplacePreview | undefined
  >;
  addOfflineArtemisPluginMarketplace(
    path: string,
    operationId: string,
    signingKeyFingerprint: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  listConnectorDefinitions(): Promise<ConnectorCatalogEntry[]>;
  listConnectorConnections(): Promise<ConnectorConnection[]>;
  connectConnector(input: ConnectorConnectInput): Promise<ConnectorConnection>;
  cancelConnectorAuthorization(serverId: string): Promise<void>;
  reconnectConnector(serverId: string): Promise<ConnectorConnection>;
  disconnectConnector(serverId: string): Promise<void>;
  selectArtemisPluginMarketplace(
    sourceId: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  refreshArtemisPluginMarketplace(
    sourceId: string,
    operationId: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  removeArtemisPluginMarketplace(
    sourceId: string,
  ): Promise<ArtemisPluginMarketplaceState>;
  reorderArtemisPluginMarketplaces(
    sourceIds: string[],
  ): Promise<ArtemisPluginMarketplaceState>;
  loadBundledPluginMarketplace(): Promise<ArtemisPluginMarketplace | undefined>;
  installBundledPlugins(
    operationId: string,
  ): Promise<ArtemisPluginMutationResult>;
  installArtemisPlugin(
    source: ArtemisPluginSource,
    operationId: string,
  ): Promise<ArtemisPluginMutationResult>;
  updateArtemisPlugin(
    pluginId: string,
    operationId: string,
  ): Promise<ArtemisPluginMutationResult>;
  setArtemisPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<ArtemisPluginMutationResult>;
  removeArtemisPlugin(pluginId: string): Promise<ArtemisPluginMutationResult>;
}

export type ArtemisPluginSource =
  | { kind: "local"; path: string }
  | { kind: "builtin"; pluginName: "computer-use" }
  | { kind: "bundled"; pluginName: string }
  // Kept so installations created before Lite mode can update in place.
  | { kind: "runtime"; pluginName: string }
  | {
      kind: "git";
      marketplaceUrl: string;
      marketplaceName: string;
      pluginName: string;
    };

export interface ArtemisPluginSkillPreview {
  name: string;
  description: string;
}

export interface ArtemisPluginMcpPreview {
  connector?: ConnectorDefinition;
  name: string;
  transport: "stdio" | "streamable-http" | "unsupported";
  endpoint: string;
  importable: boolean;
  requiresSetup: boolean;
}

export interface ArtemisPluginAppPreview {
  name: string;
  connectorId?: string;
  required?: boolean;
  url?: string;
  auth?: "none" | "bearer" | "oauth";
}

export interface ArtemisPluginPreview {
  capabilityDependencies?: import("@artemis/protocol").CapabilityDependency[];
  hasHooks?: boolean;
  localizations?: PluginLocalizations;
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  shortDescription?: string;
  category?: string;
  brandColor?: string;
  iconDataUrl?: string;
  source: ArtemisPluginSource;
  installed: boolean;
  installable: boolean;
  skins?: SkinSummary[];
  skills: ArtemisPluginSkillPreview[];
  mcpServers: ArtemisPluginMcpPreview[];
  apps: ArtemisPluginAppPreview[];
  unsupported: string[];
  warnings: string[];
}

export interface InstalledArtemisPlugin extends ArtemisPluginPreview {
  formatMigrationRequired?: boolean;
  formatMigrationEnabledMcpIds?: string[];
  hooksEnabled?: boolean;
  skinsEnabled?: boolean;
  contentHash: string;
  installedAt: string;
  updatedAt: string;
  skillNames: string[];
  mcpServerIds: string[];
}

export interface ArtemisPluginMarketplace {
  name: string;
  marketplaceName: string;
  url: string;
  plugins: ArtemisPluginPreview[];
  warnings: string[];
}

export interface ArtemisPluginMarketplaceSource {
  id: string;
  url: string;
  marketplaceName: string;
  displayName: string;
  repository: string;
  builtIn: boolean;
  removable: boolean;
  offline: boolean;
  refreshable: boolean;
  order: number;
  addedAt?: string;
  signingKeyFingerprint?: string;
}

export interface ArtemisPluginMarketplaceTrustPreview {
  url: string;
  repository: string;
  marketplaceName: string;
  displayName: string;
  signed: boolean;
  signingKeyFingerprint?: string;
}

export interface ArtemisPluginOfflineMarketplacePreview {
  path: string;
  trust: ArtemisPluginMarketplaceTrustPreview;
}

export interface ArtemisPluginMarketplaceEntry {
  sourceId: string;
  marketplace: ArtemisPluginMarketplace;
}

export interface ArtemisPluginMarketplaceError {
  sourceId: string;
  message: string;
}

export interface ArtemisPluginMarketplaceState {
  selectedView: string;
  sources: ArtemisPluginMarketplaceSource[];
  marketplaces: ArtemisPluginMarketplaceEntry[];
  errors: ArtemisPluginMarketplaceError[];
}

export interface ArtemisPluginMutationResult {
  plugins: InstalledArtemisPlugin[];
  skills: InstalledSkill[];
  settings: SettingsSnapshot;
  warnings: string[];
}
