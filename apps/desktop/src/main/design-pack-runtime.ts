// Design capability-pack runtime (todo ⑤): the settings toggle's backend.
// Same trust machinery as the office workbench — CapabilityPackService +
// update checks over a signed catalog — namespaced to packId "artemis-design".
// The plugin has no native binaries: native verification refuses office-core
// and no-ops otherwise (the pack system still verifies every file digest).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityPackStatus } from "@artemis/protocol";
import { rcompare } from "semver";
import { CapabilityPackService } from "./capability-pack-service.js";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "./office-capability-updates.js";

export interface DesignPackRuntime {
  packs: CapabilityPackService;
  updates: OfficeCapabilityUpdates;
  status(): Promise<CapabilityPackStatus & { canCheckUpdates?: boolean; availableVersion?: string; updateVersion?: string; updateCheck?: string; updateError?: string }>;
}

export async function createDesignPackRuntime(options: {
  userData: string;
  catalogPath: string;
  hostVersion: string;
}): Promise<DesignPackRuntime> {
  const catalog = JSON.parse(
    await readFile(options.catalogPath, "utf8"),
  ) as OfficeRuntimeCatalog;
  if (
    catalog.schemaVersion !== 1 ||
    !catalog.publicKeys ||
    !Array.isArray(catalog.manifests)
  )
    throw new Error("Invalid design pack catalog");
  const packs = new CapabilityPackService({
    root: join(options.userData, "capability-packs"),
    packId: "artemis-design",
    hostVersion: options.hostVersion,
    platform: process.platform,
    arch: process.arch,
    publicKeys: catalog.publicKeys,
    dependents: async () => [],
    verifyNative: async (_directory, manifest) => {
      if (manifest.id === "office-core")
        throw new Error(
          "office-core packs must be verified by the office runtime",
        );
      // Software packs carry no native binaries; the pack system has already
      // verified every file digest and the absence of links.
    },
  });
  const updates = new OfficeCapabilityUpdates(catalog, {
    hostVersion: options.hostVersion,
    platform: process.platform,
    arch: process.arch,
    packId: "artemis-design",
  });
  async function status() {
    const current = await packs.status();
    const installed =
      current.activeVersion ??
      current.versions.map((version) => version.version).sort(rcompare)[0];
    return { ...current, ...updates.status(installed) };
  }
  return { packs, updates, status };
}
