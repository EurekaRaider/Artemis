import type { WorkspaceFileContent } from "./workspace-files.js";
export interface OfficeApi {
  openOfficeFile(
    threadId: string,
    path: string,
  ): Promise<import("@artemis/protocol").ArtifactSnapshot>;
  readOfficeSnapshot(
    threadId: string,
    sessionId: string,
  ): Promise<import("@artemis/protocol").ArtifactSnapshot>;
  editOfficeFile(
    threadId: string,
    request: import("@artemis/protocol").ArtifactSessionRequest,
  ): Promise<import("@artemis/protocol").ArtifactSnapshot>;
  saveWorkspaceCsv(
    threadId: string,
    path: string,
    content: string,
    expectedContent: string,
  ): Promise<WorkspaceFileContent>;
  openOfficePreview(
    threadId: string,
    sessionId: string,
    assetId: string,
  ): Promise<{ data: string; version: number }>;
  officeCapabilityStatus(): Promise<
    import("@artemis/protocol").CapabilityPackStatus
  >;
  checkOfficeCapabilityUpdates(): Promise<void>;
  installOfficeCapability(): Promise<void>;
  importOfficeCapability(): Promise<void>;
  cancelOfficeCapability(): Promise<void>;
  activateOfficeCapability(version: string): Promise<void>;
  deactivateOfficeCapability(): Promise<void>;
  uninstallOfficeCapability(version?: string): Promise<void>;
}
