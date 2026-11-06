export interface WorkspaceFilesApi {
  readWorkspaceTextFile(
    threadId: string,
    path: string,
  ): Promise<WorkspaceTextFile>;
  readWorkspaceImage(
    threadId: string,
    markdownPath: string,
    href: string,
  ): Promise<WorkspaceImageFile>;
  listWorkspaceDirectory(
    threadId: string,
    path: string,
  ): Promise<WorkspaceDirectoryEntry[]>;
  readWorkspaceFile(
    threadId: string,
    path: string,
  ): Promise<WorkspaceFileContent>;
  writeWorkspaceFile(
    threadId: string,
    path: string,
    content: string,
  ): Promise<WorkspaceFileContent>;
  inspectWorkspaceFileLink(
    threadId: string,
    href: string,
  ): Promise<WorkspaceFileLink>;
  revealWorkspaceFile(threadId: string, path: string): Promise<void>;
  runWorkspaceFile(threadId: string, path: string): Promise<void>;
}

export interface WorkspaceTextFile {
  path: string;
  kind: "html" | "markdown";
  content: string;
}

export interface WorkspaceImageFile {
  path: string;
  mimeType:
    | "image/bmp"
    | "image/x-icon"
    | "image/avif"
    | "image/gif"
    | "image/jpeg"
    | "image/png"
    | "image/svg+xml"
    | "image/webp";
  data: string;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink";
}

export interface WorkspaceFileContent {
  path: string;
  binary: boolean;
  content?: string;
  preview?: {
    mimeType: WorkspaceImageFile["mimeType"] | "application/pdf";
    data: string;
  };
}

export interface WorkspaceFileLink {
  path: string;
  viewer: "markdown" | "browser" | "file" | "office";
  executable: boolean;
  line?: number;
  column?: number;
}
