// PR #245 review (P1): the publish-side catalog merge must key manifests by
// id@version@platform@arch — a version-only key let the last-built platform
// overwrite its siblings, so the published catalog silently lost macOS.
// Covers the merge contract plus the post-publish install selection: the
// merged catalog is round-tripped through JSON exactly as hosted and read
// back by the real OfficeCapabilityUpdates (the consumer
// design-pack-runtime.ts wires to process.platform/arch). No network:
// OfficeCapabilityUpdates only fetches on check() with an updateUrl, and
// these catalogs carry none.
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "../src/main/office-capability-updates.js";
import { verifyCapabilityManifest } from "../src/main/capability-pack-service.js";
import {
  buildCatalog,
  inventoryTree,
  signManifest,
  treeDigest,
  unsignedManifests,
  zipEntries,
} from "../../../scripts/design-pack/pack.mjs";
import {
  manifestIdentity,
  mergeDesignCatalogs,
} from "../../../scripts/design-pack/publish-design-catalog.mjs";

const HOST_VERSION = "1.6.18";
const sha = (input: Buffer | string) =>
  createHash("sha256").update(input).digest("hex");
const DUAL_PLATFORMS = [
  { platform: "darwin", arch: "arm64" },
  { platform: "win32", arch: "x64" },
];

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A real signed release for one version: inventory a small source tree,
 * build the shared archive, and sign one manifest per platform — exactly
 * what build-design-pack.mjs produces (plus an optional per-platform digest
 * override to rehearse future platform-specific archives). */
async function buildRelease(options: {
  version: string;
  platforms?: Array<{ platform: string; arch: string }>;
  platformDigests?: Record<string, string>;
}) {
  const source = await mkdtemp(join(tmpdir(), "artemis-catalog-src-"));
  roots.push(source);
  await mkdir(join(source, "runtime"), { recursive: true });
  await writeFile(
    join(source, "artemis.plugin.json"),
    JSON.stringify({ id: "com.artemis.design", protocolVersion: 1 }),
  );
  await writeFile(
    join(source, "runtime/index.mjs"),
    `export const seed = ${JSON.stringify(options.version)};\n`,
  );
  const files = await inventoryTree(source);
  const entries = [];
  for (const file of files)
    entries.push({
      name: file.path,
      bytes: await readFile(join(source, file.path)),
      executable: file.executable,
    });
  const archive = zipEntries(entries);
  const unsigned = unsignedManifests({
    id: "artemis-design",
    version: options.version,
    hostRange: `>=${HOST_VERSION} <2`,
    files,
    sourceDigest: treeDigest(files),
    archive: { sha256: sha(archive), downloadBytes: archive.length },
    platforms: options.platforms ?? DUAL_PLATFORMS,
  }) as Array<Record<string, unknown>>;
  for (const item of unsigned) {
    const override =
      options.platformDigests?.[
        `${String(item.platform)}-${String(item.arch)}`
      ];
    if (override)
      item.archive = {
        ...(item.archive as Record<string, unknown>),
        sha256: override,
      };
  }
  const pair = generateKeyPairSync("ed25519");
  const keyId = "design-pack-test";
  const privateKeyPem = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKeyPem = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const manifests = unsigned.map((item) =>
    signManifest(item, { privateKeyPem, keyId }),
  );
  return {
    catalog: buildCatalog(manifests, publicKeyPem, keyId),
    manifests,
    publicKeyPem,
    keyId,
  };
}

/** The hosted-catalog default the publish script starts from. */
const emptyHosted = { schemaVersion: 1, publicKeys: {}, manifests: [] };

/** The app-side selector: same wiring design-pack-runtime.ts installs
 * (packId artemis-design over process.platform/arch). */
function selectFor(
  catalog: OfficeRuntimeCatalog,
  platform: string,
  arch: string,
) {
  return new OfficeCapabilityUpdates(catalog, {
    hostVersion: HOST_VERSION,
    platform,
    arch,
    packId: "artemis-design",
  }).available();
}

