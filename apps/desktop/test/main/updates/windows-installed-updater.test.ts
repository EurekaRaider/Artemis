import { afterEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsInstalledUpdater } from "../../../src/main/updates/windows-installed-updater.js";
import { canonicalUpdatePayload } from "../../../src/main/updates/signed-update-index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const key = generateKeyPairSync("ed25519");
const keys = {
  test: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const installer = Buffer.from("verified installer fixture");
function signed(version = "2.0.0", sequence = 2) {
  const payload = {
    version,
    sequence,
    platform: "win32",
    arch: "x64",
    distribution: "nsis",
    minUpdaterVersion: 1,
    assets: [
      {
        name: `Artemis-Windows-x64-${version}.exe`,
        size: installer.length,
        sha256: createHash("sha256").update(installer).digest("hex"),
      },
    ],
  };
  return JSON.stringify({
    schemaVersion: 1,
    keyId: "test",
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalUpdatePayload(payload)),
      key.privateKey,
    ).toString("base64"),
  });
}
async function fixture(fetcher: typeof fetch) {
  const userData = await mkdtemp(join(tmpdir(), "artemis-installed-update-"));
  roots.push(userData);
  const quit = vi.fn();
  const service = new WindowsInstalledUpdater({
    currentVersion: "1.0.0",
    userData,
    keys,
    executable: join(userData, "Artemis.exe"),
    helperPath: join(userData, "helper.ps1"),
    fetcher,
    onStatus: () => {},
    prepareToQuit: async () => {},
    quit,
  });
  await service.initialize();
  return { service, userData, quit };
}
it("discovers through the Windows index, verifies bytes and coalesces concurrent downloads", async () => {
  const fetcher = vi.fn(
    async (input: Parameters<typeof fetch>[0]) =>
      new Response(String(input).endsWith(".json") ? signed() : installer),
  );
  const { service, userData } = await fixture(fetcher);
  expect((await service.check()).state).toBe("available");
  const first = service.download(),
    second = service.download();
  expect(first).toBe(second);
  expect((await first).state).toBe("downloaded");
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith(".exe")),
  ).toHaveLength(1);
  expect(fetcher.mock.calls[0]![0]).toContain("windows-x64-stable");
  expect(
    await readFile(
      join(userData, "windows-update", "Artemis-Windows-x64-2.0.0.exe"),
    ),
  ).toEqual(installer);
});
it("rejects corrupt downloads without entering installable state or leaving partial files", async () => {
  const { service, userData, quit } = await fixture(
    async (input) =>
      new Response(String(input).endsWith(".json") ? signed() : "tampered"),
  );
  await service.check();
  await expect(service.download()).rejects.toThrow("integrity");
  expect(service.getStatus().state).toBe("error");
  await expect(service.install()).rejects.toThrow("No verified installer");
  expect(quit).not.toHaveBeenCalled();
  await expect(
    readFile(
      join(userData, "windows-update", "Artemis-Windows-x64-2.0.0.exe.partial"),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("persists replay protection across restarts and quarantines failed versions", async () => {
  const { service, userData } = await fixture(
    async () => new Response(signed()),
  );
  await service.check();
  const state = join(userData, "windows-update", "recovery.json");
  expect(JSON.parse(await readFile(state, "utf8")).sequence).toBe(2);
  await writeFile(state, JSON.stringify({ sequence: 3 }));
  await service.initialize();
  expect((await service.check()).message).toContain("replay");
  await writeFile(
    state,
    JSON.stringify({ sequence: 2, quarantined: ["2.0.0"] }),
  );
  await service.initialize();
  expect((await service.check()).message).toContain("health check");
  await expect(service.download()).rejects.toThrow("No update");
});
it("requires a verified previous version before attempting installation", async () => {
  const { service, quit } = await fixture(
    async (input) =>
      new Response(String(input).endsWith(".json") ? signed() : installer),
  );
  await service.check();
  await service.download();
  await expect(service.install()).rejects.toThrow("Rollback version mismatch");
  expect(quit).not.toHaveBeenCalled();
});
