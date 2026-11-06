import { useImSettingsState } from "./settings/use-im-settings-state.js";
import { useImSettingsSubscriptions } from "./settings/use-im-settings-subscriptions.js";
import { useImSettingsNavigation } from "./settings/use-im-settings-navigation.js";
import { createImBotFieldRenderer } from "./settings/create-im-bot-field-renderer.js";
import { useImChannelSelection } from "./settings/use-im-channel-selection.js";
import { createImIdentityActions } from "./settings/create-im-identity-actions.js";
import { useImFlowProgress } from "./settings/use-im-flow-progress.js";
import { createImGatewayRenderer } from "./settings/create-im-gateway-renderer.js";
import { createImBotActions } from "./settings/create-im-bot-actions.js";
import { createImBotFormRenderer } from "./settings/create-im-bot-form-renderer.js";
import { createImConnectionActions } from "./settings/create-im-connection-actions.js";
import { createImChannelSetupRenderers } from "./settings/create-im-channel-setup-renderers.js";
import { createImBotPaneRenderers } from "./settings/create-im-bot-pane-renderers.js";
import { createImBotProfileRenderer } from "./settings/create-im-bot-profile-renderer.js";
import { createImChannelBodyRenderer } from "./settings/create-im-channel-body-renderer.js";
import { createImPairingDialogs } from "./settings/create-im-pairing-dialogs.js";
import { createImVerificationRenderer } from "./settings/create-im-verification-renderer.js";
import { createImFlowCardsRenderer } from "./settings/create-im-flow-cards-renderer.js";

import { GroupCollaborationPanel } from "./GroupCollaborationPanel";
import { imNativeGroupChoices, imNativeGroupDirectory } from "./ImNativeGroups";
import { useEffect } from "react";

import { ImHandoff } from "./ImHandoff";
import { ImOutboundReview } from "./ImOutboundReview";
import {
  imIdentityKey,
  type AppLocale,
  type ImConnectionStatus,
  type ImSettings,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Desktop } from "@phosphor-icons/react";
import {
  Dialog,
  InlineNotice,
  LoadingState,
  Tooltip,
} from "@artemis/ui/feedback";
import { TextField } from "@artemis/ui/forms";

import { ManagementSection } from "@artemis/ui/management";
import { ArtemisIcon } from "@artemis/ui/icons";

import { imFirstPendingStep } from "./im-flow-derive";
import {
  imChannelLabel,
  imChannelConstraint,
  imConnectionHealth,
  type ImView,
  type ImChannel,
  type ImTranslate,
} from "./ImNavigation";

import { ImAccounts } from "./ImAccountControls";

import feishuChannelIcon from "../assets/feishu-channel.png";
import slackChannelIcon from "../assets/slack-channel.svg";

