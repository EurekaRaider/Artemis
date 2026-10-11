import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { load } from "js-yaml";
// @ts-expect-error Build scripts are exercised directly.
import { collectReleaseAssets } from "../../../../scripts/release/collect-release-assets.mjs";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-release-"));
  directories.push(root);
  for (const platform of ["macos-arm64", "macos-x64", "windows-x64"]) {
    const dir = join(root, `release-${platform}`);
    await mkdir(dir);
    const windows = platform === "windows-x64";
    const arch = platform === "macos-x64" ? "x64" : "arm64";
    const names = windows
      ? [
          "Artemis-Windows-x64-1.6.0.exe",
          "Artemis-Windows-x64-1.6.0.zip",
          "windows-x64-update.json",
        ]
      : [
          `Artemis-macOS-${arch}-1.6.0.dmg`,
          `Artemis-macOS-${arch}-1.6.0.zip`,
          "latest-mac.yml",
        ];
    const artifacts = [];
    for (const name of names) {
      const zipName = `Artemis-macOS-${arch}-1.6.0.zip`;
      const bytes = Buffer.from(
        name === "latest-mac.yml"
          ? `version: 1.6.0\nfiles:\n  - url: ${zipName}\n    sha512: ${createHash("sha512").update(zipName).digest("base64")}\n`
          : name,
      );
      await writeFile(join(dir, name), bytes);
      artifacts.push({
        name,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await writeFile(
      join(dir, "release-manifest.json"),
      JSON.stringify({
        version: "1.6.0",
        distribution: windows ? "nsis-and-manual-zip" : "automatic-update",
        artifacts,
      }),
    );
  }
  return root;
}
it("combines independently verified manifests without overwriting either platform", async () => {
  const root = await fixture();
  const output = join(root, "output");
  await collectReleaseAssets(root, output, "1.6.0");
  expect((await readdir(output)).length).toBe(9);
  const manifest = JSON.parse(
    await readFile(join(output, "release-manifest.json"), "utf8"),
  );
  expect(manifest.artifacts).toHaveLength(8);
  expect(JSON.stringify(manifest)).not.toContain(root);
  const metadataBytes = await readFile(join(output, "latest-mac.yml"));
  const metadata = load(metadataBytes.toString()) as {
    files: { url: string }[];
  };
  expect(metadata.files.map((file) => file.url)).toEqual([
    "Artemis-macOS-arm64-1.6.0.zip",
    "Artemis-macOS-x64-1.6.0.zip",
  ]);
  expect(
    manifest.artifacts.find(
      (artifact: { name: string }) => artifact.name === "latest-mac.yml",
    ),
  ).toMatchObject({
    size: metadataBytes.length,
    sha256: createHash("sha256").update(metadataBytes).digest("hex"),
  });
});
it("publishes a complete macOS release without Windows artifacts when explicitly selected", async () => {
  const root = await fixture();
  await rm(join(root, "release-windows-x64"), { recursive: true });
  const output = join(root, "output");
  await collectReleaseAssets(root, output, "1.6.0", true);
  expect((await readdir(output)).sort()).toEqual([
    "Artemis-macOS-arm64-1.6.0.dmg",
    "Artemis-macOS-arm64-1.6.0.zip",
    "Artemis-macOS-x64-1.6.0.dmg",
    "Artemis-macOS-x64-1.6.0.zip",
    "latest-mac.yml",
    "release-manifest.json",
  ]);
  const manifest = JSON.parse(
    await readFile(join(output, "release-manifest.json"), "utf8"),
  );
  expect(manifest.artifacts).toHaveLength(5);
});
it("requires the independently verified Intel release set", async () => {
  const root = await fixture();
  await rm(join(root, "release-macos-x64"), { recursive: true });
  const output = join(root, "output");
  await expect(collectReleaseAssets(root, output, "1.6.0")).rejects.toThrow();
  await expect(readdir(output)).rejects.toThrow();
});
it("rejects tampered Intel artifacts before creating output", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "release-macos-x64", "Artemis-macOS-x64-1.6.0.zip"),
    "tampered",
  );
  const output = join(root, "output");
  await expect(collectReleaseAssets(root, output, "1.6.0")).rejects.toThrow(
    "integrity",
  );
  await expect(readdir(output)).rejects.toThrow();
});
it("rejects Intel metadata pointing at another architecture", async () => {
  const root = await fixture();
  const directory = join(root, "release-macos-x64");
  const metadata = await readFile(
    join(root, "release-macos-arm64", "latest-mac.yml"),
  );
  await writeFile(join(directory, "latest-mac.yml"), metadata);
  const manifestPath = join(directory, "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  Object.assign(
    manifest.artifacts.find(
      (item: { name: string }) => item.name === "latest-mac.yml",
    ),
    {
      size: metadata.length,
      sha256: createHash("sha256").update(metadata).digest("hex"),
    },
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  const output = join(root, "output");
  await expect(collectReleaseAssets(root, output, "1.6.0")).rejects.toThrow(
    "Invalid macOS update metadata",
  );
  await expect(readdir(output)).rejects.toThrow();
});
it.each(["tampered", "missing"])(
  "blocks macOS-only publication for a %s macOS ZIP",
  async (state) => {
    const root = await fixture();
    const zip = join(
      root,
      "release-macos-arm64",
      "Artemis-macOS-arm64-1.6.0.zip",
    );
    if (state === "missing") await rm(zip);
    else await writeFile(zip, "tampered");
    const output = join(root, "output");
    await expect(
      collectReleaseAssets(root, output, "1.6.0", true),
    ).rejects.toThrow();
    await expect(readdir(output)).rejects.toThrow();
  },
);
it("still requires valid update metadata for macOS-only publication", async () => {
  const root = await fixture();
  const directory = join(root, "release-macos-arm64");
  const metadata = Buffer.from("version: 1.5.0\nfiles: []\n");
  await writeFile(join(directory, "latest-mac.yml"), metadata);
  const manifestPath = join(directory, "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  Object.assign(
    manifest.artifacts.find(
      (item: { name: string }) => item.name === "latest-mac.yml",
    ),
    {
      size: metadata.length,
      sha256: createHash("sha256").update(metadata).digest("hex"),
    },
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  const output = join(root, "output");
  await expect(
    collectReleaseAssets(root, output, "1.6.0", true),
  ).rejects.toThrow("Invalid macOS update metadata");
  await expect(readdir(output)).rejects.toThrow();
});
it("blocks publication for tampered or missing Windows artifacts", async () => {
  const root = await fixture();
  const zip = join(
    root,
    "release-windows-x64",
    "Artemis-Windows-x64-1.6.0.zip",
  );
  await writeFile(zip, "tampered");
  await expect(
    collectReleaseAssets(root, join(root, "output"), "1.6.0"),
  ).rejects.toThrow("integrity");
  await rm(zip);
  await expect(
    collectReleaseAssets(root, join(root, "output"), "1.6.0"),
  ).rejects.toThrow();
});

it("rejects license issuer artifacts before creating public output", async () => {
  const root = await fixture();
  const directory = join(root, "release-windows-x64");
  const path = join(directory, "release-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.artifacts.push({
    name: "Artemis-License-Issuer.zip",
    size: 0,
    sha256: "",
  });
  await writeFile(path, JSON.stringify(manifest));
  await expect(
    collectReleaseAssets(root, join(root, "output"), "1.6.0"),
  ).rejects.toThrow("Unexpected or duplicate release artifact");
  await expect(readdir(join(root, "output"))).rejects.toThrow();
});
