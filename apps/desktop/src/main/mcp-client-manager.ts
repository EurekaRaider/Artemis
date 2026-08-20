import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildDesktopUserLaunch,
  buildSeatbeltLaunch,
  buildWindowsAppContainerLaunch,
} from "@artemis/platform";
import type {
  SandboxCommand,
  SandboxLaunch,
  SandboxPolicy,
} from "@artemis/platform";
import type {
  McpRuntimeTool,
  McpToolCallResult,
  McpToolResultContent,
  RunMode,
} from "@artemis/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpServerConfig, McpServerStatus } from "../shared/api.js";

interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  annotations?:
    | {
        readOnlyHint?: boolean | undefined;
        destructiveHint?: boolean | undefined;
      }
    | undefined;
}

interface McpCallResult {
  content?: unknown[];
  isError?: boolean;
}

export interface McpConnection {
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  }): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface McpConnectionAuthentication {
  bearerToken?: string;
  headers?: Record<string, string>;
  oauthProvider?: OAuthClientProvider;
  authorizationCode?: Promise<string>;
  stdioEnv?: Record<string, string>;
}

export interface McpExecutionScope {
  workspacePath: string;
  mode: Extract<RunMode, "execute">;
}

export interface McpConnectOptions {
  startupTimeoutMs?: number;
}

export type McpConnectionFactory = (
  config: McpServerConfig,
  authentication: McpConnectionAuthentication | undefined,
  scope?: McpExecutionScope,
) => Promise<McpConnection>;

interface ActiveConnection {
  config: McpServerConfig;
  authentication?: McpConnectionAuthentication;
  client: McpConnection;
  tools: McpRuntimeTool[];
}

interface ResolvedWindowsStdioCommand {
  executable: string;
  args: string[];
}

interface ResolvedWindowsStdioCommandDetails extends ResolvedWindowsStdioCommand {
  shimPath?: string;
}

type ResolveWindowsCommandShim = (
  shimPath: string,
  args: string[],
) => ResolvedWindowsStdioCommand | undefined;

const MAX_STDIO_STDERR_BYTES = 64 * 1024;
export const MCP_STARTUP_TIMEOUT_MS = 15_000;
const SECRET_ARGUMENTS = new Set([
  "--api-key",
  "--bearer-token",
  "--password",
  "--secret",
  "--token",
]);

function posixDesktopPath(
  platform: NodeJS.Platform,
  homePath: string,
  inheritedPath: string | undefined,
): string {
  const entries = [
    ...(inheritedPath?.split(":") ?? []),
    join(homePath, ".local", "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(Boolean);
  return [...new Set(entries)].join(":");
}

function inheritedEnvironment(names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return typeof value === "string" ? [[name, value]] : [];
    }),
  );
}

