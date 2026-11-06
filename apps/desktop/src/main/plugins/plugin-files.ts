import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { isSkillInstallerMetadata } from "./skill-metadata.js";
import {
  text,
  pathIsInside,
  portableRelative,
  strings,
} from "./plugin-values.js";
import {
  MAX_ICON_BYTES,
  MAX_ICON_DIMENSION,
  MAX_ICON_PIXELS,
  MAX_SKILL_FILES,
} from "./plugin-constants.js";
import { type CollectedFile } from "./plugin-types.js";
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readJson(
  path: string,
  maximumBytes: number,
): Promise<unknown> {
  const information = await lstat(path);
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    information.size > maximumBytes
  ) {
    throw new Error(`JSON file is invalid or too large: ${basename(path)}`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`JSON file could not be parsed: ${basename(path)}`);
  }
}

export async function readPluginText(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const information = await lstat(path);
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    information.size > maximumBytes
  ) {
    throw new Error(`Plugin file is invalid or too large: ${basename(path)}`);
  }
  return readFile(path, "utf8");
}

export async function readPluginIcon(
  root: string,
  input: unknown,
): Promise<string | undefined> {
  const declaration = text(input);
  if (!declaration) return undefined;
  try {
    const path = declaredPath(root, declaration, "Plugin icon");
    const information = await lstat(path);
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size > MAX_ICON_BYTES
    ) {
      return undefined;
    }
    const canonical = await realpath(path);
    if (!pathIsInside(await realpath(root), canonical)) return undefined;
    const contents = await readFile(canonical);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      contents.length < 24 ||
      !contents.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
      return undefined;
    }
    const width = contents.readUInt32BE(16);
    const height = contents.readUInt32BE(20);
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_ICON_DIMENSION ||
      height > MAX_ICON_DIMENSION ||
      width * height > MAX_ICON_PIXELS
    ) {
      return undefined;
    }
    return `data:image/png;base64,${contents.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function canonicalDirectory(
  inputPath: string,
  allowedRoot?: string,
): Promise<string> {
  const information = await lstat(inputPath);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error("Plugin source must be a real directory.");
  }
  const canonical = await realpath(inputPath);
  if (allowedRoot && !pathIsInside(await realpath(allowedRoot), canonical)) {
    throw new Error("Marketplace plugin path escapes its repository.");
  }
  return canonical;
}

export function declaredPath(
  root: string,
  input: string,
  label: string,
): string {
  const normalized = input.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized)) {
    throw new Error(`${label} path must be relative to the plugin root.`);
  }
  const destination = resolve(root, ...normalized.split("/"));
  if (!pathIsInside(root, destination)) {
    throw new Error(`${label} path escapes the plugin root.`);
  }
  return destination;
}

export async function collectFiles(
  root: string,
  options: {
    maximumFiles: number;
    maximumFileBytes: number;
    maximumBytes: number;
    rejectInstallerMetadata?: boolean;
    includeGit?: boolean;
  },
): Promise<CollectedFile[]> {
  const source = await canonicalDirectory(root);
  const files: CollectedFile[] = [];
  let totalBytes = 0;
  let directoryCount = 0;
  const visit = async (directory: string): Promise<void> => {
    directoryCount += 1;
    if (directoryCount > options.maximumFiles * 4) {
      throw new Error("Plugin package contains too many directories.");
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" && !options.includeGit) continue;
      const path = join(directory, entry.name);
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new Error(`Plugin packages cannot contain links: ${entry.name}`);
      }
      if (information.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!information.isFile()) {
        throw new Error(
          "Plugin packages can contain only files and directories.",
        );
      }
      const relativePath = portableRelative(relative(source, path));
      if (
        options.rejectInstallerMetadata &&
        isSkillInstallerMetadata(relativePath)
      ) {
        throw new Error("Plugin Skills cannot provide installer metadata.");
      }
      totalBytes += information.size;
      if (
        files.length + 1 > options.maximumFiles ||
        information.size > options.maximumFileBytes ||
        totalBytes > options.maximumBytes
      ) {
        throw new Error("Plugin package exceeds the installation limits.");
      }
      const contents = await readFile(path);
      files.push({
        absolutePath: path,
        relativePath,
        size: information.size,
        mode: information.mode,
        hash: createHash("sha256").update(contents).digest("hex"),
      });
    }
  };
  await visit(source);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function collectedHash(files: CollectedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath).update("\0").update(file.hash).update("\0");
  }
  return hash.digest("hex");
}

export async function copyCollectedFiles(
  destination: string,
  files: CollectedFile[],
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const target = resolve(destination, ...file.relativePath.split("/"));
    if (!pathIsInside(destination, target)) {
      throw new Error(`Plugin contains an unsafe path: ${file.relativePath}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target);
    await chmod(target, file.mode & 0o777);
  }
}

export async function discoverSkillRoots(root: string): Promise<string[]> {
  const roots: string[] = [];
  let visited = 0;
  const visit = async (directory: string): Promise<void> => {
    visited += 1;
    if (visited > MAX_SKILL_FILES * 4) {
      throw new Error("Plugin Skill directory contains too many entries.");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      roots.push(directory);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new Error("Plugin Skill directories cannot contain links.");
      }
      await visit(path);
    }
  };
  await visit(root);
  return roots;
}

export function manifestPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return strings(value);
}
