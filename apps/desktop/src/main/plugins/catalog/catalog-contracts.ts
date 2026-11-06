import type {
  McpCatalogInstallInput,
  McpCatalogInstallOption,
} from "../../../shared/api.js";

export type Fetcher = typeof fetch;

export type ProgressReporter = (percent: number) => void;

export interface ParsedRemoteHeader {
  name: string;
  template?: string;
  rawInputId?: string;
  placeholders: Array<{ name: string; inputId: string }>;
}

export interface ParsedEnvironmentVariable {
  name: string;
  field: McpCatalogInstallInput;
}

export type ParsedMcpInstallOption =
  | {
      preview: McpCatalogInstallOption;
      kind: "remote";
      url: string;
      headers: ParsedRemoteHeader[];
    }
  | {
      preview: McpCatalogInstallOption;
      kind: "npm-stdio";
      packageName: string;
      packageVersion: string;
      environment: ParsedEnvironmentVariable[];
    };

export interface ParsedRegistryServer {
  registryName: string;
  title: string;
  description: string;
  version: string;
  repositoryUrl?: string;
  options: ParsedMcpInstallOption[];
  reasons: string[];
}

export interface GithubTreeEntry {
  path: string;
  type: "blob";
  size?: number;
  sha: string;
}