function stdioBaseEnvironment(
  platform: NodeJS.Platform,
  fullAccess: boolean,
): Record<string, string> {
  if (fullAccess) {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  return inheritedEnvironment(
    platform === "win32"
      ? [
          "SystemRoot",
          "WINDIR",
          "ComSpec",
          "PATHEXT",
          "PATH",
          "Path",
          "LANG",
          "LC_ALL",
          "LC_CTYPE",
        ]
      : ["LANG", "LC_ALL", "LC_CTYPE"],
  );
}

function resolvePosixExecutable(
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

function canonicalExistingPath(
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

function posixRuntimeReadRoot(path: string, homePath: string): string {
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
  const nvmVersion = path.match(/^(.+?\/\.nvm\/versions\/[^/]+\/[^/]+)/u);
  return nvmVersion?.[1] ?? path;
}

function commandReadOnlyPaths(
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
  const roots = candidates.map((candidate) =>
    platform === "darwin"
      ? posixRuntimeReadRoot(candidate, homePath)
      : candidate,
  );
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

function resolveMcpSandboxPolicy(
  config: Extract<McpServerConfig, { transport: "stdio" }>,
  command: SandboxCommand,
  scope: McpExecutionScope | undefined,
  platform: NodeJS.Platform,
  homePath: string,
): SandboxPolicy {
  return {
    workspacePath: canonicalExistingPath(
      platform,
      scope?.workspacePath ?? config.workspacePath,
    ),
    mode: "execute",
    network: config.allowNetwork ? "allow" : "deny",
    writablePaths: [canonicalExistingPath(platform, config.workspacePath)],
    readOnlyPaths: commandReadOnlyPaths(platform, command, homePath),
  };
}

function resolveWindowsExecutable(command: string): string {
  if (isAbsolute(command) || win32.isAbsolute(command)) return command;
  if (command.includes("\\") || command.includes("/")) {
    return resolve(command);
  }
  try {
    const candidates = execFileSync("where.exe", [command], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/u)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    const preferredExtensions = [".exe", ".com", ".cmd", ".bat", ".ps1"];
    for (const extension of preferredExtensions) {
      const candidate = candidates.find(
        (value) => extname(value).toLowerCase() === extension,
      );
      if (candidate) return candidate;
    }
    if (candidates[0]) return candidates[0];
  } catch {
    // The actionable error below is more useful than where.exe's exit status.
  }
  throw new Error(`MCP executable was not found on PATH: ${command}`);
}

function resolveNpmCommandShim(
  shimPath: string,
  args: string[],
): ResolvedWindowsStdioCommand | undefined {
  const directory = dirname(shimPath);
  let scriptPath: string | undefined;
  if (basename(shimPath).toLowerCase() === "npx.cmd") {
    const candidate = join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );
    if (existsSync(candidate)) scriptPath = candidate;
  }
  if (!scriptPath) {
    try {
      const source = readFileSync(shimPath, "utf8");
      const match = source.match(/["']%dp0%[\\/]([^"']+?\.(?:c?js|mjs))["']/iu);
      if (match?.[1]) {
        const candidate = resolve(directory, ...match[1].split(/[\\/]+/u));
        if (existsSync(candidate)) scriptPath = candidate;
      }
    } catch {
      return undefined;
    }
  }
  if (!scriptPath) return undefined;
  if (basename(scriptPath).toLowerCase() === "npm-shim.js") {
    try {
      const packageRoot = dirname(scriptPath);
      const packageMetadata = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (
        typeof packageMetadata.name === "string" &&
        /^(?:@[^/]+\/)?codegraph$/u.test(packageMetadata.name)
      ) {
        const separator = packageMetadata.name.lastIndexOf("/");
        const scope =
          separator >= 0 ? packageMetadata.name.slice(0, separator) : "";
        const bundleRoot = join(
          packageRoot,
          "node_modules",
          ...(scope ? [scope] : []),
          "codegraph-win32-x64",
        );
        const bundledNode = join(bundleRoot, "node.exe");
        const bundledEntry = join(
          bundleRoot,
          "lib",
          "dist",
          "bin",
          "codegraph.js",
        );
        if (existsSync(bundledNode) && existsSync(bundledEntry)) {
          return {
            executable: bundledNode,
            args: ["--liftoff-only", bundledEntry, ...args],
          };
        }
      }
    } catch {
      // Fall back to the package's standard npm shim below.
    }
  }
  const adjacentNode = join(directory, "node.exe");
  const nodeExecutable = existsSync(adjacentNode)
    ? adjacentNode
    : resolveWindowsExecutable("node");
  return {
    executable: nodeExecutable,
    args: [scriptPath, ...args],
  };
}

function resolveWindowsStdioCommandDetails(
  command: string,
  args: string[],
  resolveExecutable: (command: string) => string,
  resolveCommandShim: ResolveWindowsCommandShim,
): ResolvedWindowsStdioCommandDetails {
  if (
    (isAbsolute(command) || win32.isAbsolute(command)) &&
    [".com", ".exe"].includes(extname(command).toLowerCase())
  ) {
    return { executable: command, args };
  }
  const executable = resolveExecutable(command);
  const extension = extname(executable).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    const direct = resolveCommandShim(executable, args);
    if (direct) {
      return { ...direct, shimPath: executable };
    }
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", executable, ...args],
      shimPath: executable,
    };
  }
  if (extension === ".ps1") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        executable,
        ...args,
      ],
      shimPath: executable,
    };
  }
  return { executable, args };
}

export function resolveWindowsStdioCommand(
  command: string,
  args: string[],
  resolveExecutable: (command: string) => string = resolveWindowsExecutable,
  resolveCommandShim: ResolveWindowsCommandShim = resolveNpmCommandShim,
): ResolvedWindowsStdioCommand {
  const resolved = resolveWindowsStdioCommandDetails(
    command,
    args,
    resolveExecutable,
    resolveCommandShim,
  );
  return { executable: resolved.executable, args: resolved.args };
}

