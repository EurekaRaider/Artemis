import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument !== "--windows-zip")) {
  throw new Error("Usage: finalize-release.mjs [--windows-zip]");
}
const windowsZipOnly = argumentsList.includes("--windows-zip");
const releaseDirectory = resolve("release");
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
let stagingPercentage;
if (!windowsZipOnly) {
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
if (windowsZipOnly) {
  const expectedName = `Artemis-Windows-x64-${packageJson.version}.zip`;
  if (!names.includes(expectedName)) {
    throw new Error(`Expected Windows ZIP is missing: ${expectedName}`);
  }
  artifactNames = [expectedName];
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
      (name.startsWith("Artemis-macOS-") &&
        name.includes(`-${packageJson.version}.`) &&
        /\.(?:dmg|zip|blockmap)$/u.test(name)),
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
      distribution: windowsZipOnly ? "manual-windows-zip" : "automatic-update",
      ...(stagingPercentage === undefined ? {} : { stagingPercentage }),
      artifacts,
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);

console.log(
  windowsZipOnly
    ? `Finalized ${artifacts.length} verified Windows ZIP artifact for manual distribution.`
    : `Finalized ${artifacts.length} signed release artifacts at ${stagingPercentage}% rollout.`,
);
