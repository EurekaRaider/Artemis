import type { SettingsSnapshot } from "./settings.js";
export interface ConfigurationImportApi {
  scanConfigurationImports(): Promise<ConfigurationImportPreview>;
  importConfiguration(
    request: ConfigurationImportRequest,
  ): Promise<ConfigurationImportResult>;
}

export type ConfigurationImportSource = "codex" | "opencode" | "claude";

export type ConfigurationImportCategory = "instructions" | "skills" | "mcp";

export interface ConfigurationImportCounts {
  instructions: number;
  skills: number;
  mcp: number;
}

export interface ConfigurationImportSourcePreview {
  source: ConfigurationImportSource;
  detected: boolean;
  paths: string[];
  counts: ConfigurationImportCounts;
  warnings: string[];
}

export interface ConfigurationImportPreview {
  sources: ConfigurationImportSourcePreview[];
}

export interface ConfigurationImportRequest {
  sources: ConfigurationImportSource[];
  categories: ConfigurationImportCategory[];
}

export interface ConfigurationImportSummary {
  imported: ConfigurationImportCounts;
  skipped: string[];
  warnings: string[];
}

export interface ConfigurationImportResult {
  settings: SettingsSnapshot;
  summary: ConfigurationImportSummary;
}
