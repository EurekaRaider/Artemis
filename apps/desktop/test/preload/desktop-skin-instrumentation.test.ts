import { expect, it, vi } from "vitest";
import { instrumentDesktopSkinPreload } from "../fixtures/preload/desktop-skin-instrumentation.js";

type Api = Parameters<typeof instrumentDesktopSkinPreload>[0];

it("observes assembled bridges without changing results, arguments or disposal", () => {
  const result = Promise.resolve({ id: "terminal" });
  const dispose = vi.fn();
  let received: Parameters<Api["onTerminalData"]>[0] | undefined;
  const original = {
    openTerminal: vi.fn(() => result),
    writeTerminal: vi.fn(() => result),
    resizeTerminal: vi.fn(() => result),
    closeTerminal: vi.fn(() => result),
    rendererReady: vi.fn(),
    onTerminalData: vi.fn((listener) => {
      received = listener;
      return dispose;
    }),
  };
  const api = { ...original } as unknown as Api;
  const webFrame = { setZoomFactor: vi.fn(), getZoomFactor: vi.fn(() => 2) };
  const counters = instrumentDesktopSkinPreload(api, webFrame);
  const input = { threadId: "thread" } as Parameters<Api["openTerminal"]>[0];
  expect(api.openTerminal(input)).toBe(result);
  expect(original.openTerminal).toHaveBeenCalledWith(input);
  expect(api.writeTerminal("terminal", "hello")).toBe(result);
  expect(original.writeTerminal).toHaveBeenCalledWith("terminal", "hello");
  expect(api.resizeTerminal("terminal", 80, 24)).toBe(result);
  expect(original.resizeTerminal).toHaveBeenCalledWith("terminal", 80, 24);
  expect(api.closeTerminal("terminal")).toBe(result);
  expect(original.closeTerminal).toHaveBeenCalledWith("terminal");
  api.rendererReady();
  expect(original.rendererReady).toHaveBeenCalledOnce();
  const listener = vi.fn();
  expect(api.onTerminalData(listener)).toBe(dispose);
  const event = { terminalId: "terminal", data: "x".repeat(20_000) };
  received!(event);
  expect(listener).toHaveBeenCalledWith(event);
  expect(counters.terminalData()).toHaveLength(16_384);
  expect([
    counters.terminalOpenCount(),
    counters.terminalWriteCount(),
    counters.terminalResizeCount(),
    counters.terminalCloseCount(),
    counters.rendererReadyCount(),
  ]).toEqual([1, 1, 1, 1, 1]);
  expect(counters.terminalLastResize()).toEqual({ cols: 80, rows: 24 });
  counters.setZoomFactor(2);
  expect(webFrame.setZoomFactor).toHaveBeenCalledWith(2);
  expect(counters.zoomFactor()).toBe(2);
});

it("preserves synchronous bridge failures", () => {
  const failure = new Error("bridge failed");
  const api = {
    openTerminal: () => {
      throw failure;
    },
  } as unknown as Api;
  const counters = instrumentDesktopSkinPreload(api, {
    setZoomFactor: vi.fn(),
    getZoomFactor: () => 1,
  });
  expect(() =>
    api.openTerminal({} as Parameters<Api["openTerminal"]>[0]),
  ).toThrow(failure);
  expect(counters.terminalOpenCount()).toBe(1);
});
