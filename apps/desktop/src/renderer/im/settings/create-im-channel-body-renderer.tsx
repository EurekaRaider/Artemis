import { ImMarqueeText } from "./im-settings-values.js";

import { type ImConnectionStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { InlineNotice } from "@artemis/ui/feedback";

import { ArtemisIcon } from "@artemis/ui/icons";

import { type ImChannel } from "../ImNavigation";

interface CreateImChannelBodyRendererContext {
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
  readonly selectedBotId: string;
  readonly channelConnections: ImConnectionStatus[];
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly busy: boolean;
  readonly channelPane: "bot" | "create" | "guide" | "import" | "verify";
  readonly channel: ImChannel;
  readonly botDialogTrigger: import("react").RefObject<HTMLButtonElement | null>;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
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
  readonly channelLogo: (
    platform: ImChannel,
    size: number,
  ) => import("react").JSX.Element;
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly verifyLabel: string;
  readonly navigateStep: (id: string) => void;
  readonly renderGuideBody: () => import("react").JSX.Element;
  readonly renderLegacyImport: () => import("react").JSX.Element;
  readonly renderVerifyBody: () => import("react").JSX.Element;
  readonly renderCreatePane: () => import("react").JSX.Element;
  readonly renderEmptyPane: () => import("react").JSX.Element;
  readonly renderBotProfile: (
    connection: ImConnectionStatus,
  ) => import("react").JSX.Element;
  readonly renderBotDialog: () => import("react").JSX.Element;
  readonly renderPairDialog: () => import("react").JSX.Element;
}
export function createImChannelBodyRenderer(
  context: CreateImChannelBodyRendererContext,
) {
  const {
    activeSettings,
    selectedBotId,
    channelConnections,
    t,
    busy,
    channelPane,
    channel,
    botDialogTrigger,
    setFields,
    setAdminToken,
    setChannelPane,
    pairingView,
    channelLogo,
    setSelectedBotId,
    verifyLabel,
    navigateStep,
    renderGuideBody,
    renderLegacyImport,
    renderCreatePane,
    renderEmptyPane,
    renderBotProfile,
  } = context;
  function renderChannelBody() {
    const settings = activeSettings;
    const selected =
      channelConnections.find((c) => c.id === selectedBotId) ??
      channelConnections[0];
    return (
      <section
        id="im-bot"
        className="im-channel-body im-channel-md"
        tabIndex={-1}
      >
        {/* ZCode 式主从：左栏 = 新建入口 + 机器人卡 + 设置行（指引/导入/
            验证）；右栏随选中切换，默认落在首个机器人详情。 */}
        <div className="im-bot-nav">
          <button
            type="button"
            className="im-bot-new"
            disabled={busy}
            data-selected={
              channelPane === "create" ||
              (channel === "feishu" && !channelConnections.length) ||
              undefined
            }
            aria-label={t("ImSettingsPanel.message65")}
            onClick={(event) => {
              /* ZCode 式：新建不弹独立弹窗，右栏整卡切换为创建表单。 */
              botDialogTrigger.current = event.currentTarget;
              setFields({});
              setAdminToken("");
              setChannelPane("create");
            }}
          >
            <ArtemisIcon
              aria-hidden="true"
              height={20}
              name="bot-add"
              width={20}
            />
            <span>{t("ImSettingsPanel.message65")}</span>
          </button>
          {channelConnections.map((connection) => {
            const pairing = pairingView(connection);
            return (
              <button
                type="button"
                key={connection.id}
                className="im-bot-card"
                data-selected={
                  (channelPane === "bot" && selected?.id === connection.id) ||
                  undefined
                }
                onClick={() => {
                  setSelectedBotId(connection.id);
                  setChannelPane("bot");
                }}
              >
                {channelLogo(channel, 20)}
                <strong className="im-bot-card-name">
                  <ImMarqueeText text={connection.name} />
                </strong>
                <span className="im-bot-card-state">
                  <span
                    aria-hidden="true"
                    className="im-dot"
                    data-state={pairing.dot}
                  />
                  {pairing.label}
                </span>
              </button>
            );
          })}
          <div aria-hidden="true" className="im-bot-nav-divider" />
          <button
            type="button"
            className="im-bot-nav-row"
            data-selected={channelPane === "guide" || undefined}
            onClick={() => setChannelPane("guide")}
          >
            <span>{t("ImSettingsPanel.message59")}</span>
            <span aria-hidden="true" className="im-bot-nav-caret">
              ›
            </span>
          </button>
          {channel === "feishu" && (
            <button
              type="button"
              className="im-bot-nav-row"
              data-selected={channelPane === "import" || undefined}
              onClick={() => setChannelPane("import")}
            >
              <span>{t("ImLegacyImport.message1")}</span>
              <span aria-hidden="true" className="im-bot-nav-caret">
                ›
              </span>
            </button>
          )}
          <button
            type="button"
            className="im-bot-nav-row"
            data-selected={channelPane === "verify" || undefined}
            onClick={() => setChannelPane("verify")}
          >
            <span>{verifyLabel}</span>
            <span aria-hidden="true" className="im-bot-nav-caret">
              ›
            </span>
          </button>
        </div>
        <div className="im-bot-detail">
          {!settings.deviceId && (
            <InlineNotice tone="info">
              <p>{t("ImSettingsPanel.message61")}</p>
              <Button onClick={() => navigateStep("im-prepare")}>
                {t("ImSettingsPanel.message62")}
              </Button>
            </InlineNotice>
          )}
          {channelPane === "guide" && (
            <div className="im-bot-pane">{renderGuideBody()}</div>
          )}
          {channelPane === "import" && channel === "feishu" && (
            <div className="im-bot-pane">{renderLegacyImport()}</div>
          )}
          {channelPane === "verify" && (
            <div className="im-bot-pane" id="im-verify" tabIndex={-1}>
              {context.renderVerifyBody()}
            </div>
          )}
          {channelPane === "create" && renderCreatePane()}
          {channelPane === "bot" &&
            (selected ? renderBotProfile(selected) : renderEmptyPane())}
        </div>
        {context.renderBotDialog()}
        {context.renderPairDialog()}
      </section>
    );
  }
  return { renderChannelBody };
}
