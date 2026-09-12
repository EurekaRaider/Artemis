import { randomUUID } from "node:crypto";
import {
  app,
  nativeImage,
  WebContentsView,
  session,
  webContents,
  type BrowserWindow,
  type WebFrameMain,
} from "electron";
import type {
  DesignInspection,
  DesignPreviewState,
  DesignRevision,
} from "@artemis/protocol";
import { designSourceMap, renderDesignPage } from "./design-document-source.js";
import { DesignWatchdog } from "./design-watchdog.js";

export const DESIGN_SCHEME = "artemis-design";
const pageCsp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'; sandbox allow-scripts";
const bridge = `<script>(()=>{let sent=0,tick=0;const send=data=>{const now=Math.floor(Date.now()/1000);if(now!==tick){tick=now;sent=0}if(++sent<=30)parent.postMessage(data,'*')};const error=console.error.bind(console);console.error=(...args)=>{send({type:'error',text:args.map(String).join(' ').slice(0,2000)});error(...args)};addEventListener('error',e=>send({type:'error',text:String(e.message).slice(0,2000)}));addEventListener('unhandledrejection',e=>send({type:'error',text:String(e.reason).slice(0,2000)}));addEventListener('click',e=>{const p=e.target.closest('[data-design-page]');if(p){e.preventDefault();send({type:'page',pageId:p.dataset.designPage})}const node=e.target.closest('[data-design-id]');if(node)send({type:'select',elementId:node.dataset.designId,text:node.textContent.slice(0,2000)})},true)})();</script>`;
const shellScript = `(()=>{const frame=document.querySelector('iframe');window.designState={errors:[]};let tick=0,count=0,flood=0;addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const now=Math.floor(Date.now()/1000);if(now!==tick){flood=count>30?flood+1:0;tick=now;count=0}if(++count>30){if(flood>=2)window.designState.flood=true;return}const data=event.data;if(!data||typeof data!=='object')return;let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(data)).byteLength}catch{return}if(bytes>65536)return;if(data.type==='select'&&typeof data.elementId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(data.elementId))window.designState.selection={elementId:data.elementId,text:String(data.text??'').slice(0,2000)};if(data.type==='page'&&typeof data.pageId==='string'&&data.pageId.length<=128)window.designState.pageId=data.pageId;if(data.type==='error'&&window.designState.errors.length<100)window.designState.errors.push(String(data.text).slice(0,160));});frame.src=frame.dataset.source;})();`;

