import { safeToolSegment } from "./mcp-tool-name.js";
import { callMcpClientTool } from "./mcp-result.js";
import { connectStdioClient, closeStdioClient } from "./mcp-stdio-lifecycle.js";

import {
  resolveCachedNpxCommand,
  stageNpxRuntime,
  withNodeResolutionArguments,
} from "./mcp-npx-runtime.js";
import {
  resolveWindowsExecutable,
  resolveNpmCommandShim,
  resolveWindowsStdioCommandDetails,
} from "./mcp-windows-command.js";
import {
  resolvePosixExecutable,
  canonicalExistingPath,
  resolveMcpSandboxPolicy,
  pathIsInside,
} from "./mcp-runtime-paths.js";
import {
  posixDesktopPath,
  stdioBaseEnvironment,
  setEnvironmentDefault,
} from "./mcp-environment.js";

import { type McpConnectionFactory } from "./mcp-connection-types.js";

import { randomUUID } from "node:crypto";

import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

import {
  buildDesktopUserLaunch,
  buildSeatbeltLaunch,
  buildWindowsAppContainerLaunch,
} from "@artemis/platform";
import type { SandboxCommand } from "@artemis/platform";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../../shared/api.js";

interface ConnectionFactoryContext {
  platform: NodeJS.Platform;
  windowsHelperPath: string | undefined;
  startupTimeoutMs(): number;
  pluginRuntimeReadOnlyPaths(
    config: McpServerConfig,
  ): Promise<readonly string[]>;
}
export function createMcpConnectionFactory(
  context: ConnectionFactoryContext,
): McpConnectionFactory {
  return async (config, authentication, scope, options) => {
    let client = new Client({
      name: "Artemis",
      version: "2.0.8",
    });
    let stdioTransport: StdioClientTransport | undefined;
    let waitForWindowsSandboxTeardown = false;
    if (config.transport === "stdio") {
      options?.startupSignal?.throwIfAborted();
      const runtimeWorkspacePath = canonicalExistingPath(
        context.platform,
        config.workspacePath,
      );
      const executionWorkspacePath = canonicalExistingPath(
        context.platform,
        scope?.workspacePath ?? config.workspacePath,
      );
      const commandArguments =
        context.platform === "win32" &&
        basename(config.command).toLowerCase() === "node.exe"
          ? ["--preserve-symlinks", "--preserve-symlinks-main", ...config.args]
          : config.args;
      const forwardedEnvironment = Object.fromEntries(
        config.envVars.flatMap((name) => {
          const value = process.env[name];
          return typeof value === "string" ? [[name, value]] : [];
        }),
      );
      const commandEnvironment = {
        ...stdioBaseEnvironment(context.platform, Boolean(config.fullAccess)),
        ...forwardedEnvironment,
        ...config.env,
        ...(authentication?.stdioEnv ?? {}),
      };
      const explicitlyConfiguresPath = Object.keys({
        ...forwardedEnvironment,
        ...config.env,
        ...(authentication?.stdioEnv ?? {}),
      }).some((name) => name.toLowerCase() === "path");
      if (context.platform !== "win32" && !explicitlyConfiguresPath) {
        // Finder-launched apps do not load shell profiles such as .zshrc.
        commandEnvironment.PATH = posixDesktopPath(
          context.platform,
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
        options?.startupSignal?.throwIfAborted();
        setEnvironmentDefault(commandEnvironment, "HOME", homeDirectory);
        setEnvironmentDefault(commandEnvironment, "TMPDIR", temporaryDirectory);
        setEnvironmentDefault(commandEnvironment, "TEMP", temporaryDirectory);
        setEnvironmentDefault(commandEnvironment, "TMP", temporaryDirectory);
        setEnvironmentDefault(
          commandEnvironment,
          "NPM_CONFIG_CACHE",
          npmCacheDirectory,
        );
        if (context.platform === "win32") {
          const roamingDirectory = join(runtimeDirectory, "appdata", "roaming");
          const localDirectory = join(runtimeDirectory, "appdata", "local");
          await Promise.all([
            mkdir(roamingDirectory, { recursive: true }),
            mkdir(localDirectory, { recursive: true }),
          ]);
          options?.startupSignal?.throwIfAborted();
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
      if (context.platform === "win32") {
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
        options?.startupSignal?.throwIfAborted();
        resolved = await stageNpxRuntime(resolved, runtimeDirectory);
        options?.startupSignal?.throwIfAborted();
        if (stagesNpxRuntime) {
          const cachedCommand = await resolveCachedNpxCommand(
            config.args,
            npmCacheDirectory,
            resolved.executable,
          );
          options?.startupSignal?.throwIfAborted();
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
          const roamingDirectory = join(runtimeDirectory, "appdata", "roaming");
          const localDirectory = join(runtimeDirectory, "appdata", "local");
          await mkdir(homeDirectory, { recursive: true });
          await mkdir(roamingDirectory, { recursive: true });
          await mkdir(localDirectory, { recursive: true });
          options?.startupSignal?.throwIfAborted();
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
          args: withNodeResolutionArguments(resolved.executable, resolved.args),
        };
      } else {
        command = {
          ...command,
          executable: canonicalExistingPath(
            context.platform,
            resolvePosixExecutable(
              command.executable,
              command.cwd,
              commandEnvironment.PATH ?? "",
            ),
          ),
          args: command.args.map((argument) =>
            isAbsolute(argument)
              ? canonicalExistingPath(context.platform, argument)
              : argument,
          ),
        };
      }
      const pluginReadOnlyPaths =
        await context.pluginRuntimeReadOnlyPaths(config);
      const buildLaunch = (sandboxCommand: SandboxCommand) => {
        if (config.fullAccess || scope?.sandboxEscalation)
          return buildDesktopUserLaunch(sandboxCommand);
        const policy = resolveMcpSandboxPolicy(
          config,
          sandboxCommand,
          scope,
          context.platform,
          process.env.HOME ?? homedir(),
          runtimeDirectory,
          pluginReadOnlyPaths,
        );
        if (context.platform === "darwin") {
          return buildSeatbeltLaunch(sandboxCommand, policy);
        }
        if (context.platform === "win32" && context.windowsHelperPath) {
          const launch = buildWindowsAppContainerLaunch(
            sandboxCommand,
            policy,
            {
              helperPath: context.windowsHelperPath,
              hostAccessPath: runtimeDirectory,
              hostTempPath: tmpdir(),
              // CreateAppContainerProfile limits the complete name to 64 characters.
              identity: `Artemis.Mcp.${safeToolSegment(config.id).slice(0, 19)}.${randomUUID().replaceAll("-", "")}`,
              runtimePath: runtimeDirectory,
            },
          );
          waitForWindowsSandboxTeardown =
            launch.implementation === "windows-appcontainer";
          return launch;
        }
        throw new Error(
          `Local MCP sandbox is unavailable on ${context.platform}; enable full local access only for a trusted server.`,
        );
      };
      options?.startupSignal?.throwIfAborted();
      try {
        stdioTransport = await connectStdioClient(
          client,
          buildLaunch(command),
          options?.startupTimeoutMs ?? context.startupTimeoutMs(),
          options?.startupSignal,
        );
      } catch (error) {
        if (options?.startupSignal?.aborted) throw error;
        if (!npxRuntime || npxRuntime.usedCachedCommand) throw error;
        const cachedCommand = await resolveCachedNpxCommand(
          config.args,
          npxRuntime.cacheDirectory,
          npxRuntime.nodeExecutable,
        );
        options?.startupSignal?.throwIfAborted();
        if (!cachedCommand) throw error;
        try {
          await client.close();
        } catch {
          // A failed npx bootstrap may already have closed its transport.
        }
        client = new Client({
          name: "Artemis",
          version: "2.0.8",
        });
        command = {
          ...command,
          executable: cachedCommand.executable,
          args: withNodeResolutionArguments(
            cachedCommand.executable,
            cachedCommand.args,
          ),
        };
        stdioTransport = await connectStdioClient(
          client,
          buildLaunch(command),
          options?.startupTimeoutMs ?? context.startupTimeoutMs(),
          options?.startupSignal,
        );
      }
    } else {
      const requestHeaders =
        authentication?.headers ??
        (authentication?.bearerToken
          ? { Authorization: `Bearer ${authentication.bearerToken}` }
          : undefined);
      const createTransport = () =>
        new StreamableHTTPClientTransport(new URL(config.url), {
          ...(authentication?.fetch ? { fetch: authentication.fetch } : {}),
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
          version: "2.0.8",
        });
        transport = createTransport();
        await client.connect(transport as Parameters<Client["connect"]>[0]);
      }
    }
    return {
      onClose(listener) {
        client.onclose = listener;
        if (!client.transport) listener();
      },
      async listTools() {
        const result = await client.listTools();
        return {
          tools: result.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined
              ? {}
              : { description: tool.description }),
            inputSchema: tool.inputSchema,
            ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
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
      async callTool(input, signal) {
        return callMcpClientTool(client, input, signal);
      },
      close: () =>
        stdioTransport
          ? closeStdioClient(
              client,
              stdioTransport,
              waitForWindowsSandboxTeardown,
            )
          : client.close(),
    };
  };
}
