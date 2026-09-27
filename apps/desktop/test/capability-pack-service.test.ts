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
  const data = {
    schemaVersion: 1,
    id: "office-core",
    version: "1.0.0",
    hostRange: ">=1.6.8 <2",
    platform: "darwin",
    arch: "arm64",
    sourceDigest: sha("source"),
    archive: {
      url: "https://github.com/EurekaRaider/ArtemisRelease/releases/download/office-runtime-v1.0.0/mac.zip",
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
  it("retains shared or running versions, and supports explicit removal after release", async () => {
    const f = await fixture();
    await f.service.install(f.manifest, f.path);
    f.setUsers(["Documents", "Presentations"]);
    await expect(f.service.uninstall("1.0.0")).rejects.toThrow("shared");
    f.setUsers([]);
    const lease = await f.service.acquire();
    await expect(f.service.uninstall("1.0.0")).rejects.toThrow("in use");
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
