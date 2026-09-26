import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

// Test-only encrypted storage, isolated from the runner's interactive keychain.
// Production builds never load this esbuild plugin.
export function licenseTestStoragePlugin() {
  const key = randomBytes(32).toString("hex");
  return {
    name: "artemis-visual-license-fixture-storage",
    setup(builder) {
      builder.onLoad({ filter: /main[/\\]main\.ts$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        if (!source.includes("  safeStorage,"))
          throw new Error(
            "Visual fixture could not isolate desktop safeStorage",
          );
        return {
          loader: "ts",
          contents:
            source.replace("  safeStorage,", "") +
            `
            const fixtureStorageKey = Buffer.from(${JSON.stringify(key)}, "hex");
            function assertFixtureStorage() {
              if (app.isPackaged) throw new Error("artemis-visual-license-fixture storage cannot run packaged");
            }
            const safeStorage = {
              isEncryptionAvailable() { assertFixtureStorage(); return true; },
              encryptString(value) {
                assertFixtureStorage();
                const iv = fixtureRandomBytes(12);
                const cipher = fixtureCreateCipheriv("aes-256-gcm", fixtureStorageKey, iv);
                const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
                return Buffer.concat([iv, cipher.getAuthTag(), data]);
              },
              decryptString(bytes) {
                assertFixtureStorage();
                const decipher = fixtureCreateDecipheriv("aes-256-gcm", fixtureStorageKey, bytes.subarray(0, 12));
                decipher.setAuthTag(bytes.subarray(12, 28));
                return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
              },
            };
            import { createCipheriv as fixtureCreateCipheriv, createDecipheriv as fixtureCreateDecipheriv, randomBytes as fixtureRandomBytes } from "node:crypto";
          `,
        };
      });
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
