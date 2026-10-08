import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComputerUsePackManifest } from "@artemis/protocol";
const run = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: run,
  });
  return { execFile };
});
import { verifyComputerUseNative } from "../../../src/main/computer-use/native-verification.js";
const original = Object.getOwnPropertyDescriptor(process, "platform")!;
const platform = (value: string) =>
  Object.defineProperty(process, "platform", { value, configurable: true });
beforeEach(() => run.mockReset());
afterEach(() => Object.defineProperty(process, "platform", original));
function manifest(
  target: "darwin" | "win32",
  signer: string | null = target === "darwin" ? "TEAM" : null,
) {
  const entrypoint =
    target === "darwin"
      ? "ArtemisComputerUse.app/Contents/MacOS/artemis-computer-use"
      : "artemis-computer-use.exe";
  return {
    schemaVersion: 1,
    id: "computer-use",
    version: "1.2.0",
    hostRange: ">=1.7.5 <2",
    platform: target,
    arch: target === "darwin" ? "arm64" : "x64",
    minimumOS: target === "darwin" ? "14" : "11",
    helperProtocol: 1,
    entrypoint,
    pluginRoot: "plugin",
    sourceDigest: "a".repeat(64),
    archive: {
      url: "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v1.2.0/pack.zip",
      sha256: "a".repeat(64),
      downloadBytes: 2,
      unpackedBytes: 2,
    },
    files: [
      { path: entrypoint, sha256: "a".repeat(64), bytes: 1, executable: true },
      {
        path: "plugin/artemis.plugin.json",
        sha256: "b".repeat(64),
        bytes: 1,
        executable: false,
      },
    ],
    native: {
      signer,
      notarization: target === "darwin" ? "accepted-stapled" : "not-applicable",
    },
    signature: { keyId: "test", value: Buffer.alloc(64).toString("base64") },
  } as ComputerUsePackManifest;
}
it("requires the exact macOS helper identity, team, hardened runtime and staple", async () => {
  platform("darwin");
  run.mockResolvedValue({
    stdout: "",
    stderr:
      "Identifier=com.artemis.computer-use\nTeamIdentifier=TEAM\nCodeDirectory flags=0x10000(runtime)\n",
  });
  await verifyComputerUseNative("/synthetic/native", manifest("darwin"));
  expect(run.mock.calls.map((args) => args[0])).toEqual([
    "/usr/bin/codesign",
    "/usr/bin/codesign",
    "/usr/bin/xcrun",
    "/usr/sbin/spctl",
  ]);
  run.mockResolvedValue({
    stdout: "",
    stderr:
      "Identifier=com.artemis.computer-use.evil\nTeamIdentifier=TEAM\nCodeDirectory flags=0x10000(runtime)\n",
  });
  await expect(
    verifyComputerUseNative("/synthetic/native", manifest("darwin")),
  ).rejects.toThrow("identity");
});
it("passes paths and Windows signer through an isolated environment to a fixed verifier", async () => {
  platform("win32");
  run.mockResolvedValue({ stdout: "", stderr: "" });
  const root = "/synthetic/中文 path/'$(untrusted)'";
  await verifyComputerUseNative(root, manifest("win32", "a".repeat(40)));
  const [command, args, options] = run.mock.calls[0]!;
  expect(command).toMatch(/System32.*WindowsPowerShell.*powershell.exe$/u);
  expect(args[3]).not.toContain(root);
  expect(options.env.ARTEMIS_COMPUTER_VERIFY_ROOT).toBe(root);
  expect(options.env.ARTEMIS_COMPUTER_VERIFY_SIGNER).toBe("a".repeat(40));
  expect(Object.keys(options.env).sort()).toEqual([
    "ARTEMIS_COMPUTER_VERIFY_PATH",
    "ARTEMIS_COMPUTER_VERIFY_PREVIEW",
    "ARTEMIS_COMPUTER_VERIFY_ROOT",
    "ARTEMIS_COMPUTER_VERIFY_SIGNER",
    "SystemRoot",
  ]);
  run.mockRejectedValueOnce(new Error("Unsafe Computer Use installation ACL"));
  await expect(
    verifyComputerUseNative(root, manifest("win32")),
  ).rejects.toThrow("ACL");
});
it("verifies the preview module with the same native signer and installation ACL policy", async () => {
  platform("win32");
  run.mockResolvedValue({ stdout: "", stderr: "" });
  const pack = manifest("win32", "a".repeat(40));
  pack.preview = { protocol: 1, module: "artemis-computer-preview.node" };
  pack.files.push({
    path: pack.preview.module,
    sha256: "c".repeat(64),
    bytes: 1,
    executable: true,
  });
  pack.archive.unpackedBytes++;
  await verifyComputerUseNative("/synthetic", pack);
  const [, args, options] = run.mock.calls[0]!;
  expect(args[3]).toContain("foreach($p in $binaries)");
  expect(options.env.ARTEMIS_COMPUTER_VERIFY_PREVIEW).toBe(
    "/synthetic/artemis-computer-preview.node",
  );
});
it("rejects a native package for a different OS before invoking any executable", async () => {
  platform("win32");
  await expect(
    verifyComputerUseNative("/synthetic/native", manifest("darwin")),
  ).rejects.toThrow("platform");
  expect(run).not.toHaveBeenCalled();
});
