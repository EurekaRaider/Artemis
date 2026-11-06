import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { pathIsInside } from "./mcp-runtime-paths.js";
import {
  type ResolvedWindowsStdioCommand,
  type ResolvedWindowsStdioCommandDetails,
} from "./mcp-connection-types.js";
export function npxPackageInvocation(
  args: string[],
): { packageName: string; packageArgs: string[] } | undefined {
  const packageIndex = args.findIndex(
    (argument) => argument !== "--" && !argument.startsWith("-"),
  );
  if (packageIndex < 0) return undefined;
  const specification = args[packageIndex]!;
  const slash = specification.indexOf("/");
  const versionSeparator = specification.lastIndexOf("@");
  const packageName =
    versionSeparator > Math.max(0, slash)
      ? specification.slice(0, versionSeparator)
      : specification;
  if (!/^(?:@[-a-zA-Z0-9_.]+\/)?[-a-zA-Z0-9_.]+$/u.test(packageName)) {
    return undefined;
  }
  return {
    packageName,
    packageArgs: args.slice(packageIndex + 1),
  };
}

export async function resolveCachedNpxCommand(
  args: string[],
  cacheDirectory: string,
  nodeExecutable: string,
): Promise<ResolvedWindowsStdioCommand | undefined> {
  const invocation = npxPackageInvocation(args);
  if (!invocation) return undefined;
  let cacheEntries;
  try {
    cacheEntries = await readdir(join(cacheDirectory, "_npx"), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const cacheEntry of cacheEntries) {
    if (!cacheEntry.isDirectory()) continue;
    const packageDirectory = join(
      cacheDirectory,
      "_npx",
      cacheEntry.name,
      "node_modules",
      ...invocation.packageName.split("/"),
    );
    try {
      const metadata = JSON.parse(
        await readFile(join(packageDirectory, "package.json"), "utf8"),
      ) as { name?: unknown; bin?: unknown };
      if (metadata.name !== invocation.packageName) continue;
      const bin =
        typeof metadata.bin === "string"
          ? metadata.bin
          : metadata.bin &&
              typeof metadata.bin === "object" &&
              !Array.isArray(metadata.bin)
            ? Object.values(metadata.bin).find(
                (value): value is string => typeof value === "string",
              )
            : undefined;
      if (!bin) continue;
      const entryPath = resolve(packageDirectory, bin);
      if (
        !pathIsInside(packageDirectory, entryPath) ||
        !existsSync(entryPath)
      ) {
        continue;
      }
      return {
        executable: nodeExecutable,
        args: [entryPath, ...invocation.packageArgs],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

export async function stageNpxRuntime(
  resolved: ResolvedWindowsStdioCommandDetails,
  runtimeDirectory: string,
): Promise<ResolvedWindowsStdioCommandDetails> {
  if (
    !resolved.shimPath ||
    basename(resolved.shimPath).toLowerCase() !== "npx.cmd" ||
    !resolved.args[0]
  ) {
    return resolved;
  }
  const sourceRoot = join(dirname(resolved.shimPath), "node_modules", "npm");
  const sourceScript = resolved.args[0];
  if (!existsSync(sourceRoot) || !pathIsInside(sourceRoot, sourceScript)) {
    return resolved;
  }
  const destinationRoot = join(runtimeDirectory, "npm");
  const binaryDirectory = join(runtimeDirectory, "bin");
  const stagedNode = join(binaryDirectory, "node.exe");
  await mkdir(binaryDirectory, { recursive: true });
  if (!existsSync(stagedNode)) {
    await copyFile(resolved.executable, stagedNode);
  }
  if (!existsSync(join(destinationRoot, "package.json"))) {
    await cp(sourceRoot, destinationRoot, {
      recursive: true,
      force: true,
    });
  }
  return {
    executable: stagedNode,
    args: [
      join(destinationRoot, relative(sourceRoot, sourceScript)),
      ...resolved.args.slice(1),
    ],
  };
}

export function withNodeResolutionArguments(
  executable: string,
  args: string[],
): string[] {
  if (basename(executable).toLowerCase() !== "node.exe") return args;
  const required = ["--preserve-symlinks", "--preserve-symlinks-main"];
  const entryIndex = args.findIndex(
    (argument) => isAbsolute(argument) && /\.(?:c?js|mjs)$/iu.test(argument),
  );
  const normalizedArgs =
    entryIndex >= 0 && args[entryIndex - 1] !== "--entry-url"
      ? [
          ...args.slice(0, entryIndex),
          "--entry-url",
          pathToFileURL(args[entryIndex]!).href,
          ...args.slice(entryIndex + 1),
        ]
      : args;
  return [
    ...required.filter((argument) => !normalizedArgs.includes(argument)),
    ...normalizedArgs,
  ];
}
