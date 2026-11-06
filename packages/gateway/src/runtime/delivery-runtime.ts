import { imText } from "../i18n/im-localization.js";

import {
  imConversationKey,
  type RemoteInvocationContext,
} from "@artemis/protocol";

import { type Delivery } from "../router.js";

import type { FeishuTyping } from "../channels/feishu/feishu-typing.js";
import { type FeishuApprovalCard } from "../channels/feishu/feishu-approval.js";
import {
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
  type FeishuStreamCardState,
} from "../channels/channels.js";
import type { GatewayDependencies } from "./gateway-dependencies.js";
export function createGatewayDeliveryRuntime(
  services: Pick<
    GatewayDependencies,
    | "delivering"
    | "router"
    | "metadataJob"
    | "refreshNativeGroupInfo"
    | "refreshDiscoveredGroupNames"
    | "presenceRefreshAt"
    | "presenceJob"
    | "refreshMemberPresence"
    | "store"
    | "startMediaJobs"
    | "adapters"
  >,
) {
  async function tick(): Promise<void> {
    if (services.delivering) return;
    services.delivering = true;
    try {
      services.router.native.tick();
      // Provider metadata can take seconds. It must never hold the inbox/outbox
      // loop or prevent task completion/heartbeats from being delivered.
      services.metadataJob ??= services
        .refreshNativeGroupInfo()
        .then(() => services.refreshDiscoveredGroupNames())
        .catch(() => {})
        .finally(() => {
          services.metadataJob = undefined;
        });
      if (Date.now() >= services.presenceRefreshAt) {
        services.presenceRefreshAt = Date.now() + 5000;
        services.presenceJob ??= services
          .refreshMemberPresence()
          .catch(() => {})
          .finally(() => {
            services.presenceJob = undefined;
          });
      }
      services.router.processIncoming();
      // Keep publication receipts, but discard encrypted upload bodies once
      // there is no permitted automatic send left (including restart uncertainty).
      for (const file of services.store.list<{ id: string; sealed?: string }>(
        "native-files",
      )) {
        if (!file.sealed) continue;
        const pending = services.store.db
          .prepare(
            "SELECT 1 FROM queue WHERE bucket='outgoing' AND json_extract(payload,'$.fileId')=? AND state IN ('pending','sending') LIMIT 1",
          )
          .get(file.id);
        if (!pending) {
          const { sealed: _sealed, ...receipt } = file;
          services.store.put("native-files", file.id, receipt);
        }
      }
      services.startMediaJobs();
      await handlers.updateTyping();
      await handlers.closeApprovalCards();
      services.store.db
        .prepare(
          "DELETE FROM state WHERE namespace IN ('media-cache','artifacts') AND json_extract(value,'$.expiresAt')<=?",
        )
        .run(Date.now());
      services.store.db
        .prepare(
          "DELETE FROM state WHERE namespace='approval-results' AND json_extract(value,'$.expiresAt')<?",
        )
        .run(Date.now() - 7 * 86400000);
      const ready = [...services.adapters.entries()]
        .filter(([, adapter]) => adapter.status().state === "connected")
        .flatMap(([id]) => services.store.outgoing<Delivery>(id));
      for (const item of ready) {
        if (!services.router.canDeliver(item.payload)) {
          services.store.mark("outgoing", item.id, "revoked");
          continue;
        }
        const adapter = services.adapters.get(item.recipient);
        if (!adapter || adapter.status().state !== "connected") continue;
        const route = imConversationKey(item.payload.conversation);
        const throttle = services.store.get<{ next: number }>(
          "throttle",
          route,
        );
        if (throttle && throttle.next > Date.now()) continue;
        services.store.mark("outgoing", item.id, "sending");
        try {
          const cardKey = item.payload.cardKey
            ? JSON.stringify([
                item.payload.cardKey,
                route,
                item.payload.conversation.spaceRevision ?? "",
              ])
            : undefined;
          const card = cardKey
            ? services.store.get<FeishuStreamCardState>("status-cards", cardKey)
            : undefined;
          let messageId: string | undefined;
          const approval = item.payload.approval;
          if (item.payload.native) {
            if (!adapter.sendNative)
              throw new Error(
                "Native bot messaging is unavailable on this connection.",
              );
            messageId = await adapter.sendNative(
              item.payload.conversation,
              item.payload.text,
              item.id,
              item.payload.native.recipient,
              item.payload.native.locale,
            );
          } else if (item.payload.fileId) {
            const file = services.store.get<{ sealed?: string }>(
              "native-files",
              item.payload.fileId,
            );
            if (!file?.sealed || !adapter.publish)
              throw new Error("Native file is unavailable.");
            const content = services.store.unseal<{
              name: string;
              data: string;
            }>(file.sealed);
            messageId = await adapter.publish(
              item.payload.conversation,
              { name: content.name, data: Buffer.from(content.data, "base64") },
              item.id,
              () => {
                if (!services.router.canDeliver(item.payload))
                  throw new Error(
                    "File publication authorization was revoked.",
                  );
              },
            );
          } else if (
            approval &&
            adapter.approvalCard &&
            item.payload.invocationId
          ) {
            const request = services.store.get<RemoteInvocationContext>(
              "invocations",
              item.payload.invocationId,
            )!;
            const approvalKey = `${item.recipient}:${approval.token}`;
            const issued = services.store.get<FeishuApprovalCard>(
              "approval-cards",
              approvalKey,
            );
            if (
              !approval.resolved &&
              services.store.get("approval-results", approvalKey)
            ) {
              services.store.mark("outgoing", item.id, "done");
              continue;
            }
            if (approval.resolved || approval.expiresAt <= Date.now()) {
              // A terminal update has no buttons. Persist its closed state before
              // attempting the patch, so callbacks cannot race a slow platform API.
              if (issued) {
                // The router has already invalidated callbacks at receipt time.
                if (!issued.approval.resolved)
                  services.store.put("approval-cards", approvalKey, {
                    ...issued,
                    approval,
                    consumed: true,
                    closed: false,
                  });
              } else {
                messageId = await adapter.send(
                  item.payload.conversation,
                  item.payload.text,
                  `${item.id}:text`,
                );
              }
            } else if (!issued) {
              let interactive = false;
              try {
                messageId = await adapter.approvalCard(
                  item.payload.conversation,
                  item.payload.text,
                  item.id,
                  approval,
                  item.payload.locale,
                );
                interactive = true;
              } catch (error) {
                if (
                  error instanceof ChannelRateLimit ||
                  error instanceof ChannelUnavailable ||
                  error instanceof DeliveryUncertain
                )
                  throw error;
                messageId = await adapter.send(
                  item.payload.conversation,
                  `${imText(item.payload.locale, "cardFallback")}\n${item.payload.text}`,
                  `${item.id}:text`,
                );
              }
              // Keep persistence outside the confirmed-card-rejection fallback.
              // A storage failure after a successful send must not send again.
              if (interactive && messageId)
                services.store.put("approval-cards", approvalKey, {
                  approval,
                  ...(item.payload.locale
                    ? { locale: item.payload.locale }
                    : {}),
                  identity: request.identity,
                  conversation: item.payload.conversation,
                  invocationId: request.id,
                  messageId,
                } satisfies FeishuApprovalCard);
            }
          } else if (
            cardKey &&
            adapter.streamCard &&
            (item.payload.stream || card?.cardId)
          ) {
            const current =
              card && card.createdAt > Date.now() - 13 * 86400000
                ? card
                : undefined;
            let streamed: FeishuStreamCardState | undefined;
            try {
              streamed = await adapter.streamCard(
                item.payload.conversation,
                item.payload.text,
                item.id,
                current,
                Boolean(item.payload.stream),
              );
            } catch (error) {
              if (
                error instanceof ChannelRateLimit ||
                error instanceof ChannelUnavailable ||
                error instanceof DeliveryUncertain
              )
                throw error;
              // A confirmed streaming rejection (missing CardKit permission,
              // unsupported card) degrades to the shared status card path.
            }
            if (streamed) {
              services.store.put("status-cards", cardKey, streamed);
              messageId = streamed.messageId;
            } else if (adapter.statusCard) {
              try {
                messageId = await adapter.statusCard(
                  item.payload.conversation,
                  item.payload.text,
                  item.id,
                  current?.messageId,
                  item.payload.locale,
                );
                services.store.put("status-cards", cardKey, {
                  messageId,
                  createdAt: current?.createdAt ?? Date.now(),
                });
              } catch (error) {
                if (
                  error instanceof ChannelRateLimit ||
                  error instanceof ChannelUnavailable ||
                  error instanceof DeliveryUncertain
                )
                  throw error;
                if (item.payload.stream) throw error;
                messageId = await adapter.send(
                  item.payload.conversation,
                  item.payload.text,
                  `${item.id}:text`,
                );
              }
            }
          } else if (cardKey && adapter.statusCard) {
            try {
              const current =
                card && card.createdAt > Date.now() - 13 * 86400000
                  ? card
                  : undefined;
              messageId = await adapter.statusCard(
                item.payload.conversation,
                item.payload.text,
                item.id,
                current?.messageId,
                item.payload.locale,
              );
              services.store.put("status-cards", cardKey, {
                messageId,
                createdAt: current?.createdAt ?? Date.now(),
              });
            } catch (error) {
              if (
                error instanceof ChannelRateLimit ||
                error instanceof ChannelUnavailable ||
                error instanceof DeliveryUncertain
              )
                throw error;
              // A confirmed card rejection can fall back to text; an uncertain send must never be replayed.
              messageId = await adapter.send(
                item.payload.conversation,
                item.payload.text,
                `${item.id}:text`,
              );
            }
          } else
            messageId = await adapter.send(
              item.payload.conversation,
              item.payload.text,
              item.id,
              item.payload.mentionUserId,
            );
          services.store.transaction(() => {
            services.store.mark("outgoing", item.id, "done");
            services.store.put("throttle", route, { next: Date.now() + 4000 });
            if (messageId && item.payload.invocationId) {
              const request = services.store.get<RemoteInvocationContext>(
                "invocations",
                item.payload.invocationId,
              );
              if (request)
                services.store.put(
                  "message-map",
                  `${item.recipient}:${messageId}`,
                  { deviceId: request.deviceId, taskId: item.payload.taskId },
                );
            }
          });
        } catch (error) {
          const retry =
            error instanceof ChannelRateLimit ||
            error instanceof ChannelUnavailable;
          services.store.mark(
            "outgoing",
            item.id,
            !services.router.canDeliver(item.payload)
              ? "revoked"
              : retry && item.attempts < 100
                ? "pending"
                : error instanceof DeliveryUncertain
                  ? "uncertain"
                  : "failed",
            Date.now() +
              (error instanceof ChannelRateLimit
                ? Math.max(1, error.seconds) * 1000
                : Math.min(300000, 5000 * 2 ** Math.min(item.attempts, 6))),
          );
        }
      }
    } finally {
      services.delivering = false;
    }
  }

  async function closeApprovalCards(): Promise<void> {
    for (const card of services.store.list<FeishuApprovalCard>(
      "approval-cards",
    )) {
      const key = `${card.identity.connectionId}:${card.approval.token}`;
      if (card.approval.expiresAt < Date.now() - 7 * 86400000) {
        services.store.delete("approval-cards", key);
        continue;
      }
      const revoked = !services.router.canDeliver({
        conversation: card.conversation,
        invocationId: card.invocationId,
        text: "",
      });
      const expired = card.approval.expiresAt <= Date.now();
      if (
        (!card.consumed && !expired && !revoked) ||
        card.closed ||
        (card.retryAt ?? 0) > Date.now()
      )
        continue;
      const adapter = services.adapters.get(card.identity.connectionId);
      if (!adapter?.statusCard || adapter.status().state !== "connected")
        continue;
      const text = revoked
        ? imText(card.locale, "approvalRevoked")
        : card.approval.resolved === "approved"
          ? imText(card.locale, "approved")
          : card.approval.resolved === "denied"
            ? imText(card.locale, "denied")
            : expired
              ? imText(card.locale, "approvalExpired")
              : imText(card.locale, "approvalSubmitted");
      try {
        await adapter.statusCard(
          card.conversation,
          text,
          `${key}:closed`,
          card.messageId,
          card.locale,
        );
        const current = services.store.get<FeishuApprovalCard>(
          "approval-cards",
          key,
        );
        if (!current) continue;
        services.store.put("approval-cards", key, {
          ...current,
          consumed: true,
          closed: current.approval.resolved === card.approval.resolved,
          retryAt: undefined,
        });
      } catch {
        // Patching a known message is idempotent. Failed updates remain pending;
        // identity, expiry and desktop one-shot checks already deny reuse.
        services.store.put("approval-cards", key, {
          ...(services.store.get<FeishuApprovalCard>("approval-cards", key) ??
            card),
          retryAt: Date.now() + 30000,
        });
      }
    }
  }

  async function updateTyping(stopping = false): Promise<void> {
    for (const activity of services.store.list<FeishuTyping>("feishu-typing")) {
      const key = `${activity.connectionId}:${activity.messageId}`;
      const adapter = services.adapters.get(activity.connectionId);
      if (!adapter?.typing) {
        services.store.delete("feishu-typing", key);
        continue;
      }
      const active =
        !stopping &&
        activity.active &&
        activity.expiresAt > Date.now() &&
        adapter.status().state !== "disabled" &&
        services.router.canDeliver({ ...activity, text: "" });
      if (active && activity.reactionId) continue;
      if (!stopping && (activity.retryAt ?? 0) > Date.now()) continue;
      try {
        const reactionId = await adapter.typing(
          activity.messageId,
          active,
          activity.reactionId,
        );
        const current = services.store.get<FeishuTyping>("feishu-typing", key);
        if (active || current?.active !== activity.active)
          services.store.put("feishu-typing", key, {
            ...(current ?? activity),
            reactionId,
            error: undefined,
            retryAt: undefined,
          });
        else services.store.delete("feishu-typing", key);
      } catch {
        services.store.put("feishu-typing", key, {
          ...(services.store.get<FeishuTyping>("feishu-typing", key) ??
            activity),
          ...(stopping ? { active: false } : {}),
          retryAt: Date.now() + 30000,
          error: "typing-update-failed",
        });
      }
    }
  }
  const handlers = { tick, closeApprovalCards, updateTyping };
  return handlers;
}
