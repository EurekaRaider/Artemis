import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imConversationKey, type ImGroupRoster } from "@artemis/protocol";
import { GatewayStore } from "../src/store.js";
import { ArtemisGateway } from "../src/server.js";
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
    "paginates %s with the current bot directory",
    async (domain) => {
      const fetcher = mockPages([
        {
          code: 0,
          data: {
            users: [member("alice")],
            bots: [{ member_id: "bot", name: "Feishu" }],
            has_more: true,
            page_token: "next",
          },
        },
        {
          code: 0,
          data: {
            users: [member("alice"), member("bob")],
            bots: [],
            has_more: false,
          },
        },
      ]);
      const roster = await new FeishuAdapter({
        ...config,
        domain,
      }).groupMembers(conversation);
      expect(roster).toMatchObject({ complete: true });
      expect(roster.members.map((m) => [m.name, m.kind])).toEqual([
        ["alice", "human"],
        ["Feishu", "bot"],
        ["bob", "human"],
      ]);
      expect(String(fetcher.mock.calls[2]![0])).toContain(
        domain === "lark" ? "open.larksuite.com" : "open.feishu.cn",
      );
      expect(String(fetcher.mock.calls[2]![0])).toContain("/members/list?");
      expect(String(fetcher.mock.calls[2]![0])).toContain("page_token=next");
    },
  );
  it.each(["feishu", "lark"] as const)(
    "includes the configured %s bot exactly once without granting peer permissions",
    async (domain) => {
      mockPages([
        {
          code: 0,
          data: {
            users: [member("alice")],
            bots: [{ member_id: "bot", name: "Feishu" }],
            has_more: true,
            page_token: "next",
          },
        },
        {
          code: 0,
          data: {
            users: [member("alice")],
            bots: [{ member_id: "bot", name: "Artemis 助手" }],
            has_more: false,
          },
        },
      ]);
      const roster = await new FeishuAdapter({
        ...config,
        domain,
        name: "Artemis 助手",
      }).groupMembers(conversation);
      expect(roster.members.filter((m) => m.kind === "bot")).toEqual([
        {
          identity: {
            channel: "feishu",
            connectionId: "f",
            tenantId: "tenant",
            appId: "app",
            userId: "bot",
          },
          name: "Artemis 助手",
          kind: "bot",
          self: true,
        },
      ]);
      expect(roster).toMatchObject({ complete: true });
    },
  );
  it("does not invent membership when the provider rejects the group lookup", async () => {
    mockPages([{ code: 1 }], 403);
    expect(
      (await new FeishuAdapter(config).groupMembers(conversation)).members,
    ).toEqual([]);
  });
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
        data: {
          users: [member("alice")],
          bots: [{ member_id: "bot", name: "Feishu" }],
          has_more: true,
          page_token: "loop",
        },
      })),
    );
    expect(
      (await new FeishuAdapter(config).groupMembers(conversation)).members,
    ).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    mockPages([
      {
        code: 0,
        data: {
          users: [{ member_id: "app", member_id_type: "app_id" }],
          bots: [],
          has_more: false,
        },
      },
    ]);
    expect(
      await new FeishuAdapter(config).groupMembers(conversation),
    ).toMatchObject({ members: [], error: "unavailable" });
  });
  it.each(["feishu", "lark"] as const)(
    "drops removed %s bots and deduplicates identities on refresh",
    async (domain) => {
      mockPages([
        {
          code: 0,
          data: {
            users: [],
            bots: [
              { member_id: "mino", name: "Mino" },
              { member_id: "mino", name: "Mino" },
            ],
            has_more: false,
          },
        },
        { code: 0, data: { users: [], bots: [], has_more: false } },
      ]);
      const adapter = new FeishuAdapter({ ...config, domain });
      expect((await adapter.groupMembers(conversation)).members).toHaveLength(
        1,
      );
      expect(await adapter.groupMembers(conversation)).toEqual({
        members: [],
        complete: true,
      });
    },
  );
  it.each([
    {
      users: [],
      bots: [],
      has_more: false,
      truncations: [{ member_type: "bot", limit: 100 }],
    },
    { users: [], bots: [], has_more: true },
    { items: [] },
  ])(
    "does not treat truncated or malformed directories as complete",
    async (data) => {
      mockPages([{ code: 0, data }]);
      expect(
        (await new FeishuAdapter(config).groupMembers(conversation)).complete,
      ).toBe(false);
    },
  );
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

it.each(["feishu", "lark"] as const)(
  "replaces historical %s bots in gateway snapshots and collaboration peers",
  async (domain) => {
    const directory = mkdtempSync(join(tmpdir(), "artemis-roster-"));
    const databasePath = join(directory, "gateway.sqlite");
    const options = {
      databasePath,
      encryptionKey: "e".repeat(32),
      adminToken: "a".repeat(32),
    };
    const seed = new GatewayStore(databasePath, options.encryptionKey);
    seed.put("connections", config.id, {
      id: config.id,
      sealed: seed.seal({ ...config, domain }),
    });
    seed.close();
    const adapter = new FeishuAdapter({ ...config, domain });
    vi.spyOn(adapter, "start").mockImplementation(() => {});
    vi.spyOn(adapter, "status").mockReturnValue({
      id: config.id,
      channel: "feishu",
      name: "Lark",
      state: "connected",
    });
    vi.spyOn(adapter, "groupInfo").mockResolvedValue({ name: "Team" });
    const gateway = new ArtemisGateway({
      ...options,
      adapterFactory: () => adapter,
    });
    try {
      gateway.store.put("native-groups", "group", {
        id: "group",
        name: "Team",
        revision: "r",
        endpoints: [conversation],
        participants: [],
        nativeGroup: {
          version: 1,
          enabled: true,
          ownerDeviceId: "device",
          allowedBots: [],
        },
      });
      gateway.store.put("space-confirmations", "group", [
        imConversationKey(conversation),
      ]);
      const old = {
        identity: {
          channel: "feishu",
          connectionId: "f",
          tenantId: "tenant",
          appId: "app",
          userId: "old-mino",
        },
        name: "Mino",
        kind: "bot",
      };
      gateway.store.put("native-group-info", "group", {
        next: 0,
        roster: { complete: false, members: [old, old] },
      });
      gateway.store.put("native-peers", "group", [
        { id: "old-mino", name: "Mino" },
      ]);
      mockPages([
        {
          code: 0,
          data: {
            users: [member("owner"), member("teammate")],
            bots: [
              { member_id: "bot", name: "Lark" },
              { member_id: "peer-bot", name: "Teammate bot" },
            ],
            has_more: false,
          },
        },
      ]);
      await gateway.tick();
      await vi.waitFor(() =>
        expect(
          gateway.store.get<{ roster: ImGroupRoster }>(
            "native-group-info",
            "group",
          )?.roster.complete,
        ).toBe(true),
      );
      const info = gateway.store.get<{ roster: ImGroupRoster }>(
        "native-group-info",
        "group",
      )!;
      expect(info.roster.complete).toBe(true);
      expect(info.roster.members.map((m) => m.identity.userId)).toEqual([
        "owner",
        "teammate",
        "bot",
        "peer-bot",
      ]);
      expect(gateway.router.native.peers("group").map((p) => p.id)).toEqual([
        "peer-bot",
      ]);
      expect(gateway.store.pending("outgoing")).toHaveLength(0);
    } finally {
      await gateway.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
