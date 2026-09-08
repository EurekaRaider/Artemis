import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import {
  WindowsImFiles,
  runWindowsImShell,
} from "../src/main/im-windows-files.js";
import * as sandbox from "../src/main/im-sandbox.js";

// These tests verify orchestration and writeback, not Windows kernel isolation.
describe("Windows scoped shell orchestration", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([false, true])(
    "only exposes copied data and handles cancellation=%s without writeback",
    async (cancelled) => {
      const workspace = await mkdtemp(join(tmpdir(), "im-shell-flow-"));
      const controller = new AbortController();
      let stage = "";
      const snapshot = vi
        .spyOn(WindowsImFiles.prototype, "snapshot")
        .mockImplementation(async (path) =>
          path === workspace
            ? [
                { path: "src", directory: true },
                {
                  path: "src/input.txt",
                  directory: false,
                  data: Buffer.from("AUTHORIZED").toString("base64"),
                },
              ]
            : [
                { path: "src", directory: true },
                {
                  path: "src/input.txt",
                  directory: false,
                  data: Buffer.from("AUTHORIZED").toString("base64"),
                },
                {
                  path: "src/output.txt",
                  directory: false,
                  data: (await readFile(join(path, "src/output.txt"))).toString(
                    "base64",
                  ),
                },
              ],
        );
      const apply = vi
        .spyOn(WindowsImFiles.prototype, "apply")
        .mockResolvedValue();
      vi.spyOn(sandbox, "runRemoteShell").mockImplementation(async (launch) => {
        stage = launch.cwd!;
        expect(stage).not.toBe(workspace);
        expect(launch.env).toMatchObject({
          USERPROFILE: stage,
          APPDATA: stage,
          LOCALAPPDATA: stage,
          WINDIR: launch.env?.SystemRoot,
          PSModulePath: win32.join(
            launch.env!.SystemRoot!,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "Modules",
          ),
        });
        expect(launch.args[launch.args.indexOf("-HostTempPath") + 1]).toBe(
          tmpdir(),
        );
        expect(await readFile(join(stage, "src/input.txt"), "utf8")).toBe(
          "AUTHORIZED",
        );
        await expect(readFile(join(stage, "private.txt"))).rejects.toThrow();
        const index = launch.args.indexOf("-WritablePathsBase64");
        expect(
          JSON.parse(Buffer.from(launch.args[index + 1]!, "base64").toString()),
        ).toEqual([join(stage, "src")]);
        await writeFile(join(stage, "src/output.txt"), "RESULT");
        if (cancelled) controller.abort();
        return { output: "done", exitCode: 0, cancelled: false };
      });
      try {
        await writeFile(join(workspace, "private.txt"), "PRIVATE");
        const result = await runWindowsImShell({
          workspace,
          helper: join(workspace, "windows-sandbox.ps1"),
          scope: { audience: "owner", readPaths: ["src"], writePaths: ["src"] },
          command: "host controlled test",
          network: false,
          signal: controller.signal,
          timeoutSeconds: 5,
          assertCurrent: () => {},
        });
        expect(result.cancelled).toBe(cancelled);
        expect(snapshot).toHaveBeenCalledTimes(cancelled ? 1 : 2);
        if (cancelled) expect(apply).not.toHaveBeenCalled();
        else
          expect(apply.mock.calls[0]?.[2]).toEqual([
            {
              path: "src/output.txt",
              data: Buffer.from("RESULT").toString("base64"),
              expected: "absent",
            },
          ]);
        await expect(readFile(join(stage, "src/output.txt"))).rejects.toThrow();
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
  );
});
