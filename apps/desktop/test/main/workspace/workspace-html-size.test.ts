import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { workspaceHtmlSizeScript } from "../../../src/main/workspace/workspace-html-size.js";

it("does not grow a viewport-sized page after delayed resize deliveries, but still reports content changes", () => {
  let resize!: () => void;
  let mutate!: () => void;
  let contentHeight: number | undefined;
  const frames: Array<() => void> = [];
  const reports: Array<{ height: number }> = [];
  const context = {
    innerWidth: 800,
    innerHeight: 360,
    scrollY: 0,
    getComputedStyle: () => ({ marginBottom: "8px" }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    addEventListener() {},
    parent: { postMessage: (data: { height: number }) => reports.push(data) },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
    },
    document: {
      readyState: "complete",
      addEventListener() {},
      fonts: { ready: { then() {} } },
      body: {
        offsetTop: 8,
        get scrollHeight() {
          return contentHeight ?? context.innerHeight;
        },
        getBoundingClientRect: () => ({
          bottom: (contentHeight ?? context.innerHeight) + 8,
        }),
      },
      documentElement: {
        get clientHeight() {
          return context.innerHeight;
        },
        get scrollHeight() {
          return Math.max(
            context.innerHeight,
            (contentHeight ?? context.innerHeight) + 16,
          );
        },
      },
    },
  };
  const script = workspaceHtmlSizeScript("artemis-preview://lease/index.html");
  runInNewContext(
    script.slice("<script>".length, -"</script>".length),
    context,
  );
  const measure = () => frames.shift()!();
  measure();
  expect(reports.map((report) => report.height)).toEqual([376]);
  context.innerHeight = 376;
  resize();
  measure();
  resize();
  measure();
  expect(reports).toHaveLength(1);
  contentHeight = 900;
  mutate();
  measure();
  expect(reports.at(-1)?.height).toBe(916);
  contentHeight = 100;
  mutate();
  measure();
  expect(reports.at(-1)?.height).toBe(116);
});

it("leaves ordinary wheel input native and hands off a latched inner scroller only at its edge", () => {
  class Scroller extends EventTarget {
    scrollTop = 20;
    scrollHeight = 300;
    clientHeight = 100;
  }
  const inner = new Scroller();
  const reports: unknown[] = [];
  const listeners = new Map<string, EventListener>();
  const source = workspaceHtmlSizeScript("artemis-preview://lease/sample.html");
  runInNewContext(source.slice("<script>".length, -"</script>".length), {
    window: {},
    parent: { postMessage: (data: unknown) => reports.push(data) },
    Element: Scroller,
    innerWidth: 800,
    innerHeight: 360,
    document: { readyState: "loading", addEventListener() {} },
    addEventListener: (name: string, listener: EventListener) =>
      listeners.set(name, listener),
    getComputedStyle: () => ({ overflowY: "auto" }),
  });
  expect(listeners.has("wheel")).toBe(false);
  const scroll = new Event("scroll");
  Object.defineProperty(scroll, "target", { value: inner });
  listeners.get("scroll")!(scroll);
  const wheel = () => {
    const event = Object.assign(new Event("wheel", { cancelable: true }), {
      deltaY: 25,
      deltaMode: 0,
      composedPath: () => [inner],
    });
    inner.dispatchEvent(event);
    return event;
  };
  expect(wheel().defaultPrevented).toBe(false);
  inner.scrollTop = 200;
  expect(wheel().defaultPrevented).toBe(true);
  expect(reports).toEqual([
    {
      type: "artemis:html-wheel",
      version: 1,
      url: "artemis-preview://lease/sample.html",
      deltaY: 25,
    },
  ]);
});
