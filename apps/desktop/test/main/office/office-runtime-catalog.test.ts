import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityArchiveDownloadUrl } from "@artemis/protocol";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "../../../src/main/office/office-capability-updates.js";

const catalog = JSON.parse(
  readFileSync(
    new URL("../../../resources/office-runtime/catalog.json", import.meta.url),
    "utf8",
  ),
) as OfficeRuntimeCatalog;
const { version: hostVersion } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);

describe("published Office runtime discovery", () => {
  it.each([
    [
      "darwin",
      "arm64",
      "1.0.0",
      "4da139734269190856697edb5219a0b0e5283734a6c4d57262678f28259045ad",
    ],
    [
      "win32",
      "x64",
      "1.0.1",
      "198dc7bb361ecfbca457070c20bc81ffe7ee3b7b1707c2350dfba97d7ca38f47",
    ],
  ])(
    "advertises a trusted online installer for %s %s",
    (platform, arch, version, digest) => {
      const updates = new OfficeCapabilityUpdates(catalog, {
        hostVersion,
        platform,
        arch,
      });
      const manifest = updates.available();
      expect(manifest).toMatchObject({
        platform,
        arch,
        version,
        archive: { sha256: digest },
      });
      expect(manifest?.archive.url).toBe(
        `https://github.com/EurekaRaider/ArtemisRelease/releases/download/office-runtime-v${version}/office-core-${platform}-${arch}-${version}.zip`,
      );
      expect(capabilityArchiveDownloadUrl(manifest!.archive.url)).toBe(
        `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/office-core-${platform}-${arch}-${version}.zip`,
      );
      expect(catalog.updateUrl).toBe(
        "https://raw.githubusercontent.com/EurekaRaider/Artemis/main/apps/desktop/resources/office-runtime/catalog.json",
      );
      expect(updates.status()).toMatchObject({
        availableVersion: version,
        canCheckUpdates: true,
      });
      if (platform === "win32") {
        expect(
          manifest?.native.windows?.find(
            (entry) => entry.path === manifest.entrypoint,
          )?.signer,
        ).toBeNull();
      }
    },
  );
  it("does not offer another platform's runtime to Intel macOS", () => {
    expect(
      new OfficeCapabilityUpdates(catalog, {
        hostVersion,
        platform: "darwin",
        arch: "x64",
      }).available(),
    ).toBeUndefined();
  });
});
