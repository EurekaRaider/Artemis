import { posix } from "node:path";

const MACOS_RUNTIME_MARKER = "/Contents/MacOS/";

export function macosAppRuntimeReadOnlyPaths(
  platform: NodeJS.Platform,
  executablePath: string,
): string[] {
  if (platform !== "darwin") return [];

  const normalizedPath = posix.normalize(executablePath);
  if (!posix.isAbsolute(normalizedPath)) return [];

  const markerIndex = normalizedPath.lastIndexOf(MACOS_RUNTIME_MARKER);
  if (markerIndex < 1) return [];

  const appPath = normalizedPath.slice(0, markerIndex);
  if (!appPath.endsWith(".app")) return [];

  const contentsPath = `${appPath}/Contents`;
  return [
    `${contentsPath}/MacOS`,
    `${contentsPath}/Frameworks`,
    `${contentsPath}/Resources`,
  ];
}
