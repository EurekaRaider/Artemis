import { describe, expect, it, vi } from "vitest";
import type { BrokerExecutionRequest, Thread } from "@artemis/protocol";
import type { McpServerConfig } from "../src/shared/api.js";
import { resolveComputerTaskApproval } from "../src/main/computer-use/approval.js";

const request = {
  kind: "mcp.call",
  threadId: "task",
  turnId: "turn",
  serverId: "builtin",
  toolName: "computer_act",
  mode: "work",
  arguments: { targetId: "desktop:app" },
  destructive: true,
  readOnly: false,
  transport: "streamable-http",
  modelApproval: {
    risk: "low",
    explicitUserRequest: true,
    reason: "Requested edit",
  },
} as Extract<BrokerExecutionRequest, { kind: "mcp.call" }>;
function fixture() {
  return {
    serverId: "builtin",
    config: { id: "builtin", enabled: true } as McpServerConfig,
    thread: { id: "task", mode: "work", archived: false } as Thread,
    activeTurnId: "turn",
    isTrustedServer: vi.fn(async () => true),
    host: { taskApproval: vi.fn(() => "grant-id" as string | undefined) },
  };
}
describe("scoped Computer Use model approval", () => {
  it("uses the existing model decision locally after host and plugin checks", async () => {
    const f = fixture();
    expect(await resolveComputerTaskApproval(request, f)).toBe("grant-id");
    expect(f.isTrustedServer).toHaveBeenCalledWith(f.config);
    expect(f.host.taskApproval).toHaveBeenCalledWith(
      "computer_act",
      request.arguments,
      { threadId: "task", turnId: "turn", mode: "work" },
    );
  });
  it("retains the destructive risk floor even when the model says low risk", async () => {
    const f = fixture();
    expect(
      await resolveComputerTaskApproval(
        {
          ...request,
          modelApproval: {
            ...request.modelApproval,
            explicitUserRequest: false,
          },
        },
        f,
      ),
    ).toBeUndefined();
  });
  it.each([
    { serverId: "spoof" },
    { actorAgentId: "child" },
    { mode: "plan" },
    { mode: "plan" },
    { threadId: "another" },
    { turnId: "old" },
    { toolName: "other" },
  ])("rejects out-of-scope requests: %j", async (overrides) => {
    const f = fixture();
    expect(
      await resolveComputerTaskApproval(
        { ...request, ...overrides } as typeof request,
        f,
      ),
    ).toBeUndefined();
    expect(f.host.taskApproval).not.toHaveBeenCalled();
  });
  it("rejects disabled, archived, changed-mode, untrusted and revoked access", async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.config.enabled = false;
      },
      (f: ReturnType<typeof fixture>) => {
        f.thread.archived = true;
      },
      (f: ReturnType<typeof fixture>) => {
        f.thread.mode = "review";
      },
      (f: ReturnType<typeof fixture>) => {
        f.isTrustedServer.mockResolvedValue(false);
      },
      (f: ReturnType<typeof fixture>) => {
        f.host.taskApproval.mockReturnValue(undefined);
      },
    ]) {
      const f = fixture();
      change(f);
      expect(await resolveComputerTaskApproval(request, f)).toBeUndefined();
    }
  });
});
