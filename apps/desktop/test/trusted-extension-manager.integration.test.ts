import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TrustedExtensionManager } from "../src/main/trusted-extension-manager.js";
import {
  hashExtensionFile,
  type TrustedExtensionConfig,
} from "../src/main/trusted-extension-store.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspacePath = resolve(testDirectory, "..", "..", "..");
const workerPath = resolve(
  workspacePath,
  "apps",
  "desktop",
  "dist-electron",
  "extension-worker.js",
);

describe("TrustedExtensionManager Windows integration", () => {
  it.runIf(process.platform === "win32" && existsSync(workerPath))(
    "loads and executes a Pi tool extension inside AppContainer",
    async () => {
      const extensionPath = resolve(
        testDirectory,
        "fixtures",
        "trusted-extension.mjs",
      );
      const config: TrustedExtensionConfig = {
        id: "1234567890abcdef12345678",
        name: "Integration fixture",
        path: extensionPath,
        sha256: await hashExtensionFile(extensionPath),
        enabled: true,
        allowNetwork: false,
        trustedAt: new Date().toISOString(),
      };
      const manager = new TrustedExtensionManager(
        "win32",
        resolve(
          workspacePath,
          "apps",
          "desktop",
          "resources",
          "windows-sandbox.ps1",
        ),
        workerPath,
      );

      const status = (await manager.refresh([config], workspacePath))[0];
      expect(status?.state, status?.error).toBe("ready");
      expect(status?.tools.map((tool) => tool.toolName)).toEqual([
        "greet",
        "security_probe",
      ]);
      expect(
        await manager.call(
          config.id,
          "greet",
          { name: "OK" },
          workspacePath,
          "execute",
        ),
      ).toEqual({ output: "EXTENSION_HELLO:OK", isError: false });
      const probe = await manager.call(
        config.id,
        "security_probe",
        {},
        workspacePath,
        "execute",
      );
      expect(JSON.parse(probe.output)).toEqual({
        insideWrite: true,
        outsideWrite: false,
        networkAccess: false,
      });
      const fullAccessProbe = await manager.call(
        config.id,
        "security_probe",
        {},
        workspacePath,
        "execute",
        true,
      );
      expect(JSON.parse(fullAccessProbe.output)).toMatchObject({
        insideWrite: true,
        outsideWrite: true,
      });
    },
    120_000,
  );
});
