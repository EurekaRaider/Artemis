import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import {
  canonicalCapabilityJson,
  type CapabilityPackManifest,
} from "@artemis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapabilityPackService,
  verifyCapabilityManifest,
} from "../src/main/capability-pack-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const sha = (input: Uint8Array | string) =>
  createHash("sha256").update(input).digest("hex");
const keys = generateKeyPairSync("ed25519");
const publicKeys = {
  test: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const target = {
  hostVersion: "1.6.8",
  platform: "darwin",
  arch: "arm64",
  publicKeys,
};

function zip(
  name = "runtime/bridge",
  bytes = Buffer.from("native test fixture"),
  mode = 0o100755,
): Buffer {
  const text = Buffer.from(name),
    compressed = deflateRawSync(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(crc32(bytes), 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(text.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(0x0314, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(crc32(bytes), 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(bytes.length, 24);
  directory.writeUInt16LE(text.length, 28);
  directory.writeUInt32LE((mode << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + text.length, 12);
  end.writeUInt32LE(header.length + text.length + compressed.length, 16);
  return Buffer.concat([header, text, compressed, directory, text, end]);
}
function signed(
  archive: Buffer,
  overrides: Record<string, unknown> = {},
): CapabilityPackManifest {
  const version =
    typeof overrides.version === "string" ? overrides.version : "1.0.0";
  const data = {
    schemaVersion: 1,
    id: "office-core",
    version,
    hostRange: ">=1.6.8 <2",
    platform: "darwin",
    arch: "arm64",
    sourceDigest: sha("source"),
    archive: {
      url: `https://github.com/EurekaRaider/ArtemisRelease/releases/download/office-runtime-v${version}/mac.zip`,
      sha256: sha(archive),
      downloadBytes: archive.length,
      unpackedBytes: Buffer.byteLength("native test fixture"),
    },
    entrypoint: "runtime/bridge",
    officeExecutable: "runtime/bridge",
    files: [
      {
        path: "runtime/bridge",
        sha256: sha("native test fixture"),
        bytes: Buffer.byteLength("native test fixture"),
        executable: true,
      },
    ],
    native: { signer: "TEST", notarization: "accepted-stapled" },
    ...overrides,
  };
  return {
    ...data,
    signature: {
      keyId: "test",
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(data)),
        keys.privateKey,
      ).toString("base64"),
    },
  } as CapabilityPackManifest;
}
async function fixture(archive = zip()) {
  const root = await mkdtemp(join(tmpdir(), "artemis-pack-"));
  roots.push(root);
  const path = join(root, "offline.zip");
  await writeFile(path, archive);
  const native = vi.fn(async () => undefined);
  let users: string[] = [];
  const download = vi.fn(async () => new Response(archive));
  const service = new CapabilityPackService({
    ...target,
    root: join(root, "packs"),
    verifyNative: native,
    dependents: async () => users,
    fetch: download,
  });
  return {
    root,
    path,
    service,
    native,
    download,
    manifest: signed(archive),
    setUsers: (next: string[]) => {
      users = next;
    },
  };
}

function offlinePack(manifest: unknown, archive = zip()): Buffer {
  const json = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(12);
  header.write("ARTOFF1\n");
  header.writeUInt32BE(json.length, 8);
  return Buffer.concat([header, json, archive]);
}

describe("host capability packs", () => {
  it("verifies publisher, target, host range and immutable release URL before I/O", () => {
    const valid = signed(zip());
    expect(verifyCapabilityManifest(valid, target).version).toBe("1.0.0");
    expect(() =>
      verifyCapabilityManifest({ ...valid, hostRange: "*" }, target),
    ).toThrow("signature");
    expect(() =>
      verifyCapabilityManifest(valid, { ...target, publicKeys: {} }),
    ).toThrow("Untrusted");
    expect(() =>
      verifyCapabilityManifest(valid, {
        ...target,
        platform: "win32",
        arch: "x64",
      }),
    ).toThrow("platform");
    expect(() =>
      verifyCapabilityManifest(valid, { ...target, hostVersion: "2.0.0" }),
    ).toThrow("incompatible");
    expect(() =>
      verifyCapabilityManifest(
        signed(zip(), {
          archive: {
            ...valid.archive,
            url: "https://github.com/EurekaRaider/ArtemisRelease/releases/latest/download/mac.zip",
          },
        }),
        target,
      ),
    ).toThrow();
  });
  it("accepts an explicitly unsigned Windows binary only inside the signed inventory", () => {
    const manifest = signed(zip(), {
      platform: "win32",
      arch: "x64",
      native: {
        signer: "inventory",
        notarization: "not-applicable",
        windows: [{ path: "runtime/bridge", signer: null }],
      },
    });
    const windows = { ...target, platform: "win32", arch: "x64" };
    expect(
      verifyCapabilityManifest(manifest, windows).native.windows?.[0]?.signer,
    ).toBeNull();
    expect(() =>
      verifyCapabilityManifest(
        { ...manifest, native: { ...manifest.native, windows: [] } },
        windows,
      ),
    ).toThrow();
    expect(() =>
      verifyCapabilityManifest(
        signed(zip(), {
          platform: "win32",
          arch: "x64",
          native: {
            signer: "inventory",
            notarization: "not-applicable",
            windows: [{ path: "runtime/other.exe", signer: null }],
          },
        }),
        windows,
      ),
    ).toThrow();
  });
  it("installs offline through the same verifier and reuses the verified cache", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    await f.service.install(f.manifest);
    expect(f.download).not.toHaveBeenCalled();
    const lease = await f.service.acquire();
    expect(await readFile(join(lease.root, "runtime/bridge"), "utf8")).toBe(
      "native test fixture",
    );
    expect(f.native).toHaveBeenCalled();
    lease.release();
  });
  it("installs a signed online release without asking for local files", async () => {
    const f = await fixture();
    await f.service.install(f.manifest);
    expect(f.download).toHaveBeenCalledWith(f.manifest.archive.url, {
      signal: expect.any(AbortSignal),
      redirect: "follow",
    });
    expect(f.native).toHaveBeenCalledOnce();
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
  });
  it("imports one offline pack with an embedded signed manifest without a download", async () => {
    const f = await fixture();
    await writeFile(f.path, offlinePack(f.manifest));
    await f.service.installOffline(f.path);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.native).toHaveBeenCalledOnce();
    const lease = await f.service.acquire();
    expect(await readFile(join(lease.root, "runtime/bridge"), "utf8")).toBe(
      "native test fixture",
    );
    lease.release();
  });
  it.each(["signature", "untrusted", "platform"])(
    "rejects an offline pack with an invalid %s before installing",
    async (kind) => {
      const f = await fixture();
      const manifest =
        kind === "signature"
          ? { ...f.manifest, hostRange: "*" }
          : kind === "untrusted"
            ? {
                ...f.manifest,
                signature: { ...f.manifest.signature, keyId: "unknown" },
              }
            : signed(zip(), { arch: "x64" });
      await writeFile(f.path, offlinePack(manifest));
      await expect(f.service.installOffline(f.path)).rejects.toThrow();
      expect(f.native).not.toHaveBeenCalled();
      expect(f.download).not.toHaveBeenCalled();
      expect((await f.service.status()).versions).toEqual([]);
    },
  );
  it.each(["header", "length", "truncated", "trailing", "digest"])(
    "rejects offline pack %s corruption and retains the active installation",
    async (kind) => {
      const f = await fixture();
      await f.service.install(f.manifest, f.path);
      const next = signed(zip(), { version: "1.0.1" });
      let pack = offlinePack(next);
      if (kind === "header") pack[0] = 0;
      if (kind === "length") pack.writeUInt32BE(16 * 1024 * 1024 + 1, 8);
      if (kind === "truncated") pack = pack.subarray(0, pack.length - 1);
      if (kind === "trailing") pack = Buffer.concat([pack, Buffer.from([0])]);
      if (kind === "digest") pack[pack.length - 1] ^= 1;
      await writeFile(f.path, pack);
      await expect(f.service.installOffline(f.path)).rejects.toThrow();
      expect((await f.service.status()).activeVersion).toBe("1.0.0");
      expect((await f.service.status()).versions).toHaveLength(1);
    },
  );
  it("rejects corruption without activating a partial install", async () => {
    const f = await fixture();
    await writeFile(f.path, Buffer.alloc(f.manifest.archive.downloadBytes));
    await expect(f.service.install(f.manifest, f.path)).rejects.toThrow(
      "digest",
    );
    expect((await f.service.status()).activeVersion).toBeUndefined();
  });
  it.each([
    "../escape",
    "runtime/../../escape",
    "C:/escape",
    "runtime\\escape",
  ])("rejects ZIP traversal %s even in a signed archive", async (path) => {
    const f = await fixture(zip(path));
    await expect(f.service.install(f.manifest, f.path)).rejects.toThrow();
    expect(f.native).not.toHaveBeenCalled();
  });
  it("rejects symlinks and file inventory substitution", async () => {
    const link = await fixture(
      zip("runtime/bridge", Buffer.from("native test fixture"), 0o120777),
    );
    await expect(
      link.service.install(link.manifest, link.path),
    ).rejects.toThrow("type");
    const wrong = await fixture(zip("runtime/other"));
    await expect(
      wrong.service.install(wrong.manifest, wrong.path),
    ).rejects.toThrow("inventory");
  });
  it("explicitly uninstalls a shared optional pack and returns plugins to Lite", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    f.setUsers(["Documents", "Presentations", "Spreadsheets"]);
    await f.service.uninstall("1.0.0");
    expect((await f.service.status()).activeVersion).toBeUndefined();
    expect((await f.service.status()).versions).toEqual([]);
    await expect(f.service.acquire()).rejects.toThrow("Lite");
    await expect(
      readFile(
        join(
          f.root,
          "packs",
          "office-core",
          "1.0.0",
          "payload",
          "runtime/bridge",
        ),
      ),
    ).rejects.toThrow();
  });
  it("retains a shared pack while a document uses it, then allows removal after release", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    f.setUsers(["Documents", "Presentations", "Spreadsheets"]);
    const lease = await f.service.acquire();
    await expect(f.service.uninstall("1.0.0")).rejects.toThrow("in use");
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
    lease.release();
    lease.release();
    await f.service.uninstall("1.0.0");
    expect((await f.service.status()).activeVersion).toBeUndefined();
  });
  it("repairs modified files only when no session uses them", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    const lease = await f.service.acquire();
    await writeFile(join(lease.root, "runtime/bridge"), "tampered");
    await expect(f.service.install(f.manifest, f.path)).rejects.toThrow(
      "repair",
    );
    lease.release();
    await f.service.install(f.manifest, f.path);
    const repaired = await f.service.acquire();
    repaired.release();
  });
  it("repairs a damaged receipt only after the last session releases it", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    const lease = await f.service.acquire();
    await writeFile(
      join(f.root, "packs/office-core/1.0.0/manifest.json"),
      "{broken",
    );
    await expect(f.service.install(f.manifest, f.path)).rejects.toThrow(
      "in use",
    );
    lease.release();
    await f.service.install(f.manifest, f.path);
    const repaired = await f.service.acquire();
    repaired.release();
  });
  it("can reinstall after a torn activation receipt without trusting it", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    await writeFile(join(f.root, "packs/active.json"), "{broken");
    expect((await f.service.status()).activeVersion).toBeUndefined();
    await expect(f.service.acquire()).rejects.toThrow("not installed");
    await f.service.install(f.manifest, f.path);
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
  });
  it("rejects unsigned extra executables in an installed payload", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    await writeFile(
      join(f.root, "packs/office-core/1.0.0/payload/runtime/injected.dylib"),
      "unsigned",
    );
    await expect(f.service.acquire()).rejects.toThrow("inventory");
  });
  it("recovers a lock left by an exited host", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    await writeFile(
      join(f.root, "packs/.install.lock"),
      JSON.stringify({ pid: 2147483647, token: "old" }),
    );
    await f.service.install(f.manifest, f.path);
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
  });
  it("serializes duplicate installs and lets a cancelled download retry", async () => {
    const f = await fixture();
    const pending = f.service.install(f.manifest, f.path);
    await expect(f.service.install(f.manifest, f.path)).rejects.toThrow(
      "already running",
    );
    f.service.cancel();
    await expect(pending).rejects.toThrow("cancelled");
    await f.service.install(f.manifest, f.path);
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
  });
});

