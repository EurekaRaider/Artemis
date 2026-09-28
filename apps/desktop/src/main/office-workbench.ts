import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactEvent } from "@artemis/protocol";
import { rcompare } from "semver";
import { CapabilityPackService } from "./capability-pack-service.js";
import { OfficeSessionService } from "./office-session-service.js";
import { UnoOfficeEngine, verifyOfficeNative } from "./office-uno-engine.js";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "./office-capability-updates.js";

export async function createOfficeWorkbench(options: {
  userData: string;
  catalogPath: string;
  hostVersion: string;
  dependents(version: string): Promise<string[]>;
  emit(threadId: string, event: ArtifactEvent): void;
  canAutoSave?(threadId: string): boolean;
}) {
  const catalog = JSON.parse(
    await readFile(options.catalogPath, "utf8"),
  ) as OfficeRuntimeCatalog;
  if (
    catalog.schemaVersion !== 1 ||
    !catalog.publicKeys ||
    !Array.isArray(catalog.manifests)
  )
    throw new Error("Invalid Office runtime catalog");
  const packs = new CapabilityPackService({
    root: join(options.userData, "capability-packs"),
    hostVersion: options.hostVersion,
    platform: process.platform,
    arch: process.arch,
    publicKeys: catalog.publicKeys,
    dependents: options.dependents,
    verifyNative: verifyOfficeNative,
  });
  const updates = new OfficeCapabilityUpdates(catalog, {
    hostVersion: options.hostVersion,
    platform: process.platform,
    arch: process.arch,
  });
  async function status() {
    const current = await packs.status();
    const installed =
      current.activeVersion ??
      current.versions.map((version) => version.version).sort(rcompare)[0];
    return { ...current, ...updates.status(installed) };
  }
  const sessions = new OfficeSessionService({
    root: join(options.userData, "office-sessions"),
    emit: options.emit,
    canAutoSave: (threadId) => options.canAutoSave?.(threadId) ?? false,
    createEngine: async () => {
      const lease = await packs.acquire();
      try {
        return await UnoOfficeEngine.create(
          lease.root,
          lease.manifest,
          join(options.userData, "office-profiles", randomUUID()),
          lease.release,
        );
      } catch (error) {
        lease.release();
        throw error;
      }
    },
    // Enable only after the native round-trip matrix accepts an explicit support policy.
    canSaveOriginal: async () => false,
  });
  return { packs, sessions, catalog, updates, status };
}
