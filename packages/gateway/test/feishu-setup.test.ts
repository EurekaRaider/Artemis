import { afterEach, expect, it, vi } from "vitest";
import { resolveFeishuConnection } from "../src/feishu-setup.js";
import { ArtemisGateway } from "../src/server.js";

const setup = {
  channel: "feishu",
  id: "feishu",
  name: "Feishu",
  enabled: true,
  transport: "websocket",
  appId: "cli_test",
  appSecret: "synthetic-secret",
};
let gateway: ArtemisGateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  vi.restoreAllMocks();
});
function platform(tenant = "real-tenant") {
  const original = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url);
    if (!path.startsWith("https://open.")) return original(url, init);
    if (path.endsWith("tenant_access_token/internal"))
      return Response.json({
        code: 0,
        tenant_access_token: "synthetic-access-token",
      });
    if (path.endsWith("tenant/query"))
      return Response.json({
        code: 0,
        data: {
          tenant: { tenant_key: tenant, display_id: "not-the-tenant-key" },
        },
      });
    if (path.endsWith("bot/v3/info"))
      return Response.json({
        code: 0,
        bot: { open_id: "ou_bot", app_name: "My bot" },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
}
it("resolves real Feishu identities from two credentials and restricts requests to the selected platform", async () => {
  const fetch = platform();
  expect(
    await resolveFeishuConnection({ ...setup, domain: "lark" }),
  ).toMatchObject({
    tenantId: "real-tenant",
    botOpenId: "ou_bot",
    domain: "lark",
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [url, init] of fetch.mock.calls) {
    expect(String(url)).toMatch(/^https:\/\/open\.larksuite\.com\/open-apis\//);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({
    Authorization: "Bearer synthetic-access-token",
  });
});
it("keeps explicit legacy identities compatible without a new lookup", async () => {
  const fetch = platform();
  const complete = {
    ...setup,
    tenantId: "legacy-tenant",
    botOpenId: "ou_legacy",
  };
  expect(await resolveFeishuConnection(complete)).toEqual(complete);
  expect(fetch).not.toHaveBeenCalled();
});
it("fails with a useful hint and no leaked platform response when lookup is denied", async () => {
  const fetch = platform();
  fetch.mockResolvedValueOnce(
    Response.json({ code: 0, tenant_access_token: "synthetic-access-token" }),
  );
  fetch.mockResolvedValueOnce(
    Response.json({ code: 999, msg: "echo synthetic-secret" }),
  );
  const error = await resolveFeishuConnection(setup).catch(
    (error: Error) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("获取企业信息");
  expect(String(error)).not.toContain("synthetic-secret");
});
it("does not save an empty identity or mistake the enterprise display number for tenant_key", async () => {
  const fetch = platform();
  fetch.mockResolvedValueOnce(
    Response.json({ code: 0, tenant_access_token: "synthetic-access-token" }),
  );
  fetch.mockResolvedValueOnce(
    Response.json({ code: 0, data: { tenant: { display_id: "F123" } } }),
  );
  await expect(resolveFeishuConnection(setup)).rejects.toThrow("获取企业信息");
});
it("authenticates setup, encrypts the resolved connection and rejects changing its tenant", async () => {
  const fetchSpy = platform();
  gateway = new ArtemisGateway({
    databasePath: ":memory:",
    adminToken: "a".repeat(32),
    encryptionKey: "e".repeat(32),
    adapterFactory: (config) => ({
      start() {},
      stop() {},
      status: () => ({
        id: config.id,
        name: config.name,
        channel: config.channel,
        state: "connected",
      }),
      send: async () => "message",
      attachment: async () => {
        throw new Error("Unused");
      },
    }),
  });
  const url = `http://127.0.0.1:${await gateway.listen(0)}`;
  const save = (token = "a".repeat(32)) =>
    fetch(`${url}/v1/admin/connections`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(setup),
    });
  expect((await save("wrong")).status).toBe(401);
  expect(
    fetchSpy.mock.calls.filter(([url]) => String(url).startsWith("https://")),
  ).toHaveLength(0);
  expect((await save()).status).toBe(200);
  const stored = gateway.store.get<{ sealed: string }>(
    "connections",
    "feishu",
  )!.sealed;
  expect(stored).not.toContain(setup.appSecret);
  expect(gateway.store.unseal(stored)).toMatchObject({
    tenantId: "real-tenant",
    botOpenId: "ou_bot",
  });
  fetchSpy.mockRestore();
  platform("different-tenant");
  expect((await save()).status).toBe(400);
  expect(
    gateway.store.get<{ sealed: string }>("connections", "feishu")!.sealed,
  ).toBe(stored);
});
