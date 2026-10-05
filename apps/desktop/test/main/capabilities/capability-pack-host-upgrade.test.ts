import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCapabilityPackForHostUpgrade } from "../../../src/main/capabilities/capability-pack-host-upgrade.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe.each(["artemis-design", "office-core"] as const)("%s", (packId) => {
  async function fixture(previous?: string, active?: string) {
    const root = await mkdtemp(join(tmpdir(), "design-host-upgrade-"));
    roots.push(root);
    await mkdir(join(root, "capability-packs"));
    await writeFile(
      join(root, "capability-packs", "active.json"),
      JSON.stringify({ packs: active ? { [packId]: active } : {} }),
    );
    if (previous)
      await writeFile(
        join(root, `${packId}-host-version.json`),
        JSON.stringify({ hostVersion: previous }),
      );
    const manifest = { version: "0.3.0" };
    const install = vi.fn(async () => {});
    const check = vi.fn(async () => {});
    const status = vi.fn(() => ({ updateCheck: "checked" }));
    const available = vi.fn(() => manifest);
    const runtime = {
      packs: { install },
      updates: { check, status, available },
    } as unknown as Parameters<typeof updateCapabilityPackForHostUpgrade>[0];
    return { root, runtime, install, check, status, available, manifest };
  }
  it.each(["1.7.0", undefined])(
    "updates an active pack on host upgrade from %s, only once",
    async (previous) => {
      const f = await fixture(previous, "0.2.0");
      await updateCapabilityPackForHostUpgrade(
        f.runtime,
        f.root,
        "1.8.0",
        packId,
      );
      expect(f.install).toHaveBeenCalledWith(f.manifest);
      await updateCapabilityPackForHostUpgrade(
        f.runtime,
        f.root,
        "1.8.0",
        packId,
      );
      expect(f.check).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["1.8.0", "1.9.0"])(
    "does not update for an unchanged or rolled-back host %s",
    async (previous) => {
      const f = await fixture(previous, "0.2.0");
      await updateCapabilityPackForHostUpgrade(
        f.runtime,
        f.root,
        "1.8.0",
        packId,
      );
      expect(f.check).not.toHaveBeenCalled();
    },
  );
  it("does not reinstall a removed or disabled pack", async () => {
    const f = await fixture("1.7.0");
    await updateCapabilityPackForHostUpgrade(
      f.runtime,
      f.root,
      "1.8.0",
      packId,
    );
    expect(f.check).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });
  it("does not downgrade a newer installed plugin", async () => {
    const f = await fixture("1.7.0", "0.4.0");
    await updateCapabilityPackForHostUpgrade(
      f.runtime,
      f.root,
      "1.8.0",
      packId,
    );
    expect(f.install).not.toHaveBeenCalled();
  });
  it("leaves the upgrade pending after download failure and retries next launch", async () => {
    const f = await fixture("1.7.0", "0.2.0");
    f.install.mockRejectedValueOnce(new Error("offline"));
    await expect(
      updateCapabilityPackForHostUpgrade(f.runtime, f.root, "1.8.0", packId),
    ).rejects.toThrow("offline");
    expect(
      JSON.parse(
        await readFile(join(f.root, `${packId}-host-version.json`), "utf8"),
      ).hostVersion,
    ).toBe("1.7.0");
    await updateCapabilityPackForHostUpgrade(
      f.runtime,
      f.root,
      "1.8.0",
      packId,
    );
    expect(f.install).toHaveBeenCalledTimes(2);
  });
  it("keeps legacy Office activation compatible without activating Design", async () => {
    const f = await fixture("1.7.0");
    await writeFile(
      join(f.root, "capability-packs", "active.json"),
      JSON.stringify({ version: "0.2.0" }),
    );
    await updateCapabilityPackForHostUpgrade(
      f.runtime,
      f.root,
      "1.8.0",
      packId,
    );
    expect(f.install).toHaveBeenCalledTimes(packId === "office-core" ? 1 : 0);
  });
  it("does not mark a failed catalog check completed", async () => {
    const f = await fixture("1.7.0", "0.3.0");
    f.status.mockReturnValue({ updateCheck: "error" });
    await expect(
      updateCapabilityPackForHostUpgrade(f.runtime, f.root, "1.8.0", packId),
    ).rejects.toThrow("check failed");
    expect(f.install).not.toHaveBeenCalled();
  });
});
