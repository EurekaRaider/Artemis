import type { Fetcher, ParsedRegistryServer } from "./catalog-contracts.js";
import type { InstalledSkill, McpServerConfig } from "../../../shared/api.js";
import type { McpSecretRecord } from "../../mcp/mcp-secret-store.js";
export interface CatalogDependencies {
  readonly fetcher: Fetcher;
  resolveParsedMcpInstall(
    parsed: ParsedRegistryServer,
    optionId: string,
    inputValues: Record<string, string>,
  ): Promise<{
    config: McpServerConfig;
    secrets: McpSecretRecord;
  }>;
  listInstalledSkills(): Promise<InstalledSkill[]>;
  readonly skillsRoot: string;
}
