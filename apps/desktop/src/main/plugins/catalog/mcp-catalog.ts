import {
  MCP_REGISTRY,
  MAX_MCP_INPUT_BYTES,
  parseRegistryServer,
  mcpConfigId,
  parseMcpCatalogResponse,
} from "./mcp-registry-definition.js";
import { responseJson } from "./catalog-values.js";
import type { ParsedRegistryServer } from "./catalog-contracts.js";

import type { McpCatalogItem, McpServerConfig } from "../../../shared/api.js";
import type { McpSecretRecord } from "../../mcp/mcp-secret-store.js";

import type { CatalogDependencies } from "./catalog-dependencies.js";
export function createMcpCatalog(
  services: Pick<CatalogDependencies, "fetcher" | "resolveParsedMcpInstall">,
) {
  async function searchMcp(
    query: string,
    installedIds: ReadonlySet<string> = new Set(),
  ): Promise<McpCatalogItem[]> {
    const url = new URL("/v0.1/servers", MCP_REGISTRY);
    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", "40");
    if (query.trim()) url.searchParams.set("search", query.trim());
    const response = await services.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    return parseMcpCatalogResponse(
      await responseJson(response, "Official MCP Registry"),
    ).map((item) => ({
      ...item,
      installed: installedIds.has(item.configId),
    }));
  }

  async function resolveMcpConfig(
    registryName: string,
    version: string,
  ): Promise<McpServerConfig> {
    const path = `/v0.1/servers/${encodeURIComponent(registryName)}/versions/${encodeURIComponent(version)}`;
    const response = await services.fetcher(new URL(path, MCP_REGISTRY), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const parsed = parseRegistryServer(
      await responseJson(response, "Official MCP Registry"),
    );
    const option = parsed?.options.find(
      (candidate) => candidate.preview.inputs.length === 0,
    );
    if (!parsed || !option) {
      throw new Error(
        "This MCP server needs package, authentication, or transport setup.",
      );
    }
    return (
      await services.resolveParsedMcpInstall(parsed, option.preview.id, {})
    ).config;
  }

  async function resolveMcpInstall(
    registryName: string,
    version: string,
    optionId: string,
    inputValues: Record<string, string>,
  ): Promise<{ config: McpServerConfig; secrets: McpSecretRecord }> {
    const path = `/v0.1/servers/${encodeURIComponent(registryName)}/versions/${encodeURIComponent(version)}`;
    const response = await services.fetcher(new URL(path, MCP_REGISTRY), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const parsed = parseRegistryServer(
      await responseJson(response, "Official MCP Registry"),
    );
    if (
      !parsed ||
      parsed.registryName !== registryName ||
      parsed.version !== version
    ) {
      throw new Error("Official MCP Registry returned a different server.");
    }
    return services.resolveParsedMcpInstall(parsed, optionId, inputValues);
  }

  async function resolveParsedMcpInstall(
    parsed: ParsedRegistryServer,
    optionId: string,
    inputValues: Record<string, string>,
  ): Promise<{ config: McpServerConfig; secrets: McpSecretRecord }> {
    const option = parsed.options.find(
      (candidate) => candidate.preview.id === optionId,
    );
    if (!option)
      throw new Error("The selected MCP installation option changed.");
    const knownInputs = new Map(
      option.preview.inputs.map((field) => [field.id, field]),
    );
    if (
      !inputValues ||
      typeof inputValues !== "object" ||
      Array.isArray(inputValues) ||
      Object.keys(inputValues).some((id) => !knownInputs.has(id))
    ) {
      throw new Error("MCP installation input is invalid.");
    }
    const resolvedInputs = new Map<string, string>();
    for (const field of option.preview.inputs) {
      const supplied = inputValues[field.id];
      if (supplied !== undefined && typeof supplied !== "string") {
        throw new Error(`MCP installation input is invalid: ${field.label}`);
      }
      const value = supplied ?? field.defaultValue ?? "";
      if (Buffer.byteLength(value, "utf8") > MAX_MCP_INPUT_BYTES) {
        throw new Error(`MCP installation input is too large: ${field.label}`);
      }
      if (field.required && !value.trim()) {
        throw new Error(`MCP installation input is required: ${field.label}`);
      }
      if (value.trim()) resolvedInputs.set(field.id, value);
    }
    const secrets: McpSecretRecord = { env: {}, headers: {} };
    const id = mcpConfigId(parsed.registryName);
    if (option.kind === "npm-stdio") {
      const env: Record<string, string> = {};
      for (const variable of option.environment) {
        const value = resolvedInputs.get(variable.field.id);
        if (!value) continue;
        if (variable.field.secret) secrets.env[variable.name] = value;
        else env[variable.name] = value;
      }
      return {
        config: {
          id,
          name: parsed.title.slice(0, 100),
          transport: "stdio",
          enabled: true,
          command: "npx",
          args: ["-y", `${option.packageName}@${option.packageVersion}`],
          env,
          envVars: [],
          credentialEnvVars: Object.keys(secrets.env),
          workspacePath: "",
          allowNetwork: true,
        },
        secrets,
      };
    }
    for (const header of option.headers) {
      let value: string | undefined;
      if (header.rawInputId) value = resolvedInputs.get(header.rawInputId);
      else if (header.template) {
        value = header.placeholders.reduce((current, placeholder) => {
          const replacement = resolvedInputs.get(placeholder.inputId);
          return replacement
            ? current.replaceAll(`{${placeholder.name}}`, replacement)
            : current;
        }, header.template);
      }
      if (!value?.trim()) continue;
      if (/[\r\n]/u.test(value) || value.includes("{")) {
        throw new Error(`MCP HTTP header value is invalid: ${header.name}`);
      }
      secrets.headers[header.name] = value;
    }
    return {
      config: {
        id,
        name: parsed.title.slice(0, 100),
        transport: "streamable-http",
        enabled: true,
        url: option.url,
        auth: Object.keys(secrets.headers).length > 0 ? "headers" : "none",
        ...(Object.keys(secrets.headers).length > 0
          ? { headerNames: Object.keys(secrets.headers) }
          : {}),
      },
      secrets,
    };
  }
  const handlers = {
    searchMcp,
    resolveMcpConfig,
    resolveMcpInstall,
    resolveParsedMcpInstall,
  };
  return handlers;
}
