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
    ["darwin", "arm64"],
    ["win32", "x64"],
  ])("offers a trusted installer immediately for %s %s", (platform, arch) => {
    const updates = new OfficeCapabilityUpdates(catalog, {
      hostVersion,
      platform,
      arch,
      packId: "artemis-design",
    });
    const manifest = updates.available();
    expect(manifest).toMatchObject({
      id: "artemis-design",
      version: "0.2.0",
      platform,
      arch,
    });
    expect(updates.status().availableVersion).toBe("0.2.0");
    expect(capabilityArchiveDownloadUrl(manifest!.archive.url)).toBe(
      `https://github.com/EurekaRaider/Artemis/releases/download/artemis-design-v0.2.0/artemis-design-${platform}-${arch}.zip`,
    );
    expect(
      manifest!.files.some((file) => file.path === "artemis.plugin.json"),
    ).toBe(true);
  });
});
