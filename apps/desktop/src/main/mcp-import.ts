import type {
  ConfigurationImportSummary,
  McpServerConfig,
  McpServerStatus,
} from "../shared/api.js";

export interface McpImportDependencies {
  list(): Promise<McpServerConfig[]>;
  upsert(config: McpServerConfig): Promise<McpServerConfig>;
  connect(config: McpServerConfig): Promise<McpServerStatus>;
}

export async function importMcpServers(
  servers: McpServerConfig[],
  summary: ConfigurationImportSummary,
  dependencies: McpImportDependencies,
): Promise<void> {
  const existingIds = new Set(
    (await dependencies.list()).map((server) => server.id),
  );
  let imported = 0;

  for (const server of servers) {
    if (existingIds.has(server.id)) {
      summary.skipped.push(`MCP server "${server.id}" already exists.`);
      continue;
    }

    const saved = await dependencies.upsert(server);
    existingIds.add(saved.id);
    imported += 1;
    try {
      const status = saved.enabled
        ? await dependencies.connect(saved)
        : undefined;
      if (status?.state === "failed") {
        throw new Error(status.error ?? "connection failed");
      }
    } catch (error) {
      summary.warnings.push(
        `MCP server "${saved.id}" was imported but failed to connect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  summary.imported.mcp = imported;
}
