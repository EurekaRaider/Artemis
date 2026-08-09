import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  installedGoogleMcpServerIdsForGrant,
  readyInstalledGoogleMcpServers,
} from "../src/main/google-plugin-activation.js";
import type { McpServerConfig } from "../src/shared/api.js";

const mainProcessSource = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);

function googleConfig(
  id: string,
  grant: "gmail" | "google-workspace",
): McpServerConfig {
  return {
    id,
    name: id,
    transport: "stdio",
    enabled: false,
    command: "/Applications/Artemis.app/Contents/MacOS/Artemis",
    args: ["server.mjs"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    envVars: [],
    workspacePath: `/tmp/${id}`,
    allowNetwork: true,
    hostAuth: {
      provider: "google",
      grant,
      scopes: ["openid", "email"],
    },
  };
}

describe("Google plugin activation", () => {
  it("selects only disabled installed MCP servers for the authorized Google grant", () => {
    const gmail = googleConfig("gmail", "gmail");
    const enabledGmail = {
      ...googleConfig("enabled-gmail", "gmail"),
      enabled: true,
    };
    const unmanagedGmail = googleConfig("unmanaged-gmail", "gmail");
    const workspace = googleConfig("workspace", "google-workspace");

    expect(
      installedGoogleMcpServerIdsForGrant(
        [gmail, enabledGmail, unmanagedGmail, workspace],
        [gmail.id, enabledGmail.id, workspace.id],
        "gmail",
      ),
    ).toEqual([gmail.id]);
  });

  it("enables only newly installed host-authenticated MCP servers that are ready", async () => {
    const gmail = googleConfig("gmail", "gmail");
    const workspace = googleConfig("workspace", "google-workspace");
    const unrelated: McpServerConfig = {
      id: "ordinary",
      name: "ordinary",
      transport: "stdio",
      enabled: false,
      command: "/Applications/Artemis.app/Contents/MacOS/Artemis",
      args: ["server.mjs"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      envVars: [],
      workspacePath: "/tmp/ordinary",
      allowNetwork: true,
    };
    const ensureReady = vi.fn(async (config: McpServerConfig) => {
      if (config.id === "workspace") throw new Error("Authorize first");
    });

    const result = await readyInstalledGoogleMcpServers(
      [gmail, workspace, unrelated],
      [gmail.id, workspace.id, unrelated.id],
      ensureReady,
    );

    expect(result.ready).toEqual([{ ...gmail, enabled: true }]);
    expect(result.skipped).toEqual([
      { id: "workspace", reason: "Authorize first" },
    ]);
    expect(ensureReady).toHaveBeenCalledTimes(2);
  });

  it("does not revisit enabled or unrelated MCP servers", async () => {
    const enabled = { ...googleConfig("enabled", "gmail"), enabled: true };
    const ensureReady = vi.fn(async () => undefined);

    const result = await readyInstalledGoogleMcpServers(
      [enabled, googleConfig("other", "gmail")],
      [enabled.id],
      ensureReady,
    );

    expect(result).toEqual({ ready: [], skipped: [] });
    expect(ensureReady).not.toHaveBeenCalled();
  });

  it("activates ready Google MCP servers before publishing the new runtime", () => {
    const installHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.resourcePluginInstall"),
      mainProcessSource.indexOf("IPC.resourcePluginUpdate"),
    );
    const activation = installHandler.indexOf(
      "enableReadyInstalledGoogleMcpServers",
    );
    const runtime = installHandler.indexOf("applyAgentRuntime");

    expect(activation).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(activation);
  });

  it("activates installed Google MCP servers after grant authorization", () => {
    const authorizeHandler = mainProcessSource.slice(
      mainProcessSource.indexOf("IPC.googleAccountAuthorizeGrant"),
      mainProcessSource.indexOf("IPC.googleAccountDisconnectGrant"),
    );
    const authorize = authorizeHandler.indexOf(
      "googleAccountService.authorize",
    );
    const activation = authorizeHandler.indexOf(
      "enableReadyInstalledGoogleMcpServers",
    );
    const runtime = authorizeHandler.indexOf("applyAgentRuntime");

    expect(authorize).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(authorize);
    expect(runtime).toBeGreaterThan(activation);
  });
});
