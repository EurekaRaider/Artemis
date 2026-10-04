import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface PreparedNodePtyRuntime {
  moduleRoot: string;
  dispose(): Promise<void>;
}

export type NodePtyArchitecture = "arm64" | "x64";

async function requireRealDirectory(path: string, description: string) {
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error(`${description} must be a real directory: ${path}`);
  }
}

async function copyRealFile(source: string, destination: string) {
  const information = await lstat(source);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new Error(`node-pty runtime file must be a real file: ${source}`);
  }
  await copyFile(source, destination);
  await chmod(destination, 0o600);
}

async function copyRealDirectory(source: string, destination: string) {
  await requireRealDirectory(source, "node-pty runtime directory");
  await mkdir(destination, { mode: 0o700 });

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`node-pty runtime cannot contain links: ${sourceEntry}`);
    }
    if (entry.isDirectory()) {
      await copyRealDirectory(sourceEntry, destinationEntry);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `node-pty runtime contains an unsupported entry: ${sourceEntry}`,
      );
    }
    await copyRealFile(sourceEntry, destinationEntry);
  }
}

export async function preparePackagedNodePtyRuntime(
  sourceRoot: string,
  architecture: NodePtyArchitecture,
): Promise<PreparedNodePtyRuntime> {
  if (!isAbsolute(sourceRoot)) {
    throw new Error("The packaged node-pty runtime path must be absolute.");
  }
  await requireRealDirectory(sourceRoot, "Packaged node-pty runtime");
  const packageJson = JSON.parse(
    await readFile(join(sourceRoot, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (packageJson.name !== "node-pty") {
    throw new Error("The packaged terminal runtime is not node-pty.");
  }

  const moduleRoot = await mkdtemp(join(tmpdir(), "artemis-node-pty-"));
  await chmod(moduleRoot, 0o700);
  let disposed = false;

  try {
    await copyRealFile(
      join(sourceRoot, "package.json"),
      join(moduleRoot, "package.json"),
    );
    await copyRealDirectory(join(sourceRoot, "lib"), join(moduleRoot, "lib"));

    const sourcePrebuild = join(
      sourceRoot,
      "prebuilds",
      `darwin-${architecture}`,
    );
    const destinationPrebuild = join(
      moduleRoot,
      "prebuilds",
      `darwin-${architecture}`,
    );
    await requireRealDirectory(sourcePrebuild, "node-pty Darwin prebuild");
    await mkdir(join(moduleRoot, "prebuilds"), { mode: 0o700 });
    await mkdir(destinationPrebuild, { mode: 0o700 });
    await copyRealFile(
      join(sourcePrebuild, "pty.node"),
      join(destinationPrebuild, "pty.node"),
    );
    const spawnHelper = join(destinationPrebuild, "spawn-helper");
    await copyRealFile(join(sourcePrebuild, "spawn-helper"), spawnHelper);
    await chmod(spawnHelper, 0o755);
  } catch (error) {
    await rm(moduleRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    moduleRoot,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(moduleRoot, { recursive: true, force: true });
    },
  };
}
