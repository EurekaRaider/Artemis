import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";

import {
  forbiddenPackagedSourcePaths,
  verifyPackagedSourcePrivacy,
} from "../scripts/verify-packaged-source-privacy.mjs";

const temporaryDirectories: string[] = [];
const desktopPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  build: { asarUnpack: string[]; files: string[] };
};
const buildElectronSource = readFileSync(
  new URL("../scripts/build-electron.mjs", import.meta.url),
  "utf8",
);
const macPackageSource = readFileSync(
  new URL("../scripts/package-mac-lite.mjs", import.meta.url),
  "utf8",
);
const windowsPackageSource = readFileSync(
  new URL("../scripts/package-windows-lite.mjs", import.meta.url),
  "utf8",
);
const afterPackSource = readFileSync(
  new URL("../scripts/apply-package-permissions.cjs", import.meta.url),
  "utf8",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function packageContext(root: string) {
  return {
    electronPlatformName: "win32",
    appOutDir: root,
    packager: { appInfo: { productFilename: "Artemis" } },
  };
}

async function writeFixture(root: string, path: string, content: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createPackagedFixture(
  files: Record<string, string>,
  externalFiles: Record<string, string> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "artemis-source-privacy-"));
  temporaryDirectories.push(root);
  const application = join(root, "application");
  const resources = join(root, "resources");
  await mkdir(application, { recursive: true });
  await mkdir(resources, { recursive: true });

  for (const [path, content] of Object.entries(files)) {
    await writeFixture(application, path, content);
  }
  for (const [path, content] of Object.entries(externalFiles)) {
    await writeFixture(resources, path, content);
  }
  await createPackage(application, join(resources, "app.asar"));
  return root;
}

describe("packaged source privacy", () => {
  it("hardens every macOS and Windows package build", () => {
    expect(buildElectronSource).toContain(
      'process.env.ARTEMIS_PACKAGE_BUILD === "1"',
    );
    expect(buildElectronSource).toContain("minify: packageBuild");
    expect(buildElectronSource).toContain("sourcemap: !packageBuild");
    expect(macPackageSource).toContain('ARTEMIS_PACKAGE_BUILD: "1"');
    expect(windowsPackageSource).toContain('ARTEMIS_PACKAGE_BUILD: "1"');
    expect(afterPackSource).toContain("verifyPackagedSourcePrivacy(context)");
    expect(desktopPackage.build.asarUnpack).toEqual([
      "node_modules/node-pty/**",
    ]);
    expect(desktopPackage.build.files).toEqual(
      expect.arrayContaining([
        "!**/*.map",
        "!**/*.ts",
        "!**/*.tsx",
        "!**/*.mts",
        "!**/*.cts",
      ]),
    );
  });

  it("classifies source maps and TypeScript source files", () => {
    expect(
      forbiddenPackagedSourcePaths([
        "/dist-electron/main.js",
        "/dist-electron/main.js.map",
        "/node_modules/example/index.d.ts",
        "/node_modules/example/index.mts",
        "/resources/worker.cts",
      ]),
    ).toEqual([
      "dist-electron/main.js.map",
      "node_modules/example/index.d.ts",
      "node_modules/example/index.mts",
      "resources/worker.cts",
    ]);
  });

  it("accepts a package containing only compiled bundles and runtime assets", async () => {
    const root = await createPackagedFixture({
      "dist-electron/main.js": "console.log('ready');",
      "dist-renderer/index.js": "(()=>{})();",
      "package.json": '{"name":"fixture"}',
    });

    await expect(
      verifyPackagedSourcePrivacy(packageContext(root)),
    ).resolves.toBeUndefined();
  });

  it("rejects embedded maps, source references, and unpacked TypeScript", async () => {
    const root = await createPackagedFixture(
      {
        "dist-electron/main.js":
          "console.log('ready');\n//# sourceMappingURL=main.js.map",
        "dist-electron/main.js.map": "{}",
      },
      {
        "app.asar.unpacked/node_modules/example/source.ts": "export {};",
      },
    );

    let failure: unknown;
    try {
      await verifyPackagedSourcePrivacy(packageContext(root));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("main.js.map");
    expect((failure as Error).message).toContain("sourceMappingURL");
    expect((failure as Error).message).toContain("source.ts");
  });
});
