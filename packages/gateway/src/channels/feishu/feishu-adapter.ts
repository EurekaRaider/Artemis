import { imText } from "../../i18n/im-localization.js";
import { feishuNativePost } from "./feishu-native.js";
import type { AppLocale } from "@artemis/protocol";
import { createHash } from "node:crypto";
import type {
  ChannelEvent,
  ImConversation,
  ImReply,
  ImGroupRoster,
} from "@artemis/protocol";
import type { ChannelConnection } from "../channel-connection.js";
import type {
  ChannelStatus,
  FeishuStreamCardState,
  ChannelAdapter,
} from "../channel-contracts.js";
import {
  ChannelUnavailable,
  ChannelRateLimit,
  DeliveryUncertain,
} from "../channel-errors.js";
import {
  record,
  string,
  validateMentionUserId,
  boundedResponse,
} from "../channel-values.js";
// Only explicit adapter mention targets may notify users; model-authored tags
// must remain literal when a reply is rendered as Markdown.
export function escapeFeishuMentions(text: string): string {
  return text.replace(/<\/?at\b[^>]*>/giu, (tag) =>
    tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  );
}

export class FeishuAdapter implements ChannelAdapter {
  private token = "";
  private tokenExpires = 0;
  private error: string | undefined;
  private refresh: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  constructor(
    readonly config: Extract<ChannelConnection, { channel: "feishu" }>,
  ) {}
  protected get apiOrigin(): string {
    return this.config.domain === "lark"
      ? "https://open.larksuite.com"
      : "https://open.feishu.cn";
  }
  start(): void {
    if (!this.config.enabled || !this.stopped) return;
    this.stopped = false;
    const check = () => {
      void this.accessToken()
        .then(() => {
          this.error = undefined;
        })
        .catch(() => {
          this.error =
            "Feishu authentication failed. Check app credentials and tenant access.";
        });
    };
    check();
    this.refresh = setInterval(check, 60000);
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.refresh);
  }
  status(): ChannelStatus {
    return {
      id: this.config.id,
      name: this.config.name,
      channel: "feishu",
      state: this.stopped
        ? "disabled"
        : this.error
          ? "error"
          : this.tokenExpires > Date.now()
            ? "connected"
            : "connecting",
      ...(this.error ? { error: this.error } : {}),
    };
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.tokenExpires > Date.now()) return this.token;
    const response = await fetch(
      `${this.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => {
      throw new ChannelUnavailable(
        "Feishu authentication is temporarily unavailable.",
      );
    });
    const body = record(
      await response.json().catch(() => {
        throw new ChannelUnavailable(
          "Feishu authentication response was incomplete.",
        );
      }),
    );
    if (!response.ok || body.code !== 0 || !string(body.tenant_access_token))
      throw new ChannelUnavailable("Feishu authentication failed.");
    this.token = body.tenant_access_token;
    this.tokenExpires =
      Date.now() + Math.max(0, (Number(body.expire) - 60) * 1000);
    return this.token;
  }
  async sendNative(
    conversation: ImConversation,
    text: string,
    key: string,
    recipient: string,
    locale?: AppLocale,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(recipient) && recipient !== "*")
      throw new Error("Invalid native bot identity.");
    return this.message(
      conversation,
      feishuNativePost(text, recipient, locale),
      "post",
      key,
    );
  }
  async publish(
    conversation: ImConversation,
    file: { name: string; data: Buffer },
    key: string,
    authorize: () => void,
  ) {
    authorize();
    const form = new FormData();
    form.set("file_type", "stream");
    form.set("file_name", file.name);
    form.set("file", new Blob([new Uint8Array(file.data)]), file.name);
    const token = await this.accessToken();
    authorize();
    const response = await fetch(`${this.apiOrigin}/open-apis/im/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }).catch(() => {
      throw new ChannelUnavailable("File upload is unavailable.");
    });
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 60,
      );
    const body = record(await response.json());
    const fileKey = string(record(body.data).file_key);
    if (!response.ok || body.code !== 0 || !fileKey)
      throw new Error("Feishu file upload was rejected.");
    authorize();
    return this.message(
      conversation,
      { file_key: fileKey },
      "file",
      key,
      undefined,
      authorize,
    );
  }
  async groupMembers(conversation: ImConversation): Promise<ImGroupRoster> {
    const members = new Map<string, ImGroupRoster["members"][number]>();
    const cursors = new Set<string>();
    let cursor = "";
    // The list endpoint returns both people and bots, unlike /members.
    let complete = false;
    let error: ImGroupRoster["error"];
    const signal = AbortSignal.timeout(10000);
    try {
      const token = await this.accessToken();
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({
          member_id_type: "open_id",
          page_size: "100",
        });
        if (cursor) query.set("page_token", cursor);
        const response = await fetch(
          `${this.apiOrigin}/open-apis/im/v1/chats/${encodeURIComponent(conversation.id)}/members/list?${query}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            signal,
          },
        );
        if (response.status === 429) {
          error = "rate-limited";
          break;
        }
        const body = record(await response.json());
        if (
          body.code === 99991672 ||
          body.code === 99991679 ||
          response.status === 403
        ) {
          error = "missing-scope";
          break;
        }
        const data = record(body.data);
        if (
          !response.ok ||
          body.code !== 0 ||
          !Array.isArray(data.users) ||
          !Array.isArray(data.bots) ||
          typeof data.has_more !== "boolean"
        )
          throw new ChannelUnavailable("Group members are unavailable.");
        let capped = false;
        for (const [values, kind] of [
          [data.users, "human"],
          [data.bots, "bot"],
        ] as const) {
          for (const value of values) {
            const item = record(value),
              userId = string(item.member_id);
            if (
              !userId ||
              (item.member_id_type !== undefined &&
                item.member_id_type !== "open_id")
            )
              throw new ChannelUnavailable("Invalid group member identity.");
            if (members.size >= 10000 && !members.has(userId)) {
              capped = true;
              break;
            }
            members.set(userId, {
              identity: {
                channel: "feishu",
                connectionId: this.config.id,
                tenantId: this.config.tenantId,
                appId: this.config.appId,
                userId,
              },
              name: (string(item.name) || userId).slice(0, 200),
              kind,
              ...(kind === "bot" && userId === this.config.botOpenId
                ? { self: true }
                : {}),
            });
          }
        }
        if (
          capped ||
          (Array.isArray(data.truncations) && data.truncations.length > 0)
        ) {
          error = "partial";
          break;
        }
        if (!data.has_more) {
          complete = true;
          break;
        }
        cursor = string(data.page_token);
        if (!cursor || cursors.has(cursor)) break;
        cursors.add(cursor);
      }
    } catch {
      error = "unavailable";
    }
    return {
      members: [...members.values()],
      complete,
      ...(!complete || error ? { error: error ?? "partial" } : {}),
    };
  }
  async groupInfo(conversation: ImConversation) {
    const response = await fetch(
      `${this.apiOrigin}/open-apis/im/v1/chats/${encodeURIComponent(conversation.id)}`,
      {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 60,
      );
    const body = record(await response.json());
    if (!response.ok || body.code !== 0)
      throw new ChannelUnavailable("Group information is unavailable.");
    const data = record(body.data);
    return {
      ...(string(data.name) ? { name: string(data.name).slice(0, 100) } : {}),
      ...(data.chat_status === "dissolved" ||
      data.chat_status === "dissolved_save"
        ? { unavailable: "dissolved" as const }
        : {}),
    };
  }
  async send(
    conversation: ImConversation,
    text: string,
    key: string,
    mentionUserId?: string,
  ): Promise<string> {
    const mention =
      mentionUserId && conversation.kind === "group"
        ? [[{ tag: "at", user_id: validateMentionUserId(mentionUserId) }]]
        : [];
    return this.message(
      conversation,
      {
        zh_cn: {
          content: [
            ...mention,
            [{ tag: "md", text: escapeFeishuMentions(text) }],
          ],
        },
      },
      "post",
      key,
    );
  }
  async statusCard(
    conversation: ImConversation,
    text: string,
    key: string,
    messageId?: string,
    locale?: AppLocale,
  ): Promise<string> {
    return this.message(
      conversation,
      {
        config: { wide_screen_mode: true, update_multi: true },
        header: {
          template: "blue",
          title: { tag: "plain_text", content: imText(locale, "cardTitle") },
        },
        elements: [
          {
            tag: "div",
            text: { tag: "lark_md", content: escapeFeishuMentions(text) },
          },
        ],
      },
      "interactive",
      key,
      messageId,
    );
  }
  /** Update one CardKit entity, preserving the existing status message. */
  async streamCard(
    conversation: ImConversation,
    text: string,
    key: string,
    state?: FeishuStreamCardState,
    streaming = true,
  ): Promise<FeishuStreamCardState> {
    const elementId = "reply_text";
    const content = text.slice(-30000);
    const card = {
      schema: "2.0",
      config: { streaming_mode: streaming, update_multi: true },
      body: {
        elements: [{ tag: "markdown", element_id: elementId, content }],
      },
    };
    if (state?.cardId) {
      const sequence = (state.sequence ?? 0) + 1;
      const uuid = createHash("sha256").update(key).digest("hex").slice(0, 32);
      if (streaming && state.streaming) {
        await this.cardkitRequest(
          `cards/${encodeURIComponent(state.cardId)}/elements/${elementId}/content`,
          "PUT",
          { content, sequence, uuid },
        );
      } else {
        // Full updates also close streaming mode on completion/waiting, or
        // reopen the same card when another turn starts.
        await this.cardkitRequest(
          `cards/${encodeURIComponent(state.cardId)}`,
          "PUT",
          {
            card: { type: "card_json", data: JSON.stringify(card) },
            sequence,
            uuid,
          },
        );
      }
      return { ...state, sequence, streaming };
    }
    // Obtain the card id before publishing anything: a confirmed creation
    // rejection can fall back without duplicating a message already sent.
    const created = await this.cardkitRequest("cards", "POST", {
      type: "card_json",
      data: JSON.stringify(card),
    });
    const cardId = string(record(created.data).card_id);
    if (!cardId)
      throw new Error("Feishu did not return a streaming card entity id.");
    const messageId = await this.message(
      conversation,
      { type: "card", data: { card_id: cardId } },
      "interactive",
      key,
      state?.messageId,
    );
    return {
      messageId,
      createdAt: state?.createdAt ?? Date.now(),
      cardId,
      sequence: 0,
      streaming,
    };
  }
  /** Shared CardKit REST plumbing with the same failure mapping as message(). */
  private async cardkitRequest(
    path: string,
    method: "POST" | "PUT",
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`${this.apiOrigin}/open-apis/cardkit/v1/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DeliveryUncertain(
        "Feishu streaming update could not be confirmed.",
      );
    }
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 30,
      );
    if (response.status >= 500)
      throw new DeliveryUncertain(
        "Feishu streaming server failed before confirming the update.",
      );
    let body: Record<string, any>;
    try {
      body = record(await response.json());
    } catch {
      throw new DeliveryUncertain("Feishu streaming response was incomplete.");
    }
    if (body.code === 230020 || body.code === 99991400)
      throw new ChannelRateLimit(30);
    if (body.code !== 0)
      throw new Error(
        `Feishu rejected the streaming update (${Number(body.code)}).`,
      );
    return body;
  }
  async approvalCard(
    conversation: ImConversation,
    text: string,
    key: string,
    approval: NonNullable<ImReply["approval"]>,
    locale?: AppLocale,
  ): Promise<string> {
    if (conversation.kind !== "direct")
      throw new Error("Approval cards require a direct conversation.");
    return this.message(
      conversation,
      {
        config: { wide_screen_mode: true, update_multi: true },
        header: {
          template: "orange",
          title: {
            tag: "plain_text",
            content: imText(locale, "approvalTitle"),
          },
        },
        elements: [
          { tag: "div", text: { tag: "plain_text", content: text } },
          {
            tag: "action",
            actions: (["yes", "no"] as const).map((decision) => ({
              tag: "button",
              type: decision === "yes" ? "primary" : "default",
              text: {
                tag: "plain_text",
                content: imText(
                  locale,
                  decision === "yes" ? "approveOnce" : "deny",
                ),
              },
              value: { artemisApprovalToken: approval.token, decision },
            })),
          },
        ],
      },
      "interactive",
      key,
    );
  }
  async typing(
    messageId: string,
    active: boolean,
    reactionId?: string,
  ): Promise<string | undefined> {
    const url = `${this.apiOrigin}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`;
    const headers = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
    };
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        headers,
        signal: AbortSignal.timeout(10000),
      });
      const body = record(await response.json());
      if (!response.ok || body.code !== 0)
        throw new Error(
          "Feishu Typing unavailable. Check message reaction permissions.",
        );
      return record(body.data);
    };
    if (!reactionId || !active) {
      reactionId = undefined;
      // Recover an acknowledged-lost reaction after a network failure/restart.
      // Only the current bot's Typing reaction is eligible for cleanup.
      let page = "";
      do {
        const data = await request(
          `${url}?reaction_type=Typing&page_size=50${page ? `&page_token=${encodeURIComponent(page)}` : ""}`,
        );
        const own = (Array.isArray(data.items) ? data.items : [])
          .map(record)
          .find(
            (item) =>
              record(item.operator).operator_type === "app" &&
              record(item.operator).operator_id === this.config.appId &&
              record(item.reaction_type).emoji_type === "Typing",
          );
        reactionId = own ? string(own.reaction_id) : undefined;
        page = data.has_more ? string(data.page_token) : "";
      } while (!reactionId && page);
    }
    if (active)
      return (
        reactionId ||
        string(
          (
            await request(url, {
              method: "POST",
              body: JSON.stringify({ reaction_type: { emoji_type: "Typing" } }),
            })
          ).reaction_id,
        ) ||
        undefined
      );
    if (reactionId)
      await request(`${url}/${encodeURIComponent(reactionId)}`, {
        method: "DELETE",
      });
    return undefined;
  }
  private async message(
    conversation: ImConversation,
    content: unknown,
    type: "text" | "post" | "interactive" | "file",
    key: string,
    messageId?: string,
    authorize?: () => void,
  ): Promise<string> {
    const token = await this.accessToken();
    authorize?.();
    let response: Response;
    try {
      response = await fetch(
        messageId
          ? `${this.apiOrigin}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`
          : `${this.apiOrigin}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: messageId ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: JSON.stringify(content),
            ...(messageId
              ? {}
              : {
                  receive_id: conversation.id,
                  msg_type: type,
                  uuid: createHash("sha256")
                    .update(key)
                    .digest("hex")
                    .slice(0, 32),
                }),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new DeliveryUncertain("Feishu delivery could not be confirmed.");
    }
    if (response.status === 429)
      throw new ChannelRateLimit(
        Number(response.headers.get("retry-after")) || 30,
      );
    if (response.status >= 500)
      throw new DeliveryUncertain(
        "Feishu server failed before confirming delivery.",
      );
    let body: Record<string, any>;
    try {
      body = record(await response.json());
    } catch {
      throw new DeliveryUncertain("Feishu delivery response was incomplete.");
    }
    if (body.code === 230020 || body.code === 99991400)
      throw new ChannelRateLimit(30);
    if (body.code !== 0)
      throw new Error(`Feishu rejected the message (${Number(body.code)}).`);
    const result = messageId || string(record(body.data).message_id);
    if (!result)
      throw new DeliveryUncertain("Feishu did not confirm the message ID.");
    return result;
  }
  async attachment(event: ChannelEvent, index: number) {
    const item = event.attachments[index];
    if (!item) throw new Error("Attachment does not exist.");
    const response = await fetch(
      `${this.apiOrigin}/open-apis/im/v1/messages/${encodeURIComponent(event.messageId)}/resources/${encodeURIComponent(item.resourceId)}?type=${item.kind}`,
      {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    return {
      data: await boundedResponse(response),
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
      name: item.name,
    };
  }
}
