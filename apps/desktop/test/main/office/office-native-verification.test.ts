import { execFile } from "node:child_process";
import { join } from "node:path";
import type { CapabilityPackManifest } from "@artemis/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { verifyOfficeNative } from "../../../src/main/office/office-uno-engine.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it.each(["arm64", "x64"])(
  "assesses macOS %s binaries, signatures, identity and staple",
  async (arch) => {
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
      arch,
      entrypoint: "ArtemisOfficeRuntime.app/Contents/MacOS/office-bridge",
      officeExecutable: "ArtemisOfficeRuntime.app/Contents/MacOS/soffice",
      native: { signer: "TESTTEAM" },
    } as CapabilityPackManifest);
    expect(
      vi.mocked(execFile).mock.calls.map(([command, args]) => [command, args]),
    ).toEqual([
      [
        "/usr/bin/lipo",
        [
          "-verify_arch",
          arch === "x64" ? "x86_64" : "arm64",
          join(appPath, "Contents/MacOS/office-bridge"),
        ],
      ],
      [
        "/usr/bin/lipo",
        [
          "-verify_arch",
          arch === "x64" ? "x86_64" : "arm64",
          join(appPath, "Contents/MacOS/soffice"),
        ],
      ],
      ["/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]],
      ["/usr/bin/codesign", ["-dv", "--verbose=4", appPath]],
      ["/usr/bin/xcrun", ["stapler", "validate", appPath]],
      ["/usr/sbin/spctl", ["--assess", "--type", "execute", appPath]],
    ]);
  },
);
