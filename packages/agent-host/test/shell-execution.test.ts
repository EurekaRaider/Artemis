import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArtemisShellRuntime,
  buildShellInvocation,
} from "../src/shell-execution.js";

describe("shell execution", () => {
  it("uses non-interactive encoded PowerShell without a profile by default", () => {
    const invocation = buildShellInvocation(
      {
        kind: "powershell",
        executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        edition: "Core",
        version: "7.6.0",
      },
      "Write-Output '你好'",
      "environment",
      { Path: "C:\\Windows" },
    );

    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
      ]),
    );
    const encodedIndex = invocation.args.indexOf("-EncodedCommand");
    const script = Buffer.from(
      invocation.args[encodedIndex + 1] ?? "",
      "base64",
    ).toString("utf16le");
    expect(script).toContain("Write-Output '你好'");
    expect(script).toContain("$LASTEXITCODE");
    expect(script).not.toContain("CurrentUserAllHosts");
  });

  it("loads PowerShell profiles only in full compatibility mode", () => {
    const invocation = buildShellInvocation(
      {
        kind: "powershell",
        executable: "powershell.exe",
        edition: "Desktop",
        version: "5.1.0",
      },
      "Get-Location",
      "full",
      { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    );
    const encodedIndex = invocation.args.indexOf("-EncodedCommand");
    const script = Buffer.from(
      invocation.args[encodedIndex + 1] ?? "",
      "base64",
    ).toString("utf16le");

    expect(script).toContain("CurrentUserAllHosts");
    expect(script).toContain("agent-profile.ps1");
    expect(script).toContain("GetEnvironmentVariables");
  });

  it("keeps ordinary POSIX commands non-interactive and isolates full profile mode", () => {
    const shell = { kind: "zsh" as const, executable: "/bin/zsh" };

    expect(
      buildShellInvocation(shell, "printf ready", "environment", {
        HOME: "/Users/test",
      }).args,
    ).toEqual(["-f", "-c", "printf ready"]);
    expect(
      buildShellInvocation(
        shell,
        "printf ready",
        "full",
        { HOME: "/Users/test" },
        "/Users/test",
      ).args,
    ).toEqual([
      "-ilc",
      expect.stringContaining(".config/artemis/agent-profile.zsh"),
    ]);
  });

  it("pins the resolved shell until configuration changes", () => {
    const resolutions: string[] = [];
    const runtime = new ArtemisShellRuntime({
      platform: "win32",
      env: {},
      resolveShell: (configuration) => {
        resolutions.push(configuration.windowsPreference);
        return configuration.windowsPreference === "windows-powershell"
          ? {
              kind: "powershell",
              executable: "powershell.exe",
              edition: "Desktop",
              version: "5.1",
            }
          : {
              kind: "powershell",
              executable: "pwsh.exe",
              edition: "Core",
              version: "7.6",
            };
      },
    });

    expect(runtime.metadata().shell.executable).toBe("pwsh.exe");
    expect(runtime.metadata().shell.executable).toBe("pwsh.exe");
    expect(resolutions).toEqual(["auto"]);

    runtime.configure({
      windowsPreference: "windows-powershell",
      profileMode: "disabled",
    });
    expect(runtime.metadata()).toMatchObject({
      shell: { executable: "powershell.exe", edition: "Desktop" },
      profileMode: "disabled",
      environmentSource: "inherited",
    });
    expect(resolutions).toEqual(["auto", "windows-powershell"]);
  });

  it.runIf(process.platform === "darwin")(
    "imports zshrc environment once while executing the command non-interactively",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "artemis-shell-profile-"));
      try {
        await writeFile(
          join(directory, ".zshrc"),
          [
            "export ARTEMIS_PROFILE_TEST='profile-ready'",
            "export ARTEMIS_PROFILE_SECRET_TOKEN='do-not-import'",
            "export AWS_ACCESS_KEY_ID='do-not-import-either'",
            "",
          ].join("\n"),
          "utf8",
        );
        const runtime = new ArtemisShellRuntime({
          platform: "darwin",
          env: {
            ...process.env,
            HOME: directory,
            ZDOTDIR: directory,
          },
          homeDirectory: directory,
          resolveShell: () => ({ kind: "zsh", executable: "/bin/zsh" }),
        });
        let output = "";

        const result = await runtime.exec(
          'printf "%s|%s|%s" "$ARTEMIS_PROFILE_TEST" "$ARTEMIS_PROFILE_SECRET_TOKEN" "$AWS_ACCESS_KEY_ID"',
          directory,
          {
            onData: (data) => {
              output += data.toString("utf8");
            },
          },
        );

        expect(result.exitCode).toBe(0);
        expect(output).toBe("profile-ready||");
        expect(runtime.metadata()).toMatchObject({
          profileMode: "environment",
          environmentSource: "profile",
        });
        expect(runtime.metadata().environmentWarning).toBeUndefined();

        await writeFile(
          join(directory, ".zshrc"),
          "export ARTEMIS_PROFILE_TEST='profile-updated'\n",
          "utf8",
        );
        let cachedOutput = "";
        await runtime.exec('printf "%s" "$ARTEMIS_PROFILE_TEST"', directory, {
          onData: (data) => {
            cachedOutput += data.toString("utf8");
          },
        });
        expect(cachedOutput).toBe("profile-ready");

        let nextTaskOutput = "";
        await runtime.exec('printf "%s" "$ARTEMIS_PROFILE_TEST"', directory, {
          env: { ARTEMIS_SHELL_ENVIRONMENT_SCOPE: "thread-2" },
          onData: (data) => {
            nextTaskOutput += data.toString("utf8");
          },
        });
        expect(nextTaskOutput).toBe("profile-updated");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "executes Unicode and native exit codes through PowerShell without Bash",
    async () => {
      const runtime = new ArtemisShellRuntime({ platform: "win32" });
      let output = "";
      const success = await runtime.exec("Write-Output '你好'", process.cwd(), {
        onData: (data) => {
          output += data.toString("utf8");
        },
      });

      expect(success.exitCode).toBe(0);
      expect(output).toContain("你好");
      expect(runtime.metadata().shell).toMatchObject({ kind: "powershell" });

      const failure = await runtime.exec("cmd.exe /c exit 7", process.cwd(), {
        onData() {},
      });
      expect(failure.exitCode).toBe(7);
    },
  );
});
