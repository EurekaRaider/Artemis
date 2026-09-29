// Shared classification only. Main validates the actual workspace path before reading.
export const WORKSPACE_VIDEO_SCHEME = "artemis-media";

export function workspaceVideoMimeType(path: string): string | undefined {
  const extension = path.toLowerCase().match(/\.(mp4|m4v|webm|mov)$/u)?.[1];
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return undefined;
}

export interface WorkspaceVideoSource {
  path: string;
  mimeType: string;
  version: string;
  url: string;
}
