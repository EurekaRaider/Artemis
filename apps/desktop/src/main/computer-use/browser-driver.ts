import { BrowserDebugSession } from "./browser-debug-session.js";
import type { BrowserPreviewCommand } from "@artemis/protocol";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { nativeImage, type NativeImage, type WebContents } from "electron";
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
  debug: BrowserDebugSession;
  cleanup: () => void;
  nodes: Map<string, number>;
  expectedMouse?: { type: string; x: number; y: number };
  captureViaProtocol?: boolean;
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

// Fixed host-owned operation on an observed node. No page script or model-supplied
// JavaScript is accepted. Native <option> elements do not have clickable boxes.
const prepareElement = `function(type, text, point) {
  if (!this.isConnected) throw new Error("Element was detached. Observe again.");
  if (this.disabled || this.matches?.(":disabled") || this.getAttribute?.("aria-disabled") === "true")
    throw new Error("Control is disabled.");
  const assertHit = (element, point) => {
    let hit = element.ownerDocument.elementFromPoint(point.x, point.y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (!hit || (hit !== element && !element.contains(hit)))
      throw new Error("Control is covered or outside the viewport. Observe again.");
  };
  if (type === "hit") { assertHit(this.nodeType === 3 ? this.parentElement : this, point); return false; }
  const option = this instanceof HTMLOptionElement ? this : null;
  if (option && type !== "click") throw new Error("Click an option, or fill its select with the option label.");
  const select = this instanceof HTMLSelectElement ? this : option?.closest("select");
  if (select && (type === "fill" || option)) {
    if (select.disabled || select.matches(":disabled")) throw new Error("Select is disabled.");
    if (!select.getClientRects().length || getComputedStyle(select).visibility !== "visible")
      throw new Error("Select is not visible.");
    if (select.multiple && type === "fill") throw new Error("Click an observed option in a multiple select.");
    const matches = option ? [option] : Array.from(select.options).filter(o => o.label === text);
    if (matches.length !== 1) throw new Error("Select requires one exact observed option label.");
    const chosen = matches[0];
    if (chosen.disabled || chosen.parentElement?.disabled) throw new Error("Option is disabled.");
    select.scrollIntoView({block:"nearest", inline:"nearest", behavior:"instant"});
    const rect = select.getBoundingClientRect();
    assertHit(select, {x:(Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2,
      y:(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2});
    select.focus({preventScroll:true});
    if (!chosen.selected) {
      select.selectedIndex = chosen.index;
      select.dispatchEvent(new Event("input", {bubbles:true}));
      select.dispatchEvent(new Event("change", {bubbles:true}));
    }
    if (!chosen.selected) throw new Error("Option selection did not take effect.");
    return true;
  }
  if (type === "fill" || type === "focused") {
    const editable = this instanceof HTMLTextAreaElement ||
      (this instanceof HTMLInputElement && ["text","search","email","url","tel","number"].includes(this.type)) ||
      this.isContentEditable;
    if (!editable || this.disabled || this.readOnly || this.matches(":disabled"))
      throw new Error("Fill requires an enabled editable text field or a native select option label.");
    const active = this.getRootNode().activeElement;
    if (type === "focused" && active !== this && !this.contains(active))
      throw new Error("Text field did not receive focus; no text was replaced.");
  }
  return false;
}`;

const browserKeys = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Space: 32,
} as const;

