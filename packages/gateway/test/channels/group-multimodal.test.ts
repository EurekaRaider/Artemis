import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeFeishu,
  normalizeWecom,
  type ChannelConnection,
} from "../../src/channels/channels.js";
import { normalizeSlack } from "../../src/channels/slack/slack.js";
import { GatewayRouter } from "../../src/router.js";
import { GatewayStore } from "../../src/store.js";

const feishu: Extract<ChannelConnection, { channel: "feishu" }> = {
  channel: "feishu",
  id: "f",
  name: "f",
  tenantId: "tenant",
  appId: "app",
  botOpenId: "own-bot",
  appSecret: "secret",
  enabled: true,
};
const wecom: Extract<ChannelConnection, { channel: "wecom" }> = {
  channel: "wecom",
  id: "w",
  name: "w",
  tenantId: "tenant",
  botId: "bot",
  secret: "secret",
  enabled: true,
};
const slack: Extract<ChannelConnection, { channel: "slack" }> = {
  channel: "slack",
  id: "s",
  name: "s",
  tenantId: "tenant",
  appId: "app",
  botUserId: "own-bot",
  botToken: "xoxb-test",
  appToken: "xapp-test",
  enabled: true,
};
function post(localized = false, first = "@_user_1") {
  const content = {
    title: "",
    content: [
      [
        { tag: "img", image_key: "image" },
        { tag: "at", user_id: first },
        { tag: "text", text: " 检查图片 " },
        { tag: "at", user_id: "@_user_2" },
      ],
    ],
  };
  return {
    header: { event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_type: "user", sender_id: { open_id: "alice" } },
      message: {
        message_id: "post",
        chat_id: "room",
        chat_type: "group",
        message_type: "post",
        content: JSON.stringify(localized ? { zh_cn: content } : content),
        mentions: [
          { key: "@_user_2", id: { open_id: "bob" }, name: "Bob" },
          { key: "@_user_1", id: { open_id: "own-bot" }, name: "Bot" },
        ],
      },
    },
  };
}
function mixed() {
  return {
    cmd: "aibot_msg_callback",
    body: {
      aibotid: "bot",
      from: { userid: "alice" },
      msgid: "mixed",
      chattype: "group",
      chatid: "room",
      msgtype: "mixed",
      mixed: {
        msg_item: [
          { msgtype: "text", text: { content: "@Bot 检查图片" } },
          {
            msgtype: "image",
            image: { url: "https://example.com/image", aeskey: "private-key" },
          },
        ],
      },
    },
  };
}
function slackMessage() {
  return {
    type: "event_callback",
    team_id: "tenant",
    api_app_id: "app",
    event_id: "slack",
    event: {
      type: "app_mention",
      user: "alice",
      channel: "room",
      ts: "1780000000.123",
      text: "<@own-bot> 检查图片",
      files: [{ id: "image", name: "image.png", mimetype: "image/png" }],
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("group text and image ingestion", () => {
  it.each([false, true])(
    "resolves rich-post mention keys before group routing (localized=%s)",
    (localized) => {
      const event = normalizeFeishu(feishu, post(localized));
      expect(event).toMatchObject({
        mentioned: true,
        text: "检查图片 @Bob",
        attachments: [{ kind: "image", resourceId: "image" }],
      });
    },
  );
  it("keeps the first addressee rule with placeholder mentions", () => {
    const input = post(false, "@_user_2");
    expect(normalizeFeishu(feishu, input)?.mentioned).toBe(false);
    expect(normalizeFeishu(feishu, post(false, "@_missing"))?.mentioned).toBe(
      false,
    );
  });
  it.each(["feishu", "wecom", "slack"])(
    "queues %s group text and images together",
    (channel) => {
      const event =
        channel === "feishu"
          ? normalizeFeishu(feishu, post())
          : channel === "wecom"
            ? normalizeWecom(wecom, mixed())
            : normalizeSlack(slack, slackMessage());
      expect(event?.conversation.kind).toBe("group");
      expect(event?.text).toContain("检查图片");
      expect(event?.attachments).toHaveLength(1);
      const store = new GatewayStore(":memory:", "e".repeat(32));
      try {
        expect(new GatewayRouter(store).ingest(event)).toBe(true);
        expect(store.pending("incoming")[0]?.payload).toEqual(event);
      } finally {
        store.close();
      }
    },
  );
});

describe("privacy-safe rejection diagnostics", () => {
  it.each(["feishu", "wecom", "slack"])(
    "reports invalid %s events without input contents",
    (channel) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let result;
      if (channel === "feishu") {
        const input = post();
        input.event.message.message_id = "";
        result = normalizeFeishu(feishu, input);
      } else if (channel === "wecom") {
        const input = mixed();
        input.body.msgid = "";
        result = normalizeWecom(wecom, input);
      } else {
        const input = slackMessage();
        input.event_id = "";
        result = normalizeSlack(slack, input);
      }
      expect(result).toBeUndefined();
      expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
        channel,
        reason: "invalid-event",
        issues: expect.arrayContaining([
          { path: "messageId", code: "too_small" },
        ]),
      });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /检查图片|private-key|example.com|alice/,
      );
    },
  );
  it("reports malformed Feishu content and missing WeCom image resources", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = post();
    input.event.message.content = "{private-message";
    expect(normalizeFeishu(feishu, input)).toBeUndefined();
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({
      reason: "invalid-content",
      messageType: "post",
    });
    const callback = mixed();
    callback.body.mixed.msg_item[1]!.image!.url = "";
    expect(normalizeWecom(wecom, callback)?.text).toBe("检查图片");
    expect(JSON.parse(warn.mock.calls[1]![0])).toMatchObject({
      channel: "wecom",
      reason: "missing-resource",
      messageType: "mixed",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
  });
});
