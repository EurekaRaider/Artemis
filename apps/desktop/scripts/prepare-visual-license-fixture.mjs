import { build } from "esbuild";
import { generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Test-only compilation: never imported by a production entry or package build.
// Exercise real signature validation with a fresh key, without owner credentials.
export async function prepareVisualLicenseFixture() {
  if (process.env.ARTEMIS_PACKAGE_BUILD === "1")
    throw new Error("Visual license fixtures cannot be packaged");
  const desktop = fileURLToPath(new URL("../", import.meta.url));
  const target = new URL("../dist-electron/main.js", import.meta.url);
  const original = await readFile(target);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = {
    visual: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  const privatePem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  await build({
    absWorkingDir: desktop,
    entryPoints: ["src/license/bootstrap.ts"],
    outfile: fileURLToPath(target),
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
        name: "artemis-visual-license-fixture",
        setup(builder) {
          builder.onLoad({ filter: /license-public-keys\.json$/ }, () => ({
            contents: JSON.stringify(keys),
            loader: "json",
          }));
          builder.onLoad(
            { filter: /license[/\\]bootstrap\.ts$/ },
            async ({ path }) => {
              let source = await readFile(path, "utf8");
              source =
                'import { sign as fixtureSign } from "node:crypto";\n' + source;
              source = source.replace(
                "service.checkpoint();",
                `
            if (app.isPackaged) throw new Error("artemis-visual-license-fixture cannot run packaged");
            const now = Date.now();
            const body = Buffer.from(JSON.stringify({ version: 1, product: "artemis", kind: "license", keyId: "visual", id: "visual-fixture", device: service.device, issuedAt: now, notBefore: now, expiresAt: now + 3600000 })).toString("base64url");
            service.activate("ART1." + body + "." + fixtureSign(null, Buffer.from("ART1." + body), ${JSON.stringify(privatePem)}).toString("base64url"));
            service.checkpoint();`,
              );
              return { contents: source, loader: "ts" };
            },
          );
        },
      },
    ],
  });
  return () => writeFile(target, original);
}
