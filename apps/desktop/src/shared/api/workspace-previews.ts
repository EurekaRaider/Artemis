export interface WorkspacePreviewsApi {
  openWorkspacePdf(threadId: string, path: string): Promise<string>;
  openWorkspaceVideo(
    threadId: string,
    href: string,
  ): Promise<import("../workspace-video.js").WorkspaceVideoSource>;
  releaseWorkspaceVideo(threadId: string, url: string): Promise<void>;
  ensureDesignPanel(
    threadId: string,
    panelId: string,
  ): Promise<{ panelId: string; pluginId: string; entryUrl: string }>;
  setDesignPanelBounds(
    threadId: string,
    panelId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<void>;
  setDesignPanelVisible(
    threadId: string,
    panelId: string,
    visible: boolean,
  ): Promise<void>;
  releaseDesignPanel(threadId: string, panelId: string): Promise<void>;
  acceptDesignPanelCandidate(
    threadId: string,
    candidateText: string,
  ): Promise<{
    threadId: string;
    candidateText: string;
    credential: string;
    submissionId: string;
  }>;
  discardDesignPanelCandidate(credential: string): Promise<void>;
  consumeDesignPanelSend(credential: string): Promise<{
    threadId: string;
    candidateText: string;
    submissionId: string;
  }>;
  stageDesignPanelSend(credential: string): Promise<{
    threadId: string;
    candidateText: string;
    submissionId: string;
  }>;
  reportDesignPanelSendOutcome(
    submissionId: string,
    outcome: "completed" | "failed",
  ): Promise<void>;
  onDesignPanelCandidate(
    listener: (event: {
      kind: "candidate-prompt";
      threadId: string;
      panelId: string;
      text: string;
      source: string;
      occurredAt: string;
      /** false = fill the composer without auto-triggering send (OD draft). */
      autoSend?: boolean;
      /** Attached screenshots/images as data URLs (panel → composer). */
      images?: string[];
      /** Structured panel annotations (rendered into the message body). */
      annotations?:
        | Array<{
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
          }>
        | undefined;
      /** The annotated page itself (the attachment the agent operates on). */
      document?:
        | {
            documentId: string;
            documentName: string;
            html: string;
          }
        | undefined;
    }) => void,
  ): () => void;
  onDesignPanelBinding(
    listener: (event: {
      threadId: string;
      panelId: string;
      /** Active document tab in the design panel; null = files grid. */
      documentId: string | null;
      name?: string;
      html?: string;
    }) => void,
  ): () => void;
  showWorkspaceTabMenu(input: {
    html: string;
    anchorRight: number;
    anchorTop: number;
  }): Promise<void>;
  closeWorkspaceTabMenu(): Promise<void>;
  onWorkspaceTabMenuSelect(
    listener: (
      kind: "review" | "terminal" | "browser" | "file" | "design",
    ) => void,
  ): () => void;
  onWorkspaceTabMenuClosed(listener: () => void): () => void;
  openWorkspaceHtml(threadId: string, href: string): Promise<{ url: string }>;
  releaseWorkspaceHtml(threadId: string, url: string): Promise<void>;
}
