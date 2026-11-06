import type { BotMetadata } from "./im-settings-values.js";
import { PUBLIC_BOT_FIELDS } from "./im-settings-values.js";

import { type ImConnectionStatus } from "@artemis/protocol";

import { imChannelLabel, type ImChannel } from "../ImNavigation";

interface CreateImBotActionsContext {
  readonly botDialogTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setBotDialog: import("react").Dispatch<
    import("react").SetStateAction<{ connectionId?: string } | null>
  >;
  readonly pairDialogTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly setPairDialogId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly generatePairCode: () => Promise<void>;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly channel: ImChannel;
  readonly setSavingChannel: import("react").Dispatch<
    import("react").SetStateAction<ImChannel | null>
  >;
  readonly adminToken: string;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly fields: Record<string, string>;
  readonly dialogMetadata:
    | {
        id: string;
        name: string;
        appId?: string;
        botId?: string;
        botOpenId?: string;
        domain?: string;
        tenantId?: string;
        transport?: string;
      }
    | undefined;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly feishuDomain: "feishu" | "lark";
  readonly local: boolean;
  readonly feishuTransport: string;
  readonly optionalFields: string[];
  readonly fieldNames: string[];
  readonly setConnectionId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSavedMetadata: import("react").Dispatch<
    import("react").SetStateAction<Partial<Record<ImChannel, BotMetadata>>>
  >;
  readonly setSavedPending: import("react").Dispatch<
    import("react").SetStateAction<Partial<Record<ImChannel, boolean>>>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly refresh: () => Promise<void>;
}
export function createImBotActions(context: CreateImBotActionsContext) {
  const {
    botDialogTrigger,
    setFields,
    setBotDialog,
    pairDialogTrigger,
    setPairDialogId,
    generatePairCode,
    run,
    channel,
    setSavingChannel,
    adminToken,
    setAdminToken,
    fields,
    dialogMetadata,
    t,
    feishuDomain,
    local,
    feishuTransport,
    optionalFields,
    fieldNames,
    setConnectionId,
    setSavedMetadata,
    setSavedPending,
    setMessage,
    refresh,
  } = context;
  const openBotEditor = (
    connection: ImConnectionStatus,
    trigger: HTMLButtonElement,
  ) => {
    botDialogTrigger.current = trigger;
    setFields(
      Object.fromEntries(
        PUBLIC_BOT_FIELDS.flatMap((key) =>
          typeof connection.configuration?.[key] === "string"
            ? [[key, connection.configuration[key]!]]
            : [],
        ),
      ),
    );
    setBotDialog({ connectionId: connection.id });
  };
  const openBotPairing = (
    connection: ImConnectionStatus,
    trigger: HTMLButtonElement,
  ) => {
    pairDialogTrigger.current = trigger;
    setPairDialogId(connection.id);
    /* 每次点「生成配对码」都换新码（新码即作废旧码），
       不沿用上次残留的码。 */
    void run(generatePairCode);
  };
  /* 新建（右栏创建页）与更换凭据（弹窗）共用的保存逻辑；dismiss 收到
     保存后的连接 id，决定保存成功后回到哪个界面。 */
  const saveBotForm = (dismiss: (savedId: string) => void) => {
    setSavingChannel(channel);
    void run(async () => {
      const token = adminToken;
      setAdminToken("");
      const savedId =
        fields.id?.trim() ||
        dialogMetadata?.id ||
        `${channel}-${crypto.randomUUID()}`;
      const savedName =
        fields.name?.trim() ||
        dialogMetadata?.name ||
        (channel === "feishu"
          ? feishuDomain === "lark"
            ? "Lark"
            : t("ImSettingsPanel.message90")
          : imChannelLabel(channel, t));
      await window.artemis.manageIm({
        action: "admin",
        operation: "connections",
        ...(local ? {} : { adminToken: token }),
        configuration: {
          channel,
          enabled: true,
          ...(channel === "feishu"
            ? {
                transport: feishuTransport,
                domain: feishuDomain,
              }
            : {}),
          ...Object.fromEntries(
            fieldNames
              .filter(
                (key) => !optionalFields.includes(key) || !!fields[key]?.trim(),
              )
              .map((key) => [key, fields[key]?.trim() ?? ""]),
          ),
          id: savedId,
          name: savedName,
        },
      });
      setConnectionId(savedId);
      setSavedMetadata((previous) => ({
        ...previous,
        [channel]: {
          ...Object.fromEntries(
            PUBLIC_BOT_FIELDS.flatMap((key) =>
              fields[key] ? [[key, fields[key]!.trim()]] : [],
            ),
          ),
          id: savedId,
          name: savedName,
          ...(channel === "feishu"
            ? {
                transport: feishuTransport,
                domain: feishuDomain,
              }
            : {}),
        },
      }));
      setFields({});
      dismiss(savedId);
      setSavedPending((previous) => ({
        ...previous,
        [channel]: true,
      }));
      setMessage(t("ImSettingsPanel.message91"));
      try {
        await refresh();
      } catch (error) {
        setMessage(
          t("ImSettingsPanel.message92", {
            value1: String(error),
          }),
        );
        return;
      }
      try {
        await generatePairCode();
        pairDialogTrigger.current = botDialogTrigger.current;
        setPairDialogId(savedId);
        setMessage(t("ImSettingsPanel.message93"));
      } catch (error) {
        setMessage(
          t("ImSettingsPanel.message94", {
            value1: String(error),
          }),
        );
      }
    }).finally(() => setSavingChannel(null));
  };
  return { openBotEditor, openBotPairing, saveBotForm };
}
