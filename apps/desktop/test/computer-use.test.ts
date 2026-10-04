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
  const authorizeForeground = vi.fn(async () => false);
  const service = new ComputerUseService({
    drivers: { browser: driver, desktop: driver },
    authorize,
    authorizeForeground,
    publish: vi.fn(),
  });
  const context = {
    threadId: "thread",
    turnId: "turn",
    mode: "work" as const,
  };
  return {
    driver,
    service,
    context,
    authorize,
    authorizeForeground,
    change: () => {
      revision = "page-2";
    },
    changePixels: () => {
      visualRevision = "pixels-2";
    },
  };
}

describe("Computer Use execution boundaries", () => {
  it("rejects Plan before any driver or authorization call", async () => {
    const f = fixture();
    for (const mode of ["plan"] as const)
      await expect(
        f.service.call(
          "computer_open",
          { target: "browser" },
          { ...f.context, mode },
        ),
      ).rejects.toThrow(/Work or Codemode/);
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
  it.each([
    "readout",
    "label",
    "moved",
    "removed",
    "replaced",
    "window",
    "dialog",
    "key",
    "coordinates",
  ])(
    "validates remaining native controls when %s changes during a batch",
    async (change) => {
      const f = fixture();
      f.driver.open = async () => ({
        id: "desktop:fixture",
        kind: "desktop",
        name: "Fixture",
      });
      let changed = false;
      f.driver.observe = vi.fn(async () => ({
        revision: changed ? "updated" : "initial",
        scopeRevision:
          changed && ["window", "dialog"].includes(change)
            ? "other-scope"
            : "window-1",
        visualRevision: "pixels-1",
        width: 800,
        height: 600,
        elements: [
          { id: "first", role: "AXButton", label: "2" },
          ...(changed && change === "removed"
            ? []
            : [
                {
                  id:
                    changed && change === "replaced" ? "replacement" : "second",
                  role: "AXButton",
                  label: changed && change === "label" ? "Delete" : "3",
                  bounds: {
                    x: changed && change === "moved" ? 120 : 20,
                    y: 20,
                    width: 40,
                    height: 40,
                  },
                },
              ]),
          { id: "readout", role: "AXStaticText", label: changed ? "2" : "0" },
        ],
      }));
      f.driver.act = vi.fn(async () => {
        changed = true;
      });
      f.authorizeForeground.mockResolvedValue(true);
      const o = await f.service.open({ target: "desktop:fixture" }, f.context);
      const result = await f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [
            { type: "click", elementId: "first" },
            change === "key"
              ? { type: "key", key: "Enter" }
              : change === "coordinates"
                ? { type: "click_at", x: 20, y: 20 }
                : { type: "click", elementId: "second" },
          ],
        },
        f.context,
      );
      expect(result.completed).toBe(change === "readout" ? 2 : 1);
      expect(f.driver.act).toHaveBeenCalledTimes(change === "readout" ? 2 : 1);
    },
  );
  it("reports the actual pause cause in subsequent tool errors", async () => {
    const f = fixture();
    await f.service.open({ target: "browser" }, f.context);
    f.service.stopThread(
      f.context.threadId,
      "Native helper exited unexpectedly",
    );
    await expect(
      f.service.open({ target: "browser" }, f.context),
    ).rejects.toThrow(/Native helper exited unexpectedly/);
  });
  it("continues element actions after a coordinate click only changes focus pixels", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    vi.mocked(f.driver.act).mockImplementation(async () => f.changePixels());
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [
          { type: "click_at", x: 20, y: 20 },
          { type: "click", elementId: "button-1" },
        ],
      },
      f.context,
    );
    expect(result).toMatchObject({
      status: "completed",
      attempted: 2,
      completed: 2,
      remaining: 0,
    });
    expect(result.stopped).toBeUndefined();
  });
  it("does not count an unverified fill as completed", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [{ type: "fill", elementId: "button-1", text: "Expected" }],
      },
      f.context,
    );
    expect(result).toMatchObject({
      status: "partial",
      attempted: 1,
      completed: 0,
      remaining: 1,
      stopped: "verification-failed",
    });
  });
  it("does not mark a final successful click incomplete when it updates the page", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    vi.mocked(f.driver.act).mockImplementation(async () => f.change());
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [{ type: "click", elementId: "button-1" }],
      },
      f.context,
    );
    expect(result).toMatchObject({
      status: "completed",
      completed: 1,
      remaining: 0,
    });
    expect(result.stopped).toBeUndefined();
  });
  it("reports a user pause without instructing the model to reopen the target", async () => {
    const f = fixture();
    const o = await f.service.open({ target: "browser" }, f.context);
    f.service.stopThread(f.context.threadId, "User took control");
    await expect(
      f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [{ type: "click", elementId: "button-1" }],
        },
        f.context,
      ),
    ).rejects.toThrow(/paused.*Resume/);
  });
  it("denies native foreground input without separate host authorization", async () => {
    const f = fixture();
    f.driver.open = async () => ({
      id: "desktop:test",
      kind: "desktop",
      name: "Test",
    });
    const o = await f.service.open({ target: "test" }, f.context);
    const result = await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [{ type: "key", key: "Enter" }],
      },
      f.context,
    );
    expect(result).toMatchObject({
      status: "blocked",
      completed: 0,
      stopped: "foreground-required",
    });
    expect(f.driver.act).not.toHaveBeenCalled();
  });
  it("authorizes native foreground input separately and limits reuse to the current turn", async () => {
    const f = fixture();
    f.driver.open = async () => ({
      id: "desktop:test",
      kind: "desktop",
      name: "Test",
    });
    f.authorizeForeground.mockResolvedValue(true);
    let o = await f.service.open({ target: "test" }, f.context);
    for (let i = 0; i < 2; i++) {
      o = await f.service.act(
        {
          targetId: o.target.id,
          observationId: o.observationId,
          actions: [{ type: "key", key: "Enter" }],
        },
        f.context,
      );
    }
    expect(f.authorizeForeground).toHaveBeenCalledTimes(1);
    expect(f.driver.act).toHaveBeenLastCalledWith(
      o.target,
      { type: "key", key: "Enter" },
      expect.any(AbortSignal),
      true,
    );
    f.service.stopThread(f.context.threadId, "Turn ended");
    const next = { ...f.context, turnId: "next" };
    o = await f.service.open({ target: "test" }, next);
    await f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [{ type: "key", key: "Enter" }],
      },
      next,
    );
    expect(f.authorizeForeground).toHaveBeenCalledTimes(2);
  });
  it("never dispatches input if Stop occurs while foreground permission is pending", async () => {
    const f = fixture();
    f.driver.open = async () => ({
      id: "desktop:test",
      kind: "desktop",
      name: "Test",
    });
    let approve!: (allowed: boolean) => void;
    f.authorizeForeground.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const o = await f.service.open({ target: "test" }, f.context);
    const action = f.service.act(
      {
        targetId: o.target.id,
        observationId: o.observationId,
        actions: [{ type: "key", key: "Enter" }],
      },
      f.context,
    );
    const rejected = expect(action).rejects.toThrow();
    await vi.waitFor(() =>
      expect(f.authorizeForeground).toHaveBeenCalledOnce(),
    );
    f.service.stopThread(f.context.threadId);
    approve(true);
    await rejected;
    expect(f.driver.act).not.toHaveBeenCalled();
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
