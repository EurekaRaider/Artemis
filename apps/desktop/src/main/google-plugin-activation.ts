import type { GoogleGrantId, McpServerConfig } from "../shared/api.js";

export interface ReadyInstalledGoogleMcpServers {
  ready: McpServerConfig[];
  skipped: Array<{ id: string; reason: string }>;
}

export function installedGoogleMcpServerIdsForGrant(
  configs: McpServerConfig[],
  installedServerIds: string[],
  grant: GoogleGrantId,
): string[] {
  const installed = new Set(installedServerIds);
  return configs
    .filter(
      (config) =>
        installed.has(config.id) &&
        !config.enabled &&
        config.hostAuth?.provider === "google" &&
        config.hostAuth.grant === grant,
    )
    .map((config) => config.id);
}

export async function readyInstalledGoogleMcpServers(
  configs: McpServerConfig[],
  installedServerIds: string[],
  ensureReady: (config: McpServerConfig) => Promise<void>,
): Promise<ReadyInstalledGoogleMcpServers> {
  const installed = new Set(installedServerIds);
  const ready: McpServerConfig[] = [];
  const skipped: ReadyInstalledGoogleMcpServers["skipped"] = [];

  for (const config of configs) {
    if (!installed.has(config.id) || config.enabled || !config.hostAuth)
      continue;
    try {
      await ensureReady(config);
      ready.push({ ...config, enabled: true });
    } catch (error) {
      skipped.push({
        id: config.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ready, skipped };
}
