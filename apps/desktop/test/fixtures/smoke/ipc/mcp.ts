import { IPC, type McpServerConfig } from "../../../../src/shared/api.js";
import {
  mcpConfigStore,
  getSettingsSnapshot,
} from "../../../../src/main/main.js";
import { smokeMode } from "../environment.js";
import { smokeMcpState } from "../mcp-state.js";

export function decorateMcpIpc(
  channel: string,
  next: Parameters<import("electron").IpcMain["handle"]>[1],
) {
  const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
  if (
    channel === IPC.mcpServerSave &&
    smokeMode &&
    view.startsWith("mcp-editor")
  )
    return async (
      _event: Electron.IpcMainInvokeEvent,
      input: McpServerConfig,
      bearerToken?: string,
      credentialEnv?: Record<string, string>,
    ) => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (
          process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-save-error" &&
          !smokeMcpState.saveFailureInjected
        ) {
          smokeMcpState.saveFailureInjected = true;
          throw new Error("Simulated MCP server save failure.");
        }
        // Keep the durable half of the production chain: the config still
        // round-trips the real McpConfigStore persistence. Only the connect
        // step is simulated away (the synthetic identity must never spawn a
        // process or dial an endpoint) and the bearer token is dropped.
        await new Promise((resolvePromise) =>
          setTimeout(
            resolvePromise,
            process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-credentials"
              ? 1_500
              : 250,
          ),
        );
        await mcpConfigStore.upsert(input);
        return getSettingsSnapshot();
      }
      return next(_event, input, bearerToken, credentialEnv);
    };
  if (channel === IPC.mcpServerReconnect && smokeMode)
    return async (_event: Electron.IpcMainInvokeEvent, serverId: string) => {
      if (smokeMode) {
        smokeMcpState.reconnectIpcCalls += 1;
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-test-busy") {
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 10_000),
          );
        }
        const snapshot = await getSettingsSnapshot();
        if (process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-test-failure") {
          return {
            ...snapshot,
            mcpServers: snapshot.mcpServers.map((server) =>
              server.config.id === serverId
                ? {
                    ...server,
                    state: "failed" as const,
                    error: "Simulated MCP connection test rejection.",
                  }
                : server,
            ),
          };
        }
        return {
          ...snapshot,
          mcpServers: snapshot.mcpServers.map((server) =>
            server.config.id === serverId
              ? { ...server, state: "connected" as const }
              : server,
          ),
        };
      }
      return next(_event, serverId);
    };
  if (
    channel === IPC.mcpServerRemove &&
    smokeMode &&
    view.startsWith("mcp-editor")
  )
    return async (_event: Electron.IpcMainInvokeEvent, serverId: string) => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("mcp-editor")
      ) {
        if (!mcpConfigStore) {
          throw new Error("MCP service is not ready.");
        }
        if (
          process.env.ARTEMIS_SMOKE_VIEW === "mcp-editor-remove-error" &&
          !smokeMcpState.removeFailureInjected
        ) {
          smokeMcpState.removeFailureInjected = true;
          throw new Error("Simulated MCP server removal failure.");
        }
        // Keep the durable half of the production chain (the real
        // McpConfigStore.remove); the plugin scan, agent-thread reset, and
        // runtime re-apply are skipped because the isolated profile has no
        // plugins or open threads and the synthetic server never connected.
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        await mcpConfigStore.remove(serverId);
        return getSettingsSnapshot();
      }
      return next(_event, serverId);
    };
  return next;
}
