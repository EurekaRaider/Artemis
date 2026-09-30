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
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { DesignPluginCatalog } from "./design-plugin-catalog.js";

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
  /** Last renderer-reported bounds, restored by setVisible(true). */
  lastBounds?: Electron.Rectangle;
}

interface CandidatePromptEvent {
  kind: "candidate-prompt";
  threadId: string;
  panelId: string;
  text: string;
  source: string;
  occurredAt: string;
}

export class DesignPanelHost {
  private readonly panels = new Map<string, LivePanel>();
  private readonly catalog = new DesignPluginCatalog();
  private catalogRoot: string | undefined;
  private hostWindow: BrowserWindow | undefined;
  private candidateSink: ((event: CandidatePromptEvent) => void) | undefined;

  /** Point the host at the installed design-plugin packages root. */
  setCatalogRoot(root: string): void {
    this.catalogRoot = root;
  }

  /** Renderer-side consumer of panel candidate prompts (host stub §9.2). */
  onCandidatePrompt(sink: (event: CandidatePromptEvent) => void): void {
    this.candidateSink = sink;
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
  }

  private threadCatalogRoots = new Map<string, string>();

  /**
   * Ensure a panel exists for (threadId, panelId) and return its handle.
   * The view is hidden until setBounds() is first called by the renderer.
   */
  async ensurePanel(
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
    const catalogRoot =
      this.threadCatalogRoots.get(threadId) ?? this.catalogRoot;
    if (!catalogRoot) {
      throw new Error("Design panel catalog root is not configured.");
    }
    const plugins = await this.catalog.load(catalogRoot);
    const owner = plugins.find((plugin) =>
      plugin.manifest.panels.some((panel) => panel.id === panelId),
    );
    if (!owner) {
      throw new Error(`No installed plugin provides panel "${panelId}".`);
    }
    const entry = owner.manifest.panels.find((panel) => panel.id === panelId)!;
    const entryUrl = `file://${join(owner.root, entry.entry)}`;

    // Isolated per-panel session: no cookies/storage shared with the host or
    // sibling panels; sandbox on; no Node, no preload bridge.
    const panelSession = session.fromPartition(
      `design-plugin:${owner.manifest.id}:${panelId}`,
      { cache: false },
    );
    const view = new WebContentsView({
      webPreferences: {
        session: panelSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
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
      const data = event.data as { type?: string; text?: string } | undefined;
      if (data?.type === "candidate-prompt" && typeof data.text === "string") {
        this.candidateSink?.({
          kind: "candidate-prompt",
          threadId,
          panelId,
          text: data.text,
          source: "panel",
          occurredAt: new Date().toISOString(),
        });
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
    await webContents.loadURL(entryUrl);
    webContents.postMessage("artemis:port", null, [panelPort]);
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
    this.panels
      .get(this.key(threadId, panelId))
      ?.hostPort.postMessage({ type: "snapshot", snapshot });
  }

  /** Position a panel. Renderer reports the dock pane's content bounds. */
  setBounds(
    threadId: string,
    panelId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    this.panels.get(this.key(threadId, panelId))?.view.setBounds(bounds);
  }

  /** Hide/show a panel when its dock tab deactivates/reactivates. */
  setVisible(threadId: string, panelId: string, visible: boolean): void {
    const live = this.panels.get(this.key(threadId, panelId));
    if (!live) return;
    // Electron WebContentsView has no explicit visibility flag; a zero-size
    // bounds is the supported way to keep it alive but out of the layout.
    if (visible) {
      live.view.setBounds(
        live.lastBounds ?? { x: 0, y: 0, width: 0, height: 0 },
      );
    } else {
      live.lastBounds = live.view.getBounds();
      live.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  /** Destroy one panel (dock tab closed). */
  releasePanel(threadId: string, panelId: string): void {
    const live = this.panels.get(this.key(threadId, panelId));
    if (!live) return;
    this.panels.delete(this.key(threadId, panelId));
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
