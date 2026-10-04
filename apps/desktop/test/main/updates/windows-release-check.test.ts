import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it, vi } from "vitest";
import { checkWindowsRelease } from "../../../src/main/updates/windows-release-check.js";
import { canonicalUpdatePayload } from "../../../src/main/updates/signed-update-index.js";
const key = generateKeyPairSync("ed25519");
const keys = {
  test: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
function release(version = "1.10.0") {
  const payload = {
    version,
    platform: "win32",
    arch: "x64",
    distribution: "nsis",
    sequence: 1,
    minUpdaterVersion: 1,
    assets: ["exe", "zip"].map((extension) => ({
      name: `Artemis-Windows-x64-${version}.${extension}`,
      size: 1,
      sha256: "a".repeat(64),
    })),
  };
  return {
    schemaVersion: 1,
    keyId: "test",
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalUpdatePayload(payload)),
      key.privateKey,
    ).toString("base64"),
  };
}
it("uses the signed Windows channel independently of GitHub latest and keeps ZIP manual", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(release())));
  expect(
    await checkWindowsRelease("1.9.0", undefined, undefined, fetcher, keys),
  ).toEqual({
    version: "1.10.0",
    downloadUrl:
      "https://github.com/EurekaRaider/ArtemisRelease/releases/download/v1.10.0/Artemis-Windows-x64-1.10.0.zip",
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("windows-x64-stable");
  expect(
    await checkWindowsRelease("1.10.0", undefined, undefined, fetcher, keys),
  ).toBeUndefined();
});
it("fails closed on unknown signatures, corrupt metadata, missing channels and oversized responses", async () => {
  const fetcher = async () => new Response(JSON.stringify(release()));
  await expect(
    checkWindowsRelease("1.0.0", undefined, undefined, fetcher, {}),
  ).rejects.toThrow("key");
  await expect(
    checkWindowsRelease(
      "1.0.0",
      undefined,
      undefined,
      async () => new Response("", { status: 404 }),
      keys,
    ),
  ).rejects.toThrow("404");
  await expect(
    checkWindowsRelease(
      "1.0.0",
      undefined,
      undefined,
      async () => new Response("x".repeat(65537)),
      keys,
    ),
  ).rejects.toThrow("64 KiB");
  const tampered = release();
  tampered.payload.version = "1.11.0";
  await expect(
    checkWindowsRelease(
      "1.0.0",
      undefined,
      undefined,
      async () => new Response(JSON.stringify(tampered)),
      keys,
    ),
  ).rejects.toThrow("signature");
});
