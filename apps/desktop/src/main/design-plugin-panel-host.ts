// S1 host-side plugin PanelHost (proposal §8/§9 slice).
//
// Manages WebContentsView lifecycles for installed design-plugin panels:
// one sandboxed, isolated-session view per (threadId, panelId). The view is
// attached to the workspace BrowserWindow and positioned from renderer
// reported bounds. Candidate-prompt CustomEvents emitted by the panel are
// forwarded to the renderer through the candidate IPC channel; the panel
// itself never gains Node integration or host APIs.
//
// Electron 43 findings from s0-findings.md are baked in:
//   - host window destruction does NOT destroy child WebContentsView
//     webContents; dispose() closes them explicitly while holding refs.

import { BrowserWindow, MessageChannelMain, WebContentsView, session } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginManifestSchema } from "@artemis/protocol";
import { randomUUID } from "node:crypto";

import { DesignPluginCatalog } from "./design-plugin-catalog.js";
import { WORKSPACE_HTML_SCHEME } from "../shared/timeline-preview.js";

export interface PluginPanelHandle {
  panelId: string;
  pluginId: string;
  entryUrl: string;
}

interface LivePanel {
  view: WebContentsView;
  /** Held from creation: view.webContents is nulled after close. */
  webContents: Electron.WebContents;
  /** Host side of the S3 MessagePort bridge (panel got the other end). */
  hostPort: Electron.MessagePortMain;
  pluginId: string;
  panelId: string;
  /** True while setVisible(false) collapsed the view to 0x0. */
  collapsed?: boolean;
  /** Bounds to restore on setVisible(true); setBounds updates it while
   * collapsed so geometry reported for a hidden tab is not lost. */
  lastBounds?: Electron.Rectangle;
}

/**
 * Structured annotation carried alongside a panel candidate (Word-plugin
 * style attachment payload). The panel page is sandboxed, so everything
 * here is re-validated host-side before it reaches the renderer.
 */
export interface DesignPanelAnnotation {
  id?: string;
  kind?: string;
  markKind?: string;
  label?: string;
  text?: string;
  documentId?: string | null;
  documentName?: string | null;
  currentText?: string;
  selector?: string;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
  htmlHint?: string;
  style?: string;
}

interface CandidatePromptEvent {
  kind: "candidate-prompt";
  threadId: string;
  panelId: string;
  text: string;
  source: string;
  occurredAt: string;
  /** false = add to composer without auto-triggering the send (OD draft). */
  autoSend?: boolean;
  /** Attached screenshots/images as data URLs (panel → composer images). */
  images?: string[];
  annotations?: DesignPanelAnnotation[];
  document?: {
    documentId: string;
    documentName: string;
    html: string;
  };
}

const MAX_CANDIDATE_ANNOTATIONS = 20;
const MAX_ANNOTATION_JSON_BYTES = 64 * 1024;
const MAX_DOCUMENT_HTML_BYTES = 512 * 1024;

/** Attached panel images: data URLs only, bounded count/size (composer
 *  images flow into PromptImage base64, so the limits mirror it). */
export function sanitizeCandidateImages(input: unknown): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const out: string[] = [];
  for (const raw of input.slice(0, 6)) {
    if (typeof raw !== "string") continue;
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
      raw,
    );
    if (!match) continue;
    if (raw.length > 10 * 1024 * 1024) continue;
    out.push(raw);
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeDocumentPayload(input: unknown):  | { documentId: string; documentName: string; html: string }
  | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const item = input as Record<string, unknown>;
  if (
    typeof item.documentId !== "string" ||
    typeof item.documentName !== "string" ||
    typeof item.html !== "string"
  ) {
    return undefined;
  }
  if (item.html.length > MAX_DOCUMENT_HTML_BYTES) return undefined;
  if (!item.html.trim()) return undefined;
  return {
    documentId: item.documentId.slice(0, 128),
    documentName: item.documentName.slice(0, 256),
    html: item.html,
  };
}

