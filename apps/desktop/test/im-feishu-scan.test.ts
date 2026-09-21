import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import type { ImFeishuScanPollResult } from "@artemis/protocol";
import { APP_LOCALES } from "@artemis/protocol";
import { imText } from "@artemis/gateway";
import {
  beginFeishuScan,
  fetchFeishuBotInfo,
  pollFeishuScan,
} from "../src/main/feishu-register.js";

// Exact permission contract: prevent broad preset or unrelated scopes returning.
const expectedAddons = {
  preset: false,
  scopes: {
    tenant: [
      "im:chat:read",
      "im:chat.members:read",
      "im:chat.members:bot_access",
      "im:message.group_at_msg.include_bot:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot",
      "im:message:readonly",
      "im:resource",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "cardkit:card:write",
    ],
  },
  events: {
    items: {
      tenant: [
        "im.message.receive_v1",
        "im.chat.member.user.added_v1",
        "im.chat.member.user.deleted_v1",
        "im.chat.member.user.withdrawn_v1",
        "im.chat.member.bot.added_v1",
        "im.chat.member.bot.deleted_v1",
        "im.chat.disbanded_v1",
      ],
    },
  },
  callbacks: { items: ["card.action.trigger"] },
};

/** Route mocked responses by the `action` field of the form body. */
function stubFetch(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { body?: unknown }) => {
      const body = Object.fromEntries(
        new URLSearchParams(String(init?.body ?? "")),
      );
      calls.push({ url: String(url), body });
      const action = body.action ?? "";
      if (!(action in responses))
        throw new Error(`unexpected action ${action}`);
      const response = responses[action];
      if (typeof response === "number")
        return { ok: false, status: response, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => response };
    }),
  );
  return calls;
}

