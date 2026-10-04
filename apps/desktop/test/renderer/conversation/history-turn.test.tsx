// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HistoryTurn } from "../../../src/renderer/conversation/HistoryTurn.js";

let top = 2_000;
let frame: FrameRequestCallback | undefined;
const cancelFrame = vi.fn();

beforeEach(() => {
  top = 2_000;
  frame = undefined;
  cancelFrame.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 42;
  });
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const y = this.classList.contains("timeline-scroll") ? 0 : top;
      return {
        top: y,
        bottom: y + 500,
        height: 500,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y,
        toJSON() {},
      };
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <div className="timeline-scroll">
      <HistoryTurn cacheKey="test:turn" initialVisible={false} active={false}>
        {() => <p>History content</p>}
      </HistoryTurn>
    </div>,
  );
}
it("mounts an intersecting turn before the asynchronous observer fires", () => {
  top = 100;
  expect(mount().queryByText("History content")).not.toBeNull();
});
it("mounts after scroll restoration even while the observer is delayed", () => {
  const view = mount();
  expect(view.queryByText("History content")).toBeNull();
  top = 100;
  fireEvent.scroll(view.container.firstChild!);
  act(() => frame!(0));
  expect(view.queryByText("History content")).not.toBeNull();
});
it("cancels a pending scroll frame when switching away from the thread", () => {
  const view = mount();
  fireEvent.scroll(view.container.firstChild!);
  view.unmount();
  expect(cancelFrame).toHaveBeenCalledWith(42);
});
