import { dirname } from "node:path";

import { normalizeSandboxPolicy } from "./sandbox-executor.js";

import type {
  SandboxCommand,
  SandboxLaunch,
  SandboxPolicy,
} from "./sandbox-executor.js";

function quoteSeatbelt(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function subpathRule(operation: string, paths: string[]): string[] {
  if (paths.length === 0) {
    return [];
  }

  return [
    `(allow ${operation}`,
    ...paths.map((path) => `  (subpath ${quoteSeatbelt(path)})`),
    ")",
  ];
}

function literalRule(operation: string, paths: string[]): string[] {
  if (paths.length === 0) return [];
  return [
    `(allow ${operation}`,
    ...paths.map((path) => `  (literal ${quoteSeatbelt(path)})`),
    ")",
  ];
}

function pathAncestors(paths: string[]): string[] {
  const ancestors = new Set<string>();
  for (const path of paths) {
    let current = dirname(path);
    while (current !== ".") {
      ancestors.add(current);
      if (current === "/") break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...ancestors];
}

export function buildSeatbeltProfile(input: SandboxPolicy): string {
  const policy = normalizeSandboxPolicy(input);
  const readablePaths = [
    policy.workspacePath,
    ...(policy.readOnlyPaths ?? []),
    "/System",
    "/Library",
    "/usr",
    "/bin",
    "/sbin",
    "/private/etc",
    "/dev",
  ];

  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    // Permit data transfer over inherited stdio pipes. Opening filesystem
    // paths still requires one of the path-scoped metadata rules below.
    "(allow file-read-data file-write-data)",
    ...literalRule(
      "file-read-metadata",
      pathAncestors([...readablePaths, ...(policy.writablePaths ?? [])]),
    ),
    ...subpathRule("file-read*", readablePaths),
    ...subpathRule("file-write*", policy.writablePaths ?? []),
    policy.network === "allow" ? "(allow network-outbound)" : "(deny network*)",
  ];

  return `${lines.join("\n")}\n`;
}

export function buildSeatbeltLaunch(
  command: SandboxCommand,
  policy: SandboxPolicy,
): SandboxLaunch {
  return {
    executable: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      buildSeatbeltProfile(policy),
      command.executable,
      ...command.args,
    ],
    cwd: command.cwd,
    ...(command.env ? { env: command.env } : {}),
    implementation: "macos-seatbelt",
  };
}
