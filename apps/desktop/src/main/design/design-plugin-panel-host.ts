import { sanitizeCandidateImages } from "./panel-payloads.js";
import {
  type PluginPanelHandle,
  type LivePanel,
  type DesignPanelAnnotation,
  type CandidatePromptEvent,
  type PanelRequestHandlers,
} from "./panel-contracts.js";
import { createPanelMessageHandler } from "./panel-messages.js";

// S1 host-side plugin PanelHost (proposal §8/§9 slice).
//
// Manages WebContentsView lifecycles for installed design-plugin panels:
// one sandboxed, isolated-session view per (threadId, panelId). The view is
// attached to the workspace BrowserWindow and positioned from renderer
// reported bounds. Candidate-prompt CustomEvents emitted by the panel are
// forwarded to the renderer through the candidate IPC channel; the panel
// itself never gains Node integration or host APIs.
//
// Electron 43 lifecycle constraint:
//   - host window destruction does NOT destroy child WebContentsView
//     webContents; dispose() closes them explicitly while holding refs.

import {
  BrowserWindow,
  MessageChannelMain,
  WebContentsView,
  session,
} from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginManifestSchema, type AppLocale } from "@artemis/protocol";
import { designPanelLocaleMessage } from "../../shared/i18n/design-panel-copy.js";
import { randomUUID } from "node:crypto";

import { DesignPluginCatalog } from "./design-plugin-catalog.js";
import { WORKSPACE_HTML_SCHEME } from "../../shared/timeline-preview.js";

export class DesignPanelHost {
  private locale: AppLocale = "en";

  setLocale(locale: AppLocale): void {
    this.locale = locale;
    for (const panel of this.panels.values()) {
      panel.hostPort.postMessage(designPanelLocaleMessage(locale));
    }
  }

  private readonly panels = new Map<string, LivePanel>();
  private readonly pendingEnsures = new Map<
    string,
    Promise<PluginPanelHandle>
  >();
  /** Keys released while their ensure was still creating the view. */
  private readonly releasedWhilePending = new Set<string>();
  private readonly pendingBounds = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  private readonly catalog = new DesignPluginCatalog();
  private catalogRoot: string | undefined;
  private hostWindow: BrowserWindow | undefined;
  private candidateSink: ((event: CandidatePromptEvent) => void) | undefined;
  private bindingSink:
    | ((event: {
        threadId: string;
        panelId: string;
        documentId: string | null;
        name?: string;
        html?: string;
      }) => void)
    | undefined;
  private requestHandlers: PanelRequestHandlers | undefined;
  /** 面板就绪拉取快照的回调（main 端接 pushDesignSnapshot）。 */
  private snapshotSink:
    ((event: { threadId: string; panelId: string }) => void) | undefined;
  /** artemis-preview responder for panel sessions: per-panel partitions do
   * NOT inherit defaultSession protocol handlers, so the workspace HTML
   * preview protocol must be registered on each panel session. */
  private previewResponder:
    ((request: Request) => Promise<Response>) | undefined;

  /** Point the host at the installed design-plugin packages root. */
  setCatalogRoot(root: string): void {
    console.log(`[design-panel] catalog root set: ${root}`);
    this.catalogRoot = root;
  }

  setPreviewResponder(
    responder: ((request: Request) => Promise<Response>) | undefined,
  ): void {
    this.previewResponder = responder;
  }

  /** 面板就绪（port 握手完成并主动拉取）时回调。 */
  onSnapshotRequest(
    sink: (event: { threadId: string; panelId: string }) => void,
  ): void {
    this.snapshotSink = sink;
  }

  /** S4 handlers for panel-originated requests (export / versions). */
  setRequestHandlers(handlers: PanelRequestHandlers): void {
    this.requestHandlers = handlers;
  }

  /** Renderer-side consumer of panel candidate prompts (host stub §9.2). */
  onCandidatePrompt(sink: (event: CandidatePromptEvent) => void): void {
    this.candidateSink = sink;
  }

