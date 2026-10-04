import { describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../../../src/shared/api.js";
import {
  McpClientManager,
  type McpConnection,
  type McpExecutionScope,
} from "../../../src/main/mcp/mcp-client-manager.js";
import {
  effectiveApprovalRisk,
  shouldAutoApprove,
} from "../../../src/main/security/approval-mode.js";

const config: McpServerConfig = {
  id: "local",
  name: "Local fixture",
  enabled: true,
  transport: "stdio",
  command: "node",
  args: [],
  env: {},
  envVars: [],
  workspacePath: "/workspace",
  allowNetwork: false,
};

function fixture(
  options: {
    fail?: boolean;
    changedMetadata?: boolean;
    closeFailsOnce?: boolean;
  } = {},
) {
  const connections: McpConnection[] = [];
  const scopes: Array<McpExecutionScope | undefined> = [];
  const manager = new McpClientManager(
    "darwin",
    undefined,
    async (_config, _auth, scope) => {
      scopes.push(scope);
      const elevated = Boolean(scope?.sandboxEscalation);
      let closeAttempts = 0;
      const connection: McpConnection = {
        listTools: async () => ({
          tools: [
            {
              name: "read",
              inputSchema: { type: "object" },
              annotations: {
                readOnlyHint: !(elevated && options.changedMetadata),
                destructiveHint: elevated && options.changedMetadata,
              },
            },
          ],
        }),
        callTool: vi.fn(async () => {
          if (options.fail) throw new Error("EACCES: permission denied");
          return {
            content: [
              { type: "text", text: elevated ? "elevated" : "sandboxed" },
            ],
          };
        }),
        close: vi.fn(async () => {
          if (elevated && options.closeFailsOnce && closeAttempts++ === 0)
            throw new Error("Synthetic teardown failure");
        }),
      };
      connections.push(connection);
      return connection;
    },
  );
  return { manager, connections, scopes };
}

describe("single-call sandbox escalation", () => {
  it("retains a failed cleanup for disposal without replaying the completed tool", async () => {
    const { manager, connections } = fixture({ closeFailsOnce: true });
    await manager.connect(config);
    await expect(
      manager.call(
        "local",
        "read",
        {},
        "/workspace",
        "work",
        undefined,
        undefined,
        true,
      ),
    ).rejects.toThrow("may already have executed");
    expect(connections[1]?.callTool).toHaveBeenCalledOnce();
    await manager.dispose();
    expect(connections[1]?.close).toHaveBeenCalledTimes(2);
    expect(connections[1]?.callTool).toHaveBeenCalledOnce();
  });

  it("does not share elevated connections between concurrent calls", async () => {
    const { manager, connections } = fixture();
    try {
      await manager.connect(config);
      await Promise.all(
        [1, 2].map(() =>
          manager.call(
            "local",
            "read",
            {},
            "/workspace",
            "work",
            undefined,
            undefined,
            true,
          ),
        ),
      );
      expect(connections).toHaveLength(3);
      expect(connections[0]?.callTool).not.toHaveBeenCalled();
      for (const connection of connections.slice(1)) {
        expect(connection.callTool).toHaveBeenCalledOnce();
        expect(connection.close).toHaveBeenCalledOnce();
      }
    } finally {
      await manager.dispose();
    }
  });

  it.each(["abort", "disconnect"])(
    "does not invoke a temporary tool after %s during startup",
    async (cancellation) => {
      let finishStartup!: () => void;
      let started!: () => void;
      const startup = new Promise<void>((resolve) => {
        finishStartup = resolve;
      });
      const startupEntered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const elevatedCall = vi.fn(async () => ({ content: [] }));
      const elevatedClose = vi.fn(async () => {});
      const manager = new McpClientManager(
        "darwin",
        undefined,
        async (_config, _auth, scope) => {
          const elevated = Boolean(scope?.sandboxEscalation);
          if (elevated) {
            started();
            await startup;
          }
          return {
            listTools: async () => ({
              tools: [{ name: "read", inputSchema: { type: "object" } }],
            }),
            callTool: elevated ? elevatedCall : async () => ({ content: [] }),
            close: elevated ? elevatedClose : async () => {},
          };
        },
      );
      try {
        await manager.connect(config);
        const controller = new AbortController();
        const call = manager.call(
          "local",
          "read",
          {},
          "/workspace",
          "work",
          undefined,
          controller.signal,
          true,
        );
        const rejected = expect(call).rejects.toThrow();
        await startupEntered;
        const disconnected =
          cancellation === "disconnect"
            ? manager.disconnect("local")
            : undefined;
        if (cancellation === "abort") controller.abort();
        finishStartup();
        await rejected;
        await disconnected;
        expect(elevatedCall).not.toHaveBeenCalled();
        expect(elevatedClose).toHaveBeenCalledOnce();
      } finally {
        finishStartup();
        await manager.dispose();
      }
    },
  );

  it.each(["work", "codemode"] as const)(
    "isolates an approved %s MCP call and restores the next call",
    async (mode) => {
      const { manager, connections, scopes } = fixture();
      try {
        await manager.connect(config);
        const result = await manager.call(
          "local",
          "read",
          {},
          "/workspace",
          mode,
          undefined,
          undefined,
          true,
        );
        expect(result.content).toEqual([{ type: "text", text: "elevated" }]);
        expect(scopes[1]).toMatchObject({
          workspacePath: "/workspace",
          mode,
          sandboxEscalation: true,
        });
        expect(connections[1]?.close).toHaveBeenCalledOnce();
        expect(connections[0]?.close).not.toHaveBeenCalled();
        expect(config).not.toHaveProperty("fullAccess");
        expect(manager.status([config])[0]?.config).not.toHaveProperty(
          "fullAccess",
        );
        const next = await manager.call(
          "local",
          "read",
          {},
          "/workspace",
          mode,
        );
        expect(next.content).toEqual([{ type: "text", text: "sandboxed" }]);
        expect(connections).toHaveLength(2);
      } finally {
        await manager.dispose();
      }
    },
  );

  it("closes the temporary process even when the elevated tool fails", async () => {
    const { manager, connections } = fixture({ fail: true });
    try {
      await manager.connect(config);
      await expect(
        manager.call(
          "local",
          "read",
          {},
          "/workspace",
          "work",
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow("EACCES");
      expect(connections).toHaveLength(2);
      expect(connections[1]?.close).toHaveBeenCalledOnce();
      expect(connections[0]?.callTool).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("does not automatically escalate or replay a failed ordinary call", async () => {
    const { manager, connections } = fixture({ fail: true });
    try {
      await manager.connect(config);
      await expect(
        manager.call("local", "read", {}, "/workspace"),
      ).rejects.toThrow("EACCES");
      expect(connections).toHaveLength(1);
      expect(connections[0]?.callTool).toHaveBeenCalledOnce();
    } finally {
      await manager.dispose();
    }
  });

  it("refuses changed risk metadata before the temporary tool executes", async () => {
    const { manager, connections } = fixture({ changedMetadata: true });
    try {
      await manager.connect(config);
      await expect(
        manager.call(
          "local",
          "read",
          {},
          "/workspace",
          "work",
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow(/metadata/iu);
      expect(connections[1]?.callTool).not.toHaveBeenCalled();
      expect(connections[1]?.close).toHaveBeenCalledOnce();
    } finally {
      await manager.dispose();
    }
  });

  it("refuses remote MCP escalation before calling the server", async () => {
    const { manager, connections } = fixture();
    try {
      await manager.connect({
        id: "local",
        name: "Remote",
        enabled: true,
        transport: "streamable-http",
        url: "https://example.test/mcp",
      });
      await expect(
        manager.call(
          "local",
          "read",
          {},
          "/workspace",
          "work",
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow(/local stdio/iu);
      expect(connections[0]?.callTool).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("refuses Plan mode even if an untyped caller requests escalation", async () => {
    const { manager, connections } = fixture();
    try {
      await manager.connect(config);
      await expect(
        manager.call(
          "local",
          "read",
          {},
          "/workspace",
          "plan" as "work",
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow(/mode/iu);
      expect(connections).toHaveLength(1);
      expect(connections[0]?.callTool).not.toHaveBeenCalled();
    } finally {
      await manager.dispose();
    }
  });

  it("treats extension escalation as high risk regardless of the model label", () => {
    const operation = {
      kind: "extension.call" as const,
      allowNetwork: false,
      fullAccess: true,
      modelApproval: {
        risk: "low" as const,
        explicitUserRequest: false,
        reason: "Read the user's requested file.",
      },
    };
    expect(effectiveApprovalRisk(operation)).toBe("high");
    expect(shouldAutoApprove("agent", operation, true)).toBe(false);
    expect(
      shouldAutoApprove(
        "agent",
        {
          ...operation,
          modelApproval: {
            ...operation.modelApproval,
            explicitUserRequest: true,
          },
        },
        true,
      ),
    ).toBe(true);
    for (const policy of ["ask", "custom"] as const)
      expect(shouldAutoApprove(policy, operation, true)).toBe(false);
  });
});
