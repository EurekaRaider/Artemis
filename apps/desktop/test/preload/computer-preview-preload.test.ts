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
    '<button id="hide"></button><canvas id="computer-preview-floating-canvas"></canvas><span id="status"></span><div id="resize"></div>';
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
  const resize = document.getElementById("resize")!;
  resize.setPointerCapture = vi.fn();
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 392,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 236,
  });
  resize.dispatchEvent(
    new MouseEvent("pointerdown", { screenX: 100, screenY: 100 }),
  );
  resize.dispatchEvent(
    new MouseEvent("pointermove", { screenX: 180, screenY: 140 }),
  );
  expect(native.send).toHaveBeenLastCalledWith(IPC.computerPreviewFloating, {
    action: "resize",
    sessionId: state.sessionId,
    width: 472,
    height: 276,
  });
  resize.dispatchEvent(new Event("pointerup"));
  const canvas = document.querySelector("canvas")!;
  canvas.setPointerCapture = vi.fn();
  update({}, { state, locale: "zh-CN", position: [100, 200] });
  canvas.dispatchEvent(
    new MouseEvent("pointerdown", { screenX: 100, screenY: 100, button: 0 }),
  );
  canvas.dispatchEvent(
    new MouseEvent("pointermove", { screenX: 120, screenY: 130 }),
  );
  expect(native.send).toHaveBeenLastCalledWith(IPC.computerPreviewFloating, {
    action: "move",
    sessionId: state.sessionId,
    x: 120,
    y: 230,
  });
  canvas.dispatchEvent(new Event("pointerup"));
  canvas.click();
  expect(native.send).toHaveBeenCalledTimes(4);
  update({}, { locale: "zh-CN" });
  document.getElementById("hide")!.click();
  expect(native.send).toHaveBeenCalledTimes(4);
  listen.mockRestore();
});
