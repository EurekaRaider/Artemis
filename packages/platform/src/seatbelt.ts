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
    "(allow file-read-metadata)",
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
