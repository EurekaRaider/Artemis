import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { NativeImage, WebContents } from "electron";
import type {
  ComputerAction,
  ComputerElement,
  ComputerFrame,
  ComputerOpen,
  ComputerTarget,
} from "@artemis/protocol";
import type { ComputerContext, ComputerDriver } from "./service.js";

interface BrowserTarget {
  contents: WebContents;
  threadId: string;
  scale: number;
  nodes: Map<string, number>;
  expectedMouse?: { type: string; x: number; y: number };
}
interface AXNode {
  nodeId: string;
  parentId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  value?: { value: unknown };
  properties?: Array<{ name: string; value: { value: unknown } }>;
}
const roles = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "combobox",
  "radio",
  "menuitem",
  "tab",
  "heading",
  "StaticText",
  "listbox",
  "option",
]);
export class ComputerBrowserDriver implements ComputerDriver {
  private readonly browsers = new Map<string, BrowserTarget>();
  private readonly navigation = new WeakMap<ComputerTarget, string>();
  constructor(
    private readonly requestBrowser: (
      context: ComputerContext,
      signal: AbortSignal,
    ) => Promise<WebContents>,
    private readonly takeover: (threadId: string) => void,
  ) {}
  register(contents: WebContents, threadId: string) {
    const id = `browser:${contents.id}`;
    const existing = this.browsers.get(id);
    if (existing) {
      if (existing.threadId !== threadId)
        throw new Error("Browser belongs to another task.");
      return;
    }
    this.browsers.set(id, { contents, threadId, scale: 1, nodes: new Map() });
    contents.once("destroyed", () => {
      this.browsers.delete(id);
      this.takeover(threadId);
    });
    // CDP mouse dispatch also emits before-mouse-event. Match only the exact
    // pending synthetic event; other input always pauses the task.
    contents.on("before-input-event", () => this.takeover(threadId));
    contents.on("before-mouse-event", (_event, mouse) => {
      const browser = this.browsers.get(id);
      const expected = browser?.expectedMouse;
      if (
        expected &&
        mouse.type === expected.type &&
        Math.abs(mouse.x - expected.x) < 1 &&
        Math.abs(mouse.y - expected.y) < 1
      ) {
        delete browser!.expectedMouse;
      } else if (["mouseDown", "mouseWheel"].includes(mouse.type))
        this.takeover(threadId);
    });
  }
  private description(id: string, browser: BrowserTarget): ComputerTarget {
    return {
      id,
      kind: "browser",
      name: browser.contents.getTitle() || "Artemis Browser",
      url: browser.contents.getURL(),
    };
  }
  async targets(context: ComputerContext) {
    return [...this.browsers]
      .filter(
        ([, b]) => b.threadId === context.threadId && !b.contents.isDestroyed(),
      )
      .map(([id, b]) => this.description(id, b));
  }
  async open(
    input: ComputerOpen,
    context: ComputerContext,
    signal: AbortSignal,
  ) {
    let entry =
      input.target === "browser"
        ? [...this.browsers].find(
            ([, b]) =>
              b.threadId === context.threadId && !b.contents.isDestroyed(),
          )
        : [...this.browsers].find(([id]) => id === input.target);
    if (!entry && input.target === "browser") {
      const contents = await this.requestBrowser(context, signal);
      signal.throwIfAborted();
      this.register(contents, context.threadId);
      entry = [
        `browser:${contents.id}`,
        this.browsers.get(`browser:${contents.id}`)!,
      ];
    }
    if (!entry || entry[1].threadId !== context.threadId)
      throw new Error("Browser is not owned by this task.");
    const target = this.description(...entry);
    if (input.url) {
      const url = new URL(input.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Computer Use Browser supports HTTP and HTTPS only.");
      // Navigation belongs to this candidate lease, and runs only after authorization.
      this.navigation.set(target, url.href);
    }
    return target;
  }
  private browser(target: ComputerTarget) {
    const browser = this.browsers.get(target.id);
    if (!browser || browser.contents.isDestroyed())
      throw new Error("Browser closed. Open it again.");
    return browser;
  }
  private async command<T = Record<string, unknown>>(
    browser: BrowserTarget,
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    const debug = browser.contents.debugger;
    if (!debug.isAttached()) debug.attach("1.3");
    if (method === "Input.dispatchMouseEvent")
      browser.expectedMouse = {
        type:
          params.type === "mousePressed"
            ? "mouseDown"
            : params.type === "mouseReleased"
              ? "mouseUp"
              : "mouseWheel",
        x: Number(params.x),
        y: Number(params.y),
      };
    let result: unknown;
    try {
      result = await debug.sendCommand(method, params);
    } finally {
      if (method === "Input.dispatchMouseEvent") delete browser.expectedMouse;
    }
    signal.throwIfAborted();
    return result as T;
  }
  private async capture(target: ComputerTarget, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const { contents } = this.browser(target);
      try {
        const image = await contents.capturePage();
        signal.throwIfAborted();
        if (image.isEmpty())
          throw new Error("Browser capture returned an empty image");
        return image;
      } catch (error) {
        signal.throwIfAborted();
        this.browser(target);
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/UnknownVizError|Current display surface not available for capture|Browser capture returned an empty image/u.test(
            message,
          )
        )
          throw error;
        if (attempt === 3)
          throw new Error(
            `Browser screenshot unavailable after 4 attempts: ${message}`,
            { cause: error },
          );
        // loadURL/DOM readiness can precede the compositor's first frame.
        // Repaint and retry only the readback; never reload, focus, or replay input.
        contents.invalidate();
        await delay(75 * 2 ** attempt, undefined, { signal });
      }
    }
  }
  async observe(
    target: ComputerTarget,
    image: boolean,
    signal: AbortSignal,
  ): Promise<ComputerFrame> {
    const browser = this.browser(target);
    let captured: NativeImage | undefined;
    const pendingUrl = this.navigation.get(target);
    if (pendingUrl) {
      const url = pendingUrl;
      this.navigation.delete(target);
      signal.throwIfAborted();
      await browser.contents.loadURL(url);
      signal.throwIfAborted();
      // The dock's opening animation can outlast navigation. Do not return
      // an intermediate viewport that will immediately fail the stale guard.
      let previousViewport: string | undefined;
      for (let attempt = 0; ; attempt++) {
        // A hidden guest may not deliver new layout metrics until readback
        // requests a compositor frame. Sample the painted viewport together.
        if (image) captured = await this.capture(target, signal);
        const layout = await this.command<{ cssLayoutViewport: unknown }>(
          browser,
          "Page.getLayoutMetrics",
          {},
          signal,
        );
        const viewport = JSON.stringify(layout.cssLayoutViewport);
        if (viewport === previousViewport) break;
        if (attempt === 10)
          throw new Error(
            "Browser viewport is still resizing. Observe again once the panel settles.",
          );
        previousViewport = viewport;
        await delay(100, undefined, { signal });
      }
    }
    const url = browser.contents.getURL();
    if (url !== "about:blank" && !/^https?:\/\//u.test(url))
      throw new Error("This browser document is unavailable to Computer Use.");
    target.url = url;
    target.name = browser.contents.getTitle() || "Artemis Browser";
    if (image && !captured) captured = await this.capture(target, signal);
    const [tree, layout] = await Promise.all([
      this.command<{ nodes: AXNode[] }>(
        browser,
        "Accessibility.getFullAXTree",
        {},
        signal,
      ),
      this.command<{
        cssLayoutViewport: {
          clientWidth: number;
          clientHeight: number;
          pageX: number;
          pageY: number;
        };
      }>(browser, "Page.getLayoutMetrics", {}, signal),
    ]);
    const viewport = layout.cssLayoutViewport;
    browser.scale = Math.min(
      1,
      1280 / Math.max(viewport.clientWidth, viewport.clientHeight),
    );
    browser.nodes.clear();
    const elements: ComputerElement[] = [];
    const nodesById = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    for (const node of tree.nodes) {
      if (
        node.ignored ||
        !roles.has(node.role?.value ?? "") ||
        elements.length >= 300
      )
        continue;
      if (
        node.properties?.some(
          (p) => p.name === "protected" && p.value.value === true,
        )
      )
        continue;
      let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      let fieldChild = false;
      for (let depth = 0; parent && depth < 20; depth++) {
        if (["textbox", "searchbox"].includes(parent.role?.value ?? "")) {
          fieldChild = true;
          break;
        }
        parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
      }
      if (fieldChild) continue;
      const id = `ax:${node.nodeId}`;
      if (node.backendDOMNodeId) browser.nodes.set(id, node.backendDOMNodeId);
      elements.push({
        id,
        role: node.role!.value,
        label: (node.name?.value ?? "").slice(0, 500),
        ...(node.value?.value === undefined
          ? {}
          : {
              value: String(node.value.value).slice(0, 2000),
              valueDigest: createHash("sha256")
                .update(String(node.value.value))
                .digest("hex"),
            }),
      });
    }
    const revision = createHash("sha256")
      .update(
        JSON.stringify([
          url,
          viewport,
          elements.map(
            ({ value: _value, valueDigest: _digest, ...element }) => element,
          ),
        ]),
      )
      .digest("hex");
    const frame: ComputerFrame = {
      revision,
      width: Math.max(1, Math.round(viewport.clientWidth * browser.scale)),
      height: Math.max(1, Math.round(viewport.clientHeight * browser.scale)),
      elements,
      foreground: false,
    };
    if (captured) {
      const pixels = captured
        .resize({ width: frame.width, height: frame.height })
        .toJPEG(60);
      frame.visualRevision = createHash("sha256").update(pixels).digest("hex");
      frame.image = { data: pixels.toString("base64"), mimeType: "image/jpeg" };
    }
    return frame;
  }
  async act(
    target: ComputerTarget,
    action: ComputerAction,
    signal: AbortSignal,
  ) {
    const browser = this.browser(target);
    const command = <T = Record<string, unknown>>(
      method: string,
      params: Record<string, unknown>,
    ) => this.command<T>(browser, method, params, signal);
    const key = async (name: string, modifiers = 0) => {
      await command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: name,
        modifiers,
        ...(name === "Enter" ? { windowsVirtualKeyCode: 13, text: "\r" } : {}),
      });
      await command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: name,
        modifiers,
      });
    };
    if (action.type === "key") {
      const flags = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      await key(
        action.key === "Space" ? " " : action.key,
        (action.modifiers ?? []).reduce((mask, flag) => mask | flags[flag], 0),
      );
      return;
    }
    if (action.type === "scroll") {
      const horizontal = ["left", "right"].includes(action.direction);
      const delta =
        action.amount * (["left", "up"].includes(action.direction) ? -1 : 1);
      await command("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 20,
        y: 20,
        deltaX: horizontal ? delta : 0,
        deltaY: horizontal ? 0 : delta,
      });
      return;
    }
    let x: number;
    let y: number;
    if (action.type === "click_at") {
      x = action.x / browser.scale;
      y = action.y / browser.scale;
    } else {
      const backendNodeId = browser.nodes.get(action.elementId);
      if (!backendNodeId) throw new Error("This element is not actionable.");
      if (action.type === "fill") {
        await command("DOM.focus", { backendNodeId });
      }
      const { model } = await command<{ model: { content: number[] } }>(
        "DOM.getBoxModel",
        { backendNodeId },
      );
      x = (model.content[0]! + model.content[4]!) / 2;
      y = (model.content[1]! + model.content[5]!) / 2;
    }
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    if (action.type === "fill") {
      // DOM.focus alone does not focus an embedded guest's input widget.
      // Targeted CDP input does not move the system pointer or activate a window.
      // Chromium's edit command works even without the macOS menu accelerator.
      await command("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: process.platform === "darwin" ? 4 : 2,
        commands: ["selectAll"],
      });
      await command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
      });
      await command("Input.insertText", { text: action.text });
    }
  }
  async release(target: ComputerTarget) {
    const debug = this.browsers.get(target.id)?.contents.debugger;
    if (debug?.isAttached()) debug.detach();
  }
}
