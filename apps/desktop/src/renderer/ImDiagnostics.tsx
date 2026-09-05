import { z } from "zod";
import {
  imConversationSchema,
  imIdentitySchema,
  imIdentityKey,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { TextAreaField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import { imChannelLabel, type ImTranslate } from "./ImNavigation";

const diagnosticSchema = z.object({
  identities: z.array(
    z.object({ deviceId: z.string(), identity: imIdentitySchema }),
  ),
  groups: z.array(
    z.object({ conversation: imConversationSchema, lastSeenAt: z.number() }),
  ),
  deliveries: z.array(z.object({ state: z.string(), count: z.number() })),
  spaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      endpoints: z.array(imConversationSchema),
      participants: z.array(
        z.object({
          deviceId: z.string(),
          identity: imIdentitySchema,
          name: z.string(),
        }),
      ),
      administrators: z.array(imIdentitySchema),
    }),
  ),
});

export function ImDiagnostics({
  value,
  editSpace,
  t,
}: {
  value: unknown;
  editSpace(json: string): void;
  t: ImTranslate;
}) {
  const parsed = diagnosticSchema.safeParse(value);
  return (
    <div className="im-diagnostics">
      {parsed.success ? (
        <>
          <h4>{t("已配对成员", "Paired members")}</h4>
          {!parsed.data.identities.length && (
            <p>{t("尚无已配对成员", "No paired members")}</p>
          )}
          {parsed.data.identities.map(({ identity, deviceId }) => (
            <p className="im-identifier" key={imIdentityKey(identity)}>
              {identity.userId} · {imChannelLabel(identity.channel, t)} ·{" "}
              {deviceId}
            </p>
          ))}
          <h4>{t("已发现群聊", "Discovered groups")}</h4>
          {!parsed.data.groups.length && (
            <p>
              {t(
                "尚未发现群聊。请已配对管理员在目标群 @机器人发送 /help。",
                "No groups discovered. A paired administrator should mention the bot with /help in the target group.",
              )}
            </p>
          )}
          {parsed.data.groups.map(({ conversation }) => (
            <p
              className="im-identifier"
              key={`${conversation.connectionId}:${conversation.id}`}
            >
              {conversation.connectionId} · {conversation.id}
            </p>
          ))}
          <h4>{t("投递状态", "Delivery status")}</h4>
          {!parsed.data.deliveries.length && (
            <p>{t("暂无投递记录", "No deliveries recorded")}</p>
          )}
          {parsed.data.deliveries.map((delivery) => (
            <p key={delivery.state}>
              {delivery.state} · {delivery.count}
            </p>
          ))}
          {parsed.data.spaces.map((space) => (
            <Button
              key={space.id}
              onClick={() => editSpace(JSON.stringify(space, null, 2))}
            >
              {t("编辑空间：", "Edit space: ")}
              {space.name}
            </Button>
          ))}
        </>
      ) : (
        <InlineNotice tone="warning">
          {t(
            "无法识别诊断格式，请核对 Gateway 版本。",
            "Unrecognized diagnostics. Check the Gateway version.",
          )}
        </InlineNotice>
      )}
      <details>
        <summary>{t("查看原始诊断 JSON", "View raw diagnostics JSON")}</summary>
        <TextAreaField
          label={t("管理状态", "Administration status")}
          value={JSON.stringify(value, null, 2)}
          onValueChange={() => {}}
          readOnly
          rows={10}
          spellCheck={false}
        />
      </details>
    </div>
  );
}
