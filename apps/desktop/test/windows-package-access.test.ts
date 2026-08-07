import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 as windowsPath } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureWindowsPackageAccess } from "../src/main/windows-package-access.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Windows ZIP package access", () => {
  it("grants AppContainer read access once per extracted path and version", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-win-access-"));
    cleanup.push(root);
    const applicationRoot = join(root, "Artemis");
    const markerPath = join(root, "user-data", "windows-package-access.json");
    await mkdir(applicationRoot);
    const calls: Array<{ command: string; args: string[] }> = [];
    const applyAcl = async (command: string, args: string[]) => {
      calls.push({ command, args });
    };

    await expect(
      ensureWindowsPackageAccess({
        applicationRoot,
        applicationVersion: "0.1.7",
        markerPath,
        platform: "win32",
        systemRoot: "C:\\Windows",
        applyAcl,
      }),
    ).resolves.toBe(true);
    await expect(
      ensureWindowsPackageAccess({
        applicationRoot,
        applicationVersion: "0.1.7",
        markerPath,
        platform: "win32",
        systemRoot: "C:\\Windows",
        applyAcl,
      }),
    ).resolves.toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: windowsPath.join("C:\\Windows", "System32", "icacls.exe"),
      args: [
        applicationRoot,
        "/grant",
        "*S-1-15-2-1:(OI)(CI)(RX)",
        "*S-1-15-2-2:(OI)(CI)(RX)",
        "/T",
        "/C",
        "/Q",
      ],
    });
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({
      version: 1,
      applicationRoot,
      applicationVersion: "0.1.7",
    });
  });

  it("reapplies access after the application version changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-win-access-"));
    cleanup.push(root);
    const applicationRoot = join(root, "Artemis");
    const markerPath = join(root, "user-data", "windows-package-access.json");
    await mkdir(applicationRoot);
    let calls = 0;
    const applyAcl = async () => {
      calls += 1;
    };

    for (const applicationVersion of ["0.1.9", "1.1.19"]) {
      await ensureWindowsPackageAccess({
        applicationRoot,
        applicationVersion,
        markerPath,
        platform: "win32",
        systemRoot: "C:\\Windows",
        applyAcl,
      });
    }
    expect(calls).toBe(2);
  });

  it("does nothing outside Windows", async () => {
    await expect(
      ensureWindowsPackageAccess({
        applicationRoot: "relative-is-ignored",
        applicationVersion: "0.1.7",
        markerPath: "unused",
        platform: "darwin",
      }),
    ).resolves.toBe(false);
  });
});
