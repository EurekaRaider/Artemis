import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../../../src/main/main.ts", import.meta.url),
  "utf8",
);
const start = main.indexOf("async function executeApprovedMcp(");
const end = main.indexOf("async function executeApprovedExtension(", start);
const executeSource = transformSync(main.slice(start, end), {
  loader: "ts",
}).code;

function fixture() {
  let finishTrust!: (trusted: boolean) => void;
  const thread = { mode: "work", archived: false };
  const grant = { metadata: { ticket: "private" }, dispose: vi.fn() };
  const scope = {
    isExecutionMode: (mode: string) => mode === "work" || mode === "codemode",
    canRunLicensed: () => true,
    emitPayload: vi.fn(),
    agentProcess: { post: vi.fn() },
    mcpClientManager: { call: vi.fn(async () => ({ content: [] })) },
    activeMcpCalls: new Map(),
    mcpConfigStore: { list: async () => [{ id: "builtin", enabled: true }] },
    computerUseServerId: "builtin",
    artemisPluginService: {
      isComputerUseServer: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishTrust = resolve;
          }),
      ),
    },
    store: { getThread: () => thread },
    activeTurns: new Map([["task", "turn"]]),
    computerUseHost: {
      taskApproval: vi.fn(() => "original-grant" as string | undefined),
      server: { authorize: vi.fn(() => grant) },
    },
    diagnosticBundleService: { record: vi.fn() },
  };
  const run = new Function(
    ...Object.keys(scope),
    `${executeSource}\nreturn executeApprovedMcp;`,
  )(...Object.values(scope));
  const request = {
    threadId: "task",
    turnId: "turn",
    mode: "work",
    serverId: "builtin",
    toolName: "computer_act",
    arguments: { targetId: "desktop:fixture" },
    workspacePath: "/workspace",
  };
  const resolution = {
    approvalId: "approval",
    nonce: "nonce",
    approved: true,
    scope: "once",
    source: "policy",
  };
  return {
    scope,
    thread,
    grant,
    request,
    resolution,
    finishTrust: (trusted = true) => finishTrust(trusted),
    run: () =>
      run("worker", request, resolution, "original-grant") as Promise<void>,
  };
}

describe("Computer Use broker execution", () => {
  it("executes an unchanged task grant once using the existing private MCP ticket", async () => {
    const f = fixture();
    const pending = f.run();
    await vi.waitFor(() =>
      expect(
        f.scope.artemisPluginService.isComputerUseServer,
      ).toHaveBeenCalledOnce(),
    );
    f.finishTrust();
    await pending;
    expect(f.scope.mcpClientManager.call).toHaveBeenCalledExactlyOnceWith(
      "builtin",
      "computer_act",
      f.request.arguments,
      "/workspace",
      "work",
      f.grant.metadata,
      expect.any(AbortSignal),
    );
    expect(f.scope.agentProcess.post).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: f.resolution }),
    );
    expect(f.grant.dispose).toHaveBeenCalledOnce();
    expect(f.scope.activeMcpCalls.size).toBe(0);
  });

  it.each(["revoke", "replace", "mode", "archive", "turn", "trust"] as const)(
    "rejects a %s change while plugin verification is pending",
    async (change) => {
      const f = fixture();
      const pending = f.run();
      await vi.waitFor(() =>
        expect(
          f.scope.artemisPluginService.isComputerUseServer,
        ).toHaveBeenCalledOnce(),
      );
      if (change === "revoke")
        f.scope.computerUseHost.taskApproval.mockReturnValue(undefined);
      if (change === "replace")
        f.scope.computerUseHost.taskApproval.mockReturnValue(
          "replacement-grant",
        );
      if (change === "mode") f.thread.mode = "review";
      if (change === "archive") f.thread.archived = true;
      if (change === "turn") f.scope.activeTurns.set("task", "next");
      f.finishTrust(change !== "trust");
      await pending;
      expect(f.scope.mcpClientManager.call).not.toHaveBeenCalled();
      expect(f.scope.computerUseHost.server.authorize).not.toHaveBeenCalled();
      expect(f.scope.agentProcess.post).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution: expect.objectContaining({ approved: false }),
          error: expect.any(String),
        }),
      );
      expect(f.scope.activeMcpCalls.size).toBe(0);
    },
  );
});
