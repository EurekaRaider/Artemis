import { describe, expect, it } from "vitest";

import {
  resolveShellRuntime,
  type ShellResolutionProbe,
} from "../src/shell-runtime.js";

function probe(input: {
  files: string[];
  path?: Record<string, string[]>;
  versions?: Record<string, { version: string; edition: "Core" | "Desktop" }>;
}): ShellResolutionProbe {
  return {
    canonicalize: (path) => path,
    findOnPath: (executable) => input.path?.[executable] ?? [],
    isFile: (path) => input.files.includes(path),
    probePowerShell: (path) => input.versions?.[path],
  };
}

describe("resolveShellRuntime", () => {
  it("prefers a validated PowerShell 7 installation on Windows", () => {
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const legacy =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    expect(
      resolveShellRuntime(
        {
          platform: "win32",
          env: { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" },
          windowsPreference: "auto",
        },
        probe({
          files: [pwsh, legacy],
          versions: {
            [pwsh]: { version: "7.6.0", edition: "Core" },
            [legacy]: { version: "5.1.26100.1", edition: "Desktop" },
          },
        }),
      ),
    ).toMatchObject({
      executable: pwsh,
      kind: "powershell",
      edition: "Core",
      version: "7.6.0",
    });
  });

  it("falls back to Windows PowerShell 5.1 when pwsh is unavailable", () => {
    const legacy =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    expect(
      resolveShellRuntime(
        {
          platform: "win32",
          env: { SystemRoot: "C:\\Windows" },
          windowsPreference: "auto",
        },
        probe({
          files: [legacy],
          versions: {
            [legacy]: { version: "5.1.26100.1", edition: "Desktop" },
          },
        }),
      ),
    ).toMatchObject({ executable: legacy, edition: "Desktop" });
  });

  it("does not silently fall back when PowerShell 7 is required", () => {
    const legacy =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    expect(() =>
      resolveShellRuntime(
        {
          platform: "win32",
          env: { SystemRoot: "C:\\Windows" },
          windowsPreference: "powershell7",
        },
        probe({
          files: [legacy],
          versions: {
            [legacy]: { version: "5.1.26100.1", edition: "Desktop" },
          },
        }),
      ),
    ).toThrow("PowerShell 7");
  });

  it("uses a supported macOS user shell and rejects unsupported dialects", () => {
    const files = ["/opt/homebrew/bin/bash", "/bin/zsh", "/bin/bash"];
    const resolutionProbe = probe({ files });

    expect(
      resolveShellRuntime(
        {
          platform: "darwin",
          env: { SHELL: "/opt/homebrew/bin/bash" },
          windowsPreference: "auto",
        },
        resolutionProbe,
      ),
    ).toMatchObject({ executable: "/opt/homebrew/bin/bash", kind: "bash" });

    expect(
      resolveShellRuntime(
        {
          platform: "darwin",
          env: { SHELL: "/opt/homebrew/bin/fish" },
          windowsPreference: "auto",
        },
        resolutionProbe,
      ),
    ).toMatchObject({ executable: "/bin/zsh", kind: "zsh" });
  });
});
