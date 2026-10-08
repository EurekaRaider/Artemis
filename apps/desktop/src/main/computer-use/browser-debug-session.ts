import { nativeImage, type WebContents } from "electron";
import {
  browserPreviewCommandSchema,
  type BrowserDiagnostic,
  type BrowserElementInspection,
  type BrowserPreviewCommand,
  type BrowserPreviewSnapshot,
  type BrowserViewport,
} from "@artemis/protocol";

/** Never retain URL credentials, fragments, query values or raw protocol events. */
export function diagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 1000);
  } catch {
    return "";
  }
}
export function diagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/g, (url) => diagnosticUrl(url))
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(
      /\b(password|passwd|token|secret|authorization|cookie|api[-_]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 1500);
}

/** The one debugger connection shared by preview and Computer Use. */
export class BrowserDebugSession {
  private readonly debug: WebContents["debugger"];
  private viewport: BrowserViewport | null = null;
  private entries: BrowserDiagnostic[] = [];
  private sequence = 0;
  private navigationId = 0;
  private ready: Promise<void> | undefined;
  private disposed = false;
  private manual = false;
  private readonly requests = new Map<
    string,
    { url: string; method: string; time: number; status?: number }
  >();
  constructor(
    readonly contents: WebContents,
    private readonly pause: () => void,
  ) {
    this.debug = contents.debugger;
    this.debug.on("message", this.message);
    this.debug.on("detach", this.detached);
    contents.on("did-start-navigation", this.navigation);
    contents.on("did-finish-load", this.restoreViewport);
    contents.on("devtools-opened", this.devtoolsOpened);
    contents.on("devtools-closed", this.devtoolsClosed);
    contents.on("render-process-gone", this.crashed);
    contents.once("destroyed", this.dispose);
  }
  private readonly navigation = (
    _event: unknown,
    _url: string,
    _inPlace: boolean,
    mainFrame: boolean,
  ) => {
    if (!mainFrame) return;
    this.navigationId += 1;
    this.requests.clear();
  };
  private readonly devtoolsOpened = () => {
    this.manual = true;
    this.pause();
  };
  private readonly restoreViewport = () => {
    if (
      !this.disposed &&
      !this.manual &&
      !this.contents.isDevToolsOpened() &&
      this.viewport
    )
      this.applyViewport();
  };
  private readonly devtoolsClosed = () => {
    this.manual = false;
    this.ready = undefined;
    void this.connect().catch(() => undefined);
  };
  private readonly detached = () => {
    this.ready = undefined;
    this.requests.clear();
    if (!this.disposed) this.pause();
  };
  private readonly crashed = () => {
    this.pause();
    this.dispose();
  };
  readonly dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.debug.removeListener("message", this.message);
    this.debug.removeListener("detach", this.detached);
    this.contents.removeListener("did-start-navigation", this.navigation);
    this.contents.removeListener("did-finish-load", this.restoreViewport);
    this.contents.removeListener("devtools-opened", this.devtoolsOpened);
    this.contents.removeListener("devtools-closed", this.devtoolsClosed);
    this.contents.removeListener("render-process-gone", this.crashed);
    this.contents.removeListener("destroyed", this.dispose);
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached())
      this.contents.debugger.detach();
    this.entries = [];
    this.requests.clear();
  };
  private check() {
    if (this.disposed || this.contents.isDestroyed())
      throw new Error("Browser closed or crashed. Reopen the tab.");
    if (this.manual || this.contents.isDevToolsOpened())
      throw new Error(
        "Close DevTools, then resume and observe before using AI browser tools.",
      );
    const url = this.contents.getURL();
    if (url !== "about:blank" && !/^(https?:|artemis-preview:)/.test(url))
      throw new Error("Unsupported browser document.");
  }
  async connect(): Promise<void> {
    this.check();
    if (this.ready) return this.ready;
    const debug = this.contents.debugger;
    if (!debug.isAttached()) debug.attach("1.3");
    this.ready = Promise.all(
      ["Runtime.enable", "Network.enable", "DOM.enable"].map((method) =>
        debug.sendCommand(method),
      ),
    )
      .then(() => debug.sendCommand("CSS.enable"))
      .then(() => {
        if (this.viewport) this.applyViewport();
      })
      .catch((error) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  async command<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    const result = await new Promise<unknown>((resolve, reject) => {
      let ended = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      const fail = (error: unknown) => {
        if (ended) return;
        ended = true;
        cleanup();
        reject(error);
        if (
          !this.contents.isDestroyed() &&
          !this.contents.isDevToolsOpened() &&
          this.debug.isAttached()
        )
          this.debug.detach();
      };
      const abort = () =>
        fail(signal.reason ?? new Error("Browser command cancelled"));
      const timer = setTimeout(
        () => fail(new Error("Browser command timed out: " + method)),
        5000,
      );
      signal.addEventListener("abort", abort, { once: true });
      void (async () => {
        await this.connect();
        if (ended) return;
        signal.throwIfAborted();
        this.check();
        return this.debug.sendCommand(method, params);
      })().then(
        (value) => {
          if (!ended) {
            ended = true;
            cleanup();
            resolve(value);
          }
        },
        (error) => {
          if (!ended) {
            ended = true;
            cleanup();
            reject(error);
          }
        },
      );
    });
    signal.throwIfAborted();
    this.check();
    return result as T;
  }
  private applyViewport() {
    if (this.viewport) {
      const { width, height, scale } = this.viewport;
      this.contents.enableDeviceEmulation({
        screenPosition: "desktop",
        screenSize: { width, height },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1,
        viewSize: { width, height },
        scale,
      });
    } else this.contents.disableDeviceEmulation();
  }
  private add(entry: Omit<BrowserDiagnostic, "id" | "time">) {
    this.entries.push({
      ...entry,
      id: ++this.sequence,
      time: Date.now(),
      text: diagnosticText(entry.text),
    });
    if (this.entries.length > 200)
      this.entries.splice(0, this.entries.length - 200);
  }
  private readonly message = (
    _event: unknown,
    method: string,
    params: Record<string, any>,
  ) => {
    if (this.disposed || this.manual) return;
    if (method === "Runtime.consoleAPICalled") {
      const args = (params.args ?? []).map(
        (arg: { type: string; value?: unknown }) =>
          ["string", "number", "boolean"].includes(arg.type)
            ? String(arg.value)
            : `[${arg.type}]`,
      );
      // Console CSS directives consume an argument but are not message text.
      let argument = 1;
      const formatted = (args[0] ?? "").replace(
        /%[%csdifOo]/g,
        (token: string) => {
          if (token === "%%") return "%";
          if (argument >= args.length) return token;
          const value = args[argument++];
          return token === "%c" ? "" : value;
        },
      );
      this.add({
        source: "console",
        level:
          params.type === "error"
            ? "error"
            : params.type === "warning"
              ? "warning"
              : "info",
        text: [formatted, ...args.slice(argument)].join(" "),
      });
    } else if (method === "Runtime.exceptionThrown") {
      const detail = params.exceptionDetails;
      this.add({
        source: "console",
        level: "error",
        text: String(
          detail?.exception?.description ??
            detail?.text ??
            "Uncaught exception",
        ),
        url: diagnosticUrl(detail?.url ?? ""),
      });
    } else if (method === "Network.requestWillBeSent") {
      if (this.requests.size >= 500)
        this.requests.delete(this.requests.keys().next().value!);
      this.requests.set(params.requestId, {
        url: diagnosticUrl(params.request.url),
        method: String(params.request.method).slice(0, 16),
        time: params.timestamp,
      });
    } else if (method === "Network.responseReceived") {
      const request = this.requests.get(params.requestId);
      if (request) request.status = params.response.status;
    } else if (
      method === "Network.loadingFinished" ||
      method === "Network.loadingFailed"
    ) {
      const request = this.requests.get(params.requestId);
      if (!request) return;
      this.requests.delete(params.requestId);
      const failed =
        method === "Network.loadingFailed" || (request.status ?? 0) >= 400;
      this.add({
        source: "network",
        level: failed ? "error" : "info",
        text: `${request.method} ${request.url} ${params.errorText ?? request.status ?? ""}`,
        url: request.url,
        ...(request.status === undefined ? {} : { status: request.status }),
        durationMs: Math.max(
          0,
          Math.round((params.timestamp - request.time) * 1000),
        ),
      });
    }
  };
  snapshot(): BrowserPreviewSnapshot {
    return {
      version: 1,
      targetId: `browser:${this.contents.id}`,
      url: diagnosticUrl(this.contents.getURL()),
      navigationId: this.navigationId,
      paused: this.manual || this.contents.isDevToolsOpened(),
      viewport: this.viewport ? { ...this.viewport } : null,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }
  async execute(
    input: BrowserPreviewCommand,
    signal: AbortSignal,
  ): Promise<BrowserPreviewSnapshot> {
    const command = browserPreviewCommandSchema.parse(input);
    if (this.disposed || this.contents.isDestroyed())
      throw new Error("Browser closed or crashed. Reopen the tab.");
    if (command.action === "snapshot") {
      if (!this.manual && !this.contents.isDevToolsOpened())
        await this.connect();
      return this.snapshot();
    }
    if (command.action === "devtools") {
      this.manual = true;
      this.pause();
      if (this.contents.debugger.isAttached()) this.contents.debugger.detach();
      this.contents.openDevTools({ mode: "detach" });
      return this.snapshot();
    }
    await this.connect();
    signal.throwIfAborted();
    if (command.action === "viewport") {
      const layoutChanged =
        this.viewport?.width !== command.viewport?.width ||
        this.viewport?.height !== command.viewport?.height;
      this.viewport = command.viewport;
      this.applyViewport();
      if (layoutChanged) this.navigationId += 1;
    } else if (command.action === "reload") {
      this.contents.reload();
    } else if (command.action === "clear") {
      this.entries = [];
      this.requests.clear();
    } else if (command.action === "screenshot") {
      const navigationId = this.navigationId;
      const { cssLayoutViewport: layout } = await this.command<{
        cssLayoutViewport: {
          pageX: number;
          pageY: number;
          clientWidth: number;
          clientHeight: number;
        };
      }>("Page.getLayoutMetrics", {}, signal);
      const { data } = await this.command<{ data: string }>(
        "Page.captureScreenshot",
        {
          format: "jpeg",
          quality: 70,
          captureBeyondViewport: true,
          clip: {
            x: layout.pageX,
            y: layout.pageY,
            width: layout.clientWidth,
            height: layout.clientHeight,
            scale: 1,
          },
        },
        signal,
      ).finally(() => this.restoreViewport());
      if (navigationId !== this.navigationId)
        throw new Error("Page changed during capture. Try again.");
      const pixels = nativeImage
        .createFromBuffer(Buffer.from(data, "base64"))
        .resize({ width: layout.clientWidth, height: layout.clientHeight })
        .toJPEG(70);
      return {
        ...this.snapshot(),
        image: { data: pixels.toString("base64"), mimeType: "image/jpeg" },
      };
    } else if (command.action === "inspect") {
      if (command.navigationId !== this.navigationId)
        throw new Error("Page changed. Select the element again.");
      const navigationId = this.navigationId;
      await this.command("DOM.getDocument", {}, signal);
      const hit = await this.command<{ backendNodeId: number; nodeId: number }>(
        "DOM.getNodeForLocation",
        {
          x: Math.round(command.x),
          y: Math.round(command.y),
          includeUserAgentShadowDOM: false,
        },
        signal,
      );
      const { node } = await this.command<{
        node: { nodeName: string; attributes?: string[] };
      }>(
        "DOM.describeNode",
        { backendNodeId: hit.backendNodeId, depth: 0 },
        signal,
      );
      const { model } = await this.command<{ model: { border: number[] } }>(
        "DOM.getBoxModel",
        { backendNodeId: hit.backendNodeId },
        signal,
      );
      const attributes: Record<string, string> = {};
      for (let i = 0; i < (node.attributes?.length ?? 0); i += 2) {
        const key = node.attributes![i]!;
        if (["id", "class", "role", "type"].includes(key))
          attributes[key] = diagnosticText(node.attributes![i + 1] ?? "").slice(
            0,
            250,
          );
      }
      const { computedStyle } = await this.command<{
        computedStyle: Array<{ name: string; value: string }>;
      }>("CSS.getComputedStyleForNode", { nodeId: hit.nodeId }, signal).catch(
        () => ({ computedStyle: [] }),
      );
      const styles = Object.fromEntries(
        computedStyle
          .filter((item) =>
            [
              "display",
              "position",
              "width",
              "height",
              "color",
              "background-color",
              "font-size",
              "margin",
              "padding",
            ].includes(item.name),
          )
          .map((item) => [item.name, item.value]),
      );
      if (navigationId !== this.navigationId)
        throw new Error("Page changed. Select the element again.");
      const xs = model.border.filter((_, i) => i % 2 === 0),
        ys = model.border.filter((_, i) => i % 2 === 1);
      const inspection: BrowserElementInspection = {
        navigationId,
        tag: node.nodeName,
        attributes,
        styles,
        regionOnly: node.nodeName === "IFRAME",
        bounds: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
      };
      return { ...this.snapshot(), inspection };
    }
    return this.snapshot();
  }
}