function npxPackageInvocation(
  args: string[],
): { packageName: string; packageArgs: string[] } | undefined {
  const packageIndex = args.findIndex(
    (argument) => argument !== "--" && !argument.startsWith("-"),
  );
  if (packageIndex < 0) return undefined;
  const specification = args[packageIndex]!;
  const slash = specification.indexOf("/");
  const versionSeparator = specification.lastIndexOf("@");
  const packageName =
    versionSeparator > Math.max(0, slash)
      ? specification.slice(0, versionSeparator)
      : specification;
  if (!/^(?:@[-a-zA-Z0-9_.]+\/)?[-a-zA-Z0-9_.]+$/u.test(packageName)) {
    return undefined;
  }
  return {
    packageName,
    packageArgs: args.slice(packageIndex + 1),
  };
}

export async function resolveCachedNpxCommand(
  args: string[],
  cacheDirectory: string,
  nodeExecutable: string,
): Promise<ResolvedWindowsStdioCommand | undefined> {
  const invocation = npxPackageInvocation(args);
  if (!invocation) return undefined;
  let cacheEntries;
  try {
    cacheEntries = await readdir(join(cacheDirectory, "_npx"), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const cacheEntry of cacheEntries) {
    if (!cacheEntry.isDirectory()) continue;
    const packageDirectory = join(
      cacheDirectory,
      "_npx",
      cacheEntry.name,
      "node_modules",
      ...invocation.packageName.split("/"),
    );
    try {
      const metadata = JSON.parse(
        await readFile(join(packageDirectory, "package.json"), "utf8"),
      ) as { name?: unknown; bin?: unknown };
      if (metadata.name !== invocation.packageName) continue;
      const bin =
        typeof metadata.bin === "string"
          ? metadata.bin
          : metadata.bin &&
              typeof metadata.bin === "object" &&
              !Array.isArray(metadata.bin)
            ? Object.values(metadata.bin).find(
                (value): value is string => typeof value === "string",
              )
            : undefined;
      if (!bin) continue;
      const entryPath = resolve(packageDirectory, bin);
      if (
        !pathIsInside(packageDirectory, entryPath) ||
        !existsSync(entryPath)
      ) {
        continue;
      }
      return {
        executable: nodeExecutable,
        args: [entryPath, ...invocation.packageArgs],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function setEnvironmentDefault(
  environment: Record<string, string>,
  name: string,
  value: string,
): void {
  if (
    !Object.keys(environment).some(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    )
  ) {
    environment[name] = value;
  }
}

function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

async function stageNpxRuntime(
  resolved: ResolvedWindowsStdioCommandDetails,
  runtimeDirectory: string,
): Promise<ResolvedWindowsStdioCommandDetails> {
  if (
    !resolved.shimPath ||
    basename(resolved.shimPath).toLowerCase() !== "npx.cmd" ||
    !resolved.args[0]
  ) {
    return resolved;
  }
  const sourceRoot = join(dirname(resolved.shimPath), "node_modules", "npm");
  const sourceScript = resolved.args[0];
  if (!existsSync(sourceRoot) || !pathIsInside(sourceRoot, sourceScript)) {
    return resolved;
  }
  const destinationRoot = join(runtimeDirectory, "npm");
  const binaryDirectory = join(runtimeDirectory, "bin");
  const stagedNode = join(binaryDirectory, "node.exe");
  await mkdir(binaryDirectory, { recursive: true });
  if (!existsSync(stagedNode)) {
    await copyFile(resolved.executable, stagedNode);
  }
  if (!existsSync(join(destinationRoot, "package.json"))) {
    await cp(sourceRoot, destinationRoot, {
      recursive: true,
      force: true,
    });
  }
  return {
    executable: stagedNode,
    args: [
      join(destinationRoot, relative(sourceRoot, sourceScript)),
      ...resolved.args.slice(1),
    ],
  };
}

function withNodeResolutionArguments(
  executable: string,
  args: string[],
): string[] {
  if (basename(executable).toLowerCase() !== "node.exe") return args;
  const required = ["--preserve-symlinks", "--preserve-symlinks-main"];
  const entryIndex = args.findIndex(
    (argument) => isAbsolute(argument) && /\.(?:c?js|mjs)$/iu.test(argument),
  );
  const normalizedArgs =
    entryIndex >= 0 && args[entryIndex - 1] !== "--entry-url"
      ? [
          ...args.slice(0, entryIndex),
          "--entry-url",
          pathToFileURL(args[entryIndex]!).href,
          ...args.slice(entryIndex + 1),
        ]
      : args;
  return [
    ...required.filter((argument) => !normalizedArgs.includes(argument)),
    ...normalizedArgs,
  ];
}

function appendStderr(current: string, chunk: unknown): string {
  const next = `${current}${
    Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
  }`;
  return Buffer.byteLength(next, "utf8") <= MAX_STDIO_STDERR_BYTES
    ? next
    : Buffer.from(next, "utf8")
        .subarray(-MAX_STDIO_STDERR_BYTES)
        .toString("utf8");
}

function errorStderr(error: unknown): string {
  if (!error || typeof error !== "object" || !("stderr" in error)) return "";
  const stderr = error.stderr;
  if (typeof stderr === "string") return stderr.trim();
  if (Buffer.isBuffer(stderr)) return stderr.toString("utf8").trim();
  return "";
}

function displayCommand(config: McpServerConfig): string {
  if (config.transport !== "stdio") return "";
  let redactNext = false;
  const args = config.args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "<redacted>";
    }
    if (SECRET_ARGUMENTS.has(argument.toLowerCase())) {
      redactNext = true;
    }
    return argument;
  });
  return [config.command, ...args]
    .map((argument) =>
      /^[a-zA-Z0-9_@./:\\-]+$/u.test(argument)
        ? argument
        : JSON.stringify(argument),
    )
    .join(" ");
}

function connectionError(config: McpServerConfig, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (config.transport !== "stdio") return message;
  const stderr = errorStderr(error);
  return [
    `stdio MCP "${config.id}" failed while starting: ${displayCommand(config)}`,
    ...(stderr ? [`Process stderr: ${stderr}`] : [message]),
  ].join("\n");
}

async function connectStdioClient(
  client: Client,
  launch: SandboxLaunch,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: launch.executable,
    args: launch.args,
    cwd: launch.cwd,
    env: Object.fromEntries(
      Object.entries({
        ...(launch.env ?? {}),
        ARTEMIS_SANDBOX: launch.implementation,
      }).filter((entry) => typeof entry[1] === "string"),
    ) as Record<string, string>,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = appendStderr(stderr, chunk);
  });
  try {
    await client.connect(transport);
  } catch (error) {
    throw Object.assign(
      new Error(error instanceof Error ? error.message : String(error), {
        cause: error,
      }),
      { stderr },
    );
  }
}

function safeToolSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
}

function piToolName(serverId: string, toolName: string): string {
  return `${safeToolSegment(serverId)}_${safeToolSegment(toolName)}`;
}

const MAX_MCP_RESULT_TRANSFER_BYTES = 2 * 1024 * 1024;
const IMAGE_MIME_TYPE = /^image\/[a-z0-9.+-]{1,64}$/iu;

function contentType(item: unknown): string {
  if (
    item &&
    typeof item === "object" &&
    "type" in item &&
    typeof item.type === "string" &&
    item.type.trim()
  ) {
    return item.type.trim().slice(0, 64);
  }
  return "unknown";
}

function normalizeImageData(value: string):
  | {
      data: string;
      decodedBytes: number;
    }
  | undefined {
  const data = value.replaceAll(/\s/gu, "");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
    return undefined;
  }
  const decoded = Buffer.from(data, "base64");
  if (decoded.toString("base64") !== data) return undefined;
  return { data, decodedBytes: decoded.byteLength };
}

function formatMcpResult(result: McpCallResult): McpToolCallResult {
  const content: McpToolResultContent[] = [];
  let transferBytes = 0;
  let textBytes = 0;
  let imageBytes = 0;
  let imageCount = 0;
  let omittedContentCount = 0;
  const addText = (text: string) => {
    const bytes = Buffer.byteLength(text, "utf8");
    transferBytes += bytes;
    textBytes += bytes;
    content.push({ type: "text", text });
  };

  for (const item of result.content ?? []) {
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      addText(item.text);
      continue;
    }
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "image" &&
      "data" in item &&
      typeof item.data === "string" &&
      "mimeType" in item &&
      typeof item.mimeType === "string" &&
      IMAGE_MIME_TYPE.test(item.mimeType)
    ) {
      const image = normalizeImageData(item.data);
      if (image) {
        transferBytes += Buffer.byteLength(image.data, "ascii");
        imageBytes += image.decodedBytes;
        imageCount += 1;
        content.push({
          type: "image",
          data: image.data,
          mimeType: item.mimeType.toLowerCase(),
        });
        continue;
      }
    }
    omittedContentCount += 1;
    addText(`[Unsupported MCP content omitted: ${contentType(item)}]`);
  }

  if (transferBytes > MAX_MCP_RESULT_TRANSFER_BYTES) {
    throw new Error("MCP tool output exceeds 2 MiB");
  }
  return {
    content,
    isError: Boolean(result.isError),
    metrics: {
      textBytes,
      imageBytes,
      imageCount,
      omittedContentCount,
    },
  };
}

