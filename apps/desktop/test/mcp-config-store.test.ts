import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  McpConfigStore,
  validateMcpServerConfig,
} from "../src/main/mcp-config-store.js";

import type { McpServerConfig } from "../src/shared/api.js";

const temporaryDirectories: string[] = [];
function stdioServer(
  overrides: Partial<Extract<McpServerConfig, { transport: "stdio" }>> = {},
): Extract<McpServerConfig, { transport: "stdio" }> {
  return {
    id: "codegraph",
    name: "Codegraph",
    transport: "stdio",
    enabled: true,
    command: "codegraph",
    args: ["serve", "--mcp"],
    workspacePath: "C:\\code",
    allowNetwork: false,
    env: {},
    envVars: [],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("McpConfigStore", () => {
  it("accepts IPv6 loopback HTTP MCP endpoints", () => {
    expect(
      validateMcpServerConfig({
        id: "ipv6-loopback",
        name: "IPv6 loopback",
        transport: "streamable-http",
        enabled: false,
        url: "http://[::1]:3000/mcp",
        auth: "none",
      }),
    ).toMatchObject({ url: "http://[::1]:3000/mcp" });
  });

  it("preserves validated Connector metadata on HTTP resources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const store = new McpConfigStore(join(directory, "mcp.json"));

    const saved = await store.upsert({
      id: "connector-mail",
      name: "Mail",
      transport: "streamable-http",
      enabled: false,
      url: "https://connector.example.test/mcp",
      auth: "oauth",
      resourceKind: "connector",
      connectorId: "mail",
    });

    expect(saved).toMatchObject({
      resourceKind: "connector",
      connectorId: "mail",
    });
    expect(await store.list()).toEqual([saved]);
  });

  it("rejects malformed Connector metadata before persisting it", () => {
    expect(() =>
      validateMcpServerConfig({
        id: "connector-mail",
        name: "Mail",
        transport: "streamable-http",
        enabled: false,
        url: "https://connector.example.test/mcp",
        auth: "oauth",
        resourceKind: "connector",
        connectorId: "INVALID CONNECTOR",
      }),
    ).toThrow("Connector ID is invalid");
  });

  it("normalizes every stdio MCP server to network access", () => {
    const missingNetworkDefault = {
      ...stdioServer(),
    } as Partial<Extract<McpServerConfig, { transport: "stdio" }>>;
    delete missingNetworkDefault.allowNetwork;

    expect(
      validateMcpServerConfig(
        missingNetworkDefault as Extract<
          McpServerConfig,
          { transport: "stdio" }
        >,
      ).allowNetwork,
    ).toBe(true);
    expect(
      validateMcpServerConfig(stdioServer({ allowNetwork: false }))
        .allowNetwork,
    ).toBe(true);
  });

  it("migrates every legacy stdio server to network access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "mcp.json");
    const workspacePath = join(directory, "mcp-workspaces", "context7");
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        servers: [
          stdioServer({
            id: "context7",
            name: "context7",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp@latest"],
            workspacePath,
            allowNetwork: false,
          }),
          stdioServer({
            id: "local",
            name: "local",
            workspacePath: join(directory, "mcp-workspaces", "local"),
          }),
        ],
      })}\n`,
      "utf8",
    );

    const servers = await new McpConfigStore(filePath).list();

    expect(servers.find((server) => server.id === "context7")).toMatchObject({
      allowNetwork: true,
    });
    expect(servers.find((server) => server.id === "local")).toMatchObject({
      allowNetwork: true,
    });
  });

  it("assigns a private default workspace when the stdio cwd is blank", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const store = new McpConfigStore(join(directory, "mcp.json"));

    const saved = await store.upsert(stdioServer({ workspacePath: "" }));

    expect(saved.workspacePath).toBe(
      join(directory, "mcp-workspaces", "codegraph"),
    );
  });

  it("normalizes and round-trips Codex-style stdio environment settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const store = new McpConfigStore(join(directory, "mcp.json"));

    const saved = await store.upsert(
      stdioServer({
        env: { " API_TOKEN ": "secret", EMPTY_VALUE: "" },
        envVars: ["USERPROFILE", "USERPROFILE", "LOCALAPPDATA"],
      }),
    );

    expect(saved).toMatchObject({
      env: { API_TOKEN: "secret", EMPTY_VALUE: "" },
      envVars: ["USERPROFILE", "LOCALAPPDATA"],
    });
    expect(await store.list()).toEqual([saved]);
  });

  it("rejects invalid environment names before persisting them", () => {
    expect(() =>
      validateMcpServerConfig(
        stdioServer({
          env: { "INVALID=NAME": "secret" },
        }),
      ),
    ).toThrow("environment variable name");
  });

  it("requires uninstalling an existing server before changing transport", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const store = new McpConfigStore(join(directory, "mcp.json"));
    await store.upsert(stdioServer());

    await expect(
      store.upsert({
        id: "codegraph",
        name: "Codegraph",
        transport: "streamable-http",
        enabled: true,
        url: "https://example.test/mcp",
        auth: "none",
      }),
    ).rejects.toThrow(/uninstall/iu);
  });

  it("replaces a validated MCP set in one persisted update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-"));
    temporaryDirectories.push(directory);
    const store = new McpConfigStore(join(directory, "mcp.json"));
    await store.upsert(stdioServer({ id: "old" }));

    const saved = await store.replaceAll([
      stdioServer({ id: "plugin-tools", enabled: false, workspacePath: "" }),
      {
        id: "remote-docs",
        name: "Remote docs",
        transport: "streamable-http",
        enabled: false,
        url: "https://example.test/mcp",
        auth: "oauth",
      },
    ]);

    expect(saved.map((server) => server.id)).toEqual([
      "plugin-tools",
      "remote-docs",
    ]);
    expect(await store.list()).toEqual(saved);
    await expect(
      store.replaceAll([
        stdioServer({ id: "duplicate" }),
        stdioServer({ id: "duplicate" }),
      ]),
    ).rejects.toThrow("Duplicate MCP server ID");
    expect(await store.list()).toEqual(saved);
  });
});
