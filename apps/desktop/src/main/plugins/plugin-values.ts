import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ArtemisPluginSource, McpServerConfig } from "../../shared/api.js";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

export function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

export function portableRelative(path: string): string {
  return path.split(sep).join("/");
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function safeSlug(value: string, fallback = "plugin"): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "") || fallback
  );
}

export function pluginSourceIdentity(source: ArtemisPluginSource): string {
  if (source.kind === "builtin") return `builtin\0${source.pluginName}`;
  if (source.kind === "local") return `local\0${source.path}`;
  if (source.kind === "bundled" || source.kind === "runtime") {
    // Preserve the legacy runtime identity so Lite updates do not duplicate an
    // already installed artifact plugin.
    return `runtime\0${source.pluginName}`;
  }
  return `git\0${source.marketplaceUrl}\0${source.marketplaceName}\0${source.pluginName}`;
}

export function pluginId(name: string, source: ArtemisPluginSource): string {
  const digest = createHash("sha256")
    .update(pluginSourceIdentity(source))
    .update("\0")
    .update(name)
    .digest("hex")
    .slice(0, 10);
  return `${safeSlug(name).slice(0, 50)}-${digest}`;
}

export function mcpConfigId(pluginIdentifier: string, name: string): string {
  const digest = createHash("sha256")
    .update(pluginIdentifier)
    .update("\0")
    .update(name)
    .digest("hex")
    .slice(0, 8);
  const prefix = `plugin-${safeSlug(name, "mcp")}`.slice(0, 54);
  return `${prefix}-${digest}`;
}

export function mcpStructuralHash(config: McpServerConfig): string {
  if (config.transport === "stdio") {
    return stableHash({
      id: config.id,
      name: config.name,
      transport: config.transport,
      command: config.command,
      args: config.args,
      workspacePath: config.workspacePath,
      connector: config.connector,
      ...(config.connector ? { env: config.env, envVars: config.envVars } : {}),
      resourceKind: config.resourceKind,
      connectorId: config.connectorId,
    });
  }
  return stableHash({
    id: config.id,
    name: config.name,
    transport: config.transport,
    url: config.url,
    resourceKind: config.resourceKind,
    connectorId: config.connectorId,
    connector: config.connector,
    auth: config.auth,
  });
}