  /** Renderer-side consumer of the panel's active-document binding. */
  onActiveDocument(
    sink: (event: {
      threadId: string;
      panelId: string;
      documentId: string | null;
      name?: string;
      html?: string;
    }) => void,
  ): void {
    this.bindingSink = sink;
  }

  private key(threadId: string, panelId: string): string {
    return `${threadId}:${panelId}`;
  }

  /**
   * S2: bind the catalog view to the thread's frozen revision. When the
   * published revision no longer matches the binding's contentHash the
   * panel load is refused (tampered / republished revision).
   */
  async setThreadBinding(input: {
    threadId: string;
    installationId: string;
    contentHash: string;
    revisionRoot: string;
  }): Promise<void> {
    const { PluginRevisionStore } =
      await import("./design-plugin-revision-store.js");
    const actual = await PluginRevisionStore.computeContentHash(
      input.revisionRoot,
    );
    if (actual !== input.contentHash) {
      throw new Error(
        `Panel revision mismatch for ${input.installationId}: binding expects ${input.contentHash} but revision hashes to ${actual}. Reinstall the plugin to repair.`,
      );
    }
    this.threadCatalogRoots.set(input.threadId, input.revisionRoot);
    this.threadBindingHashes.set(input.threadId, input.contentHash);
  }

  private threadCatalogRoots = new Map<string, string>();
  private threadBindingHashes = new Map<string, string>();

  /**
   * Ensure a panel exists for (threadId, panelId) and return its handle.
   * The view is hidden until setBounds() is first called by the renderer.
   */
  async ensurePanel(
    window: BrowserWindow,
    threadId: string,
    panelId: string,
  ): Promise<PluginPanelHandle> {
    console.log(`[design-panel] ensurePanel called: ${panelId} / ${threadId}`);
    // React StrictMode double-mounts effects in dev: two ensures race on
    // the same key while the first is still loading, stacking two views
    // and clobbering the panel registry. Register the in-flight promise
    // SYNCHRONOUSLY on the first line so the second caller can never
    // slip past the check (any later registration point leaves a window
    // between the async manifest reads).
    const pendingKey = this.key(threadId, panelId);
    const pending = this.pendingEnsures.get(pendingKey);
    if (pending) {
      // A re-ensure cancels a release marked while creation was still in
      // flight (StrictMode unmount/remount): the new mount owns the panel.
      this.releasedWhilePending.delete(pendingKey);
      return pending;
    }
    const promise = this.doEnsurePanel(window, threadId, panelId).finally(
      () => {
        this.pendingEnsures.delete(pendingKey);
      },
    );
    this.pendingEnsures.set(pendingKey, promise);
    return promise;
  }

