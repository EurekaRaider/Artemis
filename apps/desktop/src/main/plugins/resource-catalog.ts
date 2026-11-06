import type { CatalogDependencies } from "./catalog/catalog-dependencies.js";
import { createSkillInstaller } from "./catalog/skill-installer.js";
import { createSkillCatalog } from "./catalog/skill-catalog.js";
import { createMcpCatalog } from "./catalog/mcp-catalog.js";
import {
  parseSkillCatalogResponse,
  parseSkillFrontmatter,
} from "./catalog/skill-source.js";
import {
  mcpConfigId,
  parseMcpCatalogResponse,
} from "./catalog/mcp-registry-definition.js";

import type {
  Fetcher,
  ProgressReporter,
  ParsedRegistryServer,
} from "./catalog/catalog-contracts.js";

import type {
  InstalledSkill,
  McpCatalogItem,
  McpServerConfig,
  SkillCatalogItem,
} from "../../shared/api.js";
import type { McpSecretRecord } from "../mcp/mcp-secret-store.js";

export class ResourceCatalogService {
  private readonly mcpCatalog = createMcpCatalog(this.runtimeDependencies());
  private readonly skillCatalog = createSkillCatalog(
    this.runtimeDependencies(),
  );
  private readonly skillInstaller = createSkillInstaller(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): CatalogDependencies {
    const host = this;
    return {
      get fetcher() {
        return host.fetcher;
      },
      get resolveParsedMcpInstall() {
        return host.resolveParsedMcpInstall.bind(host);
      },
      get listInstalledSkills() {
        return host.listInstalledSkills.bind(host);
      },
      get skillsRoot() {
        return host.skillsRoot;
      },
    };
  }

  constructor(
    private readonly skillsRoot: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  searchMcp(
    query: string,
    installedIds: ReadonlySet<string> = new Set(),
  ): Promise<McpCatalogItem[]> {
    return this.mcpCatalog.searchMcp(query, installedIds);
  }

  resolveMcpConfig(
    registryName: string,
    version: string,
  ): Promise<McpServerConfig> {
    return this.mcpCatalog.resolveMcpConfig(registryName, version);
  }

  resolveMcpInstall(
    registryName: string,
    version: string,
    optionId: string,
    inputValues: Record<string, string>,
  ): Promise<{ config: McpServerConfig; secrets: McpSecretRecord }> {
    return this.mcpCatalog.resolveMcpInstall(
      registryName,
      version,
      optionId,
      inputValues,
    );
  }

  private resolveParsedMcpInstall(
    parsed: ParsedRegistryServer,
    optionId: string,
    inputValues: Record<string, string>,
  ): Promise<{ config: McpServerConfig; secrets: McpSecretRecord }> {
    return this.mcpCatalog.resolveParsedMcpInstall(
      parsed,
      optionId,
      inputValues,
    );
  }

  searchSkills(query: string): Promise<SkillCatalogItem[]> {
    return this.skillCatalog.searchSkills(query);
  }

  listInstalledSkills(): Promise<InstalledSkill[]> {
    return this.skillCatalog.listInstalledSkills();
  }

  installSkill(
    id: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    return this.skillInstaller.installSkill(id, onProgress);
  }

  installLocalSkill(
    sourcePath: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    return this.skillInstaller.installLocalSkill(sourcePath, onProgress);
  }

  removeSkill(id: string): Promise<void> {
    return this.skillCatalog.removeSkill(id);
  }
}

export {
  mcpConfigId,
  parseMcpCatalogResponse,
} from "./catalog/mcp-registry-definition.js";

export {
  parseSkillCatalogResponse,
  parseSkillFrontmatter,
} from "./catalog/skill-source.js";
