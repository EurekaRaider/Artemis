import type { Status, BotMetadata } from "./im-settings-values.js";
import { type ImConnectionStatus } from "@artemis/protocol";

import { type ImChannel } from "../ImNavigation";

import { type ImPairCode } from "../ImAccountControls";

interface CreateImConnectionActionsContext {
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
  readonly setBotDialog: import("react").Dispatch<
    import("react").SetStateAction<{ connectionId?: string } | null>
  >;
  readonly feishuDomain: "feishu" | "lark";
  readonly channel: ImChannel;
  readonly botDialog: { connectionId?: string } | null;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly status: Status | undefined;
  readonly refresh: () => Promise<void>;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly local: boolean;
  readonly setStatus: import("react").Dispatch<
    import("react").SetStateAction<Status | undefined>
  >;
  readonly setSavedMetadata: import("react").Dispatch<
    import("react").SetStateAction<Partial<Record<ImChannel, BotMetadata>>>
  >;
  readonly setConnectionId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setPairCode: import("react").Dispatch<
    import("react").SetStateAction<ImPairCode | undefined>
  >;
  readonly setFocusTarget: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setRefreshError: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly generatePairCode: () => Promise<void>;
  readonly setPairDialogId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
}
export function createImConnectionActions(
  context: CreateImConnectionActionsContext,
) {
  const {
    setSelectedBotId,
    setChannelPane,
    setBotDialog,
    feishuDomain,
    channel,
    botDialog,
    setFields,
    setAdminToken,
    status,
    refresh,
    t,
    setMessage,
    run,
    local,
    setStatus,
    setSavedMetadata,
    setConnectionId,
    setPairCode,
    setFocusTarget,
    setRefreshError,
    generatePairCode,
    setPairDialogId,
  } = context;
  const dismissBotDialog = (savedId?: string) => {
    if (savedId) {
      setSelectedBotId(savedId);
      setChannelPane("bot");
    }
    setBotDialog(null);
    setFields(
      channel === "feishu" && !botDialog?.connectionId && !savedId
        ? { domain: feishuDomain }
        : {},
    );
    setAdminToken("");
  };
  const dismissBotCreate = (savedId: string) => {
    /* 创建页保存后：回到机器人详情并选中新机器人（ZCode 同款动线）。 */
    setChannelPane("bot");
    setSelectedBotId(savedId);
    setFields({});
    setAdminToken("");
  };
  /* 解除授权（关联机器人卡）：解绑这条连接的全部绑定账号，连接
     本身不受影响，可用配对码重新绑定；与「删除机器人」分层。 */
  const unpairConnection = (connection: ImConnectionStatus) =>
    run(async () => {
      const bound = (status?.identities ?? []).filter(
        (identity) => identity.connectionId === connection.id,
      );
      for (const identity of bound) {
        await window.artemis.manageIm({ action: "unpair", identity });
      }
      await refresh();
      setMessage(t("ImSettingsPanel.message26"));
    });
  /* 删除机器人：危险卡内的垃圾桶入口，确认（与远端管理凭据）走
     ImConnectionRemoval 弹窗。 */
  const removeConnection =
    (connection: ImConnectionStatus) => (token: string) =>
      run(async () => {
        const id = connection.id;
        await window.artemis.manageIm({
          action: "admin",
          operation: "remove-connection",
          ...(local ? {} : { adminToken: token }),
          configuration: { id },
        });
        setStatus((previous) =>
          previous
            ? {
                ...previous,
                connections: (
                  previous.connections as ImConnectionStatus[]
                ).filter((c) => c.id !== id),
                identities: previous.identities.filter(
                  (i) => i.connectionId !== id,
                ),
                pairingRequests: (previous.pairingRequests ?? []).filter(
                  (r) => r.identity.connectionId !== id,
                ),
              }
            : previous,
        );
        setSavedMetadata((previous) => ({
          ...previous,
          [channel]: undefined,
        }));
        setConnectionId("");
        setFields({});
        setAdminToken("");
        setBotDialog(null);
        setPairCode(undefined);
        setFocusTarget("im-bot");
        setMessage(t("ImSettingsPanel.message75"));
        try {
          await refresh();
        } catch (error) {
          setRefreshError(String(error));
        }
      });
  /* 扫码建连后的共享接续（ZCode 动线）：刷新出连接、生成配对码并弹开
     配对弹窗；before 在接续前执行（创建页用它切回详情选中新机器人）。 */
  const connectScannedBot = (
    connectionId: string | undefined,
    before?: () => void,
  ) => {
    before?.();
    void run(async () => {
      await refresh();
      if (!connectionId) return;
      try {
        await generatePairCode();
        setPairDialogId(connectionId);
      } catch {
        // 配对码生成失败不打断：弹窗可从机器人详情随时重开。
      }
    });
  };
  return {
    dismissBotDialog,
    dismissBotCreate,
    unpairConnection,
    removeConnection,
    connectScannedBot,
  };
}
