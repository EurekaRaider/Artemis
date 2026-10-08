// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { ComputerPreviewState } from "@artemis/protocol";
import { IPC } from "../../src/shared/api.js";

const native = vi.hoisted(() => ({ on: vi.fn(), send: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: native }));
vi.mock("../../src/preload/preview-textures.js", () => ({
  bindPreviewCanvas: vi.fn(),
  unbindPreviewCanvas: vi.fn(),
}));

it("expands on picture click while X hides only the current preview", async () => {
  document.body.innerHTML =
    '<header><button id="hide">×</button><span id="name"></span><button id="expand"></button></header><canvas id="computer-preview-floating-canvas"></canvas><span id="status"></span><button id="control"></button>';
  const listen = vi.spyOn(window, "addEventListener");
  await import("../../src/preload/computer-preview-preload.js");
  const ready = listen.mock.calls.find(
    ([name]) => name === "DOMContentLoaded",
  )![1] as EventListener;
  ready(new Event("DOMContentLoaded"));
  const update = native.on.mock.calls[0]![1];
  const state: ComputerPreviewState = {
    version: 1,
    sessionId: "owned-session",
    threadId: "task",
    target: { id: "desktop:1", kind: "desktop", name: "App" },
    state: "live",
    timestamp: 0,
    sequence: 0,
    actualFps: 60,
  };
  update({}, { state, locale: "zh-CN" });
  native.send.mockClear();
  document.querySelector("canvas")!.click();
  expect(native.send).toHaveBeenLastCalledWith(IPC.computerPreviewFloating, {
    action: "expand",
    sessionId: state.sessionId,
  });
  document.getElementById("hide")!.click();
  expect(native.send).toHaveBeenLastCalledWith(IPC.computerPreviewFloating, {
    action: "hide",
    sessionId: state.sessionId,
  });
  expect(native.send.mock.calls.map(([, value]) => value.action)).toEqual([
    "expand",
    "hide",
  ]);
  update({}, { locale: "zh-CN" });
  document.getElementById("hide")!.click();
  expect(native.send).toHaveBeenCalledTimes(2);
  listen.mockRestore();
});
