import type { WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { ComputerPreviewHost } from "../../../src/main/computer-use/preview-host.js";
import { PreviewStream } from "../../../src/main/computer-use/preview-stream.js";
const native = vi.hoisted(() => ({
  sources: [] as {
    stop: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("electron", () => ({ sharedTexture: {} }));
vi.mock("../../../src/main/computer-use/native-preview.js", () => ({
  NativePreviewSource: class {
    stop = vi.fn();
    resize = vi.fn();
    start = vi.fn(async () => {});
    sameWindow = vi.fn(async () => true);
    constructor() {
      native.sources.push(this);
    }
  },
}));
const owner = (id: number) =>
  ({ id, isDestroyed: () => false }) as unknown as WebContents;
function fixture(kind: "desktop" | "browser" = "desktop") {
  const target = {
    id: kind === "desktop" ? "desktop:test" : "browser:3",
    kind,
    name: "Test",
  };
  const browserStream = new PreviewStream("browser-stream", vi.fn(), vi.fn());
  let authorized = true;
  const publish = vi.fn(),
    expand = vi.fn();
  const host = new ComputerPreviewHost({
    driver: {} as never,
    acquire: vi.fn(),
    browsers: {
      owned: () => ({ tabId: "original-tab", stream: browserStream }),
    } as never,
    authorized: () => (authorized ? { target } : undefined),
    publish,
    expand,
  });
  host.update({ version: 1, state: "observing", threadId: "task", target });
  return {
    host,
    browserStream,
    expand,
    target,
    revoke: () => {
      authorized = false;
    },
  };
}
it("does not capture until visible, freezes on pause, and ends on permission revocation", () => {
  native.sources.length = 0;
  const f = fixture(),
    sender = owner(1),
    sessionId = f.host.states()[0]!.sessionId;
  expect(native.sources).toHaveLength(0);
  f.host.command({ action: "subscribe", sessionId, token: "token" }, sender);
  expect(native.sources).toHaveLength(1);
  f.revoke();
  f.host.update({
    version: 1,
    state: "paused",
    threadId: "task",
    reason: "User paused control",
  });
  expect(native.sources[0]!.stop).toHaveBeenCalled();
  expect(f.host.states()[0]!.state).toBe("paused");
  f.host.report(sender, "token", { fps: 60, p95Ms: 10, sequence: 1 });
  expect(f.host.states()[0]!.actualFps).toBe(0);
  f.host.update({
    version: 1,
    state: "paused",
    threadId: "task",
    reason: "Permission revoked",
  });
  expect(f.host.states()).toEqual([]);
  f.host.dispose();
});
it("hides only PiP consumers and expands the original browser tab", () => {
  const f = fixture("browser"),
    sender = owner(1),
    state = f.host.states()[0]!;
  f.browserStream.subscribe("full-browser", sender);
  f.host.command(
    { action: "subscribe", sessionId: state.sessionId, token: "pip" },
    sender,
  );
  expect(() =>
    f.host.command(
      { action: "subscribe", sessionId: state.sessionId, token: "pip" },
      owner(2),
    ),
  ).toThrow(/ownership/);
  f.host.command({ action: "hide", sessionId: state.sessionId }, sender);
  expect(f.browserStream.owns("pip", sender)).toBe(false);
  expect(f.browserStream.owns("full-browser", sender)).toBe(true);
  f.host.command({ action: "show", sessionId: state.sessionId }, sender);
  f.host.command({ action: "expand", sessionId: state.sessionId }, sender);
  expect(f.expand.mock.calls[0]![0].tabId).toBe("original-tab");
  f.host.dispose();
  f.browserStream.close();
});
it("uses expanded resolution then reduces pixels before changing the 60fps budget", () => {
  native.sources.length = 0;
  const f = fixture(),
    sender = owner(1),
    sessionId = f.host.states()[0]!.sessionId;
  f.host.command(
    { action: "subscribe", sessionId, token: "large", expanded: true },
    sender,
  );
  for (let sequence = 0; sequence < 3; sequence++)
    f.host.report(sender, "large", { fps: 40, p95Ms: 140, sequence });
  expect(native.sources[0]!.resize).toHaveBeenLastCalledWith(1280);
  f.host.removeContents(sender);
  expect(native.sources[0]!.stop).toHaveBeenCalled();
  f.host.dispose();
});

it("ends the PiP session when its original browser tab closes", () => {
  const f = fixture("browser"),
    sender = owner(1),
    state = f.host.states()[0]!;
  f.host.command(
    { action: "subscribe", sessionId: state.sessionId, token: "pip" },
    sender,
  );
  f.host.closeTarget(f.target.id);
  expect(f.host.states()).toEqual([]);
  expect(f.browserStream.visible()).toBe(false);
  f.browserStream.close();
});

it("can display and hide an unavailable preview without resubscribing to a failed stream", () => {
  const f = fixture("browser"),
    sender = owner(1),
    state = f.host.states()[0]!;
  f.browserStream.fail(new Error("GPU stopped"));
  expect(f.host.states()[0]!.state).toBe("unavailable");
  expect(() =>
    f.host.command(
      { action: "subscribe", sessionId: state.sessionId, token: "pip" },
      sender,
    ),
  ).not.toThrow();
  f.host.command({ action: "hide", sessionId: state.sessionId }, sender);
  f.host.command({ action: "show", sessionId: state.sessionId }, sender);
  expect(f.host.states()[0]!.state).toBe("unavailable");
  f.host.dispose();
});
