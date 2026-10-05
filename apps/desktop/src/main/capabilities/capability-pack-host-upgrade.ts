import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gt, valid } from "semver";
import type { CapabilityPackService } from "./capability-pack-service.js";
import type { OfficeCapabilityUpdates } from "../office/office-capability-updates.js";

// Both services share active.json: serialize automatic activations.
let pending = Promise.resolve();
export function updateCapabilityPackForHostUpgrade(
  ...args: Parameters<typeof performHostUpgrade>
): Promise<void> {
  const result = pending.then(() => performHostUpgrade(...args));
  pending = result.catch(() => {});
  return result;
}

/** Missing markers cover upgrades from hosts predating this update policy. */
async function performHostUpgrade(
  runtime: {
    packs: Pick<CapabilityPackService, "install">;
    updates: Pick<OfficeCapabilityUpdates, "check" | "available" | "status">;
  },
  userData: string,
  hostVersion: string,
  packId: "artemis-design" | "office-core",
): Promise<void> {
  const marker = join(userData, `${packId}-host-version.json`);
  const readJson = async (path: string) => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const previous = (await readJson(marker))?.hostVersion;
  if (
    typeof previous === "string" &&
    valid(previous) &&
    !gt(hostVersion, previous)
  )
    return;
  // Read the activation intent directly: an old receipt may be incompatible
  // with the new host and therefore omitted by packs.status().
  const pointer = await readJson(
    join(userData, "capability-packs", "active.json"),
  );
  const active =
    pointer?.packs?.[packId] ??
    (packId === "office-core" ? pointer?.version : undefined);
  if (typeof active === "string" && valid(active)) {
    await runtime.updates.check();
    const manifest = runtime.updates.available();
    if (manifest && gt(manifest.version, active)) {
      await runtime.packs.install(manifest);
    }
    if (runtime.updates.status(active).updateCheck === "error") {
      throw new Error(
        "Capability update check failed; retry on the next launch",
      );
    }
  }
  await mkdir(userData, { recursive: true });
  await writeFile(`${marker}.tmp`, JSON.stringify({ hostVersion }));
  await rename(`${marker}.tmp`, marker);
}
