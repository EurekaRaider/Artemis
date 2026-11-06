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