export function ImSettingsPanel({
  locale,
  initialPermissions = false,
}: {
  locale: AppLocale;
  initialPermissions?: boolean;
}) {
  const useImSettingsStateRuntime = useImSettingsState({
    locale,
    initialPermissions,
  });
  const {
    t,
    status,
    setStatus,
    settings,
    setSettings,
    projects,
    setProjects,
    url,
    setUrl,
    name,
    setName,
    adminToken,
    setAdminToken,
    message,
    setMessage,
    messageError,
    setMessageError,
    busy,
    setBusy,
    running,
    refreshEpoch,
    refreshError,
    setRefreshError,
    pairCode,
    setPairCode,
    screen,
    setScreen,
    botDialog,
    setBotDialog,
    botDialogTrigger,
    pairDialogId,
    setPairDialogId,
    pairDialogTrigger,
    connectionId,
    setConnectionId,
    compact,
    setCompact,
    focusTarget,
    setFocusTarget,
    panelRef,
    mounted,
    channel,
    setChannel,
    channelDetail,
    setChannelDetail,
    groupDetail,
    setGroupDetail,
    showRemote,
    setShowRemote,
    advancedDetail,
    setAdvancedDetail,
    channelPane,
    setChannelPane,
    selectedBotId,
    setSelectedBotId,
    credScan,
    setCredScan,
    channelDialogHeight,
    setChannelDialogHeight,
    createScanEpoch,
    setCreateScanEpoch,
    createScanOpen,
    setCreateScanOpen,
    fields,
    setFields,
    diagnostics,
    setDiagnostics,
    savedMetadata,
    setSavedMetadata,
    setSavingChannel,
    savedPending,
    setSavedPending,
    groupDialogTrigger,
    flowCard,
    setFlowCard,
    verify,
    setVerify,
    verifyTouched,
    taskSeen,
    setTaskSeen,
  } = useImSettingsStateRuntime;

  const useImSettingsSubscriptionsRuntime = useImSettingsSubscriptions({
    setSavedMetadata,
    setSavedPending,
    setSavingChannel,
    setDiagnostics,
    setPairCode,
    setFields,
    setAdminToken,
    status,
    messageError,
    message,
    setMessage,
    setStatus,
    setSettings,
    setUrl,
    setName,
    setProjects,
    setChannel,
    setConnectionId,
    running,
    refreshEpoch,
    groupDetail,
    setRefreshError,
    screen,
    flowCard,
    mounted,
    panelRef,
    setCompact,
    settings,
  });

  const connections = ((status?.connections ?? []) as ImConnectionStatus[]).map(
    (connection) =>
      refreshError && connection.state !== "disabled"
        ? { ...connection, state: "error" as const, error: refreshError }
        : connection,
  );
  const hasBot = connections.some((c) => c.state === "connected");
  const ready = hasBot && !!status?.identities.length;
  useEffect(() => {
    if (!focusTarget) return;
    const section = document.getElementById(focusTarget);
    section?.scrollIntoView?.({ block: "nearest" });
    section?.focus({ preventScroll: true });
    setFocusTarget("");
  }, [screen, focusTarget]);
  /**
   * 兼容旧分区目标的导航：渠道/分区都映射到对应步骤卡（流程或概览里
   * 共用），spaces 共用项目权限入口。undefined 的 screen 表示尚未显
   * 式导航，按完成度自动落在概览或流程。
   */
  const useImSettingsNavigationRuntime = useImSettingsNavigation({
    setFields,
    setAdminToken,
    setBotDialog,
    setFlowCard,
    setChannelDetail,
    setGroupDetail,
    setFocusTarget,
    setScreen,
    setChannel,
    setChannelPane,
    setSelectedBotId,
    setCredScan,
    connections,
    setConnectionId,
    verifyTouched,
    channel,
    setShowRemote,
    running,
    refreshEpoch,
    setBusy,
    setMessage,
    setMessageError,
    mounted,
    setPairCode,
    setStatus,
    setRefreshError,
    setSettings,
    t,
  });
  function selectView(
    next: ImView | "guide" | "flow" | "overview" | "group",
  ): ReturnType<typeof useImSettingsNavigationRuntime.selectView> {
    return useImSettingsNavigationRuntime.selectView(next);
  }
  function navigateStep(
    id: string,
  ): ReturnType<typeof useImSettingsNavigationRuntime.navigateStep> {
    return useImSettingsNavigationRuntime.navigateStep(id);
  }
  function flowSelectChannel(
    platform: ImChannel,
  ): ReturnType<typeof useImSettingsNavigationRuntime.flowSelectChannel> {
    return useImSettingsNavigationRuntime.flowSelectChannel(platform);
  }
  function run(
    action: () => Promise<unknown>,
  ): ReturnType<typeof useImSettingsNavigationRuntime.run> {
    return useImSettingsNavigationRuntime.run(action);
  }
  function generatePairCode(): ReturnType<
    typeof useImSettingsNavigationRuntime.generatePairCode
  > {
    return useImSettingsNavigationRuntime.generatePairCode();
  }
  function refresh(): ReturnType<
    typeof useImSettingsNavigationRuntime.refresh
  > {
    return useImSettingsNavigationRuntime.refresh();
  }
  function save(
    next: ImSettings,
  ): ReturnType<typeof useImSettingsNavigationRuntime.save> {
    return useImSettingsNavigationRuntime.save(next);
  }

  const createImBotFieldRendererRuntime = createImBotFieldRenderer({
    channel,
    t,
    fields,
    setFields,
    busy,
  });
  const { renderBotField } = createImBotFieldRendererRuntime;

  const channelConnections = connections.filter((c) => c.channel === channel);
  const selectedConnection =
    channelConnections.find(
      (c) => c.id === (pairDialogId || selectedBotId || connectionId),
    ) ?? channelConnections[0];
  /* 弹窗编辑目标连接的公开配置；新建时回退到刚保存未刷新的元数据。 */
  const dialogConnection = botDialog?.connectionId
    ? channelConnections.find((c) => c.id === botDialog.connectionId)
    : undefined;
  const dialogMetadata = dialogConnection
    ? {
        ...dialogConnection.configuration,
        id: dialogConnection.id,
        name: dialogConnection.name,
      }
    : undefined;
  const feishuTransport =
    fields.transport ?? dialogMetadata?.transport ?? "websocket";
  const feishuDomain =
    (fields.domain ?? dialogMetadata?.domain) === "lark" ? "lark" : "feishu";
  /* 配对说明跟随已保存连接的应用区域，不受弹窗表单中间态影响。 */
  const savedFeishuDomain =
    selectedConnection?.configuration?.domain ?? savedMetadata[channel]?.domain;
  const activePairingPlatform =
    channel === "feishu" && savedFeishuDomain === "lark" ? "lark" : channel;
  const pairingOptions = [
    { value: "wecom", label: t("ImNavigation.message2") },
    { value: "feishu", label: t("ImSettingsPanel.message22") },
    { value: "lark", label: t("ImSettingsPanel.message23") },
    { value: "slack", label: "Slack" },
  ] as const;
  const pairingPlatformLabel = pairingOptions.find(
    (option) => option.value === activePairingPlatform,
  )!.label;
  const local = !!status?.localGateway;
  const useImChannelSelectionRuntime = useImChannelSelection({
    groupDetail,
    local,
    status,
    setDiagnostics,
    run,
    channelDetail,
    channelConnections,
    setSelectedBotId,
    channel,
    panelRef,
    setChannelDialogHeight,
  });

  const createImIdentityActionsRuntime = createImIdentityActions({
    refresh,
    t,
    setMessage,
    get flowAdvanceFrom() {
      return flowAdvanceFrom;
    },
    setChannelDetail,
    setChannelPane,
    setFocusTarget,
    verifyTouched,
    run,
  });
  const { resolvePairing, unpairIdentity } = createImIdentityActionsRuntime;

  /* 机器人行下的从属账号：按连接过滤，无账号时 ImAccounts 渲染为空。 */
  const connectionAccounts = (connectionId: string) => (
    <ImAccounts
      key={`${screen}:${connectionId}`}
      t={t}
      busy={busy}
      identities={(status?.identities ?? []).filter(
        (i) => i.connectionId === connectionId,
      )}
      requests={[]}
      showAccounts={false}
      resolve={resolvePairing}
      unpair={unpairIdentity}
    />
  );
  /* 待确认的配对请求：内聚在配对码弹窗中审批。授权=配对完成，
     直接关弹窗；拒绝=换新码重来（旧码作废）。 */
  const pendingRequests = (
    <ImAccounts
      key={`${screen}:requests`}
      t={t}
      busy={busy}
      identities={[]}
      requests={status?.pairingRequests ?? []}
      showAccounts={false}
      resolve={async (requestId, approve) => {
        const ok = await resolvePairing(requestId, approve);
        if (!ok) return false;
        if (approve) setPairDialogId("");
        else void run(generatePairCode);
        return true;
      }}
      unpair={unpairIdentity}
    />
  );
  const fieldNames =
    channel === "slack"
      ? ["id", "name", "botToken", "appToken"]
      : [
          "id",
          "name",
          "tenantId",
          ...(channel === "wecom"
            ? ["botId", "secret"]
            : [
                "appId",
                "botOpenId",
                "appSecret",
                ...(feishuTransport === "webhook"
                  ? ["verificationToken", "encryptKey"]
                  : []),
              ]),
        ];
  const optionalFields = [
    "id",
    "name",
    ...(channel === "feishu" ? ["tenantId", "botOpenId"] : []),
  ];
  const requiredFields = fieldNames.filter(
    (field) => !optionalFields.includes(field),
  );
  const authorizedGroups = imNativeGroupDirectory(
    imNativeGroupChoices(
      undefined,
      status?.spaces ?? [],
      status?.settings.deviceId ?? "",
      t,
    ),
  ).flatMap(({ key, targets }) => {
    const byProject = new Map(
      targets.flatMap((target) =>
        target.saved?.nativeGroup
          ? [[target.saved.nativeGroup.projectId, target] as const]
          : [],
      ),
    );
    return [...byProject].map(([projectId, target]) => ({
      id: JSON.stringify([key, projectId]),
      name: target.displayName,
      label: target.label,
      projectId,
    }));
  });
  /** 显式完成动作（批准配对、保存启用成功）后解除钉住，交回自动跟随显示最早缺步卡。 */
  const useImFlowProgressRuntime = useImFlowProgress({
    setFlowCard,
    status,
    flowCard,
    screen,
    taskSeen,
    verify,
    t,
    setScreen,
    setVerify,
    setTaskSeen,
    setMessage,
  });
  const { flowSteps, allDone, activeScreen, taskDetected, verifyLabel } =
    useImFlowProgressRuntime;
  function flowAdvanceFrom(): ReturnType<
    typeof useImFlowProgressRuntime.flowAdvanceFrom
  > {
    return useImFlowProgressRuntime.flowAdvanceFrom();
  }

  if (!settings)
    return message ? (
      <InlineNotice tone="danger">{message}</InlineNotice>
    ) : (
      <LoadingState label={t("ImSettingsPanel.message31")} lines={3} />
    );

  const enableReason = !settings.deviceId
    ? t("ImSettingsPanel.message37")
    : !hasBot
      ? t("ImSettingsPanel.message36")
      : "";
  const activeSettings = settings;
  const createImGatewayRendererRuntime = createImGatewayRenderer({
    activeSettings,
    status,
    t,
    busy,
    setStatus,
    setSettings,
    setUrl,
    setName,
    setShowRemote,
    setAdminToken,
    setMessage,
    channel,
    selectView,
    setFocusTarget,
    run,
  });
  function renderGatewayBody(): ReturnType<
    typeof createImGatewayRendererRuntime.renderGatewayBody
  > {
    return createImGatewayRendererRuntime.renderGatewayBody();
  }

  const channelLogo = (platform: ImChannel, size: number) =>
    platform === "feishu" ? (
      <img
        alt=""
        aria-hidden="true"
        className="im-channel-logo"
        height={size}
        src={feishuChannelIcon}
        width={size}
      />
    ) : platform === "slack" ? (
      <img
        alt=""
        aria-hidden="true"
        className="im-channel-logo"
        height={size}
        src={slackChannelIcon}
        width={size}
      />
    ) : (
      <ArtemisIcon
        aria-hidden="true"
        name={platform}
        width={size}
        height={size}
      />
    );
  const createImBotActionsRuntime = createImBotActions({
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
  });
  const { openBotEditor, openBotPairing, saveBotForm } =
    createImBotActionsRuntime;

  /* 表单体：渠道字段 + 高级字段 +（远端）管理凭据；cancel 决定放弃时
     回到哪个界面。 */
  const createImBotFormRendererRuntime = createImBotFormRenderer({
    channel,
    t,
    feishuDomain,
    busy,
    setFields,
    renderBotField,
    requiredFields,
    feishuTransport,
    optionalFields,
    local,
    adminToken,
    setAdminToken,
    activeSettings,
    fields,
    saveBotForm,
  });
  const { renderBotForm } = createImBotFormRendererRuntime;

  const createImConnectionActionsRuntime = createImConnectionActions({
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
  });
  const {
    dismissBotDialog,
    dismissBotCreate,
    unpairConnection,
    removeConnection,
    connectScannedBot,
  } = createImConnectionActionsRuntime;

  /* 飞书扫码接入（官方应用注册流程）：空态首卡自动出码，创建页与
     关联凭据卡共用；onScanConnected 在共享接续（刷新+配对）前执行。 */
  const createImChannelSetupRenderersRuntime = createImChannelSetupRenderers({
    t,
    busy,
    activeSettings,
    connectScannedBot,
    connectionId,
    channel,
    feishuTransport,
    feishuDomain,
    setMessage,
    run,
    local,
    refresh,
  });
  const {
    renderFeishuScan,
    renderGuideBody,
    renderLegacyImport,
    renderWebhookCallback,
  } = createImChannelSetupRenderersRuntime;

  /* 创建页（ZCode 式）：新建占据右栏整卡。飞书=扫码优先（关联机器人
     卡头出码，不再展示凭据表单），保存后落回详情并选中新机器人；
     其余渠道走凭据表单。 */
  const createImBotPaneRenderersRuntime = createImBotPaneRenderers({
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
  });
  const {
    renderCreatePane,
    renderEmptyPane,
    pairingView,
    renderReplyModeCard,
  } = createImBotPaneRenderersRuntime;

  /* 机器人详情（ZCode 式）：头=logo+名称+行尾删除入口（配对态只在
     左栏导航卡展示）；下方为关联机器人 / 配对聊天 / 回复模式 设置卡。 */
  const createImBotProfileRendererRuntime = createImBotProfileRenderer({
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
  });
  const { renderBotProfile } = createImBotProfileRendererRuntime;

  const createImChannelBodyRendererRuntime = createImChannelBodyRenderer({
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
    get renderVerifyBody() {
      return renderVerifyBody;
    },
    renderCreatePane,
    renderEmptyPane,
    renderBotProfile,
    get renderBotDialog() {
      return renderBotDialog;
    },
    get renderPairDialog() {
      return renderPairDialog;
    },
  });
  function renderChannelBody(): ReturnType<
    typeof createImChannelBodyRendererRuntime.renderChannelBody
  > {
    return createImChannelBodyRendererRuntime.renderChannelBody();
  }

  const createImPairingDialogsRuntime = createImPairingDialogs({
    botDialog,
    t,
    dialogConnection,
    dismissBotDialog,
    renderBotForm,
    botDialogTrigger,
    pairDialogId,
    pairCode,
    activePairingPlatform,
    busy,
    activeSettings,
    generatePairCode,
    run,
    refresh,
    pairDialogTrigger,
    setPairDialogId,
    pendingRequests,
    pairingPlatformLabel,
    setMessage,
    setDiagnostics,
    setStatus,
    setSettings,
  });
  function renderBotDialog(): ReturnType<
    typeof createImPairingDialogsRuntime.renderBotDialog
  > {
    return createImPairingDialogsRuntime.renderBotDialog();
  }
  function renderPairDialog(): ReturnType<
    typeof createImPairingDialogsRuntime.renderPairDialog
  > {
    return createImPairingDialogsRuntime.renderPairDialog();
  }
  function refreshGroups(): ReturnType<
    typeof createImPairingDialogsRuntime.refreshGroups
  > {
    return createImPairingDialogsRuntime.refreshGroups();
  }

  /**
   * ②尾「顺手验证」折叠段（可选端到端验证，不计入完成链）：开合由用户
   */
  /* 验证内容体：渠道二级面板的「验证」页。 */
  const createImVerificationRendererRuntime = createImVerificationRenderer({
    status,
    t,
    activePairingPlatform,
    taskDetected,
    verify,
    busy,
    setVerify,
    channel,
    selectView,
  });
  function renderVerifyBody(): ReturnType<
    typeof createImVerificationRendererRuntime.renderVerifyBody
  > {
    return createImVerificationRendererRuntime.renderVerifyBody();
  }

  const createImFlowCardsRendererRuntime = createImFlowCardsRenderer({
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
  });
  function renderStepCards(): ReturnType<
    typeof createImFlowCardsRendererRuntime.renderStepCards
  > {
    return createImFlowCardsRendererRuntime.renderStepCards();
  }

  return (
    <div
      ref={panelRef}
      className="im-settings"
      data-mode={activeScreen === "flow" ? "wizard" : activeScreen}
      data-compact={compact}
    >
      {groupDetail && status && (
        <GroupCollaborationPanel
          status={status}
          diagnostics={diagnostics}
          projects={projects}
          locale={locale}
          refresh={refreshGroups}
          onClose={() => setGroupDetail(false)}
          returnFocusRef={groupDialogTrigger}
        />
      )}
      <header className="im-header">
        <span aria-hidden="true" className="im-header-mark">
          <ArtemisIcon name="mobile" />
        </span>
        <div className="im-header-copy">
          <h2>{t("ImSettingsPanel.message191")}</h2>{" "}
          <p>{t("Review02.imDescription")}</p>
        </div>
      </header>
      {message && (
        <InlineNotice
          id="im-feedback"
          tone={messageError ? "danger" : "info"}
          role={messageError ? "alert" : "status"}
        >
          {message}
        </InlineNotice>
      )}
      {refreshError && (
        <InlineNotice tone="warning">
          {t("ImSettingsPanel.message197")}
          {refreshError}
        </InlineNotice>
      )}
      {status?.error && (
        <InlineNotice tone="danger">{status.error}</InlineNotice>
      )}
      {activeScreen === "flow" ? (
        <div className="im-flow">
          {renderStepCards()}
          {allDone && (
            <Button onClick={() => selectView("overview")}>
              {t("ImSettingsPanel.message201")}
            </Button>
          )}
        </div>
      ) : (
        <div id="im-overview" className="im-flow im-overview" tabIndex={-1}>
          {!allDone && (
            <div className="im-overview-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setScreen("flow");
                  setFlowCard(imFirstPendingStep(flowSteps) ?? null);
                }}
              >
                {t("ImSettingsPanel.message198")}
              </Button>
            </div>
          )}
          {renderStepCards()}
        </div>
      )}
      {channelDetail && (
        /* 渠道二级面板弹窗（ZCode 式）：主从布局整幅入弹，宽 896px 对齐
           ZCode 弹窗标准；头部=渠道标+名+关闭。 */
        <Dialog
          className="im-detail-dialog im-channel-dialog"
          label={imChannelLabel(channel, t)}
          style={
            channelDialogHeight
              ? {
                  blockSize: `min(${channelDialogHeight}px, 88dvh, calc(100dvh - 52px))`,
                  minBlockSize: `min(${channelDialogHeight}px, 88dvh, calc(100dvh - 52px))`,
                  maxBlockSize: `min(${channelDialogHeight}px, 88dvh, calc(100dvh - 52px))`,
                }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) setChannelDetail(false);
          }}
          open
        >
          <header className="im-detail-dialog-head">
            {channelLogo(channel, 22)}
            <h2>{imChannelLabel(channel, t)}</h2>
            <button
              type="button"
              className="im-detail-dialog-close"
              aria-label={t("App_copy.renameClose")}
              onClick={() => setChannelDetail(false)}
            >
              <ArtemisIcon
                aria-hidden="true"
                height={14}
                name="close"
                width={14}
              />
            </button>
          </header>
          <div className="im-detail-dialog-body">{renderChannelBody()}</div>
        </Dialog>
      )}
      {showRemote && (
        /* 团队 Gateway 手动注册：与渠道弹窗同壳（560px 表单宽）。 */
        <Dialog
          className="im-detail-dialog im-remote-dialog"
          label={t("ImSettingsPanel.message46")}
          onOpenChange={(open) => {
            if (!open) setShowRemote(false);
          }}
          open
        >
          <header className="im-detail-dialog-head">
            <h2>{t("ImSettingsPanel.message46")}</h2>
            <button
              type="button"
              className="im-detail-dialog-close"
              aria-label={t("App_copy.renameClose")}
              onClick={() => setShowRemote(false)}
            >
              <ArtemisIcon
                aria-hidden="true"
                height={14}
                name="close"
                width={14}
              />
            </button>
          </header>
          <div className="im-detail-dialog-body">
            <ManagementSection
              title={t("ImSettingsPanel.message57")}
              description={t("ImSettingsPanel.message58")}
            >
              <TextField
                label={t("ImSettingsPanel.message47")}
                description={t("ImSettingsPanel.message48")}
                type="url"
                value={url}
                onValueChange={setUrl}
                placeholder="https://artemis.example.com"
                disabled={busy || settings.enabled}
              />
              <TextField
                label={t("ImSettingsPanel.message49")}
                description={t("ImSettingsPanel.message50")}
                value={name}
                onValueChange={setName}
                disabled={busy}
              />
              <TextField
                label={t("ImSettingsPanel.message51")}
                type="password"
                value={adminToken}
                onValueChange={setAdminToken}
                autoComplete="off"
                disabled={busy}
                description={t("ImSettingsPanel.message52")}
              />
              <div className="im-actions">
                <Button
                  disabled={busy || settings.enabled || !url || !adminToken}
                  onClick={() =>
                    void run(async () => {
                      const token = adminToken;
                      setAdminToken("");
                      await window.artemis.manageIm({
                        action: "register",
                        gatewayUrl: url,
                        name,
                        adminToken: token,
                      });
                      setPairCode(undefined);
                      const current = await window.artemis.getImStatus();
                      setStatus(current);
                      setSettings(current.settings);
                      setMessage(t("ImSettingsPanel.message54"));
                    })
                  }
                >
                  {t("ImSettingsPanel.message53")}
                </Button>
                <Button disabled={busy} onClick={() => void run(refresh)}>
                  {t("ImSettingsPanel.message55")}
                </Button>
              </div>
              <p>{t("ImSettingsPanel.message56")}</p>
            </ManagementSection>
          </div>
        </Dialog>
      )}
      {advancedDetail && (
        /* 「高级」：自托管 Gateway 说明与导出/本地命令，同壳弹窗。 */
        <Dialog
          className="im-detail-dialog im-advanced-dialog"
          label={t("ImSetupGuide.message4")}
          onOpenChange={(open) => {
            if (!open) setAdvancedDetail(false);
          }}
          open
        >
          <header className="im-detail-dialog-head">
            <h2>{t("ImSetupGuide.message4")}</h2>
            <button
              type="button"
              className="im-detail-dialog-close"
              aria-label={t("App_copy.renameClose")}
              onClick={() => setAdvancedDetail(false)}
            >
              <ArtemisIcon
                aria-hidden="true"
                height={14}
                name="close"
                width={14}
              />
            </button>
          </header>
          <div className="im-detail-dialog-body">
            {settings.deviceId && (
              <p
                className="im-identifier im-service-device-line"
                title={t("ImSettingsPanel.message44")}
              >
                <Desktop size={16} aria-hidden="true" />
                <span>{t("ImSettingsPanel.message44")}</span>
                <span className="im-device-id">{settings.deviceId}</span>
                <button
                  type="button"
                  className="im-capsule-btn"
                  onClick={() =>
                    void navigator.clipboard.writeText(settings.deviceId)
                  }
                >
                  {t("ImSettingsPanel.deviceCopy")}
                </button>
              </p>
            )}

            <p>{t("ImSetupGuide.message5")}</p>
            <div className="im-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setAdvancedDetail(false);
                  setShowRemote(true);
                }}
              >
                {t("ImSetupGuide.message6")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const path = await window.artemis.manageIm({
                      action: "export-gateway",
                    });
                    if (path)
                      setMessage(
                        t("ImSettingsPanel.message43", {
                          value1: String(path),
                        }),
                      );
                  })
                }
              >
                {t("ImSetupGuide.message7")}
              </Button>
            </div>
            <p>{t("ImSetupGuide.message8")}</p>
            <pre className="im-command">node gateway.mjs</pre>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** 机器人名跑马灯：静态省略号，悬停且溢出时双拷贝匀速滚动（≈30px/s）。 */