export class McpClientManager {
  private readonly active = new Map<string, ActiveConnection>();
  private readonly scoped = new Map<string, Promise<ActiveConnection>>();
  private readonly statuses = new Map<string, McpServerStatus>();

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly windowsHelperPath: string | undefined,
    private readonly factory: McpConnectionFactory = async (
      config,
      authentication,
      scope,
    ) => {
      let client = new Client({
        name: "Artemis",
        version: "1.4.8",
      });
      if (config.transport === "stdio") {
        const runtimeWorkspacePath = canonicalExistingPath(
          this.platform,
          config.workspacePath,
        );
        const executionWorkspacePath = canonicalExistingPath(
          this.platform,
          scope?.workspacePath ?? config.workspacePath,
        );
        const commandArguments =
          this.platform === "win32" &&
          basename(config.command).toLowerCase() === "node.exe"
            ? [
                "--preserve-symlinks",
                "--preserve-symlinks-main",
                ...config.args,
              ]
            : config.args;
        const forwardedEnvironment = Object.fromEntries(
          config.envVars.flatMap((name) => {
            const value = process.env[name];
            return typeof value === "string" ? [[name, value]] : [];
          }),
        );
        const commandEnvironment = {
          ...stdioBaseEnvironment(this.platform, Boolean(config.fullAccess)),
          ...forwardedEnvironment,
          ...config.env,
          ...(authentication?.stdioEnv ?? {}),
        };
        const explicitlyConfiguresPath = Object.keys({
          ...forwardedEnvironment,
          ...config.env,
          ...(authentication?.stdioEnv ?? {}),
        }).some((name) => name.toLowerCase() === "path");
        if (this.platform !== "win32" && !explicitlyConfiguresPath) {
          // Finder-launched apps do not load shell profiles such as .zshrc.
          commandEnvironment.PATH = posixDesktopPath(
            this.platform,
            commandEnvironment.HOME ?? process.env.HOME ?? homedir(),
            process.env.PATH,
          );
        }
        let command: SandboxCommand = {
          executable: config.command,
          args: commandArguments,
          cwd: executionWorkspacePath,
          env: commandEnvironment,
        };
        const runtimeDirectory = join(runtimeWorkspacePath, ".artemis-mcp");
        const temporaryDirectory = join(runtimeDirectory, "tmp");
        const npmCacheDirectory = join(runtimeDirectory, "npm-cache");
        if (!config.fullAccess) {
          const homeDirectory = join(runtimeDirectory, "home");
          await Promise.all([
            mkdir(temporaryDirectory, { recursive: true }),
            mkdir(npmCacheDirectory, { recursive: true }),
            mkdir(homeDirectory, { recursive: true }),
          ]);
          setEnvironmentDefault(commandEnvironment, "HOME", homeDirectory);
          setEnvironmentDefault(
            commandEnvironment,
            "TMPDIR",
            temporaryDirectory,
          );
          setEnvironmentDefault(commandEnvironment, "TEMP", temporaryDirectory);
          setEnvironmentDefault(commandEnvironment, "TMP", temporaryDirectory);
          setEnvironmentDefault(
            commandEnvironment,
            "NPM_CONFIG_CACHE",
            npmCacheDirectory,
          );
          if (this.platform === "win32") {
            const roamingDirectory = join(
              runtimeDirectory,
              "appdata",
              "roaming",
            );
            const localDirectory = join(runtimeDirectory, "appdata", "local");
            await Promise.all([
              mkdir(roamingDirectory, { recursive: true }),
              mkdir(localDirectory, { recursive: true }),
            ]);
            setEnvironmentDefault(
              commandEnvironment,
              "USERPROFILE",
              homeDirectory,
            );
            setEnvironmentDefault(
              commandEnvironment,
              "APPDATA",
              roamingDirectory,
            );
            setEnvironmentDefault(
              commandEnvironment,
              "LOCALAPPDATA",
              localDirectory,
            );
          }
        }
        let npxRuntime:
          | {
              cacheDirectory: string;
              nodeExecutable: string;
              usedCachedCommand: boolean;
            }
          | undefined;
        if (this.platform === "win32") {
          let resolved = resolveWindowsStdioCommandDetails(
            command.executable,
            command.args,
            resolveWindowsExecutable,
            resolveNpmCommandShim,
          );
          const isolatesUserProfile = Boolean(
            resolved.shimPath &&
            !pathIsInside(runtimeWorkspacePath, dirname(resolved.shimPath)),
          );
          const stagesNpxRuntime =
            basename(resolved.shimPath ?? "").toLowerCase() === "npx.cmd";
          await mkdir(temporaryDirectory, { recursive: true });
          await mkdir(npmCacheDirectory, { recursive: true });
          resolved = await stageNpxRuntime(resolved, runtimeDirectory);
          if (stagesNpxRuntime) {
            const cachedCommand = await resolveCachedNpxCommand(
              config.args,
              npmCacheDirectory,
              resolved.executable,
            );
            npxRuntime = {
              cacheDirectory: npmCacheDirectory,
              nodeExecutable: resolved.executable,
              usedCachedCommand: Boolean(cachedCommand),
            };
            if (cachedCommand) resolved = cachedCommand;
            const inheritedPath =
              commandEnvironment.PATH ??
              commandEnvironment.Path ??
              process.env.PATH ??
              "";
            commandEnvironment.PATH = [
              dirname(resolved.executable),
              inheritedPath,
            ]
              .filter(Boolean)
              .join(delimiter);
          }
          setEnvironmentDefault(commandEnvironment, "TEMP", temporaryDirectory);
          setEnvironmentDefault(commandEnvironment, "TMP", temporaryDirectory);
          setEnvironmentDefault(
            commandEnvironment,
            "NPM_CONFIG_CACHE",
            npmCacheDirectory,
          );
          if (isolatesUserProfile && config.fullAccess) {
            const homeDirectory = join(runtimeDirectory, "home");
            const roamingDirectory = join(
              runtimeDirectory,
              "appdata",
              "roaming",
            );
            const localDirectory = join(runtimeDirectory, "appdata", "local");
            await mkdir(homeDirectory, { recursive: true });
            await mkdir(roamingDirectory, { recursive: true });
            await mkdir(localDirectory, { recursive: true });
            setEnvironmentDefault(commandEnvironment, "HOME", homeDirectory);
            setEnvironmentDefault(
              commandEnvironment,
              "USERPROFILE",
              homeDirectory,
            );
            setEnvironmentDefault(
              commandEnvironment,
              "APPDATA",
              roamingDirectory,
            );
            setEnvironmentDefault(
              commandEnvironment,
              "LOCALAPPDATA",
              localDirectory,
            );
          }
          command = {
            ...command,
            executable: resolved.executable,
            args: withNodeResolutionArguments(
              resolved.executable,
              resolved.args,
            ),
          };
        } else {
          command = {
            ...command,
            executable: canonicalExistingPath(
              this.platform,
              resolvePosixExecutable(
                command.executable,
                command.cwd,
                commandEnvironment.PATH ?? "",
              ),
            ),
            args: command.args.map((argument) =>
              isAbsolute(argument)
                ? canonicalExistingPath(this.platform, argument)
                : argument,
            ),
          };
        }
        const buildLaunch = (sandboxCommand: SandboxCommand) => {
          if (config.fullAccess) return buildDesktopUserLaunch(sandboxCommand);
          const policy = resolveMcpSandboxPolicy(
            config,
            sandboxCommand,
            scope,
            this.platform,
            process.env.HOME ?? homedir(),
          );
          if (this.platform === "darwin") {
            return buildSeatbeltLaunch(sandboxCommand, policy);
          }
          if (this.platform === "win32" && this.windowsHelperPath) {
            return buildWindowsAppContainerLaunch(sandboxCommand, policy, {
              helperPath: this.windowsHelperPath,
              identity: `Artemis.Mcp.${safeToolSegment(config.id)}`,
            });
          }
          throw new Error(
            `Local MCP sandbox is unavailable on ${this.platform}; enable full local access only for a trusted server.`,
          );
        };
        try {
          await connectStdioClient(client, buildLaunch(command));
        } catch (error) {
          if (!npxRuntime || npxRuntime.usedCachedCommand) throw error;
          const cachedCommand = await resolveCachedNpxCommand(
            config.args,
            npxRuntime.cacheDirectory,
            npxRuntime.nodeExecutable,
          );
          if (!cachedCommand) throw error;
          try {
            await client.close();
          } catch {
            // A failed npx bootstrap may already have closed its transport.
          }
          client = new Client({
            name: "Artemis",
            version: "1.4.8",
          });
          command = {
            ...command,
            executable: cachedCommand.executable,
            args: withNodeResolutionArguments(
              cachedCommand.executable,
              cachedCommand.args,
            ),
          };
          await connectStdioClient(client, buildLaunch(command));
        }
      } else {
        const requestHeaders =
          authentication?.headers ??
          (authentication?.bearerToken
            ? { Authorization: `Bearer ${authentication.bearerToken}` }
            : undefined);
        const createTransport = () =>
          new StreamableHTTPClientTransport(new URL(config.url), {
            ...(requestHeaders
              ? {
                  requestInit: {
                    headers: requestHeaders,
                  },
                }
              : {}),
            ...(authentication?.oauthProvider
              ? { authProvider: authentication.oauthProvider }
              : {}),
          });
        let transport = createTransport();
        try {
          // SDK 1.29 declares `sessionId?: string` without explicit undefined,
          // which conflicts with consumers using exactOptionalPropertyTypes.
          await client.connect(transport as Parameters<Client["connect"]>[0]);
        } catch (error) {
          if (
            !(error instanceof UnauthorizedError) ||
            !authentication?.oauthProvider ||
            !authentication.authorizationCode
          ) {
            throw error;
          }
          await transport.finishAuth(await authentication.authorizationCode);
          try {
            await client.close();
          } catch {
            // A failed initial OAuth connection may not have an open transport.
          }
          client = new Client({
            name: "Artemis",
            version: "1.4.8",
          });
          transport = createTransport();
          await client.connect(transport as Parameters<Client["connect"]>[0]);
        }
      }
      return {
        async listTools() {
          const result = await client.listTools();
          return {
            tools: result.tools.map((tool) => ({
              name: tool.name,
              ...(tool.description === undefined
                ? {}
                : { description: tool.description }),
              inputSchema: tool.inputSchema,
              ...(tool.annotations === undefined
                ? {}
                : {
                    annotations: {
                      readOnlyHint: tool.annotations.readOnlyHint,
                      destructiveHint: tool.annotations.destructiveHint,
                    },
                  }),
            })),
          };
        },
        async callTool(input) {
          const result = await client.callTool(input);
          return {
            content: result.content as unknown[],
            isError: Boolean(result.isError),
          };
        },
        close: () => client.close(),
      };
    },
    private readonly startupTimeoutMs = MCP_STARTUP_TIMEOUT_MS,
  ) {}

  private withStartupDeadline<T>(
    promise: Promise<T>,
    serverId: string,
    stage: "connection" | "listTools",
    startupTimeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(
          new Error(
            `MCP server ${serverId} ${stage} timed out after ${startupTimeoutMs} ms.`,
          ),
        );
      }, startupTimeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      );
    });
  }

  private async startConnection(
    config: McpServerConfig,
    authentication: McpConnectionAuthentication | undefined,
    scope?: McpExecutionScope,
    startupTimeoutMs = this.startupTimeoutMs,
  ): Promise<{ client: McpConnection; listed: { tools: McpTool[] } }> {
    const clientPromise = this.factory(config, authentication, scope);
    let client: McpConnection;
    try {
      client = await this.withStartupDeadline(
        clientPromise,
        config.id,
        "connection",
        startupTimeoutMs,
      );
    } catch (error) {
      void clientPromise
        .then((lateClient) => lateClient.close())
        .catch(() => undefined);
      throw error;
    }
    try {
      const listed = await this.withStartupDeadline(
        client.listTools(),
        config.id,
        "listTools",
        startupTimeoutMs,
      );
      return { client, listed };
    } catch (error) {
      void client.close().catch(() => undefined);
      throw error;
    }
  }

  async connect(
    config: McpServerConfig,
    authentication?: string | McpConnectionAuthentication,
    options: McpConnectOptions = {},
  ): Promise<McpServerStatus> {
    await this.disconnect(config.id);
    const resolvedAuthentication =
      typeof authentication === "string"
        ? { bearerToken: authentication }
        : authentication;
    this.statuses.set(config.id, {
      config: structuredClone(config),
      state: resolvedAuthentication?.authorizationCode
        ? "authorizing"
        : "connecting",
      tools: [],
    });
    try {
      const { client, listed } = await this.startConnection(
        config,
        resolvedAuthentication,
        undefined,
        options.startupTimeoutMs ?? this.startupTimeoutMs,
      );
      const tools = listed.tools.map((tool) => ({
        serverId: config.id,
        serverName: config.name,
        transport: config.transport,
        piName: piToolName(config.id, tool.name),
        toolName: tool.name,
        description: tool.description ?? `${config.name} MCP tool`,
        inputSchema: tool.inputSchema,
        readOnly: Boolean(tool.annotations?.readOnlyHint),
        destructive: Boolean(tool.annotations?.destructiveHint),
      }));
      this.active.set(config.id, {
        config,
        ...(resolvedAuthentication
          ? { authentication: resolvedAuthentication }
          : {}),
        client,
        tools,
      });
      const status: McpServerStatus = {
        config: structuredClone(config),
        state: "connected",
        tools: structuredClone(tools),
      };
      this.statuses.set(config.id, status);
      return status;
    } catch (error) {
      const status: McpServerStatus = {
        config: structuredClone(config),
        state:
          error instanceof UnauthorizedError &&
          resolvedAuthentication?.oauthProvider
            ? "authorization-required"
            : "failed",
        ...(error instanceof UnauthorizedError &&
        resolvedAuthentication?.oauthProvider
          ? {}
          : {
              error: connectionError(config, error),
            }),
        tools: [],
      };
      this.statuses.set(config.id, status);
      return status;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const active = this.active.get(serverId);
    this.active.delete(serverId);
    const scoped = [...this.scoped.entries()].filter(([key]) =>
      key.startsWith(`${serverId}\0`),
    );
    for (const [key] of scoped) this.scoped.delete(key);
    if (active) {
      await active.client.close();
    }
    await Promise.all(
      scoped.map(async ([, connection]) => {
        try {
          await (await connection).client.close();
        } catch {
          // Failed scoped connections have no live transport to close.
        }
      }),
    );
    const current = this.statuses.get(serverId);
    if (current) {
      this.statuses.set(serverId, {
        config: current.config,
        state: "disconnected",
        tools: [],
      });
    }
  }

  async call(
    serverId: string,
    toolName: string,
    argumentsValue: Record<string, unknown>,
    workspacePath?: string,
    mode: Extract<RunMode, "execute"> = "execute",
    privateMetadata?: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const active = this.active.get(serverId);
    if (!active) {
      throw new Error("MCP server is not connected");
    }
    if (!active.tools.some((tool) => tool.toolName === toolName)) {
      throw new Error("MCP tool is not advertised by the connected server");
    }
    const connection =
      active.config.transport === "stdio" && workspacePath
        ? await this.scopedConnection(active, workspacePath, mode)
        : active;
    if (!connection.tools.some((tool) => tool.toolName === toolName)) {
      throw new Error("MCP tool is not advertised by the scoped server");
    }
    return formatMcpResult(
      await connection.client.callTool({
        name: toolName,
        arguments: argumentsValue,
        ...(privateMetadata ? { _meta: privateMetadata } : {}),
      }),
    );
  }

  private async scopedConnection(
    active: ActiveConnection,
    workspacePath: string,
    mode: Extract<RunMode, "execute">,
  ): Promise<ActiveConnection> {
    if (active.config.transport !== "stdio") return active;
    const normalizedWorkspace = resolve(workspacePath);
    const comparableWorkspace =
      this.platform === "win32"
        ? normalizedWorkspace.toLowerCase()
        : normalizedWorkspace;
    const runtimeWorkspace = resolve(active.config.workspacePath);
    const comparableRuntime =
      this.platform === "win32"
        ? runtimeWorkspace.toLowerCase()
        : runtimeWorkspace;
    if (comparableWorkspace === comparableRuntime) {
      return active;
    }

    const key = `${active.config.id}\0${comparableWorkspace}`;
    const existing = this.scoped.get(key);
    if (existing) return existing;

    const pending = (async () => {
      const { client, listed } = await this.startConnection(
        active.config,
        active.authentication,
        {
          workspacePath: normalizedWorkspace,
          mode,
        },
      );
      try {
        const tools = listed.tools.map((tool) => ({
          serverId: active.config.id,
          serverName: active.config.name,
          transport: active.config.transport,
          piName: piToolName(active.config.id, tool.name),
          toolName: tool.name,
          description: tool.description ?? `${active.config.name} MCP tool`,
          inputSchema: tool.inputSchema,
          readOnly: Boolean(tool.annotations?.readOnlyHint),
          destructive: Boolean(tool.annotations?.destructiveHint),
        }));
        return {
          config: active.config,
          ...(active.authentication
            ? { authentication: active.authentication }
            : {}),
          client,
          tools,
        };
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    this.scoped.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.scoped.delete(key);
      throw error;
    }
  }

  tools(): McpRuntimeTool[] {
    return [...this.active.values()].flatMap((connection) =>
      structuredClone(connection.tools),
    );
  }

  status(configs: McpServerConfig[]): McpServerStatus[] {
    return configs.map(
      (config) =>
        this.statuses.get(config.id) ?? {
          config: structuredClone(config),
          state: "disconnected",
          tools: [],
        },
    );
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.disconnect(id)));
  }
}
