import { existsSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type { SandboxCommand, SandboxPolicy } from "@artemis/platform";
import type { McpServerConfig } from "../../shared/api.js";
import { macosAppRuntimeReadOnlyPaths } from "../platform/macos-app-runtime.js";
import { type McpExecutionScope } from "./mcp-connection-types.js";
export function resolvePosixExecutable(
  command: string,
  cwd: string,
  searchPath: string,
): string {
  if (isAbsolute(command)) return command;
  if (command.includes("/")) return resolve(cwd, command);
  for (const directory of searchPath.split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`MCP executable was not found on PATH: ${command}`);
}

export function canonicalExistingPath(
  platform: NodeJS.Platform,
  path: string,
): string {
  if (platform !== "darwin") return path;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function posixRuntimeReadRoot(path: string, homePath: string): string {
  if (path === "/opt/homebrew" || path.startsWith("/opt/homebrew/")) {
    return "/opt/homebrew";
  }
  if (path === "/usr/local" || path.startsWith("/usr/local/")) {
    return "/usr/local";
  }
  for (const directory of [
    join(homePath, ".local"),
    join(homePath, ".volta"),
    join(homePath, "Library", "pnpm"),
  ]) {
    if (pathIsInside(directory, path)) return directory;
  }
  const codeGraphVersions = join(homePath, ".codegraph", "versions");
  if (pathIsInside(codeGraphVersions, path)) {
    const version = relative(codeGraphVersions, path).split("/")[0];
    if (version) return join(codeGraphVersions, version);
  }
  const nvmVersion = path.match(/^(.+?\/\.nvm\/versions\/[^/]+\/[^/]+)/u);
  return nvmVersion?.[1] ?? path;
}

export function commandReadOnlyPaths(
  platform: NodeJS.Platform,
  command: SandboxCommand,
  homePath: string,
): string[] {
  const candidates = [
    command.executable,
    ...command.args.filter((argument) => isAbsolute(argument)),
  ];
  if (platform !== "win32") {
    for (const candidate of [...candidates]) {
      try {
        candidates.push(realpathSync(candidate));
      } catch {
        // The process spawn reports actionable missing-path errors.
      }
    }
  }
  const roots = [
    ...candidates.map((candidate) =>
      platform === "darwin"
        ? posixRuntimeReadRoot(candidate, homePath)
        : candidate,
    ),
    ...macosAppRuntimeReadOnlyPaths(platform, command.executable),
  ];
  if (platform === "darwin") {
    for (const root of [...roots]) {
      try {
        roots.push(realpathSync(root));
      } catch {
        // A missing declared argument is reported by the launched command.
      }
    }
  }
  return [...new Set(roots)];
}

export function resolveMcpSandboxPolicy(
  config: Extract<McpServerConfig, { transport: "stdio" }>,
  command: SandboxCommand,
  scope: McpExecutionScope | undefined,
  platform: NodeJS.Platform,
  homePath: string,
  runtimeDirectory: string,
  pluginReadOnlyPaths: readonly string[],
): SandboxPolicy {
  return {
    workspacePath: canonicalExistingPath(
      platform,
      scope?.workspacePath ?? config.workspacePath,
    ),
    mode: "work",
    network: config.allowNetwork ? "allow" : "deny",
    writablePaths: [canonicalExistingPath(platform, runtimeDirectory)],
    readOnlyPaths: [
      ...commandReadOnlyPaths(platform, command, homePath),
      ...pluginReadOnlyPaths.map((path) =>
        canonicalExistingPath(platform, path),
      ),
    ],
  };
}

export function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}
