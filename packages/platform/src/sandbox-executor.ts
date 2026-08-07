import { posix, resolve, win32 } from "node:path";

import type { RunMode } from "@artemis/protocol";

export type NetworkPolicy = "deny" | "allow";

export interface SandboxPolicy {
  workspacePath: string;
  mode: RunMode;
  network: NetworkPolicy;
  writablePaths?: string[];
  readOnlyPaths?: string[];
}

export interface SandboxCommand {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface SandboxLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  implementation: "windows-appcontainer" | "macos-seatbelt" | "desktop-user";
}

export function buildDesktopUserLaunch(command: SandboxCommand): SandboxLaunch {
  return {
    ...command,
    implementation: "desktop-user",
  };
}

function resolveSandboxPath(path: string): string {
  if (path.startsWith("/")) {
    return posix.normalize(path);
  }
  if (/^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\")) {
    return win32.normalize(path);
  }
  return resolve(path);
}

export function normalizeSandboxPolicy(policy: SandboxPolicy): SandboxPolicy {
  const workspacePath = resolveSandboxPath(policy.workspacePath);
  const isWritableMode = policy.mode === "execute";
  const writablePaths = [
    workspacePath,
    ...(policy.writablePaths ?? []).map(resolveSandboxPath),
  ];

  if (!isWritableMode && writablePaths.length > 1) {
    throw new Error(`${policy.mode} mode cannot add writable paths`);
  }

  return {
    ...policy,
    workspacePath,
    readOnlyPaths: [
      ...new Set((policy.readOnlyPaths ?? []).map(resolveSandboxPath)),
    ],
    writablePaths: isWritableMode ? [...new Set(writablePaths)] : [],
  };
}
