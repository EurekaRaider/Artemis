import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { personalizeArtemisOpenRouter } from "../../src/models/openrouter-catalog.js";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "artemis-openrouter-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
const base = openrouterProvider();
const allowed = base.getModels()[0]!;
function response(ids = [allowed.id]) {
  return Response.json({
    data: ids.map((id) => ({
      id,
      context_length: 64_000,
      top_provider: { max_completion_tokens: 2048 },
      pricing: { prompt: "0.000002", completion: "0.000003" },
    })),
  });
}
it("uses Pi's per-key filtering, limits and prices with a regional endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetch);
  const root = await directory();
  const provider = await personalizeArtemisOpenRouter(
    { ...base, baseUrl: "https://us.openrouter.ai/api/v1" },
    { type: "api_key", key: "test-only-key" },
    root,
  );
  expect(provider?.getModels()).toHaveLength(1);
  expect(provider?.getModels()[0]).toMatchObject({
    id: allowed.id,
    contextWindow: 64_000,
    maxTokens: 2048,
    cost: { input: 2, output: 3 },
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://us.openrouter.ai/api/v1/models/user",
    expect.objectContaining({
      headers: expect.objectContaining({
        authorization: "Bearer test-only-key",
      }),
    }),
  );
  expect(
    provider?.getAllModels?.().filter((m) => m.type && m.type !== "chat"),
  ).toEqual(base.getAllModels?.().filter((m) => m.type && m.type !== "chat"));
  const cache = await readFile(join(root, (await readdir(root))[0]!), "utf8");
  expect(cache).not.toContain("test-only-key");
  vi.stubEnv("PI_OFFLINE", "1");
  fetch.mockClear();
  const restored = await personalizeArtemisOpenRouter(
    { ...base, baseUrl: "https://us.openrouter.ai/api/v1" },
    { type: "api_key", key: "test-only-key" },
    root,
  );
  expect(restored?.getModels()).toEqual(provider?.getModels());
  expect(fetch).not.toHaveBeenCalled();
  expect(
    await personalizeArtemisOpenRouter(
      base,
      { type: "api_key", key: "different-key" },
      root,
    ),
  ).toBeUndefined();
});
it("preserves an empty authorized catalog instead of restoring all models", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([])));
  const root = await directory();
  const credential = { type: "api_key" as const, key: "empty-key" };
  expect(
    (await personalizeArtemisOpenRouter(base, credential, root))?.getModels(),
  ).toEqual([]);
  vi.stubEnv("PI_OFFLINE", "1");
  expect(
    (await personalizeArtemisOpenRouter(base, credential, root))?.getModels(),
  ).toEqual([]);
});
it.each([401, 403, 404, 500])(
  "falls back safely for HTTP %i",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status })),
    );
    expect(
      await personalizeArtemisOpenRouter(
        base,
        { type: "api_key", key: "test" },
        await directory(),
      ),
    ).toBeUndefined();
  },
);
it("supports OAuth and isolates endpoint and credential changes", async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetch);
  const root = await directory();
  const credential = {
    type: "oauth" as const,
    access: "access-one",
    refresh: "refresh",
    expires: Date.now() + 3600000,
  };
  await personalizeArtemisOpenRouter(base, credential, root);
  await personalizeArtemisOpenRouter(
    base,
    { ...credential, access: "access-two" },
    root,
  );
  await personalizeArtemisOpenRouter(
    { ...base, baseUrl: "https://eu.openrouter.ai/api/v1" },
    credential,
    root,
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await readdir(root)).toHaveLength(3);
});
it("publishes the personalized catalog in Artemis and resets it after logout", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response()),
  );
  const root = await directory();
  const host = new ArtemisAgentHost(
    { async request() {} },
    { emit() {} },
    { agentDir: root },
  );
  cleanups.push(async () => host.dispose());
  await host.configure({
    credentials: { openrouter: { type: "api_key", key: "integration-key" } },
  });
  const catalog = await host.catalog();
  expect(catalog.authoritativeProviderIds).toEqual(["openrouter"]);
  expect(
    catalog.models.filter((m) => m.providerId === "openrouter"),
  ).toMatchObject([{ modelId: allowed.id, contextWindow: 64000 }]);
  await host.configure({ credentials: {} });
  expect((await host.catalog()).authoritativeProviderIds).toEqual([]);
  expect(
    (await host.catalog()).models.filter((m) => m.providerId === "openrouter")
      .length,
  ).toBeGreaterThan(1);
});

