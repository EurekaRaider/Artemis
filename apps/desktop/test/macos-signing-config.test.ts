import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { loadMacSigningEnvironment } from "../scripts/macos-signing-config.mjs";
import { notarizationArguments } from "../scripts/notarize-macos-app.mjs";
import {
  collectMacUpdateMetadata,
  writeMacUpdateMetadata,
} from "../scripts/macos-update-metadata.mjs";
import { load } from "js-yaml";

const directories: string[] = [];

it("preserves both architectures when notarized apps are repackaged separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artemis-metadata-test-"));
  directories.push(directory);
  const path = join(directory, "latest-mac.yml");
  const metadata = new Map();
  for (const arch of ["arm64", "x64"]) {
    await writeFile(
      path,
      JSON.stringify({
        version: "1.0.0",
        files: [{ url: `${arch}.zip`, sha512: arch }],
      }),
    );
    await collectMacUpdateMetadata(directory, metadata, "1.0.0");
  }
  await writeMacUpdateMetadata(directory, metadata);
  expect(load(await readFile(path, "utf8"))).toMatchObject({
    files: [
      { url: "arm64.zip", sha512: "arm64" },
      { url: "x64.zip", sha512: "x64" },
    ],
  });
  await expect(
    collectMacUpdateMetadata(directory, metadata, "2.0.0"),
  ).rejects.toThrow("Invalid macOS update metadata");
});
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("loads persistent signing settings, but never silently ignores an invalid file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artemis-signing-test-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  expect(await loadMacSigningEnvironment(path)).toBeUndefined();
  const config = {
    CSC_NAME: "Developer ID Application: Example (TEAMID)",
    APPLE_KEYCHAIN_PROFILE: "example",
    ARTEMIS_UPDATE_OWNER: "example",
    ARTEMIS_UPDATE_REPO: "releases",
  };
  await writeFile(path, JSON.stringify(config));
  expect(await loadMacSigningEnvironment(path)).toEqual(config);
  await writeFile(
    path,
    JSON.stringify({
      ...config,
      APPLE_APP_SPECIFIC_PASSWORD: "must-not-be-stored",
    }),
  );
  await expect(loadMacSigningEnvironment(path)).rejects.toThrow(
    "Invalid macOS signing configuration",
  );
  await writeFile(path, "broken json");
  await expect(loadMacSigningEnvironment(path)).rejects.toThrow();
});

it("requires complete notarization credentials and respects the selected keychain", () => {
  expect(
    notarizationArguments({
      APPLE_KEYCHAIN_PROFILE: "example",
      APPLE_KEYCHAIN: "/example/keychain",
    }),
  ).toEqual([
    "--keychain-profile",
    "example",
    "--keychain",
    "/example/keychain",
  ]);
  expect(() => notarizationArguments({})).toThrow("Missing");
  expect(() =>
    notarizationArguments({
      APPLE_ID: "example",
      APPLE_KEYCHAIN_PROFILE: "example",
    }),
  ).toThrow("Incomplete");
});
