import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import { build } from "esbuild";
import { packageGateway } from "../../../../scripts/build/package-gateway.mjs";

import { ensureNodePtySpawnHelpersExecutable } from "./node-pty-permissions.mjs";
import { buildComputerUse } from "./build-computer-use.mjs";

const require = createRequire(import.meta.url);
const packageBuild = process.env.ARTEMIS_PACKAGE_BUILD === "1";
if (!packageBuild) buildComputerUse(process.arch, true);
const esmRequireBridge = {
  js: 'import { createRequire as artemisBundleCreateRequire } from "node:module"; const require = artemisBundleCreateRequire(import.meta.url); const __dirname = import.meta.dirname;',
};

if (process.platform === "darwin") {
  const nodePtyRoot = dirname(dirname(require.resolve("node-pty")));
  await ensureNodePtySpawnHelpersExecutable(nodePtyRoot);
}

await rm("dist-electron", { recursive: true, force: true });
await packageGateway("dist-electron/artemis-gateway.tar.gz");

const shared = {
  bundle: true,
  external: [
    "electron",
    "node-pty",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "electron-updater",
    // officeparser dynamically imports puppeteer only for optional PDF generation
    // (a code path Artemis never exercises). Keep it external so esbuild doesn't
    // try to bundle it and drag in its transitive typescript/cosmiconfig loaders.
    "puppeteer",
  ],
  logLevel: "info",
  minify: packageBuild,
  platform: "node",
  sourcemap: !packageBuild,
  target: "node24",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/preload/computer-preview-preload.ts"],
    format: "cjs",
    outfile: "dist-electron/computer-preview-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/design-plugin-panel-preload.ts"],
    format: "cjs",
    outfile: "dist-electron/design-plugin-panel-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/workspace-tab-menu-preload.ts"],
    format: "cjs",
    outfile: "dist-electron/workspace-tab-menu-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/im/slack-cli-hook.ts"],
    format: "cjs",
    outfile: "dist-electron/slack-cli-hook.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/conversation/thread-history-worker.ts"],
    banner: esmRequireBridge,
    format: "esm",
    outfile: "dist-electron/thread-history-worker.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/conversation/attachment-worker.ts"],
    banner: esmRequireBridge,
    external: [
      ...shared.external,
      "officeparser",
      "pdfjs-dist",
      "@napi-rs/canvas",
    ],
    format: "esm",
    outfile: "dist-electron/attachment-worker.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/bootstrap.ts"],
    banner: esmRequireBridge,
    format: "esm",
    outfile: "dist-electron/main.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/preload.ts"],
    format: "cjs",
    outfile: "dist-electron/preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/agent/agent-worker.ts"],
    banner: esmRequireBridge,
    external: [
      ...shared.external,
      "@earendil-works/pi-coding-agent",
      "@sinclair/typebox",
    ],
    format: "esm",
    outfile: "dist-electron/agent-worker.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/extension/extension-worker.ts"],
    external: [
      ...shared.external,
      "@earendil-works/pi-coding-agent",
      "@sinclair/typebox",
    ],
    format: "esm",
    outfile: "dist-electron/extension-worker.js",
  }),
]);
