import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

import * as mcpClientManagerModule from "../src/main/mcp-client-manager.js";
import {
  McpClientManager,
  type McpConnection,
  type McpExecutionScope,
} from "../src/main/mcp-client-manager.js";
import type { McpServerConfig } from "../src/main/mcp-config-store.js";

interface ResolvedWindowsStdioCommand {
  executable: string;
  args: string[];
}

const WINDOWS_APP_CONTAINER_COLD_START_TIMEOUT_MS = 90_000;
const WINDOWS_APP_CONTAINER_DISPOSE_TIMEOUT_MS = 30_000;
const WINDOWS_APP_CONTAINER_DIRECTORY_CLEANUP_TIMEOUT_MS = 30_000;
const WINDOWS_APP_CONTAINER_CLEANUP_RETRY_DELAY_MS = 100;
const WINDOWS_APP_CONTAINER_DIAGNOSTIC_TIMEOUT_MS = 60_000;

async function withWindowsFixtureDeadline<T>(
  stage: string,
  promise: Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Windows AppContainer ${stage} timed out`)),
          WINDOWS_APP_CONTAINER_COLD_START_TIMEOUT_MS + 5_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type ResolveWindowsStdioCommand = (
  command: string,
  args: string[],
  resolveExecutable?: (command: string) => string,
  resolveCommandShim?: (
    shimPath: string,
    args: string[],
  ) => ResolvedWindowsStdioCommand | undefined,
) => ResolvedWindowsStdioCommand;

type ResolveCachedNpxCommand = (
  args: string[],
  cacheDirectory: string,
  nodeExecutable: string,
) => Promise<ResolvedWindowsStdioCommand | undefined>;

const resolveWindowsStdioCommand = (
  mcpClientManagerModule as typeof mcpClientManagerModule & {
    resolveWindowsStdioCommand?: ResolveWindowsStdioCommand;
  }
).resolveWindowsStdioCommand;
const resolveCachedNpxCommand = (
  mcpClientManagerModule as typeof mcpClientManagerModule & {
    resolveCachedNpxCommand?: ResolveCachedNpxCommand;
  }
).resolveCachedNpxCommand;
const mcpClientManagerSource = readFileSync(
  new URL("../src/main/mcp-client-manager.ts", import.meta.url),
  "utf8",
);
const mainProcessSource = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const protocolHostMessagesSource = readFileSync(
  new URL("../../../packages/protocol/src/host-messages.ts", import.meta.url),
  "utf8",
);
const agentRuntimeSource = readFileSync(
  new URL("../../../packages/agent-host/src/runtime.ts", import.meta.url),
  "utf8",
);

const config: McpServerConfig = {
  id: "test-server",
  name: "Test server",
  transport: "streamable-http",
  enabled: true,
  url: "https://example.test/mcp",
};

function resultText(
  result: Awaited<ReturnType<McpClientManager["call"]>>,
): string {
  return result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("");
}

async function describeWindowsFixture(
  workspacePath: string,
  fixtureStartedPath: string,
): Promise<string> {
  if (!existsSync(workspacePath)) return "fixture workspace already removed";
  const fixture = await readFile(fixtureStartedPath, "utf8").catch(
    () => "fixture module did not start",
  );
  const runtimeEntries = await readdir(join(workspacePath, ".artemis-mcp"), {
    recursive: true,
  }).catch(() => []);
  return `${fixture}; runtime entries: ${runtimeEntries.join(", ") || "none"}`;
}

function windowsProcessStatus(processId: unknown): string {
  if (typeof processId !== "number") return "unknown";
  try {
    process.kill(processId, 0);
    return "running";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" ? "exited" : `unavailable (${code ?? "error"})`;
  }
}

interface WindowsFixtureProcesses {
  pid?: number;
  ppid?: number;
}

async function readWindowsFixtureProcesses(
  directory: string,
): Promise<WindowsFixtureProcesses | undefined> {
  try {
    return JSON.parse(
      await readFile(join(directory, ".fixture-started.json"), "utf8"),
    ) as WindowsFixtureProcesses;
  } catch {
    return undefined;
  }
}

const RETRYABLE_WINDOWS_FIXTURE_CLEANUP_ERRORS = new Set([
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
]);

class WindowsFixtureCleanupPathError extends Error {
  constructor(
    readonly target: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

async function runWindowsFixtureCleanupOperation<T>(
  target: string,
  deadline: number,
  operation: () => Promise<T>,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new WindowsFixtureCleanupPathError(
      target,
      `Windows fixture cleanup deadline expired: ${target}`,
    );
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new WindowsFixtureCleanupPathError(
                target,
                `Windows fixture filesystem operation timed out: ${target}`,
              ),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function retryWindowsFixtureCleanup<T>(
  target: string,
  deadline: number,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  while (true) {
    try {
      return await runWindowsFixtureCleanupOperation(
        target,
        deadline,
        operation,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      if (!existsSync(target)) return undefined;
      if (
        !code ||
        !RETRYABLE_WINDOWS_FIXTURE_CLEANUP_ERRORS.has(code) ||
        Date.now() >= deadline
      ) {
        throw new WindowsFixtureCleanupPathError(
          target,
          `Failed to remove Windows fixture path: ${target}`,
          { cause: error },
        );
      }
      await new Promise((resolvePromise) =>
        setTimeout(
          resolvePromise,
          WINDOWS_APP_CONTAINER_CLEANUP_RETRY_DELAY_MS,
        ),
      );
    }
  }
}

async function waitForWindowsFixturePathRemoval(
  target: string,
  deadline: number,
): Promise<void> {
  while (existsSync(target)) {
    if (Date.now() >= deadline) {
      throw new WindowsFixtureCleanupPathError(
        target,
        `Windows fixture path remains delete-pending: ${target}`,
      );
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, WINDOWS_APP_CONTAINER_CLEANUP_RETRY_DELAY_MS),
    );
  }
}

async function removeWindowsFixtureTree(
  target: string,
  deadline: number,
): Promise<void> {
  const stats = await retryWindowsFixtureCleanup(target, deadline, () =>
    lstat(target),
  );
  if (!stats) return;

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    await retryWindowsFixtureCleanup(target, deadline, () => unlink(target));
    await waitForWindowsFixturePathRemoval(target, deadline);
    return;
  }

  const entries = await retryWindowsFixtureCleanup(target, deadline, () =>
    readdir(target),
  );
  if (!entries) return;
  await Promise.all(
    entries.map((entry) =>
      removeWindowsFixtureTree(join(target, entry), deadline),
    ),
  );
  await retryWindowsFixtureCleanup(target, deadline, () => rmdir(target));
  await waitForWindowsFixturePathRemoval(target, deadline);
}

async function describeWindowsCleanupTarget(
  directory: string,
  fixture: WindowsFixtureProcesses | undefined,
): Promise<string> {
  const entries = await readdir(directory, { recursive: true }).catch(() => []);
  const fixtureProcesses = fixture
    ? [
        `child ${String(fixture.pid)}: ${windowsProcessStatus(fixture.pid)}`,
        `wrapper ${String(fixture.ppid)}: ${windowsProcessStatus(fixture.ppid)}`,
      ].join(", ")
    : "fixture marker unavailable before disposal";
  let matchingProcesses = "unavailable";
  let accessControl = "unavailable";
  let pathMetadata = "unavailable";
  let lstatStatus = "unavailable";
  let lstatTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const stats = await Promise.race([
      lstat(directory),
      new Promise<never>((_resolve, reject) => {
        lstatTimeout = setTimeout(
          () => reject(new Error("lstat diagnostic timed out")),
          5_000,
        );
      }),
    ]);
    lstatStatus = JSON.stringify({
      directory: stats.isDirectory(),
      file: stats.isFile(),
      mode: stats.mode,
      symbolicLink: stats.isSymbolicLink(),
    });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    lstatStatus = `${nodeError.code ?? "error"}: ${nodeError.message}`;
  } finally {
    if (lstatTimeout) clearTimeout(lstatTimeout);
  }
  if (process.platform === "win32") {
    try {
      matchingProcesses =
        execFileSync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$target = $env:ARTEMIS_MCP_DIAGNOSTIC_PATH; @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine) | ConvertTo-Json -Compress",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              ARTEMIS_MCP_DIAGNOSTIC_PATH: directory,
            },
            timeout: 5_000,
            windowsHide: true,
          },
        ).trim() || "none";
    } catch (error) {
      matchingProcesses =
        error instanceof Error ? error.message : String(error);
    }
    try {
      accessControl = execFileSync("icacls.exe", [directory], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      }).trim();
    } catch (error) {
      accessControl = error instanceof Error ? error.message : String(error);
    }
    try {
      pathMetadata = execFileSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$target = $env:ARTEMIS_MCP_DIAGNOSTIC_PATH; if (Test-Path -LiteralPath $target) { $item = Get-Item -LiteralPath $target -Force; $acl = Get-Acl -LiteralPath $target; [pscustomobject]@{ Exists = $true; Owner = $acl.Owner; Attributes = $item.Attributes.ToString(); LinkType = $item.LinkType; Mode = $item.Mode; FullName = $item.FullName } | ConvertTo-Json -Compress } else { [pscustomobject]@{ Exists = $false } | ConvertTo-Json -Compress }",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ARTEMIS_MCP_DIAGNOSTIC_PATH: directory,
          },
          timeout: 5_000,
          windowsHide: true,
        },
      ).trim();
    } catch (error) {
      pathMetadata = error instanceof Error ? error.message : String(error);
    }
  }
  return [
    `remaining entries: ${entries.slice(0, 100).join(", ") || "none"}`,
    fixtureProcesses,
    `lstat: ${lstatStatus}`,
    `metadata: ${pathMetadata}`,
    `matching processes: ${matchingProcesses}`,
    `ACL: ${accessControl}`,
  ].join("; ");
}

async function cleanupWindowsAppContainerFixture(
  manager: McpClientManager,
  directories: readonly string[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  const fixtureProcesses = new Map<string, WindowsFixtureProcesses | undefined>(
    await Promise.all(
      directories.map(async (directory) => [
        directory,
        await readWindowsFixtureProcesses(directory),
      ]),
    ),
  );
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        manager.dispose(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("MCP fixture disposal timed out")),
            WINDOWS_APP_CONTAINER_DISPOSE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch (error) {
    failures.push(error);
  }
  const results = await Promise.all(
    directories.map(async (directory) => {
      try {
        await removeWindowsFixtureTree(
          directory,
          Date.now() + WINDOWS_APP_CONTAINER_DIRECTORY_CLEANUP_TIMEOUT_MS,
        );
        if (!existsSync(directory)) return undefined;
        return new Error(
          `MCP fixture directory cleanup did not remove: ${directory}\n${await describeWindowsCleanupTarget(directory, fixtureProcesses.get(directory))}`,
        );
      } catch (error) {
        const diagnosticTarget =
          error instanceof WindowsFixtureCleanupPathError
            ? error.target
            : directory;
        const targetDiagnostic =
          diagnosticTarget === directory
            ? ""
            : `\nTarget diagnostics (${diagnosticTarget}): ${await describeWindowsCleanupTarget(diagnosticTarget, undefined)}`;
        return new Error(
          `Failed to remove MCP fixture directory: ${directory}${targetDiagnostic}\nRoot diagnostics: ${await describeWindowsCleanupTarget(directory, fixtureProcesses.get(directory))}`,
          {
            cause: error,
          },
        );
      }
    }),
  );
  for (const result of results) {
    if (result) failures.push(result);
  }
  return failures;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("McpClientManager", () => {
  it.each([
    {
      command: "npx",
      shim: "C:\\Users\\test\\AppData\\Roaming\\npm\\npx.cmd",
      node: "C:\\Program Files\\nodejs\\node.exe",
      script: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js",
      args: ["-y", "@upstash/context7-mcp@latest"],
    },
    {
      command: "codegraph",
      shim: "C:\\Users\\test\\AppData\\Roaming\\npm\\codegraph.cmd",
      node: "C:\\Program Files\\nodejs\\node.exe",
      script:
        "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@colbymchenry\\codegraph\\npm-shim.js",
      args: ["serve", "--mcp"],
    },
  ])(
    "resolves the Windows $command npm shim to node without a command shell",
    ({ command, shim, node, script, args }) => {
      expect(resolveWindowsStdioCommand).toBeTypeOf("function");
      if (!resolveWindowsStdioCommand) return;

      expect(
        resolveWindowsStdioCommand(
          command,
          args,
          () => shim,
          (_shimPath, shimArgs) => ({
            executable: node,
            args: [script, ...shimArgs],
          }),
        ),
      ).toEqual({
        executable: node,
        args: [script, ...args],
      });
    },
  );

  it("keeps an absolute Windows .exe command and arguments unchanged", () => {
    const executable = "C:\\Program Files\\nodejs\\node.exe";
    const args = ["server.mjs", "--stdio"];

    expect(resolveWindowsStdioCommand).toBeTypeOf("function");
    if (!resolveWindowsStdioCommand) return;

    expect(
      resolveWindowsStdioCommand(executable, args, () => {
        throw new Error("absolute executables do not require PATH lookup");
      }),
    ).toEqual({ executable, args });
  });

  it("resolves a cached npx package bin directly with its remaining arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-npx-cache-"));
    try {
      const packageDirectory = join(
        directory,
        "_npx",
        "cache-key",
        "node_modules",
        "@scope",
        "server",
      );
      const entryPath = join(packageDirectory, "dist", "index.js");
      await mkdir(dirname(entryPath), { recursive: true });
      await writeFile(
        join(packageDirectory, "package.json"),
        JSON.stringify({
          name: "@scope/server",
          bin: { server: "dist/index.js" },
        }),
        "utf8",
      );
      await writeFile(entryPath, "", "utf8");

      expect(resolveCachedNpxCommand).toBeTypeOf("function");
      if (!resolveCachedNpxCommand) return;
      await expect(
        resolveCachedNpxCommand(
          ["-y", "@scope/server@latest", "--api-key", "test"],
          directory,
          "C:\\runtime\\node.exe",
        ),
      ).resolves.toEqual({
        executable: "C:\\runtime\\node.exe",
        args: [entryPath, "--api-key", "test"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("parses npm-generated npx and package shims into direct node launches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-npm-shims-"));
    try {
      const nodePath = join(directory, "node.exe");
      const npxPath = join(directory, "npx.cmd");
      const npxScript = join(
        directory,
        "node_modules",
        "npm",
        "bin",
        "npx-cli.js",
      );
      const packagePath = join(directory, "codegraph.cmd");
      const packageScript = join(
        directory,
        "node_modules",
        "@scope",
        "codegraph",
        "npm-shim.js",
      );
      const bundledNode = join(
        dirname(packageScript),
        "node_modules",
        "@scope",
        "codegraph-win32-x64",
        "node.exe",
      );
      const bundledEntry = join(
        dirname(packageScript),
        "node_modules",
        "@scope",
        "codegraph-win32-x64",
        "lib",
        "dist",
        "bin",
        "codegraph.js",
      );
      await mkdir(dirname(npxScript), { recursive: true });
      await mkdir(dirname(packageScript), { recursive: true });
      await mkdir(dirname(bundledEntry), { recursive: true });
      await Promise.all([
        writeFile(nodePath, "", "utf8"),
        writeFile(npxPath, "@ECHO OFF\r\n", "utf8"),
        writeFile(npxScript, "", "utf8"),
        writeFile(
          join(dirname(packageScript), "package.json"),
          JSON.stringify({ name: "@scope/codegraph" }),
          "utf8",
        ),
        writeFile(
          packagePath,
          '"%_prog%" "%dp0%\\node_modules\\@scope\\codegraph\\npm-shim.js" %*\r\n',
          "utf8",
        ),
        writeFile(packageScript, "", "utf8"),
        writeFile(bundledNode, "", "utf8"),
        writeFile(bundledEntry, "", "utf8"),
      ]);

      expect(
        resolveWindowsStdioCommand("npx", ["-y", "pkg"], () => npxPath),
      ).toEqual({
        executable: nodePath,
        args: [npxScript, "-y", "pkg"],
      });
      expect(
        resolveWindowsStdioCommand(
          "codegraph",
          ["serve", "--mcp"],
          () => packagePath,
        ),
      ).toEqual({
        executable: bundledNode,
        args: ["--liftoff-only", bundledEntry, "serve", "--mcp"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "finds stdio MCP executables in the user-local bin when the GUI PATH omits it",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "artemis-posix-mcp-path-"),
      );
      const homePath = join(directory, "home");
      const binPath = join(homePath, ".local", "bin");
      const workspacePath = join(directory, "workspace");
      const entryPath = join(directory, "server.mjs");
      await Promise.all([
        mkdir(binPath, { recursive: true }),
        mkdir(workspacePath, { recursive: true }),
      ]);
      await symlink(process.execPath, join(binPath, "codegraph"));
      await writeFile(
        entryPath,
        `import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "codegraph_explore",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
  }
});
`,
        "utf8",
      );
      vi.stubEnv("HOME", homePath);
      vi.stubEnv("PATH", "/usr/bin:/bin");
      const manager = new McpClientManager("linux", undefined);

      try {
        const status = await manager.connect({
          id: "codegraph",
          name: "CodeGraph",
          transport: "stdio",
          enabled: true,
          command: "codegraph",
          args: [entryPath],
          env: {},
          envVars: [],
          workspacePath,
          allowNetwork: true,
          fullAccess: true,
        });
        expect(status.state, status.error).toBe("connected");
        expect(status.tools.map((tool) => tool.toolName)).toEqual([
          "codegraph_explore",
        ]);
      } finally {
        await manager.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("isolates a real stdio child while injecting only declared secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-secret-env-"));
    const fixturePath = join(directory, "environment-server.mjs");
    await writeFile(
      fixturePath,
      `import { readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "environment-fixture", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "environment_value",
            inputSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
          {
            name: "security_probe",
            inputSchema: {
              type: "object",
              properties: { outsidePath: { type: "string" } },
              required: ["outsidePath"],
            },
          },
        ],
      },
    });
    return;
  }
  if (message.method !== "tools/call") return;
  if (message.params.name === "environment_value") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: process.env[message.params.arguments.name] ?? "",
          },
        ],
      },
    });
    return;
  }
  void (async () => {
    const insidePath = join(process.cwd(), ".inside-probe");
    const outsidePath = message.params.arguments.outsidePath;
    let insideWrite = false;
    let outsideRead = false;
    let outsideWrite = false;
    let networkAccess = false;
    try {
      await writeFile(insidePath, "inside", "utf8");
      insideWrite = true;
    } finally {
      await rm(insidePath, { force: true }).catch(() => undefined);
    }
    try {
      await readFile(outsidePath, "utf8");
      outsideRead = true;
    } catch {
      outsideRead = false;
    }
    try {
      await writeFile(outsidePath, "outside", "utf8");
      outsideWrite = true;
    } catch {
      outsideWrite = false;
    } finally {
      await rm(outsidePath, { force: true }).catch(() => undefined);
    }
    try {
      const response = await fetch("https://example.com", {
        signal: AbortSignal.timeout(1_000),
      });
      networkAccess = response.ok;
    } catch {
      networkAccess = false;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              insideWrite,
              outsideRead,
              outsideWrite,
              networkAccess,
            }),
          },
        ],
      },
    });
  })();
});
`,
      "utf8",
    );
    const manager = new McpClientManager(process.platform, undefined);
    const outsideProbePath = join(
      dirname(directory),
      `${basename(directory)}-outside-probe`,
    );
    await writeFile(outsideProbePath, "must-not-read", "utf8");
    vi.stubEnv("ARTEMIS_AMBIENT_SECRET", "must-not-leak");
    try {
      const status = await manager.connect(
        {
          id: "context7",
          name: "Context7",
          transport: "stdio",
          enabled: true,
          command: process.execPath,
          args: [fixturePath],
          env: {},
          envVars: [],
          credentialEnvVars: ["CONTEXT7_API_KEY"],
          workspacePath: directory,
          allowNetwork: false,
          fullAccess: process.platform !== "darwin",
        },
        { stdioEnv: { CONTEXT7_API_KEY: "ctx-secret" } },
      );
      expect(status.state, status.error).toBe("connected");
      expect(JSON.stringify(status)).not.toContain("ctx-secret");
      await expect(
        manager.call("context7", "environment_value", {
          name: "CONTEXT7_API_KEY",
        }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "ctx-secret" }],
      });
      if (process.platform === "darwin") {
        await expect(
          manager.call("context7", "environment_value", {
            name: "ARTEMIS_AMBIENT_SECRET",
          }),
        ).resolves.toMatchObject({
          content: [{ type: "text", text: "" }],
        });
        const securityProbe = await manager.call("context7", "security_probe", {
          outsidePath: outsideProbePath,
        });
        expect(JSON.parse(resultText(securityProbe))).toEqual({
          insideWrite: true,
          outsideRead: false,
          outsideWrite: false,
          networkAccess: false,
        });
      }
    } finally {
      await manager.dispose();
      await rm(directory, { recursive: true, force: true });
      await rm(outsideProbePath, { force: true });
    }
  });

  it("sandboxes local stdio servers unless full access is explicit", () => {
    expect(mcpClientManagerSource).toContain("buildDesktopUserLaunch(");
    expect(mcpClientManagerSource).toContain("buildWindowsAppContainerLaunch");
    expect(mcpClientManagerSource).toContain("buildSeatbeltLaunch");
    expect(mcpClientManagerSource).toContain("resolveMcpSandboxPolicy");
    expect(mcpClientManagerSource).toContain("config.fullAccess");
    expect(mcpClientManagerSource).not.toContain("localFullAccess");
    expect(mcpClientManagerSource).not.toContain("...process.env,");
  });

  it("lets the Windows sandbox wrapper finish teardown before force-closing", () => {
    const closeSource = mcpClientManagerSource.slice(
      mcpClientManagerSource.indexOf("async function closeStdioClient"),
      mcpClientManagerSource.indexOf("function safeToolSegment"),
    );

    expect(closeSource).toMatch(
      /endStdioInput\(transport\)[\s\S]*?await waitForProcessExit\([\s\S]*?await client\.close\(\)/u,
    );
    expect(mcpClientManagerSource).toContain(
      "WINDOWS_STDIO_GRACEFUL_EXIT_TIMEOUT_MS = 15_000",
    );
    expect(mcpClientManagerSource).toContain(
      'launch.implementation === "windows-appcontainer"',
    );
  });

  it("carries and validates the task workspace before an approved MCP call", () => {
    const protocolMcpRequest = protocolHostMessagesSource.slice(
      protocolHostMessagesSource.indexOf('kind: "mcp.call"'),
      protocolHostMessagesSource.indexOf('kind: "extension.call"'),
    );
    const runtimeMcpRequest = agentRuntimeSource.slice(
      agentRuntimeSource.indexOf('kind: "mcp.call"'),
      agentRuntimeSource.indexOf("readOnly: tool.readOnly"),
    );
    const brokerHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("async function handleMcpBrokerRequest"),
      mainProcessSource.indexOf("async function handleExtensionBrokerRequest"),
    );
    const approvedExecution = mainProcessSource.slice(
      mainProcessSource.indexOf("async function executeApprovedMcp"),
      mainProcessSource.indexOf("async function executeApprovedExtension"),
    );

    expect(protocolMcpRequest).toContain("workspacePath: string;");
    expect(runtimeMcpRequest).toContain("workspacePath: request.workspacePath");
    expect(brokerHandler).toContain("resolveThreadWorkspace(thread)");
    expect(brokerHandler).toContain(
      "MCP workspace does not match the task project.",
    );
    expect(approvedExecution).toMatch(
      /mcpClientManager\.call\([\s\S]*?request\.workspacePath[\s\S]*?request\.mode/u,
    );
  });

  it("emits an MCP approval card only after auto-approval is declined", () => {
    const brokerHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("async function handleMcpBrokerRequest"),
      mainProcessSource.indexOf("async function handleExtensionBrokerRequest"),
    );
    const autoApproval = brokerHandler.indexOf("shouldAutoApprove(");
    const approvalCard = brokerHandler.indexOf('type: "approval.requested"');
    const automaticPath = brokerHandler.slice(autoApproval, approvalCard);

    expect(autoApproval).toBeGreaterThan(-1);
    expect(approvalCard).toBeGreaterThan(autoApproval);
    expect(automaticPath).toContain("executeApprovedMcp");
    expect(automaticPath).toContain("return;");
  });

  it("does not reuse automation or remembered grants for full-access MCP", () => {
    const brokerHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("async function handleMcpBrokerRequest"),
      mainProcessSource.indexOf("async function handleExtensionBrokerRequest"),
    );

    expect(brokerHandler).toContain(
      "automationResolution && !request.destructive && !stdioFullAccess",
    );
    expect(brokerHandler).toMatch(
      /const rememberedScope =\s*!request\.destructive &&\s*!stdioFullAccess/u,
    );
    expect(brokerHandler).toContain(
      'risk: request.destructive || stdioFullAccess ? "high" : "medium"',
    );
  });

  it("discovers tools and maps OpenCode-style server-qualified Pi names", async () => {
    const namespacedConfig = { ...config, id: "test.server" };
    const client: McpConnection = {
      listTools: async () => ({
        tools: [
          {
            name: "read/file",
            description: "Read",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
          },
        ],
      }),
      callTool: async () => ({
        content: [{ type: "text", text: "result" }],
      }),
      close: vi.fn(async () => {}),
    };
    const manager = new McpClientManager(
      "win32",
      "C:\\helper.ps1",
      async () => client,
    );

    const status = await manager.connect(namespacedConfig, "token");
    expect(status.state).toBe("connected");
    expect(status.tools[0]).toMatchObject({
      serverId: "test.server",
      toolName: "read/file",
      readOnly: true,
    });
    expect(status.tools[0]?.piName).toBe("test_server_read_file");
    expect(await manager.call("test.server", "read/file", {})).toEqual({
      content: [{ type: "text", text: "result" }],
      isError: false,
      metrics: {
        imageBytes: 0,
        imageCount: 0,
        omittedContentCount: 0,
        textBytes: 6,
      },
    });
  });

  it("preserves MCP image blocks instead of serializing base64 as text", async () => {
    const imageData = Buffer.from("image-bytes").toString("base64");
    const client: McpConnection = {
      listTools: async () => ({
        tools: [
          {
            name: "render",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
      callTool: async () => ({
        content: [
          { type: "text", text: "Rendered preview" },
          { type: "image", data: imageData, mimeType: "image/png" },
        ],
      }),
      close: vi.fn(async () => {}),
    };
    const manager = new McpClientManager(
      "darwin",
      undefined,
      async () => client,
    );

    await manager.connect(config);

    expect(await manager.call(config.id, "render", {})).toEqual({
      content: [
        { type: "text", text: "Rendered preview" },
        { type: "image", data: imageData, mimeType: "image/png" },
      ],
      isError: false,
      metrics: {
        imageBytes: 11,
        imageCount: 1,
        omittedContentCount: 0,
        textBytes: 16,
      },
    });
  });

  it("omits unsupported MCP binary content without stringifying its payload", async () => {
    const client: McpConnection = {
      listTools: async () => ({
        tools: [
          {
            name: "audio",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
      callTool: async () => ({
        content: [
          {
            type: "audio",
            data: "private-binary-payload",
            mimeType: "audio/wav",
          },
        ],
      }),
      close: vi.fn(async () => {}),
    };
    const manager = new McpClientManager(
      "darwin",
      undefined,
      async () => client,
    );

    await manager.connect(config);
    const result = await manager.call(config.id, "audio", {});

    expect(result.content).toEqual([
      { type: "text", text: "[Unsupported MCP content omitted: audio]" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-binary-payload");
    expect(result.metrics.omittedContentCount).toBe(1);
  });

  it("reuses a task-scoped stdio connection for calls in the same project", async () => {
    const scopes: Array<McpExecutionScope | undefined> = [];
    const close = vi.fn(async () => {});
    const manager = new McpClientManager(
      "win32",
      "C:\\helper.ps1",
      async (_config, _authentication, scope) => {
        scopes.push(scope);
        return {
          listTools: async () => ({
            tools: [
              {
                name: "status",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }),
          callTool: async () => ({
            content: [
              {
                type: "text",
                text: scope?.workspacePath ?? "runtime",
              },
            ],
          }),
          close,
        };
      },
    );
    const stdioConfig: McpServerConfig = {
      id: "codegraph",
      name: "CodeGraph",
      transport: "stdio",
      enabled: true,
      command: "codegraph",
      args: ["serve", "--mcp"],
      env: {},
      envVars: [],
      workspacePath: "C:\\runtime\\codegraph",
      allowNetwork: true,
    };

    expect((await manager.connect(stdioConfig)).state).toBe("connected");
    await expect(
      manager.call("codegraph", "status", {}, "D:\\Git\\PEAQ_PRB", "execute"),
    ).resolves.toEqual({
      content: [{ type: "text", text: resolve("D:\\Git\\PEAQ_PRB") }],
      isError: false,
      metrics: {
        imageBytes: 0,
        imageCount: 0,
        omittedContentCount: 0,
        textBytes: Buffer.byteLength(resolve("D:\\Git\\PEAQ_PRB"), "utf8"),
      },
    });
    await manager.call(
      "codegraph",
      "status",
      {},
      "D:\\Git\\PEAQ_PRB",
      "execute",
    );

    expect(scopes).toEqual([
      undefined,
      {
        workspacePath: resolve("D:\\Git\\PEAQ_PRB"),
        mode: "execute",
      },
    ]);
    await manager.dispose();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it.runIf(process.platform === "win32")(
    "runs a real npx-style .cmd MCP shim inside AppContainer",
    async () => {
      const testDirectory = dirname(fileURLToPath(import.meta.url));
      const projectRoot = resolve(testDirectory, "..", "..", "..");
      const workspacePath = await mkdtemp(
        join(tmpdir(), "artemis-mcp-appcontainer-"),
      );
      const taskWorkspacePath = await mkdtemp(
        join(tmpdir(), "artemis-mcp-task-"),
      );
      const outsideWorkspacePath = await mkdtemp(
        join(tmpdir(), "artemis-mcp-outside-"),
      );
      const fixtureStartedPath = join(workspacePath, ".fixture-started.json");
      const shimPath = join(workspacePath, "npx.cmd");
      const entryPath = join(
        workspacePath,
        "node_modules",
        "npm",
        "bin",
        "npx-cli.js",
      );
      await mkdir(dirname(entryPath), { recursive: true });
      await writeFile(
        entryPath,
        `import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

