import type { AppLocale } from "@artemis/protocol";
import { statusText } from "../shared/status-text.js";
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

export const diagnosticSchema = z.object({
  devices: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  identities: z.array(
    z.object({ deviceId: z.string(), identity: imIdentitySchema }),
  ),
  groups: z.array(
    z.object({
      conversation: imConversationSchema,
      name: z.string().optional(),
      platform: z.enum(["slack", "feishu", "lark", "wecom"]).optional(),
      nameError: z.string().optional(),
      lastSeenAt: z.number(),
      identities: z.array(imIdentitySchema).default([]),
    }),
  ),
  deliveries: z.array(z.object({ state: z.string(), count: z.number() })),
  ingress: z
    .array(
      z.object({ bucket: z.string(), state: z.string(), count: z.number() }),
    )
    .default([]),
  interactionErrors: z
    .array(
      z.object({
        connectionId: z.string(),
        kind: z.string(),
        error: z.string(),
      }),
    )
    .default([]),
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
  locale,
}: {
  value: unknown;
  editSpace(json: string): void;
  t: ImTranslate;
  locale: AppLocale;
}) {
  const parsed = diagnosticSchema.safeParse(value);
  return (
    <div className="im-diagnostics">
      {parsed.success ? (
        <>
          <h4>{t("ImDiagnostics.message2")}</h4>
          {!parsed.data.identities.length && (
            <p>{t("ImDiagnostics.message3")}</p>
          )}
          {parsed.data.identities.map(({ identity, deviceId }) => (
            <p className="im-identifier" key={imIdentityKey(identity)}>
              {identity.userId} · {imChannelLabel(identity.channel, t)} ·{" "}
              {deviceId}
            </p>
          ))}
          <h4>{t("ImDiagnostics.message4")}</h4>
          {!parsed.data.groups.length && <p>{t("ImDiagnostics.message5")}</p>}
          {parsed.data.groups.map(({ conversation }) => (
            <p
              className="im-identifier"
              key={`${conversation.connectionId}:${conversation.id}`}
            >
              {conversation.connectionId} · {conversation.id}
            </p>
          ))}
          <h4>{t("ImDiagnostics.message6")}</h4>
          {!parsed.data.deliveries.length && (
            <p>{t("ImDiagnostics.message7")}</p>
          )}
          {parsed.data.deliveries.map((delivery) => (
            <p key={delivery.state}>
              {statusText(locale, delivery.state)} · {delivery.count}
            </p>
          ))}
          {parsed.data.ingress.map((queue) => (
            <p key={`${queue.bucket}:${queue.state}`}>
              {statusText(locale, queue.bucket)} ·{" "}
              {statusText(locale, queue.state)} · {queue.count}
            </p>
          ))}
          {parsed.data.interactionErrors.map((issue, index) => (
            <InlineNotice
              tone="warning"
              key={`${issue.connectionId}:${issue.kind}:${index}`}
            >
              {issue.connectionId} · {issue.error}
            </InlineNotice>
          ))}
          {parsed.data.spaces.map((space) => (
            <Button
              key={space.id}
              onClick={() => editSpace(JSON.stringify(space, null, 2))}
            >
              {t("ImDiagnostics.message8")}
              {space.name}
            </Button>
          ))}
        </>
      ) : (
        <InlineNotice tone="warning">
          {t("ImDiagnostics.message1")}
        </InlineNotice>
      )}
      <details>
        <summary>{t("ImDiagnostics.message9")}</summary>
        <TextAreaField
          label={t("ImDiagnostics.message10")}
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
