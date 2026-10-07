// Design capability-pack runtime (todo ⑤): the settings toggle's backend.
// Same trust machinery as the office workbench — CapabilityPackService +
// update checks over a signed catalog — namespaced to packId "artemis-design".
// The plugin has no native binaries: native verification refuses office-core
// and no-ops otherwise (the pack system still verifies every file digest).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CapabilityPackStatus } from "@artemis/protocol";
import { rcompare } from "semver";
import { checkCapabilityPackUpdatesForHostUpgrade } from "../capabilities/capability-pack-host-upgrade.js";
import { CapabilityPackService } from "../capabilities/capability-pack-service.js";
import { PluginRevisionStore } from "./design-plugin-revision-store.js";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "../office/office-capability-updates.js";

export interface DesignPackRuntime {
  packs: CapabilityPackService;
  updates: OfficeCapabilityUpdates;
  status(): Promise<
    CapabilityPackStatus & {
      canCheckUpdates?: boolean;
      availableVersion?: string;
      updateVersion?: string;
      updateCheck?: string;
      updateError?: string;
    }
  >;
  /**
   * Publish the active pack payload into the design-plugin revision store so
   * thread bindings (typeBinding.contentHash) and the dispatch trust chain
   * resolve against the pack contents exactly like a marketplace-installed
   * plugin. Idempotent: the store refuses hash collisions with other bytes
   * and accepts identical republishes.
   */
  syncActiveRevision(): Promise<
    | { installationId: string; contentHash: string; revisionRoot: string }
    | undefined
  >;
}

export async function createDesignPackRuntime(options: {
  userData: string;
  catalogPath: string;
  hostVersion: string;
  /** Design-plugin revision store root (designPluginRevisionsRoot). */
  revisionsRoot: string;
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
  async function syncActiveRevision() {
    const current = await packs.status();
    console.log(
      `[design-pack] sync: activeVersion=${current.activeVersion ?? "none"} versions=${current.versions.length}`,
    );
    const activeVersion = current.activeVersion;
    if (!activeVersion) return undefined;
    const lease = await packs.acquire();
    try {
      const store = new PluginRevisionStore(options.revisionsRoot);
      const sourceRoot = lease.root;
      const contentHash =
        await PluginRevisionStore.computeContentHash(sourceRoot);
      const manifest = JSON.parse(
        await readFile(join(sourceRoot, "artemis.plugin.json"), "utf8"),
      ) as { id: string; version: string };
      console.log(
        `[design-pack] sync: publishing ${manifest.id}@${contentHash.slice(0, 10)} → ${options.revisionsRoot}`,
      );
      const published = await store.publish({
        installationId: manifest.id,
        contentHash,
        sourceRoot,
      });
      console.log(`[design-pack] sync: published → ${published.revisionRoot}`);
      return {
        installationId: manifest.id,
        contentHash: published.contentHash,
        revisionRoot: published.revisionRoot,
      };
    } finally {
      lease.release();
    }
  }
  const runtime = { packs, updates, status, syncActiveRevision };
  // Refresh update metadata after a host upgrade; installation remains manual.
  try {
    await checkCapabilityPackUpdatesForHostUpgrade(
      runtime,
      options.userData,
      options.hostVersion,
      "artemis-design",
    );
  } catch (error) {
    console.error("[design-pack] update check failed", error);
  }
  return runtime;
}
