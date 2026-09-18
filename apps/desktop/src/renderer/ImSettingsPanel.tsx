import { uiTranslator } from "../shared/ui-text.js";
import { ImNativeGroups } from "./ImNativeGroups";
import { useEffect, useRef, useState } from "react";
import { ImDataPermissions } from "./ImDataPermissions";
import { ImHandoff } from "./ImHandoff";
import { ImOutboundReview } from "./ImOutboundReview";
import {
  executionGrantSchema,
  IM_ADHOC_PROJECT_ID,
  IM_SECURITY_VERSION,
  type AppLocale,
  type ExecutionGrant,
  type ImConnectionStatus,
  type ImIdentity,
  type ImSettings,
  type ImStatus,
  type CollaborationSpace,
  type Project,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import {
  Dialog,
  InlineNotice,
  LoadingState,
  Tooltip,
} from "@artemis/ui/feedback";
import { Checkbox, Select, Switch, TextField } from "@artemis/ui/forms";
import { ManagementSection } from "@artemis/ui/management";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ImGatewayInstructions, ImFirstTaskInstructions } from "./ImSetupGuide";

import { ImSlackSetup, slackAppManifest } from "./ImSlackSetup";
import { imRetryEnable, imSaveAndEnable } from "./im-save-enable";
import { ImFlowCard } from "./ImFlowCard";
import {
  imFirstPendingStep,
  imFlowProgress,
  imFlowSteps,
  imReadVerify,
  imWriteVerify,
  type ImFlowStepId,
  type ImVerifyState,
} from "./im-flow-derive";
import {
  IM_CHANNELS,
  imChannelLabel,
  imChannelConstraint,
  imChannelConnectionState,
  imConnectionHealth,
  imConnectionLabel,
  imConnectionSummary,
  type ImView,
  type ImChannel,
  type ImTranslate,
} from "./ImNavigation";
import { imAggregateConnectionStates } from "@artemis/protocol";
import {
  ImAccounts,
  ImPairingCode,
  type ImPairCode,
} from "./ImAccountControls";

import { ImPlatformSetup } from "./ImPlatformSetup";
import { ImFeishuScan } from "./ImFeishuScan";
import { ImLegacyImport } from "./ImLegacyImport";
import { ImConnectionRemoval } from "./ImConnectionRemoval";

const PUBLIC_BOT_FIELDS = [
  "id",
  "name",
  "tenantId",
  "botId",
  "appId",
  "botOpenId",
  "transport",
  "domain",
] as const;
type BotMetadata = Partial<Record<(typeof PUBLIC_BOT_FIELDS)[number], string>>;