await writeFile(
  resolve(process.cwd(), ".fixture-started.json"),
  JSON.stringify({
    pid: process.pid,
    ppid: process.ppid,
    execPath: process.execPath,
    argv: process.argv,
    stdinFd: process.stdin.fd,
    stdoutFd: process.stdout.fd,
    stderrFd: process.stderr.fd,
  }),
  "utf8",
);

const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", async (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            inputSchema: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
          },
          {
            name: "security_probe",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }
  if (message.method !== "tools/call") return;
  if (message.params.name === "echo") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: "MCP_ECHO:" + message.params.arguments.value,
          },
        ],
      },
    });
    return;
  }
  const marker = process.pid + "-" + Date.now();
  const requestedWorkspace = message.params.arguments.workspacePath;
  const insidePath = resolve(
    typeof requestedWorkspace === "string" ? requestedWorkspace : process.cwd(),
    ".inside-" + marker,
  );
  const requestedOutsidePath = message.params.arguments.outsidePath;
  const outsidePath = resolve(
    typeof requestedOutsidePath === "string"
      ? requestedOutsidePath
      : process.cwd(),
    ".outside-" + marker,
  );
  let insideWrite = false;
  let outsideWrite = false;
  let networkAccess = false;
  try {
    await writeFile(insidePath, "inside", "utf8");
    insideWrite = true;
  } finally {
    await rm(insidePath, { force: true }).catch(() => {});
  }
  try {
    await writeFile(outsidePath, "outside", "utf8");
    outsideWrite = true;
  } catch {
    outsideWrite = false;
  } finally {
    await rm(outsidePath, { force: true }).catch(() => {});
  }
  try {
    const response = await fetch("https://example.com", {
      signal: AbortSignal.timeout(2_000),
    });
    networkAccess = response.ok;
  } catch {
    networkAccess = false;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({ insideWrite, outsideWrite, networkAccess }),
        },
      ],
    },
  });
});
`,
        "utf8",
      );
      await writeFile(shimPath, "@ECHO off\r\n", "utf8");
      const manager = new McpClientManager(
        "win32",
        resolve(
          projectRoot,
          "apps",
          "desktop",
          "resources",
          "windows-sandbox.ps1",
        ),
        undefined,
        WINDOWS_APP_CONTAINER_COLD_START_TIMEOUT_MS,
      );
      let fixtureStage = "starting initial connection";
      const diagnosticTimeout = setTimeout(() => {
        void describeWindowsFixture(workspacePath, fixtureStartedPath).then(
          (diagnostic) => {
            console.error(
              `Windows AppContainer fixture is still ${fixtureStage}. Diagnostics: ${diagnostic}`,
            );
          },
        );
      }, WINDOWS_APP_CONTAINER_DIAGNOSTIC_TIMEOUT_MS);
      let testFailed = false;
      let testFailure: unknown;
      try {
        const status = await withWindowsFixtureDeadline(
          "initial connection",
          manager.connect({
            id: "integration-fixture",
            name: "Integration fixture",
            transport: "stdio",
            enabled: true,
            command: shimPath,
            args: [],
            env: {},
            envVars: [],
            workspacePath,
            allowNetwork: true,
          }),
        );
        expect(status.state, status.error).toBe("connected");
        fixtureStage = "running echo call";
        const echo = await withWindowsFixtureDeadline(
          "echo call",
          manager.call("integration-fixture", "echo", { value: "OK" }),
        );
        expect(echo.isError).toBe(false);
        expect(resultText(echo)).toBe("MCP_ECHO:OK");
        expect(echo.metrics).toEqual({
          textBytes: 11,
          imageBytes: 0,
          imageCount: 0,
          omittedContentCount: 0,
        });
        fixtureStage = "running runtime security probe";
        const securityProbe = await withWindowsFixtureDeadline(
          "runtime security probe",
          manager.call("integration-fixture", "security_probe", {
            outsidePath: outsideWorkspacePath,
          }),
        );
        expect(JSON.parse(resultText(securityProbe))).toEqual({
          insideWrite: true,
          outsideWrite: false,
          networkAccess: true,
        });
        fixtureStage = "running task-scoped security probe";
        const taskProbe = await withWindowsFixtureDeadline(
          "task-scoped security probe",
          manager.call(
            "integration-fixture",
            "security_probe",
            {
              workspacePath: taskWorkspacePath,
              outsidePath: outsideWorkspacePath,
            },
            taskWorkspacePath,
            "execute",
          ),
        );
        expect(JSON.parse(resultText(taskProbe))).toEqual({
          insideWrite: true,
          outsideWrite: false,
          networkAccess: true,
        });
      } catch (error) {
        fixtureStage = "capturing failure diagnostics";
        testFailed = true;
        const fixtureDiagnostic = await describeWindowsFixture(
          workspacePath,
          fixtureStartedPath,
        );
        testFailure = new Error(
          `${error instanceof Error ? error.message : String(error)}\nFixture diagnostics: ${fixtureDiagnostic}`,
          { cause: error },
        );
      }
      clearTimeout(diagnosticTimeout);
      fixtureStage = "cleaning up fixture";
      const cleanupFailures = await cleanupWindowsAppContainerFixture(manager, [
        workspacePath,
        taskWorkspacePath,
        outsideWorkspacePath,
      ]);
      if (testFailed) {
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [testFailure, ...cleanupFailures],
            "AppContainer assertions failed and cleanup also reported errors",
            { cause: testFailure },
          );
        }
        throw testFailure;
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          "AppContainer fixture cleanup failed",
        );
      }
    },
    3 * WINDOWS_APP_CONTAINER_COLD_START_TIMEOUT_MS,
  );

  it("does not expose a failed connection as active", async () => {
    const manager = new McpClientManager("darwin", undefined, async () => {
      throw new Error("connection failed");
    });

    expect((await manager.connect(config)).state).toBe("failed");
    await expect(manager.call("test-server", "anything", {})).rejects.toThrow(
      "not connected",
    );
  });

  it("times out one hanging startup without blocking other MCP servers", async () => {
    const close = vi.fn(async () => undefined);
    const manager = new McpClientManager(
      "darwin",
      undefined,
      async (server) => {
        if (server.id === "hanging") {
          return new Promise<McpConnection>(() => undefined);
        }
        return {
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({ content: [] }),
          close,
        };
      },
      15,
    );

    const [hanging, healthy] = await Promise.all([
      manager.connect({ ...config, id: "hanging" }),
      manager.connect({ ...config, id: "healthy" }),
    ]);

    expect(hanging).toMatchObject({ state: "failed", tools: [] });
    expect(hanging.error).toContain("connection timed out after 15 ms");
    expect(healthy.state).toBe("connected");
    await manager.dispose();
  });

  it("allows one cold package startup to use a longer connection timeout", async () => {
    const startupTimeouts: Array<number | undefined> = [];
    const manager = new McpClientManager(
      "darwin",
      undefined,
      async (_config, _authentication, _scope, options) => {
        startupTimeouts.push(options?.startupTimeoutMs);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
        return {
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({ content: [] }),
          close: async () => undefined,
        };
      },
      10,
    );

    const status = await manager.connect(config, undefined, {
      startupTimeoutMs: 60,
    });

    expect(status.state).toBe("connected");
    expect(startupTimeouts).toEqual([60]);
    await manager.dispose();
  });

  it("times out listTools and closes the partial MCP connection", async () => {
    const close = vi.fn(async () => undefined);
    const manager = new McpClientManager(
      "darwin",
      undefined,
      async () => ({
        listTools: () => new Promise(() => undefined),
        callTool: async () => ({ content: [] }),
        close,
      }),
      15,
    );

    const status = await manager.connect(config);
    expect(status.state).toBe("failed");
    expect(status.error).toContain("listTools timed out after 15 ms");
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports the stdio command and captured stderr when launch closes generically", async () => {
    const launchError = Object.assign(
      new Error("MCP error -32000: Connection closed"),
      {
        stderr: "'npx' is not recognized as an internal or external command.",
      },
    );
    const manager = new McpClientManager(
      "win32",
      "C:\\helper.ps1",
      async () => {
        throw launchError;
      },
    );

    const status = await manager.connect({
      id: "context7",
      name: "Context7",
      transport: "stdio",
      enabled: true,
      command: "npx",
      args: [
        "-y",
        "@upstash/context7-mcp@latest",
        "--api-key",
        "ctx7sk-secret",
      ],
      env: {},
      envVars: [],
      workspacePath: "C:\\repo",
      allowNetwork: true,
    });

    expect(status.state).toBe("failed");
    expect(status.error).toContain('stdio MCP "context7"');
    expect(status.error).toContain("npx -y @upstash/context7-mcp@latest");
    expect(status.error).toContain(
      "'npx' is not recognized as an internal or external command.",
    );
    expect(status.error).toContain('--api-key "<redacted>"');
    expect(status.error).not.toContain("ctx7sk-secret");
    expect(status.error).not.toBe("MCP error -32000: Connection closed");
  });

  it("reports OAuth authorization as required without leaking transport errors", async () => {
    const manager = new McpClientManager("darwin", undefined, async () => {
      throw new UnauthorizedError("authorization URL contains private details");
    });

    const status = await manager.connect(config, {
      oauthProvider: {} as OAuthClientProvider,
    });
    expect(status).toMatchObject({
      state: "authorization-required",
      tools: [],
    });
    expect(status.error).toBeUndefined();
  });
});