it("applies regional custom-provider limits to the runtime without resurrecting a blocked selection", async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetch);
  const root = await directory();
  const host = new ArtemisAgentHost(
    { async request() {} },
    { emit() {} },
    { agentDir: root },
  );
  cleanups.push(async () => host.dispose());
  const blocked = base.getModels()[1]!;
  const provider = {
    id: "openrouter",
    name: "Regional OpenRouter",
    baseUrl: "https://us.openrouter.ai/api/v1",
    models: [allowed, blocked].map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      input: m.input,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  };
  await host.configure({
    credentials: { openrouter: { type: "api_key", key: "custom-key" } },
    providers: [provider],
    selection: {
      providerId: "openrouter",
      modelId: blocked.id,
      thinkingLevel: "off",
    },
  });
  const catalog = await host.catalog();
  expect(catalog.selection).toBeUndefined();
  expect(catalog.authoritativeProviderIds).toEqual(["openrouter"]);
  expect(
    catalog.models.filter((m) => m.providerId === "openrouter"),
  ).toMatchObject([{ modelId: allowed.id, contextWindow: 64000 }]);
  expect(fetch).toHaveBeenCalledWith(
    "https://us.openrouter.ai/api/v1/models/user",
    expect.anything(),
  );
  fetch.mockImplementation(async () => response([blocked.id]));
  await host.configure({
    credentials: {
      openrouter: { type: "api_key", key: "different-custom-key" },
    },
    providers: [provider],
  });
  expect(
    (await host.catalog()).models
      .filter((m) => m.providerId === "openrouter")
      .map((m) => m.modelId),
  ).toEqual([blocked.id]);
});

it("ignores an older account's delayed catalog after a newer configuration", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  const second = base.getModels()[1]!;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url, options) => {
      if (options.headers.authorization === "Bearer first-key") {
        started.resolve();
        return release.promise;
      }
      return response([second.id]);
    }),
  );
  const host = new ArtemisAgentHost(
    { async request() {} },
    { emit() {} },
    { agentDir: await directory() },
  );
  cleanups.push(async () => host.dispose());
  const first = host.configure({
    credentials: { openrouter: { type: "api_key", key: "first-key" } },
  });
  await started.promise;
  await host.configure({
    credentials: { openrouter: { type: "api_key", key: "second-key" } },
  });
  release.resolve(response());
  await first;
  expect(
    (await host.catalog()).models
      .filter((m) => m.providerId === "openrouter")
      .map((m) => m.modelId),
  ).toEqual([second.id]);
});

it("reapplies credentials and catalog when an Office toggle supersedes an account change", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  const second = base.getModels()[1]!;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url, options) => {
      if (options.headers.authorization === "Bearer pending-key") {
        started.resolve();
        return release.promise;
      }
      return response();
    }),
  );
  const host = new ArtemisAgentHost(
    { async request() {} },
    { emit() {} },
    { agentDir: await directory() },
  );
  cleanups.push(async () => host.dispose());
  const original = {
    credentials: {
      openrouter: { type: "api_key" as const, key: "original-key" },
    },
    officeEnabled: false,
  };
  await host.configure(original);
  const pending = host.configure({
    ...original,
    credentials: { openrouter: { type: "api_key", key: "pending-key" } },
  });
  await started.promise;
  try {
    await host.configure({ ...original, officeEnabled: true });
  } finally {
    release.resolve(response([second.id]));
    await pending;
  }
  const catalog = await host.catalog();
  expect(catalog.authoritativeProviderIds).toEqual(["openrouter"]);
  expect(
    catalog.models
      .filter((m) => m.providerId === "openrouter")
      .map((m) => m.modelId),
  ).toEqual([allowed.id]);
  const runtime = await (
    host as unknown as {
      getModelRuntime(): Promise<
        import("@earendil-works/pi-coding-agent").ModelRuntime
      >;
    }
  ).getModelRuntime();
  expect((await runtime.getAuth("openrouter"))?.auth.apiKey).toBe(
    "original-key",
  );
});
