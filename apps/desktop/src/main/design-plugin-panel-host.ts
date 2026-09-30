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

import { BrowserWindow, WebContentsView, session } from "electron";
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
    if (!this.catalogRoot) {
      throw new Error("Design panel catalog root is not configured.");
    }
    const plugins = await this.catalog.load(this.catalogRoot);
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

    // S1 candidate stub: the panel may only emit DOM events. We observe the
    // console relay the panel ships (its composer logs "[candidate] ..." on
    // dispatch) and forward a structured candidate to the renderer sink.
    // The full MessagePort bridge lands with S3.
    webContents.on("console-message", (_event, _level, message) => {
      if (!message.startsWith("[candidate]")) return;
      this.candidateSink?.({
        kind: "candidate-prompt",
        threadId,
        panelId,
        text: message.slice("[candidate]".length).trim(),
        source: "panel",
        occurredAt: new Date().toISOString(),
      });
    });

    this.panels.set(this.key(threadId, panelId), {
      view,
      webContents,
      pluginId: owner.manifest.id,
      panelId,
    });
    await webContents.loadURL(entryUrl);
    return { panelId, pluginId: owner.manifest.id, entryUrl };
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
