// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeHistoryTurn } from "../../../src/renderer/conversation/history-visibility.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the buffered observer during ordinary scrolling without measuring every turn", () => {
  let intersect!: IntersectionObserverCallback;
  let frame!: FrameRequestCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const scroller = document.createElement("div");
  scroller.className = "timeline-scroll";
  const turns = Array.from({ length: 50 }, () => document.createElement("div"));
  scroller.append(...turns);
  document.body.append(scroller);
  const notifications = turns.map(() => vi.fn());
  const cleanups = turns.map((turn, index) =>
    observeHistoryTurn(turn, notifications[index]!),
  );
  const entries = turns.map((target) => ({
    target,
    isIntersecting: false,
  })) as IntersectionObserverEntry[];
  intersect(entries, {} as IntersectionObserver);
  const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
  scroller.scrollTop = 120;
  scroller.dispatchEvent(new Event("scroll"));
  frame(0);
  expect(measure).not.toHaveBeenCalled();
  cleanups.forEach((cleanup) => cleanup());
});

it("does not repeat identical visibility notifications", () => {
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const scroller = document.createElement("div");
  scroller.className = "timeline-scroll";
  const turn = document.createElement("div");
  scroller.append(turn);
  document.body.append(scroller);
  const notify = vi.fn();
  const cleanup = observeHistoryTurn(turn, notify);
  const entries = [
    { target: turn, isIntersecting: true },
  ] as IntersectionObserverEntry[];
  intersect(entries, {} as IntersectionObserver);
  intersect(entries, {} as IntersectionObserver);
  expect(notify).toHaveBeenCalledExactlyOnceWith(true);
  cleanup();
});

it("mounts immediately after a jump past the observer buffer", () => {
  let intersect!: IntersectionObserverCallback;
  let frame!: FrameRequestCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const scroller = document.createElement("div");
  scroller.className = "timeline-scroll";
  const turn = document.createElement("div");
  scroller.append(turn);
  document.body.append(scroller);
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 500,
  } as DOMRect);
  vi.spyOn(turn, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 600,
  } as DOMRect);
  const notify = vi.fn();
  const cleanup = observeHistoryTurn(turn, notify);
  intersect(
    [{ target: turn, isIntersecting: false }] as IntersectionObserverEntry[],
    {} as IntersectionObserver,
  );
  scroller.scrollTop = 5000;
  scroller.dispatchEvent(new Event("scroll"));
  frame(0);
  expect(notify.mock.calls).toEqual([[false], [true]]);
  cleanup();
});
