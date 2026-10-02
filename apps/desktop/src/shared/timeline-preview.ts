export const WORKSPACE_HTML_SCHEME = "artemis-preview";

export type TimelineFileKind =
  "image" | "video" | "audio" | "document" | "html";

/** Classification only. Main revalidates the task and workspace before every read. */
export function timelineFileKind(href: string): TimelineFileKind | undefined {
  const value = href.trim();
  if (!value || value.startsWith("//") || value.startsWith("#")) return;
  if (
    /^(?!file:)[a-z][a-z\d+.-]*:/iu.test(value) &&
    !/^[a-z]:[\\/]/iu.test(value)
  )
    return;
  let path: string;
  try {
    path = decodeURIComponent(value.split(/[?#]/u, 1)[0] ?? "");
  } catch {
    return;
  }
  const extension = path.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
  if (!extension) return;
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "avif",
      "apng",
      "bmp",
      "ico",
      "svg",
    ].includes(extension)
  )
    return "image";
  if (["mp4", "m4v", "webm", "mov"].includes(extension)) return "video";
  if (
    ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"].includes(
      extension,
    )
  )
    return "audio";
  if (
    ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv"].includes(
      extension,
    )
  )
    return "document";
  if (["html", "htm"].includes(extension)) return "html";
}

export function remotePreviewImage(href: string): boolean {
  return (
    /^https?:\/\//iu.test(href) ||
    /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+/=\s]+$/iu.test(href)
  );
}
