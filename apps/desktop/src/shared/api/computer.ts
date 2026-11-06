export interface ComputerApi {
  browserPreview(
    threadId: string,
    contentsId: number,
    command: import("@artemis/protocol").BrowserPreviewCommand,
  ): Promise<import("@artemis/protocol").BrowserPreviewSnapshot>;
  registerComputerBrowser(threadId: string, contentsId: number): Promise<void>;
  browserSession(
    command: import("@artemis/protocol").BrowserSessionCommand,
  ): Promise<import("@artemis/protocol").BrowserSessionSnapshot | undefined>;
  onBrowserSession(
    listener: (
      snapshot: import("@artemis/protocol").BrowserSessionSnapshot,
    ) => void,
  ): () => void;
  getComputerPreviews(): Promise<
    import("@artemis/protocol").ComputerPreviewState[]
  >;
  computerPreview(
    command: import("@artemis/protocol").ComputerPreviewCommand,
  ): Promise<void>;
  bindPreviewCanvas(token: string, canvasId: string): void;
  unbindPreviewCanvas(token: string): void;
  onComputerPreviews(
    listener: (
      states: import("@artemis/protocol").ComputerPreviewState[],
    ) => void,
  ): () => void;
  onComputerPreviewExpand(
    listener: (state: import("@artemis/protocol").ComputerPreviewState) => void,
  ): () => void;
  computerRuntimeStatus(): Promise<
    import("@artemis/protocol").ComputerUseRuntimeStatus | undefined
  >;
  checkComputerRuntimeUpdates(): Promise<
    import("@artemis/protocol").ComputerUseRuntimeStatus | undefined
  >;
  cancelComputerRuntimeDownload(): Promise<void>;
  getComputerState(): Promise<import("@artemis/protocol").ComputerControlState>;
  controlComputer(
    action: "stop" | "resume" | "revoke-task",
    threadId: string,
  ): Promise<void>;
  getComputerPermissions(): Promise<ComputerPermission[]>;
  revokeComputerPermission(id: string): Promise<void>;
  onComputerState(
    listener: (state: import("@artemis/protocol").ComputerControlState) => void,
  ): () => void;
  onComputerBrowserOpen(listener: (threadId: string) => void): () => void;
}

export interface ComputerPermission {
  id: string;
  name: string;
  scope: "turn" | "task" | "persistent";
  foreground: boolean;
  threadId?: string;
  threadTitle?: string;
}
