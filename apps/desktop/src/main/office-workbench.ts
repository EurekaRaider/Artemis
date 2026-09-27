import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactEvent, CapabilityPackManifest } from "@artemis/protocol";
import { CapabilityPackService } from "./capability-pack-service.js";
import { OfficeSessionService } from "./office-session-service.js";
import { UnoOfficeEngine, verifyOfficeNative } from "./office-uno-engine.js";

export interface OfficeRuntimeCatalog {
  schemaVersion: 1;
  publicKeys: Record<string, string>;
  manifests: CapabilityPackManifest[];
}

export async function createOfficeWorkbench(options: {
  userData: string;
  catalogPath: string;
  hostVersion: string;
  dependents(version: string): Promise<string[]>;
  emit(threadId: string, event: ArtifactEvent): void;
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
  const sessions = new OfficeSessionService({
    root: join(options.userData, "office-sessions"),
    emit: options.emit,
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
  return { packs, sessions, catalog };
}
