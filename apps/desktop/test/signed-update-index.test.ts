import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import {
  canonicalUpdatePayload,
  verifyUpdateIndex,
} from "../src/main/signed-update-index.js";
const key = generateKeyPairSync("ed25519");
const keys = {
  test: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const payload = {
  version: "2.0.0",
  platform: "win32",
  arch: "x64",
  distribution: "nsis",
  sequence: 100,
  minUpdaterVersion: 1,
  assets: [
    {
      name: "Artemis-Windows-x64-2.0.0.exe",
      sha256: "a".repeat(64),
      size: 100,
    },
  ],
};
function envelope(value = payload) {
  return {
    schemaVersion: 1,
    keyId: "test",
    payload: value,
    signature: sign(
      null,
      Buffer.from(canonicalUpdatePayload(value)),
      key.privateKey,
    ).toString("base64"),
  };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
it("accepts a signed installer and binds every field to the signature", () => {
  expect(verifyUpdateIndex(bytes(envelope()), keys).version).toBe("2.0.0");
  for (const field of ["version", "sequence", "assets"] as const) {
    const value = envelope();
    if (field === "version") value.payload = { ...payload, version: "2.0.1" };
    if (field === "sequence") value.payload = { ...payload, sequence: 101 };
    if (field === "assets")
      value.payload = {
        ...payload,
        assets: [{ ...payload.assets[0]!, sha256: "b".repeat(64) }],
      };
    expect(() => verifyUpdateIndex(bytes(value), keys)).toThrow("signature");
  }
});
it("refuses unknown keys, replay, wrong architectures and oversized manifests", () => {
  expect(() => verifyUpdateIndex(bytes(envelope()), {})).toThrow("key");
  expect(() => verifyUpdateIndex(bytes(envelope()), keys, 101)).toThrow(
    "replay",
  );
  expect(() =>
    verifyUpdateIndex(
      bytes({ ...envelope(), payload: { ...payload, arch: "arm64" } }),
      keys,
    ),
  ).toThrow();
  expect(() => verifyUpdateIndex(Buffer.alloc(65537), keys)).toThrow("64 KiB");
});
