import { load } from "js-yaml";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function collectReleaseAssets(input, output, version) {
  const collected = [];
  for (const platform of ["macos-arm64", "windows-x64"]) {
    const directory = join(input, `release-${platform}`);
    const manifest = JSON.parse(
      await readFile(join(directory, "release-manifest.json"), "utf8"),
    );
    if (manifest.version !== version)
      throw new Error("Release manifest version mismatch");
    const windows = platform === "windows-x64";
    if (
      manifest.distribution !==
      (windows ? "manual-windows-zip" : "automatic-update")
    )
      throw new Error("Unexpected release distribution");
    const base = windows
      ? `Artemis-Windows-x64-${version}`
      : `Artemis-macOS-arm64-${version}`;
    const required = windows ? [`${base}.zip`] : [`${base}.dmg`, `${base}.zip`];
    const allowed = new Set(
      windows
        ? required
        : [
            ...required,
            `${base}.dmg.blockmap`,
            `${base}.zip.blockmap`,
            "latest-mac.yml",
            "alpha-mac.yml",
            "beta-mac.yml",
          ],
    );
    if (!Array.isArray(manifest.artifacts))
      throw new Error("Missing release artifacts");
    const names = new Set();
    for (const artifact of manifest.artifacts) {
      if (!allowed.has(artifact.name) || names.has(artifact.name))
        throw new Error("Unexpected or duplicate release artifact");
      names.add(artifact.name);
      const bytes = await readFile(join(directory, artifact.name));
      if (
        bytes.length !== artifact.size ||
        createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
      )
        throw new Error(`Release integrity failed: ${artifact.name}`);
      collected.push({ ...artifact, directory });
    }
    if (
      required.some((name) => !names.has(name)) ||
      (!windows &&
        !["latest-mac.yml", "alpha-mac.yml", "beta-mac.yml"].some((name) =>
          names.has(name),
        ))
    )
      throw new Error("Incomplete release set");
    if (
      (await readdir(directory)).some(
        (name) => name !== "release-manifest.json" && !names.has(name),
      )
    )
      throw new Error("Unlisted release artifact");
  }
  for (const artifact of collected.filter((item) =>
    item.name.endsWith("-mac.yml"),
  )) {
    const metadata = load(
      await readFile(join(artifact.directory, artifact.name), "utf8"),
    );
    if (
      metadata?.version !== version ||
      !Array.isArray(metadata.files) ||
      !metadata.files.some(
        (file) => file.url === `Artemis-macOS-arm64-${version}.zip`,
      )
    )
      throw new Error("Invalid macOS update metadata");
    for (const file of metadata.files) {
      const target = collected.find(
        (item) =>
          item.name === file.url && item.directory === artifact.directory,
      );
      if (!target || !/\.(zip|dmg)$/.test(file.url))
        throw new Error("Update metadata references an unknown artifact");
      const bytes = await readFile(join(target.directory, target.name));
      if (
        file.sha512 !== createHash("sha512").update(bytes).digest("base64") ||
        (file.size !== undefined && file.size !== bytes.length)
      )
        throw new Error("Update metadata checksum mismatch");
    }
  }
  // Validate both sets before copying anything; never let manifests overwrite each other.
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length)
    throw new Error("Release output must be empty");
  for (const artifact of collected)
    await copyFile(
      join(artifact.directory, artifact.name),
      join(output, artifact.name),
    );
  await writeFile(
    join(output, "release-manifest.json"),
    JSON.stringify(
      {
        version,
        artifacts: collected.map(({ directory, ...artifact }) => artifact),
      },
      null,
      2,
    ) + "\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  if (!process.argv[2] || !process.argv[3])
    throw new Error("Usage: collect-release-assets.mjs input output");
  await collectReleaseAssets(
    resolve(process.argv[2]),
    resolve(process.argv[3]),
    version,
  );
}
