import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("excludes manually compressed DMGs from the official release manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artemis-artifacts-test-"));
  try {
    await mkdir(join(directory, "release"));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ version: "1.6.0" }),
    );
    for (const name of [
      "Artemis-macOS-arm64-1.6.0.zip",
      "Artemis-macOS-arm64-1.6.0.dmg.zip",
      "latest-mac.yml",
    ]) {
      await writeFile(join(directory, "release", name), "fixture");
    }
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/finalize-release.mjs", import.meta.url),
        ),
      ],
      { cwd: directory },
    );
    const manifest = JSON.parse(
      await readFile(
        join(directory, "release", "release-manifest.json"),
        "utf8",
      ),
    );
    expect(
      manifest.artifacts.map((artifact: { name: string }) => artifact.name),
    ).toEqual(["Artemis-macOS-arm64-1.6.0.zip", "latest-mac.yml"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
