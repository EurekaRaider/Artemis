import type { Status } from "./im-settings-values.js";
import {
  type ImConnectionStatus,
  type ImSettings,
  type Project,
} from "@artemis/protocol";

import { PlugsConnected } from "@phosphor-icons/react";

import { ArtemisIcon } from "@artemis/ui/icons";
import { ImGatewayInstructions } from "../ImSetupGuide";

import {
  IM_CHANNELS,
  imChannelLabel,
  imChannelConnectionState,
  imConnectionLabel,
  type ImChannel,
} from "../ImNavigation";

interface CreateImFlowCardsRendererContext {
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
  readonly status: Status | undefined;
  readonly connections: ImConnectionStatus[];
  readonly savedPending: Partial<Record<ImChannel, boolean>>;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly channelLogo: (
    platform: ImChannel,
    size: number,
  ) => import("react").JSX.Element;
  readonly flowSelectChannel: (platform: ImChannel) => void;
  readonly setChannelDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setGroupDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setChannelPane: import("react").Dispatch<
    import("react").SetStateAction<
      "bot" | "create" | "guide" | "import" | "verify"
    >
  >;
  readonly setSelectedBotId: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setCredScan: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly activeScreen: "flow" | "overview";
  readonly enableReason: string;
  readonly busy: boolean;
  readonly setStatus: import("react").Dispatch<
    import("react").SetStateAction<Status | undefined>
  >;
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<ImSettings | undefined>
  >;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly renderGatewayBody: () => import("react").JSX.Element;
  readonly authorizedGroups: {
    id: string;
    name: string;
    label: string;
    projectId: string;
  }[];
  readonly projects: Project[];
  readonly groupDialogTrigger: import("react").RefObject<HTMLButtonElement | null | null>;
  readonly setAdvancedDetail: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setShowRemote: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function createImFlowCardsRenderer(
  context: CreateImFlowCardsRendererContext,
) {
  const {
    activeSettings,
    status,
    connections,
    savedPending,
    t,
    channelLogo,
    flowSelectChannel,
    setChannelDetail,
    setGroupDetail,
    setChannelPane,
    setSelectedBotId,
    setCredScan,
    activeScreen,
    enableReason,
    busy,
    setStatus,
    setSettings,
    run,
    renderGatewayBody,
    authorizedGroups,
    projects,
    groupDialogTrigger,
    setAdvancedDetail,
    setShowRemote,
  } = context;
  function renderStepCards() {
    const settings = activeSettings;
    const serviceEnabled = status?.settings.enabled ?? settings.enabled;
    /* 渠道行 = 品牌图标 + 渠道名 + 信号灯 + 一行状态；已配置（有连接或
       已存凭据）渠道名提亮。授权是设备级全局共用，行上不重复计数。 */
    const channelRow = (platform: ImChannel) => {
      const platformConnections = connections.filter(
        (c) => c.channel === platform,
      );
      const state = imChannelConnectionState(platformConnections, {
        savedCredentials: !!savedPending[platform],
      });
      const lit =
        state === "connected" ||
        state === "error" ||
        state === "partial_error" ||
        state === "connecting";
      const configured =
        platformConnections.length > 0 || !!savedPending[platform];
      const summary = !configured
        ? `${imConnectionLabel("unconfigured", t)} · ${t(platform === "feishu" ? "Review03.scanConnect" : "Review03.appConnect")}`
        : state === "connected"
          ? imConnectionLabel("connected", t)
          : imConnectionLabel(state, t);
      return (
        <button
          type="button"
          key={platform}
          className="im-channel-row"
          data-connection-state={state}
          data-configured={configured || undefined}
          onClick={() => {
            flowSelectChannel(platform);
            setChannelDetail(true);
            setGroupDetail(false);
            setChannelPane("bot");
            setSelectedBotId("");
            setCredScan(false);
          }}
        >
          {channelLogo(platform, 20)}
          <span className="im-channel-row-copy">
            <strong>{imChannelLabel(platform, t)}</strong>
            <span className="im-channel-row-summary">
              {lit ? (
                <span
                  aria-hidden="true"
                  className="im-dot"
                  data-state={state}
                />
              ) : null}
              {summary}
              {configured && state === "connected" && (
                <>
                  <ArtemisIcon
                    aria-hidden="true"
                    className="im-channel-row-bots"
                    name="bot"
                    width={13}
                    height={13}
                  />
                  <span className="im-channel-row-bots-count">
                    · {platformConnections.length}
                  </span>
                </>
              )}
            </span>
          </span>
          <span aria-hidden="true" className="im-capsule-btn">
            {configured
              ? t("ImSettingsPanel.goManage")
              : t("ImSettingsPanel.goConfigure")}
          </span>
        </button>
      );
    };
    return (
      <div className="im-two-col">
        {/* 左栏：这台电脑是谁（服务）。固定标题+内容，不再折叠。 */}
        <div className="im-col-left">
          <section className="im-service-block" id="im-gateway" tabIndex={-1}>
            <div className="im-service-head">
              <ArtemisIcon
                aria-hidden="true"
                name="chat"
                width={24}
                height={24}
              />
              <span className="im-local-service-copy">
                <strong>{t("Review02.localMessageService")}</strong>
                <small>{t("Review02.localMessageServiceHint")}</small>
              </span>
              {(activeScreen === "overview" ||
                (activeScreen === "flow" && !!status?.settings.deviceId)) && (
                <span
                  className="im-service-capsule"
                  data-state={serviceEnabled ? "connected" : "error"}
                >
                  <span
                    aria-hidden="true"
                    className="im-dot"
                    data-state={serviceEnabled ? "connected" : "error"}
                  />
                  {serviceEnabled
                    ? t("ImSettingsPanel.serviceReady")
                    : t("ImSettingsPanel.serviceDisconnected")}
                </span>
              )}
              <div
                className="im-service-state"
                title={t("ImSettingsPanel.message196")}
              >
                {/* 电源图标即状态：绿+连接 / 红+断开（正向态展示，D1 首跑无开关）。 */}
                {(activeScreen === "overview" ||
                  (activeScreen === "flow" && !!status?.settings.deviceId)) && (
                  <>
                    {!settings.enabled && enableReason && (
                      <span className="im-power-reason">{enableReason}</span>
                    )}
                    {/* 状态胶囊已移至标题左侧；此处仅剩连接/断开动作钮。 */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={
                        status?.settings.enabled ?? settings.enabled
                      }
                      aria-label={t("ImSettingsPanel.message194")}
                      title={
                        (status?.settings.enabled ?? settings.enabled)
                          ? t("ImSettingsPanel.message195")
                          : t("ImSettingsPanel.message194")
                      }
                      disabled={busy || (!settings.enabled && !!enableReason)}
                      className="im-power-toggle"
                      data-state={
                        (status?.settings.enabled ?? settings.enabled)
                          ? "on"
                          : "off"
                      }
                      onClick={() =>
                        void run(async () => {
                          const enabled = !(
                            status?.settings.enabled ?? settings.enabled
                          );
                          const current = await window.artemis.saveImSettings({
                            ...status!.settings,
                            enabled,
                          });
                          setStatus((previous) => ({
                            ...previous,
                            ...current,
                          }));
                          setSettings((draft) =>
                            draft
                              ? { ...draft, enabled: current.settings.enabled }
                              : current.settings,
                          );
                        })
                      }
                    >
                      <span>
                        {settings.enabled || status?.settings.enabled
                          ? t("ImSettingsPanel.powerStop")
                          : t("ImSettingsPanel.powerConnected")}
                      </span>
                    </button>
                  </>
                )}
              </div>
              {renderGatewayBody()}
            </div>
          </section>
        </div>
        {/* 右栏：门（渠道）。渠道与群聊授权卡片↔ 详情下钻。 */}
        <div className="im-col-right">
          <section
            className="im-channel-list"
            aria-label={t("ImSettingsPanel.imChannelsTitle")}
          >
            <div className="im-channel-list-head">
              <ArtemisIcon
                aria-hidden="true"
                name="message"
                width={24}
                height={24}
              />
              <strong>{t("ImSettingsPanel.imChannelsTitle")}</strong>
            </div>
            {IM_CHANNELS.filter((platform) => platform !== "wecom").map(
              channelRow,
            )}
          </section>
          <section className="im-group-authorization-summary">
            <h3>{t("ImSettingsPanel.message165")}</h3>
            {authorizedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className="im-channel-row im-channel-group-row"
                onClick={(event) => {
                  groupDialogTrigger.current = event.currentTarget;
                  setChannelDetail(false);
                  setGroupDetail(true);
                }}
              >
                <ArtemisIcon name="agents" width={16} height={16} />
                <span className="im-channel-row-copy">
                  <strong>
                    {authorizedGroups.some(
                      (other) =>
                        other.id !== group.id &&
                        other.name === group.name &&
                        other.projectId === group.projectId,
                    )
                      ? group.label
                      : group.name}{" "}
                    →{" "}
                    {projects.find((project) => project.id === group.projectId)
                      ?.name ?? group.projectId}
                  </strong>
                </span>
                <span className="im-capsule-btn">
                  {t("ImSettingsPanel.goManage")}
                </span>
              </button>
            ))}
            {!authorizedGroups.length && (
              <button
                type="button"
                className="im-channel-row im-channel-group-row"
                onClick={(event) => {
                  groupDialogTrigger.current = event.currentTarget;
                  setChannelDetail(false);
                  setGroupDetail(true);
                }}
              >
                <ArtemisIcon name="agents" width={16} height={16} />
                <span className="im-channel-row-copy">
                  <small>{t("ImSettingsPanel.message166")}</small>
                </span>
                <span className="im-capsule-btn">
                  {t("Review02.addAuthorization")}
                </span>
              </button>
            )}
          </section>
        </div>
        <details className="im-advanced-entries">
          <summary>
            <ArtemisIcon
              className="disclosure-chevron"
              name="chevron"
              width={12}
              height={12}
            />
            {t("Review02.imAdvanced")}
          </summary>
          <section id="im-prepare" tabIndex={-1}>
            <ImGatewayInstructions
              t={t}
              onOpen={() => setAdvancedDetail(true)}
            />
          </section>
          <section id="im-device" tabIndex={-1}>
            {/* 入口卡：点击进入整幅二级卡（与「高级」同模式）。 */}
            <button
              type="button"
              className="im-gateway-fold"
              onClick={() => setShowRemote(true)}
            >
              <span className="im-gateway-fold-head">
                <span className="im-gateway-entry-icon">
                  <PlugsConnected
                    size={20}
                    weight="duotone"
                    aria-hidden="true"
                  />
                </span>
                {t("ImSettingsPanel.message46")}
              </span>
            </button>
          </section>
        </details>
      </div>
    );
  }
  return { renderStepCards };
}
