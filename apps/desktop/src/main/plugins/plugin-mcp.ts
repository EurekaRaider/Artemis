import {
  validateConnectorDefinition,
  assertConnectorTransport,
  type ConnectorDefinition,
} from "../../shared/connectors.js";
import { join, resolve } from "node:path";
import type {
  ArtemisPluginMcpPreview,
  ArtemisPluginPreview,
  ArtemisPluginSource,
} from "../../shared/api.js";
import { exists } from "./plugin-files.js";
import { pathIsInside, record, text, strings } from "./plugin-values.js";
import { type ParsedMcpServer } from "./plugin-types.js";
export async function rejectedLegacyConnectors(
  root: string,
  manifest: Record<string, unknown>,
): Promise<ArtemisPluginPreview["apps"]> {
  if (
    manifest.connectors !== undefined ||
    manifest.apps !== undefined ||
    (await exists(join(root, ".connector.json"))) ||
    (await exists(join(root, ".app.json")))
  ) {
    return [{ name: "Update plugin and reconnect", required: true }];
  }
  return [];
}

export function unavailableConnectorNames(
  apps: ReadonlyArray<{ name: string; required?: boolean; url?: string }>,
  mcpServers: ReadonlyArray<{ name: string; importable: boolean }>,
): string[] {
  const importableMcpNames = new Set(
    mcpServers
      .filter((server) => server.importable)
      .map((server) => server.name.toLowerCase()),
  );
  return apps
    .filter(
      (app) =>
        !app.url &&
        (app.required || !importableMcpNames.has(app.name.toLowerCase())),
    )
    .map((app) => app.name);
}

export function blockingUnavailableConnectorNames(
  source: ArtemisPluginSource,
  apps: ReadonlyArray<{ name: string; required?: boolean; url?: string }>,
  mcpServers: ReadonlyArray<{ name: string; importable: boolean }>,
): string[] {
  const unavailable = unavailableConnectorNames(apps, mcpServers);
  if (source.kind !== "bundled" && source.kind !== "runtime") {
    return unavailable;
  }
  const requiredNames = new Set(
    apps.filter((app) => app.required).map((app) => app.name),
  );
  return unavailable.filter((name) => requiredNames.has(name));
}

export function pluginRootSubstitution(
  value: string,
  pluginRoot: string,
): string {
  const rootReference =
    /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/u;
  if (rootReference.test(value)) {
    if (
      /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)(?![\\/]|$)/u.test(
        value,
      ) ||
      value.replaceAll("\\", "/").split("/").includes("..")
    ) {
      throw new Error("MCP path escapes the installed plugin.");
    }
  }
  const substituted = value.replace(
    /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/gu,
    pluginRoot,
  );
  if (substituted.startsWith("./") || substituted.startsWith(".\\")) {
    const resolved = resolve(pluginRoot, substituted);
    if (!pathIsInside(pluginRoot, resolved)) {
      throw new Error("MCP command path escapes the installed plugin.");
    }
    return resolved;
  }
  return substituted;
}

export function hasUnresolvedVariable(value: string): boolean {
  return /\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)/u.test(
    value,
  );
}

export function hasCredentialArgument(args: string[]): boolean {
  return args.some(
    (argument) =>
      /^--?(?:authorization|api[-_]?key|access[-_]?token|auth[-_]?token|token|password|secret)(?:=|$)/iu.test(
        argument,
      ) || /^authorization:/iu.test(argument),
  );
}

