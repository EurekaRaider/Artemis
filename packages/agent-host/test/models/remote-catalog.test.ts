import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, expect, it, vi } from "vitest";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

const credentials = {
  openai: { type: "api_key" as const, key: "test-only" },
  "openai-codex": {
    type: "oauth" as const,
    access: "test-access",
    refresh: "test-refresh",
    expires: Date.now() + 3_600_000,
  },
};
const selection = {
  providerId: "openai-codex",
  modelId: "catalog-only-model",
  thinkingLevel: "high" as const,
};
const roots: string[] = [];
const hosts: ArtemisAgentHost[] = [];
async function hostAt(agentDir?: string) {
  if (!agentDir) {
    agentDir = await mkdtemp(join(tmpdir(), "artemis-remote-catalog-"));
    roots.push(agentDir);
  }
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  const host = new ArtemisAgentHost(
    { async request() {} },
    { emit() {} },
    { agentDir },
  );
  hosts.push(host);
  return { host, agentDir };
}
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true });
});

function serveCatalog(modelId = selection.modelId) {
  vi.stubEnv("PI_OFFLINE", undefined);
  const fetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe("https://pi.dev");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    const provider = url.pathname.split("/").at(-1);
    if (provider !== "openai" && provider !== "openai-codex")
      return new Response(null, { status: 404 });
    const base = getBuiltinModels(provider)[0]!;
    return Response.json([{ ...base, id: modelId, name: "New model" }], {
      headers: { "last-modified": new Date().toUTCString() },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("discovers new models after login and restores the selected model on an offline restart", async () => {
  const fetch = serveCatalog();
  const { host, agentDir } = await hostAt();
  await host.configure({ credentials: {} });
  await host.catalog();
  await host.configure({ credentials });
  const catalog = await host.catalog();
  expect(catalog.authoritativeProviderIds).toEqual(
    expect.arrayContaining(Object.keys(credentials)),
  );
  for (const providerId of Object.keys(credentials))
    expect(catalog.models).toContainEqual(
      expect.objectContaining({
        providerId,
        modelId: selection.modelId,
        configured: true,
      }),
    );
  await host.configure({ credentials, selection });
  fetch.mockClear();
  await host.catalog();
  expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv("PI_OFFLINE", "1");
  const restarted = (await hostAt(agentDir)).host;
  await restarted.configure({ credentials, selection });
  expect((await restarted.catalog()).selection).toEqual(selection);
  expect(fetch).not.toHaveBeenCalled();
});

it("discovers a later model in the same running host after Pi's cache expires", async () => {
  serveCatalog();
  const { host } = await hostAt();
  await host.configure({ credentials });
  await host.catalog();
  const latest = serveCatalog("next-release");
  await host.catalog();
  expect(latest).not.toHaveBeenCalled();
  const later = Date.now() + 4 * 60 * 60_000 + 1;
  vi.spyOn(Date, "now").mockReturnValue(later);
  const catalog = await host.catalog();
  expect(
    catalog.models
      .filter((model) => model.modelId === "next-release")
      .map((model) => model.providerId)
      .sort(),
  ).toEqual(["openai", "openai-codex"]);
});

it("keeps a same-ID custom provider on its own model list", async () => {
  const fetch = serveCatalog();
  const { host } = await hostAt();
  const base = getBuiltinModels("openai")[0]!;
  await host.configure({
    credentials,
    providers: [
      {
        id: "openai",
        name: "Local",
        baseUrl: "http://127.0.0.1:1234/v1",
        models: [
          {
            id: "local-only",
            name: "Local model",
            input: base.input,
            reasoning: false,
            contextWindow: base.contextWindow,
            maxTokens: base.maxTokens,
          },
        ],
      },
    ],
  });
  const catalog = await host.catalog();
  expect(
    catalog.models
      .filter((m) => m.providerId === "openai")
      .map((m) => m.modelId),
  ).toEqual(["local-only"]);
  expect(catalog.authoritativeProviderIds).not.toContain("openai");
  expect(
    fetch.mock.calls.map(([input]) => new URL(input).pathname),
  ).not.toContain("/api/models/providers/openai");
});

it("can recover a saved remote selection when the local catalog cache is missing", async () => {
  serveCatalog();
  const { host } = await hostAt();
  await host.configure({ credentials, selection });
  expect((await host.catalog()).selection).toEqual(selection);
});

it("keeps bundled models available when the first catalog request fails", async () => {
  vi.stubEnv("PI_OFFLINE", undefined);
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const { host } = await hostAt();
  await host.configure({ credentials });
  const catalog = await host.catalog();
  expect(fetch).toHaveBeenCalled();
  expect(catalog.models).toContainEqual(
    expect.objectContaining({
      providerId: "openai",
      modelId: "gpt-6.1-sol",
      configured: true,
    }),
  );
});
