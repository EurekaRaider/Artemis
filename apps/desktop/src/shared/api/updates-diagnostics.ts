export interface UpdatesDiagnosticsApi {
  checkForUpdates(): Promise<ReleaseUpdateStatus>;
  downloadUpdate(): Promise<ReleaseUpdateStatus>;
  installUpdate(): Promise<void>;
  exportDiagnostics(): Promise<string | undefined>;
  reportRendererError(diagnostic: RendererDiagnostic): void;
}

export interface ReleaseUpdateStatus {
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  currentVersion: string;
  upToDate?: boolean;
  availableVersion?: string;
  manualDownloadUrl?: string;
  manualUpdate?: boolean;
  completedVersion?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  rollbackAvailable: boolean;
  message?: string;
}

export interface RendererDiagnostic {
  kind: "error" | "unhandled-rejection";
  message: string;
  stack?: string;
}
