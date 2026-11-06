import { TextField } from "@artemis/ui/forms";

import { type ImChannel } from "../ImNavigation";

interface CreateImBotFieldRendererContext {
  readonly channel: ImChannel;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly fields: Record<string, string>;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly busy: boolean;
}
export function createImBotFieldRenderer(
  context: CreateImBotFieldRendererContext,
) {
  const { channel, t, fields, setFields, busy } = context;
  const renderBotField = (field: string) => (
    <TextField
      key={`${channel}:${field}`}
      label={
        {
          id:
            channel === "slack"
              ? t("ImSettingsPanel.message3")
              : t("ImSettingsPanel.message2"),
          name:
            channel === "slack"
              ? t("ImSettingsPanel.message5")
              : t("ImSettingsPanel.message4"),
          tenantId:
            channel === "wecom"
              ? t("ImSettingsPanel.message7")
              : t("ImSettingsPanel.message6"),
          botToken: "Bot User OAuth Token",
          appToken: "App-Level Token",
          botId: "Bot ID",
          secret: "Bot Secret",
          appId: "App ID",
          botOpenId: t("ImSettingsPanel.message8"),
          appSecret: "App Secret",
          verificationToken: "Verification Token",
          encryptKey: "Encrypt Key",
        }[field]!
      }
      description={
        {
          id:
            channel === "slack"
              ? t("ImSettingsPanel.message10")
              : t("ImSettingsPanel.message9"),
          name: t("ImSettingsPanel.message11"),
          tenantId:
            channel === "wecom"
              ? t("ImSettingsPanel.message13")
              : t("ImSettingsPanel.message12"),
          botToken: t("ImSettingsPanel.message14"),
          appToken: t("ImSettingsPanel.message15"),
          botId: t("ImSettingsPanel.message16"),
          secret: t("ImSettingsPanel.message17"),
          botOpenId: t("ImSettingsPanel.message18"),
          verificationToken: t("ImSettingsPanel.message19"),
          encryptKey: t("ImSettingsPanel.message20"),
        }[field]
      }
      type={
        /secret|token|key/iu.test(field) && field !== "tenantId"
          ? "password"
          : "text"
      }
      value={fields[field] ?? ""}
      size="compact"
      onValueChange={(value) =>
        setFields((previous) => ({ ...previous, [field]: value }))
      }
      disabled={busy}
      autoComplete="off"
      spellCheck={false}
    />
  );
  return { renderBotField };
}
