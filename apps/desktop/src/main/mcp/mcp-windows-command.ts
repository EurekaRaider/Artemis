import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  win32,
} from "node:path";
import {
  type ResolvedWindowsStdioCommand,
  type ResolveWindowsCommandShim,
  type ResolvedWindowsStdioCommandDetails,
} from "./mcp-connection-types.js";
export function resolveWindowsExecutable(command: string): string {
  if (isAbsolute(command) || win32.isAbsolute(command)) return command;
  if (command.includes("\\") || command.includes("/")) {
    return resolve(command);
  }
  try {
    const candidates = execFileSync("where.exe", [command], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/u)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    const preferredExtensions = [".exe", ".com", ".cmd", ".bat", ".ps1"];
    for (const extension of preferredExtensions) {
      const candidate = candidates.find(
        (value) => extname(value).toLowerCase() === extension,
      );
      if (candidate) return candidate;
    }
    if (candidates[0]) return candidates[0];
  } catch {
    // The actionable error below is more useful than where.exe's exit status.
  }
  throw new Error(`MCP executable was not found on PATH: ${command}`);
}

export function resolveNpmCommandShim(
  shimPath: string,
  args: string[],
): ResolvedWindowsStdioCommand | undefined {
  const directory = dirname(shimPath);
  let scriptPath: string | undefined;
  if (basename(shimPath).toLowerCase() === "npx.cmd") {
    const candidate = join(
      directory,
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );
    if (existsSync(candidate)) scriptPath = candidate;
  }
  if (!scriptPath) {
    try {
      const source = readFileSync(shimPath, "utf8");
      const match = source.match(/["']%dp0%[\\/]([^"']+?\.(?:c?js|mjs))["']/iu);
      if (match?.[1]) {
        const candidate = resolve(directory, ...match[1].split(/[\\/]+/u));
        if (existsSync(candidate)) scriptPath = candidate;
      }
    } catch {
      return undefined;
    }
  }
  if (!scriptPath) return undefined;
  if (basename(scriptPath).toLowerCase() === "npm-shim.js") {
    try {
      const packageRoot = dirname(scriptPath);
      const packageMetadata = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (
        typeof packageMetadata.name === "string" &&
        /^(?:@[^/]+\/)?codegraph$/u.test(packageMetadata.name)
      ) {
        const separator = packageMetadata.name.lastIndexOf("/");
        const scope =
          separator >= 0 ? packageMetadata.name.slice(0, separator) : "";
        const bundleRoot = join(
          packageRoot,
          "node_modules",
          ...(scope ? [scope] : []),
          "codegraph-win32-x64",
        );
        const bundledNode = join(bundleRoot, "node.exe");
        const bundledEntry = join(
          bundleRoot,
          "lib",
          "dist",
          "bin",
          "codegraph.js",
        );
        if (existsSync(bundledNode) && existsSync(bundledEntry)) {
          return {
            executable: bundledNode,
            args: ["--liftoff-only", bundledEntry, ...args],
          };
        }
      }
    } catch {
      // Fall back to the package's standard npm shim below.
    }
  }
  const adjacentNode = join(directory, "node.exe");
  const nodeExecutable = existsSync(adjacentNode)
    ? adjacentNode
    : resolveWindowsExecutable("node");
  return {
    executable: nodeExecutable,
    args: [scriptPath, ...args],
  };
}

export function resolveWindowsStdioCommandDetails(
  command: string,
  args: string[],
  resolveExecutable: (command: string) => string,
  resolveCommandShim: ResolveWindowsCommandShim,
): ResolvedWindowsStdioCommandDetails {
  if (
    (isAbsolute(command) || win32.isAbsolute(command)) &&
    [".com", ".exe"].includes(extname(command).toLowerCase())
  ) {
    return { executable: command, args };
  }
  const executable = resolveExecutable(command);
  const extension = extname(executable).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    const direct = resolveCommandShim(executable, args);
    if (direct) {
      return { ...direct, shimPath: executable };
    }
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", executable, ...args],
      shimPath: executable,
    };
  }
  if (extension === ".ps1") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        executable,
        ...args,
      ],
      shimPath: executable,
    };
  }
  return { executable, args };
}

export function resolveWindowsStdioCommand(
  command: string,
  args: string[],
  resolveExecutable: (command: string) => string = resolveWindowsExecutable,
  resolveCommandShim: ResolveWindowsCommandShim = resolveNpmCommandShim,
): ResolvedWindowsStdioCommand {
  const resolved = resolveWindowsStdioCommandDetails(
    command,
    args,
    resolveExecutable,
    resolveCommandShim,
  );
  return { executable: resolved.executable, args: resolved.args };
}
