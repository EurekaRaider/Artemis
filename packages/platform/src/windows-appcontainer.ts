import { isAbsolute, resolve } from "node:path";

import { normalizeSandboxPolicy } from "./sandbox-executor.js";
import { encodeWindowsSandboxSpecification } from "./windows-sandbox-spec.js";

import type {
  SandboxCommand,
  SandboxLaunch,
  SandboxPolicy,
} from "./sandbox-executor.js";

export interface WindowsAppContainerOptions {
  helperPath: string;
  identity?: string;
  runtimePath?: string;
}

export function buildWindowsAppContainerLaunch(
  command: SandboxCommand,
  policyInput: SandboxPolicy,
  options: WindowsAppContainerOptions,
): SandboxLaunch {
  if (!isAbsolute(options.helperPath)) {
    throw new Error("Windows sandbox helper path must be absolute");
  }

  const policy = normalizeSandboxPolicy(policyInput);
  const encodedArguments = Buffer.from(
    JSON.stringify(command.args),
    "utf8",
  ).toString("base64");
  const writablePaths = Buffer.from(
    JSON.stringify(policy.writablePaths ?? []),
    "utf8",
  ).toString("base64");
  const readOnlyPaths = Buffer.from(
    JSON.stringify(policy.readOnlyPaths ?? []),
    "utf8",
  ).toString("base64");
  const sandboxSpecification = encodeWindowsSandboxSpecification({
    writablePaths: policy.writablePaths ?? [],
    readOnlyPaths: policy.readOnlyPaths ?? [],
    allowNetwork: policy.network === "allow",
  }).toString("base64");

  return {
    executable: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve(options.helperPath),
      "-Identity",
      options.identity ?? "Artemis.Agent",
      "-WorkspacePath",
      policy.workspacePath,
      "-WorkingDirectory",
      resolve(command.cwd),
      "-RuntimePath",
      resolve(options.runtimePath ?? command.cwd),
      "-Executable",
      command.executable,
      "-ArgumentsBase64",
      encodedArguments,
      "-WritablePathsBase64",
      writablePaths,
      "-ReadOnlyPathsBase64",
      readOnlyPaths,
      "-SandboxSpecificationBase64",
      sandboxSpecification,
      "-NetworkPolicy",
      policy.network,
    ],
    cwd: command.cwd,
    ...(command.env ? { env: command.env } : {}),
    implementation: "windows-appcontainer",
  };
}
