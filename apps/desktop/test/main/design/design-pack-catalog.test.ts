import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityArchiveDownloadUrl } from "@artemis/protocol";
import { OfficeCapabilityUpdates } from "../../../src/main/office/office-capability-updates.js";

const catalog = JSON.parse(
  readFileSync(
    new URL("../../../resources/design-plugins/catalog.json", import.meta.url),
    "utf8",
  ),
);
const { version: hostVersion } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);

describe("Design marketplace online installation catalog", () => {
  it.each([
    ["darwin", "arm64", hostVersion, "0.4.5"],
    ["win32", "x64", hostVersion, "0.4.5"],
    ["darwin", "arm64", "1.7.2", "0.2.0"],
    ["win32", "x64", "1.7.2", "0.2.0"],
  ])(
    "offers a trusted installer for %s %s on host %s",
    (platform, arch, selectedHostVersion, version) => {
      const updates = new OfficeCapabilityUpdates(catalog, {
        hostVersion: selectedHostVersion,
        platform,
        arch,
        packId: "artemis-design",
      });
      const manifest = updates.available();
      expect(manifest).toMatchObject({
        id: "artemis-design",
        version,
        platform,
        arch,
      });
      expect(updates.status().availableVersion).toBe(version);
      expect(capabilityArchiveDownloadUrl(manifest!.archive.url)).toBe(
        `https://github.com/EurekaRaider/Artemis/releases/download/artemis-design-v${version}/artemis-design-${platform}-${arch}.zip`,
      );
      expect(
        manifest!.files.some((file) => file.path === "artemis.plugin.json"),
      ).toBe(true);
    },
  );
});