function timeout<T>(promise: Promise<T>, milliseconds = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Preview did not respond.")),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Owns the only generated preview in this application. No renderer IPC bridge. */
export class DesignPreviewHost {
  private view: WebContentsView | undefined;
  private watchdog: DesignWatchdog | undefined;
  private current: DesignPreviewState | undefined;
  private threadId: string | undefined;
  private revision: DesignRevision | undefined;
  private generation = 0;
  private requestSerial = 0;
  private inspectingInstance: string | undefined;
  private inspectionQueue: Promise<unknown> = Promise.resolve();
  private releaseSession: (() => void) | undefined;
  private allowedPids = new Set<number>();
  private bounds = { x: 0, y: 0, width: 1000, height: 700 };
  private visible = false;
  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly authorize: (threadId: string) => Promise<void>,
  ) {}

  private generatedFrame(): WebFrameMain {
    const page = this.view?.webContents.mainFrame.framesInSubtree.find(
      (frame) => frame.url.endsWith("/page"),
    );
    if (!page) throw new Error("Generated page is unavailable.");
    return page;
  }
  state(threadId: string): DesignPreviewState | undefined {
    return this.threadId === threadId && this.current
      ? structuredClone(this.current)
      : undefined;
  }
  setBounds(
    threadId: string,
    instanceId: string,
    bounds: { x: number; y: number; width: number; height: number },
    visible: boolean,
  ) {
    if (
      this.threadId !== threadId ||
      this.current?.instanceId !== instanceId ||
      !this.view
    )
      return;
    if (Object.values(bounds).some((value) => !Number.isFinite(value)))
      throw new Error("Invalid preview bounds.");
    const inspecting = this.inspectingInstance === instanceId;
    this.visible = visible;
    if (!visible) {
      // Renderer cleanup supplies a dummy rectangle. Keep the last real viewport
      // so an inspection can paint while the panel is hidden or transitioning.
      this.view.setVisible(inspecting);
      return;
    }
    const window = this.window();
    if (!window) return;
    const [width = 0, height = 0] = window.getContentSize();
    const zoom = window.webContents.getZoomFactor();
    bounds = {
      x: bounds.x * zoom,
      y: bounds.y * zoom,
      width: bounds.width * zoom,
      height: bounds.height * zoom,
    };
    const x = Math.max(0, Math.min(width, Math.round(bounds.x)));
    const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    this.bounds = {
      x,
      y,
      width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
    };
    this.visible = visible;
    this.view.setBounds(this.bounds);
    this.view.setVisible(visible || inspecting);
  }
  suspendVisibility() {
    const instance = this.current?.instanceId;
    const visible = this.visible;
    this.view?.setVisible(false);
    return () => {
      if (this.current?.instanceId === instance) this.view?.setVisible(visible);
    };
  }
  hide() {
    this.visible = false;
    this.view?.setVisible(false);
  }
  stop(reason?: string, supersede = true) {
    if (supersede) this.requestSerial += 1;
    this.generation += 1;
    this.watchdog?.dispose();
    this.watchdog = undefined;
    const view = this.view;
    this.view = undefined;
    this.releaseSession?.();
    this.releaseSession = undefined;
    if (this.current)
      this.current = {
        ...this.current,
        status: reason ? "failed" : "stopped",
        ...(reason ? { error: reason } : {}),
      };
    if (!view || view.webContents.isDestroyed()) return;
    // Recheck every other webContents before using a process-wide termination API.
    const foreign = new Set(
      webContents
        .getAllWebContents()
        .filter(
          (contents) =>
            contents !== view.webContents && !contents.isDestroyed(),
        )
        .flatMap((contents) =>
          contents.mainFrame.framesInSubtree.map((frame) => frame.osProcessId),
        ),
    );
    const owned = view.webContents.mainFrame.framesInSubtree.map(
      (frame) => frame.osProcessId,
    );
    if (owned.every((pid) => pid > 0 && !foreign.has(pid))) {
      // Chromium can place an opaque child in a separate renderer. Crashing
      // only the shell leaves that child running, including an infinite loop.
      const shellPid = view.webContents.getOSProcessId();
      for (const pid of new Set(owned))
        if (pid !== shellPid) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              console.error("Could not terminate owned design renderer", error);
          }
        }
      view.webContents.forcefullyCrashRenderer();
    }
    this.window()?.contentView.removeChildView(view);
    view.webContents.close();
    this.allowedPids.clear();
  }
  async show(
    threadId: string,
    revision: DesignRevision,
    variantId: string,
    pageId: string,
    draft = false,
  ): Promise<DesignPreviewState> {
    const requestSerial = ++this.requestSerial;
    await this.authorize(threadId);
    if (requestSerial !== this.requestSerial)
      throw new Error("Preview request was superseded.");
    const page = revision.content.variants
      .find((item) => item.id === variantId)
      ?.pages.find((item) => item.id === pageId);
    if (!page) throw new Error("Design page does not exist.");
    const window = this.window();
    if (!window || window.isDestroyed())
      throw new Error("Desktop window is unavailable.");
    const previousSelection =
      this.threadId === threadId &&
      this.current?.revisionId === revision.revisionId &&
      this.current.pageId === pageId
        ? this.current.selection
        : undefined;
    let scroll: { x: number; y: number } | undefined;
    if (
      draft &&
      this.threadId === threadId &&
      this.current?.pageId === pageId &&
      this.view
    ) {
      try {
        scroll = (await timeout(
          this.generatedFrame().executeJavaScript("({x:scrollX,y:scrollY})"),
          300,
        )) as { x: number; y: number };
      } catch {
        /* A stopped preview has no runtime position to retain. */
      }
    }
    if (requestSerial !== this.requestSerial)
      throw new Error("Preview request was superseded.");
    this.stop(undefined, false);
    const generation = this.generation;
    const instanceId = randomUUID();
    const origin = `${DESIGN_SCHEME}://${instanceId}`;
    const isolated = session.fromPartition(`design-${instanceId}`);
    const allowed = new Set([
      `${origin}/shell`,
      `${origin}/shell.js`,
      `${origin}/page`,
    ]);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolated.on("will-download", (event) => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !allowed.has(details.url) }),
    );
    const rendered = renderDesignPage(page, bridge);
    isolated.protocol.handle(DESIGN_SCHEME, (request) => {
      if (!allowed.has(request.url) || generation !== this.generation)
        return new Response("", { status: 404 });
      if (request.url.endsWith("/shell.js"))
        return new Response(shellScript, {
          headers: {
            "Content-Type": "text/javascript",
            "Content-Security-Policy": "default-src 'none'",
          },
        });
      const shell = request.url.endsWith("/shell");
      return new Response(
        shell
          ? `<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;overflow:hidden}</style><iframe sandbox="allow-scripts" data-source="${origin}/page"></iframe><script src="${origin}/shell.js"></script>`
          : rendered,
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": shell
              ? `default-src 'none'; script-src ${origin}; style-src 'unsafe-inline'; frame-src ${origin}; base-uri 'none'`
              : pageCsp,
          },
        },
      );
    });
    this.releaseSession = () => {
      isolated.protocol.unhandle(DESIGN_SCHEME);
      isolated.webRequest.onBeforeRequest(null);
      isolated.removeAllListeners("will-download");
      void isolated.clearStorageData().catch(() => {});
      void isolated.clearCache().catch(() => {});
    };
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        disableDialogs: true,
        backgroundThrottling: false,
      },
    });
    this.view = view;
    this.threadId = threadId;
    this.revision = revision;
    this.current = {
      instanceId,
      revisionId: revision.revisionId,
      variantId,
      pageId,
      status: "running",
      errors: [],
      ...(draft ? { draft: true } : {}),
      ...(previousSelection ? { selection: previousSelection } : {}),
    };
    window.contentView.addChildView(view);
    view.setBounds(this.bounds);
    view.setVisible(this.visible);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.on("will-redirect", (event) => event.preventDefault());
    view.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    let initialChild = true;
    view.webContents.on("will-frame-navigate", (event) => {
      if (
        initialChild &&
        !event.isMainFrame &&
        event.url === `${origin}/page`
      ) {
        initialChild = false;
        return;
      }
      event.preventDefault();
    });
    view.webContents.on("render-process-gone", () => {
      if (this.view === view) this.stop("Preview renderer exited.");
    });
    try {
      await timeout(view.webContents.loadURL(`${origin}/shell`));
      if (
        generation !== this.generation ||
        requestSerial !== this.requestSerial
      )
        throw new Error("Preview was superseded.");
      const frames = view.webContents.mainFrame.framesInSubtree;
      const foreign = new Set(
        webContents
          .getAllWebContents()
          .filter(
            (contents) =>
              contents !== view.webContents && !contents.isDestroyed(),
          )
          .flatMap((contents) =>
            contents.mainFrame.framesInSubtree.map(
              (frame) => frame.osProcessId,
            ),
          ),
      );
      if (
        frames.length !== 2 ||
        frames.some(
          (frame) => frame.osProcessId <= 0 || foreign.has(frame.osProcessId),
        )
      )
        throw new Error("Preview process isolation could not be established.");
      this.allowedPids = new Set(frames.map((frame) => frame.osProcessId));
      if (scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y))
        await timeout(
          this.generatedFrame().executeJavaScript(
            `scrollTo(${scroll.x},${scroll.y})`,
          ),
        );
      const map = designSourceMap(page);
      this.watchdog = new DesignWatchdog({
        residentBytes: () =>
          app
            .getAppMetrics()
            .filter((metric) => this.allowedPids.has(metric.pid))
            .reduce(
              (total, metric) => total + metric.memory.workingSetSize * 1024,
              0,
            ),
        probe: async () => {
          await this.authorize(threadId);
          await this.generatedFrame().executeJavaScript("void 0");
          const data =
            await view.webContents.executeJavaScript("window.designState");
          if (generation !== this.generation || !this.current) return;
          if (data?.flood) {
            this.stop("Preview exceeded the message rate limit.");
            return;
          }
          this.current.errors = Array.isArray(data?.errors)
            ? data.errors
                .slice(0, 100)
                .map((error: unknown) => String(error).slice(0, 160))
            : [];
          const selected = map.find(
            (item) => item.id === data?.selection?.elementId,
          );
          if (selected)
            this.current.selection = {
              elementId: selected.id,
              tag: selected.tag,
              text: selected.text,
              editable:
                selected.editable && selected.text === data.selection.text,
              ...(selected.editable && selected.text !== data.selection.text
                ? {
                    reason:
                      "Script changed this slot; use conversation editing.",
                  }
                : {}),
            };
          if (
            typeof data?.pageId === "string" &&
            this.inspectingInstance !== this.current.instanceId
          ) {
            await view.webContents.executeJavaScript(
              "delete window.designState.pageId",
            );
            if (
              revision.content.variants
                .find((item) => item.id === variantId)
                ?.pages.some((item) => item.id === data.pageId)
            )
              void this.show(
                threadId,
                revision,
                variantId,
                data.pageId,
                draft,
              ).catch((error) => this.stop(String(error)));
          }
        },
        stop: (reason) =>
          this.stop(
            reason === "memory-limit"
              ? "Preview exceeded its memory limit."
              : "Preview stopped responding.",
          ),
      });
      this.watchdog.start();
      return structuredClone(this.current);
    } catch (error) {
      if (
        generation === this.generation &&
        requestSerial === this.requestSerial
      )
        this.stop(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  inspect(
    ...args: Parameters<DesignPreviewHost["inspectExclusive"]>
  ): Promise<DesignInspection> {
    const result = this.inspectionQueue
      .catch(() => {})
      .then(() => this.inspectExclusive(...args));
    this.inspectionQueue = result;
    return result;
  }
  private async inspectExclusive(
    threadId: string,
    revision: DesignRevision,
    variantId: string,
    pageId: string,
    actions: Array<{
      kind: "click" | "input";
      elementId: string;
      value?: string;
    }> = [],
  ): Promise<DesignInspection> {
    if (actions.length > 20)
      throw new Error("Preview checks support at most 20 actions.");
    let ownedInstance: string | undefined;
    const operation = (async () => {
      if (!this.window()?.isVisible())
        throw new Error(
          "Open the desktop window before inspecting a design preview.",
        );
      let state = await this.show(threadId, revision, variantId, pageId);
      ownedInstance = state.instanceId;
      this.inspectingInstance = state.instanceId;
      let inspectionView = this.view!;
      let frame = this.generatedFrame();
      inspectionView.setVisible(true);
      const pageIds = () =>
        new Set(
          designSourceMap(
            revision.content.variants
              .find((item) => item.id === variantId)!
              .pages.find((item) => item.id === pageId)!,
          ).map((item) => item.id),
        );
      for (const action of actions) {
        if (this.current?.instanceId !== state.instanceId)
          throw new Error("Preview changed during inspection.");
        if (
          !pageIds().has(action.elementId) ||
          (action.value?.length ?? 0) > 65536
        )
          throw new Error("Invalid preview action target or value.");
        await frame.executeJavaScript(
          `(()=>{const node=[...document.querySelectorAll('[data-design-id]')].find(n=>n.getAttribute('data-design-id')===${JSON.stringify(action.elementId)});if(!node)throw Error('Element missing');${action.kind === "click" ? "node.click()" : `if(!['INPUT','TEXTAREA','SELECT'].includes(node.tagName))throw Error('Not an input');node.value=${JSON.stringify(action.value ?? "")};node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}))`};})()`,
        );
        await frame.executeJavaScript(
          "new Promise(resolve=>setTimeout(resolve,0))",
        );
        const navigation = await inspectionView.webContents.executeJavaScript(
          "window.designState.pageId",
        );
        if (typeof navigation === "string") {
          if (
            !revision.content.variants
              .find((item) => item.id === variantId)
              ?.pages.some((item) => item.id === navigation)
          )
            throw new Error("Preview requested an undeclared page.");
          pageId = navigation;
          state = await this.show(threadId, revision, variantId, pageId);
          ownedInstance = state.instanceId;
          this.inspectingInstance = state.instanceId;
          inspectionView = this.view!;
          frame = this.generatedFrame();
          inspectionView.setVisible(true);
        }
      }
      if (this.current?.instanceId !== state.instanceId || !this.view)
        throw new Error("Preview changed during inspection.");
      const data =
        await inspectionView.webContents.executeJavaScript(
          "window.designState",
        );
      const errors: string[] = (data?.errors ?? [])
        .slice(0, 100)
        .map((error: unknown) => String(error).slice(0, 160));
      const screenshot = (await this.capture(inspectionView))
        .resize({ width: 1000 })
        .toDataURL();
      if (this.current?.instanceId !== state.instanceId)
        throw new Error("Preview changed during screenshot capture.");
      this.view?.setVisible(this.visible);
      if (Buffer.byteLength(screenshot) > 8 * 1024 * 1024)
        throw new Error("Preview screenshot exceeds 8 MiB.");
      return {
        revisionId: revision.revisionId,
        variantId,
        pageId,
        passed: errors.length === 0,
        errors,
        screenshot,
      };
    })();
    try {
      return await timeout(operation, 30000);
    } catch (error) {
      if (ownedInstance && this.current?.instanceId === ownedInstance)
        this.stop(String(error));
      throw error;
    } finally {
      if (this.inspectingInstance === ownedInstance)
        this.inspectingInstance = undefined;
    }
  }
  private async capture(view: WebContentsView) {
    const debuggerApi = view.webContents.debugger;
    const attached = debuggerApi.isAttached();
    if (!attached) debuggerApi.attach("1.3");
    try {
      // Capture this owned renderer directly. Native view visibility changes must
      // not stall frame callbacks or return an unavailable window surface.
      const bounds = view.getBounds();
      const result = await timeout(
        debuggerApi.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: bounds.width,
            height: bounds.height,
            scale: 1,
          },
        }),
        5000,
      );
      if (
        typeof result.data !== "string" ||
        result.data.length > 8 * 1024 * 1024
      )
        throw new Error("Preview screenshot exceeds 8 MiB.");
      const image = nativeImage.createFromBuffer(
        Buffer.from(result.data, "base64"),
      );
      if (image.isEmpty())
        throw new Error("Preview returned an empty screenshot.");
      return image;
    } finally {
      if (!attached && !view.webContents.isDestroyed()) debuggerApi.detach();
    }
  }
  async selectionImage(threadId: string, instanceId: string): Promise<string> {
    await this.authorize(threadId);
    if (
      this.threadId !== threadId ||
      this.current?.instanceId !== instanceId ||
      this.current.draft ||
      this.current.status !== "running" ||
      !this.view
    )
      throw new Error(
        "Run the saved revision before capturing selection context.",
      );
    const view = this.view;
    view.setVisible(true);
    try {
      const image = await this.capture(view);
      const data = image.resize({ width: 1000 }).toPNG();
      if (this.current?.instanceId !== instanceId)
        throw new Error("Preview changed during selection capture.");
      if (data.length > 8 * 1024 * 1024)
        throw new Error("Selection screenshot exceeds 8 MiB.");
      return data.toString("base64");
    } finally {
      if (this.view === view) view.setVisible(this.visible);
    }
  }
  async staticSnapshot(threadId: string, instanceId: string): Promise<string> {
    await this.authorize(threadId);
    if (this.threadId !== threadId || this.current?.instanceId !== instanceId)
      throw new Error("Preview changed before export.");
    const html = await timeout(
      this.generatedFrame().executeJavaScript(
        `(()=>{const root=document.documentElement.cloneNode(true);const source=document.querySelectorAll('input,textarea,select');const target=root.querySelectorAll('input,textarea,select');source.forEach((node,i)=>{const copy=target[i];if(node.tagName==='TEXTAREA')copy.textContent=node.value;else if(node.tagName==='SELECT')[...copy.options].forEach((option,j)=>{if(node.options[j].selected)option.setAttribute('selected','');else option.removeAttribute('selected')});else{copy.setAttribute('value',node.value);if(node.checked)copy.setAttribute('checked','');else copy.removeAttribute('checked')}});return root.outerHTML})()`,
      ),
    );
    if (this.threadId !== threadId || this.current?.instanceId !== instanceId)
      throw new Error("Preview changed during export.");
    if (typeof html !== "string" || Buffer.byteLength(html) > 2 * 1024 * 1024)
      throw new Error("Static snapshot exceeds the page limit.");
    return html;
  }
}
