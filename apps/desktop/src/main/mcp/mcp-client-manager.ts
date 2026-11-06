import { piToolName } from "./mcp-tool-name.js";
import { createMcpConnectionFactory } from "./mcp-connection-factory.js";
import { callMcpClientTool, formatMcpResult } from "./mcp-result.js";

import { connectionError } from "./mcp-connection-errors.js";
import { resolveCachedNpxCommand } from "./mcp-npx-runtime.js";
import { resolveWindowsStdioCommand } from "./mcp-windows-command.js";
import { posixRuntimeReadRoot } from "./mcp-runtime-paths.js";

import {
  MCP_STARTUP_TIMEOUT_MS,
  STDIO_STARTUP_TEARDOWN_TIMEOUT_MS,
} from "./mcp-connection-limits.js";
import {
  type McpTool,
  type McpConnection,
  type McpConnectionAuthentication,
  type McpExecutionScope,
  type McpConnectOptions,
  type McpConnectionFactory,
  type ActiveConnection,
} from "./mcp-connection-types.js";
import { isExecutionMode, mcpToolExposure } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import { resolve } from "node:path";

import type {
  McpRuntimeTool,
  McpToolCallResult,
  RunMode,
} from "@artemis/protocol";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import type { McpServerConfig, McpServerStatus } from "../../shared/api.js";

// MCP permits any JSON value here. Keep the SDK's content/error validation and
// declared output-schema checks while widening its older object-only envelope.

export class McpClientManager {
  private readonly active = new Map<string, ActiveConnection>();
  private readonly scoped = new Map<string, Promise<ActiveConnection>>();
  private readonly statuses = new Map<string, McpServerStatus>();

  private readonly statusListeners = new Set<
    (status: McpServerStatus) => void
  >();

