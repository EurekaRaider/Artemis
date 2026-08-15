import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { basename, win32 } from "node:path";

import type { WindowsShellPreference } from "@artemis/protocol";

export type ShellKind = "powershell" | "zsh" | "bash" | "sh";

export interface ResolvedShellRuntime {
  kind: ShellKind;
  executable: string;
  version?: string;
  edition?: "Core" | "Desktop";
}

export interface ShellResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  requestedShell?: string;
  windowsPreference: WindowsShellPreference;
}

export interface ShellResolutionProbe {
  canonicalize(path: string): string;
  findOnPath(executable: string): string[];
  isFile(path: string): boolean;
  probePowerShell(
    path: string,
  ): { version: string; edition: "Core" | "Desktop" } | undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.map((value) => value?.trim()).filter(Boolean) as string[],
    ),
  ];
}

function executableName(path: string): string {
  return basename(path)
    .toLowerCase()
    .replace(/\.exe$/u, "");
}

function defaultFindOnPath(executable: string): string[] {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    return execFileSync(locator, [executable], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function defaultProbePowerShell(
  path: string,
): { version: string; edition: "Core" | "Desktop" } | undefined {
  try {
    const output = execFileSync(
      path,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::Out.Write($PSVersionTable.PSVersion.ToString() + '|' + $PSVersionTable.PSEdition)",
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      },
    ).replaceAll("\0", "");
    const [version, edition] = output.trim().split("|");
    if (!version || (edition !== "Core" && edition !== "Desktop")) {
      return undefined;
    }
    return { version, edition };
  } catch {
    return undefined;
  }
}

const defaultProbe: ShellResolutionProbe = {
  canonicalize: (path) => realpathSync.native(path),
  findOnPath: defaultFindOnPath,
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  probePowerShell: defaultProbePowerShell,
};

function existingCandidates(
  candidates: Array<string | undefined>,
  probe: ShellResolutionProbe,
): string[] {
  return unique(candidates)
    .filter((path) => probe.isFile(path))
    .map((path) => probe.canonicalize(path));
}

function resolvePowerShell(
  options: ShellResolutionOptions,
  probe: ShellResolutionProbe,
): ResolvedShellRuntime {
  const env = options.env ?? process.env;
  const programFiles = env.ProgramFiles;
  const localAppData = env.LOCALAPPDATA;
  const pwshCandidates = existingCandidates(
    [
      programFiles
        ? win32.join(programFiles, "PowerShell", "7", "pwsh.exe")
        : undefined,
      localAppData
        ? win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe")
        : undefined,
      ...probe.findOnPath("pwsh.exe"),
      ...probe.findOnPath("pwsh"),
    ],
    probe,
  );
  if (options.windowsPreference !== "windows-powershell") {
    for (const executable of pwshCandidates) {
      const details = probe.probePowerShell(executable);
      const major = Number.parseInt(details?.version.split(".")[0] ?? "", 10);
      if (details?.edition === "Core" && major >= 7) {
        return { kind: "powershell", executable, ...details };
      }
    }
    if (options.windowsPreference === "powershell7") {
      throw new Error(
        "PowerShell 7 was required, but no working pwsh.exe version 7 or newer was found.",
      );
    }
  }

  const systemRoot = env.SystemRoot ?? env.WINDIR;
  const legacyCandidates = existingCandidates(
    [
      systemRoot
        ? win32.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          )
        : undefined,
      ...probe.findOnPath("powershell.exe"),
      ...probe.findOnPath("powershell"),
    ],
    probe,
  );
  for (const executable of legacyCandidates) {
    const details = probe.probePowerShell(executable);
    const [major, minor] = (details?.version ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));
    if (details?.edition === "Desktop" && major === 5 && (minor ?? 0) >= 1) {
      return { kind: "powershell", executable, ...details };
    }
  }
  throw new Error(
    options.windowsPreference === "windows-powershell"
      ? "Windows PowerShell 5.1 was required, but powershell.exe could not be started."
      : "No working PowerShell installation was found.",
  );
}

function resolvePosixShell(
  options: ShellResolutionOptions,
  probe: ShellResolutionProbe,
): ResolvedShellRuntime {
  const env = options.env ?? process.env;
  const preferred = options.requestedShell?.trim() || env.SHELL?.trim();
  const supportedPreferred =
    preferred && ["zsh", "bash"].includes(executableName(preferred))
      ? preferred
      : undefined;
  const fallbacks =
    options.platform === "darwin"
      ? ["/bin/zsh", "/bin/bash"]
      : ["/bin/bash", "/bin/sh"];
  const executable = existingCandidates(
    [supportedPreferred, ...fallbacks],
    probe,
  )[0];
  if (!executable) {
    throw new Error("No supported zsh, bash, or sh executable was found.");
  }
  const name = executableName(executable);
  return {
    kind: name === "zsh" ? "zsh" : name === "bash" ? "bash" : "sh",
    executable,
  };
}

export function resolveShellRuntime(
  options: ShellResolutionOptions,
  probe: ShellResolutionProbe = defaultProbe,
): ResolvedShellRuntime {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return resolvePowerShell(options, probe);
  return resolvePosixShell({ ...options, platform }, probe);
}
