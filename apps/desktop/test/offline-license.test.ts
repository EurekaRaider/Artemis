import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeLicense, deviceCode } from "../src/license/codec.js";
import { LicenseService, type LicenseRecord } from "../src/license/service.js";

const keys = generateKeyPairSync("ed25519");
const trust = {
  owner: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const device = deviceCode("darwin", "12345678-1234-4567-890a-123456789abc");
const now = 1_800_000_000_000;
function token(overrides = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      product: "artemis",
      kind: "license",
      keyId: "owner",
      id: "test-license",
      device,
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 60_000,
      ...overrides,
    }),
  ).toString("base64url");
  return `ART1.${payload}.${sign(null, Buffer.from(`ART1.${payload}`), keys.privateKey).toString("base64url")}`;
}
function fixture() {
  let wall = now;
  let mono = 0;
  let record: LicenseRecord | undefined;
  let broken = false;
  const service = new LicenseService(
    device,
    trust,
    {
      read: () => record,
      write: (next) => {
        if (broken) throw new Error("disk");
        record = structuredClone(next);
      },
    },
    () => wall,
    () => mono,
  );
  return {
    service,
    wall: (n: number) => {
      wall = n;
    },
    mono: (n: number) => {
      mono = n;
    },
    breakStore: () => {
      broken = true;
    },
    record: () => record,
  };
}
describe("offline license trust boundary", () => {
  it("never promotes a recovery token stored in the license slot into an authorization", () => {
    const challenge = "a".repeat(64);
    const recovery = token({ kind: "recovery", challenge, baseline: now });
    const service = new LicenseService(
      device,
      trust,
      {
        read: () => ({
          version: 1,
          token: recovery,
          highWater: now,
          interrupted: true,
          challenge,
        }),
        write: () => {},
      },
      () => now,
      () => 0,
    );
    expect(service.status().state).toBe("invalid_license");
    expect(service.recover(recovery).state).toBe("unlicensed");
    expect(() => service.assertValid()).toThrow();
  });
  it("accepts a signed device-bound license and expires at the exact boundary", () => {
    const f = fixture();
    expect(f.service.status().state).toBe("unlicensed");
    expect(f.service.activate(token()).state).toBe("valid");
    f.wall(now + 60_000);
    expect(f.service.status().state).toBe("expired");
    expect(() => f.service.assertValid()).toThrow();
  });
  it("rejects a different computer, unknown signer, future license and altered payload", () => {
    expect(() => decodeLicense(token(), {}, device)).toThrow();
    expect(() =>
      decodeLicense(
        token(),
        trust,
        deviceCode("win32", "12345678-1234-4567-890a-123456789abc"),
      ),
    ).toThrow("device_mismatch");
    expect(() =>
      decodeLicense(token().replace("ART1.", "ART2."), trust, device),
    ).toThrow();
    const parts = token().split(".");
    const body = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    body.expiresAt += 999999;
    expect(() =>
      decodeLicense(
        `ART1.${Buffer.from(JSON.stringify(body)).toString("base64url")}.${parts[2]}`,
        trust,
        device,
      ),
    ).toThrow();
    expect(
      fixture().service.activate(token({ notBefore: now + 1000 })).state,
    ).toBe("not_yet_valid");
  });
  it("rejects malformed, oversized and invalid date input", () => {
    for (const value of [
      "",
      "x".repeat(17000),
      "ART1.!.!",
      token({ expiresAt: "tomorrow" }),
      token({ expiresAt: now - 1 }),
    ]) {
      expect(() => decodeLicense(value, trust, device)).toThrow();
    }
  });
  it("does not extend expiry during small clock corrections", () => {
    const f = fixture();
    f.service.activate(token());
    f.wall(now - 1000);
    f.mono(60_000);
    expect(f.service.status().state).toBe("expired");
  });
  it("detects rollback and refuses to discard history when importing another key", () => {
    const f = fixture();
    f.service.activate(token({ expiresAt: now + 86_400_000 }));
    f.wall(now + 600_000);
    f.service.checkpoint();
    f.wall(now);
    expect(f.service.status().state).toBe("clock_error");
    expect(
      f.service.activate(token({ expiresAt: now + 86_400_000 })).state,
    ).toBe("clock_error");
  });
  it("fails closed on storage failure and never replaces a valid key with invalid input", () => {
    const f = fixture();
    f.service.activate(token());
    expect(() => f.service.activate("bad")).toThrow();
    expect(f.service.status().state).toBe("valid");
    f.breakStore();
    f.service.checkpoint();
    expect(f.service.status().state).toBe("storage_error");
  });
  it("requires a fresh signed challenge to recover clock state, without extending expiry", () => {
    const f = fixture();
    f.service.activate(token());
    const challenge = f.service.recoveryChallenge();
    const recovery = token({
      kind: "recovery",
      challenge,
      baseline: now,
      expiresAt: now + 300_000,
    });
    expect(f.service.recover(recovery).state).toBe("valid");
    expect(() => f.service.recover(recovery)).toThrow();
    f.wall(now + 60_000);
    expect(f.service.status().state).toBe("expired");
  });
});
