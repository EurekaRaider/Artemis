import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FeishuAdapter,
  normalizeWecom,
  type ChannelConnection,
} from "../src/channels.js";
import { normalizeFeishuGroupEvent } from "../src/feishu-group-events.js";
const config: Extract<ChannelConnection, { channel: "feishu" }> = {
  id: "f",
  name: "Feishu",
  channel: "feishu",
  tenantId: "tenant",
  appId: "app",
  botOpenId: "bot",
  appSecret: "secret",
  transport: "websocket",
  enabled: true,
};
const conversation = { connectionId: "f", id: "chat", kind: "group" as const };
afterEach(() => vi.unstubAllGlobals());
function mockPages(pages: unknown[], status = 200) {
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    String(url).includes("tenant_access_token")
      ? Response.json({ code: 0, tenant_access_token: "token", expire: 7200 })
      : Response.json(pages.shift(), { status }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const member = (id: string) => ({
  member_id: id,
  member_id_type: "open_id",
  name: id,
});
describe("Feishu and Lark group directories", () => {
  it.each(["feishu", "lark"] as const)(
    "paginates %s without claiming a full bot directory",
    async (domain) => {
      const fetcher = mockPages([
        {
          code: 0,
          data: {
            items: [member("alice")],
            has_more: true,
            page_token: "next",
          },
        },
        {
          code: 0,
          data: { items: [member("alice"), member("bob")], has_more: false },
        },
      ]);
      const roster = await new FeishuAdapter({
        ...config,
        domain,
      }).groupMembers(conversation);
      expect(roster).toMatchObject({ complete: false, error: "partial" });
      expect(roster.members.map((m) => [m.name, m.kind])).toEqual([
        ["alice", "human"],
        ["bob", "human"],
      ]);
      expect(String(fetcher.mock.calls[2]![0])).toContain(
        domain === "lark" ? "open.larksuite.com" : "open.feishu.cn",
      );
      expect(String(fetcher.mock.calls[2]![0])).toContain("page_token=next");
    },
  );
  it.each([
    [403, "missing-scope"],
    [429, "rate-limited"],
    [500, "unavailable"],
  ])("reports HTTP %s", async (status, error) => {
    mockPages([{ code: 1 }], Number(status));
    expect(
      await new FeishuAdapter(config).groupMembers(conversation),
    ).toMatchObject({ complete: false, error });
  });
  it("bounds repeated cursors and rejects non-open identities", async () => {
    const fetcher = mockPages(
      Array.from({ length: 2 }, () => ({
        code: 0,
        data: { items: [member("alice")], has_more: true, page_token: "loop" },
      })),
    );
    expect(
      (await new FeishuAdapter(config).groupMembers(conversation)).members,
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    mockPages([
      {
        code: 0,
        data: { items: [{ member_id: "app", member_id_type: "app_id" }] },
      },
    ]);
    expect(
      await new FeishuAdapter(config).groupMembers(conversation),
    ).toMatchObject({ members: [], error: "unavailable" });
  });
  it("accepts authenticated removal events and rejects tenant, app and timestamp mismatches", () => {
    const event = {
      header: {
        app_id: "app",
        tenant_key: "tenant",
        event_type: "im.chat.member.bot.deleted_v1",
        create_time: String(Date.now()),
      },
      event: { chat_id: "chat" },
    };
    expect(normalizeFeishuGroupEvent(config, event)).toMatchObject({
      chatId: "chat",
      unavailable: "removed",
    });
    for (const patch of [
      { app_id: "other" },
      { tenant_key: "other" },
      { create_time: "NaN" },
      { create_time: String(Date.now() + 120000) },
    ])
      expect(
        normalizeFeishuGroupEvent(config, {
          ...event,
          header: { ...event.header, ...patch },
        }),
      ).toBeUndefined();
  });
  it("retains WeCom platform time so replay cannot bypass authorization time", () => {
    const event = normalizeWecom(
      {
        id: "w",
        name: "w",
        channel: "wecom",
        tenantId: "tenant",
        botId: "bot",
        secret: "secret",
        enabled: true,
      },
      {
        cmd: "aibot_msg_callback",
        body: {
          aibotid: "bot",
          from: { userid: "alice" },
          msgid: "m",
          chattype: "group",
          chatid: "c",
          msgtype: "text",
          text: { content: "hello" },
          create_time: 1700000000,
        },
      },
    );
    expect(event?.timestamp).toBe(1700000000000);
    expect(event?.bot).toBe(false);
  });
});
