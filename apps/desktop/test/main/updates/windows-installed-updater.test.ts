import { afterEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  WindowsInstalledUpdater,
  type WindowsInstalledUpdaterOptions,
} from "../../../src/main/updates/windows-installed-updater.js";
import { canonicalUpdatePayload } from "../../../src/main/updates/signed-update-index.js";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(spawn).mockReset();
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
async function fixture(
  fetcher: typeof fetch,
  options: Partial<WindowsInstalledUpdaterOptions> = {},
) {
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
    ...options,
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
  expect(service.getStatus()).toMatchObject({
    state: "downloaded",
    message: "Rollback version mismatch",
  });
  expect(quit).not.toHaveBeenCalled();
});

const installationFetcher: typeof fetch = async (input) =>
  new Response(
    String(input).endsWith(".json")
      ? signed(String(input).includes("v1.0.0/") ? "1.0.0" : "2.0.0")
      : installer,
  );

it("keeps preparation failures visible and clears them when installation is retried", async () => {
  const prepareToQuit = vi
    .fn()
    .mockRejectedValue(new Error("Unsaved document"));
  const cancelPreparation = vi.fn();
  const onStatus = vi.fn();
  const { service, quit } = await fixture(installationFetcher, {
    prepareToQuit,
    cancelPreparation,
    onStatus,
  });
  await service.check();
  await service.download();
  await expect(service.install()).rejects.toThrow("Unsaved document");
  expect(onStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({
      state: "downloaded",
      message: "Unsaved document",
    }),
  );
  expect(cancelPreparation).toHaveBeenCalledOnce();
  expect(quit).not.toHaveBeenCalled();
  prepareToQuit.mockImplementationOnce(async () => {
    expect(service.getStatus().message).toBe("");
    throw new Error("Still unsaved");
  });
  await expect(service.install()).rejects.toThrow("Still unsaved");
  expect(service.getStatus().message).toBe("Still unsaved");
});

it("reports recovery helper failures, cancels the transaction, and permits a verified retry", async () => {
  const cancelPreparation = vi.fn();
  const { service, userData, quit } = await fixture(installationFetcher, {
    cancelPreparation,
  });
  const database = new DatabaseSync(join(userData, "artemis.sqlite"));
  database.exec(
    "CREATE TABLE records(value TEXT); INSERT INTO records VALUES('preserved')",
  );
  database.close();
  await writeFile(join(userData, "helper.ps1"), "# fixture");
  await writeFile(join(userData, "windows-install-recover.cjs"), "// fixture");
  for (const name of [
    "Artemis.exe",
    "icudtl.dat",
    "snapshot_blob.bin",
    "v8_context_snapshot.bin",
  ]) {
    await writeFile(join(userData, name), name);
  }
  await service.check();
  await service.download();
  const root = join(userData, "windows-update");
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementationOnce(() => {
    void writeFile(join(root, "helper.log"), "Installer hash mismatch").then(
      () => {
        child.emit("spawn");
        child.emit("exit", 1);
      },
    );
    return child as unknown as ReturnType<typeof spawn>;
  });
  await expect(service.install()).rejects.toThrow("Installer hash mismatch");
  expect(service.getStatus()).toMatchObject({
    state: "downloaded",
    message: expect.stringContaining("Installer hash mismatch"),
  });
  expect(quit).not.toHaveBeenCalled();
  expect(cancelPreparation).toHaveBeenCalledOnce();
  expect(await readFile(join(root, "cancel.marker"), "utf8")).toBe("cancelled");
  expect(
    JSON.parse(await readFile(join(root, "recovery.json"), "utf8")).pending,
  ).toBeUndefined();
  const retryChild = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementationOnce(() => {
    void writeFile(join(root, "helper-ready.marker"), "2.0.0").then(() => {
      retryChild.emit("spawn");
    });
    return retryChild as unknown as ReturnType<typeof spawn>;
  });
  const first = service.install();
  expect(service.install()).toBe(first);
  await first;
  expect(spawn).toHaveBeenLastCalledWith(
    join(root, "helper-runtime", "update-recovery.exe"),
    [
      join(root, "launch-recovery.cjs"),
      join(root, "install-and-recover.ps1"),
      join(root, "recovery.json"),
    ],
    expect.objectContaining({
      detached: true,
      windowsHide: true,
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
    }),
  );
  expect(quit).toHaveBeenCalledOnce();
  expect(
    await readFile(join(root, "helper-runtime", "update-recovery.exe"), "utf8"),
  ).toBe("Artemis.exe");
  expect(service.getStatus().message).toBe("");
  expect(
    JSON.parse(await readFile(join(root, "recovery.json"), "utf8")).pending
      .version,
  ).toBe("2.0.0");
  const restored = new DatabaseSync(join(root, "pre-update.sqlite"));
  expect(restored.prepare("SELECT value FROM records").get()?.value).toBe(
    "preserved",
  );
  restored.close();
});
