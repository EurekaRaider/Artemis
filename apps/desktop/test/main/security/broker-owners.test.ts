import { describe, expect, it, vi } from "vitest";
import { createLocalFileBroker } from "../../../src/main/broker/local-files.js";

describe("local file broker boundaries after extraction", () => {
  it("rejects Plan before workspace lookup, approval, or filesystem execution", async () => {
    const rejectBrokerRequest = vi.fn();
    const services = {
      agentProcess: { post: vi.fn() },
      store: { getThread: vi.fn() },
      rejectBrokerRequest,
      resolveThreadWorkspace: vi.fn(),
      settingsStore: { approvalPolicy: vi.fn() },
    };
    const broker = createLocalFileBroker(services as never);
    const request = {
      kind: "local.file.read",
      mode: "plan",
      threadId: "thread",
      turnId: "turn",
      path: "/private/file",
    };
    await broker.handleLocalFileBrokerRequest("worker", request as never);
    expect(rejectBrokerRequest).toHaveBeenCalledExactlyOnceWith(
      "worker",
      request,
      "plan mode rejects local file access.",
    );
    expect(services.store.getThread).not.toHaveBeenCalled();
    expect(services.resolveThreadWorkspace).not.toHaveBeenCalled();
    expect(services.settingsStore.approvalPolicy).not.toHaveBeenCalled();
    expect(services.agentProcess.post).not.toHaveBeenCalled();
  });
  it("rejects a stale turn before resolving the workspace", async () => {
    const rejectBrokerRequest = vi.fn();
    const services = {
      agentProcess: {},
      store: { getThread: () => ({ id: "thread", mode: "work" }) },
      cancellingTurns: new Set(),
      activeTurns: new Map([["thread", "new-turn"]]),
      rejectBrokerRequest,
      resolveThreadWorkspace: vi.fn(),
    };
    await createLocalFileBroker(services as never).handleLocalFileBrokerRequest(
      "worker",
      {
        kind: "local.file.read",
        mode: "work",
        threadId: "thread",
        turnId: "old-turn",
      } as never,
    );
    expect(rejectBrokerRequest).toHaveBeenCalledWith(
      "worker",
      expect.anything(),
      "Local file access requires the active Work or Codemode turn.",
    );
    expect(services.resolveThreadWorkspace).not.toHaveBeenCalled();
  });
});
