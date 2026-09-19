import { uiTranslator } from "../shared/ui-text.js";
import { ImNativeGroups, imNativeGroupChoices } from "./ImNativeGroups";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImDataPermissions } from "./ImDataPermissions";
import { ImHandoff } from "./ImHandoff";
import { ImOutboundReview } from "./ImOutboundReview";
import {
  executionGrantSchema,
  IM_ADHOC_PROJECT_ID,
  IM_SECURITY_VERSION,
  imScopeConfirmation,
  imIdentityKey,
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
import { Checkbox, Select, TextField } from "@artemis/ui/forms";
import { ManagementSection } from "@artemis/ui/management";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ImGatewayInstructions, ImFirstTaskInstructions } from "./ImSetupGuide";

import { ImSlackSetup, slackAppManifest } from "./ImSlackSetup";
import { imRetryEnable, imSaveAndEnable } from "./im-save-enable";
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
import feishuChannelIcon from "./assets/feishu-channel.png";
import slackChannelIcon from "./assets/slack-channel.svg";
import groupChannelIcon from "./assets/im-group-icon.svg";
import projectsChannelIcon from "./assets/im-projects-icon.svg";
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
  initialPermissions = false,
}: {
  locale: AppLocale;
  initialPermissions?: boolean;
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
  const [screen, setScreen] = useState<"flow" | "overview" | undefined>(
    initialPermissions ? "overview" : undefined,
  );
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
  /* 右栏第三卡：群协作详情（与渠道详情互斥）。 */
  const [groupDetail, setGroupDetail] = useState(false);
  /* 右栏第四卡：授权项目详情（与渠道/群详情互斥）。 */
  const [projectsDetail, setProjectsDetail] = useState(initialPermissions);
  const [showRemote, setShowRemote] = useState(false);
  const [advancedDetail, setAdvancedDetail] = useState(false);
  /* 渠道二级面板（ZCode 式主从）：右栏 = 选中机器人详情 / 新建表单 /
     指引 / 导入 / 验证。 */
  const [channelPane, setChannelPane] = useState<
    "bot" | "create" | "guide" | "import" | "verify"
  >("bot");
  const [selectedBotId, setSelectedBotId] = useState("");
  /* 关联凭据卡的飞书扫码开合（ZCode 式：卡头「扫码」钮展开二维码）。 */
  const [credScan, setCredScan] = useState(false);
  /* 渠道弹窗高度跟随「消息接入」主弹窗实际渲染高度（打开时量测注入）。 */
  const [channelDialogHeight, setChannelDialogHeight] = useState<number>();
  /* 飞书创建页的扫码轮次：头部「扫码」钮递增重挂组件以更换二维码。 */
  const [createScanEpoch, setCreateScanEpoch] = useState(0);
  /* 创建页扫码卡体开合：取消隐藏，卡头「扫码」钮重新展开。 */
  const [createScanOpen, setCreateScanOpen] = useState(true);
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
  const [grantAudience, setGrantAudience] = useState("owner");
  const [nativeScopeDraft, setNativeScopeDraft] =
    useState<NonNullable<ExecutionGrant["security"]>>();
  const [grantDialog, setGrantDialog] = useState<string | null>(null);
  const grantDialogAnchor = useRef<HTMLButtonElement | null>(null);
  const [flowCard, setFlowCard] = useState<ImFlowStepId | null>(null);
  /* ②尾「顺手验证」折叠段：imReadVerify 恢复确认态；开合本次会话内记住
     （首绑自动展开一次，用户手动开合后不再抢开）。 */
  const [verify, setVerify] = useState<ImVerifyState>({ confirmed: false });
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
          /* 手动注册入口卡不再自动顶开整屏详情，用户点击时才进入。 */
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
      if (running.current || refreshing || grantDialog) return;
      refreshing = true;
      const epoch = refreshEpoch.current;
      try {
        let current = await window.artemis.getImStatus();
        if (current.settings.deviceId)
          current = (await window.artemis.manageIm({
            action: "refresh",
          })) as Status;
        const groupDiagnostics =
          (groupDetail || grantDialog) &&
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
  }, [screen, groupDetail, flowCard, grantDialog]);
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
   * 共用），spaces 共用项目权限入口。undefined 的 screen 表示尚未显
   * 式导航，按完成度自动落在概览或流程。
   */
  function selectView(next: ImView | "guide" | "flow" | "overview" | "group") {
    setFields({});
    setAdminToken("");
    setBotDialog(null);
    if (next === "group" || next === "spaces") {
      /* 群协作=右栏第三卡详情；深链统一落到该入口。 */
      setFlowCard(null);
      setChannelDetail(false);
      setGroupDetail(true);
      setProjectsDetail(false);
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

    if (next === "permissions") {
      /* 授权项目=右栏第四卡详情；深链统一落到该入口。 */
      setFlowCard(null);
      setChannelDetail(false);
      setGroupDetail(false);
      setProjectsDetail(true);
      setFocusTarget("im-permissions");
      return;
    }
    if (IM_CHANNELS.includes(next as ImChannel)) {
      setChannel(next as ImChannel);
      setChannelDetail(true);
      setGroupDetail(false);
      setProjectsDetail(false);
      setChannelPane("bot");
      setSelectedBotId("");
      setCredScan(false);
      setConnectionId(connections.find((c) => c.channel === next)?.id ?? "");
    }
    if (next === "test") {
      verifyTouched.current = true;
      /* 验证=渠道二级面板的一页，深链时一并下钻并切页。 */
      setChannelDetail(true);
      setGroupDetail(false);
      setProjectsDetail(false);
      setChannelPane("verify");
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
    if (id === "im-device") {
      /* 手动注册改为弹窗：入口卡留在下层，焦点交给弹窗自管。 */
      setShowRemote(true);
      return;
    }
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
    /* 群诊断在群协作详情或授权弹窗（群选项/属主观察）打开时拉取。 */
    if ((!groupDetail && !grantDialog) || !local || !status?.settings.deviceId)
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
  }, [groupDetail, grantDialog, local, status?.settings.deviceId]);
  useEffect(() => {
    /* 渠道详情主从：选中项失效（删除/切换渠道）时回落到本渠道首个机器人。 */
    if (!channelDetail) return;
    setSelectedBotId((previous) =>
      previous && channelConnections.some((c) => c.id === previous)
        ? previous
        : (channelConnections[0]?.id ?? ""),
    );
  }, [channelDetail, channel, channelConnections]);
  useLayoutEffect(() => {
    /* 主弹窗高度内容驱动（随概览/向导内容浮动）：渠道弹窗打开时量测其
       实际高度注入，两个面板视觉齐平；无主弹窗宿主（测试/嵌入）时走
       CSS 缺省公式。 */
    if (!channelDetail) return;
    const main = panelRef.current?.closest("dialog");
    if (!main) return;
    const height = main.getBoundingClientRect().height;
    if (height > 0) setChannelDialogHeight(height);
  }, [channelDetail]);
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
        /* 首绑自动跳到②尾「顺手验证」页（用户动过后不再抢跳）。 */
        if (!verifyTouched.current) {
          setChannelDetail(true);
          setChannelPane("verify");
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
    if (allDone)
      setScreen((current) => (current === "overview" ? current : "overview"));
  }, [allDone, screen]);
  const flowDoneKey = flowSteps.map((step) => (step.done ? "1" : "0")).join("");
  const prevFlowDoneKey = useRef(flowDoneKey);
  useEffect(() => {
    setVerify(imReadVerify(status?.settings.deviceId));
    setProjectsDetail(initialPermissions);
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

  const enableReason = !settings.deviceId
    ? t("ImSettingsPanel.message37")
    : !hasBot
      ? t("ImSettingsPanel.message36")
      : "";
  const activeSettings = settings;
  function renderGatewayBody() {
    const settings = activeSettings;
    const gatewayReady = status?.localGateway?.state === "running";
    return (
      <>
        {/* 顶部信息区：定高，与右栏「飞书+Slack」卡带等高对齐。 */}
        <div className="im-service-meta">
          {settings.deviceId && (
            <p
              className="im-identifier im-service-device-line"
              title={t("ImSettingsPanel.message44")}
            >
              <ArtemisIcon
                aria-hidden="true"
                name="mobile"
                width={15}
                height={15}
              />
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
          {/* 就绪后不再展示禁用态按钮，只留提示。 */}
          {!gatewayReady && (
            <Button
              disabled={busy}
              onClick={() =>
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
            >
              {t("ImSetupGuide.message1")}
            </Button>
          )}
          <aside className="im-tip-card">
            <p className="im-tip-card-head">
              <ArtemisIcon
                aria-hidden="true"
                name="lightbulb"
                width={14}
                height={14}
              />
              {t("ImSetupGuide.message25")}
            </p>
            <p>{t("ImSetupGuide.message3")}</p>
            <p>{t("ImSetupGuide.message26")}</p>
          </aside>
        </div>
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
              {t("ImSettingsPanel.message46")}
            </span>
          </button>
        </section>
      </>
    );
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
    if (!pairCode || pairCode.expiresAt <= Date.now()) {
      void run(generatePairCode);
    }
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
                (key) =>
                  !optionalFields.includes(key) || !!fields[key]?.trim(),
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
  /* 表单体：渠道字段 + 高级字段 +（远端）管理凭据；cancel 决定放弃时
     回到哪个界面。 */
  const renderBotForm = (cancel: (savedId: string) => void) => (
    <>
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
      {channel === "feishu" && feishuTransport === "webhook" && local && (
        <InlineNotice tone="info">{t("ImSettingsPanel.message88")}</InlineNotice>
      )}
      <div className="im-actions">
        <Button
          disabled={
            busy ||
            (!local && !adminToken) ||
            !activeSettings.deviceId ||
            (local &&
              channel === "feishu" &&
              feishuTransport === "webhook") ||
            !requiredFields.every((key) => fields[key]?.trim())
          }
          onClick={() => saveBotForm(cancel)}
        >
          {t("ImSettingsPanel.message89")}
        </Button>
        <Button disabled={busy} onClick={() => cancel("")}>
          {t("App_copy.renameCancel")}
        </Button>
      </div>
    </>
  );
  const dismissBotDialog = () => {
    setBotDialog(null);
    setFields({});
    setAdminToken("");
  };
  const dismissBotCreate = (savedId: string) => {
    /* 创建页保存后：回到机器人详情并选中新机器人（ZCode 同款动线）。 */
    setChannelPane("bot");
    setSelectedBotId(savedId);
    setFields({});
    setAdminToken("");
  };
  /* 删除机器人：危险卡内的垃圾桶入口，确认（与远端管理凭据）走
     ImConnectionRemoval 弹窗。 */
  const removeConnection = (connection: ImConnectionStatus) => (token: string) =>
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
  /* 飞书扫码接入（官方应用注册流程）：空态首卡自动出码，创建页与
     关联凭据卡共用；onScanConnected 在共享接续（刷新+配对）前执行。 */
  const renderFeishuScan = (
    autoStart: boolean,
    onScanConnected?: (connectionId?: string) => void,
  ) => (
    <ImFeishuScan
      t={t}
      autoStart={autoStart}
      busy={busy}
      disabled={!activeSettings.deviceId}
      onConnected={(connectionId) => {
        connectScannedBot(connectionId, () => onScanConnected?.(connectionId));
      }}
    />
  );
  /* 平台接入指引：slack 恒为清单指引，飞书/企微走平台步骤。 */
  const renderGuideBody = () =>
    channel === "slack" ? (
      <ImSlackSetup
        t={t}
        busy={busy}
        copy={() =>
          void run(async () => {
            const { userName } = await window.artemis.getSnapshot();
            await navigator.clipboard.writeText(slackAppManifest(userName));
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
    );
  const renderLegacyImport = () => (
    <ImLegacyImport
      key={activeSettings.deviceId}
      local={local}
      busy={busy}
      ready={!!activeSettings.deviceId}
      run={run}
      t={t}
      imported={async () => {
        await refresh();
        setMessage(t("ImSettingsPanel.message63"));
      }}
    />
  );
  /* 飞书 webhook 连接的回调地址：跟随机器人详情展示。 */
  const renderWebhookCallback = (connection: ImConnectionStatus) =>
    channel === "feishu" &&
    connection.configuration?.transport === "webhook" &&
    connection.callbackUrl ? (
      <div className="im-actions">
        <p className="im-identifier">
          {t("ImSettingsPanel.message98")}
          {connection.callbackUrl}
        </p>
        <Button
          variant="quiet"
          className="management-text-action"
          disabled={!activeSettings.gatewayUrl}
          onClick={() =>
            void run(async () => {
              await navigator.clipboard.writeText(connection.callbackUrl!);
              setMessage(t("ImSettingsPanel.message100"));
            })
          }
        >
          {t("ImSettingsPanel.message99")}
        </Button>
      </div>
    ) : null;
  /* 无机器人时的右栏：空态文案 + 飞书扫码接入；新建入口在左栏顶部。 */
  const renderJoinCard = () => (
    <div className="im-bot-join">
      <strong>{imChannelLabel(channel, t)}</strong>
      <p>
        {savedPending[channel]
          ? t("ImSettingsPanel.message68")
          : t("ImSettingsPanel.message67")}
      </p>
      {channel === "feishu" &&
        renderFeishuScan(!channelConnections.length)}
    </div>
  );
  /* 机器人详情（ZCode 式）：头（logo+名称+ID+刷新）+ 状态行 +
     关联凭据 / 配对聊天 / 删除机器人 三张设置卡。 */
  const renderBotProfile = (connection: ImConnectionStatus) => {
    const state = imAggregateConnectionStates([connection.state]);
    return (
      <div className="im-bot-profile">
        <div className="im-bot-profile-head">
          {channelLogo(channel, 28)}
          <strong>{connection.name}</strong>
          <ImBotIdTag id={connection.id} t={t} />
          <Tooltip label={t("ImSettingsPanel.message72")} align="end">
            <button
              type="button"
              className="im-icon-action"
              disabled={busy || !activeSettings.deviceId}
              aria-label={t("ImSettingsPanel.message71", {
                value1: connection.name,
              })}
              onClick={() => void run(refresh)}
            >
              <ArtemisIcon height={13} name="refresh" width={13} />
            </button>
          </Tooltip>
        </div>
        <p className="im-bot-profile-state">
          <span aria-hidden="true" className="im-dot" data-state={state} />
          {imConnectionLabel(state, t)}
        </p>
        {connection.error && (
          <InlineNotice tone="danger">{connection.error}</InlineNotice>
        )}
        <div
          className="im-bot-section"
          data-scan-open={(channel === "feishu" && credScan) || undefined}
        >
          <div className="im-bot-section-copy">
            <strong>{t("ImSettingsPanel.botCredTitle")}</strong>
            <p>{t("ImSettingsPanel.botCredDesc")}</p>
          </div>
          <div className="im-bot-section-actions">
            {channel === "feishu" && (
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
            )}
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
          {channel === "feishu" && credScan && (
            <div className="im-bot-scan">{renderFeishuScan(true)}</div>
          )}
        </div>
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
        <div className="im-bot-section" data-tone="danger">
          <div className="im-bot-section-copy">
            <strong>{t("ImSettingsPanel.botDeleteTitle")}</strong>
            <p>{t("ImSettingsPanel.botDeleteDesc")}</p>
          </div>
          <div className="im-bot-section-actions">
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
        </div>
      </div>
    );
  };
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
            data-selected={channelPane === "create" || undefined}
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
            const state = imAggregateConnectionStates([connection.state]);
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
                <span className="im-bot-card-copy">
                  <strong>{connection.name}</strong>
                  <span className="im-bot-card-state">
                    <span
                      aria-hidden="true"
                      className="im-dot"
                      data-state={state}
                    />
                    {imConnectionLabel(state, t)}
                  </span>
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
              {renderVerifyBody()}
            </div>
          )}
          {channelPane === "create" && (
            /* ZCode 式：新建占据右栏整卡。飞书=扫码优先（官方注册流程
               直出二维码，不再展示凭据表单），保存后落回详情并选中
               新机器人；其余渠道走凭据表单。 */
            <div className="im-bot-pane" id="im-bot-create" tabIndex={-1}>
              <div className="im-bot-create">
                <div className="im-bot-create-head">
                  {channelLogo(channel, 28)}
                  <strong>{t("ImSettingsPanel.message76")}</strong>
                </div>
                {channel === "feishu" ? (
                  <>
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
                          key={createScanEpoch}
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
                    {/* 回复形态说明（ZCode 同款说明卡）：飞书走流式卡片。 */}
                    <div className="im-bot-section">
                      <div className="im-bot-section-copy">
                        <strong>{t("ImSettingsPanel.botReplyModeTitle")}</strong>
                        <p>{t("ImSettingsPanel.botReplyModeDesc")}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  renderBotForm(dismissBotCreate)
                )}
              </div>
            </div>
          )}
          {channelPane === "bot" &&
            (selected ? renderBotProfile(selected) : renderJoinCard())}
        </div>
        {renderBotDialog()}
        {renderPairDialog()}
      </section>
    );
  }
  function renderBotDialog() {
    /* 更换凭据弹窗（新建已改右栏创建页）：与创建页共用同一表单体。 */
    return (
      <>
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
              if (!open) dismissBotDialog();
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
              {renderBotForm(dismissBotDialog)}
            </div>
          </Dialog>
        )}
      </>
    );
  }
  function renderPairDialog() {
    return (
      <>
        {pairDialogId && (
          <ImPairingCode
            t={t}
            pair={pairCode}
            slack={activePairingPlatform === "slack"}
            busy={busy || !activeSettings.deviceId}
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
      </>
    );
  }
  function renderPermissionsBody() {
    const settings = activeSettings;
    const nativeChoices = status?.localGateway
      ? imNativeGroupChoices(
          diagnostics,
          status.spaces ?? [],
          settings.deviceId,
          t,
        )
      : [];
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
        grant.mode === "execute" &&
        grant.security?.scopes.find((s) => s.audience === "owner")
          ?.writeMode === "project"
          ? t("ImDataPermissions.message14")
          : grant.mode === "execute" && write.length
            ? t("ImSettingsPanel.writePaths", {
                paths: locale.startsWith("zh")
                  ? write.join("、")
                  : new Intl.ListFormat(locale, { type: "unit" }).format(write),
              })
            : t("ImSettingsPanel.message109");
      const state =
        !grant.security?.scopes.length ||
        grant.security.scopes.some(
          (scope) => !imScopeConfirmation(grant.security, scope),
        )
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
          const nativeTarget = nativeChoices.find(
            (group) => group.value === grantAudience,
          );
          const authorizeGroup =
            nativeTarget &&
            (!nativeTarget.saved?.nativeGroup?.enabled ||
              nativeTarget.saved.nativeGroup.projectId !== project.id ||
              !grant?.groups.includes(nativeTarget.value));
          const audiences = [
            ...nativeChoices.map((group) => ({
              value: group.value,
              label: group.label,
              ...(group.saved?.revision
                ? { revision: group.saved.revision }
                : {}),
            })),
            ...(grant?.groups ?? [])
              .filter(
                (value) =>
                  !nativeChoices.some((group) => group.value === value),
              )
              .map((value) => {
                const space = (
                  (status?.spaces ?? []) as CollaborationSpace[]
                ).find((space) => `space:${space.id}` === value);
                return {
                  value,
                  label: space?.name ?? value,
                  ...(space?.revision ? { revision: space.revision } : {}),
                };
              }),
          ];
          const groupScope = nativeScopeDraft?.scopes[0];
          const groupConfirmed =
            !!groupScope && !!imScopeConfirmation(nativeScopeDraft, groupScope);

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
              <Button
                className="im-grant-open"
                size="compact"
                variant="quiet"
                title={t("ImSettingsPanel.message130")}
                disabled={busy}
                onClick={(event) => {
                  grantDialogAnchor.current = event.currentTarget;
                  setGrantAudience("owner");
                  setNativeScopeDraft(undefined);
                  if (!grant)
                    setSettings({
                      ...settings,
                      grants: [
                        ...settings.grants,
                        executionGrantSchema.parse({
                          projectId: project.id,
                          expiresAt: Date.now() + 30 * 86400000,
                          security: {
                            version: IM_SECURITY_VERSION,
                            revision: "draft",
                            confirmedAt: 0,
                            scopes: [
                              {
                                audience: "owner",
                                readPaths: [],
                                writePaths: [],
                                confirmedAt: 0,
                              },
                            ],
                          },
                        }),
                      ],
                    });
                  setGrantDialog(project.id);
                }}
              >
                {t("ImSettingsPanel.message129")}
              </Button>
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
                    {messageError && (
                      <InlineNotice tone="warning">{message}</InlineNotice>
                    )}
                    <Select
                      labelVisibility="visible"
                      label={t("ImDataPermissions.message8")}
                      value={grantAudience}
                      disabled={busy}
                      options={[
                        {
                          value: "owner",
                          label: t("ImDataPermissions.message9"),
                        },
                        ...audiences,
                      ]}
                      onValueChange={(audience) => {
                        setGrantAudience(audience);
                        setCustomScopeOpen((current) => ({
                          ...current,
                          [project.id]: true,
                        }));
                        // A new or paused audience needs its own explicit confirmation.
                        // Keep this draft separate from the owner's saved scope.
                        const scope = grant.security?.scopes.find(
                          (scope) => scope.audience === audience,
                        );
                        setNativeScopeDraft({
                          version: IM_SECURITY_VERSION,
                          revision: "draft",
                          confirmedAt: 0,
                          scopes: [
                            {
                              ...scope,
                              audience: "owner",
                              readPaths: scope?.readPaths ?? [],
                              writePaths: scope?.writePaths ?? [],
                              confirmedAt: 0,
                            },
                          ],
                        });
                      }}
                    />
                    {authorizeGroup && !nativeTarget.owner && (
                      <InlineNotice tone="warning">
                        {t("ImSettingsPanel.nativeOwnerRequired")}
                      </InlineNotice>
                    )}
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
                      !grant.security?.scopes.some(
                        (scope) =>
                          scope.audience === grantAudience &&
                          imScopeConfirmation(grant.security, scope),
                      ) ||
                      customScopeOpen[project.id]) && (
                      <ImDataPermissions
                        key={`${project.id}:${grantAudience}`}
                        initialAudience={
                          authorizeGroup ? "owner" : grantAudience
                        }
                        showAudienceSelector={false}
                        grant={
                          authorizeGroup
                            ? { ...grant, security: nativeScopeDraft! }
                            : grant
                        }
                        t={t}
                        disabled={busy}
                        onChange={(security) =>
                          authorizeGroup
                            ? setNativeScopeDraft(security)
                            : updateGrant(project.id, { security })
                        }
                        audiences={authorizeGroup ? [] : audiences}
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
                      {availableSpaces.some(
                        (space) =>
                          !nativeChoices.some(
                            (group) => group.value === `space:${space.id}`,
                          ),
                      ) && (
                        <div className="im-field-stack">
                          <h4>{t("ImSettingsPanel.message150")}</h4>
                          {availableSpaces
                            .filter(
                              (space) =>
                                !nativeChoices.some(
                                  (group) =>
                                    group.value === `space:${space.id}`,
                                ),
                            )
                            .map((space) => (
                              <Checkbox
                                key={space.id}
                                label={space.name}
                                checked={grant.groups.includes(
                                  `space:${space.id}`,
                                )}
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
                      )}
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
                          busy ||
                          !settings.deviceId ||
                          (!!authorizeGroup &&
                            (!nativeTarget.owner || !groupConfirmed))
                        }
                        onClick={() => {
                          void (async () => {
                            const saved = await run(async () => {
                              if (authorizeGroup) {
                                if (!nativeTarget.owner || !groupConfirmed)
                                  return false;
                                // Save the shared operation policy before adding the group scope;
                                // the backend preserves the project's existing owner grant.
                                if (
                                  !(await performSaveAndEnable(settings, false))
                                )
                                  return false;
                                const next = (await window.artemis.manageIm({
                                  action: "authorize-native-group",
                                  conversation: nativeTarget.conversation,
                                  owner: nativeTarget.owner,
                                  allowedSenders:
                                    nativeTarget.saved?.participants
                                      .filter(
                                        (member) =>
                                          imIdentityKey(member.identity) !==
                                          imIdentityKey(nativeTarget.owner!),
                                      )
                                      .map((member) => member.identity) ?? [],
                                  name: (
                                    nativeTarget.name || nativeTarget.label
                                  ).slice(0, 100),
                                  grant: {
                                    ...grant,
                                    security: nativeScopeDraft!,
                                  },
                                  confirmed: true,
                                })) as Status;
                                setStatus(next);
                                setSettings(next.settings);
                                return true;
                              }
                              return performSaveAndEnable();
                            });
                            if (saved) setGrantDialog(null);
                          })();
                        }}
                      >
                        {t(
                          authorizeGroup
                            ? "ImNativeGroups.message20"
                            : "ImSettingsPanel.message158",
                        )}
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
  /* 验证内容体：渠道二级面板的「验证」页。 */
  function renderVerifyBody() {
    const deviceId = status?.settings.deviceId;
    return (
      <div id="im-verify-body" className="im-verify-body">
        <section id="im-test" tabIndex={-1}>
          <ImFirstTaskInstructions
            t={t}
            slack={activePairingPlatform === "slack"}
            copy={(text) => void navigator.clipboard.writeText(text)}
          />
        </section>
        {/* D4 诚实版轨道：仅「桌面出现任务」由系统检测，完成与回复以用户确认为准。 */}
        <ol className="im-test-track" aria-label={t("ImSettingsPanel.message174")}>
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
    );
  }

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
        ? imConnectionLabel("unconfigured", t)
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
            setProjectsDetail(false);
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
    const detailHead = (
      label: string,
      onBack: () => void,
    ) => (
      <div className="im-channel-detail-head">
        <Button size="compact" variant="quiet" onClick={onBack}>
          {t("ImSettingsPanel.channelBack")}
        </Button>
        <strong>{label}</strong>
      </div>
    );
    return (
      <div className="im-two-col">
        {/* 左栏：这台电脑是谁（服务）。固定标题+内容，不再折叠。 */}
        <div className="im-col-left">
          <section className="im-service-block" id="im-gateway" tabIndex={-1}>
            <div className="im-service-head">
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
              <ArtemisIcon
                aria-hidden="true"
                name="connector"
                width={24}
                height={24}
              />
              <strong>{t("ImSettingsPanel.message180")}</strong>
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
                      aria-checked={status?.settings.enabled ?? settings.enabled}
                      aria-label={t("ImSettingsPanel.message194")}
                      title={
                        (status?.settings.enabled ?? settings.enabled)
                          ? t("ImSettingsPanel.message195")
                          : t("ImSettingsPanel.message194")
                      }
                      disabled={
                        busy || (!settings.enabled && !!enableReason)
                      }
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
                      {/* 电源符号（正向态）：就绪=绿+连接，断开=红+斜杠+断开；线宽 1.5 对齐全库。 */}
                      {settings.enabled || status?.settings.enabled ? (
                        <>
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width={16}
                            height={16}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 2.5v7.5" />
                            <path d="M17.7 6a7.75 7.75 0 1 1-11.4 0" />
                          </svg>
                          <span>{t("ImSettingsPanel.powerStop")}</span>
                        </>
                      ) : (
                        <>
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width={16}
                            height={16}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 2.5v7.5" />
                            <path d="M17.7 6a7.75 7.75 0 1 1-11.4 0" />
                            <path d="m3.5 3.5 17 17" />
                          </svg>
                          <span>{t("ImSettingsPanel.powerConnected")}</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="im-service-body">{renderGatewayBody()}</div>
          </section>
        </div>
        {/* 右栏：门（渠道）。四张卡（渠道×N、群协作、授权项目）↔ 详情下钻。 */}
        <div className="im-col-right">
          {groupDetail ? (
            <section className="im-channel-detail" tabIndex={-1}>
              {detailHead(t("ImSettingsPanel.message199"), () =>
                setGroupDetail(false),
              )}
              {renderSpacesBody()}
            </section>
          ) : projectsDetail ? (
            <section className="im-channel-detail" tabIndex={-1}>
              {detailHead(t("ImSettingsPanel.message189"), () =>
                setProjectsDetail(false),
              )}
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
            </section>
          ) : (
            <section className="im-channel-list" aria-label={t("ImSettingsPanel.imChannelsTitle")}>
              <div className="im-channel-list-head">
                <ArtemisIcon
                  aria-hidden="true"
                  name="message"
                  width={24}
                  height={24}
                />
                <strong>{t("ImSettingsPanel.imChannelsTitle")}</strong>
              </div>
              {IM_CHANNELS.map((platform) =>
                /* wecom 接入未开放：仅存量连接（或已存凭据）才显示行，
                   未配置渠道不出现；飞书/Slack 恒显示。 */
                platform === "wecom" &&
                !connections.some((c) => c.channel === "wecom") &&
                !savedPending.wecom
                  ? null
                  : channelRow(platform),
              )}
              {/* 第三卡：授权项目（设备级，对所有渠道生效）。 */}
              <button
                type="button"
                className="im-channel-row"
                data-configured={
                  (settings.grants.length > 0 || undefined) as boolean | undefined
                }
                onClick={() => {
                  setChannelDetail(false);
                  setGroupDetail(false);
                  setProjectsDetail(true);
                }}
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="im-channel-logo"
                  height={20}
                  src={projectsChannelIcon}
                  width={20}
                />
                <span className="im-channel-row-copy">
                  <strong>{t("ImSettingsPanel.message189")}</strong>
                  <span className="im-channel-row-summary">
                    {t("ImSettingsPanel.projectsSummary", {
                      value1: settings.grants.length + 1,
                    })}
                  </span>
                </span>
                <span aria-hidden="true" className="im-capsule-btn">
                  {t("ImSettingsPanel.goGrant")}
                </span>
              </button>
              {/* 第四卡：群协作（对所有渠道生效，独立于单渠道接入）。 */}
              <button
                type="button"
                className="im-channel-row"
                onClick={() => {
                  setChannelDetail(false);
                  setGroupDetail(true);
                  setProjectsDetail(false);
                }}
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="im-channel-logo"
                  height={20}
                  src={groupChannelIcon}
                  width={20}
                />
                <span className="im-channel-row-copy">
                  <strong>{t("ImSettingsPanel.message165")}</strong>
                  <span className="im-channel-row-summary">
                    {t("ImSettingsPanel.message166")}
                  </span>
                </span>
                <span aria-hidden="true" className="im-capsule-btn">
                  {t("ImSettingsPanel.goGrant")}
                </span>
              </button>
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
        <span aria-hidden="true" className="im-header-mark">
          <ArtemisIcon name="mobile" />
        </span>
        <div className="im-header-copy">
          <h2>{t("ImSettingsPanel.message191")}</h2>{" "}
          <p>{t("ImSettingsPanel.message192")}</p>
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
                  blockSize: `${channelDialogHeight}px`,
                  minBlockSize: `${channelDialogHeight}px`,
                  maxBlockSize: `${channelDialogHeight}px`,
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
