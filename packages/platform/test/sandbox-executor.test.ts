import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSeatbeltLaunch,
  buildSeatbeltProfile,
  buildWindowsAppContainerLaunch,
  encodeWindowsSandboxSpecification,
  normalizeSandboxPolicy,
} from "../src/index.js";
import * as platformModule from "../src/index.js";

type BuildDesktopUserLaunch = (command: {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}) => {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  implementation: "desktop-user";
};

const buildDesktopUserLaunch = (
  platformModule as typeof platformModule & {
    buildDesktopUserLaunch?: BuildDesktopUserLaunch;
  }
).buildDesktopUserLaunch;

describe("sandbox execution contracts", () => {
  it("builds an explicit current-user launch without wrapping the command", () => {
    const command = {
      executable: "C:\\runtime\\node.exe",
      args: ["server.mjs", "--stdio"],
      cwd: "D:\\Git\\project",
      env: { TEST_VALUE: "ready" },
    };

    expect(buildDesktopUserLaunch).toBeTypeOf("function");
    if (!buildDesktopUserLaunch) return;

    expect(buildDesktopUserLaunch(command)).toEqual({
      ...command,
      implementation: "desktop-user",
    });
  });

  it("removes every writable path from plan and review policies", () => {
    for (const mode of ["plan", "review"] as const) {
      expect(
        normalizeSandboxPolicy({
          workspacePath: "C:\\repo",
          writablePaths: [],
          mode,
          network: "deny",
        }).writablePaths,
      ).toEqual([]);
    }
  });

  it("rejects extra writable paths outside execute mode", () => {
    expect(() =>
      normalizeSandboxPolicy({
        workspacePath: "C:\\repo",
        writablePaths: ["C:\\other"],
        mode: "plan",
        network: "deny",
      }),
    ).toThrow("plan mode cannot add writable paths");
  });

  it.each([
    ["win32", "C:\\repo"],
    ["darwin", "/Users/test/repo"],
  ] as const)(
    "keeps execute mode writable on %s",
    (_platform, workspacePath) => {
      expect(
        normalizeSandboxPolicy({
          workspacePath,
          mode: "execute",
          network: "deny",
        }).writablePaths,
      ).toEqual([workspacePath]);
    },
  );

  it("generates a default-deny Seatbelt profile", () => {
    const profile = buildSeatbeltProfile({
      workspacePath: "/Users/test/repo",
      mode: "execute",
      network: "deny",
    });

    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(subpath "/Users/test/repo")');
    expect(profile).toContain("(allow file-write*");
    expect(profile).toContain("(allow file-read-data file-write-data)");
    expect(profile).not.toContain("(allow file-read-metadata)\n");
    expect(profile).toContain('(literal "/Users/test")');
  });

  it("keeps plan mode read-only in the Seatbelt profile", () => {
    const profile = buildSeatbeltProfile({
      workspacePath: "/Users/test/repo",
      mode: "plan",
      network: "deny",
    });

    expect(profile).not.toContain("(allow file-write*");
  });

  it("builds a sandbox-exec launch without invoking a shell", () => {
    const launch = buildSeatbeltLaunch(
      {
        executable: "/bin/zsh",
        args: ["-l"],
        cwd: "/Users/test/repo",
      },
      {
        workspacePath: "/Users/test/repo",
        mode: "execute",
        network: "deny",
      },
    );

    expect(launch).toMatchObject({
      executable: "/usr/bin/sandbox-exec",
      implementation: "macos-seatbelt",
    });
    expect(launch.args.at(-2)).toBe("/bin/zsh");
  });

  it("encodes Windows helper arguments without command interpolation", () => {
    const helperPath = resolve("resources/windows-sandbox.ps1");
    const launch = buildWindowsAppContainerLaunch(
      {
        executable: "powershell.exe",
        args: ["-NoProfile", "-Command", "Write-Output 'a&b'"],
        cwd: "C:\\repo",
      },
      {
        workspacePath: "C:\\repo",
        mode: "execute",
        network: "deny",
      },
      { helperPath },
    );

    expect(launch).toMatchObject({
      executable: "powershell.exe",
      implementation: "windows-appcontainer",
    });
    expect(launch.args).not.toContain("Write-Output 'a&b'");
    const encoded = launch.args[launch.args.indexOf("-ArgumentsBase64") + 1];
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual(
      ["-NoProfile", "-Command", "Write-Output 'a&b'"],
    );
    const specification =
      launch.args[launch.args.indexOf("-SandboxSpecificationBase64") + 1];
    const bytes = Buffer.from(specification, "base64");
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("SBOX");
    expect(bytes.includes(Buffer.from("0.1.0"))).toBe(true);
    expect(bytes.includes(Buffer.from("C:\\repo"))).toBe(true);
  });

  it("encodes network capability only when explicitly allowed", () => {
    const denied = encodeWindowsSandboxSpecification({
      writablePaths: ["C:\\repo"],
      readOnlyPaths: ["C:\\runtime"],
      allowNetwork: false,
    });
    const allowed = encodeWindowsSandboxSpecification({
      writablePaths: ["C:\\repo"],
      readOnlyPaths: ["C:\\runtime"],
      allowNetwork: true,
    });

    expect(denied.includes(Buffer.from("internetClient"))).toBe(false);
    expect(allowed.includes(Buffer.from("internetClient"))).toBe(true);
  });
});