type Status = ImStatus & { connections?: unknown[]; spaces?: unknown[] };
export function ImSettingsPanel({
  locale,
  onOpenThread,
}: {
  locale: AppLocale;
  onOpenThread?: ((threadId: string) => Promise<void>) | undefined;
}) {
  const t = uiTranslator(locale);
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<ImSettings>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("Artemis");
  const [adminToken, setAdminToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const refreshEpoch = useRef(0);
  const [refreshError, setRefreshError] = useState("");
  const [pairCode, setPairCode] = useState<ImPairCode>();
  /* 屏幕状态机：流程 / 完成概览 / 群协作第二流程。undefined = 未显式导航，按完成度自动落位。 */
  const [screen, setScreen] = useState<
    "flow" | "overview" | "group" | undefined
  >();
  const [groupFrom, setGroupFrom] = useState<"flow" | "overview">("overview");
  /* 凭据表单收敛进弹窗：null 关闭；{} 新建；{ connectionId } 更换该连接。 */
  const [botDialog, setBotDialog] = useState<{ connectionId?: string } | null>(
    null,
  );
  const botDialogTrigger = useRef<HTMLButtonElement>(null);
  /* 配对码弹窗：从某条机器人行打开（记录连接 id）。 */
  const [pairDialogId, setPairDialogId] = useState("");
  const pairDialogTrigger = useRef<HTMLButtonElement>(null);
  const [connectionId, setConnectionId] = useState("");
  const [compact, setCompact] = useState(false);
  const [focusTarget, setFocusTarget] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const [channel, setChannel] = useState<ImChannel>("slack");
  /* 两栏布局：右栏渠道列表 ↔ 单渠道详情（下钻）。 */
  const [channelDetail, setChannelDetail] = useState(false);
  const [showRemote, setShowRemote] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<unknown>();
  const [savedMetadata, setSavedMetadata] = useState<
    Partial<Record<ImChannel, BotMetadata>>
  >({});
  const [savingChannel, setSavingChannel] = useState<ImChannel | null>(null);
  const [savedPending, setSavedPending] = useState<
    Partial<Record<ImChannel, boolean>>
  >({});
  const [enableFailedError, setEnableFailedError] = useState("");
  const [customScopeOpen, setCustomScopeOpen] = useState<
    Record<string, boolean>
  >({});
  const [grantDialog, setGrantDialog] = useState<string | null>(null);
  const grantDialogAnchor = useRef<HTMLButtonElement | null>(null);
  const [flowCard, setFlowCard] = useState<ImFlowStepId | null>(null);
  /* ②尾「顺手验证」折叠段：imReadVerify 恢复确认态；开合本次会话内记住
     （首绑自动展开一次，用户手动开合后不再抢开）。 */
  const [verify, setVerify] = useState<ImVerifyState>({ confirmed: false });
  const [verifyOpen, setVerifyOpen] = useState(false);
  const verifyTouched = useRef(false);
  const [taskSeen, setTaskSeen] = useState(false);
  useEffect(() => {
    setSavedMetadata({});
    setSavedPending({});
    setSavingChannel(null);
    setDiagnostics(undefined);
    setPairCode(undefined);
    setFields({});
    setAdminToken("");
  }, [status?.settings.deviceId]);
  useEffect(() => {
    if (messageError)
      document
        .getElementById("im-feedback")
        ?.scrollIntoView?.({ block: "nearest" });
  }, [message, messageError]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      window.artemis.getImStatus(),
      window.artemis.getSnapshot(),
    ])
      .then(([current, snapshot]) => {
        if (active) {
          setStatus(current);
          setSettings(current.settings);
          setUrl(current.settings.gatewayUrl);
          setName(current.settings.deviceName);
          setProjects(snapshot.projects);
          setShowRemote(!!current.settings.deviceId && !current.localGateway);
          const connections = (current.connections ??
            []) as ImConnectionStatus[];
          const connected =
            connections.find((c) => c.state === "connected") ?? connections[0];
          if (connected?.channel) {
            setChannel(connected.channel);
            setConnectionId(connected.id);
          }
        }
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshStatus = async () => {
      if (running.current || refreshing) return;
      refreshing = true;
      const epoch = refreshEpoch.current;
      try {
        let current = await window.artemis.getImStatus();
        if (current.settings.deviceId)
          current = (await window.artemis.manageIm({
            action: "refresh",
          })) as Status;
        const groupDiagnostics =
          screen === "group" &&
          current.localGateway &&
          current.settings.deviceId
            ? await window.artemis.manageIm({
                action: "admin",
                operation: "status",
              })
            : undefined;
        if (active && !running.current && epoch === refreshEpoch.current) {
          setStatus(current);
          if (groupDiagnostics !== undefined) setDiagnostics(groupDiagnostics);
          setRefreshError("");
          // The store is authoritative again; drop save-gap transients.
          setSavedPending({});
        }
      } catch (error) {
        if (active && !running.current && epoch === refreshEpoch.current)
          setRefreshError(String(error));
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refreshStatus(), 2000);
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshStatus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshStatus);
    };
  }, [screen]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const root = panelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const dialog = root.closest(".settings-panel");
    const observer = new ResizeObserver(() =>
      setCompact(root.clientWidth < 720),
    );
    observer.observe(root);
    if (dialog) observer.observe(dialog);
    return () => observer.disconnect();
  }, [!!settings]);
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
   * 共用），spaces 进入群协作第二流程。undefined 的 screen 表示尚未显
   * 式导航，按完成度自动落在概览或流程。
   */
  function selectView(next: ImView | "guide" | "flow" | "overview" | "group") {
    setFields({});
    setAdminToken("");
    setBotDialog(null);
    if (next === "group" || next === "spaces") {
      if (channel === "wecom") return;
      setGroupFrom(activeScreen === "group" ? groupFrom : activeScreen);
      setScreen("group");
      setFocusTarget("im-spaces");
      return;
    }
    if (next === "overview") {
      setScreen("overview");
      setFlowCard(null);
      setFocusTarget("im-overview");
      return;
    }
    if (next === "guide" || next === "flow" || next === "setup-guide") {
      setScreen("flow");
      setFocusTarget("im-guide");
      return;
    }
    /* 三步版：原 account（配对）并入 channel 卡；test 定位到②尾验证段。 */
    const step =
      next === "gateway"
        ? "service"
        : next === "permissions"
          ? "projects"
          : "channel";
    setScreen((current) =>
      current === "group" ? (groupFrom ?? "flow") : current,
    );
    if (IM_CHANNELS.includes(next as ImChannel)) {
      setChannel(next as ImChannel);
      setChannelDetail(true);
      setConnectionId(connections.find((c) => c.channel === next)?.id ?? "");
    }
    if (next === "test") {
      verifyTouched.current = true;
      setVerifyOpen(true);
      /* 验证段挂在渠道详情尾部，深链时一并下钻。 */
      setChannelDetail(true);
    }
    setFlowCard(step);
    setFocusTarget(next === "test" ? "im-verify" : `im-${next}`);
  }
  function navigateStep(id: string) {
    const next =
      id === "im-prepare" || id === "im-device"
        ? "gateway"
        : id === "im-bot" || id === "im-pair"
          ? channel
          : id === "im-permissions"
            ? "permissions"
            : id === "im-test"
              ? "test"
              : channel;
    selectView(next);
    if (id === "im-device") setShowRemote(true);
    setFocusTarget(id);
  }
  /* ②卡内切换平台：留在引导流里，只重置该渠道的编辑态。 */
  function flowSelectChannel(platform: ImChannel) {
    setChannel(platform);
    setConnectionId(connections.find((c) => c.channel === platform)?.id ?? "");
    setFields({});
    setAdminToken("");
    setBotDialog(null);
  }
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    refreshEpoch.current++;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      const result = await action();
      return result !== false;
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : String(error));
        setMessageError(true);
      }
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function generatePairCode() {
    const started = Date.now();
    const result = (await window.artemis.manageIm({
      action: "pair",
      requireConfirmation: true,
    })) as { code: string; expiresIn: number };
    setStatus((previous) =>
      previous ? { ...previous, pairingRequests: [] } : previous,
    );
    setPairCode({
      code: result.code,
      expiresAt: started + Math.min(result.expiresIn ?? 300, 300) * 1000,
    });
  }
  async function refresh() {
    const current = (await window.artemis.manageIm({
      action: "refresh",
    })) as Status;
    if (mounted.current) {
      setStatus(current);
      setRefreshError("");
    }
  }
  async function save(next: ImSettings) {
    const current = await window.artemis.saveImSettings(next);
    setStatus((previous) => ({ ...previous, ...current }));
    setSettings(current.settings);
    setMessage(t("ImSettingsPanel.message1"));
  }
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
  function updateGrant(projectId: string, changes: Record<string, unknown>) {
    if (!settings) return;
    setSettings({
      ...settings,
      grants: settings.grants.map((g) =>
        g.projectId === projectId
          ? executionGrantSchema.parse({
              ...g,
              ...changes,
              ...(changes.groups && g.security
                ? {
                    security: {
                      ...g.security,
                      confirmedAt: 0,
                      scopes: g.security.scopes.filter(
                        (s) =>
                          s.audience === "owner" ||
                          (changes.groups as string[]).includes(s.audience),
                      ),
                    },
                  }
                : {}),
            })
          : g,
      ),
    });
  }
  const channelConnections = connections.filter((c) => c.channel === channel);
  const selectedConnection =
    channelConnections.find((c) => c.id === connectionId) ??
    channelConnections[0];
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
    : botDialog
      ? savedMetadata[channel]
      : undefined;
  const feishuTransport =
    fields.transport ?? dialogMetadata?.transport ?? "websocket";
  const feishuDomain = fields.domain ?? dialogMetadata?.domain ?? "feishu";
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
  useEffect(() => {
    if (activeScreen !== "group" || !local || !status?.settings.deviceId)
      return;
    let active = true;
    void run(async () => {
      const result = await window.artemis.manageIm({
        action: "admin",
        operation: "status",
      });
      if (active) setDiagnostics(result);
    });
    return () => {
      active = false;
    };
  }, [screen, local, status?.settings.deviceId]);
  const resolvePairing = (requestId: string, approve: boolean) =>
    run(async () => {
      await window.artemis.manageIm({
        action: "resolve-pairing",
        requestId,
        approve,
      });
      await refresh();
      setMessage(
        approve
          ? t("ImSettingsPanel.message25")
          : t("ImSettingsPanel.message24"),
      );
      if (approve) {
        flowAdvanceFrom();
        /* 首绑自动展开②尾「顺手验证」段（用户动过折叠后不再抢开）。 */
        if (!verifyTouched.current) {
          setVerifyOpen(true);
          setFocusTarget("im-verify");
        }
      }
    });
  const unpairIdentity = (identity: ImIdentity) =>
    run(async () => {
      await window.artemis.manageIm({ action: "unpair", identity });
      await refresh();
      setMessage(t("ImSettingsPanel.message26"));
    });
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
  /* 待确认的配对请求：内聚在配对码弹窗中审批。 */
  const pendingRequests = (
    <ImAccounts
      key={`${screen}:requests`}
      t={t}
      busy={busy}
      identities={[]}
      requests={status?.pairingRequests ?? []}
      showAccounts={false}
      resolve={resolvePairing}
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
  const availableSpaces = (status?.spaces ?? []).flatMap((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      !("name" in value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string"
    )
      return [];
    return [{ id: value.id, name: value.name }];
  });
  /** 显式完成动作（批准配对、保存启用成功）后解除钉住，交回自动跟随显示最早缺步卡。 */
  function flowAdvanceFrom() {
    setFlowCard(null);
  }

  /* 引导流 derive：必须在加载守卫之前，保证 Hook 顺序稳定。 */
  const flowSteps = imFlowSteps(status);
  const flowDone = imFlowProgress(flowSteps);
  const flowTotal = flowSteps.length;
  const allDone = flowDone === flowTotal;
  const flowOpenCard = flowCard ?? imFirstPendingStep(flowSteps) ?? "projects";
  const activeScreen = screen ?? (allDone ? "overview" : "flow");
  const taskDetected = taskSeen || !!status?.remoteTasks?.length;
  /* 验证折叠标签三态：已验证 · 渠道 / 验证进行中 / 初始（可选提示）。 */
  const verifiedChannelLabel = verify.channel
    ? verify.channel === "lark"
      ? "Lark"
      : imChannelLabel(verify.channel as ImChannel, t)
    : "";
  const verifyLabel = verify.confirmed
    ? t("ImSettingsPanel.message29", {
        value1: verifiedChannelLabel ? ` · ${verifiedChannelLabel}` : "",
      })
    : taskDetected
      ? t("ImSettingsPanel.message28")
      : t("ImSettingsPanel.message27");
  /* 完成即概览：三步全部完成时粘性落在概览（群协作屏除外）；回退时停留概览并提示。 */
  useEffect(() => {
    if (allDone && screen !== "group")
      setScreen((current) => (current === "overview" ? current : "overview"));
  }, [allDone, screen]);
  /* 两栏引导：真首跑（服务已连、尚无任何已配置渠道）自动下钻当前渠道，
     相当于原②卡的自动展开；已有渠道配置（含半配/异常）保持列表态，
     不与用户的返回动作打架。 */
  const noConfiguredChannel =
    !connections.length && !Object.keys(savedPending).length;
  const channelPendingFirst =
    activeScreen === "flow" &&
    flowOpenCard === "channel" &&
    noConfiguredChannel;
  useEffect(() => {
    if (channelPendingFirst) setChannelDetail(true);
  }, [channelPendingFirst]);
  const flowDoneKey = flowSteps.map((step) => (step.done ? "1" : "0")).join("");
  const prevFlowDoneKey = useRef(flowDoneKey);
  useEffect(() => {
    setVerify(imReadVerify(status?.settings.deviceId));
    setFlowCard(null);
  }, [status?.settings.deviceId]);
  useEffect(() => {
    const unsubscribe = window.artemis.onImTaskCreated?.(() =>
      setTaskSeen(true),
    );
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    if (prevFlowDoneKey.current === flowDoneKey) return;
    const previous = prevFlowDoneKey.current;
    prevFlowDoneKey.current = flowDoneKey;
    if (
      activeScreen !== "group" &&
      [...previous].some(
        (flag, index) => flag === "1" && flowDoneKey[index] === "0",
      )
    )
      setMessage(t("ImSettingsPanel.message30"));
  }, [flowDoneKey, activeScreen]);

  if (!settings)
    return message ? (
      <InlineNotice tone="danger">{message}</InlineNotice>
    ) : (
      <LoadingState label={t("ImSettingsPanel.message31")} lines={3} />
    );
  const stateLabels: Record<NonNullable<ImStatus["state"]>, string> = {
    disabled: t("AutomationPage_text.paused"),
    connecting: t("ImNavigation.message11"),
    connected: t("ImNavigation.message12"),
    error: t("ImNavigation.message8"),
  };
  const enableReason = !settings.deviceId
    ? t("ImSettingsPanel.message37")
    : !hasBot
      ? t("ImSettingsPanel.message36")
      : "";
  const summary = refreshError
    ? t("ImSettingsPanel.message41")
    : !status?.settings.deviceId
      ? t("ImNavigation.message6")
      : !status.settings.enabled
        ? t("AutomationPage_text.paused")
        : status?.state === "error"
          ? stateLabels.error
          : !hasBot
            ? t("ImSettingsPanel.message38")
            : stateLabels[status?.state ?? "connecting"];
  const health = imConnectionHealth(connections);
  const activeSettings = settings;
  function renderGatewayBody() {
    const settings = activeSettings;
    return (
      <>
        <section id="im-prepare" tabIndex={-1}>
          <ImGatewayInstructions
            t={t}
            busy={busy}
            ready={status?.localGateway?.state === "running"}
            setup={() =>
              void run(async () => {
                const current = (await window.artemis.manageIm({
                  action: "setup-local",
                })) as Status;
                setStatus(current);
                setSettings(current.settings);
                setUrl(current.settings.gatewayUrl);
                setName(current.settings.deviceName);
                setShowRemote(false);
                setAdminToken("");
                setMessage(t("ImSettingsPanel.message42"));
                selectView(channel);
                setFocusTarget("im-bot");
              })
            }
            useRemote={() => {
              setShowRemote(true);
              window.setTimeout(
                () =>
                  document
                    .getElementById("im-device")
                    ?.scrollIntoView({ block: "start" }),
                0,
              );
            }}
            exportPackage={() =>
              void run(async () => {
                const path = await window.artemis.manageIm({
                  action: "export-gateway",
                });
                if (path)
                  setMessage(
                    t("ImSettingsPanel.message43", { value1: String(path) }),
                  );
              })
            }
          />
        </section>
        <section id="im-device" tabIndex={-1}>
          {settings.deviceId && (
            <p className="im-identifier">
              {t("ImSettingsPanel.message44")}
              {settings.deviceId}
            </p>
          )}
          {local && (
            <InlineNotice tone="info">
              {t("ImSettingsPanel.message45")}
            </InlineNotice>
          )}
          <details
            open={showRemote}
            onToggle={(event) => setShowRemote(event.currentTarget.open)}
          >
            <summary>{t("ImSettingsPanel.message46")}</summary>
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
          </details>
        </section>
      </>
    );
  }
  function renderChannelBody() {
    const settings = activeSettings;
    return (
      <section id="im-bot" className="im-channel-body" tabIndex={-1}>
        {/* 渠道名与连接状态已由上方 tab（信号灯 + 提亮）表达，主体直接
            进入操作内容，不再重复标题/约束/状态行。 */}
        {/* 飞书首选扫码接入（官方应用注册流程）；指引折叠块保持其下。 */}
        {channel === "feishu" && (
          <ImFeishuScan
            t={t}
            busy={busy}
            disabled={!settings.deviceId}
            /* ZCode 动线：扫码建连后直接接续绑定——刷新出连接、生成配对码
               并弹开配对弹窗，用户复制指令去飞书私聊发送即可。 */
            onConnected={(connectionId) => {
              void run(async () => {
                await refresh();
                if (!connectionId) return;
                try {
                  await generatePairCode();
                  setPairDialogId(connectionId);
                } catch {
                  // 配对码生成失败不打断：弹窗可从机器人行随时重开。
                }
              });
            }}
          />
        )}
        {/* 平台接入指引统一收进顶部折叠块：slack 恒显示，飞书/企微一致。 */}
        <details className="im-setup-guide-top">
          <summary>{t("ImSettingsPanel.message59")}</summary>
          <div className="im-setup-guide-body">
            {channel === "slack" ? (
              <ImSlackSetup
                t={t}
                busy={busy}
                copy={() =>
                  void run(async () => {
                    const { userName } = await window.artemis.getSnapshot();
                    await navigator.clipboard.writeText(
                      slackAppManifest(userName),
                    );
                    setMessage(t("ImSettingsPanel.message60"));
                  })
                }
              />
            ) : (
              <ImPlatformSetup
                channel={channel}
                transport={feishuTransport}
                domain={feishuDomain}
                t={t}
              />
            )}
          </div>
        </details>
        {!settings.deviceId && (
          <InlineNotice tone="info">
            <p>{t("ImSettingsPanel.message61")}</p>
            <Button onClick={() => navigateStep("im-prepare")}>
              {t("ImSettingsPanel.message62")}
            </Button>
          </InlineNotice>
        )}
        {channel === "feishu" && (
          <ImLegacyImport
            key={settings.deviceId}
            local={local}
            busy={busy}
            ready={!!settings.deviceId}
            run={run}
            t={t}
            imported={async () => {
              await refresh();
              setMessage(t("ImSettingsPanel.message63"));
            }}
          />
        )}
        <div className="im-block im-bots">
          <div className="im-block-header">
            <h4>{t("ImSettingsPanel.message64")}</h4>
            {/* 标题行尾的「机器人+加号」新建入口（ui Button 契约要求
                  可见文字，纯图标动作用原生按钮 + aria-label）。 */}
            <Tooltip label={t("ImSettingsPanel.message65")} align="end">
              <button
                type="button"
                className="im-icon-action"
                disabled={busy}
                aria-label={t("ImSettingsPanel.message65")}
                onClick={(event) => {
                  botDialogTrigger.current = event.currentTarget;
                  setFields({});
                  setAdminToken("");
                  setBotDialog({});
                }}
              >
                <ArtemisIcon height={13} name="bot-add" width={13} />
              </button>
            </Tooltip>
          </div>
          {!channelConnections.length && (
            <p>
              {savedPending[channel]
                ? t("ImSettingsPanel.message68")
                : t("ImSettingsPanel.message67")}
            </p>
          )}
          {channelConnections.map((connection) => (
            /* 机器人行：信号灯 + 名称 + 错误 + 行内动作
                 （更换凭据 / 刷新状态 / 移除）。 */
            <div className="im-connection" key={connection.id}>
              <span
                className="im-dot"
                data-state={imAggregateConnectionStates([connection.state])}
                aria-hidden="true"
              />
              <code>{connection.name}</code>
              <ImBotIdTag id={connection.id} t={t} />
              <div className="im-connection-actions">
                <Tooltip label={t("ImSettingsPanel.message70")} align="end">
                  <button
                    type="button"
                    className="im-icon-action"
                    disabled={busy}
                    aria-label={t("ImSettingsPanel.message69", {
                      value1: connection.name,
                    })}
                    onClick={(event) => {
                      botDialogTrigger.current = event.currentTarget;
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
                    }}
                  >
                    <ArtemisIcon height={13} name="edit" width={13} />
                  </button>
                </Tooltip>
                <Tooltip label={t("ImSettingsPanel.message72")} align="end">
                  <button
                    type="button"
                    className="im-icon-action"
                    disabled={busy || !settings.deviceId}
                    aria-label={t("ImSettingsPanel.message71", {
                      value1: connection.name,
                    })}
                    onClick={() => void run(refresh)}
                  >
                    <ArtemisIcon height={13} name="refresh" width={13} />
                  </button>
                </Tooltip>
                <Tooltip label={t("ImSettingsPanel.message74")} align="end">
                  <button
                    type="button"
                    className="im-icon-action"
                    disabled={busy || !settings.deviceId}
                    aria-label={t("ImSettingsPanel.message73", {
                      value1: connection.name,
                    })}
                    onClick={(event) => {
                      pairDialogTrigger.current = event.currentTarget;
                      setPairDialogId(connection.id);
                      if (!pairCode || pairCode.expiresAt <= Date.now()) {
                        void run(generatePairCode);
                      }
                    }}
                  >
                    <ArtemisIcon height={13} name="send" width={13} />
                  </button>
                </Tooltip>
                <ImConnectionRemoval
                  key={`${settings.deviceId}:${connection.id}`}
                  name={connection.name}
                  local={local}
                  busy={busy}
                  error={messageError ? message : undefined}
                  t={t}
                  remove={(token) =>
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
                              pairingRequests: (
                                previous.pairingRequests ?? []
                              ).filter((r) => r.identity.connectionId !== id),
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
                    })
                  }
                />
              </div>
              {connection.error && (
                <InlineNotice className="im-connection-error" tone="danger">
                  {connection.error}
                </InlineNotice>
              )}
              {/* 从属账号：属于这条连接的已绑定账号，缩进挂在行下。 */}
              {connectionAccounts(connection.id)}
            </div>
          ))}
        </div>
        {botDialog && (
          <Dialog
            className="im-bot-dialog"
            label={
              dialogConnection
                ? t("ImSettingsPanel.message97", {
                    value1: dialogConnection.name,
                  })
                : t("ImSettingsPanel.message76")
            }
            returnFocusRef={botDialogTrigger}
            onOpenChange={(open) => {
              if (!open) {
                setBotDialog(null);
                setFields({});
                setAdminToken("");
              }
            }}
            open
          >
            <header>
              <h2>
                {dialogConnection
                  ? t("ImSettingsPanel.message77", {
                      value1: dialogConnection.name,
                    })
                  : t("ImSettingsPanel.message76")}
              </h2>
            </header>
            <div className="im-bot-dialog-body">
              {channel === "feishu" && (
                <Select
                  labelVisibility="visible"
                  label={t("ImSettingsPanel.message78")}
                  description={t("ImSettingsPanel.message79")}
                  value={feishuDomain}
                  options={[
                    {
                      value: "feishu",
                      label: t("ImSettingsPanel.message80"),
                    },
                    {
                      value: "lark",
                      label: t("ImSettingsPanel.message81"),
                    },
                  ]}
                  disabled={busy}
                  onValueChange={(domain) =>
                    setFields((previous) => ({ ...previous, domain }))
                  }
                />
              )}
              {requiredFields.map(renderBotField)}
              <details className="im-advanced-fields">
                <summary>{t("ImSettingsPanel.message82")}</summary>
                <div className="im-field-stack">
                  {channel === "feishu" && (
                    <Select
                      labelVisibility="visible"
                      label={t("ImSettingsPanel.message83")}
                      value={feishuTransport}
                      options={[
                        {
                          value: "websocket",
                          label: t("ImSettingsPanel.message84"),
                        },
                        {
                          value: "webhook",
                          label: t("ImSettingsPanel.message85"),
                        },
                      ]}
                      disabled={busy}
                      onValueChange={(transport) =>
                        setFields((previous) => ({
                          ...previous,
                          transport,
                        }))
                      }
                    />
                  )}
                  {optionalFields.map(renderBotField)}
                </div>
              </details>
              {!local && (
                <TextField
                  label={t("ImSettingsPanel.message86")}
                  type="password"
                  value={adminToken}
                  onValueChange={setAdminToken}
                  autoComplete="off"
                  disabled={busy}
                  description={t("ImSettingsPanel.message87")}
                />
              )}
              {channel === "feishu" &&
                feishuTransport === "webhook" &&
                local && (
                  <InlineNotice tone="info">
                    {t("ImSettingsPanel.message88")}
                  </InlineNotice>
                )}
              <div className="im-actions">
                <Button
                  disabled={
                    busy ||
                    (!local && !adminToken) ||
                    !settings.deviceId ||
                    (local &&
                      channel === "feishu" &&
                      feishuTransport === "webhook") ||
                    !requiredFields.every((key) => fields[key]?.trim())
                  }
                  onClick={() => {
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
                                (key) =>
                                  !optionalFields.includes(key) ||
                                  !!fields[key]?.trim(),
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
                      setBotDialog(null);
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
                  }}
                >
                  {t("ImSettingsPanel.message89")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBotDialog(null);
                    setFields({});
                    setAdminToken("");
                  }}
                >
                  {t("App_copy.renameCancel")}
                </Button>
              </div>
            </div>
          </Dialog>
        )}
        {channel === "feishu" &&
          channelConnections.map((connection) =>
            connection.configuration?.transport === "webhook" &&
            connection.callbackUrl ? (
              <div className="im-actions" key={`${connection.id}:callback`}>
                <p className="im-identifier">
                  {t("ImSettingsPanel.message98")}
                  {connection.callbackUrl}
                </p>
                <Button
                  variant="quiet"
                  className="management-text-action"
                  disabled={!settings.gatewayUrl}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(
                        connection.callbackUrl!,
                      );
                      setMessage(t("ImSettingsPanel.message100"));
                    })
                  }
                >
                  {t("ImSettingsPanel.message99")}
                </Button>
              </div>
            ) : null,
          )}
        {pairDialogId && (
          <ImPairingCode
            t={t}
            pair={pairCode}
            slack={activePairingPlatform === "slack"}
            busy={busy || !settings.deviceId}
            generate={() => void run(generatePairCode)}
            onRefresh={() => void run(refresh)}
            returnFocusRef={pairDialogTrigger}
            onClose={() => setPairDialogId("")}
            requests={pendingRequests}
            guide={
              <div className="im-pair-guide">
                <p>
                  {t("ImSettingsPanel.message101", {
                    value1: pairingPlatformLabel,
                  })}
                </p>
                <ol>
                  <li>
                    {activePairingPlatform === "slack"
                      ? t("ImSettingsPanel.message103")
                      : t("ImSettingsPanel.message102", {
                          value1: pairingPlatformLabel,
                        })}
                  </li>
                  <li>
                    {activePairingPlatform === "wecom"
                      ? t("ImSettingsPanel.message106")
                      : activePairingPlatform === "slack"
                        ? t("ImSettingsPanel.message105")
                        : t("ImSettingsPanel.message104", {
                            value1: pairingPlatformLabel,
                          })}
                  </li>
                  <li>{t("ImSettingsPanel.message107")}</li>
                </ol>
              </div>
            }
            copy={(text) =>
              void run(async () => {
                await navigator.clipboard.writeText(text);
                setMessage(t("ImSettingsPanel.message108"));
              })
            }
          />
        )}
      </section>
    );
  }
  function renderPermissionsBody() {
    const settings = activeSettings;
    /* D3：Execute 必须显式选择可写范围（owner 受众），否则禁止保存。 */
    const executeMissingWrite = settings.grants.some(
      (g) =>
        g.mode === "execute" &&
        !g.security?.scopes.find((s) => s.audience === "owner")?.writePaths
          .length,
    );
    /* 默认项目落点：未设置或哨兵 = 临时会话。 */
    const adhocDefault =
      !settings.defaultProjectId ||
      settings.defaultProjectId === IM_ADHOC_PROJECT_ID;
    /* 按项目摘要（替代原底部「确认摘要」行）：范围 + 异常状态。 */
    const rowSummary = (grant: ExecutionGrant) => {
      const write =
        grant.security?.scopes.find((s) => s.audience === "owner")
          ?.writePaths ?? [];
      const scope =
        grant.mode === "execute" && write.length
          ? t("ImSettingsPanel.writePaths", {
              paths: locale.startsWith("zh")
                ? write.join("、")
                : new Intl.ListFormat(locale, { type: "unit" }).format(write),
            })
          : t("ImSettingsPanel.message109");
      const state = !grant.security?.confirmedAt
        ? t("ImSettingsPanel.message112")
        : grant.expiresAt <= Date.now()
          ? t("ImSettingsPanel.message111")
          : "";
      return state ? `${scope} · ${state}` : scope;
    };
    /* 行内操作（勾选/撤销/设默认）与弹窗「确认设置」共用：next = 要保存的设置；
       advance=false 供行内增量操作不触发流程自动前进。
       返回 false = 保存本身失败（弹窗保持打开）；启用失败已保存，返回 true。 */
    const performSaveAndEnable = async (
      next: ImSettings = settings,
      advance = true,
    ): Promise<boolean> => {
      setEnableFailedError("");
      const outcome = await imSaveAndEnable(
        (draft) => window.artemis.saveImSettings(draft),
        next,
        status!.settings,
      );
      if (outcome.phase === "save-failed") {
        setMessageError(true);
        setMessage(outcome.error);
        return false;
      }
      setStatus((previous) => ({ ...previous, ...outcome.status }));
      setSettings(outcome.status.settings);
      if (outcome.phase === "saved-enable-failed") {
        setEnableFailedError(outcome.error);
        // 授权已保存但启用失败：钉住④卡，保证提示与重试入口不被自动前进收起。
        setFlowCard("projects");
        return true;
      }
      setMessage(t("ImSettingsPanel.message113"));
      if (advance) flowAdvanceFrom();
      return true;
    };
    /* 行内即时生效：更新草稿并立即保存启用；钉住④卡防止自动跟随在
       完成瞬间把正在操作的卡片收起（显式完成动作才交回自动跟随）。 */
    const applyNow = (next: ImSettings) => {
      setSettings(next);
      setFlowCard("projects");
      void run(() => performSaveAndEnable(next, false));
    };
    const closeGrantDialog = (projectId: string) => {
      // 关闭 = 放弃弹窗内未确认的改动，该项目的授权回退到已保存状态。
      const saved = status?.settings.grants.find(
        (g) => g.projectId === projectId,
      );
      setSettings((current) =>
        current
          ? {
              ...current,
              grants: saved
                ? current.grants.map((g) =>
                    g.projectId === projectId ? saved! : g,
                  )
                : current.grants.filter((g) => g.projectId !== projectId),
            }
          : current,
      );
      setGrantDialog(null);
    };
    return (
      <section id="im-permissions" tabIndex={-1}>
        {/* 说明与提示统一子区：边框包裹、可展开收起（默认收起）——
            正文区只留操作对象（内置临时会话行 + 项目列表）。 */}
        <details className="im-perm-guide">
          <summary>{t("ImSettingsPanel.message114")}</summary>
          <div className="im-perm-guide-body">
            <p>{t("ImSettingsPanel.message115")}</p>
            <p>{t("ImSettingsPanel.message116")}</p>
            <p>{t("ImSettingsPanel.message117")}</p>
            {!projects.length && <p>{t("ImSettingsPanel.message118")}</p>}
          </div>
        </details>
        {/* W4：临时会话是内置授权目标——已配对即可收发消息并获得指引，也可发起
            plan 档临时任务（无项目工作区，不碰项目文件）；不占项目授权，不可取消。 */}
        <div className="im-project im-project-builtin">
          <Checkbox
            label={t("ImSettingsPanel.message119")}
            defaultChecked
            disabled
          />
          {adhocDefault && (
            <span
              className="im-default-badge"
              aria-label={t("ImSettingsPanel.message121")}
            >
              {t("ImSettingsPanel.message120")}
            </span>
          )}
          {!adhocDefault && (
            <Button
              className="im-set-default"
              size="compact"
              variant="quiet"
              title={t("ImSettingsPanel.message123")}
              disabled={busy}
              onClick={() => applyNow({ ...settings, defaultProjectId: "" })}
            >
              {t("ImSettingsPanel.message122")}
            </Button>
          )}
        </div>
        <h4 className="im-project-list-title">
          {t("ImSettingsPanel.message124")}
        </h4>
        {projects.map((project) => {
          const grant = settings.grants.find((g) => g.projectId === project.id);
          return (
            <div className="im-project" key={project.id}>
              <Checkbox
                /* 已授权的项目在名称后带模式后缀（如 Test project.Plan）。 */
                label={
                  grant
                    ? `${project.name}.${grant.mode
                        .charAt(0)
                        .toUpperCase()}${grant.mode.slice(1)}`
                    : project.name
                }
                checked={!!grant}
                disabled={busy}
                onCheckedChange={(checked) =>
                  applyNow({
                    ...settings,
                    grants: checked
                      ? [
                          ...settings.grants,
                          executionGrantSchema.parse({
                            projectId: project.id,
                            expiresAt: Date.now() + 30 * 86400000,
                            // 默认授权：整个项目可读、不可写任何文件（主人单聊）。
                            security: {
                              version: IM_SECURITY_VERSION,
                              revision: "draft",
                              confirmedAt: 0,
                              scopes: [
                                {
                                  audience: "owner",
                                  readPaths: [],
                                  writePaths: [],
                                },
                              ],
                            },
                          }),
                        ]
                      : settings.grants.filter(
                          (g) => g.projectId !== project.id,
                        ),
                    defaultProjectId:
                      !checked && settings.defaultProjectId === project.id
                        ? ""
                        : checked && !settings.grants.length
                          ? project.id
                          : settings.defaultProjectId,
                  })
                }
              />
              {grant && (
                <span className="im-row-summary">{rowSummary(grant)}</span>
              )}
              {settings.defaultProjectId === project.id && (
                <span
                  className="im-default-badge"
                  aria-label={t("ImSettingsPanel.message121")}
                >
                  {t("ImSettingsPanel.message120")}
                </span>
              )}
              {grant && settings.defaultProjectId !== project.id && (
                <Button
                  className="im-set-default"
                  size="compact"
                  variant="quiet"
                  title={t("ImSettingsPanel.message128")}
                  disabled={busy}
                  onClick={() =>
                    applyNow({
                      ...settings,
                      defaultProjectId: project.id,
                    })
                  }
                >
                  {t("ImSettingsPanel.message122")}
                </Button>
              )}
              {grant && (
                <Button
                  className="im-grant-open"
                  size="compact"
                  variant="quiet"
                  title={t("ImSettingsPanel.message130")}
                  disabled={busy}
                  onClick={(event) => {
                    grantDialogAnchor.current = event.currentTarget;
                    setGrantDialog(project.id);
                  }}
                >
                  {t("ImSettingsPanel.message129")}
                </Button>
              )}
              {grant && grantDialog === project.id && (
                <Dialog
                  className="im-grant-dialog"
                  label={t("ImSettingsPanel.message131", {
                    value1: project.name,
                  })}
                  returnFocusRef={grantDialogAnchor}
                  onOpenChange={(open) => {
                    if (!open) closeGrantDialog(project.id);
                  }}
                  open
                >
                  <header>
                    <h2>
                      {t("ImSettingsPanel.message131", {
                        value1: project.name,
                      })}
                    </h2>
                  </header>
                  <div className="im-grant-dialog-body">
                    {/* 三档模式（D3）：档位切换收窄离开 Execute 时同步关闭命令与网络。 */}
                    <div
                      className="im-mode-tiers"
                      role="radiogroup"
                      aria-label={t("App_copy.taskMode")}
                    >
                      {(
                        [
                          [
                            "plan",
                            t("ImSettingsPanel.message132"),
                            t("ImSettingsPanel.message133"),
                          ],
                          [
                            "review",
                            t("ImSettingsPanel.message134"),
                            t("ImSettingsPanel.message135"),
                          ],
                          [
                            "execute",
                            t("ImSettingsPanel.message136"),
                            t("ImSettingsPanel.message137"),
                          ],
                        ] as const
                      ).map(([mode, label, desc]) => (
                        <label
                          className={
                            "im-mode-tier" + (grant.mode === mode ? " on" : "")
                          }
                          key={mode}
                        >
                          <input
                            type="radio"
                            name={`imMode-${project.id}`}
                            checked={grant.mode === mode}
                            disabled={busy}
                            onChange={() =>
                              updateGrant(
                                project.id,
                                mode === "execute"
                                  ? { mode }
                                  : {
                                      mode,
                                      shell: false,
                                      network: false,
                                    },
                              )
                            }
                          />
                          <strong>{label}</strong>
                          <small>{desc}</small>
                        </label>
                      ))}
                    </div>
                    <p className="im-fine">
                      {grant.mode === "execute"
                        ? t("ImSettingsPanel.message140")
                        : t("ImSettingsPanel.message139")}
                    </p>
                    {grant.mode !== "execute" && (
                      <Button
                        size="compact"
                        variant="quiet"
                        onClick={() =>
                          setCustomScopeOpen((open) => ({
                            ...open,
                            [project.id]: !open[project.id],
                          }))
                        }
                      >
                        {customScopeOpen[project.id]
                          ? t("ImSettingsPanel.message142")
                          : t("ImSettingsPanel.message141")}
                      </Button>
                    )}
                    {(grant.mode === "execute" ||
                      !grant.security?.confirmedAt ||
                      customScopeOpen[project.id]) && (
                      <ImDataPermissions
                        grant={grant}
                        t={t}
                        disabled={busy}
                        onChange={(security) =>
                          updateGrant(project.id, { security })
                        }
                        audiences={grant.groups.map((value) => {
                          const space = (
                            (status?.spaces ?? []) as CollaborationSpace[]
                          ).find((s) => `space:${s.id}` === value);
                          return {
                            value,
                            ...(space?.revision
                              ? { revision: space.revision as string }
                              : {}),
                            label: space
                              ? `${space.name} · ${(space.endpoints ?? []).map((e) => `${e.connectionId}: ${e.id}`).join(", ")} · ${(space.participants ?? []).map((p) => p.name || p.deviceId).join(", ")}`
                              : value,
                          };
                        })}
                      />
                    )}
                    <div className="im-grant-fields">
                      <Select
                        labelVisibility="visible"
                        label={t("ImSettingsPanel.message143")}
                        value={grant.approval}
                        onValueChange={(approval) =>
                          updateGrant(project.id, { approval })
                        }
                        disabled={busy}
                        options={[
                          {
                            value: "ask",
                            label: t("ImSettingsPanel.message144"),
                          },
                          {
                            value: "automatic",
                            label: t("ImSettingsPanel.message145"),
                          },
                        ]}
                      />
                      {grant.mode === "execute" && (
                        <>
                          {status?.scopedShellSupported === false ? (
                            <InlineNotice tone="warning">
                              {t("ImSettingsPanel.message146")}
                            </InlineNotice>
                          ) : null}
                          <Checkbox
                            label={t("ImSettingsPanel.message147")}
                            checked={grant.shell}
                            disabled={
                              busy || status?.scopedShellSupported === false
                            }
                            onCheckedChange={(shell) =>
                              updateGrant(project.id, { shell })
                            }
                          />
                          <Checkbox
                            label={t("ImSettingsPanel.message148")}
                            description={t("ImSettingsPanel.message149")}
                            checked={grant.network}
                            disabled={busy || !grant.shell}
                            onCheckedChange={(network) =>
                              updateGrant(project.id, { network })
                            }
                          />
                        </>
                      )}
                      <div className="im-field-stack">
                        <h4>{t("ImSettingsPanel.message150")}</h4>
                        {!availableSpaces.length && (
                          <p>{t("ImSettingsPanel.message151")}</p>
                        )}
                        {availableSpaces.map((space) => (
                          <Checkbox
                            key={space.id}
                            label={space.name}
                            checked={grant.groups.includes(`space:${space.id}`)}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              updateGrant(project.id, {
                                groups: checked
                                  ? [...grant.groups, `space:${space.id}`]
                                  : grant.groups.filter(
                                      (id) => id !== `space:${space.id}`,
                                    ),
                              })
                            }
                          />
                        ))}
                      </div>
                      <details>
                        <summary>{t("ImSettingsPanel.message152")}</summary>
                        <TextField
                          label={t("ImSettingsPanel.message153")}
                          value={grant.groups
                            .filter((g) => g.startsWith("space:"))
                            .map((g) => g.slice(6))
                            .join(", ")}
                          onValueChange={(value) =>
                            updateGrant(project.id, {
                              groups: value
                                .split(",")
                                .map((v) => v.trim())
                                .filter(Boolean)
                                .map((v) => `space:${v}`),
                            })
                          }
                          disabled={busy}
                        />
                      </details>
                      <p>
                        {t("ImSettingsPanel.message154")}
                        {new Date(grant.expiresAt).toLocaleString(locale)}{" "}
                        <Button
                          disabled={busy}
                          onClick={() =>
                            updateGrant(project.id, {
                              expiresAt: Date.now() + 30 * 86400000,
                            })
                          }
                        >
                          {t("ImSettingsPanel.message155")}
                        </Button>
                      </p>
                    </div>
                  </div>
                  <footer>
                    <span>{t("ImSettingsPanel.message156")}</span>
                    <div className="im-grant-dialog-actions">
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => closeGrantDialog(project.id)}
                      >
                        {t("App_copy.renameClose")}
                      </Button>
                      <Button
                        disabled={
                          busy || !settings.deviceId || executeMissingWrite
                        }
                        onClick={() => {
                          void (async () => {
                            // 保存失败（false）保持弹窗打开让用户修正；
                            // 已保存（含启用失败）关闭，重试入口在④卡。
                            if (await run(() => performSaveAndEnable()))
                              setGrantDialog(null);
                          })();
                        }}
                      >
                        {t("ImSettingsPanel.message158")}
                      </Button>
                    </div>
                  </footer>
                </Dialog>
              )}
            </div>
          );
        })}
        {/* 按项目的范围/状态摘要在各项目行内呈现（.im-row-summary）。 */}
        {enableFailedError && (
          <InlineNotice tone="warning">
            {t("ImSettingsPanel.message160")} {enableFailedError}{" "}
            <Button
              size="compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await imRetryEnable(
                    (draft) => window.artemis.saveImSettings(draft),
                    status!.settings,
                  );
                  setStatus((previous) => ({
                    ...previous,
                    ...next,
                  }));
                  setSettings(next.settings);
                  setEnableFailedError("");
                  setMessage(t("ImSettingsPanel.message162"));
                })
              }
            >
              {t("ImSettingsPanel.message161")}
            </Button>
          </InlineNotice>
        )}
      </section>
    );
  }

  function renderSpacesBody() {
    const reload = async () => {
      await window.artemis.manageIm({
        action: "admin",
        operation: "refresh-groups",
      });
      const next = await window.artemis.manageIm({
        action: "admin",
        operation: "status",
      });
      setDiagnostics(next);
      const status = (await window.artemis.manageIm({
        action: "refresh",
      })) as Status;
      setStatus(status);
      setSettings(status.settings);
    };
    return (
      <section id="im-spaces" tabIndex={-1}>
        <ManagementSection
          className="im-space-setup"
          title={t("ImSettingsPanel.message165")}
          description={t("ImSettingsPanel.message166")}
        >
          {!local ? (
            <InlineNotice tone="warning">
              {t("ImSettingsPanel.message164")}
            </InlineNotice>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void run(reload)}>
                {t("ImSettingsPanel.message163")}
              </Button>
              <ImNativeGroups
                diagnostics={diagnostics}
                settings={activeSettings}
                spaces={status?.spaces ?? []}
                projects={projects}
                busy={busy}
                t={t}
                run={run}
                refresh={reload}
                open={onOpenThread}
              />
            </>
          )}
          {status?.groupConversationError ? (
            <InlineNotice tone="warning">
              {status.groupConversationError}
            </InlineNotice>
          ) : null}
        </ManagementSection>
      </section>
    );
  }

  /**
   * ②尾「顺手验证」折叠段（可选端到端验证，不计入完成链）：开合由用户
   */
  function renderVerifySection() {
    const deviceId = status?.settings.deviceId;
    return (
      <section id="im-verify" className="im-verify" tabIndex={-1}>
        <button
          type="button"
          className="im-verify-toggle"
          aria-expanded={verifyOpen}
          aria-controls="im-verify-body"
          onClick={() => {
            verifyTouched.current = true;
            setVerifyOpen((open) => !open);
          }}
        >
          <span>{verifyLabel}</span>
          <span aria-hidden="true" className="im-verify-caret">
            {verifyOpen ? "▾" : "▸"}
          </span>
        </button>
        {verifyOpen && (
          <div id="im-verify-body" className="im-verify-body">
            <section id="im-test" tabIndex={-1}>
              <ImFirstTaskInstructions
                t={t}
                slack={activePairingPlatform === "slack"}
                copy={(text) => void navigator.clipboard.writeText(text)}
              />
            </section>
            {/* D4 诚实版轨道：仅「桌面出现任务」由系统检测，完成与回复以用户确认为准。 */}
            <ol
              className="im-test-track"
              aria-label={t("ImSettingsPanel.message174")}
            >
              <li data-state="guide">{t("ImSettingsPanel.message167")}</li>
              <li data-state={taskDetected ? "done" : "pending"}>
                {taskDetected
                  ? t("ImSettingsPanel.message169")
                  : t("ImSettingsPanel.message168")}
              </li>
              <li data-state={verify.confirmed ? "done" : "pending"}>
                {verify.confirmed
                  ? t("ImSettingsPanel.message171")
                  : t("ImSettingsPanel.message170")}
              </li>
              <li data-state={verify.confirmed ? "done" : "pending"}>
                {verify.confirmed
                  ? t("ImSettingsPanel.message173")
                  : t("ImSettingsPanel.message172")}
              </li>
            </ol>
            <Checkbox
              label={t("ImSettingsPanel.message175")}
              checked={verify.confirmed}
              disabled={busy || !deviceId}
              onCheckedChange={(checked) => {
                const next = {
                  confirmed: checked,
                  channel: checked ? activePairingPlatform : undefined,
                };
                imWriteVerify(deviceId, next);
                setVerify(next);
              }}
            />
            {channel !== "wecom" && (
              <Button variant="quiet" onClick={() => selectView("spaces")}>
                {t("ImSettingsPanel.message176")}
              </Button>
            )}
          </div>
        )}
      </section>
    );
  }

  function renderStepCards() {
    const settings = activeSettings;
    const openStep = (id: ImFlowStepId) =>
      activeScreen === "flow" ? flowOpenCard === id : flowCard === id;
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
        ? imConnectionLabel("unconfigured", t)
        : state === "connected"
          ? `${imConnectionLabel("connected", t)} · ${t(
              "ImSettingsPanel.channelBotsCount",
              { value1: platformConnections.length },
            )}`
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
          }}
        >
          <ArtemisIcon
            aria-hidden="true"
            name={platform === "feishu" ? "feishu" : platform}
            width={20}
            height={20}
          />
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
            </span>
          </span>
          <span aria-hidden="true" className="im-channel-row-caret">
            <ArtemisIcon name="chevron" width={14} height={14} />
          </span>
        </button>
      );
    };
    return (
      <div className="im-two-col">
        {/* 左栏：这台电脑是谁（服务）、能碰什么（授权）。 */}
        <div className="im-col-left">
          <ImFlowCard
            icon="connector"
            title={t("ImSettingsPanel.message180")}
            done={flowSteps[0]!.done}
            summary={settings.deviceId || t("ImSettingsPanel.message181")}
            open={openStep("service")}
            onToggle={() => setFlowCard(openStep("service") ? null : "service")}
            t={t}
          >
            {renderGatewayBody()}
          </ImFlowCard>
          {/* 临时会话是内置授权目标，③摘要计作 1 个项目；授权对所有渠道生效。 */}
          <ImFlowCard
            icon="folder"
            title={t("ImSettingsPanel.message189")}
            done={flowSteps[2]!.done}
            summary={t("ImSettingsPanel.projectsSummary", {
              value1: settings.grants.length + 1,
            })}
            open={openStep("projects")}
            onToggle={() =>
              setFlowCard(openStep("projects") ? null : "projects")
            }
            t={t}
          >
            {renderPermissionsBody()}
            {allDone && (
              <div className="im-ceremony">
                <p className="im-ceremony-title">
                  {t("ImSettingsPanel.message184")}
                </p>
                <div className="im-ceremony-actions">
                  <Button onClick={() => selectView("overview")}>
                    {t("ImSettingsPanel.message185")}
                  </Button>
                  <Button variant="quiet" onClick={() => selectView("test")}>
                    {t("ImSettingsPanel.message186")}
                  </Button>
                  {channel !== "wecom" && (
                    <Button variant="quiet" onClick={() => selectView("spaces")}>
                      {t("ImSettingsPanel.message176")}
                    </Button>
                  )}
                </div>
                <p className="im-fine">{t("ImSettingsPanel.message188")}</p>
              </div>
            )}
          </ImFlowCard>
        </div>
        {/* 右栏：门（渠道）。列表 ↔ 单渠道详情下钻；wecom 接入暂未开放。 */}
        <div className="im-col-right">
          {channelDetail ? (
            <section className="im-channel-detail" tabIndex={-1}>
              <div className="im-channel-detail-head">
                <Button
                  size="compact"
                  variant="quiet"
                  onClick={() => setChannelDetail(false)}
                >
                  {t("ImSettingsPanel.channelBack")}
                </Button>
                <strong>{imChannelLabel(channel, t)}</strong>
              </div>
              {renderChannelBody()}
              {renderVerifySection()}
            </section>
          ) : (
            <section className="im-channel-list" aria-label={t("ImSettingsPanel.imChannelsTitle")}>
              <h3 className="im-channel-list-title">
                {t("ImSettingsPanel.imChannelsTitle")}
              </h3>
              {IM_CHANNELS.map((platform) =>
                /* wecom 接入未开放：仅存量连接（或已存凭据）才显示行，
                   未配置渠道不出现；飞书/Slack 恒显示。 */
                platform === "wecom" &&
                !connections.some((c) => c.channel === "wecom") &&
                !savedPending.wecom
                  ? null
                  : channelRow(platform),
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="im-settings"
      data-mode={activeScreen === "flow" ? "wizard" : activeScreen}
      data-compact={compact}
    >
      <header className="im-header">
        <div className="im-header-copy">
          <h2>{t("ImSettingsPanel.message191")}</h2>{" "}
          <p>{t("ImSettingsPanel.message192")}</p>
        </div>
        <div
          className="im-header-state"
          title={t("ImSettingsPanel.message196")}
        >
          {/* 两栏布局：流程进度条退役，头部只保留状态胶囊与总开关（D1 首跑无开关）。 */}
          {(activeScreen === "overview" ||
            (activeScreen === "flow" && !!status?.settings.deviceId)) && (
            <>
              {activeScreen === "overview" && (
                <span className="im-status-pill" role="status">
                  <span
                    className="im-dot"
                    data-state={
                      status?.settings.enabled
                        ? health.failed
                          ? "error"
                          : status?.state
                        : "disabled"
                    }
                    aria-hidden="true"
                  />
                  {summary}
                  {health.failed > 0 &&
                    ` · ${imConnectionSummary(connections, t)}`}
                </span>
              )}
              <span className="im-master-label" aria-hidden="true">
                {t("ImSettingsPanel.message193")}
              </span>
              <Switch
                labelVisibility="hidden"
                label={t("ImSettingsPanel.message194")}
                title={t("ImSettingsPanel.message195")}
                checked={status?.settings.enabled ?? settings.enabled}
                disabled={busy || (!settings.enabled && !!enableReason)}
                description={!settings.enabled ? enableReason : undefined}
                onCheckedChange={(enabled) =>
                  void run(async () => {
                    const current = await window.artemis.saveImSettings({
                      ...status!.settings,
                      enabled,
                    });
                    setStatus((previous) => ({ ...previous, ...current }));
                    setSettings((draft) =>
                      draft
                        ? { ...draft, enabled: current.settings.enabled }
                        : current.settings,
                    );
                  })
                }
              />
            </>
          )}
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
      ) : activeScreen === "group" ? (
        <div className="im-flow im-group-flow">
          <Button
            variant="secondary"
            size="compact"
            className="im-group-back"
            disabled={busy}
            onClick={() => setScreen(groupFrom)}
          >
            {t("ImSettingsPanel.message200")}
          </Button>
          {renderSpacesBody()}
        </div>
      ) : (
        <div id="im-overview" className="im-flow im-overview" tabIndex={-1}>
          <div className="im-overview-actions">
            {!allDone && (
              <Button
                disabled={busy}
                onClick={() => {
                  setScreen("flow");
                  setFlowCard(imFirstPendingStep(flowSteps) ?? null);
                }}
              >
                {t("ImSettingsPanel.message198")}
              </Button>
            )}
            {channel !== "wecom" && (
              <Button disabled={busy} onClick={() => selectView("spaces")}>
                {t("ImSettingsPanel.message199")}
              </Button>
            )}
          </div>
          {renderStepCards()}
        </div>
      )}
    </div>
  );
}

/** 连接 ID 浮窗触发器：点击浮窗展示完整 ID + 复制，点外部/Esc 关闭。 */
function ImBotIdTag({ id, t }: { id: string; t: ImTranslate }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="im-bot-id" ref={root}>
      <Tooltip label={t("ImSettingsPanel.message202")} align="end">
        <button
          type="button"
          className="im-icon-action im-bot-id-btn"
          aria-expanded={open}
          aria-label={t("ImSettingsPanel.message202")}
          onClick={() => setOpen((value) => !value)}
        >
          <ArtemisIcon height={12} name="info" width={12} />
        </button>
      </Tooltip>
      {open && (
        <span className="im-bot-id-pop">
          <code>{id}</code>
          <Tooltip label={t("ImSettingsPanel.message204")} align="end">
            <button
              type="button"
              className="im-icon-action im-bot-id-btn"
              aria-label={t("ImSettingsPanel.message204")}
              onClick={() => void navigator.clipboard.writeText(id)}
            >
              <ArtemisIcon height={12} name="copy" width={12} />
            </button>
          </Tooltip>
        </span>
      )}
    </span>
  );
}
