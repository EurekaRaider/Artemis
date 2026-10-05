import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalCapabilityJson } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";
import { OfficeCapabilityUpdates } from "../../../src/main/office/office-capability-updates.js";

const keys = generateKeyPairSync("ed25519");
const publicKeys = {
  test: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const updateUrl = "https://example.test/office/catalog.json";
function manifest(version: string, overrides: Record<string, unknown> = {}) {
  const value = {
    schemaVersion: 1,
    id: "office-core",
    version,
    hostRange: ">=1.6.8 <2",
    platform: "darwin",
    arch: "arm64",
    sourceDigest: "a".repeat(64),
    archive: {
      url: `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/mac.zip`,
      sha256: "b".repeat(64),
      downloadBytes: 10,
      unpackedBytes: 1,
    },
    files: [
      { path: "bridge", sha256: "c".repeat(64), bytes: 1, executable: true },
    ],
    entrypoint: "bridge",
    officeExecutable: "bridge",
    native: { signer: "TEST", notarization: "accepted-stapled" },
    ...overrides,
  };
  return {
    ...value,
    signature: {
      keyId: "test",
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(value)),
        keys.privateKey,
      ).toString("base64"),
    },
  };
}
function fixture() {
  const fetcher = vi.fn(async () =>
    Response.json({ schemaVersion: 1, manifests: [manifest("1.1.0")] }),
  );
  const updates = new OfficeCapabilityUpdates(
    { schemaVersion: 1, publicKeys, manifests: [], updateUrl },
    { hostVersion: "1.6.8", platform: "darwin", arch: "arm64", fetch: fetcher },
  );
  return { updates, fetcher };
}

describe("Office update checks", () => {
  it("checks the configured source and advertises only a newer compatible signed release", async () => {
    const { updates, fetcher } = fixture();
    expect(updates.status("1.0.0").updateCheck).toBe("idle");
    await updates.check();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(updates.status("1.0.0")).toMatchObject({
      canCheckUpdates: true,
      updateCheck: "checked",
      availableVersion: "1.1.0",
      updateVersion: "1.1.0",
    });
    expect(updates.status("1.1.0").updateVersion).toBeUndefined();
    expect(updates.status("1.2.0").updateVersion).toBeUndefined();
    expect(updates.available()?.version).toBe("1.1.0");
  });
  it("does not claim a current version when no online source is configured", async () => {
    const updates = new OfficeCapabilityUpdates(
      { schemaVersion: 1, publicKeys, manifests: [] },
      { hostVersion: "1.6.8", platform: "darwin", arch: "arm64" },
    );
    expect(updates.status("1.0.0")).toMatchObject({
      canCheckUpdates: false,
      updateCheck: "idle",
    });
    expect(updates.status("1.0.0").availableVersion).toBeUndefined();
  });
  it("retains the last verified release and reports a failed check without installing", async () => {
    const { updates, fetcher } = fixture();
    await updates.check();
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await updates.check();
    expect(updates.status("1.0.0")).toMatchObject({
      updateCheck: "error",
      updateError: "offline",
      updateVersion: "1.1.0",
    });
  });
  it.each([
    "signature",
    "foreign-key",
    "republished",
    "oversized",
    "http-redirect",
  ])(
    "rejects %s update metadata without replacing trusted data",
    async (kind) => {
      const { updates, fetcher } = fixture();
      await updates.check();
      const next = manifest(
        kind === "republished" ? "1.1.0" : "1.2.0",
        kind === "republished"
          ? {
              archive: { ...manifest("1.1.0").archive, sha256: "d".repeat(64) },
            }
          : {},
      );
      if (kind === "signature") next.hostRange = "*";
      if (kind === "foreign-key") next.signature.keyId = "remote";
      const response = Response.json({
        schemaVersion: 1,
        publicKeys: { remote: publicKeys.test },
        manifests: [next],
      });
      if (kind === "oversized")
        response.headers.set("content-length", String(16 * 1024 * 1024 + 1));
      if (kind === "http-redirect")
        Object.defineProperty(response, "url", {
          value: "http://example.test/catalog.json",
        });
      fetcher.mockResolvedValueOnce(response);
      await updates.check();
      expect(updates.status("1.0.0").updateCheck).toBe("error");
      expect(updates.available()?.version).toBe("1.1.0");
    },
  );
  it("selects the latest compatible release regardless of list order and never offers a downgrade", async () => {
    const { updates, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(
      Response.json({
        schemaVersion: 1,
        manifests: [
          manifest("1.2.0"),
          manifest("2.0.0", { hostRange: ">=2" }),
          manifest("1.0.0"),
        ],
      }),
    );
    await updates.check();
    expect(updates.available()?.version).toBe("1.2.0");
    fetcher.mockResolvedValueOnce(
      Response.json({ schemaVersion: 1, manifests: [manifest("1.0.0")] }),
    );
    await updates.check();
    expect(updates.available()?.version).toBe("1.2.0");
    expect(updates.status("1.2.0").updateVersion).toBeUndefined();
  });
});
