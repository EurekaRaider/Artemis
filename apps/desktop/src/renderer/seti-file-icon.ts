import { getIcon } from "seti-file-icons";

import {
  filePresentation,
  type WorkspaceFilePresentation,
} from "./workspace-file-presentation.js";

export interface SetiFileIcon {
  color: string;
  svg: string;
}

export function setiFileIcon(
  path: string,
  presentation: WorkspaceFilePresentation,
): SetiFileIcon {
  const fileName = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  const lookupName =
    presentation.type === "react"
      ? "file.jsx"
      : presentation.type === "markdown"
        ? "file.md"
        : presentation.type === "json"
          ? "file.json"
          : presentation.type === "cmake"
            ? "Makefile"
            : fileName;
  return getIcon(lookupName);
}

export function workspaceFileIconPath(href: string): string {
  const value = href.trim();
  if (/^file:/iu.test(value)) {
    try {
      return decodeURI(new URL(value).pathname);
    } catch {
      return value;
    }
  }

  const path = value
    .replace(/#L[1-9]\d*(?:C[1-9]\d*)?$/iu, "")
    .replace(/:[1-9]\d*(?::[1-9]\d*)?$/u, "");
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function workspaceFileLinkIcon(href: string): SetiFileIcon {
  const path = workspaceFileIconPath(href);
  return setiFileIcon(path, filePresentation(path));
}
