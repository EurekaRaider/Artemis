// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserSessionSnapshot } from "@artemis/protocol";
import { PreviewCanvas } from "../../../src/renderer/computer-use/PreviewCanvas.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

const browser: BrowserSessionSnapshot = {
  threadId: "task",
  tabId: "browser",
  sessionId: "session",
  contentsId: 1,
  url: "https://example.test/",
  title: "Page",
  width: 800,
  height: 600,
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    width: 400,
    height: 300,
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const command = vi.fn(async () => {});
  stubWindowArtemis({
    browserSession: command,
    computerPreview: command,
    bindPreviewCanvas: vi.fn(),
    unbindPreviewCanvas: vi.fn(),
    browserPreview: vi.fn(async () => ({ image: undefined }) as never),
  });
  return command;
}

it("positions native browser content without starting a capture stream and parks it on unmount", async () => {
  const command = fixture();
  const { unmount } = render(
    <PreviewCanvas
      sessionId="session"
      browser={{ ...browser, nativeView: true }}
      label="Browser"
    />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "subscribe",
        width: 400,
        height: 300,
        nativeBounds: { x: 10, y: 20, width: 400, height: 300 },
      }),
    ),
  );
  expect(window.artemis.bindPreviewCanvas).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
  command.mockClear();
  screen
    .getByRole("img")
    .dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 5 }));
  expect(command).not.toHaveBeenCalled();
  unmount();
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({ action: "unsubscribe" }),
  );
});

it("hides a native browser for host overlays, preserves its dimensions, and restores it without resubscribing to video", async () => {
  const command = fixture();
  const { unmount } = render(
    <PreviewCanvas
      sessionId="session"
      browser={{ ...browser, nativeView: true }}
      label="Browser"
    />,
  );
  const dialog = document.createElement("dialog");
  dialog.open = true;
  act(() => document.body.append(dialog));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "subscribe",
        width: 400,
        height: 300,
        nativeBounds: null,
      }),
    ),
  );
  expect(window.artemis.browserPreview).toHaveBeenCalledTimes(1);
  act(() => dialog.remove());
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nativeBounds: { x: 10, y: 20, width: 400, height: 300 },
      }),
    ),
  );
  expect(window.artemis.bindPreviewCanvas).not.toHaveBeenCalled();
  unmount();
});

it("cancels native wheel scrolling and forwards fractional pixel deltas once", () => {
  const command = fixture();
  const { unmount } = render(
    <PreviewCanvas sessionId="session" browser={browser} label="Browser" />,
  );
  const canvas = screen.getByRole("img");
  command.mockClear();
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 110,
    clientY: 95,
    deltaX: 0.25,
    deltaY: 3.5,
    ctrlKey: true,
  });
  canvas.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(command).toHaveBeenCalledExactlyOnceWith({
    action: "input",
    threadId: "task",
    tabId: "browser",
    token: expect.any(String),
    input: {
      type: "mouseWheel",
      x: 200,
      y: 150,
      deltaX: -0.25,
      deltaY: -3.5,
      modifiers: ["control"],
    },
  });
  unmount();
  command.mockClear();
  canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 10 }));
  expect(command).not.toHaveBeenCalled();
});

it("leaves passive computer previews non-interactive after changing surfaces", () => {
  const command = fixture();
  const { rerender } = render(
    <PreviewCanvas sessionId="session" browser={browser} label="Browser" />,
  );
  rerender(<PreviewCanvas sessionId="desktop" label="Desktop" />);
  command.mockClear();
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 10,
  });
  screen.getByRole("img").dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(command).not.toHaveBeenCalled();
});
