import { normalizeMarketplaceUrl } from "./marketplace-download.js";
import { pluginRootSubstitution } from "./plugin-mcp.js";
import { verifyMarketplaceIntegrity } from "./marketplace-integrity.js";

import { mcpConfigId } from "./plugin-values.js";

import type { ParsedPlugin } from "./plugin-types.js";

import {
  connectorSecurityContract,
  canonicalConnectorJson,
} from "../../shared/connector-oauth.js";

import { join } from "node:path";

import type { McpServerConfig } from "../../shared/api.js";
import { validateMcpServerConfig } from "../mcp/mcp-config-store.js";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createPluginMcpConfiguration(
  services: Pick<
    PluginServiceDependencies,
    | "connectorTrusted"
    | "options"
    | "loadMarketplaceStore"
    | "marketplaceCache"
    | "marketplaceFile"
  >,
) {
  async function buildMcpConfigs(
    parsed: ParsedPlugin,
    pluginDirectory: string,
  ): Promise<McpServerConfig[]> {
    const connectorTrusted = await services.connectorTrusted(parsed);
    const mcpServers = parsed.mcpServers.flatMap((server) => {
      if (!server.importable || server.transport === "unsupported") return [];
      if (server.connector && !connectorTrusted)
        throw new Error(
          "Connector requires a trusted signed marketplace plugin.",
        );
      const id = mcpConfigId(parsed.id, server.name);
      if (server.transport === "stdio") {
        const usesArtemisNode = server.command === "${ARTEMIS_NODE}";
        const command = usesArtemisNode
          ? process.execPath
          : pluginRootSubstitution(server.command!, pluginDirectory);
        const args = (server.args ?? []).map((argument) =>
          pluginRootSubstitution(argument, pluginDirectory),
        );
        return [
          validateMcpServerConfig({
            id,
            name: `${parsed.displayName}: ${server.name}`.slice(0, 100),
            transport: "stdio",
            enabled: true,
            command,
            args,
            env: usesArtemisNode ? { ELECTRON_RUN_AS_NODE: "1" } : {},
            envVars: server.envVars ?? [],
            workspacePath: join(services.options.mcpWorkspaceRoot, id),
            allowNetwork: true,
            ...(server.connector
              ? {
                  connector: server.connector,
                  resourceKind: "connector" as const,
                  connectorId: server.connector.id,
                }
              : {}),
          }),
        ];
      }
      return [
        validateMcpServerConfig({
          id,
          name: `${parsed.displayName}: ${server.name}`.slice(0, 100),
          transport: "streamable-http",
          enabled: true,
          url: server.url!,
          auth: server.auth ?? "none",
          ...(server.connector
            ? {
                connector: server.connector,
                resourceKind: "connector" as const,
                connectorId: server.connector.id,
              }
            : {}),
        }),
      ];
    });
    return mcpServers;
  }

  async function connectorTrusted(parsed: ParsedPlugin): Promise<boolean> {
    if (!parsed.mcpServers.some((server) => server.connector)) return true;
    if (parsed.source.kind !== "git" || !parsed.contentHash) return false;
    const url = normalizeMarketplaceUrl(parsed.source.marketplaceUrl);
    const source = (await services.loadMarketplaceStore()).sources.find(
      (candidate) => candidate.url === url,
    );
    if (!source?.signingKeyFingerprint) return false;
    const cache = services.marketplaceCache(url);
    const integrity = await verifyMarketplaceIntegrity(
      cache,
      await services.marketplaceFile(cache),
    );
    return (
      integrity?.signingKeyFingerprint === source.signingKeyFingerprint &&
      integrity.pluginHashes.get(parsed.source.pluginName) ===
        parsed.contentHash
    );
  }

  function mergeMcpUserSettings(
    next: McpServerConfig,
    current: McpServerConfig | undefined,
  ): McpServerConfig {
    if (!current) return next;
    // Enablement is user intent, independent of credential compatibility.
    next = { ...next, enabled: current.enabled };
    if (current.transport !== next.transport) return next;
    if (
      canonicalConnectorJson(connectorSecurityContract(next.connector)) !==
      canonicalConnectorJson(connectorSecurityContract(current.connector))
    )
      return next;
    if (next.transport === "stdio" && current.transport === "stdio") {
      return {
        ...next,
        env: structuredClone(next.connector ? next.env : current.env),
        envVars: [
          ...new Set([
            ...(next.envVars ?? []),
            ...(next.connector ? [] : current.envVars),
          ]),
        ],
      };
    }
    if (
      next.transport === "streamable-http" &&
      current.transport === "streamable-http"
    ) {
      if (current.url !== next.url) return next;
      const auth = current.auth ?? next.auth;
      return {
        ...next,
        enabled: current.enabled,
        ...(auth ? { auth } : {}),
        ...(current.credentialProviderId
          ? { credentialProviderId: current.credentialProviderId }
          : {}),
      };
    }
    return next;
  }
  const handlers = { buildMcpConfigs, connectorTrusted, mergeMcpUserSettings };
  return handlers;
}
