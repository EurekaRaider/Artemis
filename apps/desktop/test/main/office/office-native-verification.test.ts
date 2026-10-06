import { execFile } from "node:child_process";
import { join } from "node:path";
import type { CapabilityPackManifest } from "@artemis/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { verifyOfficeNative } from "../../../src/main/office/office-uno-engine.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
it("assesses macOS execution while retaining signature and identity checks", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.mocked(execFile).mockImplementation(((
    command: string,
    args: string[],
    options: unknown,
    callback: Function,
  ) => {
    callback(null, {
      stdout: "",
      stderr: "TeamIdentifier=TESTTEAM\nflags=runtime",
    });
  }) as typeof execFile);
  const appPath = join("/pack", "ArtemisOfficeRuntime.app");
  await verifyOfficeNative("/pack", {
    id: "office-core",
    native: { signer: "TESTTEAM" },
  } as CapabilityPackManifest);
  expect(
    vi.mocked(execFile).mock.calls.map(([command, args]) => [command, args]),
  ).toEqual([
    ["/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]],
    ["/usr/bin/codesign", ["-dv", "--verbose=4", appPath]],
    ["/usr/sbin/spctl", ["--assess", "--type", "execute", appPath]],
  ]);
});
