import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorkspacePath } from "@artemis/platform";

import type { WorkspaceFileLink } from "../shared/api.js";

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set([".bat", ".cmd", ".com", ".exe"]);

export interface ResolvedWorkspaceFileLink extends WorkspaceFileLink {
  absolutePath: string;
}

interface ParsedFileHref {
  path: string;
  line?: number;
  column?: number;
}

function decodePath(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    throw new Error("The linked file path is not valid URI text.");
  }
}

function fileLocationFragment(value: string): ParsedFileHref {
  const match = value.match(/#L(?<line>[1-9]\d*)(?:C(?<column>[1-9]\d*))?$/iu);
  if (!match?.groups) return { path: decodePath(value) };
  return {
    path: decodePath(value.slice(0, match.index)),
    line: Number(match.groups.line),
    ...(match.groups.column ? { column: Number(match.groups.column) } : {}),
  };
}

function parseFileHref(href: string): ParsedFileHref {
  const value = href.trim();
  if (!value) throw new Error("The linked file path is empty.");

  if (/^file:/iu.test(value)) {
    const url = new URL(value);
    if (url.protocol !== "file:" || url.search) {
      throw new Error("The linked file URL is not valid.");
    }
    const location = fileLocationFragment(url.hash);
    url.hash = "";
    return {
      path: fileURLToPath(url),
      ...(location.line !== undefined ? { line: location.line } : {}),
      ...(location.column !== undefined ? { column: location.column } : {}),
    };
  }

  const windowsPath = /^[a-z]:[\\/]/iu.test(value) || /^\\\\/u.test(value);
  if (
    !windowsPath &&
    /^(?:blob|data|https?|javascript|mailto):/iu.test(value)
  ) {
    throw new Error("Only local workspace file links can be opened here.");
  }
  return fileLocationFragment(value);
}

function withLineSuffix(location: ParsedFileHref): ParsedFileHref | undefined {
  if (location.line !== undefined) return undefined;
  const match = location.path.match(
    /:(?<line>[1-9]\d*)(?::(?<column>[1-9]\d*))?$/u,
  );
  if (!match?.groups) return undefined;
  return {
    path: location.path.slice(0, match.index),
    line: Number(match.groups.line),
    ...(match.groups.column ? { column: Number(match.groups.column) } : {}),
  };
}

export function workspaceFileViewer(path: string): WorkspaceFileLink["viewer"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".htm" || extension === ".html") return "browser";
  return "file";
}

export function isWorkspaceFileExecutable(
  path: string,
  mode: number,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    ? WINDOWS_EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase())
    : (mode & 0o111) !== 0;
}

export async function resolveWorkspaceFileLink(
  workspacePath: string,
  href: string,
): Promise<ResolvedWorkspaceFileLink> {
  const canonicalWorkspacePath = await realpath(workspacePath);
  const location = parseFileHref(href);
  const candidates = [location, withLineSuffix(location)].filter(
    (candidate): candidate is ParsedFileHref => Boolean(candidate?.path),
  );
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const requestedPath = isAbsolute(candidate.path)
        ? await realpath(candidate.path)
        : candidate.path;
      const absolutePath = resolveWorkspacePath(
        canonicalWorkspacePath,
        requestedPath,
      );
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) {
        throw new Error("The linked workspace path is not a file.");
      }
      return {
        absolutePath,
        path: relative(canonicalWorkspacePath, absolutePath).replaceAll(
          "\\",
          "/",
        ),
        viewer: workspaceFileViewer(absolutePath),
        executable: isWorkspaceFileExecutable(absolutePath, metadata.mode),
        ...(candidate.line !== undefined ? { line: candidate.line } : {}),
        ...(candidate.column !== undefined ? { column: candidate.column } : {}),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The linked workspace file could not be opened.");
}
