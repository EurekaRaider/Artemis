import { createHash } from "node:crypto";
import type {
  McpCatalogInstallInput,
  McpCatalogItem,
} from "../../../shared/api.js";
import { record, text, safeRemoteUrl } from "./catalog-values.js";
import {
  type ParsedRemoteHeader,
  type ParsedMcpInstallOption,
  type ParsedEnvironmentVariable,
  type ParsedRegistryServer,
} from "./catalog-contracts.js";
export const MCP_REGISTRY = "https://registry.modelcontextprotocol.io";

export const MAX_MCP_INPUT_BYTES = 32 * 1024;

export const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

export const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;

export const NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export const NPM_PACKAGE_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const BLOCKED_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const BLOCKED_PACKAGE_ENVIRONMENT = new Set([
  "COMSPEC",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "HOME",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_FILE",
  "USERPROFILE",
]);

export function inputField(
  id: string,
  label: string,
  options: {
    description?: string;
    required: boolean;
    secret: boolean;
    defaultValue?: string;
  },
): McpCatalogInstallInput {
  return {
    id,
    label,
    required: options.required,
    secret: options.secret,
    ...(options.description ? { description: options.description } : {}),
    ...(options.defaultValue ? { defaultValue: options.defaultValue } : {}),
  };
}

export function parseRemoteOption(
  value: unknown,
  index: number,
): { option?: ParsedMcpInstallOption; reason?: string } {
  const remote = record(value);
  if (remote?.type !== "streamable-http") {
    return { reason: "SSE and other remote transports are not supported." };
  }
  if (
    (record(remote.variables) &&
      Object.keys(record(remote.variables) ?? {}).length > 0) ||
    text(remote.url)?.includes("{")
  ) {
    return { reason: "Remote URL variables are not supported yet." };
  }
  const url = safeRemoteUrl(remote.url);
  if (!url) {
    return { reason: "The remote MCP URL is not a safe HTTPS endpoint." };
  }
  if (remote.headers !== undefined && !Array.isArray(remote.headers)) {
    return { reason: "Remote MCP headers have an invalid format." };
  }
  const headerValues = Array.isArray(remote.headers) ? remote.headers : [];
  if (headerValues.length > 20) {
    return { reason: "Remote MCP headers exceed the supported limit." };
  }
  const fields: McpCatalogInstallInput[] = [];
  const headers: ParsedRemoteHeader[] = [];
  const headerNames = new Set<string>();
  for (const [headerIndex, headerValue] of headerValues.entries()) {
    const header = record(headerValue);
    const name = text(header?.name);
    if (
      !name ||
      !HEADER_NAME.test(name) ||
      BLOCKED_HEADERS.has(name.toLowerCase())
    ) {
      return { reason: "Remote MCP declares an unsafe HTTP header." };
    }
    const normalizedName = name.toLowerCase();
    if (headerNames.has(normalizedName)) {
      return { reason: "Remote MCP declares duplicate HTTP headers." };
    }
    headerNames.add(normalizedName);
    const description = text(header?.description);
    const declaredTemplate = text(header?.value) ?? text(header?.default);
    if (declaredTemplate && /[\r\n]/u.test(declaredTemplate)) {
      return { reason: "Remote MCP declares an unsafe HTTP header value." };
    }
    const headerIsSecret =
      header?.isSecret === true || name.toLowerCase() === "authorization";
    if (!declaredTemplate) {
      const id = `header.${headerIndex}.value`;
      fields.push(
        inputField(id, name, {
          ...(description ? { description } : {}),
          required: header?.isRequired !== false,
          secret: headerIsSecret,
        }),
      );
      headers.push({ name, rawInputId: id, placeholders: [] });
      continue;
    }
    const matches = [
      ...declaredTemplate.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu),
    ];
    const unmatchedBraces = matches.reduce(
      (current, match) => current.replace(match[0], ""),
      declaredTemplate,
    );
    if (/[{}]/u.test(unmatchedBraces)) {
      return { reason: "Remote MCP header variables are invalid." };
    }
    const placeholders = [
      ...new Map(
        matches.map((match) => {
          const placeholder = match[1]!;
          const id = `header.${headerIndex}.${placeholder}`;
          return [placeholder, { name: placeholder, inputId: id }] as const;
        }),
      ).values(),
    ];
    for (const placeholder of placeholders) {
      fields.push(
        inputField(placeholder.inputId, placeholder.name, {
          ...(description ? { description } : {}),
          required: true,
          secret:
            headerIsSecret ||
            /(?:key|password|secret|token)/iu.test(placeholder.name),
        }),
      );
    }
    headers.push({
      name,
      template: declaredTemplate,
      placeholders,
    });
  }
  return {
    option: {
      kind: "remote",
      url,
      headers,
      preview: {
        id: `remote-${index}`,
        kind: "remote",
        label: "Remote HTTPS server",
        detail: url,
        inputs: fields,
      },
    },
  };
}

