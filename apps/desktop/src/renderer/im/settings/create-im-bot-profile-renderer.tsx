import { type ImConnectionStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { InlineNotice } from "@artemis/ui/feedback";

import { ArtemisIcon } from "@artemis/ui/icons";

import { type ImChannel } from "../ImNavigation";

import { ImConnectionRemoval } from "../ImConnectionRemoval";

interface CreateImBotProfileRendererContext {
  readonly pairingView: (connection: ImConnectionStatus) => {
    readonly state:
      | "connected"
      | "connecting"
      | "error"
      | "partial_error"
      | "saved"
      | "saving"
      | "unconfigured";
    readonly paired: boolean;
    readonly dot:
      | "connected"
      | "connecting"
      | "error"
      | "partial_error"
      | "saved"
      | "saving"
      | "unconfigured"
      | "warning";
    readonly label: string;
  };
  readonly channel: ImChannel;
  readonly channelLogo: (
    platform: ImChannel,
    size: number,
  ) => import("react").JSX.Element;
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
  readonly local: boolean;
  readonly busy: boolean;
  readonly message: string;
  readonly messageError: boolean;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly removeConnection: (
    connection: ImConnectionStatus,
  ) => (token: string) => Promise<boolean>;
  readonly openBotEditor: (
    connection: ImConnectionStatus,
    trigger: HTMLButtonElement,
  ) => void;
  readonly setCredScan: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly unpairConnection: (
    connection: ImConnectionStatus,
  ) => Promise<boolean>;
  readonly credScan: boolean;
  readonly renderFeishuScan: (
    autoStart: boolean,
    domain: "feishu" | "lark",
    onScanConnected?: (connectionId?: string) => void,
  ) => import("react").JSX.Element;
  readonly openBotPairing: (
    connection: ImConnectionStatus,
    trigger: HTMLButtonElement,
  ) => void;
  readonly connectionAccounts: (
    connectionId: string,
  ) => import("react").JSX.Element;
  readonly renderWebhookCallback: (
    connection: ImConnectionStatus,
  ) => import("react").JSX.Element | null;
  readonly renderReplyModeCard: (
    domain?: string,
  ) => import("react").JSX.Element;
}
export function createImBotProfileRenderer(
  context: CreateImBotProfileRendererContext,
) {
  const {
    pairingView,
    channel,
    channelLogo,
    activeSettings,
    local,
    busy,
    message,
    messageError,
    t,
    removeConnection,
    openBotEditor,
    setCredScan,
    unpairConnection,
    credScan,
    renderFeishuScan,
    openBotPairing,
    connectionAccounts,
    renderWebhookCallback,
    renderReplyModeCard,
  } = context;
  const renderBotProfile = (connection: ImConnectionStatus) => {
    const domain =
      connection.configuration?.domain === "lark" ? "lark" : "feishu";
    const pairing = pairingView(connection);
    const state = pairing.state;
    return (
      <div className="im-bot-profile">
        <div className="im-bot-profile-head">
          {channelLogo(channel, 28)}
          <div className="im-bot-profile-heading">
            <strong>{connection.name}</strong>
          </div>
          <ImConnectionRemoval
            key={`${activeSettings.deviceId}:${connection.id}`}
            name={connection.name}
            local={local}
            busy={busy}
            error={messageError ? message : undefined}
            t={t}
            remove={removeConnection(connection)}
          />
        </div>
        {connection.error && (
          <InlineNotice tone="danger">{connection.error}</InlineNotice>
        )}
        {channel === "feishu" ? (
          /* 关联机器人卡（ZCode 同款）：左侧说明，右侧动作；
             已授权给「解除授权」（解绑账号，可重新配对），未连通保留扫码入口。 */
          <div
            className="im-bot-section"
            data-scan-open={credScan || undefined}
          >
            <div className="im-bot-section-copy">
              <strong>{t("ImSettingsPanel.botScanTitle")}</strong>
              <p>{t("ImSettingsPanel.botScanDesc")}</p>
            </div>
            <div className="im-bot-section-actions">
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                label={t("ImSettingsPanel.message69", {
                  value1: connection.name,
                })}
                onClick={(event) =>
                  openBotEditor(connection, event.currentTarget)
                }
              >
                {t("ImSettingsPanel.message70")}
              </Button>
              {state === "connected" ? (
                pairing.paired && (
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={busy}
                    label={t("ImSettingsPanel.botUnbindLabel", {
                      value1: connection.name,
                    })}
                    onClick={() => unpairConnection(connection)}
                  >
                    {t("ImSettingsPanel.botUnbindAction")}
                  </Button>
                )
              ) : local ? (
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={busy || !activeSettings.deviceId}
                  onClick={() => setCredScan((open) => !open)}
                >
                  <ArtemisIcon
                    aria-hidden="true"
                    height={13}
                    name="qr-code"
                    width={13}
                  />
                  {t("ImFeishuScan.message10")}
                </Button>
              ) : null}
            </div>
            {credScan && (
              <div className="im-bot-scan">
                {renderFeishuScan(true, domain)}
              </div>
            )}
          </div>
        ) : (
          <div className="im-bot-section">
            <div className="im-bot-section-copy">
              <strong>{t("ImSettingsPanel.botCredTitle")}</strong>
              <p>{t("ImSettingsPanel.botCredDesc")}</p>
            </div>
            <div className="im-bot-section-actions">
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                label={t("ImSettingsPanel.message69", {
                  value1: connection.name,
                })}
                onClick={(event) =>
                  openBotEditor(connection, event.currentTarget)
                }
              >
                {t("ImSettingsPanel.message70")}
              </Button>
            </div>
          </div>
        )}
        <div className="im-bot-section">
          <div className="im-bot-section-copy">
            <strong>{t("ImSettingsPanel.botPairTitle")}</strong>
            <p>{t("ImSettingsPanel.botPairDesc")}</p>
          </div>
          <div className="im-bot-section-actions">
            <Button
              variant="quiet"
              size="compact"
              disabled={busy || !activeSettings.deviceId}
              label={t("ImSettingsPanel.message73", {
                value1: connection.name,
              })}
              onClick={(event) =>
                openBotPairing(connection, event.currentTarget)
              }
            >
              {t("ImSettingsPanel.message74")}
            </Button>
          </div>
        </div>
        {/* 从属账号：属于这条连接的已绑定账号，挂在配对卡下。 */}
        {connectionAccounts(connection.id)}
        {renderWebhookCallback(connection)}
        {channel === "feishu" && renderReplyModeCard(domain)}
      </div>
    );
  };
  return { renderBotProfile };
}
