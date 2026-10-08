import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { computerUsePackManifestSchema } from "@artemis/protocol";
import { verifyComputerUseNative } from "../../src/main/computer-use/native-verification.js";

/** Exercise real Windows signature/ACL APIs on disposable files, without changing trust pins. */
export async function verifyNativeSecurity(helper: string, evidence: string) {
  const root = join(evidence, "native-security");
  const safe = join(root, "safe");
  const unsafe = join(root, "unsafe");
  await mkdir(join(safe, "plugin"), { recursive: true });
  await copyFile(helper, join(safe, "artemis-computer-use.exe"));
  const plugin = Buffer.from('{"name":"computer-use","version":"1.2.0"}');
  await writeFile(join(safe, "plugin/artemis.plugin.json"), plugin);
  const binary = await readFile(helper);
  const digest = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  // This manifest only supplies the native verifier's contract. It is never installed
  // or trusted by the pack service; release-signature checks have separate regressions.
  const manifest = computerUsePackManifestSchema.parse({
    schemaVersion: 1,
    id: "computer-use",
    version: "1.2.0",
    hostRange: ">=1.7.5 <2",
    platform: "win32",
    arch: "x64",
    minimumOS: "11",
    helperProtocol: 1,
    entrypoint: "artemis-computer-use.exe",
    pluginRoot: "plugin",
    sourceDigest: "a".repeat(64),
    archive: {
      url: "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v1.2.0/test.zip",
      sha256: "a".repeat(64),
      downloadBytes: 1,
      unpackedBytes: binary.length + plugin.length,
    },
    files: [
      {
        path: "artemis-computer-use.exe",
        sha256: digest(binary),
        bytes: binary.length,
        executable: true,
      },
      {
        path: "plugin/artemis.plugin.json",
        sha256: digest(plugin),
        bytes: plugin.length,
        executable: false,
      },
    ],
    native: { signer: null, notarization: "not-applicable" },
    signature: {
      keyId: "verification",
      value: Buffer.alloc(64).toString("base64"),
    },
  });
  try {
    await verifyComputerUseNative(safe, manifest);
    await assert.rejects(
      verifyComputerUseNative(safe, {
        ...manifest,
        native: { ...manifest.native, signer: "f".repeat(40) },
      }),
      /Native signature mismatch/,
    );
    await cp(safe, unsafe, { recursive: true });
    execFileSync(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32/icacls.exe"),
      [unsafe, "/grant", "*S-1-5-32-545:(OI)(CI)M", "/T", "/Q"],
      { windowsHide: true },
    );
    await assert.rejects(
      verifyComputerUseNative(unsafe, manifest),
      /Unsafe Computer Use installation ACL/,
    );
    const checks = [
      "effective installation ACL accepted",
      "declared native signature mismatch rejected",
      "writable installation ACL rejected",
    ];
    await writeFile(
      join(evidence, "security-result.json"),
      JSON.stringify({ platform: process.platform, checks }, null, 2),
    );
    return checks;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