export function parseMcpServer(
  name: string,
  input: unknown,
  warnings: string[],
): ParsedMcpServer {
  const server = record(input);
  if (!server) {
    return {
      name,
      transport: "unsupported",
      endpoint: "Invalid MCP definition",
      importable: false,
      requiresSetup: true,
    };
  }
  const extension = record(server["x-artemis"]);
  if (extension?.auth !== undefined)
    return {
      name,
      transport: "unsupported",
      endpoint: "Update plugin and reconnect",
      importable: false,
      requiresSetup: true,
    };
  let connector: ConnectorDefinition | undefined;
  if (extension?.connector !== undefined) {
    try {
      connector = validateConnectorDefinition(extension.connector);
    } catch {
      return {
        name,
        transport: "unsupported",
        endpoint: "Unsupported connector declaration",
        importable: false,
        requiresSetup: true,
      };
    }
  }
  const command = text(server.command);
  const type = text(server.type)?.toLowerCase();
  if (command || type === "stdio" || type === "local") {
    if (!command) {
      return {
        name,
        transport: "unsupported",
        endpoint: "Missing stdio command",
        importable: false,
        requiresSetup: true,
      };
    }
    try {
      if (connector) assertConnectorTransport(connector, "stdio");
    } catch {
      return {
        name,
        transport: "unsupported",
        endpoint: "Unsupported connector declaration",
        importable: false,
        requiresSetup: true,
      };
    }
    const args = strings(server.args);
    const commandUsesArtemisNode = command === "${ARTEMIS_NODE}";
    const removePluginRoot = (value: string) =>
      value.replace(
        /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/gu,
        "",
      );
    const unresolved =
      (!commandUsesArtemisNode &&
        hasUnresolvedVariable(removePluginRoot(command))) ||
      args.some((value) => hasUnresolvedVariable(removePluginRoot(value)));
    const environment = record(server.env) ?? {};
    const credentialArgument = hasCredentialArgument(args);

    const envVars = new Set(strings(server.env_vars ?? server.envVars));
    const omittedKeys: string[] = [];
    for (const [key, value] of Object.entries(environment)) {
      const reference =
        typeof value === "string"
          ? /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/u.exec(
              value,
            )
          : undefined;
      const referencedName = reference?.[1] ?? reference?.[2];
      if (referencedName === key) envVars.add(key);
      else omittedKeys.push(key);
    }
    if (omittedKeys.length) {
      warnings.push(
        `MCP server "${name}" requires manual environment values for: ${omittedKeys.join(", ")}. No values were imported.`,
      );
    }
    if (server.cwd !== undefined) {
      warnings.push(
        `MCP server "${name}" declares a custom cwd; Artemis uses a private managed workspace instead.`,
      );
    }
    if (unresolved) {
      warnings.push(
        `MCP server "${name}" contains unresolved command variables and was not imported.`,
      );
    }
    if (credentialArgument) {
      warnings.push(
        `MCP server "${name}" contains a credential argument and was not imported.`,
      );
    }
    return {
      name,
      transport: "stdio",
      endpoint: command,
      importable: !unresolved && !credentialArgument,
      requiresSetup: omittedKeys.length > 0 || unresolved || credentialArgument,
      command,
      args,
      envVars: [...envVars],
      ...(connector ? { connector, requiresSetup: true } : {}),
    };
  }

  const urlText = text(server.url);
  if (urlText && [undefined, "http", "streamable-http"].includes(type)) {
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      return {
        name,
        transport: "unsupported",
        endpoint: "Invalid URL",
        importable: false,
        requiresSetup: true,
      };
    }
    try {
      if (connector)
        assertConnectorTransport(connector, "streamable-http", url.href);
    } catch {
      return {
        name,
        transport: "unsupported",
        endpoint: "Unsupported connector declaration",
        importable: false,
        requiresSetup: true,
      };
    }
    const safeEndpoint = `${url.origin}${url.pathname}`;
    if (url.username || url.password || url.search || url.hash) {
      warnings.push(
        `MCP server "${name}" has an endpoint containing credentials or URL parameters and was not imported.`,
      );
      return {
        name,
        transport: "unsupported",
        endpoint: safeEndpoint,
        importable: false,
        requiresSetup: true,
      };
    }
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      url.hostname,
    );
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      warnings.push(
        `MCP server "${name}" uses an insecure non-loopback URL and was not imported.`,
      );
      return {
        name,
        transport: "unsupported",
        endpoint: safeEndpoint,
        importable: false,
        requiresSetup: true,
      };
    }
    const headers = record(server.headers) ?? record(server.http_headers) ?? {};
    const headerNames = Object.keys(headers);
    const unsupportedHeaders = headerNames.filter(
      (header) => header.toLowerCase() !== "authorization",
    );
    const auth: "none" | "bearer" | "oauth" =
      server.oauth_resource !== undefined || text(server.auth) === "oauth"
        ? "oauth"
        : headerNames.some(
              (header) => header.toLowerCase() === "authorization",
            ) || server.bearer_token_env_var !== undefined
          ? "bearer"
          : "none";
    if (auth === "bearer") {
      warnings.push(
        `MCP server "${name}" requires a bearer token. No credential was imported.`,
      );
    }
    if (unsupportedHeaders.length) {
      warnings.push(
        `MCP server "${name}" needs unsupported HTTP headers (${unsupportedHeaders.join(", ")}) and was not imported.`,
      );
    }
    return {
      name,
      transport: "streamable-http",
      endpoint: url.href,
      importable: unsupportedHeaders.length === 0,
      requiresSetup: auth === "bearer" || unsupportedHeaders.length > 0,
      url: url.href,
      auth,
      ...(connector ? { connector } : {}),
    };
  }

  return {
    name,
    transport: "unsupported",
    endpoint: type ?? "Unsupported MCP transport",
    importable: false,
    requiresSetup: true,
  };
}

export function mcpServerMap(value: unknown): Record<string, unknown> {
  const object = record(value) ?? {};
  return record(object.mcpServers) ?? record(object.mcp_servers) ?? object;
}

export function previewMcp(server: ParsedMcpServer): ArtemisPluginMcpPreview {
  return {
    name: server.name,
    ...(server.connector ? { connector: server.connector } : {}),
    transport: server.transport,
    endpoint: server.endpoint,
    importable: server.importable,
    requiresSetup: server.requiresSetup,
  };
}