  private async doEnsurePanel(
    window: BrowserWindow,
    threadId: string,
    panelId: string,
  ): Promise<PluginPanelHandle> {
    const existing = this.panels.get(this.key(threadId, panelId));
    if (existing) {
      return {
        panelId,
        pluginId: existing.pluginId,
        entryUrl: existing.webContents.getURL(),
      };
    }
    // Prefer the thread's verified revision root; fall back to the
    // resources catalog only when no revision binding exists (S1 path).
    const revisionRoot = this.threadCatalogRoots.get(threadId);
    let owner;
    if (revisionRoot) {
      // A revision root IS the package (manifest at its root), verified
      // by setThreadBinding — parse it directly instead of scanning
      // child directories (a single-package layout has none).
      const manifestPath = join(revisionRoot, "artemis.plugin.json");
      const manifest = pluginManifestSchema.parse(
        JSON.parse((await readFile(manifestPath, "utf8")) || "{}"),
      );
      owner = {
        root: revisionRoot,
        manifest,
        contentHash: this.threadBindingHashes.get(threadId) ?? "",
      };
    } else {
      if (!this.catalogRoot) {
        throw new Error("Design panel catalog root is not configured.");
      }
      const plugins = await this.catalog.load(this.catalogRoot);
      owner = plugins.find((plugin) =>
        plugin.manifest.panels.some((panel) => panel.id === panelId),
      );
    }
    if (!owner) {
      throw new Error(`No installed plugin provides panel "${panelId}".`);
    }
    const entry = owner.manifest.panels.find((panel) => panel.id === panelId);
    if (!entry) {
      // The revision branch resolves the owner from the thread binding and
      // does not filter by panelId — an unknown id must fail clearly instead
      // of dereferencing undefined.
      throw new Error(
        `Panel "${panelId}" is not declared by the bound plugin.`,
      );
    }
    const entryUrl = `file://${join(owner.root, entry.entry)}`;

    // Isolated per-panel session: no cookies/storage shared with the host or
    // sibling panels; sandbox on; no Node, no preload bridge.
    const panelSession = session.fromPartition(
      `design-plugin:${owner.manifest.id}:${panelId}`,
      { cache: false },
    );
    if (this.previewResponder) {
      // partition 复用同一 session 实例：releasePanel 后重开面板会再次走到
      // 这里，protocol.handle 对已注册的 scheme 直接抛错（面板打不开）。
      try {
        panelSession.protocol.handle(WORKSPACE_HTML_SCHEME, (request) =>
          this.previewResponder!(request),
        );
      } catch (error) {
        if (!/Failed to register/iu.test(String(error))) throw error;
      }
    }
    const view = new WebContentsView({
      webPreferences: {
        session: panelSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        // Port-only bridge preload: webContents.postMessage delivers only to
        // the isolated world (official message-ports tutorial), so a tiny
        // preload forwards the transferred port to the page's main world via
        // window.postMessage. It exposes no APIs to the page script — the
        // panel stays zero-Node/zero-IPC from the page's perspective.
        preload: join(__dirname, "design-plugin-panel-preload.cjs"),
      },
    });
    const webContents = view.webContents;
    this.hostWindow = window;
    window.contentView.addChildView(view);

    // S3 MessagePort bridge: the panel receives its port end via the
    // window "artemis:port" event; the host keeps the other end. The
    // panel posts candidate messages upstream; the host pushes snapshots
    // downstream. No Node, no IPC channel to the panel itself.
    const { port1: hostPort, port2: panelPort } = new MessageChannelMain();
    const host = this;
    hostPort.on(
      "message",
      createPanelMessageHandler(
        {
          get candidateSink() {
            return host.candidateSink;
          },
          key: (...args) => host.key(...args),
          get panels() {
            return host.panels;
          },
          get locale() {
            return host.locale;
          },
          get snapshotSink() {
            return host.snapshotSink;
          },
          get requestHandlers() {
            return host.requestHandlers;
          },
          get bindingSink() {
            return host.bindingSink;
          },
          capturePanelArea: (...args) => host.capturePanelArea(...args),
        },
        threadId,
        panelId,
        hostPort,
      ),
    );
    hostPort.start();

    this.panels.set(this.key(threadId, panelId), {
      view,
      webContents,
      hostPort,
      pluginId: owner.manifest.id,
      panelId,
    });
    const stashed = this.pendingBounds.get(this.key(threadId, panelId));
    if (stashed) {
      this.pendingBounds.delete(this.key(threadId, panelId));
      view.setBounds(stashed);
    }
    await webContents.loadURL(entryUrl);
    webContents.postMessage("artemis:port", null, [panelPort]);
    hostPort.postMessage(designPanelLocaleMessage(this.locale));
    if (this.releasedWhilePending.has(this.key(threadId, panelId))) {
      // The renderer released while this creation was in flight (tab
      // closed / thread switched before ensure resolved). The registry
      // now owns a view nobody mirrors geometry for — tear it down
      // instead of leaving an invisible zombie overlay.
      this.releasePanel(threadId, panelId);
    }
    console.log(
      `[design-panel] ensured ${panelId} for ${threadId}: url=${entryUrl}`,
    );
    webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error(`[design-panel] load failed ${code} ${desc} ${url ?? ""}`);
    });
    return { panelId, pluginId: owner.manifest.id, entryUrl };
  }

  /**
   * Push a state snapshot to the panel over the port bridge (S3
   * downstream). Silently no-ops when the panel is gone.
   */
  pushSnapshot(
    threadId: string,
    panelId: string,
    snapshot: Record<string, unknown>,
  ): void {
    console.log(
      `[design-panel] pushSnapshot -> ${threadId}/${panelId} docs=${(snapshot.documents as unknown[])?.length ?? "?"} projectFiles=${(snapshot.projectFiles as unknown[])?.length ?? "?"}`,
    );
    this.panels
      .get(this.key(threadId, panelId))
      ?.hostPort.postMessage({ type: "snapshot", snapshot });
  }

  /** Push the current theme to a panel (applies data-theme in the page). */
  pushTheme(threadId: string, panelId: string, theme: "light" | "dark"): void {
    this.panels
      .get(this.key(threadId, panelId))
      ?.hostPort.postMessage({ type: "theme", theme });
  }

  /** 面板是否已确认首份快照（补推去重用）。 */
  hasAckedSnapshot(threadId: string, panelId: string): boolean {
    return this.panels.get(this.key(threadId, panelId))?.snapshotAcked ?? false;
  }

  /** 沙箱预览内页面导航同步：租约服务了目录内兄弟 HTML 时告知面板
   *  （面板同步文件 tab；进入拾取模式时按当前页重建带桥传输——OD 的
   *  拾取模式换传输重建语义）。 */
  pushProjectNavigated(threadId: string, panelId: string, path: string): void {
    this.panels
      .get(this.key(threadId, panelId))
      ?.hostPort.postMessage({ type: "project-navigated", path });
  }

  /** Broadcast a theme change to every live panel. */
  broadcastTheme(theme: "light" | "dark"): void {
    for (const panel of this.panels.values()) {
      panel.hostPort.postMessage({ type: "theme", theme });
    }
  }

  /**
   * PR#245 P2-16：真实像素捕获。取发起请求的面板（无 panelId 时取该线程
   * 任意存活面板）的 webContents，截取预览舞台区域（CSS 像素矩形，面板
   * zoom 为 1 时与 DIP 一致）；无区域则截整页。
   */
  async capturePanelArea(
    threadId: string,
    panelId: string | undefined,
    rect?: { x: number; y: number; width: number; height: number },
  ): Promise<Electron.NativeImage | undefined> {
    let webContents: Electron.WebContents | undefined;
    if (panelId) {
      webContents = this.panels.get(this.key(threadId, panelId))?.webContents;
    } else {
      for (const [key, panel] of this.panels) {
        if (key.startsWith(`${threadId}:`)) {
          webContents = panel.webContents;
          break;
        }
      }
    }
    if (!webContents || webContents.isDestroyed()) return undefined;
    return webContents.capturePage(rect);
  }

  /** Position a panel. Renderer reports the dock pane's content bounds. */
  setBounds(
    threadId: string,
    panelId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const panel = this.panels.get(this.key(threadId, panelId));
    if (!panel) {
      // First-open race: the renderer reports layout before ensure()
      // finishes creating the view. Stash real rects only — a 0x0 report
      // is a pre-layout artifact (pane not laid out at mount); applying
      // it would pin the fresh view at 0x0 until an unrelated resize.
      if (bounds.width > 0 && bounds.height > 0) {
        this.pendingBounds.set(this.key(threadId, panelId), bounds);
      } else {
        console.warn(
          `[design-panel] ignored 0x0 bounds before ensure: ${panelId}`,
        );
      }
      return;
    }
    if (panel.collapsed) {
      // Layout reports keep arriving while the tab is hidden (dock drags,
      // window resizes). Zero-size rects are display:none artifacts from
      // the renderer's hidden pane; real rects become the restore target
      // so the collapsed view itself never shows stale geometry.
      if (bounds.width > 0 && bounds.height > 0) {
        panel.lastBounds = bounds;
      }
      return;
    }
    panel.view.setBounds(bounds);
  }

  /** Hide/show a panel when its dock tab deactivates/reactivates. */
  setVisible(threadId: string, panelId: string, visible: boolean): void {
    const live = this.panels.get(this.key(threadId, panelId));
    if (!live) return;
    // Diagnostic trail matches the other [design-panel] log lines; the
    // occlusion path (modal dialog open) is the non-obvious caller.
    console.log(
      `[design-panel] visible ${threadId.slice(0, 8)}/${panelId} -> ${visible}`,
    );
    if (visible) {
      // First open re-reports visible for a panel that was never hidden:
      // there is nothing to restore — a 0x0 default here would blank the
      // freshly reported bounds. Only a collapsed panel restores geometry.
      if (live.collapsed) {
        live.collapsed = false;
        if (live.lastBounds) live.view.setBounds(live.lastBounds);
      }
      // Rebind request: the renderer may have missed the latest
      // active-document post while the panel was collapsed (thread
      // switch). The panel answers with its current binding.
      live.hostPort.postMessage({ type: "panel-shown" });
      return;
    }
    // Idempotent hide: collapsing twice must not overwrite the saved
    // bounds with the already-zeroed geometry (tab inactive + dock resize
    // fires the visibility effect again).
    if (!live.collapsed) {
      live.collapsed = true;
      live.lastBounds = live.view.getBounds();
      live.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  /** Destroy one panel (dock tab closed). */
  releasePanel(threadId: string, panelId: string): void {
    const releaseKey = this.key(threadId, panelId);
    const live = this.panels.get(releaseKey);
    if (!live) {
      // Release can arrive while creation is still in flight (tab closed
      // before ensure resolved): mark it so doEnsurePanel tears the fresh
      // view down instead of leaving an ownerless overlay attached to the
      // window. A later re-ensure cancels the mark (see ensurePanel).
      if (this.pendingEnsures.has(releaseKey)) {
        this.releasedWhilePending.add(releaseKey);
      }
      return;
    }
    console.log(`[design-panel] releasePanel ${panelId} / ${threadId}`);
    this.panels.delete(releaseKey);
    this.releasedWhilePending.delete(releaseKey);
    if (!this.listPanels(threadId).length) {
      this.threadCatalogRoots.delete(threadId);
    }
    try {
      live.hostPort.close();
    } catch {
      // Port may already be closed with the renderer.
    }
    try {
      // Electron 43: destroying the host does not close child
      // WebContentsView webContents, and view.webContents is nulled after
      // close — remove through the window, close through the held ref.
      this.hostWindow?.contentView.removeChildView(live.view);
      if (!live.webContents.isDestroyed()) live.webContents.close();
    } catch {
      // Window may already be gone.
    }
  }

  /** Destroy every panel (window closed / app shutdown). */
  disposeAll(): void {
    for (const live of this.panels.values()) {
      try {
        live.hostPort.close();
      } catch {
        // Best effort during teardown.
      }
      try {
        this.hostWindow?.contentView.removeChildView(live.view);
        if (!live.webContents.isDestroyed()) live.webContents.close();
      } catch {
        // Best effort during teardown.
      }
    }
    this.panels.clear();
    this.pendingBounds.clear();
    this.releasedWhilePending.clear();
  }

  listPanels(threadId: string): PluginPanelHandle[] {
    return [...this.panels.entries()]
      .filter(([key]) => key.startsWith(`${threadId}:`))
      .map(([, live]) => ({
        panelId: live.panelId,
        pluginId: live.pluginId,
        entryUrl: live.webContents.getURL(),
      }));
  }
}

export type { CandidatePromptEvent };

export {
  type PluginPanelHandle,
  type DesignPanelAnnotation,
  type PanelRequestHandlers,
} from "./panel-contracts.js";

export { sanitizeCandidateImages } from "./panel-payloads.js";
