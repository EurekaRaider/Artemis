import { describe, expect, it } from "vitest";
import { capabilityPackManifestSchema } from "../src/capability-pack.js";

export function computerManifest(platform: "darwin" | "win32" = "win32") {
  const entrypoint =
    platform === "win32"
      ? "artemis-computer-use.exe"
      : "ArtemisComputerUse.app/Contents/MacOS/artemis-computer-use";
  return {
    schemaVersion: 1,
    id: "computer-use",
    version: "1.2.0",
    hostRange: ">=1.7.5 <2.0.0",
    platform,
    arch: platform === "win32" ? "x64" : "arm64",
    minimumOS: platform === "win32" ? "11" : "14",
    helperProtocol: 1,
    sourceDigest: "a".repeat(64),
    entrypoint,
    pluginRoot: "plugin",
    archive: {
      url: "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v1.2.0/computer-use.zip",
      sha256: "b".repeat(64),
      downloadBytes: 100,
      unpackedBytes: 2,
    },
    files: [
      { path: entrypoint, sha256: "c".repeat(64), bytes: 1, executable: true },
      {
        path: "plugin/artemis.plugin.json",
        sha256: "d".repeat(64),
        bytes: 1,
        executable: false,
      },
    ],
    native: {
      signer: platform === "win32" ? null : "TEAM",
      notarization:
        platform === "win32" ? "not-applicable" : "accepted-stapled",
    },
    signature: { keyId: "test", value: "A".repeat(86) + "==" },
  };
}

describe("Computer Use native packs", () => {
  it.each(["darwin", "win32"] as const)(
    "requires the %s preview module in the signed executable inventory",
    (platform) => {
      const manifest = computerManifest(platform);
      const module =
        platform === "darwin"
          ? "ArtemisComputerUse.app/Contents/Frameworks/artemis-computer-preview.node"
          : "artemis-computer-preview.node";
      const preview = { protocol: 1, module };
      expect(
        capabilityPackManifestSchema.safeParse({ ...manifest, preview })
          .success,
      ).toBe(false);
      expect(
        capabilityPackManifestSchema.safeParse({
          ...manifest,
          preview,
          files: [
            ...manifest.files,
            {
              path: module,
              sha256: "e".repeat(64),
              bytes: 1,
              executable: true,
            },
          ],
          archive: { ...manifest.archive, unpackedBytes: 3 },
        }).success,
      ).toBe(true);
      expect(
        capabilityPackManifestSchema.safeParse({
          ...manifest,
          preview: { ...preview, module: "../capture.node" },
        }).success,
      ).toBe(false);
    },
  );
  it.each(["darwin", "win32"] as const)(
    "accepts the %s native inventory",
    (platform) => {
      expect(
        capabilityPackManifestSchema.parse(computerManifest(platform)).id,
      ).toBe("computer-use");
    },
  );
  it("does not accept computer-use as an unverified software-only pack", () => {
    const {
      entrypoint,
      pluginRoot,
      minimumOS,
      helperProtocol,
      native,
      ...software
    } = computerManifest();
    expect(capabilityPackManifestSchema.safeParse(software).success).toBe(
      false,
    );
  });
  it("requires a signed executable and supported native target", () => {
    const manifest = computerManifest();
    expect(
      capabilityPackManifestSchema.safeParse({
        ...manifest,
        files: [{ ...manifest.files[0], executable: false }],
      }).success,
    ).toBe(false);
    expect(
      capabilityPackManifestSchema.safeParse({ ...manifest, arch: "arm64" })
        .success,
    ).toBe(false);
    expect(
      capabilityPackManifestSchema.safeParse({
        ...manifest,
        entrypoint: "../helper.exe",
      }).success,
    ).toBe(false);
  });
});
