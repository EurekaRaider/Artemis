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
// @ts-expect-error Build scripts are exercised directly.
import { collectReleaseAssets } from "../../../scripts/collect-release-assets.mjs";
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
  for (const platform of ["macos-arm64", "windows-x64"]) {
    const dir = join(root, `release-${platform}`);
    await mkdir(dir);
    const windows = platform === "windows-x64";
    const names = windows
      ? ["Artemis-Windows-x64-1.6.0.zip"]
      : [
          "Artemis-macOS-arm64-1.6.0.dmg",
          "Artemis-macOS-arm64-1.6.0.zip",
          "latest-mac.yml",
        ];
    const artifacts = [];
    for (const name of names) {
      const zipName = "Artemis-macOS-arm64-1.6.0.zip";
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
        distribution: windows ? "manual-windows-zip" : "automatic-update",
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
  expect((await readdir(output)).length).toBe(5);
  const manifest = JSON.parse(
    await readFile(join(output, "release-manifest.json"), "utf8"),
  );
  expect(manifest.artifacts).toHaveLength(4);
  expect(JSON.stringify(manifest)).not.toContain(root);
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
