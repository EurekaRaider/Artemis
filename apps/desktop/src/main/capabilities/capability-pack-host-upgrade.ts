import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gt, valid } from "semver";
import type { OfficeCapabilityUpdates } from "../office/office-capability-updates.js";

/** Missing markers cover upgrades from hosts predating this update policy. */
export async function checkCapabilityPackUpdatesForHostUpgrade(
  runtime: {
    updates: Pick<OfficeCapabilityUpdates, "check" | "status">;
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
    // Installing a newer release always requires an explicit user action.
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
