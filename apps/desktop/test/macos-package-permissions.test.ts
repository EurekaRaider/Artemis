import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";

import { ensureNodePtySpawnHelpersExecutable } from "../scripts/node-pty-permissions.mjs";

const require = createRequire(import.meta.url);
const cleanup: string[] = [];
const afterPackPath = fileURLToPath(
  new URL("../scripts/apply-package-permissions.cjs", import.meta.url),
);
const buildElectronPath = fileURLToPath(
  new URL("../scripts/build-electron.mjs", import.meta.url),
);
const engineeringAfterPackPath = fileURLToPath(
  new URL(
    "../scripts/apply-engineering-package-permissions.cjs",
    import.meta.url,
  ),
);

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createReadOnlySpawnHelpers(nodePtyRoot: string) {
  const helpers: string[] = [];
  for (const architecture of ["arm64", "x64"]) {
    const helper = join(
      nodePtyRoot,
      "prebuilds",
      `darwin-${architecture}`,
      "spawn-helper",
    );
    await mkdir(dirname(helper), { recursive: true });
    await writeFile(helper, "fixture");
    await chmod(helper, 0o644);
    helpers.push(helper);
  }
  return helpers;
}

describe("macOS node-pty package permissions", () => {
  it("restores the executable bit on every packaged spawn helper", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-node-pty-"));
    cleanup.push(directory);
    const helpers = await createReadOnlySpawnHelpers(directory);

    await ensureNodePtySpawnHelpersExecutable(directory);

    for (const helper of helpers) {
      expect((await stat(helper)).mode & 0o777).toBe(0o755);
    }
  });

  it("runs the permission repair against the unpacked macOS app", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-macos-package-"));
    cleanup.push(directory);
    const nodePtyRoot = join(
      directory,
      "Artemis.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "node-pty",
    );
    const helpers = await createReadOnlySpawnHelpers(nodePtyRoot);
    const asarInput = join(directory, "asar-input");
    await mkdir(join(asarInput, "dist-electron"), { recursive: true });
    await writeFile(
      join(asarInput, "dist-electron", "main.js"),
      "console.log('fixture');",
    );
    await createPackage(
      asarInput,
      join(directory, "Artemis.app", "Contents", "Resources", "app.asar"),
    );
    const afterPack = require(afterPackPath).default as (context: {
      electronPlatformName: string;
      appOutDir: string;
      packager: { appInfo: { productFilename: string } };
    }) => Promise<void>;

    await afterPack({
      electronPlatformName: "darwin",
      appOutDir: directory,
      packager: { appInfo: { productFilename: "Artemis" } },
    });

    for (const helper of helpers) {
      expect((await stat(helper)).mode & 0o777).toBe(0o755);
    }
  });

  it("repairs node-pty before starting a development or production build", () => {
    const source = require("node:fs").readFileSync(buildElectronPath, "utf8");
    expect(source).toContain("ensureNodePtySpawnHelpersExecutable");
    expect(source).toContain('require.resolve("node-pty")');
  });

  it("ad-hoc signs a Lite engineering app after repairing permissions", () => {
    const source = require("node:fs").readFileSync(
      engineeringAfterPackPath,
      "utf8",
    );
    expect(source).toContain("applyPackagePermissions.default(context)");
    expect(source).toContain('["--force", "--deep", "--sign", "-", appPath]');
    expect(source).toContain('["--verify", "--deep", "--strict", appPath]');
    expect(source).not.toContain("codex-primary-runtime");
  });
});