describe("design-pack catalog publish merge (id@version@platform@arch)", () => {
  it("keeps both darwin-arm64 and win32-x64 manifests of one version", async () => {
    // Prior publish left the darwin manifest hosted; the new build carries
    // both platforms over the same archive. The old version-only merge key
    // kept exactly one entry (win32 overwrote darwin); the identity key
    // must keep both.
    const darwinOnly = await buildRelease({
      version: "0.2.0",
      platforms: [{ platform: "darwin", arch: "arm64" }],
    });
    const dual = await buildRelease({ version: "0.2.0" });
    const darwinDigest = (
      darwinOnly.manifests[0] as { archive: { sha256: string } }
    ).archive.sha256;
    const dualDarwin = dual.manifests.find(
      (manifest) => manifest.platform === "darwin",
    ) as unknown as { archive: { sha256: string } };
    expect(dualDarwin.archive.sha256).toBe(darwinDigest);

    const merged = mergeDesignCatalogs(
      { ...emptyHosted, manifests: darwinOnly.catalog.manifests },
      dual.catalog,
    );
    expect(merged.manifests).toHaveLength(2);
    expect(
      merged.manifests.map((manifest) => manifest.platform).sort(),
    ).toEqual(["darwin", "win32"]);
    // Both survivors are the same pack at the same version — distinct only
    // by platform/arch, and each points at its own platform archive name.
    expect(
      new Set(merged.manifests.map((manifest) => manifest.version)),
    ).toEqual(new Set(["0.2.0"]));
    expect(merged.manifests.map((manifest) => manifest.id)).toEqual([
      "artemis-design",
      "artemis-design",
    ]);
    const darwinEntry = merged.manifests.find(
      (manifest) => manifest.platform === "darwin",
    ) as unknown as { archive: { url: string } };
    const win32Entry = merged.manifests.find(
      (manifest) => manifest.platform === "win32",
    ) as unknown as { archive: { url: string } };
    expect(darwinEntry.archive.url).toContain("darwin-arm64.zip");
    expect(win32Entry.archive.url).toContain("win32-x64.zip");
    // Public keys are unioned, not replaced.
    expect(merged.publicKeys).toEqual(dual.catalog.publicKeys);
  });

  it("republishing the same identity with an identical digest is idempotent", async () => {
    const dual = await buildRelease({ version: "0.2.0" });
    const first = mergeDesignCatalogs(emptyHosted, dual.catalog);
    const again = mergeDesignCatalogs(first, dual.catalog);
    expect(again).toEqual(first);
    expect(again.manifests).toHaveLength(2);
  });

  it("refuses the same identity republished with a different archive digest", async () => {
    const first = await buildRelease({ version: "0.2.0" });
    const rebuilt = await buildRelease({
      version: "0.2.0",
      platformDigests: {
        "darwin-arm64": `${"0".repeat(64)}`,
        "win32-x64": `${"0".repeat(64)}`,
      },
    });
    expect(() => mergeDesignCatalogs(first, rebuilt.catalog)).toThrow(
      /artemis-design@0\.2\.0@darwin@arm64 is already published with a different archive digest/u,
    );
  });

  it("coexists same-version platforms whose digests diverge without a false conflict", async () => {
    // Future platform-specific archives: darwin and win32 legitimately carry
    // different digests under one id@version. A version-only key with digest
    // comparison would misread this as an illegal republish.
    const hosted = await buildRelease({
      version: "0.2.0",
      platforms: [{ platform: "darwin", arch: "arm64" }],
    });
    const divergent = await buildRelease({
      version: "0.2.0",
      platformDigests: {
        "darwin-arm64": (hosted.manifests[0] as { archive: { sha256: string } })
          .archive.sha256,
        "win32-x64": "1".repeat(64),
      },
    });
    const merged = mergeDesignCatalogs(
      { ...emptyHosted, manifests: hosted.catalog.manifests },
      divergent.catalog,
    );
    expect(merged.manifests).toHaveLength(2);
    // Republishing the divergent pair stays idempotent.
    expect(mergeDesignCatalogs(merged, divergent.catalog)).toEqual(merged);
  });

  it("publishing a new version keeps the previous version's manifests", async () => {
    const v1 = await buildRelease({ version: "0.1.0" });
    const v2 = await buildRelease({ version: "0.2.0" });
    const merged = mergeDesignCatalogs(
      { ...emptyHosted, manifests: v1.catalog.manifests },
      v2.catalog,
    );
    expect(merged.manifests).toHaveLength(4);
    expect(
      new Set(merged.manifests.map((manifest) => manifest.version)),
    ).toEqual(new Set(["0.1.0", "0.2.0"]));
    expect(
      merged.manifests.map((manifest) => manifestIdentity(manifest)).sort(),
    ).toEqual(
      [
        "artemis-design@0.1.0@darwin@arm64",
        "artemis-design@0.1.0@win32@x64",
        "artemis-design@0.2.0@darwin@arm64",
        "artemis-design@0.2.0@win32@x64",
      ].sort(),
    );
  });
});