export function officialNpmRegistry(value: unknown): boolean {
  const registry = text(value);
  if (!registry) return true;
  try {
    const url = new URL(registry);
    return (
      url.protocol === "https:" &&
      url.hostname === "registry.npmjs.org" &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function parseNpmOption(
  value: unknown,
  index: number,
): { option?: ParsedMcpInstallOption; reason?: string } {
  const packageValue = record(value);
  const transport = record(packageValue?.transport);
  if (packageValue?.registryType !== "npm" || transport?.type !== "stdio") {
    return { reason: "Only npm packages using stdio are supported." };
  }
  if (!officialNpmRegistry(packageValue.registryBaseUrl)) {
    return { reason: "Only the official npm registry is supported." };
  }
  const runtimeHint = text(packageValue.runtimeHint);
  if (runtimeHint && runtimeHint !== "npx") {
    return { reason: "This npm package requires an unsupported runtime." };
  }
  const runtimeArguments = packageValue.runtimeArguments;
  const packageArguments = packageValue.packageArguments;
  if (
    (runtimeArguments !== undefined && !Array.isArray(runtimeArguments)) ||
    (packageArguments !== undefined && !Array.isArray(packageArguments)) ||
    (Array.isArray(runtimeArguments) && runtimeArguments.length > 0) ||
    (Array.isArray(packageArguments) && packageArguments.length > 0)
  ) {
    return { reason: "Registry package arguments are not supported yet." };
  }
  const packageName = text(packageValue.identifier);
  const packageVersion = text(packageValue.version);
  if (
    !packageName ||
    !NPM_PACKAGE_NAME.test(packageName) ||
    !packageVersion ||
    !NPM_PACKAGE_VERSION.test(packageVersion)
  ) {
    return { reason: "The npm package identifier or version is invalid." };
  }
  if (
    packageValue.environmentVariables !== undefined &&
    !Array.isArray(packageValue.environmentVariables)
  ) {
    return { reason: "The npm environment variable metadata is invalid." };
  }
  const environmentValues = Array.isArray(packageValue.environmentVariables)
    ? packageValue.environmentVariables
    : [];
  if (environmentValues.length > 50) {
    return {
      reason: "The npm package declares too many environment variables.",
    };
  }
  const environment: ParsedEnvironmentVariable[] = [];
  const environmentNames = new Set<string>();
  for (const environmentValue of environmentValues) {
    const variable = record(environmentValue);
    const name = text(variable?.name);
    if (
      !name ||
      !ENVIRONMENT_NAME.test(name) ||
      BLOCKED_PACKAGE_ENVIRONMENT.has(name.toUpperCase()) ||
      name.toUpperCase().startsWith("NPM_CONFIG_")
    ) {
      return {
        reason: "The npm package declares an invalid environment name.",
      };
    }
    if (environmentNames.has(name)) {
      return {
        reason: "The npm package declares duplicate environment names.",
      };
    }
    environmentNames.add(name);
    const description = text(variable?.description);
    const isSecret = variable?.isSecret === true;
    const defaultValue = isSecret ? undefined : text(variable?.default);
    environment.push({
      name,
      field: inputField(`env.${name}`, name, {
        ...(description ? { description } : {}),
        required: variable?.isRequired === true,
        secret: isSecret,
        ...(defaultValue ? { defaultValue } : {}),
      }),
    });
  }
  const detail = `npx -y ${packageName}@${packageVersion}`;
  return {
    option: {
      kind: "npm-stdio",
      packageName,
      packageVersion,
      environment,
      preview: {
        id: `npm-${index}`,
        kind: "npm-stdio",
        label: "npm package",
        detail,
        inputs: environment.map((entry) => entry.field),
      },
    },
  };
}

export function parseRegistryServer(
  value: unknown,
): ParsedRegistryServer | undefined {
  const server = record(record(value)?.server);
  const registryName = text(server?.name);
  const description = text(server?.description);
  const version = text(server?.version);
  if (!registryName || !description || !version) return undefined;
  const repositoryUrl = text(record(server?.repository)?.url);
  const options: ParsedMcpInstallOption[] = [];
  const reasons: string[] = [];
  const remotes = Array.isArray(server?.remotes) ? server.remotes : [];
  for (const [index, remote] of remotes.entries()) {
    const parsed = parseRemoteOption(remote, index);
    if (parsed.option) options.push(parsed.option);
    if (parsed.reason) reasons.push(parsed.reason);
  }
  const packages = Array.isArray(server?.packages) ? server.packages : [];
  for (const [index, packageValue] of packages.entries()) {
    const parsed = parseNpmOption(packageValue, index);
    if (parsed.option) options.push(parsed.option);
    if (parsed.reason) reasons.push(parsed.reason);
  }
  return {
    registryName,
    title: text(server?.title) ?? registryName,
    description,
    version,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    options,
    reasons,
  };
}

export function mcpConfigId(registryName: string): string {
  const slug =
    registryName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[^a-z0-9]+/u, "")
      .slice(0, 48) || "registry";
  const hash = createHash("sha256")
    .update(registryName)
    .digest("hex")
    .slice(0, 8);
  return `${slug}-${hash}`.slice(0, 64);
}

export function parseMcpCatalogResponse(value: unknown): McpCatalogItem[] {
  const servers = record(value)?.servers;
  if (!Array.isArray(servers)) {
    throw new Error("Official MCP Registry returned an invalid response.");
  }
  return servers.flatMap((entry) => {
    const parsed = parseRegistryServer(entry);
    if (!parsed) return [];
    const installOption = parsed.options[0];
    const installMode = !installOption
      ? ("unsupported" as const)
      : installOption.preview.inputs.length > 0
        ? ("needs-input" as const)
        : ("ready" as const);
    return [
      {
        configId: mcpConfigId(parsed.registryName),
        registryName: parsed.registryName,
        title: parsed.title,
        description: parsed.description,
        version: parsed.version,
        installable: Boolean(installOption),
        installMode,
        installed: false,
        ...(installOption ? { installOption: installOption.preview } : {}),
        ...(installOption?.kind === "remote" &&
        installOption.headers.length === 0
          ? { remoteUrl: installOption.url }
          : {}),
        ...(parsed.repositoryUrl
          ? { repositoryUrl: parsed.repositoryUrl }
          : {}),
        ...(!installOption
          ? {
              reason:
                parsed.reasons[0] ??
                "This server does not provide a supported installation option.",
            }
          : {}),
      },
    ];
  });
}
