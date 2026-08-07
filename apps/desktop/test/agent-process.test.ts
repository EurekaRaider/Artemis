import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

class FakeUtilityProcess extends EventEmitter {
  readonly stderr = new PassThrough();
  readonly stdout = new PassThrough();
  readonly postMessage = vi.fn();
  readonly kill = vi.fn(() => true);
}

async function createAgentProcess(child: FakeUtilityProcess) {
  vi.doMock("electron", () => ({
    utilityProcess: {
      fork: vi.fn(() => child),
    },
  }));
  const { AgentProcess } = await import("../src/main/agent-process.js");
  return new AgentProcess("C:\\agent-worker.js", {
    onEvent: vi.fn(),
    onBrokerRequest: vi.fn(async () => {}),
  });
}

afterEach(() => {
  vi.doUnmock("electron");
  vi.resetModules();
});

describe("AgentProcess", () => {
  it("fails a short control request instead of hanging forever", async () => {
    const child = new FakeUtilityProcess();
    const process = await createAgentProcess(child);

    await expect(
      process.request(
        { type: "runtime.catalog", requestId: "request-timeout" },
        10,
      ),
    ).rejects.toThrow("runtime.catalog");
  });

  it("resolves the matching request and clears its timeout", async () => {
    const child = new FakeUtilityProcess();
    const process = await createAgentProcess(child);
    const response = process.request(
      { type: "runtime.catalog", requestId: "request-success" },
      1_000,
    );

    child.emit("message", {
      type: "response",
      requestId: "request-success",
      ok: true,
      data: { models: [] },
    });

    await expect(response).resolves.toEqual({ models: [] });
  });

  it("rejects pending requests when the utility process exits", async () => {
    const child = new FakeUtilityProcess();
    const process = await createAgentProcess(child);
    const response = process.request({
      type: "runtime.catalog",
      requestId: "request-exit",
    });

    child.emit("exit", 17);

    await expect(response).rejects.toThrow("17");
  });
});
