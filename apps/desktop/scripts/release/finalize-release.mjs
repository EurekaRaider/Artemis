import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { signWindowsUpdateIndex } from "../../../../scripts/release/windows-update-index.mjs";

const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument !== "--windows")) {
  throw new Error("Usage: finalize-release.mjs [--windows]");
}
const windowsRelease = argumentsList.includes("--windows");
const releaseDirectory = resolve("release");
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
let stagingPercentage;
if (!windowsRelease) {
  stagingPercentage = Number(process.env.ARTEMIS_STAGING_PERCENTAGE ?? "100");
  if (
    !Number.isFinite(stagingPercentage) ||
    stagingPercentage < 1 ||
    stagingPercentage > 100
  ) {
    throw new Error("ARTEMIS_STAGING_PERCENTAGE must be between 1 and 100");
  }
}

const names = await readdir(releaseDirectory);
let artifactNames;
if (windowsRelease) {
  await signWindowsUpdateIndex(releaseDirectory, packageJson.version, {
    privateKey: process.env.ARTEMIS_UPDATE_ED25519_PRIVATE_KEY,
    keyId: process.env.ARTEMIS_UPDATE_KEY_ID ?? "release-2026-01",
    sequence: Number(process.env.ARTEMIS_UPDATE_SEQUENCE),
    keys: JSON.parse(
      await readFile(
        new URL("../../resources/update-public-keys.json", import.meta.url),
        "utf8",
      ),
    ),
  });
  artifactNames = [
    `Artemis-Windows-x64-${packageJson.version}.exe`,
    `Artemis-Windows-x64-${packageJson.version}.zip`,
    "windows-x64-update.json",
  ];
} else {
  const updateMetadata = names.filter((name) =>
    /^(?:latest|alpha|beta)(?:-mac)?\.ya?ml$/u.test(name),
  );
  if (updateMetadata.length === 0) {
    throw new Error("electron-builder did not produce update metadata");
  }
  for (const name of updateMetadata) {
    const path = resolve(releaseDirectory, name);
    const source = await readFile(path, "utf8");
    const withoutExisting = source.replace(
      /^stagingPercentage:\s*.*(?:\r?\n|$)/gmu,
      "",
    );
    await writeFile(
      path,
      `${withoutExisting.trimEnd()}\nstagingPercentage: ${stagingPercentage}\n`,
      "utf8",
    );
  }
  artifactNames = names.filter(
    (name) =>
      updateMetadata.includes(name) ||
      ["arm64"].some((arch) =>
        ["dmg", "zip", "dmg.blockmap", "zip.blockmap"].some(
          (extension) =>
            name ===
            `Artemis-macOS-${arch}-${packageJson.version}.${extension}`,
        ),
      ),
  );
}

const artifacts = [];
for (const name of artifactNames.sort()) {
  const path = resolve(releaseDirectory, name);
  const bytes = await readFile(path);
  artifacts.push({
    name,
    size: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  resolve(releaseDirectory, "release-manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      version: packageJson.version,
      distribution: windowsRelease ? "nsis-and-manual-zip" : "automatic-update",
      ...(stagingPercentage === undefined ? {} : { stagingPercentage }),
      artifacts,
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);

console.log(
  windowsRelease
    ? `Finalized ${artifacts.length} verified Windows installer, ZIP and signed index artifacts.`
    : `Finalized ${artifacts.length} signed release artifacts at ${stagingPercentage}% rollout.`,
);
