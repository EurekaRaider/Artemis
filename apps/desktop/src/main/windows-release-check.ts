import { gt, valid, prerelease } from "semver";

export interface WindowsRelease {
  version: string;
  downloadUrl: string;
}

// ZIP builds only inspect release metadata. They never invoke electron-updater.
export async function checkWindowsRelease(
  currentVersion: string,
  owner = "EurekaRaider",
  repo = "ArtemisRelease",
  fetchRelease: typeof fetch = globalThis.fetch,
): Promise<WindowsRelease | undefined> {
  if (![owner, repo].every((value) => /^[A-Za-z0-9_.-]+$/u.test(value)))
    throw new Error("Invalid release repository.");
  const response = await fetchRelease(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    {
      headers: { accept: "application/vnd.github+json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Release check failed (HTTP ${response.status}).`);
  // GitHub metadata is untrusted; bound it before parsing.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Release metadata is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) throw new Error("Release metadata is too large.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const release = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const version =
    typeof release.tag_name === "string" ? valid(release.tag_name) : null;
  if (!version || !valid(currentVersion))
    throw new Error("Invalid release version.");
  if (
    release.draft ||
    release.prerelease ||
    prerelease(version) ||
    !gt(version, currentVersion)
  )
    return undefined;
  const name = `Artemis-Windows-x64-${version}.zip`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry: { name?: unknown }) => entry?.name === name)
    : undefined;
  if (!asset) return undefined; // A macOS-only release is not a Windows update.
  const downloadUrl = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
  if (asset.browser_download_url !== downloadUrl)
    throw new Error("Unexpected Windows download URL.");
  return { version, downloadUrl };
}
