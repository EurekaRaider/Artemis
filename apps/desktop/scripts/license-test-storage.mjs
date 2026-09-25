import { randomBytes } from "node:crypto";

// Test-only encrypted storage, isolated from the runner's interactive keychain.
// Production builds never load this esbuild plugin.
export function licenseTestStoragePlugin() {
  const key = randomBytes(32).toString("hex");
  return {
    name: "artemis-visual-license-fixture-storage",
    setup(builder) {
      builder.onLoad({ filter: /license[/\\]storage\.ts$/ }, () => ({
        loader: "ts",
        contents: `
          import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
          import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
          import { dirname } from "node:path";
          import { app } from "electron";
          const key = Buffer.from(${JSON.stringify(key)}, "hex");
          export function protectedLicenseStorage(path) {
            if (app.isPackaged) throw new Error("artemis-visual-license-fixture storage cannot run packaged");
            return {
              read() {
                let bytes;
                try { bytes = readFileSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
                const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
                decipher.setAuthTag(bytes.subarray(12, 28));
                return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
              },
              write(value) {
                const iv = randomBytes(12);
                const cipher = createCipheriv("aes-256-gcm", key, iv);
                const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, Buffer.concat([iv, cipher.getAuthTag(), data]));
              },
            };
          }
        `,
      }));
    },
  };
}
