import type { SkinSummary } from "../../shared/appearance.js";
import { type CapabilityDependency } from "@artemis/protocol";
import { type PluginLocalizations } from "../../shared/i18n/plugin-localization.js";
import { type ConnectorDefinition } from "../../shared/connectors.js";
import { type PluginManifest } from "@artemis/protocol";
import type {
  ArtemisPluginMarketplace,
  ArtemisPluginPreview,
  ArtemisPluginSource,
  McpServerConfig,
} from "../../shared/api.js";
import { McpConfigStore } from "../mcp/mcp-config-store.js";
import { pluginId } from "./plugin-values.js";
export type ProgressReporter = (percent: number) => void;

export type CloneRepository = (
  url: string,
  destination: string,
) => Promise<void>;

export type MarketplaceFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CollectedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mode: number;
  hash: string;
}

export interface ParsedSkill {
  name: string;
  description: string;
  root: string;
  hash?: string;
  files?: CollectedFile[];
}

export interface ParsedMcpServer {
  name: string;
  transport: "stdio" | "streamable-http" | "unsupported";
  endpoint: string;
  importable: boolean;
  requiresSetup: boolean;
  command?: string;
  args?: string[];
  envVars?: string[];
  url?: string;
  auth?: "none" | "bearer" | "oauth";
  connector?: ConnectorDefinition;
}

export interface StoredSkin extends SkinSummary {
  path: string;
}

export interface ParsedPlugin {
  skins: StoredSkin[];
  capabilityDependencies?: CapabilityDependency[];
  hasHooks?: boolean;
  localizations?: PluginLocalizations;
  /** S1: parsed artemis.plugin.json when the package carries one. */
  designPluginManifest?: PluginManifest;
  root: string;
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
  skills: ParsedSkill[];
  mcpServers: ParsedMcpServer[];
  apps: ArtemisPluginPreview["apps"];
  unsupported: string[];
  warnings: string[];
  contentHash?: string;
  files?: CollectedFile[];
}

export interface StoredSkill {
  name: string;
  hash: string;
}

export interface StoredMcpServer {
  id: string;
  structuralHash: string;
}

export interface StoredPlugin {
  skins: StoredSkin[];
  skinsEnabled: boolean;
  formatMigrationRequired?: boolean;
  formatMigrationEnabledMcpIds?: string[];
  capabilityDependencies?: CapabilityDependency[];
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
  contentHash: string;
  installedAt: string;
  updatedAt: string;
  skills: StoredSkill[];
  mcpServers: StoredMcpServer[];
  skillPreviews: ArtemisPluginPreview["skills"];
  mcpPreviews: ArtemisPluginPreview["mcpServers"];
  appPreviews: ArtemisPluginPreview["apps"];
  unsupported: string[];
  warnings: string[];
  /** S1: immutable revision pointer for design plugins. */
  designPlugin?: {
    installationId: string;
    contentHash: string;
    revisionRoot: string;
    version: string;
  };
}

export interface PluginStore {
  version: 1;
  plugins: StoredPlugin[];
}

export interface StoredMarketplaceSource {
  id: string;
  url: string;
  marketplaceName: string;
  displayName: string;
  addedAt: string;
  mode?: "git" | "offline";
  cachePath?: string;
  signingKeyFingerprint?: string;
}

export interface VerifiedMarketplaceIntegrity {
  signingKeyFingerprint: string;
  pluginHashes: Map<string, string>;
  packageFiles: Set<string>;
  sourceUrl?: string;
}

export interface OfflineMarketplaceCandidate {
  marketplace: ArtemisPluginMarketplace;
  integrity: VerifiedMarketplaceIntegrity & { sourceUrl: string };
}

export interface MarketplaceStore {
  version: 1;
  selectedView: string;
  sources: StoredMarketplaceSource[];
}

export interface PreparedPlugin {
  parsed: ParsedPlugin;
  pluginDirectory: string;
  skills: Array<ParsedSkill & { hash: string; files: CollectedFile[] }>;
  mcpConfigs: McpServerConfig[];
}

export interface DirectoryMove {
  destination: string;
  backup: string;
  stage?: string;
}

export interface ArtemisPluginServiceOptions {
  skillsRoot: string;
  pluginsRoot: string;
  marketplacesRoot: string;
  marketplaceStatePath: string;
  statePath: string;
  mcpWorkspaceRoot: string;
  mcpStore: McpConfigStore;
  bundledArtifactRoot?: string;
  computerUseRoot?: string;
  computerUseManagedRuntime?: boolean;
  /**
   * Design-plugin revision store root. Defaults to the legacy
   * plugins/plugin-revisions location; production passes the
   * design-plugins namespace (the native plugin migration owns plugins/).
   */
  designRevisionsRoot?: string;
  cloneRepository?: CloneRepository;
  fetcher?: MarketplaceFetcher;
  beforeSnapshotChange?: (pluginId: string) => Promise<void>;
  afterSnapshotChange?: () => Promise<void>;
}

export interface GitHubRateLimit {
  resetAt?: Date;
  retryAfterMilliseconds?: number;
}
