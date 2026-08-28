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

function networkRules(network: SandboxPolicy["network"]): string[] {
  if (network === "deny") return ["(deny network*)"];
  return [
    "(allow network-outbound)",
    "(allow network-inbound)",
    "(allow system-socket",
    "  (require-all",
    "    (socket-domain AF_SYSTEM)",
    "    (socket-protocol 2)",
    "  )",
    ")",
  ];
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
    '(allow file-read-data (literal "/"))',
    "(allow file-read-data file-test-existence file-write-data",
    '  (subpath "/dev/fd"))',
    '(allow file-read* file-write* (literal "/dev/null"))',
    ...literalRule("file-read-metadata", [
      ...pathAncestors([...readablePaths, ...(policy.writablePaths ?? [])]),
      // macOS exposes these standard locations as symlinks into /private.
      // libc DNS resolution stats /etc before following it to /private/etc.
      "/etc",
      "/tmp",
      "/var",
    ]),
    ...subpathRule("file-read*", readablePaths),
    ...subpathRule("file-write*", policy.writablePaths ?? []),
    ...networkRules(policy.network),
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
