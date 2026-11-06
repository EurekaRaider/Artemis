import type { WebContentsView } from "electron";

export interface PluginPanelHandle {
  panelId: string;
  pluginId: string;
  entryUrl: string;
}

export interface LivePanel {
  view: WebContentsView;
  /** Held from creation: view.webContents is nulled after close. */
  webContents: Electron.WebContents;
  /** Host side of the S3 MessagePort bridge (panel got the other end). */
  hostPort: Electron.MessagePortMain;
  pluginId: string;
  panelId: string;
  /** True while setVisible(false) collapsed the view to 0x0. */
  collapsed?: boolean;
  /** 面板已确认收到并渲染首份快照（三层兜底的补推据此取消）。 */
  snapshotAcked?: boolean;
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

export interface CandidatePromptEvent {
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

/** S4 host-side actions a panel may REQUEST over the port (never run). */
export interface PanelRequestHandlers {
  openProjectFile?(input: { threadId: string }): Promise<{ path?: string }>;
  /** 项目工作区文件只读读取（预览用；路径由宿主封死在工作区内）。 */
  readProjectFile(input: {
    threadId: string;
    path: string;
  }): Promise<{ name: string; content: string; baseUrl?: string }>;
  exportDocument(input: {
    threadId: string;
    documentId: string;
    revision?: string;
  }): Promise<{ path: string; revision: string; canceled?: boolean }>;
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
    /** PR#245 P2-16：截图区域（预览舞台在面板内的 CSS 像素矩形）。 */
    panelId?: string;
    rect?: { x: number; y: number; width: number; height: number };
  }): Promise<{ path: string }>;
  /** 项目页面导出：原始 HTML 经保存对话框落盘（安全读取复用预览管线）。 */
  exportProjectFile(input: {
    threadId: string;
    path: string;
  }): Promise<{ path?: string; canceled?: boolean; error?: string }>;
  /** 图片创作：弹对话框选择图片目录（宿主持久记住）。 */
  pickImageFolder(input: {
    threadId: string;
  }): Promise<{ imageDir?: string; error?: string }>;
  /** 图片创作：读取图片为 dataURL（image-dir: 前缀=已记住目录内相对路径，
   * image-view: 同左；路径解析与安全边界在宿主 handler 内完成）。 */
  readImage(input: {
    path: string;
    threadId?: string;
  }): Promise<{ dataUrl?: string }>;
  /** PR#245 P2-16：持久删除需要知道面板，删除后定向推快照刷新。 */
  deleteDocument(input: {
    threadId: string;
    documentId: string;
    panelId?: string;
  }): Promise<{ ok: boolean; error?: string }>;
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
