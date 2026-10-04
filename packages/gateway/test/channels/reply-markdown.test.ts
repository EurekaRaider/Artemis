import { expect, it, vi } from "vitest";
import { FeishuAdapter } from "../../src/channels/channels.js";
import { SlackAdapter } from "../../src/channels/slack/slack.js";

const reply =
  "**我能做的事：**\n\n1. **代码开发**\n   - 读、写、编辑项目文件\n\n2. **文档与交付物**\n   - 编写 `AI_HANDOFF_UNFINISHED.md`\n\n[文档](https://example.com)";
const conversation = {
  connectionId: "test",
  kind: "direct",
  id: "chat",
} as const;

it.each(["feishu", "lark"] as const)(
  "%s preserves Markdown in ordinary replies and status card creation/updates",
  async (domain) => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) =>
        Response.json(
          String(url).includes("tenant_access_token")
            ? { code: 0, tenant_access_token: "test", expire: 7200 }
            : { code: 0, data: { message_id: "message" } },
        ),
      );
    try {
      const adapter = new FeishuAdapter({
        id: "test",
        name: "test",
        channel: "feishu",
        domain,
        tenantId: "tenant",
        appId: "app",
        botOpenId: "bot",
        appSecret: "secret",
        verificationToken: "token",
        encryptKey: "key",
        enabled: true,
      });
      await adapter.send(
        conversation,
        reply,
        "ordinary",
        "ou_ignored_in_direct",
      );
      await adapter.statusCard(conversation, reply, "create");
      await adapter.statusCard(conversation, reply, "update", "message");
      const calls = fetcher.mock.calls.slice(1);
      for (const [url] of calls)
        expect(String(url)).toContain(
          domain === "lark"
            ? "https://open.larksuite.com/"
            : "https://open.feishu.cn/",
        );
      const bodies = calls.map(([, init]) => JSON.parse(String(init?.body)));
      expect(bodies[0].msg_type).toBe("post");
      expect(JSON.parse(bodies[0].content).zh_cn.content).toEqual([
        [{ tag: "md", text: reply }],
      ]);
      for (const body of bodies.slice(1))
        expect(JSON.parse(body.content).elements).toEqual([
          { tag: "div", text: { tag: "lark_md", content: reply } },
        ]);
      expect(calls[2]?.[1]?.method).toBe("PATCH");
      // Model text must not gain native mention behavior when rendered as Markdown.
      await adapter.send(
        conversation,
        '<at user_id="all"></at> **结果**',
        "safe",
      );
      const safe = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
      expect(JSON.parse(safe.content).zh_cn.content[0][0].text).toBe(
        '&lt;at user_id="all"&gt;&lt;/at&gt; **结果**',
      );
    } finally {
      fetcher.mockRestore();
    }
  },
);

it("Slack converts Markdown for ordinary replies and status creation/updates", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ ok: true, ts: "123.4" }));
  try {
    const adapter = new SlackAdapter(
      {
        id: "test",
        name: "test",
        channel: "slack",
        tenantId: "tenant",
        appId: "app",
        botUserId: "bot",
        botToken: "token",
        appToken: "app-token",
        enabled: true,
      },
      () => {},
    );
    await adapter.send(conversation, reply, "ordinary");
    await adapter.statusCard(conversation, reply, "create");
    await adapter.statusCard(conversation, reply, "update", "123.4");
    for (const [, init] of fetcher.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(body.mrkdwn).toBe(true);
      expect(body.text).toContain("*我能做的事：*");
      expect(body.text).toContain("1. *代码开发*");
      expect(body.text).toContain("• 读、写、编辑项目文件");
      expect(body.text).toContain("`AI_HANDOFF_UNFINISHED.md`");
      expect(body.text).toContain("<https://example.com|文档>");
      expect(body.text).not.toContain("**");
    }
    expect(String(fetcher.mock.calls[2]?.[0])).toContain("chat.update");
  } finally {
    fetcher.mockRestore();
  }
});
