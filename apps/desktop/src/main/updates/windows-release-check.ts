import { gt, valid } from "semver";
import publicKeys from "../../../resources/update-public-keys.json" with { type: "json" };
import { fetchUpdateIndex } from "./fetch-update-index.js";
export interface WindowsRelease {
  version: string;
  downloadUrl: string;
}
// ZIP remains manual, but uses the same platform-specific signed channel as NSIS.
export async function checkWindowsRelease(
  currentVersion: string,
  owner = "EurekaRaider",
  repo = "Artemis",
  fetchRelease: typeof fetch = globalThis.fetch,
  keys: Record<string, string> = publicKeys,
): Promise<WindowsRelease | undefined> {
  if (![owner, repo].every((value) => /^[A-Za-z0-9_.-]+$/u.test(value)))
    throw new Error("Invalid release repository.");
  if (!valid(currentVersion)) throw new Error("Invalid current version.");
  const index = await fetchUpdateIndex(
    `https://github.com/${owner}/${repo}/releases/download/windows-x64-stable/windows-x64-update.json`,
    keys,
    0,
    fetchRelease,
  );
  if (!gt(index.version, currentVersion)) return undefined;
  const name = `Artemis-Windows-x64-${index.version}.zip`;
  if (!index.assets.some((asset) => asset.name === name))
    throw new Error("Signed Windows ZIP is missing.");
  return {
    version: index.version,
    downloadUrl: `https://github.com/${owner}/${repo}/releases/download/v${index.version}/${name}`,
  };
}