export class ComputerBrowserDriver implements ComputerDriver {
  private readonly browsers = new Map<string, BrowserTarget>();
  private readonly navigation = new WeakMap<ComputerTarget, string>();
  constructor(
    private readonly requestBrowser: (
      context: ComputerContext,
      signal: AbortSignal,
    ) => Promise<WebContents>,
    private readonly takeover: (threadId: string, targetId: string) => void,
  ) {}
  register(contents: WebContents, threadId: string) {
    const id = `browser:${contents.id}`;
    const existing = this.browsers.get(id);
    if (existing) {
      if (existing.threadId !== threadId)
        throw new Error("Browser belongs to another task.");
      return;
    }
    this.browsers.set(id, {
      contents,
      threadId,
      scale: 1,
      nodes: new Map(),
      debug: new BrowserDebugSession(contents, () =>
        this.takeover(threadId, id),
      ),
      cleanup: () => {},
    });
    contents.once("destroyed", () => {
      this.browsers.delete(id);
      this.takeover(threadId, id);
    });
    // CDP mouse dispatch also emits before-mouse-event. Match only the exact
    // pending synthetic event; other input pauses this target's active control.
    const input = () => this.takeover(threadId, id);
    contents.on("before-input-event", input);
    const mouseInput = (
      _event: Electron.Event,
      mouse: Electron.MouseInputEvent,
    ) => {
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
        this.takeover(threadId, id);
    };
    contents.on("before-mouse-event", mouseInput);
    this.browsers.get(id)!.cleanup = () => {
      contents.removeListener("before-input-event", input);
      contents.removeListener("before-mouse-event", mouseInput);
    };
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
      result = await browser.debug.command(method, params, signal);
    } finally {
      if (method === "Input.dispatchMouseEvent") delete browser.expectedMouse;
    }
    signal.throwIfAborted();
    return result as T;
  }
  private async capture(target: ComputerTarget, signal: AbortSignal) {
    const contents = this.browser(target).contents;
    const throttled =
      process.platform === "win32" && contents.getBackgroundThrottling();
    if (throttled) contents.setBackgroundThrottling(false);
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        const browser = this.browser(target);
        const { contents, debug } = browser;
        const protocolCapture = async () =>
          nativeImage.createFromBuffer(
            Buffer.from(
              (await debug.execute({ action: "screenshot" }, signal)).image!
                .data,
              "base64",
            ),
          );
        try {
          const image =
            debug.snapshot().viewport || browser.captureViaProtocol
              ? await protocolCapture()
              : await contents.capturePage(undefined, {
                  stayHidden: true,
                  stayAwake: true,
                });
          signal.throwIfAborted();
          if (image.isEmpty())
            throw new Error("Browser capture returned an empty image");
          return image;
        } catch (error) {
          signal.throwIfAborted();
          this.browser(target);
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            !/UnknownVizError|Current display surface not available for capture|Browser capture returned an empty image/u.test(
              message,
            )
          )
            throw error;
          if (
            attempt === 3 &&
            process.platform === "win32" &&
            !browser.captureViaProtocol
          ) {
            // Windows can lose the guest's Viz readback surface after hiding it.
            // CDP captures the authorized guest without showing its host window.
            try {
              const image = await protocolCapture();
              signal.throwIfAborted();
              if (!image.isEmpty()) {
                browser.captureViaProtocol = true;
                return image;
              }
            } catch {
              signal.throwIfAborted();
              this.browser(target);
            }
          }
          if (attempt === 3)
            throw new Error(
              `Browser screenshot unavailable after 4 attempts: ${message}`,
              { cause: error },
            );
          // loadURL/DOM readiness can precede the compositor's first frame.
          // Repaint and retry only the readback; never reload, focus, or replay input.
          contents.invalidate();
          const host = contents.hostWebContents;
          if (host && !host.isDestroyed()) host.invalidate();
          await delay(75 * 2 ** attempt, undefined, { signal });
        }
      }
    } finally {
      if (throttled && !contents.isDestroyed())
        contents.setBackgroundThrottling(true);
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
    if (url !== "about:blank" && !/^(https?:\/\/|artemis-preview:)/u.test(url))
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
        ...Object.fromEntries(
          (node.properties ?? []).flatMap(({ name, value }) => {
            const key = name === "readonly" ? "readOnly" : name;
            if (
              ![
                "checked",
                "selected",
                "disabled",
                "readOnly",
                "expanded",
              ].includes(key)
            )
              return [];
            const state =
              value.value === "true"
                ? true
                : value.value === "false"
                  ? false
                  : value.value;
            return typeof state === "boolean" ||
              (key === "checked" && state === "mixed")
              ? [[key, state]]
              : [];
          }),
        ),
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
          browser.debug.snapshot().navigationId,
          viewport,
          elements.map(
            ({
              value: _value,
              valueDigest: _digest,
              checked: _checked,
              selected: _selected,
              ...element
            }) => element,
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
    const key = async (name: keyof typeof browserKeys, modifiers = 0) => {
      const event = {
        key: name === "Space" ? " " : name,
        code: name,
        windowsVirtualKeyCode: browserKeys[name],
        modifiers,
      };
      const text = name === "Enter" ? "\r" : name === "Space" ? " " : undefined;
      await command("Input.dispatchKeyEvent", {
        ...event,
        type: text && !(modifiers & 7) ? "keyDown" : "rawKeyDown",
        ...(text && !(modifiers & 7) ? { text, unmodifiedText: text } : {}),
      });
      await command("Input.dispatchKeyEvent", {
        ...event,
        type: "keyUp",
      });
    };
    if (action.type === "key") {
      const flags = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      await key(
        action.key,
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
      if (
        await this.prepareElement(
          browser,
          backendNodeId,
          action.type,
          action.type === "fill" ? action.text : "",
          signal,
        )
      )
        return;
      await command("DOM.scrollIntoViewIfNeeded", { backendNodeId });
      if (action.type === "fill") {
        await command("DOM.focus", { backendNodeId });
      }
      const { model } = await command<{ model: { content: number[] } }>(
        "DOM.getBoxModel",
        { backendNodeId },
      );
      x = (model.content[0]! + model.content[4]!) / 2;
      y = (model.content[1]! + model.content[5]!) / 2;
      await this.prepareElement(browser, backendNodeId, "hit", "", signal, {
        x,
        y,
      });
    }
    const displayScale = browser.debug.snapshot().viewport?.scale ?? 1;
    x *= displayScale;
    y *= displayScale;
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
      await this.prepareElement(
        browser,
        browser.nodes.get(action.elementId)!,
        "focused",
        "",
        signal,
      );
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
  private async prepareElement(
    browser: BrowserTarget,
    backendNodeId: number,
    type: "click" | "fill" | "focused" | "hit",
    text: string,
    signal: AbortSignal,
    point?: { x: number; y: number },
  ): Promise<boolean> {
    const { object } = await this.command<{ object: { objectId?: string } }>(
      browser,
      "DOM.resolveNode",
      { backendNodeId },
      signal,
    );
    if (!object.objectId)
      throw new Error("Element is unavailable. Observe again.");
    try {
      const response = await this.command<{
        result: { value?: boolean };
        exceptionDetails?: {
          exception?: { description?: string };
          text: string;
        };
      }>(
        browser,
        "Runtime.callFunctionOn",
        {
          objectId: object.objectId,
          functionDeclaration: prepareElement,
          arguments: [
            { value: type },
            { value: text },
            { value: point ?? null },
          ],
          returnByValue: true,
        },
        signal,
      );
      if (response.exceptionDetails)
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text,
        );
      return response.result.value === true;
    } finally {
      // Release the remote handle even if the operation was cancelled.
      if (
        !browser.contents.isDestroyed() &&
        browser.contents.debugger.isAttached()
      )
        await browser.contents.debugger
          .sendCommand("Runtime.releaseObject", { objectId: object.objectId })
          .catch(() => {});
    }
  }
  async preview(
    threadId: string,
    contentsId: number,
    command: BrowserPreviewCommand,
    signal = new AbortController().signal,
  ) {
    const browser = this.browsers.get(`browser:${contentsId}`);
    if (
      !browser ||
      browser.threadId !== threadId ||
      browser.contents.isDestroyed()
    )
      throw new Error("Browser is not owned by this task.");
    if (["viewport", "inspect", "reload", "devtools"].includes(command.action))
      this.takeover(threadId, `browser:${contentsId}`);
    return browser.debug.execute(command, signal);
  }
  async debug(
    target: ComputerTarget,
    command: BrowserPreviewCommand,
    signal: AbortSignal,
  ) {
    return this.browser(target).debug.execute(command, signal);
  }
  async humanInput(
    threadId: string,
    contentsId: number,
    input: import("@artemis/protocol").BrowserHumanInput,
  ) {
    const browser = this.browsers.get(`browser:${contentsId}`);
    if (
      !browser ||
      browser.threadId !== threadId ||
      browser.contents.isDestroyed()
    )
      throw new Error("Browser is not owned by this task.");
    if (input.type !== "mouseMove" || input.buttons)
      this.takeover(threadId, `browser:${contentsId}`);
    const signal = new AbortController().signal;
    if (input.type === "text") await browser.contents.insertText(input.text);
    else if (input.type === "composition")
      await browser.debug.humanComposition(
        input.text,
        input.selectionStart,
        input.selectionEnd,
        signal,
      );
    else if ("x" in input)
      browser.contents.sendInputEvent({
        ...input,
        x: Math.round(input.x),
        y: Math.round(input.y),
        modifiers: [
          ...(input.modifiers ?? []),
          ...("buttons" in input && input.buttons
            ? [
                ...(input.buttons & 1 ? ["leftbuttondown" as const] : []),
                ...(input.buttons & 2 ? ["rightbuttondown" as const] : []),
                ...(input.buttons & 4 ? ["middlebuttondown" as const] : []),
              ]
            : []),
        ],
      });
    else {
      const shortcut =
        input.type === "keyDown" &&
        input.modifiers?.includes(
          process.platform === "darwin" ? "meta" : "control",
        );
      const key = input.keyCode.toLowerCase();
      if (shortcut && key === "a") browser.contents.selectAll();
      else if (shortcut && key === "c") browser.contents.copy();
      else if (shortcut && key === "x") browser.contents.cut();
      else if (shortcut && key === "z") {
        if (input.modifiers?.includes("shift")) browser.contents.redo();
        else browser.contents.undo();
      } else
        browser.contents.sendInputEvent({
          ...input,
          modifiers: input.modifiers ?? [],
        });
    }
  }
  clearThread(threadId: string) {
    for (const [id, browser] of this.browsers)
      if (browser.threadId === threadId) {
        browser.cleanup();
        browser.debug.dispose();
        this.browsers.delete(id);
      }
  }
  dispose() {
    for (const browser of this.browsers.values()) {
      browser.cleanup();
      browser.debug.dispose();
    }
    this.browsers.clear();
  }
  async release(_target: ComputerTarget) {
    // Releasing AI control does not stop user-requested preview diagnostics.
  }
}
