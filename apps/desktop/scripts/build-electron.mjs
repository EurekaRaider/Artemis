import { createRequire } from "node:module";
import { dirname } from "node:path";

import { build } from "esbuild";

import { ensureNodePtySpawnHelpersExecutable } from "./node-pty-permissions.mjs";

const require = createRequire(import.meta.url);
const esmRequireBridge = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};

if (process.platform === "darwin") {
  const nodePtyRoot = dirname(dirname(require.resolve("node-pty")));
  await ensureNodePtySpawnHelpersExecutable(nodePtyRoot);
}

const shared = {
  bundle: true,
  external: [
    "electron",
    "node-pty",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "electron-updater",
  ],
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node24",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
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