describe("feishu scan-to-register", () => {
  it.each(APP_LOCALES)(
    "localizes setup and network failures in %s",
    async (locale) => {
      stubFetch({ init: { supported_auth_methods: [] } });
      await expect(beginFeishuScan("lark", locale)).rejects.toThrow(
        imText(locale, "scanUnsupported", { platform: "Lark" }),
      );
      stubFetch({ init: 503 });
      await expect(beginFeishuScan("lark", locale)).rejects.toThrow(
        imText(locale, "scanNetwork", { platform: "Lark" }),
      );
      stubFetch({
        init: { supported_auth_methods: ["client_secret"] },
        begin: 503,
      });
      await expect(beginFeishuScan("lark", locale)).rejects.toThrow(
        imText(locale, "scanNetwork", { platform: "Lark" }),
      );
    },
  );
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("begins a session with the PersonalAgent archetype", async () => {
    const calls = stubFetch({
      init: { supported_auth_methods: ["client_secret", "private_key_jwt"] },
      begin: {
        device_code: "dev1",
        verification_uri_complete: "https://accounts.feishu.cn/confirm?c=1",
        user_code: "ABCD",
        expire_in: 600,
        interval: 5,
      },
    });
    const before = Date.now();
    const result = await beginFeishuScan();
    expect(calls[0]!.url).toBe(
      "https://accounts.feishu.cn/oauth/v1/app/registration",
    );
    expect(calls[1]!.body).toMatchObject({
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id tenant_brand",
    });
    expect(result).toMatchObject({
      deviceCode: "dev1",
      userCode: "ABCD",
      intervalMs: 5000,
      domain: "feishu",
    });
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(result.qrImage).toMatch(/^data:image\/png;base64,/);
    const qrUrl = new URL(result.qrUrl);
    expect(qrUrl.origin + qrUrl.pathname).toBe(
      "https://accounts.feishu.cn/confirm",
    );
    expect(qrUrl.searchParams.get("user_code")).toBe("ABCD");
    expect(qrUrl.searchParams.get("c")).toBe("1");
    expect(qrUrl.searchParams.get("from")).toBe("sdk");
    expect(qrUrl.searchParams.get("tp")).toBe("sdk");
    expect(qrUrl.searchParams.get("source")).toBe("node-sdk/artemis");
    expect(
      JSON.parse(
        gunzipSync(
          Buffer.from(qrUrl.searchParams.get("addons")!, "base64url"),
        ).toString("utf8"),
      ),
    ).toEqual(expectedAddons);
  });

  it.each([
    "https://example.com/confirm",
    "https://user@open.feishu.cn/page/launcher",
    "http://open.feishu.cn/page/launcher",
  ])("rejects an untrusted registration confirmation URL: %s", async (url) => {
    stubFetch({
      init: { supported_auth_methods: ["client_secret"] },
      begin: {
        device_code: "device",
        user_code: "CODE",
        verification_uri_complete: url,
      },
    });
    await expect(beginFeishuScan()).rejects.toThrow();
  });

  it("uses the SDK launcher when the server omits its confirmation URL", async () => {
    stubFetch({
      init: { supported_auth_methods: ["client_secret"] },
      begin: { device_code: "device", user_code: "CODE" },
    });
    const result = await beginFeishuScan();
    const url = new URL(result.qrUrl);
    expect(url.pathname).toBe("/page/launcher");
    expect(url.searchParams.get("tp")).toBe("sdk");
  });

  it("rejects environments without client_secret registration", async () => {
    stubFetch({ init: { supported_auth_methods: ["private_key_jwt"] } });
    await expect(beginFeishuScan()).rejects.toThrow("扫码创建应用");
  });

  it("bootstraps Lark on Feishu and preserves the SDK launcher path", async () => {
    const calls = stubFetch({
      init: { supported_auth_methods: ["client_secret"] },
      begin: {
        device_code: "lark-device",
        verification_uri_complete:
          "https://open.feishu.cn/page/launcher?user_code=LARK",
        user_code: "LARK",
        expires_in: 3600,
      },
    });
    const before = Date.now();
    const begin = await beginFeishuScan("lark");
    expect(begin).toMatchObject({
      deviceCode: "lark-device",
      domain: "lark",
      pollDomain: "feishu",
    });
    expect(begin.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    const qrUrl = new URL(begin.qrUrl);
    expect(qrUrl.origin + qrUrl.pathname).toBe(
      "https://open.larksuite.com/page/launcher",
    );
    expect(qrUrl.searchParams.get("user_code")).toBe("LARK");
    expect(qrUrl.searchParams.get("from")).toBe("sdk");
    expect(qrUrl.searchParams.get("tp")).toBe("sdk");
    expect(
      JSON.parse(
        gunzipSync(
          Buffer.from(qrUrl.searchParams.get("addons")!, "base64url"),
        ).toString("utf8"),
      ),
    ).toEqual(expectedAddons);
    expect(calls.map(({ url }) => url)).toEqual(
      Array(2).fill("https://accounts.feishu.cn/oauth/v1/app/registration"),
    );
  });

  it("reads cross-brand discovery from HTTP 400 pending responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: "authorization_pending",
          user_info: { tenant_brand: "lark" },
        }),
      })),
    );
    await expect(
      pollFeishuScan({ deviceCode: "device", domain: "feishu" }),
    ).resolves.toEqual({ status: "pending", intervalMs: 0, domain: "lark" });
  });

  it("maps poll outcomes through the device-flow states", async () => {
    const cases: Array<{
      response: Record<string, unknown>;
      expected: ImFeishuScanPollResult;
    }> = [
      {
        response: {},
        expected: { status: "pending", intervalMs: 5000, domain: "feishu" },
      },
      {
        response: { interval: 3 },
        expected: { status: "pending", intervalMs: 3000, domain: "feishu" },
      },
      {
        response: { error: "slow_down" },
        expected: { status: "pending", intervalMs: 10000, domain: "feishu" },
      },
      {
        response: { error: "expired_token" },
        expected: { status: "expired" },
      },
      {
        response: { error: "access_denied" },
        expected: { status: "denied" },
      },
      {
        response: { error: "unknown_failure" },
        expected: {
          status: "error",
          message: "Feishu registration error: unknown_failure",
        },
      },
      {
        response: {
          client_id: "cli_x",
          client_secret: "sec",
          app_name: "Donald",
          user_info: {
            open_id: "ou_1",
            tenant_key: "tk1",
            tenant_brand: "feishu",
          },
        },
        expected: {
          status: "success",
          appId: "cli_x",
          appSecret: "sec",
          appName: "Donald",
          openId: "ou_1",
          tenantKey: "tk1",
          domain: "feishu",
        },
      },
    ];
    for (const { response, expected } of cases) {
      stubFetch({ poll: response });
      const result = await pollFeishuScan({
        deviceCode: "dev1",
        domain: "feishu",
      });
      expect(result).toEqual(expected);
    }
  });

  it("follows a Lark brand confirmation to the Lark poll host", async () => {
    const calls = stubFetch({
      poll: { user_info: { tenant_brand: "lark" } },
    });
    const result = await pollFeishuScan({
      deviceCode: "dev1",
      domain: "feishu",
    });
    expect(result).toEqual({
      status: "pending",
      intervalMs: 0,
      domain: "lark",
    });
    expect(calls[0]!.url).toBe(
      "https://accounts.feishu.cn/oauth/v1/app/registration",
    );
    // The next poll must hit the Lark host with the same device code.
    const second = await pollFeishuScan({
      deviceCode: "dev1",
      domain: "lark",
    });
    expect(second).toEqual({
      status: "pending",
      intervalMs: 5000,
      domain: "lark",
    });
    expect(calls[1]!.url).toBe(
      "https://accounts.larksuite.com/oauth/v1/app/registration",
    );
  });

  it("keeps credentials returned with a Lark brand confirmation", async () => {
    stubFetch({
      poll: {
        client_id: "cli_lark",
        client_secret: "synthetic",
        user_info: { tenant_brand: "lark" },
      },
    });
    await expect(
      pollFeishuScan({ deviceCode: "dev1", domain: "feishu" }),
    ).resolves.toMatchObject({
      status: "success",
      appId: "cli_lark",
      appSecret: "synthetic",
      domain: "lark",
    });
  });

  it("keeps polling through transient network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await pollFeishuScan({
      deviceCode: "dev1",
      domain: "feishu",
    });
    expect(result).toEqual({
      status: "pending",
      intervalMs: 5000,
      domain: "feishu",
    });
  });

  it("resolves the live bot name and open id from the Feishu API", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push(String(url));
        if (String(url).endsWith("/tenant_access_token/internal")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            app_id: "cli_x",
            app_secret: "sec",
          });
          return {
            ok: true,
            json: async () => ({ code: 0, tenant_access_token: "t-1" }),
          };
        }
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer t-1",
        );
        return {
          ok: true,
          json: async () => ({
            code: 0,
            bot: { app_name: " 产物机器人 ", open_id: "ou_bot" },
          }),
        };
      }),
    );
    expect(await fetchFeishuBotInfo("feishu", "cli_x", "sec")).toEqual({
      name: "产物机器人",
      botOpenId: "ou_bot",
    });
    expect(calls[0]).toBe(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    );
    expect(calls[1]).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
    expect(await fetchFeishuBotInfo("lark", "cli_x", "sec")).toBeDefined();
    expect(calls[2]).toBe(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
    );
  });

  it("fails loudly so the connect flow can keep its fallback name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 99991663, msg: "invalid app_id" }),
      })),
    );
    await expect(fetchFeishuBotInfo("feishu", "cli_x", "sec")).rejects.toThrow(
      "tenant_access_token",
    );
  });
});
