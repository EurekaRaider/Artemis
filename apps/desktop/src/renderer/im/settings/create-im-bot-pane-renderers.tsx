import type { Status } from "./im-settings-values.js";
import { type ImConnectionStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { Select } from "@artemis/ui/forms";
import { SegmentedControl } from "@artemis/ui/navigation";

import { ArtemisIcon } from "@artemis/ui/icons";

import { ImSlackAutoSetup } from "../ImSlackAutoSetup";

import {
  imChannelLabel,
  imConnectionLabel,
  type ImChannel,
} from "../ImNavigation";
import { imAggregateConnectionStates } from "@artemis/protocol";

import { ImFeishuScan } from "../ImFeishuScan";

interface CreateImBotPaneRenderersContext {
  readonly channel: ImChannel;
  readonly channelLogo: (
    platform: ImChannel,
    size: number,
  ) => import("react").JSX.Element;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly dismissBotCreate: (savedId: string) => void;
  readonly renderBotForm: (
    cancel: (savedId: string) => void,
  ) => import("react").JSX.Element;
  readonly feishuDomain: "feishu" | "lark";
  readonly busy: boolean;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setCreateScanOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly activeSettings: {
    enabled: boolean;
    gatewayUrl: string;
    deviceId: string;
    deviceName: string;
    defaultProjectId: string;
    grants: {
      projectId: string;
      policyVersion?: string | undefined;
      tokenBudget?: number | undefined;
      approval: "ask" | "automatic";
      mode: "codemode" | "plan" | "work";
      network: boolean;
      shell: boolean;
      groups: string[];
      expiresAt: number;
      security?:
        | {
            version: 2;
            revision: string;
            confirmedAt: number;
            scopes: {
              audience: string;
              revision?: string | undefined;
              contextRevision?: string | undefined;
              confirmedAt?: number | undefined;
              localAccess?: "full" | "project" | undefined;
              readMode?: "project" | "selected" | undefined;
              writeMode?: "project" | "selected" | undefined;
              spaceRevision?: string | undefined;
              filePaths?: string[] | undefined;
              readPaths: string[];
              writePaths: string[];
            }[];
          }
        | undefined;
    }[];
  };
  readonly setCreateScanEpoch: import("react").Dispatch<
    import("react").SetStateAction<number>
  >;
  readonly createScanOpen: boolean;
  readonly createScanEpoch: number;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly connectScannedBot: (
    connectionId: string | undefined,
    before?: () => void,
  ) => void;
  readonly local: boolean;
  readonly connections: ImConnectionStatus[];
  readonly savedPending: Partial<Record<ImChannel, boolean>>;
  readonly status: Status | undefined;
}
export function createImBotPaneRenderers(
  context: CreateImBotPaneRenderersContext,
) {
  const {
    channel,
    channelLogo,
    t,
    dismissBotCreate,
    renderBotForm,
    feishuDomain,
    busy,
    setFields,
    setCreateScanOpen,
    activeSettings,
    setCreateScanEpoch,
    createScanOpen,
    createScanEpoch,
    setChannelPane,
    setSelectedBotId,
    connectScannedBot,
    local,
    connections,
    savedPending,
    status,
  } = context;
  const renderCreatePane = () => (
    <div className="im-bot-pane" id="im-bot-create" tabIndex={-1}>
      <div className="im-bot-create">
        <div className="im-bot-create-head">
          {channelLogo(channel, 28)}
          <strong>{t("ImSettingsPanel.message76")}</strong>
        </div>
        {channel === "slack" && local ? (
          <ImSlackAutoSetup
            t={t}
            busy={busy}
            disabled={!activeSettings.deviceId}
            connections={connections.filter(
              (connection) => connection.channel === "slack",
            )}
            onConnected={(id) =>
              connectScannedBot(id, () => {
                setChannelPane("bot");
                setSelectedBotId(id);
              })
            }
          />
        ) : channel === "feishu" && local ? (
          <>
            <SegmentedControl
              label={t("ImSettingsPanel.message78")}
              size="compact"
              value={feishuDomain}
              disabled={busy}
              options={[
                { value: "feishu", label: t("ImSettingsPanel.message22") },
                { value: "lark", label: t("ImSettingsPanel.message23") },
              ]}
              onValueChange={(domain) => {
                setFields((previous) => ({ ...previous, domain }));
                setCreateScanOpen(true);
              }}
            />
            <div className="im-bot-section" data-scan-open>
              <div className="im-bot-section-copy">
                <strong>{t("ImSettingsPanel.botScanTitle")}</strong>
                <p>{t("ImSettingsPanel.botScanDesc")}</p>
              </div>
              <div className="im-bot-section-actions">
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={busy || !activeSettings.deviceId}
                  onClick={() => {
                    setCreateScanEpoch((value) => value + 1);
                    setCreateScanOpen(true);
                  }}
                >
                  <ArtemisIcon
                    aria-hidden="true"
                    height={13}
                    name="qr-code"
                    width={13}
                  />
                  {t("ImFeishuScan.message10")}
                </Button>
              </div>
              {createScanOpen && (
                <div className="im-bot-scan">
                  <ImFeishuScan
                    key={feishuDomain}
                    domain={feishuDomain}
                    refreshSignal={createScanEpoch}
                    t={t}
                    autoStart
                    bare
                    busy={busy}
                    disabled={!activeSettings.deviceId}
                    onIdle={() => setCreateScanOpen(false)}
                    onConnected={(connectionId) => {
                      connectScannedBot(connectionId, () => {
                        if (connectionId) {
                          setChannelPane("bot");
                          setSelectedBotId(connectionId);
                        }
                      });
                    }}
                  />
                </div>
              )}
            </div>
            {renderReplyModeCard()}
          </>
        ) : (
          renderBotForm(dismissBotCreate)
        )}
      </div>
    </div>
  );
  /* 已无选中机器人时的右栏：飞书直接落创建页（首个 bot 未建时右侧
     不再是旧空态卡）；其余渠道保留空态文案卡。 */
  const renderEmptyPane = () =>
    channel === "feishu" || (channel === "slack" && local) ? (
      renderCreatePane()
    ) : (
      <div className="im-bot-join">
        <strong>{imChannelLabel(channel, t)}</strong>
        <p>
          {savedPending[channel]
            ? t("ImSettingsPanel.message68")
            : t("ImSettingsPanel.message67")}
        </p>
      </div>
    );
  /* 已连接的机器人按绑定态标注（导航卡/状态行/关联机器人卡共用）：
     绿「已授权」/ 黄「待授权」；未连接仍显示连接状态本身。 */
  const pairingView = (connection: ImConnectionStatus) => {
    const state = imAggregateConnectionStates([connection.state]);
    const paired = (status?.identities ?? []).some(
      (identity) => identity.connectionId === connection.id,
    );
    return {
      state,
      paired,
      dot: state === "connected" ? (paired ? "connected" : "warning") : state,
      label:
        state === "connected"
          ? paired
            ? t("ImSettingsPanel.botPairedLabel")
            : t("ImSettingsPanel.botUnpairedLabel")
          : imConnectionLabel(state, t),
    } as const;
  };
  /* 回复形态说明（ZCode 同款说明卡）：飞书固定流式卡片；
     创建页与机器人详情（删除卡上方）共用。 */
  const renderReplyModeCard = (domain: string = feishuDomain) => (
    <div className="im-bot-section">
      <div className="im-bot-section-copy">
        <strong>{t("ImSettingsPanel.botReplyModeTitle")}</strong>
        <p>
          {t("ImSettingsPanel.botReplyModeDesc", {
            platform:
              domain === "lark" ? "Lark" : t("ImSettingsPanel.message90"),
          })}
        </p>
      </div>
      <div className="im-bot-section-actions">
        <Select
          className="im-reply-mode-select"
          labelVisibility="hidden"
          label={t("ImSettingsPanel.botReplyModeTitle")}
          value="streaming"
          disabled
          options={[
            {
              value: "streaming",
              label: t("ImSettingsPanel.botReplyModeValue"),
            },
          ]}
          onValueChange={() => {}}
        />
      </div>
    </div>
  );
  return {
    renderCreatePane,
    renderEmptyPane,
    pairingView,
    renderReplyModeCard,
  };
}
