import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthInteraction, CredentialStore } from "@earendil-works/pi-ai";
import { EncryptedSettingsStore } from "../../../src/main/settings/encrypted-settings-store.js";
import { ProviderLoginService } from "../../../src/main/settings/provider-login-service.js";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "artemis-auth-"));
  dirs.push(dir);
  const settings = new EncryptedSettingsStore(join(dir, "settings.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  });
  let credentials: CredentialStore;
  vi.spyOn(ModelRuntime, "create").mockImplementation(async (options) => {
    credentials = options!.credentials!;
    return {
      getProviders: () => [
        {
          id: "fixture",
          auth: { oauth: { name: "Fixture login", login: () => {} } },
        },
      ],
      login: async (
        id: string,
        _type: unknown,
        interaction: AuthInteraction,
      ) => {
        interaction.notify({
          type: "device_code",
          userCode: "ABCD",
          verificationUri: "https://example.test/login",
        });
        const secret = await interaction.prompt({
          type: "secret",
          message: "Enter test token",
        });
        const credential = {
          type: "oauth" as const,
          access: secret,
          refresh: "refresh",
          expires: Date.now() + 100000,
        };
        await credentials.modify(id, async () => credential);
        return credential;
      },
    } as unknown as ModelRuntime;
  });
  const changed = vi.fn(async () => {});
  return {
    settings,
    changed,
    service: new ProviderLoginService(settings, changed),
  };
}
it("requires an explicit current prompt answer and persists credentials outside the UI state", async () => {
  const { service, settings, changed } = await setup();
  const started = await service.start("fixture", "oauth");
  await vi.waitFor(() =>
    expect(service.status(started.id).prompt).toBeDefined(),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(() => service.answer(started.id, "stale", "SECRET")).toThrow(
    /expired/,
  );
  service.answer(started.id, service.status(started.id).prompt!.id, "SECRET");
  await vi.waitFor(() =>
    expect(service.status(started.id).status).toBe("completed"),
  );
  expect(JSON.stringify(service.status(started.id))).not.toContain("SECRET");
  expect(
    (await settings.runtimeConfiguration()).credentials.fixture,
  ).toMatchObject({ access: "SECRET" });
  expect(changed).toHaveBeenCalledOnce();
});
it("cancels a pending login without choosing an answer or storing credentials", async () => {
  const { service, settings } = await setup();
  const state = await service.start("fixture", "oauth");
  service.cancel(state.id);
  await vi.waitFor(() =>
    expect(service.status(state.id).status).toBe("cancelled"),
  );
  expect((await settings.runtimeConfiguration()).credentials).toEqual({});
});
it("rejects concurrent starts before model runtime initialization finishes", async () => {
  const { service } = await setup();
  const first = service.start("fixture", "oauth");
  await expect(service.start("fixture", "oauth")).rejects.toThrow(
    "Finish or cancel",
  );
  service.cancel((await first).id);
});
