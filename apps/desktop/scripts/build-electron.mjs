import { createRequire } from "node:module";
import { rm, cp, readFile } from "node:fs/promises";
import { createPublicKey } from "node:crypto";
import { dirname } from "node:path";

import { build } from "esbuild";
import { packageGateway } from "../../../scripts/package-gateway.mjs";

import { ensureNodePtySpawnHelpersExecutable } from "./node-pty-permissions.mjs";
import { buildComputerUse } from "./build-computer-use.mjs";

const require = createRequire(import.meta.url);
const packageBuild = process.env.ARTEMIS_PACKAGE_BUILD === "1";
if (!packageBuild) buildComputerUse(process.arch, true);
const licenseKeys = JSON.parse(
  await readFile("license-public-keys.json", "utf8"),
);
for (const [id, pem] of Object.entries(licenseKeys)) {
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
    typeof pem !== "string" ||
    !pem.startsWith("-----BEGIN PUBLIC KEY-----") ||
    pem.includes("PRIVATE KEY") ||
    createPublicKey(pem).asymmetricKeyType !== "ed25519" ||
    createPublicKey(pem)
      .export({ type: "spki", format: "pem" })
      .toString()
      .trim() !== pem.trim()
  )
    throw new Error("Invalid license public key configuration");
}
if (packageBuild && Object.keys(licenseKeys).length === 0)
  throw new Error(
    "Generate owner keys in the License Issuer and import the public key configuration before packaging Artemis.",
  );
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

await cp("src/license/ui", "dist-electron/license-ui", { recursive: true });
await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/license/preload.ts"],
    format: "cjs",
    outfile: "dist-electron/license-preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/slack-cli-hook.ts"],
    format: "cjs",
    outfile: "dist-electron/slack-cli-hook.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/thread-history-worker.ts"],
    banner: esmRequireBridge,
    format: "esm",
    outfile: "dist-electron/thread-history-worker.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/main/attachment-worker.ts"],
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
    entryPoints: ["src/license/bootstrap.ts"],
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