  onStatusChange(listener: (status: McpServerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private publishStatus(serverId: string, status: McpServerStatus): void {
    this.statuses.set(serverId, status);
    for (const listener of this.statusListeners)
      listener(structuredClone(status));
  }

  async configurationRequired(
    config: McpServerConfig,
    error: string,
  ): Promise<void> {
    await this.disconnect(config.id);
    this.publishStatus(config.id, {
      config: structuredClone(config),
      state: "configuration-required",
      tools: [],
      error,
    });
  }

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly windowsHelperPath: string | undefined,
    private readonly factory: McpConnectionFactory = createMcpConnectionFactory(
      {
        platform,
        windowsHelperPath,
        startupTimeoutMs: () => this.startupTimeoutMs,
        pluginRuntimeReadOnlyPaths: (config) =>
          this.pluginRuntimeReadOnlyPaths(config),
      },
    ),
    private readonly startupTimeoutMs = MCP_STARTUP_TIMEOUT_MS,
    // Host-owned installed-plugin resolver; never populated from MCP manifests.
    private readonly pluginRuntimeReadOnlyPaths: (
      config: McpServerConfig,
    ) => Promise<readonly string[]> = async () => [],
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

  private async finishAbortedStdioStartup(
    clientPromise: Promise<McpConnection>,
    serverId: string,
    startupError: unknown,
  ): Promise<never> {
    const cleanup = clientPromise.then(
      async (lateClient) => {
        try {
          await lateClient.close();
          return { kind: "closed" as const };
        } catch (error) {
          return { kind: "close-failed" as const, error };
        }
      },
      (error) => ({ kind: "factory-failed" as const, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      cleanup,
      new Promise<{ kind: "timed-out" }>((resolvePromise) => {
        timer = setTimeout(
          () => resolvePromise({ kind: "timed-out" }),
          STDIO_STARTUP_TEARDOWN_TIMEOUT_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (outcome.kind === "factory-failed") throw outcome.error;
    if (outcome.kind === "close-failed") {
      throw new AggregateError(
        [startupError, outcome.error],
        `MCP server ${serverId} timed out while starting and its late connection could not be closed`,
        { cause: startupError },
      );
    }
    if (outcome.kind === "timed-out") {
      void cleanup;
      throw new AggregateError(
        [
          startupError,
          new Error(
            `stdio MCP startup teardown timed out after ${STDIO_STARTUP_TEARDOWN_TIMEOUT_MS} ms`,
          ),
        ],
        `MCP server ${serverId} timed out while starting and its teardown did not finish`,
        { cause: startupError },
      );
    }
    throw startupError;
  }

  private async startConnection(
    config: McpServerConfig,
    authentication: McpConnectionAuthentication | undefined,
    scope?: McpExecutionScope,
    startupTimeoutMs = this.startupTimeoutMs,
  ): Promise<{ client: McpConnection; listed: { tools: McpTool[] } }> {
    // Validate package ownership before a transport factory executes or connects.
    await this.pluginRuntimeReadOnlyPaths(config);
    const startupController =
      config.transport === "stdio" ? new AbortController() : undefined;
    const clientPromise = this.factory(config, authentication, scope, {
      startupTimeoutMs,
      ...(startupController ? { startupSignal: startupController.signal } : {}),
    });
    let client: McpConnection;
    try {
      client = await this.withStartupDeadline(
        clientPromise,
        config.id,
        "connection",
        startupTimeoutMs,
      );
    } catch (error) {
      if (startupController) {
        startupController.abort(error);
        return this.finishAbortedStdioStartup(clientPromise, config.id, error);
      }
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
      try {
        await client.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          `MCP server ${config.id} listTools failed and its connection could not be closed`,
          { cause: error },
        );
      }
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
    this.publishStatus(config.id, {
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
        ...(mcpToolExposure(config, tool.name)
          ? { exposure: mcpToolExposure(config, tool.name)! }
          : {}),
        description: tool.description ?? `${config.name} MCP tool`,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
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
      this.publishStatus(config.id, status);
      client.onClose?.(() => {
        if (this.active.get(config.id)?.client !== client) return;
        this.publishStatus(config.id, {
          config: structuredClone(config),
          state: "failed",
          tools: [],
          error:
            "MCP connection closed. Reconnect using Test connection in the server editor.",
        });
      });
      return this.statuses.get(config.id)!;
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
      this.publishStatus(config.id, status);
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
          const resolved = await connection;
          if (resolved.releaseAfterCall) await resolved.releaseAfterCall();
          else await resolved.client.close();
        } catch {
          // Failed scoped connections have no live transport to close.
        }
      }),
    );
    const current = this.statuses.get(serverId);
    if (current) {
      this.publishStatus(serverId, {
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
    mode: Extract<RunMode, "work" | "codemode"> = "work",
    privateMetadata?: Record<string, unknown>,
    signal?: AbortSignal,
    sandboxEscalation = false,
  ): Promise<McpToolCallResult> {
    if (!isExecutionMode(mode))
      throw new Error(`${mode} mode rejects MCP calls.`);
    signal?.throwIfAborted();
    const active = this.active.get(serverId);
    if (!active) {
      throw new Error("MCP server is not connected");
    }
    const advertised = active.tools.find((tool) => tool.toolName === toolName);
    if (!advertised) {
      throw new Error("MCP tool is not advertised by the connected server");
    }
    if (
      sandboxEscalation &&
      (active.config.transport !== "stdio" || !workspacePath)
    )
      throw new Error(
        "Sandbox escalation requires a local stdio MCP server and task workspace.",
      );
    const connection =
      active.config.transport === "stdio" && workspacePath
        ? await this.scopedConnection(
            active,
            workspacePath,
            mode,
            sandboxEscalation,
          )
        : active;
    try {
      signal?.throwIfAborted();
      if (sandboxEscalation && this.active.get(serverId) !== active)
        throw new Error(
          "MCP connection changed before sandbox escalation could execute.",
        );
      const scopedTool = connection.tools.find(
        (tool) => tool.toolName === toolName,
      );
      if (!scopedTool)
        throw new Error("MCP tool is not advertised by the scoped server");
      if (
        sandboxEscalation &&
        (scopedTool.readOnly !== advertised.readOnly ||
          scopedTool.destructive !== advertised.destructive)
      )
        throw new Error(
          "MCP tool risk metadata changed before sandbox escalation could execute.",
        );
      const result = formatMcpResult(
        await connection.client.callTool(
          {
            name: toolName,
            arguments: argumentsValue,
            ...(privateMetadata ? { _meta: privateMetadata } : {}),
          },
          signal,
        ),
      );
      if (
        this.active.get(serverId) === active &&
        this.statuses.get(serverId)?.state === "failed"
      ) {
        this.publishStatus(serverId, {
          config: structuredClone(active.config),
          state: "connected",
          tools: structuredClone(active.tools),
        });
      }
      return result;
    } finally {
      await connection.releaseAfterCall?.();
    }
  }

  private async scopedConnection(
    active: ActiveConnection,
    workspacePath: string,
    mode: Extract<RunMode, "work" | "codemode">,
    sandboxEscalation = false,
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
    if (!sandboxEscalation && comparableWorkspace === comparableRuntime) {
      return active;
    }

    const key = `${active.config.id}\0${comparableWorkspace}${sandboxEscalation ? `\0${randomUUID()}` : ""}`;
    const existing = this.scoped.get(key);
    if (existing) return existing;

    const pending = (async () => {
      const { client, listed } = await this.startConnection(
        active.config,
        active.authentication,
        {
          workspacePath: normalizedWorkspace,
          mode,
          ...(sandboxEscalation ? { sandboxEscalation: true } : {}),
        },
      );
      try {
        const tools = listed.tools.map((tool) => ({
          serverId: active.config.id,
          serverName: active.config.name,
          transport: active.config.transport,
          piName: piToolName(active.config.id, tool.name),
          toolName: tool.name,
          ...(mcpToolExposure(active.config, tool.name)
            ? { exposure: mcpToolExposure(active.config, tool.name)! }
            : {}),
          description: tool.description ?? `${active.config.name} MCP tool`,
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          readOnly: Boolean(tool.annotations?.readOnlyHint),
          destructive: Boolean(tool.annotations?.destructiveHint),
        }));
        client.onClose?.(() => {
          if (this.scoped.get(key) !== pending) return;
          this.scoped.delete(key);
          if (sandboxEscalation) return;
          this.publishStatus(active.config.id, {
            config: structuredClone(active.config),
            state: "failed",
            tools: [],
            error:
              "MCP workspace connection closed. The next tool call will reconnect.",
          });
        });
        let releasePromise: Promise<void> | undefined;
        return {
          config: active.config,
          ...(active.authentication
            ? { authentication: active.authentication }
            : {}),
          client,
          tools,
          ...(sandboxEscalation
            ? {
                releaseAfterCall: () => {
                  releasePromise ??= (async () => {
                    try {
                      await client.close();
                      this.scoped.delete(key);
                    } catch (error) {
                      releasePromise = undefined;
                      throw new Error(
                        "Temporary MCP process cleanup failed; the tool may already have executed. Inspect its effects before retrying.",
                        { cause: error },
                      );
                    }
                  })();
                  return releasePromise;
                },
              }
            : {}),
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
    return [...this.active.values()]
      .filter(
        (connection) =>
          this.statuses.get(connection.config.id)?.state === "connected",
      )
      .flatMap((connection) => structuredClone(connection.tools));
  }

  status(configs: McpServerConfig[]): McpServerStatus[] {
    return configs.map((config) => ({
      ...(this.statuses.get(config.id) ?? {
        state: "disconnected" as const,
        tools: [],
      }),
      config: structuredClone(config),
    }));
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.disconnect(id)));
  }
}

export {
  type McpConnection,
  type McpConnectionAuthentication,
  type McpExecutionScope,
  type McpConnectOptions,
  type McpConnectionFactory,
} from "./mcp-connection-types.js";

export { MCP_STARTUP_TIMEOUT_MS } from "./mcp-connection-limits.js";

export { posixRuntimeReadRoot } from "./mcp-runtime-paths.js";

export { resolveWindowsStdioCommand } from "./mcp-windows-command.js";

export { resolveCachedNpxCommand } from "./mcp-npx-runtime.js";

export { callMcpClientTool } from "./mcp-result.js";
