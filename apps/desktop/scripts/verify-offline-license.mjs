import { build } from "esbuild";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  cp,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const desktop = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(desktop, "../..");
const output = join(root, "artifacts/offline-license");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, "native-"));
const fixture = generateKeyPairSync("ed25519");
const publicKeys = {
  fixture: fixture.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const privatePem = fixture.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const mode = process.argv.includes("--full-app") ? "full-app" : "expiry";
try {
  await cp(join(desktop, "dist-electron"), join(stage, "dist-electron"), {
    recursive: true,
  });
  await symlink(join(desktop, "build"), join(stage, "build"), "dir");
  await symlink(join(desktop, "resources"), join(stage, "resources"), "dir");
  await symlink(
    join(desktop, "dist-renderer"),
    join(stage, "dist-renderer"),
    "dir",
  );
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify({
      name: "artemis-license-native-fixture",
      type: "module",
      main: "dist-electron/main.js",
    }),
  );
  const report = join(output, `${mode}.json`);
  const source = `
import { app, BrowserWindow, safeStorage } from "electron";
import { sign } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { readDeviceCode } from ${JSON.stringify(join(desktop, "src/license/device.ts"))};
app.setPath("userData", ${JSON.stringify(join(stage, "profile"))});
app.relaunch = () => {};
const proof = { mode: ${JSON.stringify(mode)}, locked: false, invalidRejected: false, entered: false, expired: false };
const deadline = setTimeout(() => { writeFileSync(${JSON.stringify(report)}, JSON.stringify(proof)); app.exit(2); }, 60000);
let issuedAt = 0;
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", () => void (async () => {
    if (window.webContents.getURL().includes("license-ui")) {
      const initial = await window.webContents.executeJavaScript("window.license.status()");
      if (initial.state !== "unlicensed") throw new Error("Expected locked startup: " + initial.state);
      proof.locked = true;
      proof.invalidRejected = await window.webContents.executeJavaScript("window.license.activate('invalid').then(() => false, () => true)");
      await window.webContents.executeJavaScript("(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); document.getElementById('device').value = 'AM1-' + '0'.repeat(64); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); })()");
      const image = await window.webContents.capturePage();
      writeFileSync(${JSON.stringify(join(output, "activation.png"))}, image.toPNG());
      const device = await readDeviceCode(); issuedAt = Date.now();
      const body = Buffer.from(JSON.stringify({ version: 1, product: "artemis", kind: "license", keyId: "fixture", id: "native-fixture", device, issuedAt, notBefore: issuedAt, expiresAt: issuedAt + ${mode === "expiry" ? 2500 : 600000} })).toString("base64url");
      const token = "ART1." + body + "." + sign(null, Buffer.from("ART1." + body), ${JSON.stringify(privatePem)}).toString("base64url");
      const result = await window.webContents.executeJavaScript("window.license.activate(" + JSON.stringify(token) + ")");
      if (result.state !== "valid") throw new Error("Activation failed: " + result.state);
    } else { proof.entered = true; }
  })().catch((error) => { console.error(error); app.exit(3); }));
});
app.on("before-quit", () => {
  clearTimeout(deadline);
  if (${mode === "expiry"}) {
    const saved = JSON.parse(safeStorage.decryptString(readFileSync(${JSON.stringify(join(stage, "profile/license/state.bin"))})));
    proof.expired = saved.interrupted && Date.now() >= issuedAt + 2500;
  }
  writeFileSync(${JSON.stringify(report)}, JSON.stringify(proof, null, 2));
});
await import(${JSON.stringify(join(desktop, "src/license/bootstrap.ts"))});
`;
  const harness = join(stage, "harness.ts");
  await writeFile(harness, source);
  await build({
    entryPoints: [harness],
    outfile: join(stage, "dist-electron/main.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import { createRequire as artemisBundleCreateRequire } from "node:module"; const require = artemisBundleCreateRequire(import.meta.url); const __dirname = import.meta.dirname;',
    },
    external: [
      "electron",
      "node-pty",
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/sdk/*",
      "electron-updater",
      "puppeteer",
    ],
    plugins: [
      {
        name: "isolated-fixture-only",
        setup(builder) {
          builder.onLoad({ filter: /license-public-keys\.json$/ }, () => ({
            contents: JSON.stringify(publicKeys),
            loader: "json",
          }));
          if (mode === "expiry")
            builder.onResolve({ filter: /^\.\.\/main\/main\.js$/ }, () => ({
              path: "fixture-runtime",
              namespace: "fixture",
            }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              'import { BrowserWindow } from "electron"; new BrowserWindow({show:false}).loadURL("data:text/html,<h1>Authorized runtime fixture</h1>");',
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "full-app") {
    env.ARTEMIS_SMOKE_SCREENSHOT = join(output, "authorized.png");
    env.ARTEMIS_SMOKE_VIEW = "conversation-timeline-empty";
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn(require("electron"), [stage], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (data) => {
      logs += data;
    });
    child.stderr.on("data", (data) => {
      logs += data;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Native license test timed out"));
    }, 75000);
    child.on("error", reject);
    child.on("exit", async (code) => {
      clearTimeout(timeout);
      await writeFile(join(output, `${mode}.log`), logs);
      code === 0
        ? resolvePromise()
        : reject(
            new Error(`Native license test exited ${code}; see ${mode}.log`),
          );
    });
  });
  const proof = JSON.parse(await readFile(report, "utf8"));
  if (
    !proof.locked ||
    !proof.invalidRejected ||
    !proof.entered ||
    (mode === "expiry" && !proof.expired)
  )
    throw new Error(`Incomplete native evidence: ${JSON.stringify(proof)}`);
  console.log(JSON.stringify(proof));
} finally {
  await rm(stage, { recursive: true, force: true });
}