/** Software-pack (no native engine) fixtures: signed multi-file inventory. */
const RELEASE_HOST =
  "https://github.com/EurekaRaider/ArtemisRelease/releases/download/";

function zipEntries(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const text = Buffer.from(name);
    const compressed = deflateRawSync(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(text.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc32(bytes), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(text.length, 28);
    directory.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    parts.push(header, text, compressed);
    centrals.push(directory, text);
    offset += header.length + text.length + compressed.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...centrals, end]);
}

const DESIGN_FILES = [
  {
    name: "artemis.plugin.json",
    bytes: Buffer.from('{"id":"artemis-design"}'),
  },
  { name: "panel/index.html", bytes: Buffer.from("<html>panel</html>") },
  { name: "runtime/index.mjs", bytes: Buffer.from("export {}") },
];

function signedSoftware(
  archive: Buffer,
  files: Array<{ name: string; bytes: Buffer }>,
  overrides: Record<string, unknown> = {},
): CapabilityPackManifest {
  const version =
    typeof overrides.version === "string" ? overrides.version : "0.1.0";
  const unpacked = files.reduce((sum, file) => sum + file.bytes.length, 0);
  const data = {
    schemaVersion: 1,
    id: "artemis-design",
    version,
    hostRange: ">=1.6.8 <2",
    platform: "darwin",
    arch: "arm64",
    sourceDigest: sha("source"),
    archive: {
      url: `${RELEASE_HOST}artemis-design-v${version}/pack.zip`,
      sha256: sha(archive),
      downloadBytes: archive.length,
      unpackedBytes: unpacked,
    },
    files: files.map((file) => ({
      path: file.name,
      sha256: sha(file.bytes),
      bytes: file.bytes.length,
      executable: false,
    })),
    ...overrides,
  };
  return {
    ...data,
    signature: {
      keyId: "test",
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(data)),
        keys.privateKey,
      ).toString("base64"),
    },
  } as CapabilityPackManifest;
}

