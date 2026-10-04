import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, win32 as windowsPath } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ACCESS_MARKER_VERSION = 1;

interface AccessMarker {
  version: number;
  applicationRoot: string;
  applicationVersion: string;
  applicationCreatedAtMs: number;
}

export interface WindowsPackageAccessOptions {
  applicationRoot: string;
  applicationVersion: string;
  markerPath: string;
  platform?: NodeJS.Platform;
  systemRoot?: string;
  applyAcl?: (command: string, args: string[]) => Promise<void>;
}

async function markerMatches(
  path: string,
  expected: AccessMarker,
): Promise<boolean> {
  try {
    const value = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<AccessMarker>;
    return (
      value.version === expected.version &&
      value.applicationRoot === expected.applicationRoot &&
      value.applicationVersion === expected.applicationVersion &&
      value.applicationCreatedAtMs === expected.applicationCreatedAtMs
    );
  } catch {
    return false;
  }
}

export async function ensureWindowsPackageAccess(
  options: WindowsPackageAccessOptions,
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return false;
  if (!isAbsolute(options.applicationRoot)) {
    throw new Error("The Windows application directory must be absolute.");
  }

  const applicationRoot = resolve(options.applicationRoot);
  const applicationInformation = await stat(applicationRoot);
  if (!applicationInformation.isDirectory()) {
    throw new Error("The Windows application path must be a directory.");
  }
  const expected: AccessMarker = {
    version: ACCESS_MARKER_VERSION,
    applicationRoot,
    applicationVersion: options.applicationVersion,
    applicationCreatedAtMs:
      applicationInformation.birthtimeMs || applicationInformation.ctimeMs,
  };
  if (await markerMatches(options.markerPath, expected)) return false;

  const systemRoot =
    options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !windowsPath.isAbsolute(systemRoot)) {
    throw new Error("Windows system directory is unavailable.");
  }
  const command = windowsPath.join(systemRoot, "System32", "icacls.exe");
  const args = [
    applicationRoot,
    "/grant",
    "*S-1-15-2-1:(OI)(CI)(RX)",
    "*S-1-15-2-2:(OI)(CI)(RX)",
    "/T",
    "/C",
    "/Q",
  ];
  if (options.applyAcl) {
    await options.applyAcl(command, args);
  } else {
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        "Artemis could not prepare AppContainer read access. Extract the ZIP to a folder you own and try again.",
        { cause: error },
      );
    }
  }

  await mkdir(dirname(options.markerPath), { recursive: true });
  const temporaryPath = `${options.markerPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(expected, undefined, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryPath, options.markerPath);
  return true;
}
