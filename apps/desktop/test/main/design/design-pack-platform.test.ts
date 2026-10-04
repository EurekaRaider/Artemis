// PR #245 review (P2): the design pack's publish platform list
// (scripts/design-pack/build-design-pack.mjs) and the runtime's platform gate
// (design-plugin-thread-runtime.ts defaultProbe) must agree. First-version
// scope decision: darwin-arm64 only — the one platform with a signed pack
// manifest and a verified Seatbelt path. Publishing a platform whose runtime
// refuses to start (win32 before AppContainer lands; Intel macOS with no
// signed manifest) advertises installs that can never run.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultProbe } from "../../../src/main/design/design-plugin-thread-runtime.js";
import { DESIGN_PACK_PLATFORMS } from "../../../../../scripts/design-pack/build-design-pack.mjs";
import {
  inventoryTree,
  treeDigest,
  unsignedManifests,
  zipEntries,
} from "../../../../../scripts/design-pack/pack.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** defaultProbe reads process.platform/arch at call time; swap them
 * synchronously so the gate can be exercised for foreign hosts. */
function withPlatform<T>(platform: string, arch: string, run: () => T): T {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "arch", { value: arch });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  }
}

describe("design-pack first-version platform scope (darwin-arm64 and win32-x64)", () => {
  it("builds and publishes only supported desktop targets", () => {
    expect(DESIGN_PACK_PLATFORMS).toEqual([
      { platform: "darwin", arch: "arm64" },
      { platform: "win32", arch: "x64" },
    ]);
  });

  it("emits manifests exactly for the published platforms", async () => {
    const source = await mkdtemp(join(tmpdir(), "artemis-platform-src-"));
    roots.push(source);
    await writeFile(join(source, "runtime.mjs"), "export const seed = 1;\n");
    const files = await inventoryTree(source);
    const entries = files.map((file) => ({
      name: file.path,
      bytes: Buffer.from("export const seed = 1;\n"),
      executable: file.executable,
    }));
    const archive = zipEntries(entries);
    const unsigned = unsignedManifests({
      id: "artemis-design",
      version: "0.2.0",
      hostRange: ">=1.6.18 <2",
      files,
      sourceDigest: treeDigest(files),
      archive: {
        sha256: createHash("sha256").update(archive).digest("hex"),
        downloadBytes: archive.length,
      },
      platforms: DESIGN_PACK_PLATFORMS,
    });
    expect(unsigned).toHaveLength(2);
    expect(unsigned[0]?.platform).toBe("darwin");
    expect(unsigned[0]?.arch).toBe("arm64");
    expect(unsigned[0]?.archive.url).toContain(
      "/artemis-design-v0.2.0/artemis-design-darwin-arm64.zip",
    );
  });

  it("Windows refuses startup without the packaged helper", () => {
    const probe = withPlatform("win32", "x64", () => defaultProbe());
    expect(probe).toEqual({
      ok: false,
      reason: "Windows AppContainer helper is unavailable",
    });
  });

  it("Windows recognizes an available helper before the real handshake", () => {
    const probe = withPlatform("win32", "x64", () =>
      defaultProbe(import.meta.filename),
    );
    expect(probe).toEqual({ ok: true, implementation: "windows-appcontainer" });
  });

  it("runtime refuses darwin-x64 — no signed Intel manifest exists", () => {
    const probe = withPlatform("darwin", "x64", () => defaultProbe());
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.reason).toContain("not yet supported");
  });
});
