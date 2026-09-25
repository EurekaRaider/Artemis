import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newVault,
  unlockVault,
  issue,
  publicConfiguration,
} from "../../license-issuer/src/signing.js";
import { deviceCode, decodeLicense } from "../src/license/codec.js";
import { LicenseService } from "../src/license/service.js";
import { protectedLicenseStorage } from "../src/license/storage.js";

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => any) =>
      handlers.set(name, fn),
    on: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn),
    once: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn),
  },
}));
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const identity = deviceCode("darwin", "12345678-1234-4567-890a-123456789abc");
const key = unlockVault(
  newVault("fixture-only-password"),
  "fixture-only-password",
);
const trust = publicConfiguration(key);

describe("issuer, persistence and runtime authorization", () => {
  it("encrypts private keys and roundtrips a real issuer license through client verification", () => {
    const vault = newVault("fixture-only-password");
    expect(vault).toContain("BEGIN ENCRYPTED PRIVATE KEY");
    expect(() => unlockVault(vault, "incorrect")).toThrow();
    expect(() => newVault("short")).toThrow();
    const token = issue(key, {
      device: identity,
      expiresAt: Date.now() + 100_000,
    });
    expect(decodeLicense(token, trust, identity).kind).toBe("license");
    expect(() =>
      decodeLicense(
        token,
        trust,
        deviceCode("win32", "12345678-1234-4567-890a-123456789abc"),
      ),
    ).toThrow();
  });
  it("fails closed on corrupt protected storage, unavailable encryption and write failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "artemis-license-test-"));
    temporary.push(directory);
    const path = join(directory, "state.bin");
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    };
    const storage = protectedLicenseStorage(path, encryption);
    expect(storage.read()).toBeUndefined();
    const now = Date.now();
    storage.write({ version: 1, highWater: now, interrupted: true });
    expect(storage.read()?.highWater).toBe(now);
    writeFileSync(path, "corrupt");
    expect(new LicenseService(identity, trust, storage).status().state).toBe(
      "storage_error",
    );
    encryption.isEncryptionAvailable = () => false;
    expect(() =>
      storage.write({ version: 1, highWater: now, interrupted: false }),
    ).toThrow();
  });
  it("preserves rollback protection and interruption across application restarts", () => {
    const now = Date.now();
    let wall = now;
    let data: any;
    const store = {
      read: () => data,
      write: (value: any) => {
        data = structuredClone(value);
      },
    };
    const service = new LicenseService(
      identity,
      trust,
      store,
      () => wall,
      () => 0,
    );
    service.activate(
      issue(key, { device: identity, expiresAt: now + 86400000 }, now),
    );
    wall += 600000;
    service.interrupt();
    wall = now;
    const restarted = new LicenseService(
      identity,
      trust,
      store,
      () => wall,
      () => 0,
    );
    expect(restarted.suppressResume).toBe(true);
    expect(restarted.status().state).toBe("clock_error");
    const request = restarted.recoveryChallenge();
    const recovery = issue(
      key,
      {
        device: identity,
        expiresAt: now + 60000,
        recovery: { challenge: request },
      },
      now,
    );
    expect(restarted.recover(recovery).state).toBe("valid");
    expect(() =>
      new LicenseService(
        identity,
        trust,
        store,
        () => wall,
        () => 0,
      ).recover(recovery),
    ).toThrow();
  });
  it("denies direct IPC and event calls after expiry and triggers runtime shutdown", async () => {
    const runtime = await import("../src/license/runtime.js");
    let wall = Date.now();
    const started = wall;
    const service = new LicenseService(
      identity,
      trust,
      { read: () => undefined, write: () => {} },
      () => wall,
      () => 0,
    );
    service.activate(
      issue(key, { device: identity, expiresAt: wall + 1000 }, wall),
    );
    const invalid = vi.fn();
    const business = vi.fn(() => "result");
    runtime.setLicenseService(service, invalid);
    runtime.licensedIpc.handle("business", business);
    runtime.licensedIpc.on("event", business);
    expect(handlers.get("business")!({})).toBe("result");
    wall = started + 1000;
    expect(() => handlers.get("business")!({})).toThrow("LICENSE_REQUIRED");
    handlers.get("event")!({});
    expect(business).toHaveBeenCalledTimes(1);
    expect(invalid).toHaveBeenCalledTimes(1);
  });
  it("routes business IPC through the license adapter and guards executable entrypoints", () => {
    const source = readFileSync(
      new URL("../src/main/main.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("licensedIpc as ipcMain");
    expect(source).toContain(
      "if (!canRunLicensed() || !agentProcess || !store)",
    );
    expect(source).toContain(
      "if (suppressLicenseResume() || !canRunLicensed()) return",
    );
    expect(source).toContain("!smokeMode && !suppressLicenseResume()");
    const bootstrap = readFileSync(
      new URL("../src/license/bootstrap.ts", import.meta.url),
      "utf8",
    );
    expect(bootstrap.indexOf("await ensureWindowsPackageAccess(")).toBeLessThan(
      bootstrap.indexOf("new LicenseService("),
    );
    expect(source).not.toContain("await ensureWindowsPackageAccess(");
    expect(bootstrap.indexOf("service.assertValid()")).toBeLessThan(
      bootstrap.indexOf('import("../main/main.js")'),
    );
  });
});
