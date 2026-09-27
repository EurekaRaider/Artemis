import { describe, expect, it, vi } from "vitest";
import {
  ComputerUseService,
  type ComputerDriver,
} from "../src/main/computer-use/service.js";

function fixture() {
  let revision = "page-1";
  let visualRevision = "pixels-1";
  const driver: ComputerDriver = {
    targets: async () => [
      {
        id: "browser-1",
        kind: "browser",
        name: "Test",
        url: "https://example.test",
      },
    ],
    open: async () => ({
      id: "browser-1",
      kind: "browser",
      name: "Test",
      url: "https://example.test",
    }),
    observe: vi.fn(async () => ({
      revision,
      visualRevision,
      width: 800,
      height: 600,
      elements: [{ id: "button-1", role: "button", label: "Continue" }],
    })),
    act: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const authorize = vi.fn(async () => true);
  const service = new ComputerUseService({
    drivers: { browser: driver, desktop: driver },
    authorize,
    publish: vi.fn(),
  });
  const context = {
    threadId: "thread",
    turnId: "turn",
    mode: "execute" as const,
  };
  return {
    driver,
    service,
    context,
    authorize,
    change: () => {
      revision = "page-2";
    },
    changePixels: () => {
      visualRevision = "pixels-2";
    },
  };
}

describe("Computer Use execution boundaries", () => {
  it("rejects Plan and Review before any driver or authorization call", async () => {
    const f = fixture();
    for (const mode of ["plan", "review"] as const)
      await expect(
        f.service.call(
          "computer_open",
          { target: "browser" },
          { ...f.context, mode },
        ),
      ).rejects.toThrow(/Execute/);
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it("does not observe a denied app", async () => {
    const f = fixture();
    f.authorize.mockResolvedValue(false);
    await expect(
      f.service.call("computer_open", { target: "browser" }, f.context),
    ).rejects.toThrow(/denied/);
    expect(f.driver.observe).not.toHaveBeenCalled();
  });
  it("rejects a stale observation before dispatching input", async () => {
    const f = fixture();
    const opened = await f.service.open({ target: "browser" }, f.context);
    f.change();
    await expect(
      f.service.act(
        {
          targetId: opened.target.id,
          observationId: opened.observationId,
          actions: [{ type: "click", elementId: "button-1" }],
        },
        f.context,
      ),
    ).rejects.toThrow(/stale/i);
    expect(f.driver.act).not.toHaveBeenCalled();
  });
  it("denies cross-thread target access", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    await expect(
      f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [{ type: "click", elementId: "button-1" }],
        },
        { ...f.context, threadId: "other" },
      ),
    ).rejects.toThrow(/owned/);
    expect(f.driver.act).not.toHaveBeenCalled();
  });
  it("rejects coordinate input when only the pixels have changed", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    f.changePixels();
    await expect(
      f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [{ type: "click_at", x: 20, y: 20 }],
        },
        f.context,
      ),
    ).rejects.toThrow(/Stale screenshot/);
    expect(f.driver.act).not.toHaveBeenCalled();
  });
  it("requires a new observation before coordinates after another action", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [
          { type: "click", elementId: "button-1" },
          { type: "click_at", x: 20, y: 20 },
        ],
      },
      f.context,
    );
    expect(result.completed).toBe(1);
    expect(result.stopped).toBe("observe-required");
    expect(f.driver.act).toHaveBeenCalledTimes(1);
  });
  it("releases a failed opening and leaves a retryable status", async () => {
    const f = fixture();
    vi.mocked(f.driver.observe).mockRejectedValueOnce(
      new Error("Window closed"),
    );
    await expect(
      f.service.open({ target: "browser" }, f.context),
    ).rejects.toThrow("Window closed");
    expect(f.service.status().state).toBe("paused");
    expect(f.driver.release).toHaveBeenCalledOnce();
    await expect(
      f.service.open({ target: "browser" }, f.context),
    ).resolves.toHaveProperty("observationId");
  });
  it("stops the remaining batch on navigation", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    vi.mocked(f.driver.act).mockImplementation(async () => f.change());
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [
          { type: "click", elementId: "button-1" },
          { type: "click", elementId: "button-1" },
        ],
      },
      f.context,
    );
    expect(result.completed).toBe(1);
    expect(result.stopped).toBe("interface-changed");
    expect(f.driver.act).toHaveBeenCalledTimes(1);
  });
  it("cancels active input and never dispatches the next batch step", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    vi.mocked(f.driver.act).mockImplementation(
      async (_target, _action, signal) => {
        f.service.stopThread("thread");
        signal.throwIfAborted();
      },
    );
    await expect(
      f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [
            { type: "click", elementId: "button-1" },
            { type: "click", elementId: "button-1" },
          ],
        },
        f.context,
      ),
    ).rejects.toThrow();
    expect(f.driver.act).toHaveBeenCalledTimes(1);
  });
  it("bounds batches and rejects arbitrary JavaScript", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    for (const actions of [
      [{ type: "evaluate", code: "alert(1)" }],
      Array.from({ length: 9 }, () => ({
        type: "click",
        elementId: "button-1",
      })),
    ])
      await expect(
        f.service.call(
          "computer_act",
          { targetId: o.target.id, observationId: o.observationId, actions },
          f.context,
        ),
      ).rejects.toThrow();
    expect(f.driver.act).not.toHaveBeenCalled();
  });
  it("cancels pending app authorization and requires user resume", async () => {
    const f = fixture();
    let approve!: (value: boolean) => void;
    f.authorize.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    const opening = f.service.open({ target: "browser" }, f.context);
    const rejected = expect(opening).rejects.toThrow();
    await vi.waitFor(() => expect(f.authorize).toHaveBeenCalledOnce());
    f.service.stopThread(f.context.threadId);
    approve(true);
    await rejected;
    expect(f.driver.observe).not.toHaveBeenCalled();
    await expect(
      f.service.open({ target: "browser" }, f.context),
    ).rejects.toThrow(/paused/);
    f.service.resumeThread(f.context.threadId);
    await expect(
      f.service.open({ target: "browser" }, f.context),
    ).resolves.toHaveProperty("observationId");
  });
  it("reuses unchanged images and clears the control state on turn end", async () => {
    const f = fixture();
    vi.mocked(f.driver.observe).mockResolvedValue({
      revision: "same",
      visualRevision: "pixels",
      width: 20,
      height: 20,
      elements: [],
      image: { data: "aW1hZ2U=", mimeType: "image/jpeg" },
    });
    const first = await f.service.open({ target: "browser" }, f.context);
    expect(first.image).toBeDefined();
    const next = await f.service.call(
      "computer_observe",
      { targetId: first.target.id },
      f.context,
    );
    expect(next).toMatchObject({ imageUnchanged: true });
    expect(next).not.toHaveProperty("image");
    f.service.stopThread(f.context.threadId, "Turn ended");
    expect(f.service.status().state).toBe("idle");
  });
});
