import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalCapabilityJson,
  type ComputerUsePackManifest,
} from "@artemis/protocol";
import { zipEntries } from "../../../../../scripts/design-pack/pack.mjs";
import {
  ComputerUseRuntime,
  computerUsePlatformSupported,
  computerUseVerificationCatalog,
} from "../../../src/main/computer-use/runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const key = generateKeyPairSync("ed25519");
const publicKeys = {
  test: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const sha = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
function release(version: string) {
  const entrypoint =
    "ArtemisComputerUse.app/Contents/MacOS/artemis-computer-use";
  const entries = [
    {
      name: entrypoint,
      bytes: Buffer.from("native-" + version),
      executable: true,
    },
    {
      name: "plugin/artemis.plugin.json",
      bytes: Buffer.from(JSON.stringify({ name: "computer-use", version })),
      executable: false,
    },
  ];
  const archive = zipEntries(entries);
  const unsigned = {
    schemaVersion: 1,
    id: "computer-use",
    version,
    hostRange: ">=1.7.5 <2",
    platform: "darwin",
    arch: "arm64",
    minimumOS: "14",
    helperProtocol: 1,
    entrypoint,
    pluginRoot: "plugin",
    sourceDigest: sha("source"),
    archive: {
      url:
        "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v" +
        version +
        "/mac.zip",
      sha256: sha(archive),
      downloadBytes: archive.length,
      unpackedBytes: entries.reduce(
        (total, entry) => total + entry.bytes.length,
        0,
      ),
    },
    files: entries.map((entry) => ({
      path: entry.name,
      bytes: entry.bytes.length,
      sha256: sha(entry.bytes),
      executable: entry.executable,
    })),
    native: { signer: "TEST", notarization: "accepted-stapled" },
  };
  const manifest = {
    ...unsigned,
    signature: {
      keyId: "test",
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(unsigned)),
        key.privateKey,
      ).toString("base64"),
    },
  } as ComputerUsePackManifest;
  return { archive, manifest };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "computer-runtime-"));
  roots.push(root);
  let candidate = release("1.2.0"),
    busy = false;
  const commitPlugin = vi.fn(async () => {});
  const probe = vi.fn(async () => {});
  const options = {
    userData: root,
    platform: "darwin" as const,
    arch: "arm64",
    osRelease: "23.0.0",
    hostVersion: "1.7.5",
    catalog: {
      schemaVersion: 1 as const,
      publicKeys,
      manifests: [],
      updateUrl: "https://example.test/catalog.json",
    },
    fetch: vi.fn(async (url: unknown) =>
      String(url).endsWith("catalog.json")
        ? Response.json({ schemaVersion: 1, manifests: [candidate.manifest] })
        : new Response(candidate.archive),
    ),
    busy: () => busy,
    commitPlugin,
    probe,
    verifyNative: vi.fn(async () => {}),
    stopHelper: vi.fn(async () => {}),
  };
  const runtime = new ComputerUseRuntime(options);
  return {
    runtime,
    root,
    options,
    probe,
    commitPlugin,
    next: (version: string) => {
      candidate = release(version);
    },
    busy: (value: boolean) => {
      busy = value;
    },
  };
}
it("restricts the first release to macOS 14 arm64 and Windows 11 x64", () => {
  expect(computerUsePlatformSupported("darwin", "arm64", "23.0.0")).toBe(true);
  expect(computerUsePlatformSupported("darwin", "x64", "23.0.0")).toBe(false);
  expect(computerUsePlatformSupported("darwin", "arm64", "22.0.0")).toBe(false);
  expect(computerUsePlatformSupported("win32", "x64", "10.0.22000")).toBe(true);
  expect(computerUsePlatformSupported("win32", "x64", "10.0.19045")).toBe(
    false,
  );
  expect(computerUsePlatformSupported("linux", "x64", "6.0.0")).toBe(false);
});
it("commits the plugin only after verification and a successful handshake probe", async () => {
  const f = await fixture();
  f.probe.mockImplementationOnce(async () => {
    expect(f.commitPlugin).not.toHaveBeenCalled();
    expect((await f.runtime.status()).activeVersion).toBeUndefined();
  });
  await f.runtime.ensure();
  expect(f.commitPlugin).toHaveBeenCalledWith(
    expect.stringContaining("plugin"),
    "1.2.0",
  );
  expect((await f.runtime.status()).activeVersion).toBe("1.2.0");
});
it("keeps running tasks on the old revision, then removes it after the last lease", async () => {
  const f = await fixture();
  await f.runtime.install();
  const old = await f.runtime.helper();
  f.busy(true);
  f.next("1.2.1");
  await f.runtime.install();
  expect(await f.runtime.status()).toMatchObject({
    activeVersion: "1.2.0",
    pendingVersion: "1.2.1",
  });
  expect(f.commitPlugin).toHaveBeenCalledTimes(1);
  f.busy(false);
  await f.runtime.finishUpdate();
  expect((await f.runtime.status()).versions).toHaveLength(2);
  old.release();
  await vi.waitFor(async () =>
    expect(
      (await f.runtime.status()).versions.map((version) => version.version),
    ).toEqual(["1.2.1"]),
  );
});
it("replays a prepared transaction after a host restart", async () => {
  const f = await fixture();
  await f.runtime.install();
  f.busy(true);
  f.next("1.2.1");
  await f.runtime.install();
  expect(
    JSON.parse(
      await readFile(join(f.root, "computer-use-transaction.json"), "utf8"),
    ).version,
  ).toBe("1.2.1");
  f.busy(false);
  const restarted = new ComputerUseRuntime(f.options);
  await restarted.initialize();
  expect(await restarted.status()).toMatchObject({ activeVersion: "1.2.1" });
  expect((await restarted.status()).pendingVersion).toBeUndefined();
});
it("restores the old active pointer on plugin configuration failure and supports retry", async () => {
  const f = await fixture();
  await f.runtime.install();
  f.next("1.2.1");
  f.commitPlugin.mockRejectedValueOnce(
    new Error("configuration commit failed"),
  );
  await expect(f.runtime.install()).rejects.toThrow(
    "configuration commit failed",
  );
  expect(await f.runtime.status()).toMatchObject({
    activeVersion: "1.2.0",
    pendingVersion: "1.2.1",
  });
  await f.runtime.finishUpdate();
  expect((await f.runtime.status()).activeVersion).toBe("1.2.1");
});
it("a failed initial commit does not leave an active runtime", async () => {
  const f = await fixture();
  f.commitPlugin.mockRejectedValueOnce(new Error("commit failed"));
  await expect(f.runtime.install()).rejects.toThrow("commit failed");
  expect((await f.runtime.status()).activeVersion).toBeUndefined();
  await f.runtime.finishUpdate();
  expect((await f.runtime.status()).activeVersion).toBe("1.2.0");
});
it("helper startup failure preserves the installed revision", async () => {
  const f = await fixture();
  await f.runtime.install();
  f.next("1.2.1");
  f.probe.mockRejectedValueOnce(new Error("invalid handshake"));
  await expect(f.runtime.install()).rejects.toThrow("invalid handshake");
  expect((await f.runtime.status()).activeVersion).toBe("1.2.0");
  expect(f.commitPlugin).toHaveBeenCalledTimes(1);
});
it("aborted first use never starts an installation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(f.runtime.ensure(controller.signal)).rejects.toThrow();
  expect(f.options.fetch).not.toHaveBeenCalled();
  expect(f.commitPlugin).not.toHaveBeenCalled();
});

it("tests an immutable official candidate without replacing pinned keys or the stable feed", () => {
  const catalog = {
    schemaVersion: 1 as const,
    publicKeys,
    manifests: [],
    updateUrl:
      "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-stable/catalog.json",
  };
  expect(computerUseVerificationCatalog(catalog)).toBe(catalog);
  const candidate = computerUseVerificationCatalog(catalog, "1.2.0");
  expect(candidate.updateUrl).toBe(
    "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v1.2.0/catalog.json",
  );
  expect(candidate.publicKeys).toBe(publicKeys);
  expect(catalog.updateUrl).toContain("computer-use-stable");
  for (const invalid of [
    "",
    "https://other.test/catalog.json",
    "1.2.0/../../../other",
    "1.2.0-beta",
    "1.2.0\n",
  ])
    expect(() => computerUseVerificationCatalog(catalog, invalid)).toThrow(
      /candidate version/,
    );
});
