import { describe, expect, it } from "vitest";
import {
  normalizeFeishuApproval,
  type FeishuApprovalCard,
} from "../src/feishu-approval.js";

const card: FeishuApprovalCard = {
  approval: { token: "61db1320-c03c-40cf-8c52-05982a30e331", expiresAt: 2000 },
  identity: {
    channel: "feishu",
    connectionId: "f",
    tenantId: "tenant",
    appId: "app",
    userId: "owner",
  },
  conversation: { connectionId: "f", kind: "direct", id: "direct-chat" },
  invocationId: "invocation",
  messageId: "card-message",
};
const callback = () => ({
  header: {
    event_type: "card.action.trigger",
    event_id: "event",
    app_id: "app",
    tenant_key: "tenant",
  },
  event: {
    operator: { open_id: "owner" },
    context: { open_chat_id: "direct-chat", open_message_id: "card-message" },
    action: {
      value: { artemisApprovalToken: card.approval.token, decision: "yes" },
    },
  },
});
describe("authenticated Feishu approval cards", () => {
  it("constructs the existing one-shot command only for its issued direct-chat card", () => {
    expect(normalizeFeishuApproval(callback(), card, 1000)).toMatchObject({
      conversation: card.conversation,
      identity: card.identity,
      text: `/approve ${card.approval.token} yes`,
    });
  });
  it.each([
    "app",
    "tenant",
    "operator",
    "chat",
    "message",
    "token",
    "decision",
  ])("rejects a mismatched %s", (field) => {
    const input = callback();
    if (field === "app") input.header.app_id = "other";
    if (field === "tenant") input.header.tenant_key = "other";
    if (field === "operator") input.event.operator.open_id = "other";
    if (field === "chat") input.event.context.open_chat_id = "other";
    if (field === "message") input.event.context.open_message_id = "other";
    if (field === "token")
      input.event.action.value.artemisApprovalToken = "other";
    if (field === "decision") input.event.action.value.decision = "always";
    expect(normalizeFeishuApproval(input, card, 1000)).toBeUndefined();
  });
  it("rejects expiry, replay and group cards", () => {
    expect(normalizeFeishuApproval(callback(), card, 2000)).toBeUndefined();
    expect(
      normalizeFeishuApproval(callback(), { ...card, consumed: true }, 1000),
    ).toBeUndefined();
    expect(
      normalizeFeishuApproval(
        callback(),
        { ...card, conversation: { ...card.conversation, kind: "group" } },
        1000,
      ),
    ).toBeUndefined();
  });
});
