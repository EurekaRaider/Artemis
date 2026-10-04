// Design capability-pack builder (todo ③): end-to-end rehearsal on the real
// plugin source. Covers schema+signature acceptance, install into a namespaced
// CapabilityPackService, payload content, hostRange gating, tamper rejection
// and cross-key rejection — the whole release chain minus the owner-held key.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCapabilityManifest } from "../../../src/main/capabilities/capability-pack-service.js";
import { CapabilityPackService } from "../../../src/main/capabilities/capability-pack-service.js";
import {
  buildCatalog,
  inventoryTree,
  signManifest,
  treeDigest,
  unsignedManifests,
  zipEntries,
} from "../../../../../scripts/design-pack/pack.mjs";

const SOURCE_ROOT = join(
  process.cwd(),
  "resources/design-plugins/artemis-design",
);
const HOST_VERSION = "1.6.18";
const sha = (input) => createHash("sha256").update(input).digest("hex");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Software packs carry no native code: native verification must never run. */
const softwareVerifyNative = vi.fn(async (_directory, manifest) => {
  if (manifest.id === "office-core")
    throw new Error("office-core must use verifyOfficeNative");
});

async function buildPack(overrides: Record<string, unknown> = {}) {
  const files = await inventoryTree(SOURCE_ROOT);
  const entries = [];
  for (const file of files)
    entries.push({
      name: file.path,
      bytes: await readFile(join(SOURCE_ROOT, file.path)),
      executable: file.executable,
    });
  const archive = zipEntries(entries);
  const unsigned = unsignedManifests({
    id: "artemis-design",
    version: "0.1.1",
    hostRange: `>=${HOST_VERSION} <2`,
    files,
    sourceDigest: treeDigest(files),
    archive: { sha256: sha(archive), downloadBytes: archive.length },
  }) as Array<Record<string, unknown>>;
  const pair = generateKeyPairSync("ed25519");
  const keyId = "design-pack-test";
  const publicKeyPem = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const signWith = (
    unsignedItem: Record<string, unknown>,
    key = pair.privateKey,
  ) =>
    signManifest(unsignedItem, {
      privateKeyPem: key.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId,
    });
  const manifests = unsigned.map((item) => signWith(item));
  return {
    files,
    archive,
    unsigned,
    manifests,
    publicKeyPem,
    keyId,
    signWith,
    privateKey: pair.privateKey,
    ...overrides,
  };
}

function serviceFor(root: string, publicKeyPem: string) {
  return new CapabilityPackService({
    root,
    packId: "artemis-design",
    hostVersion: HOST_VERSION,
    platform: "darwin",
    arch: "arm64",
    publicKeys: { "design-pack-test": publicKeyPem },
    verifyNative: softwareVerifyNative as never,
    dependents: async () => [],
    fetch: undefined,
  });
}

describe("design pack build & release chain", () => {
  it("inventories the real plugin source and produces a schema-valid signed manifest", async () => {
    const pack = await buildPack();
    // The real plugin content: manifest, panel, runtime, schema.
    const paths = pack.files.map((file) => file.path).sort();
    expect(paths).toContain("artemis.plugin.json");
    expect(paths).toContain("panel/index.html");
    expect(paths).toContain("runtime/index.mjs");
    for (const manifest of pack.manifests)
      expect(
        verifyCapabilityManifest(manifest, {
          hostVersion: HOST_VERSION,
          platform: manifest.platform,
          arch: manifest.arch,
          publicKeys: { [pack.keyId]: pack.publicKeyPem },
        }).version,
      ).toBe("0.1.1");
  });

  it("installs the real pack into a namespaced service and serves its payload", async () => {
    const pack = await buildPack();
    const root = await mkdtemp(join(tmpdir(), "artemis-design-pack-"));
    roots.push(root);
    const service = serviceFor(join(root, "packs"), pack.publicKeyPem);
    // Software packs download from the pinned release URL; rehearse the
    // install path by feeding the local archive through the same fetch seam.
    const download = vi.fn(async () => new Response(pack.archive));
    (service as unknown as { options: { fetch?: unknown } }).options.fetch =
      download;
    await service.install(pack.manifests[0]!);
    const status = await service.status();
    expect(status.id).toBe("artemis-design");
    expect(status.activeVersion).toBe("0.1.1");
    const lease = await service.acquire();
    const pluginManifest = JSON.parse(
      await readFile(join(lease.root, "artemis.plugin.json"), "utf8"),
    );
    expect(pluginManifest.id).toBe("com.artemis.design");
    const panel = await readFile(join(lease.root, "panel/index.html"), "utf8");
    expect(panel).toContain("dzMockDesktop");
    const runtime = await readFile(
      join(lease.root, "runtime/index.mjs"),
      "utf8",
    );
    expect(runtime).toContain("protocolVersion");
    lease.release();
    softwareVerifyNative.mockClear();
  });

  it("rejects a host outside the manifest range", () => {
    return (async () => {
      const pack = await buildPack();
      expect(() =>
        verifyCapabilityManifest(pack.manifests[0]!, {
          hostVersion: "1.5.0",
          platform: "darwin",
          arch: "arm64",
          publicKeys: { [pack.keyId]: pack.publicKeyPem },
        }),
      ).toThrow(/incompatible/u);
    })();
  });

  it("refuses a tampered archive", async () => {
    const pack = await buildPack();
    const root = await mkdtemp(join(tmpdir(), "artemis-design-pack-"));
    roots.push(root);
    const service = serviceFor(join(root, "packs"), pack.publicKeyPem);
    const tampered = Buffer.from(pack.archive);
    tampered[tampered.length - 30] ^= 0xff;
    (service as unknown as { options: { fetch?: unknown } }).options.fetch =
      vi.fn(async () => new Response(tampered));
    await expect(service.install(pack.manifests[0]!)).rejects.toThrow(
      /digest mismatch/u,
    );
  });

  it("refuses signatures from an untrusted key", async () => {
    const pack = await buildPack();
    const other = generateKeyPairSync("ed25519");
    const forged = pack.signWith(pack.unsigned[0]!, other.privateKey);
    expect(() =>
      verifyCapabilityManifest(forged, {
        hostVersion: HOST_VERSION,
        platform: "darwin",
        arch: "arm64",
        publicKeys: { [pack.keyId]: pack.publicKeyPem },
      }),
    ).toThrow(/signature/u);
  });

  it("round-trips the catalog exactly as the app consumes it", async () => {
    const pack = await buildPack();
    const catalog = buildCatalog(pack.manifests, pack.publicKeyPem, pack.keyId);
    expect(catalog.schemaVersion).toBe(1);
    expect(Object.keys(catalog.publicKeys)).toEqual([pack.keyId]);
    expect(catalog.manifests).toHaveLength(2); // darwin-arm64 + win32-x64
    for (const manifest of catalog.manifests)
      expect(manifest.archive.url).toContain(
        `/artemis-design-v0.1.1/artemis-design-`,
      );
  });
});
