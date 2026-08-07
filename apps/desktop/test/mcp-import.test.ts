import { describe, expect, it, vi } from "vitest";

import { importMcpServers } from "../src/main/mcp-import.js";

import type {
  ConfigurationImportSummary,
  McpServerConfig,
  McpServerStatus,
} from "../src/shared/api.js";

function stdioServer(id: string, enabled = true): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    enabled,
    command: "node",
    args: ["server.js"],
    env: {},
    envVars: [],
    workspacePath: `C:\\mcp\\${id}`,
    allowNetwork: false,
  };
}

function status(
  config: McpServerConfig,
  state: McpServerStatus["state"],
  error?: string,
): McpServerStatus {
  return {
    config,
    state,
    tools: [],
    ...(error ? { error } : {}),
  };
}

describe("importMcpServers", () => {
  it("keeps imported configurations when their first connection fails", async () => {
    const existing = stdioServer("existing");
    const failed = stdioServer("failed");
    const connected = stdioServer("connected");
    const disabled = stdioServer("disabled", false);
    const saved = new Map([[existing.id, existing]]);
    const connect = vi.fn(async (config: McpServerConfig) =>
      config.id === failed.id
        ? status(config, "failed", "spawn failed")
        : status(config, "connected"),
    );
    const summary: ConfigurationImportSummary = {
      imported: { instructions: 0, skills: 0, mcp: 0, model: 0 },
      skipped: [],
      warnings: [],
    };

    await importMcpServers([existing, failed, connected, disabled], summary, {
      list: async () => [...saved.values()],
      upsert: async (config) => {
        saved.set(config.id, config);
        return config;
      },
      connect,
    });

    expect([...saved.keys()]).toEqual([
      "existing",
      "failed",
      "connected",
      "disabled",
    ]);
    expect(summary.imported.mcp).toBe(3);
    expect(summary.skipped).toEqual(['MCP server "existing" already exists.']);
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        'MCP server "failed" was imported but failed to connect: spawn failed',
      ]),
    );
    expect(connect).not.toHaveBeenCalledWith(disabled);
  });
});