function sanitizeAnnotations(
  input: unknown,
): DesignPanelAnnotation[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const out: DesignPanelAnnotation[] = [];
  for (const raw of input.slice(0, MAX_CANDIDATE_ANNOTATIONS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    out.push({
      ...(typeof item.id === "string" ? { id: item.id.slice(0, 128) } : {}),
      ...(typeof item.kind === "string"
        ? { kind: item.kind.slice(0, 32) }
        : {}),
      ...(typeof item.markKind === "string"
        ? { markKind: item.markKind.slice(0, 32) }
        : {}),
      ...(typeof item.label === "string"
        ? { label: item.label.slice(0, 256) }
        : {}),
      ...(typeof item.text === "string"
        ? { text: item.text.slice(0, 8_192) }
        : {}),
      documentId:
        typeof item.documentId === "string"
          ? item.documentId.slice(0, 128)
          : null,
      documentName:
        typeof item.documentName === "string"
          ? item.documentName.slice(0, 256)
          : null,
      ...(typeof item.currentText === "string"
        ? { currentText: item.currentText.slice(0, 512) }
        : {}),
      ...(typeof item.selector === "string"
        ? { selector: item.selector.slice(0, 512) }
        : {}),
      x: typeof item.x === "number" && Number.isFinite(item.x) ? item.x : null,
      y: typeof item.y === "number" && Number.isFinite(item.y) ? item.y : null,
      w: typeof item.w === "number" && Number.isFinite(item.w) ? item.w : null,
      h: typeof item.h === "number" && Number.isFinite(item.h) ? item.h : null,
      ...(typeof item.htmlHint === "string"
        ? { htmlHint: item.htmlHint.slice(0, 512) }
        : {}),
      ...(typeof item.style === "string"
        ? { style: item.style.slice(0, 512) }
        : {}),
    });
  }
  if (out.length === 0) return undefined;
  // Drop the whole sidecar when it would smuggle in oversized context.
  if (JSON.stringify(out).length > MAX_ANNOTATION_JSON_BYTES) return undefined;
  return out;
}

/** S4 host-side actions a panel may REQUEST over the port (never run). */
export interface PanelRequestHandlers {
  /** 项目工作区文件只读读取（预览用；路径由宿主封死在工作区内）。 */
  readProjectFile(input: {
    threadId: string;
    path: string;
  }): Promise<{ name: string; content: string; baseUrl?: string }>;
  exportDocument(input: {
    threadId: string;
    documentId: string;
    revision?: string;
  }): Promise<{ path: string; revision: string }>;
  listVersions(input: {
    threadId: string;
    documentId: string;
  }): Promise<unknown>;
  readDocument(input: {
    threadId: string;
    documentId: string;
  }): Promise<{ html: string; name: string } | undefined>;
  /** Restore is host-owned: it dispatches apply_edit/undo through the
   * trusted runtime and returns the restored document HTML. */
  restoreDocument(input: {
    threadId: string;
    documentId: string;
    revision?: string;
  }): Promise<{
    ok: boolean;
    documentHtml?: string;
    name?: string;
    error?: string;
  }>;
  captureScreenshot(input: {
    threadId: string;
    documentId: string;
  }): Promise<{ path: string }>;
  listDocuments(input: {
    threadId: string;
  }): Promise<{ documents: unknown[]; projectName: string }>;
  handoff(input: {
    threadId: string;
    documentId: string;
  }): Promise<{ threadId: string; created: boolean }>;
  /** 项目 HTML 预览 lease（artemis-preview URL-load）：宿主 open 换 URL。 */
  projectPreview(input: {
    threadId: string;
    path: string;
    thumb?: boolean;
  }): Promise<{ url: string }>;
}

export class DesignPanelHost {
  private readonly panels = new Map<string, LivePanel>();
  private readonly pendingEnsures = new Map<string, Promise<PluginPanelHandle>>();
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
    | ((event: { threadId: string; panelId: string }) => void)
    | undefined;
  /** artemis-preview responder for panel sessions: per-panel partitions do
   * NOT inherit defaultSession protocol handlers, so the workspace HTML
   * preview protocol must be registered on each panel session. */
  private previewResponder: ((request: Request) => Promise<Response>) | undefined;

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
    const { PluginRevisionStore } = await import(
      "./design-plugin-revision-store.js"
    );
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
    hostPort.on("message", (event) => {
      const data = event.data as
        | {
            type?: string;
            text?: string;
            documentId?: string;
            revision?: string;
            name?: string;
            html?: string;
            path?: string;
            url?: string;
            thumb?: boolean;
            autoSend?: boolean;
            images?: unknown;
            annotations?: unknown;
            document?: unknown;
          }
        | undefined;
      if (data?.type === "candidate-prompt" && typeof data.text === "string") {
        const annotations = sanitizeAnnotations(data.annotations);
        const document = sanitizeDocumentPayload(data.document);
        const images = sanitizeCandidateImages(data.images);
        this.candidateSink?.({
          kind: "candidate-prompt",
          threadId,
          panelId,
          text: data.text,
          source: "panel",
          occurredAt: new Date().toISOString(),
          ...(data.autoSend === false ? { autoSend: false } : {}),
          ...(images ? { images } : {}),
          ...(annotations ? { annotations } : {}),
          ...(document ? { document } : {}),
        });
        return;
      }
      // S4 host-owned actions: the panel only requests; the handlers run in
      // the main process (export writes the file, list_versions dispatches
      // through the trusted plugin runtime).
      // 面板就绪后主动拉完整快照：首开时 host 的初始 push 可能早于 port
      // 握手完成而丢失（面板白屏无卡片），拉模式兜底推模式。
      if (data?.type === "snapshot-request") {
        console.log(`[design-panel] snapshot-request from ${threadId}/${panelId}`);
        this.snapshotSink?.({ threadId, panelId });
        return;
      }
      if (data?.type === "read-project-file-request" && data.path) {
        void this.requestHandlers
          ?.readProjectFile({ threadId, path: String(data.path) })
          .then((result) => {
            hostPort.postMessage({
              type: "read-project-file-result",
              ...result,
            });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "read-project-file-error",
              path: String(data.path),
              error: String(error),
            });
          });
        return;
      }
      // 项目 HTML 预览（URL-load）：面板只拿到 artemis-preview URL；资源
      // 解析边界（文件所在目录内）由 WorkspaceHtmlPreview 的 lease 保证。
      if (data?.type === "project-preview-request" && data.path) {
        const thumb = data.thumb === true;
        void this.requestHandlers
          ?.projectPreview({
            threadId,
            path: String(data.path),
            ...(thumb ? { thumb: true } : {}),
          })
          .then((result) => {
            hostPort.postMessage({
              type: "project-preview-result",
              path: String(data.path),
              ...(thumb ? { thumb: true } : {}),
              ...result,
            });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "project-preview-error",
              path: String(data.path),
              ...(thumb ? { thumb: true } : {}),
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "export-request" && data.documentId) {
        void this.requestHandlers
          ?.exportDocument({
            threadId,
            documentId: data.documentId,
            ...(data.revision ? { revision: data.revision } : {}),
          })
          .then((result) => {
            hostPort.postMessage({ type: "export-result", ...result });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "export-error",
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "read-document-request" && data.documentId) {
        void this.requestHandlers
          ?.readDocument({ threadId, documentId: data.documentId })
          .then((document) => {
            hostPort.postMessage({
              type: "document-html",
              html: document?.html ?? "",
              name: document?.name ?? "",
            });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "document-html",
              html: "",
              name: "",
              error: String(error),
            });
          });
        return;
      }
      // Composer binding (OD activeProjectFileName): the panel reports which
      // document tab is active (null = files grid unbinds). Forwarded to the
      // renderer, which shows the "editing" chip and attaches the page on
      // send. html is sanitized like the candidate document payload.
      if (data?.type === "active-document") {
        const name =
          typeof data.name === "string" ? data.name.slice(0, 256) : null;
        const html =
          typeof data.html === "string" && data.html.length <= 512 * 1024
            ? data.html
            : "";
        this.bindingSink?.({
          threadId,
          panelId,
          documentId:
            typeof data.documentId === "string"
              ? data.documentId.slice(0, 128)
              : null,
          ...(name ? { name } : {}),
          ...(html && name ? { html } : {}),
        });
        return;
      }
      // Page-card thumbnail fetch: same store read as read-document but the
      // reply does NOT drive the stage render — the panel mounts it into the
      // card grid (OD HtmlCardThumbnail equivalent).
      if (data?.type === "thumb-request" && data.documentId) {
        void this.requestHandlers
          ?.readDocument({ threadId, documentId: data.documentId })
          .then((document) => {
            hostPort.postMessage({
              type: "thumb",
              documentId: data.documentId,
              name: document?.name ?? "",
              html: (document?.html ?? "").slice(0, 512 * 1024),
            });
          })
          .catch(() => {
            hostPort.postMessage({
              type: "thumb",
              documentId: data.documentId,
              name: "",
              html: "",
            });
          });
        return;
      }
      if (data?.type === "list-versions-request" && data.documentId) {
        void this.requestHandlers
          ?.listVersions({ threadId, documentId: data.documentId })
          .then((versions) => {
            hostPort.postMessage({ type: "versions", versions });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "versions-error",
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "restore-request" && data.documentId) {
        void this.requestHandlers
          ?.restoreDocument({
            threadId,
            documentId: data.documentId,
            ...(data.revision ? { revision: data.revision } : {}),
          })
          .then((result) => {
            hostPort.postMessage({ type: "restore-result", ...result });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "restore-result",
              ok: false,
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "list-documents-request") {
        void this.requestHandlers
          ?.listDocuments({ threadId })
          .then((snapshot) => {
            hostPort.postMessage({ type: "snapshot", snapshot });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "snapshot-error",
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "handoff-request" && data.documentId) {
        void this.requestHandlers
          ?.handoff({ threadId, documentId: data.documentId })
          .then((result) => {
            hostPort.postMessage({ type: "handoff-result", ...result });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "handoff-result",
              error: String(error),
            });
          });
        return;
      }
      if (data?.type === "screenshot-request" && data.documentId) {
        void this.requestHandlers
          ?.captureScreenshot({ threadId, documentId: data.documentId })
          .then((result) => {
            hostPort.postMessage({ type: "screenshot-result", ...result });
          })
          .catch((error: unknown) => {
            hostPort.postMessage({
              type: "screenshot-result",
              error: String(error),
            });
          });
        return;
      }
    });
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
        console.warn(`[design-panel] ignored 0x0 bounds before ensure: ${panelId}`);
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
