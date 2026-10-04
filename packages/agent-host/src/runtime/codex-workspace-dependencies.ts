import { access, lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const MAX_RUNTIME_METADATA_BYTES = 1024 * 1024;

export interface CodexWorkspaceDependencies {
  bundleVersion: string;
  gitExecutable: string;
  libreOfficeExecutable?: string;
  nodeExecutable: string;
  nodeModules: string;
  pdfInfoExecutable: string;
  pdfRendererExecutable: string;
  pnpmExecutable: string;
  pythonExecutable: string;
  pythonPackages: string;
  overrideBinaries: string;
  fallbackBinaries: string;
}

function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

async function existingPath(path: string): Promise<string | undefined> {
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await existingPath(path)) return path;
  }
  return undefined;
}

export function defaultCodexPrimaryRuntimeRoot(): string {
  const configured = process.env.ARTEMIS_CODEX_RUNTIME_ROOT;
  if (configured && isAbsolute(configured)) return configured;
  return join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime");
}

export async function resolveCodexWorkspaceDependencies(
  inputRoot = defaultCodexPrimaryRuntimeRoot(),
): Promise<CodexWorkspaceDependencies | undefined> {
  try {
    const information = await lstat(inputRoot);
    if (!information.isDirectory() || information.isSymbolicLink()) {
      return undefined;
    }
    const root = await realpath(inputRoot);
    const metadataPath = join(root, "runtime.json");
    const metadataInformation = await lstat(metadataPath);
    if (
      !metadataInformation.isFile() ||
      metadataInformation.isSymbolicLink() ||
      metadataInformation.size > MAX_RUNTIME_METADATA_BYTES
    ) {
      return undefined;
    }
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      bundleVersion?: unknown;
      targetArch?: unknown;
      targetPlatform?: unknown;
    };
    if (
      typeof metadata.bundleVersion !== "string" ||
      !metadata.bundleVersion.trim() ||
      metadata.targetPlatform !== process.platform ||
      metadata.targetArch !== process.arch
    ) {
      return undefined;
    }

    const dependencies = join(root, "dependencies");
    const nodeExecutable = await firstExisting(
      process.platform === "win32"
        ? [
            join(dependencies, "node", "bin", "node.exe"),
            join(dependencies, "node", "node.exe"),
          ]
        : [join(dependencies, "node", "bin", "node")],
    );
    const pythonExecutable = await firstExisting(
      process.platform === "win32"
        ? [
            join(dependencies, "python", "python.exe"),
            join(dependencies, "python", "Scripts", "python.exe"),
          ]
        : [join(dependencies, "python", "bin", "python3")],
    );
    const gitExecutable = await firstExisting([
      ...(process.platform === "win32"
        ? [join(dependencies, "native", "git", "cmd", "git.exe")]
        : []),
      join(
        dependencies,
        "bin",
        "fallback",
        process.platform === "win32" ? "git.exe" : "git",
      ),
      join(
        dependencies,
        "bin",
        "override",
        process.platform === "win32" ? "git.exe" : "git",
      ),
    ]);
    const pnpmExecutable = await firstExisting([
      join(
        dependencies,
        "bin",
        "fallback",
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ),
      join(
        dependencies,
        "bin",
        "fallback",
        process.platform === "win32" ? "pnpm.exe" : "pnpm",
      ),
    ]);
    const nodeModules = await existingPath(
      join(dependencies, "node", "node_modules"),
    );
    const artifactTool = await existingPath(
      join(
        dependencies,
        "node",
        "node_modules",
        "@oai",
        "artifact-tool",
        "package.json",
      ),
    );
    const pythonPackages = await existingPath(join(dependencies, "python"));
    const overrideBinaries = await existingPath(
      join(dependencies, "bin", "override"),
    );
    const fallbackBinaries = await existingPath(
      join(dependencies, "bin", "fallback"),
    );
    const libreOfficeExecutable = await firstExisting([
      join(
        dependencies,
        "bin",
        "override",
        process.platform === "win32" ? "soffice.exe" : "soffice",
      ),
      join(dependencies, "bin", "override", "soffice"),
    ]);
    const pdfInfoExecutable = await firstExisting([
      ...(process.platform === "win32"
        ? [join(dependencies, "bin", "override", "pdfinfo.cmd")]
        : []),
      join(
        dependencies,
        "bin",
        "override",
        process.platform === "win32" ? "pdfinfo.exe" : "pdfinfo",
      ),
      join(dependencies, "bin", "override", "pdfinfo"),
    ]);
    const pdfRendererExecutable = await firstExisting([
      ...(process.platform === "win32"
        ? [join(dependencies, "bin", "override", "pdftoppm.cmd")]
        : []),
      join(
        dependencies,
        "bin",
        "override",
        process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm",
      ),
      join(dependencies, "bin", "override", "pdftoppm"),
    ]);
    const paths = [
      nodeExecutable,
      pythonExecutable,
      gitExecutable,
      pdfInfoExecutable,
      pdfRendererExecutable,
      pnpmExecutable,
      nodeModules,
      artifactTool,
      pythonPackages,
      overrideBinaries,
      fallbackBinaries,
    ];
    if (
      paths.some((path) => !path || !pathIsInside(root, path)) ||
      !nodeExecutable ||
      !pythonExecutable ||
      !gitExecutable ||
      !pdfInfoExecutable ||
      !pdfRendererExecutable ||
      !pnpmExecutable ||
      !nodeModules ||
      !pythonPackages ||
      !overrideBinaries ||
      !fallbackBinaries
    ) {
      return undefined;
    }

    return {
      bundleVersion: metadata.bundleVersion,
      gitExecutable,
      ...(libreOfficeExecutable ? { libreOfficeExecutable } : {}),
      nodeExecutable,
      nodeModules,
      pdfInfoExecutable,
      pdfRendererExecutable,
      pnpmExecutable,
      pythonExecutable,
      pythonPackages,
      overrideBinaries,
      fallbackBinaries,
    };
  } catch {
    return undefined;
  }
}
