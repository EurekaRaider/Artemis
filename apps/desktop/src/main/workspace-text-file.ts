import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorkspacePath } from "@artemis/platform";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileContent,
  WorkspaceImageFile,
  WorkspaceTextFile,
} from "../shared/api.js";

const MAX_WORKSPACE_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_WORKSPACE_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 5_000;

const fileKinds = new Map<string, WorkspaceTextFile["kind"]>([
  [".htm", "html"],
  [".html", "html"],
  [".markdown", "markdown"],
  [".md", "markdown"],
]);

const imageMimeTypes = new Map<string, WorkspaceImageFile["mimeType"]>([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function detectedImageMimeType(
  data: Buffer,
  fallback: WorkspaceImageFile["mimeType"],
): WorkspaceImageFile["mimeType"] {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return fallback;
}

export async function readWorkspaceTextFile(
  workspacePath: string,
  path: string,
): Promise<WorkspaceTextFile> {
  const requestedPath = path.trim();
  const kind = fileKinds.get(extname(requestedPath).toLowerCase());
  if (!kind) {
    throw new Error("Workspace preview supports only HTML or Markdown files.");
  }

  const absolutePath = resolveWorkspacePath(workspacePath, requestedPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error("Workspace preview path is not a file.");
  }
  if (metadata.size > MAX_WORKSPACE_TEXT_FILE_BYTES) {
    throw new Error("Workspace preview file exceeds 4 MiB.");
  }

  return {
    path: requestedPath,
    kind,
    content: await readFile(absolutePath, "utf8"),
  };
}

function localWorkspaceImagePath(href: string): string {
  const value = href.trim();
  if (!value || value.startsWith("//")) {
    throw new Error("Markdown image is not a local workspace image.");
  }
  if (/^file:/iu.test(value)) {
    try {
      return fileURLToPath(new URL(value));
    } catch {
      throw new Error("Markdown image file URL is invalid.");
    }
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(value) && !/^[a-z]:[\\/]/iu.test(value)) {
    throw new Error("Markdown image is not a local workspace image.");
  }
  const pathWithoutQuery = value.split(/[?#]/u, 1)[0] ?? "";
  try {
    return decodeURIComponent(pathWithoutQuery);
  } catch {
    throw new Error("Markdown image path is invalid.");
  }
}

export async function readWorkspaceImage(
  workspacePath: string,
  markdownPath: string,
  href: string,
): Promise<WorkspaceImageFile> {
  const requestedMarkdownPath = markdownPath.trim();
  const imagePath = localWorkspaceImagePath(href);
  const requestedImagePath = isAbsolute(imagePath)
    ? imagePath
    : join(dirname(requestedMarkdownPath), imagePath);
  const configuredMimeType = imageMimeTypes.get(
    extname(requestedImagePath).toLowerCase(),
  );
  if (!configuredMimeType) {
    throw new Error("Markdown image format is not supported.");
  }

  const absolutePath = resolveWorkspacePath(workspacePath, requestedImagePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error("Markdown image path is not a file.");
  }
  if (metadata.size > MAX_WORKSPACE_IMAGE_BYTES) {
    throw new Error("Markdown image exceeds 16 MiB.");
  }
  const data = await readFile(absolutePath);

  return {
    path: relative(await realpath(workspacePath), absolutePath).replaceAll(
      "\\",
      "/",
    ),
    mimeType: detectedImageMimeType(data, configuredMimeType),
    data: data.toString("base64"),
  };
}

function relativeChildPath(parent: string, name: string): string {
  return (parent ? join(parent, name) : name).replaceAll("\\", "/");
}

export async function listWorkspaceDirectory(
  workspacePath: string,
  path: string,
): Promise<WorkspaceDirectoryEntry[]> {
  const requestedPath = path.trim();
  const absolutePath = resolveWorkspacePath(workspacePath, requestedPath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new Error("Workspace directory contains more than 5,000 entries.");
  }

  return entries
    .map((entry): WorkspaceDirectoryEntry => ({
      name: entry.name,
      path: relativeChildPath(requestedPath, entry.name),
      kind: entry.isDirectory()
        ? "directory"
        : entry.isSymbolicLink()
          ? "symlink"
          : "file",
    }))
    .sort(
      (left, right) =>
        Number(right.kind === "directory") -
          Number(left.kind === "directory") ||
        left.name.localeCompare(right.name),
    );
}

export async function readWorkspaceFile(
  workspacePath: string,
  path: string,
): Promise<WorkspaceFileContent> {
  const requestedPath = path.trim();
  const absolutePath = resolveWorkspacePath(workspacePath, requestedPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error("Workspace path is not a file.");
  }
  if (metadata.size > MAX_WORKSPACE_TEXT_FILE_BYTES) {
    throw new Error("Workspace file exceeds 4 MiB.");
  }

  const bytes = await readFile(absolutePath);
  const binary = bytes.includes(0);
  return {
    path: requestedPath,
    binary,
    ...(binary ? {} : { content: bytes.toString("utf8") }),
  };
}

export async function writeWorkspaceFile(
  workspacePath: string,
  path: string,
  content: string,
): Promise<WorkspaceFileContent> {
  const requestedPath = path.trim();
  const absolutePath = resolveWorkspacePath(workspacePath, requestedPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error("Workspace path is not a file.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_TEXT_FILE_BYTES) {
    throw new Error("Workspace file exceeds 4 MiB.");
  }
  if ((await readFile(absolutePath)).includes(0)) {
    throw new Error("Binary workspace files cannot be edited.");
  }

  await writeFile(absolutePath, content, "utf8");
  return {
    path: requestedPath,
    binary: false,
    content,
  };
}
