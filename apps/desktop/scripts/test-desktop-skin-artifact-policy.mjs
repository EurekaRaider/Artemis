import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as asar from "@electron/asar";

import {
  desktopSkinAsarLeakage,
  desktopSkinLeakage,
  desktopSkinPackagingConfigurationIssues,
} from "./desktop-skin-artifact-policy.mjs";

const root = await mkdtemp(join(tmpdir(), "artemis-skin-policy-"));
let rejected = 0;

async function rejectAt(path, source) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, source, "utf8");
  const findings = await desktopSkinLeakage(root);
  if (findings.length === 0) {
    throw new Error(`Leakage policy accepted ${path}.`);
  }
  rejected += 1;
  await rm(target, { force: true });
}

try {
  await rejectAt(
    "dist-renderer/assets/index.js",
    'const id = "com.artemis.synthetic-stress";',
  );
  await rejectAt(
    "dist-renderer/assets/index.css",
    ':root[data-artemis-skin="com.artemis.synthetic-stress"] {}',
  );
  await rejectAt(
    "dist-electron/preload.cjs",
    "globalThis.__ARTEMIS_SKIN_SMOKE = {};",
  );
  await rejectAt(
    "resources/nested/fixture.json",
    '{"source":"stress-skin-fixture"}',
  );
  await rejectAt("app.asar.unpacked/fixture.txt", "@artemis/ui-gallery");

  const asarSource = join(root, "asar-source");
  const archivePath = join(root, "app.asar");
  await mkdir(asarSource, { recursive: true });
  await writeFile(
    join(asarSource, "renderer.js"),
    'const id = "com.artemis.synthetic-stress";',
    "utf8",
  );
  await asar.createPackage(asarSource, archivePath);
  const asarFindings = desktopSkinAsarLeakage(asar, archivePath);
  if (asarFindings.length === 0) {
    throw new Error("Leakage policy accepted an app.asar content marker.");
  }
  rejected += 1;
  await rm(asarSource, { recursive: true, force: true });
  await rm(archivePath, { force: true });

  const configurationIssues = desktopSkinPackagingConfigurationIssues({
    build: {
      files: [
        "dist-electron/**/*",
        "dist-renderer/**/*",
        "dist-renderer-skin-smoke/**/*",
      ],
      extraResources: [{ from: "test/skin-smoke", to: "resources" }],
    },
  });
  if (configurationIssues.length !== 2) {
    throw new Error(
      `Packaging configuration negatives were not both rejected: ${JSON.stringify(configurationIssues)}`,
    );
  }
  rejected += configurationIssues.length;

  await writeFile(join(root, "clean.js"), 'const id = "com.artemis.default";');
  const cleanFindings = await desktopSkinLeakage(root);
  if (cleanFindings.length !== 0) {
    throw new Error(
      `Clean fixture was rejected: ${JSON.stringify(cleanFindings)}`,
    );
  }

  console.log(
    JSON.stringify({ accepted: 1, rejected, status: "PASS" }, undefined, 2),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