describe("post-publish install selection over the merged catalog (mocked)", () => {
  it("darwin-arm64 and win32-x64 hosts each select their own manifest", async () => {
    const hosted = await buildRelease({
      version: "0.2.0",
      platforms: [{ platform: "darwin", arch: "arm64" }],
    });
    const dual = await buildRelease({ version: "0.2.0" });
    const merged = mergeDesignCatalogs(
      { ...emptyHosted, manifests: hosted.catalog.manifests },
      dual.catalog,
    );
    // The hosted file is JSON; consume it exactly as the app reads it.
    const published = JSON.parse(
      JSON.stringify(merged),
    ) as OfficeRuntimeCatalog;
    // Structure: one id@version, two platform/arch entries preserved.
    expect(published.manifests).toHaveLength(2);
    expect(
      new Set(published.manifests.map((manifest) => manifest.version)),
    ).toEqual(new Set(["0.2.0"]));

    const onAppleSilicon = selectFor(published, "darwin", "arm64");
    expect(onAppleSilicon).toBeDefined();
    expect(onAppleSilicon?.platform).toBe("darwin");
    expect(onAppleSilicon?.arch).toBe("arm64");
    expect(onAppleSilicon?.archive.url).toContain("darwin-arm64.zip");

    const onWindows = selectFor(published, "win32", "x64");
    expect(onWindows).toBeDefined();
    expect(onWindows?.platform).toBe("win32");
    expect(onWindows?.arch).toBe("x64");
    expect(onWindows?.archive.url).toContain("win32-x64.zip");

    // Intel macOS: no signed darwin-x64 manifest exists, so the same host
    // update check finds nothing to offer.
    expect(selectFor(published, "darwin", "x64")).toBeUndefined();
  });

  it("install-time verification still refuses a platform-mismatched manifest", async () => {
    // verifyCapabilityManifest — the gate behind CapabilityPackService.install
    // — rejects a manifest whose platform/arch do not match the host, so a
    // mis-selected cross-platform manifest cannot install even if a future
    // selector regressed.
    const dual = await buildRelease({ version: "0.2.0" });
    const win32Manifest = dual.manifests.find(
      (manifest) => manifest.platform === "win32",
    );
    expect(() =>
      verifyCapabilityManifest(win32Manifest, {
        hostVersion: HOST_VERSION,
        platform: "darwin",
        arch: "arm64",
        publicKeys: { [dual.keyId]: dual.publicKeyPem },
      }),
    ).toThrow(/platform mismatch/u);
    expect(
      verifyCapabilityManifest(win32Manifest, {
        hostVersion: HOST_VERSION,
        platform: "win32",
        arch: "x64",
        publicKeys: { [dual.keyId]: dual.publicKeyPem },
      }).platform,
    ).toBe("win32");
  });
});
