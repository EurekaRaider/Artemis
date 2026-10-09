import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { computerHelperSource } from "../../../src/main/computer-use/helper-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it.each(["darwin", "win32"] as const)(
  "uses matching development helper and preview on %s without acquiring a release pack",
  async (platform) => {
    const appPath = await mkdtemp(join(tmpdir(), "computer-helper-"));
    roots.push(appPath);
    const root = join(appPath, "build/computer-use/development");
    await mkdir(root, { recursive: true });
    const name =
      platform === "win32"
        ? "artemis-computer-use.exe"
        : "artemis-computer-use";
    await writeFile(join(root, name), "fixture", { mode: 0o755 });
    await writeFile(join(root, "artemis-computer-preview.node"), "fixture");
    const release = vi.fn();
    const acquire = computerHelperSource(
      { isPackaged: false, appPath, platform },
      release,
    );
    expect(await acquire()).toMatchObject({
      path: join(root, name),
      previewPath: join(root, "artemis-computer-preview.node"),
    });
    expect(release).not.toHaveBeenCalled();
  },
);
it("never falls back to a local development binary in a packaged host", async () => {
  const release = vi.fn(async () => {
    throw new Error("Runtime signature invalid");
  });
  const acquire = computerHelperSource(
    { isPackaged: true, appPath: "/fixture", platform: "darwin" },
    release,
  );
  await expect(acquire()).rejects.toThrow("Runtime signature invalid");
  expect(release).toHaveBeenCalledOnce();
});
it("reports missing developer binaries without attempting a signed release helper", async () => {
  const release = vi.fn();
  const acquire = computerHelperSource(
    { isPackaged: false, appPath: "/missing-fixture", platform: "darwin" },
    release,
  );
  await expect(acquire()).rejects.toThrow(/development.*build/i);
  expect(release).not.toHaveBeenCalled();
});