describe("software capability packs (multi-pack namespaces)", () => {
  it("downloads and installs a design pack into its own namespace", async () => {
    const archive = zipEntries(DESIGN_FILES);
    const f = await fixture(zip());
    const design = new CapabilityPackService({
      ...target,
      root: join(f.root, "packs"),
      packId: "artemis-design",
      verifyNative: vi.fn(async () => undefined),
      dependents: async () => [],
      fetch: vi.fn(async () => new Response(archive)),
    });
    await design.install(
      signedSoftware(archive, DESIGN_FILES, { version: "0.2.0" }),
    );
    const status = await design.status();
    expect(status.id).toBe("artemis-design");
    expect(status.activeVersion).toBe("0.2.0");
    expect(status.versions.map((entry) => entry.version)).toEqual(["0.2.0"]);
    const lease = await design.acquire();
    expect(lease.root).toContain(join("artemis-design", "0.2.0", "payload"));
    expect(
      await readFile(join(lease.root, "artemis.plugin.json"), "utf8"),
    ).toContain("artemis-design");
    lease.release();
    // The pointer file holds one entry per pack.
    const pointer = JSON.parse(
      await readFile(join(f.root, "packs/active.json"), "utf8"),
    );
    expect(pointer.packs["artemis-design"]).toBe("0.2.0");
  });

  it("keeps pack namespaces isolated and never writes foreign pointers", async () => {
    const f = await fixture(zip());
    await f.service.install(f.manifest, f.path);
    const archive = zipEntries(DESIGN_FILES);
    const design = new CapabilityPackService({
      ...target,
      root: join(f.root, "packs"),
      packId: "artemis-design",
      verifyNative: vi.fn(async () => undefined),
      dependents: async () => [],
      fetch: vi.fn(async () => new Response(archive)),
    });
    await design.install(signedSoftware(archive, DESIGN_FILES));
    // Each service lists only its own pack.
    const office = await f.service.status();
    expect(office.id).toBe("office-core");
    expect(office.versions.map((entry) => entry.version)).toEqual(["1.0.0"]);
    const designStatus = await design.status();
    expect(designStatus.versions.map((entry) => entry.version)).toEqual([
      "0.1.0",
    ]);
    // Pointer map carries both entries.
    const pointer = JSON.parse(
      await readFile(join(f.root, "packs/active.json"), "utf8"),
    );
    expect(pointer.packs).toEqual({
      "office-core": "1.0.0",
      "artemis-design": "0.1.0",
    });
    // Deactivating the design pack leaves the office pointer intact.
    await design.deactivate();
    const after = JSON.parse(
      await readFile(join(f.root, "packs/active.json"), "utf8"),
    );
    expect(after.packs).toEqual({ "office-core": "1.0.0" });
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
  });

  it("reads the legacy single-version pointer for office-core only and migrates it on write", async () => {
    const f = await fixture(zip());
    await f.service.install(f.manifest, f.path);
    await writeFile(join(f.root, "packs/active.json"), '{"version":"1.0.0"}');
    expect((await f.service.status()).activeVersion).toBe("1.0.0");
    const archive = zipEntries(DESIGN_FILES);
    const design = new CapabilityPackService({
      ...target,
      root: join(f.root, "packs"),
      packId: "artemis-design",
      verifyNative: vi.fn(async () => undefined),
      dependents: async () => [],
      fetch: vi.fn(async () => new Response(archive)),
    });
    // A non-office pack ignores the legacy pointer.
    expect(await design.status().then((s) => s.activeVersion)).toBeUndefined();
    await design.install(signedSoftware(archive, DESIGN_FILES));
    // The office entry survived the migration into the map form.
    const pointer = JSON.parse(
      await readFile(join(f.root, "packs/active.json"), "utf8"),
    );
    expect(pointer.packs).toEqual({
      "office-core": "1.0.0",
      "artemis-design": "0.1.0",
    });
  });

  it("rejects a software-shaped manifest claiming the reserved office-core id", () => {
    const archive = zipEntries(DESIGN_FILES);
    const manifest = signedSoftware(archive, DESIGN_FILES, {
      id: "office-core",
      version: "9.9.9",
    });
    // Neither union branch accepts it: office-core demands the native-engine
    // shape, software packs refuse the reserved id.
    expect(() => verifyCapabilityManifest(manifest, target)).toThrow();
  });
});
