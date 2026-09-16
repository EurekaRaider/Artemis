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

import { ImSlackSetup, SLACK_APP_MANIFEST } from "./ImSlackSetup";
import { imRetryEnable, imSaveAndEnable } from "./im-save-enable";
import { ImFlowCard, ImFlowProgress } from "./ImFlowCard";
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
  const zh = locale.startsWith("zh"),
    t = (cn: string, en: string) => (zh ? cn : en);
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
  const [channel, setChannel] = useState<ImChannel>("wecom");
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
      setConnectionId(connections.find((c) => c.channel === next)?.id ?? "");
    }
    if (next === "test") {
      verifyTouched.current = true;
      setVerifyOpen(true);
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
    setMessage(t("IM 设置已保存。", "IM settings saved."));
  }
  const renderBotField = (field: string) => (
    <TextField
      key={`${channel}:${field}`}
      label={
        {
          id:
            channel === "slack"
              ? t("连接 ID（可留空）", "Connection ID (optional)")
              : t("连接 ID", "Connection ID"),
          name:
            channel === "slack"
              ? t("连接名称（可留空）", "Connection name (optional)")
              : t("连接名称", "Connection name"),
          tenantId:
            channel === "wecom"
              ? t("企业 ID（Corp ID）", "Enterprise ID (Corp ID)")
              : t(
                  "Tenant Key（可留空，自动获取）",
                  "Tenant Key (auto-detected if empty)",
                ),
          botToken: "Bot User OAuth Token",
          appToken: "App-Level Token",
          botId: "Bot ID",
          secret: "Bot Secret",
          appId: "App ID",
          botOpenId: t(
            "Bot Open ID（可留空，自动获取）",
            "Bot Open ID (auto-detected if empty)",
          ),
          appSecret: "App Secret",
          verificationToken: "Verification Token",
          encryptKey: "Encrypt Key",
        }[field]!
      }
      description={
        {
          id:
            channel === "slack"
              ? t(
                  "留空自动使用 slack；需要连接另一个工作区时填写不同名称，例如 slack-team2。",
                  "Defaults to slack. Use a different ID, such as slack-team2, for another workspace.",
                )
              : t(
                  "留空自动生成。连接多个机器人时才需要自定义，只能使用英文、数字、短横线或下划线。",
                  "Generated when empty. Customize only for multiple bots; use letters, numbers, hyphens or underscores.",
                ),
          name: t(
            "可留空；自动使用平台名称。也可改成你熟悉的名字，例如“我的机器人”。",
            "Optional; defaults to the platform name. You can use a recognizable name such as My bot.",
          ),
          tenantId:
            channel === "wecom"
              ? t(
                  "管理后台 → 我的企业 → 企业信息 → 页面底部「企业 ID」，通常以 ww 开头。个人开发者请展开上方“没有企业怎么办”。",
                  "Admin console → My enterprise → Enterprise information → Enterprise ID at the bottom, usually starting with ww. See the personal-developer guide above if you have no organization.",
                )
              : t(
                  "通常无需填写。手动获取：飞书 API 调试台 → 获取企业信息 → data.tenant.tenant_key；不是页面展示的企业编号。",
                  "Usually unnecessary. In Feishu API Explorer, run Get tenant information and copy data.tenant.tenant_key, not the displayed enterprise number.",
                ),
          botToken: t(
            "粘贴 xoxb- 开头的机器人令牌，保存时自动识别工作区和机器人。",
            "Paste the xoxb- bot token. Workspace and bot IDs are detected on save.",
          ),
          appToken: t(
            "粘贴同一应用中带 connections:write 权限的 xapp- 令牌。",
            "Paste the xapp- token from the same app with connections:write permission.",
          ),
          botId: t(
            "智能机器人长连接配置中的 Bot ID。",
            "Bot ID from the intelligent bot's long-connection configuration.",
          ),
          secret: t(
            "与这个 Bot ID 对应的 Secret，不是群 Webhook。",
            "The Secret for this Bot ID, not a group webhook.",
          ),
          botOpenId: t(
            "保存时自动查询，用于识别群里的 @。手动填写时，使用「获取机器人信息」接口中的 bot.open_id。",
            "Retrieved on save to recognize group mentions. For manual setup, use bot.open_id from Get bot information.",
          ),
          verificationToken: t(
            "复制飞书事件与回调配置中的 Verification Token。",
            "Copy Verification Token from Feishu's event/callback settings.",
          ),
          encryptKey: t(
            "复制同一配置中的 Encrypt Key，必须与飞书保存的值一致。",
            "Copy Encrypt Key from the same settings. It must match the value saved in Feishu.",
          ),
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
    { value: "wecom", label: t("企业微信", "WeCom") },
    { value: "feishu", label: t("飞书国内版", "Feishu") },
    { value: "lark", label: t("Lark 国际版", "Lark") },
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
          ? t("配对已批准。", "Pairing approved.")
          : t("配对请求已拒绝。", "Pairing request rejected."),
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
      setMessage(t("账号已解除绑定。", "Account unpaired."));
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
    ? t(
        `顺手验证：已验证${verifiedChannelLabel ? ` · ${verifiedChannelLabel}` : ""}`,
        `Verify: confirmed${verifiedChannelLabel ? ` · ${verifiedChannelLabel}` : ""}`,
      )
    : taskDetected
      ? t("顺手验证：验证进行中", "Verify: in progress")
      : t(
          "顺手验证（可选）：发一条真实消息走通全链路",
          "Optional verify: send one real message end to end",
        );
  /* 完成即概览：三步全部完成时粘性落在概览（群协作屏除外）；回退时停留概览并提示。 */
  useEffect(() => {
    if (allDone && screen !== "group")
      setScreen((current) => (current === "overview" ? current : "overview"));
  }, [allDone, screen]);
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
  /* 渠道 tab 吸顶投影：贴住滚动容器顶缘（停靠线 = padding-top + top，
     Chromium sticky 参照 content box 顶）时加 .stuck，与卡内内容区分。
     捕获阶段监听设置面板滚动容器（[data-part="content"]）的 scroll。 */
  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const update = () => {
      const strip = root.querySelector(".im-channel-tabs");
      const scroller = root.closest("[data-part='content']");
      if (!(strip instanceof HTMLElement) || !(scroller instanceof Element))
        return;
      if (strip.offsetParent === null) return; /* ②卡折叠时不判定 */
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const stickTop = parseFloat(getComputedStyle(strip).top) || 0;
      const stuck =
        strip.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top <=
        padTop + stickTop + 1;
      strip.classList.toggle("stuck", stuck);
    };
    const onScroll = () => update();
    update();
    root.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () =>
      root.removeEventListener("scroll", onScroll, { capture: true });
  }, [!!settings, flowOpenCard, activeScreen]);
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
      setMessage(
        t(
          "有已完成步骤被重置（例如连接被删除），请从对应步骤继续。",
          "A completed step was reset (for example a connection was removed). Resume from that step.",
        ),
      );
  }, [flowDoneKey, activeScreen]);

  if (!settings)
    return message ? (
      <InlineNotice tone="danger">{message}</InlineNotice>
    ) : (
      <LoadingState
        label={t("正在加载 IM 设置", "Loading IM settings")}
        lines={3}
      />
    );
  const stateLabels: Record<NonNullable<ImStatus["state"]>, string> = {
    disabled: t("已暂停", "Paused"),
    connecting: t("连接中", "Connecting"),
    connected: t("已连接", "Connected"),
    error: t("连接错误", "Connection error"),
  };
  const enableReason = !settings.deviceId
    ? t("请先注册当前设备。", "Register this device first.")
    : !hasBot
      ? t(
          "请先连接至少一个机器人渠道。",
          "Connect at least one bot channel first.",
        )
      : "";
  const summary = refreshError
    ? t("状态更新失败", "Status unavailable")
    : !status?.settings.deviceId
      ? t("未配置", "Not configured")
      : !status.settings.enabled
        ? t("已暂停", "Paused")
        : status?.state === "error"
          ? stateLabels.error
          : !hasBot
            ? t("等待机器人连接", "Waiting for a bot")
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
                setMessage(
                  t(
                    "Gateway 已启动，设备已自动注册。继续选择机器人平台即可。",
                    "Gateway is running and this device is registered. Choose a bot platform next.",
                  ),
                );
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
                    t(
                      `独立运行包已导出到 ${path}，解压后按包内说明启动。`,
                      `Standalone package exported to ${path}. Extract it and follow the included instructions.`,
                    ),
                  );
              })
            }
          />
        </section>
        <section id="im-device" tabIndex={-1}>
          {settings.deviceId && (
            <p className="im-identifier">
              {t("设备编号：", "Device ID: ")}
              {settings.deviceId}
            </p>
          )}
          {local && (
            <InlineNotice tone="info">
              {t(
                "2 · 当前设备已自动注册，无需填写地址或管理凭据。",
                "2 · This device was registered automatically. No URL or administrator token to enter.",
              )}
            </InlineNotice>
          )}
          <details
            open={showRemote}
            onToggle={(event) => setShowRemote(event.currentTarget.open)}
          >
            <summary>
              {t(
                "使用团队 Gateway（手动注册）",
                "Use a team Gateway (manual registration)",
              )}
            </summary>
            <ManagementSection
              title={t("2 · 注册当前设备", "2 · Register this device")}
              description={t(
                "Artemis 运行时接收远程任务。模型凭据和项目工具保留在当前电脑。",
                "Receive remote work while Artemis is running. Model credentials and project tools stay on this computer.",
              )}
            >
              <TextField
                label={t("Gateway 地址", "Gateway URL")}
                description={t(
                  "填写第 1 步拿到的服务地址，只填到域名和端口，不要加 /health 或其他路径。",
                  "Use the URL from step 1: the domain and port only, without /health or another path.",
                )}
                type="url"
                value={url}
                onValueChange={setUrl}
                placeholder="https://artemis.example.com"
                disabled={busy || settings.enabled}
              />
              <TextField
                label={t("设备名称", "Device name")}
                description={t(
                  "起一个你能认出的名字，例如“小王的 Mac”。任务会交给这台电脑执行。",
                  "Use a recognizable name, such as Alice's Mac. Tasks will run on this computer.",
                )}
                value={name}
                onValueChange={setName}
                disabled={busy}
              />
              <TextField
                label={t("Gateway 管理凭据", "Gateway administrator token")}
                type="password"
                value={adminToken}
                onValueChange={setAdminToken}
                autoComplete="off"
                disabled={busy}
                description={t(
                  "由 Gateway 管理员输入；自己部署时填写 .env.gateway 中的 ARTEMIS_GATEWAY_ADMIN_TOKEN。注册后自动清空，不会保存到本地。",
                  "Ask your Gateway administrator to enter this. For your own deployment, use ARTEMIS_GATEWAY_ADMIN_TOKEN from .env.gateway. Cleared after registration and never saved locally.",
                )}
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
                      setMessage(
                        t(
                          "设备注册成功。继续第 3 步连接机器人；如果团队已配置，刷新状态后可直接配对。",
                          "Device registered. Continue to step 3, or refresh and pair if your team already configured a bot.",
                        ),
                      );
                    })
                  }
                >
                  {t("注册当前设备", "Register device")}
                </Button>
                <Button disabled={busy} onClick={() => void run(refresh)}>
                  {t("刷新状态", "Refresh status")}
                </Button>
              </div>
              <p>
                {t(
                  "成功标志：上方出现设备编号。无需重复注册；注册新设备前请先暂停连接。",
                  "Success check: a device ID appears above. Registration is one-time; pause the connection before registering a different device.",
                )}
              </p>
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
        {/* 平台接入指引统一收进顶部折叠块：slack 恒显示，飞书/企微一致。 */}
        <details className="im-setup-guide-top">
          <summary>{t("接入指引", "Setup guide")}</summary>
          <div className="im-setup-guide-body">
            {channel === "slack" ? (
              <ImSlackSetup
                t={t}
                busy={busy}
                copy={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(SLACK_APP_MANIFEST);
                    setMessage(
                      t(
                        "Slack 应用配置已复制。在 Slack 创建应用时选择 From a manifest 并粘贴。",
                        "Manifest copied. Choose From a manifest when creating your Slack app and paste it.",
                      ),
                    );
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
            <p>
              {t(
                "先为这台电脑启动消息服务，再保存机器人凭据。个人使用只需点一次启动并注册。",
                "Start the message service on this computer before saving credentials. Personal setup takes one start-and-register action.",
              )}
            </p>
            <Button onClick={() => navigateStep("im-prepare")}>
              {t("去启动本机消息服务", "Set up the local message service")}
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
              setMessage(
                t(
                  "旧机器人配置已导入，请重新配对并授权项目。",
                  "Legacy bot imported. Pair again and grant project access.",
                ),
              );
            }}
          />
        )}
        <div className="im-block im-bots">
          <div className="im-block-header">
            <h4>{t("机器人列表", "Bot list")}</h4>
            {/* 标题行尾的「机器人+加号」新建入口（ui Button 契约要求
                  可见文字，纯图标动作用原生按钮 + aria-label）。 */}
            <Tooltip
              label={t("新建 BOT 连接", "New bot connection")}
              align="end"
            >
              <button
                type="button"
                className="im-icon-action"
                disabled={busy}
                aria-label={t("新建 BOT 连接", "New bot connection")}
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
                ? t(
                    "凭据已保存，请刷新确认连接状态。",
                    "Credentials saved. Refresh to confirm the connection.",
                  )
                : t("尚未保存机器人连接", "No saved bot connection")}
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
              {connection.error && (
                <InlineNotice tone="danger">{connection.error}</InlineNotice>
              )}
              <Tooltip label={t("更换凭据", "Replace credentials")} align="end">
                <button
                  type="button"
                  className="im-icon-action"
                  disabled={busy}
                  aria-label={t(
                    `更换凭据 ${connection.name}`,
                    `Replace credentials ${connection.name}`,
                  )}
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
              <Tooltip
                label={t("刷新机器人连接状态", "Refresh bot connection status")}
                align="end"
              >
                <button
                  type="button"
                  className="im-icon-action"
                  disabled={busy || !settings.deviceId}
                  aria-label={t(
                    `刷新 ${connection.name} 连接状态`,
                    `Refresh ${connection.name} connection status`,
                  )}
                  onClick={() => void run(refresh)}
                >
                  <ArtemisIcon height={13} name="refresh" width={13} />
                </button>
              </Tooltip>
              <Tooltip
                label={t("生成配对码", "Generate pairing code")}
                align="end"
              >
                <button
                  type="button"
                  className="im-icon-action"
                  disabled={busy || !settings.deviceId}
                  aria-label={t(
                    `生成配对码 ${connection.name}`,
                    `Generate pairing code ${connection.name}`,
                  )}
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
                    setMessage(
                      t("机器人连接已移除。", "Bot connection removed."),
                    );
                    try {
                      await refresh();
                    } catch (error) {
                      setRefreshError(String(error));
                    }
                  })
                }
              />
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
                ? t(
                    `更换凭据 · ${dialogConnection.name}`,
                    `Replace credentials · ${dialogConnection.name}`,
                  )
                : t("新建机器人连接", "New bot connection")
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
                  ? t(
                      `更换“${dialogConnection.name}”的凭据`,
                      `Replace credentials for “${dialogConnection.name}”`,
                    )
                  : t("新建机器人连接", "New bot connection")}
              </h2>
            </header>
            <div className="im-bot-dialog-body">
              {channel === "feishu" && (
                <Select
                  labelVisibility="visible"
                  label={t("应用区域", "App region")}
                  description={t(
                    "选择创建应用的开放平台。Lark 国际版与飞书国内版的应用凭据不能混用。",
                    "Choose the console where you created the app. Lark and Feishu app credentials are not interchangeable.",
                  )}
                  value={feishuDomain}
                  options={[
                    {
                      value: "feishu",
                      label: t(
                        "飞书国内版（open.feishu.cn）",
                        "Feishu (open.feishu.cn)",
                      ),
                    },
                    {
                      value: "lark",
                      label: t(
                        "Lark 国际版（open.larksuite.com）",
                        "Lark (open.larksuite.com)",
                      ),
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
                <summary>
                  {t(
                    "高级设置（通常无需修改）",
                    "Advanced settings (usually unnecessary)",
                  )}
                </summary>
                <div className="im-field-stack">
                  {channel === "feishu" && (
                    <Select
                      labelVisibility="visible"
                      label={t("接入方式", "Transport")}
                      value={feishuTransport}
                      options={[
                        {
                          value: "websocket",
                          label: t(
                            "长连接（无需公网地址）",
                            "Long connection (no public URL)",
                          ),
                        },
                        {
                          value: "webhook",
                          label: t("HTTPS 回调", "HTTPS callback"),
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
                  label={t(
                    "机器人配置的管理凭据",
                    "Administrator token for this bot configuration",
                  )}
                  type="password"
                  value={adminToken}
                  onValueChange={setAdminToken}
                  autoComplete="off"
                  disabled={busy}
                  description={t(
                    "请管理员再次输入 Gateway 管理凭据；保存后会自动清空。",
                    "Ask the administrator to enter the Gateway token again; it is cleared after saving.",
                  )}
                />
              )}
              {channel === "feishu" &&
                feishuTransport === "webhook" &&
                local && (
                  <InlineNotice tone="info">
                    {t(
                      "飞书需要公网 HTTPS 回调；请在第 1 步导出并部署独立 Gateway，或连接团队服务后再配置。",
                      "Feishu needs a public HTTPS callback. Export and deploy a standalone Gateway in step 1, or connect to your team service first.",
                    )}
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
                            : t("飞书", "Feishu")
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
                      setMessage(
                        t("机器人凭据已保存。", "Bot credentials saved."),
                      );
                      try {
                        await refresh();
                      } catch (error) {
                        setMessage(
                          t(
                            `凭据已保存，但连接状态刷新失败：${String(error)}`,
                            `Credentials saved, but connection refresh failed: ${String(error)}`,
                          ),
                        );
                        return;
                      }
                      try {
                        await generatePairCode();
                        setMessage(
                          t(
                            "凭据已保存，配对码已生成。连接成功后进入“配对与账号”。",
                            "Credentials saved and pairing code generated. Open Pairing & accounts once connected.",
                          ),
                        );
                      } catch (error) {
                        setMessage(
                          t(
                            `凭据已保存，但配对码生成失败：${String(error)}`,
                            `Credentials saved, but pairing code generation failed: ${String(error)}`,
                          ),
                        );
                      }
                    }).finally(() => setSavingChannel(null));
                  }}
                >
                  {t("保存并连接机器人", "Save and connect bot")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBotDialog(null);
                    setFields({});
                    setAdminToken("");
                  }}
                >
                  {t("取消", "Cancel")}
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
                  {t("事件回调地址：", "Event callback URL: ")}
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
                      setMessage(
                        t("事件回调地址已复制。", "Callback URL copied."),
                      );
                    })
                  }
                >
                  {t("复制回调地址", "Copy callback URL")}
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
                  {t(
                    `在 ${pairingPlatformLabel} 中找到刚配置的机器人，打开本人单聊。不要把配对码发到群里。`,
                    `Find the configured bot in ${pairingPlatformLabel} and open a private chat. Do not send pairing codes to a group.`,
                  )}
                </p>
                <ol>
                  <li>
                    {activePairingPlatform === "slack"
                      ? t(
                          "复制下方的 pair 配对码指令，在 Slack 中作为普通消息发送，不加开头的 /。",
                          "Copy pair CODE below and send it as a regular Slack message without a leading /.",
                        )
                      : t(
                          `复制下方的 /pair 配对码指令；${pairingPlatformLabel} 使用带 / 的配对指令。`,
                          `Copy /pair CODE below; ${pairingPlatformLabel} uses the leading / in its pairing command.`,
                        )}
                  </li>
                  <li>
                    {activePairingPlatform === "wecom"
                      ? t(
                          "打开企业微信中刚配置的智能机器人单聊，粘贴完整指令，在 5 分钟内发送。",
                          "Open a private chat with your configured WeCom intelligent bot, paste the complete command and send within 5 minutes.",
                        )
                      : activePairingPlatform === "slack"
                        ? t(
                            "在安装应用的 Slack 工作区中打开该应用的私信，粘贴完整指令，在 5 分钟内发送。",
                            "Open a direct message with the app in the Slack workspace where it is installed, paste the complete command and send within 5 minutes.",
                          )
                        : t(
                            `在 ${pairingPlatformLabel} 中搜索应用名称并打开机器人单聊，粘贴完整指令，在 5 分钟内发送。`,
                            `Search for the app name in ${pairingPlatformLabel}, open the bot's private chat, paste the complete command and send within 5 minutes.`,
                          )}
                  </li>
                  <li>
                    {t(
                      "发送后在下方核对该连接的账号并批准请求；机器人回复“配对成功”、账号出现在机器人行下即完成。",
                      "After sending, verify the account under this connection and approve the request. The bot confirms pairing and the account appears under the bot row.",
                    )}
                  </li>
                </ol>
              </div>
            }
            copy={(text) =>
              void run(async () => {
                await navigator.clipboard.writeText(text);
                setMessage(
                  t(
                    "配对指令已复制，请在本人机器人单聊中发送。",
                    "Pairing command copied. Send it in your private bot chat.",
                  ),
                );
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
          ? t(`可写 ${write.join("、")}`, `Writes ${write.join(", ")}`)
          : t("整个项目可读", "Whole project readable");
      const state = !grant.security?.confirmedAt
        ? t("待确认范围", "Confirm scope")
        : grant.expiresAt <= Date.now()
          ? t("已过期", "Expired")
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
      setMessage(
        t(
          "项目授权已保存，连接已启用。",
          "Project permissions saved and connection enabled.",
        ),
      );
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
          <summary>{t("说明与提示", "Notes & tips")}</summary>
          <div className="im-perm-guide-body">
            <p>
              {t(
                "仅开放选中的项目，勾选即生效。先选 Plan（只读分析），需要修改文件时再改为 Execute；撤销授权会停止对应远程任务。",
                "Only selected projects are accessible, and checking applies immediately. Start with Plan (read-only analysis), switch to Execute for file changes. Revocation cancels the affected remote work.",
              )}
            </p>
            <p>
              {t(
                "首个勾选的项目自动设为默认；未设默认或默认为临时会话时，手机上的普通消息直接发起临时任务（不绑定项目的会话：可对话获得指引，仅咨询分析，不访问任何项目文件）。",
                "Your first checked project becomes the default; with the ad-hoc chat as default, plain messages start temporary advisory tasks that touch no project files.",
              )}
            </p>
            <p>
              {t(
                "之后随时改：手机上发 /projects 就能查看和调整授权的项目；单聊发 /help 查看全部指令。IM 任务使用独立工具权限，MCP 与扩展暂不开放到远程入口。",
                "Change anytime: send /projects from your phone to review and adjust authorized projects, or /help for all commands. Remote tasks have separate tool permissions; MCP and extensions are currently excluded.",
              )}
            </p>
            {!projects.length && (
              <p>
                {t(
                  "还没有可选项目：先在 Artemis 打开一个项目，再回来勾选。",
                  "No projects yet — open one in Artemis first, then come back to check it.",
                )}
              </p>
            )}
          </div>
        </details>
        {/* W4：临时会话是内置授权目标——已配对即可收发消息并获得指引，也可发起
            plan 档临时任务（无项目工作区，不碰项目文件）；不占项目授权，不可取消。 */}
        <div className="im-project im-project-builtin">
          <Checkbox
            label={t(
              "临时会话（内置，始终可用）",
              "Ad-hoc chats (built in, always available)",
            )}
            defaultChecked
            disabled
          />
          {adhocDefault && (
            <span
              className="im-default-badge"
              aria-label={t("默认项目", "Default project")}
            >
              {t("默认", "Default")}
            </span>
          )}
          {!adhocDefault && (
            <Button
              className="im-set-default"
              size="compact"
              variant="quiet"
              title={t(
                "把默认项目切回临时会话",
                "Make ad-hoc chats the default",
              )}
              disabled={busy}
              onClick={() => applyNow({ ...settings, defaultProjectId: "" })}
            >
              {t("设为默认", "Set default")}
            </Button>
          )}
        </div>
        <h4 className="im-project-list-title">{t("项目列表", "Projects")}</h4>
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
                  aria-label={t("默认项目", "Default project")}
                >
                  {t("默认", "Default")}
                </span>
              )}
              {grant && settings.defaultProjectId !== project.id && (
                <Button
                  className="im-set-default"
                  size="compact"
                  variant="quiet"
                  title={t("设为默认项目", "Make the default project")}
                  disabled={busy}
                  onClick={() =>
                    applyNow({
                      ...settings,
                      defaultProjectId: project.id,
                    })
                  }
                >
                  {t("设为默认", "Set default")}
                </Button>
              )}
              {grant && (
                <Button
                  className="im-grant-open"
                  size="compact"
                  variant="quiet"
                  title={t("打开授权设置", "Open permission settings")}
                  disabled={busy}
                  onClick={(event) => {
                    grantDialogAnchor.current = event.currentTarget;
                    setGrantDialog(project.id);
                  }}
                >
                  {t("授权配置", "Permissions")}
                </Button>
              )}
              {grant && grantDialog === project.id && (
                <Dialog
                  className="im-grant-dialog"
                  label={t(
                    `${project.name} · 授权设置`,
                    `${project.name} · Permissions`,
                  )}
                  returnFocusRef={grantDialogAnchor}
                  onOpenChange={(open) => {
                    if (!open) closeGrantDialog(project.id);
                  }}
                  open
                >
                  <header>
                    <h2>
                      {t(
                        `${project.name} · 授权设置`,
                        `${project.name} · Permissions`,
                      )}
                    </h2>
                  </header>
                  <div className="im-grant-dialog-body">
                    {/* 三档模式（D3）：档位切换收窄离开 Execute 时同步关闭命令与网络。 */}
                    <div
                      className="im-mode-tiers"
                      role="radiogroup"
                      aria-label={t("任务模式", "Task mode")}
                    >
                      {(
                        [
                          [
                            "plan",
                            t("Plan · 只读分析", "Plan · Read-only"),
                            t(
                              "可读整个项目，不修改文件",
                              "Reads the whole project, changes nothing",
                            ),
                          ],
                          [
                            "review",
                            t("Review · 只读审查", "Review · Read-only"),
                            t(
                              "同 Plan，用于复核结果",
                              "Same reads, for reviewing results",
                            ),
                          ],
                          [
                            "execute",
                            t("Execute · 允许修改", "Execute · May change"),
                            t("需要选择可写范围", "Requires a writable scope"),
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
                        ? t(
                            "Execute 需要选择可写范围；可读默认为整个项目。",
                            "Execute needs a writable scope; reads default to the whole project.",
                          )
                        : t(
                            "默认范围：可读整个项目，不可写任何文件。",
                            "Default scope: the whole project is readable; no file is writable.",
                          )}
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
                          ? t("收起自定义范围", "Collapse custom scope")
                          : t("自定义范围 ▸", "Custom scope")}
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
                        label={t("执行审批", "Execution approval")}
                        value={grant.approval}
                        onValueChange={(approval) =>
                          updateGrant(project.id, { approval })
                        }
                        disabled={busy}
                        options={[
                          {
                            value: "ask",
                            label: t("每次确认", "Ask each time"),
                          },
                          {
                            value: "automatic",
                            label: t(
                              "授权范围内自动执行",
                              "Automatic within this grant",
                            ),
                          },
                        ]}
                      />
                      {grant.mode === "execute" && (
                        <>
                          {status?.scopedShellSupported === false ? (
                            <InlineNotice tone="warning">
                              {t(
                                "当前平台缺少受限文件与命令组件，请更新 Artemis 后使用目录枚举、新建文件和命令执行。",
                                "Scoped file and command components are unavailable. Update Artemis to use directory listing, file creation and commands.",
                              )}
                            </InlineNotice>
                          ) : null}
                          <Checkbox
                            label={t(
                              "允许沙箱命令",
                              "Allow sandboxed commands",
                            )}
                            checked={grant.shell}
                            disabled={
                              busy || status?.scopedShellSupported === false
                            }
                            onCheckedChange={(shell) =>
                              updateGrant(project.id, { shell })
                            }
                          />
                          <Checkbox
                            label={t(
                              "允许命令访问网络",
                              "Allow command network access",
                            )}
                            description={t(
                              "开启通用网络访问；首版不按域名或数据内容限制网络外发。",
                              "Enables general network access; this version does not filter network destinations or payloads.",
                            )}
                            checked={grant.network}
                            disabled={busy || !grant.shell}
                            onCheckedChange={(network) =>
                              updateGrant(project.id, { network })
                            }
                          />
                        </>
                      )}
                      <div className="im-field-stack">
                        <h4>
                          {t(
                            "允许哪些群使用这个项目",
                            "Which groups may use this project",
                          )}
                        </h4>
                        {!availableSpaces.length && (
                          <p>
                            {t(
                              "还没有可选的群空间。先到“群聊”保存配置，再回来选择。",
                              "No group spaces yet. Save a space in Group spaces, then return here.",
                            )}
                          </p>
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
                        <summary>
                          {t(
                            "高级：手动填写空间编号",
                            "Advanced: enter space IDs manually",
                          )}
                        </summary>
                        <TextField
                          label={t(
                            "允许的协作空间 ID（逗号分隔）",
                            "Allowed space IDs (comma separated)",
                          )}
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
                        {t("授权到期：", "Grant expires: ")}
                        {new Date(grant.expiresAt).toLocaleString(locale)}{" "}
                        <Button
                          disabled={busy}
                          onClick={() =>
                            updateGrant(project.id, {
                              expiresAt: Date.now() + 30 * 86400000,
                            })
                          }
                        >
                          {t("续期 30 天", "Renew for 30 days")}
                        </Button>
                      </p>
                    </div>
                  </div>
                  <footer>
                    <span>
                      {t(
                        "确认后立即保存并启用，无需再到下方操作。",
                        "Confirming saves and enables immediately—nothing else to press below.",
                      )}
                    </span>
                    <div className="im-grant-dialog-actions">
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => closeGrantDialog(project.id)}
                      >
                        {t("关闭", "Close")}
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
                        {t("确认设置", "Confirm settings")}
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
            {t(
              "授权已保存，连接未启用。",
              "Authorizations saved; connection not enabled.",
            )}{" "}
            {enableFailedError}{" "}
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
                  setMessage(t("连接已启用。", "Connection enabled."));
                })
              }
            >
              {t("重试启用", "Retry enable")}
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
          title={t("IM 群聊", "IM groups")}
          description={t(
            "一个原生群对应一个本地群对话。",
            "One native group, one local conversation.",
          )}
        >
          {!local ? (
            <InlineNotice tone="warning">
              {t(
                "请先启用本机内置服务。原生群不使用共享网关。",
                "Enable the built-in local service. Native groups do not use a shared gateway.",
              )}
            </InlineNotice>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void run(reload)}>
                {t("刷新群列表", "Refresh groups")}
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
              aria-label={t("测试任务进度", "Test task progress")}
            >
              <li data-state="guide">
                {t("你从手机发送任务指令", "You send the task command")}
              </li>
              <li data-state={taskDetected ? "done" : "pending"}>
                {taskDetected
                  ? t("桌面已出现任务", "A task appeared on the desktop")
                  : t("等待桌面出现任务", "Waiting for a task on the desktop")}
              </li>
              <li data-state={verify.confirmed ? "done" : "pending"}>
                {verify.confirmed
                  ? t("你已确认任务完成", "You confirmed the task finished")
                  : t("等待任务完成", "Waiting for the task to finish")}
              </li>
              <li data-state={verify.confirmed ? "done" : "pending"}>
                {verify.confirmed
                  ? t("你已确认收到回复", "You confirmed the reply arrived")
                  : t(
                      "等待回复送达手机",
                      "Waiting for the reply on your phone",
                    )}
              </li>
            </ol>
            <Checkbox
              label={t(
                "我已在手机上收到 Artemis 的回复（可撤销）",
                "I received Artemis's reply on my phone (undo anytime)",
              )}
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
                {t(
                  "设置群协作（可选）",
                  "Set up group collaboration (optional)",
                )}
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
    /* ② 摘要按渠道配对谓词给出：已配对渠道名 / 已连接待绑定 / 连接概况。 */
    const connectedChannelSet = new Set(
      connections.filter((c) => c.state === "connected").map((c) => c.channel),
    );
    const pairedNames = IM_CHANNELS.filter(
      (platform) =>
        connectedChannelSet.has(platform) &&
        (status?.identities ?? []).some((i) => i.channel === platform),
    ).map((platform) => imChannelLabel(platform, t));
    const channelSummary = pairedNames.length
      ? t(
          `已连接 · ${pairedNames.join("、")}`,
          `Connected · ${pairedNames.join(", ")}`,
        )
      : health.failed > 0
        ? imConnectionSummary(connections, t)
        : hasBot
          ? t("已连接 · 待绑定账号", "Connected · account pending")
          : connections.length
            ? imConnectionSummary(connections, t)
            : t("还没有机器人，先添加一个", "No bot yet — add one first");
    return (
      <>
        <ImFlowCard
          icon="connector"
          title={t("连接服务", "Connect the service")}
          done={flowSteps[0]!.done}
          summary={settings.deviceId || t("未注册", "Not registered")}
          open={openStep("service")}
          onToggle={() => setFlowCard(openStep("service") ? null : "service")}
          t={t}
        >
          {renderGatewayBody()}
        </ImFlowCard>
        {/* ② 合并卡（原②添加机器人+③绑定账号）：同一渠道内线性完成接入与配对；
            尾部「顺手验证」为可选段，不计入完成链。 */}
        <ImFlowCard
          icon="message"
          title={t("接入渠道", "Onboard a channel")}
          done={flowSteps[1]!.done}
          summary={channelSummary}
          open={openStep("channel")}
          onToggle={() => setFlowCard(openStep("channel") ? null : "channel")}
          t={t}
        >
          <div
            className="im-channel-tabs"
            role="tablist"
            aria-label={t("选择渠道", "Choose a channel")}
          >
            {IM_CHANNELS.map((platform) => {
              /* tab 仅保留渠道名：连接状态由名称前的信号灯表达（正常亮绿、
                 异常亮红、连接中黄灯），已配置（有连接或已存凭据）渠道名
                 提亮区分；约束文案不再挤进 tab。 */
              const platformConnections = connections.filter(
                (c) => c.channel === platform,
              );
              const state = imChannelConnectionState(platformConnections);
              const lit =
                state === "connected" ||
                state === "error" ||
                state === "partial_error" ||
                state === "connecting";
              const configured =
                platformConnections.length > 0 || !!savedPending[platform];
              return (
                <button
                  type="button"
                  role="tab"
                  key={platform}
                  className="im-channel-tab"
                  aria-selected={channel === platform}
                  data-connection-state={state}
                  data-configured={configured || undefined}
                  onClick={() => flowSelectChannel(platform)}
                >
                  {lit ? (
                    <span
                      aria-hidden="true"
                      className="im-dot"
                      data-state={state}
                    />
                  ) : null}
                  <strong>{imChannelLabel(platform, t)}</strong>
                </button>
              );
            })}
          </div>
          {renderChannelBody()}
          {renderVerifySection()}
        </ImFlowCard>
        {/* 临时会话是内置授权目标，③摘要计作 1 个项目。 */}
        <ImFlowCard
          icon="folder"
          title={t("授权项目", "Authorize projects")}
          done={flowSteps[2]!.done}
          summary={t(
            `${settings.grants.length + 1} 个项目`,
            `${settings.grants.length + 1} projects`,
          )}
          open={openStep("projects")}
          onToggle={() => setFlowCard(openStep("projects") ? null : "projects")}
          t={t}
        >
          {renderPermissionsBody()}
          {allDone && (
            <div className="im-ceremony">
              <p className="im-ceremony-title">
                {t(
                  "三步配置完成，手机现在可以派活了",
                  "Three steps done — your phone can dispatch work now",
                )}
              </p>
              <div className="im-ceremony-actions">
                <Button onClick={() => selectView("overview")}>
                  {t("查看连接概览", "Review connections")}
                </Button>
                <Button variant="quiet" onClick={() => selectView("test")}>
                  {t(
                    "发测试消息验证（可选）",
                    "Send a test message (optional)",
                  )}
                </Button>
                {channel !== "wecom" && (
                  <Button variant="quiet" onClick={() => selectView("spaces")}>
                    {t(
                      "设置群协作（可选）",
                      "Set up group collaboration (optional)",
                    )}
                  </Button>
                )}
              </div>
              <p className="im-fine">
                {t(
                  "没验证也能用：第 ② 步底部的「顺手验证」随时可以补做。",
                  "Verification is optional — the verify tail of step ② can be done anytime.",
                )}
              </p>
            </div>
          )}
        </ImFlowCard>
      </>
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
          <h2>{t("消息接入", "Message integrations")}</h2>{" "}
          <p>
            {t(
              "通过 IM 单聊或群协作，把任务交给这台电脑执行。",
              "Send tasks to this computer through private bot chats or group collaboration.",
            )}
          </p>
        </div>
        <div
          className="im-header-state"
          title={t(
            "机器人接入状态；不代表手机或电脑上的 IM 客户端在线状态。",
            "Bot connection status; separate from IM client presence on phones and computers.",
          )}
        >
          {activeScreen === "flow" && (
            <ImFlowProgress done={flowDone} total={flowSteps.length} t={t} />
          )}
          {(activeScreen === "overview" ||
            /* D1：首次流程不出现总开关；已注册设备回看引导流时保留暂停/恢复。 */
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
                {t("启用", "Enable")}
              </span>
              <Switch
                labelVisibility="hidden"
                label={t("启用 IM 连接", "Enable IM connection")}
                title={t(
                  "暂停会保留已有配置与授权。",
                  "Pausing keeps configuration and grants.",
                )}
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
          {t("无法刷新状态：", "Unable to refresh status: ")}
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
              {t("返回概览", "Back to overview")}
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
            {t("← 返回单聊设置", "← Back to direct-chat settings")}
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
                {t("继续设置", "Continue setup")}
              </Button>
            )}
            {channel !== "wecom" && (
              <Button disabled={busy} onClick={() => selectView("spaces")}>
                {t("设置群协作", "Set up group collaboration")}
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
      <Tooltip label={t("查看连接 ID", "View connection ID")} align="end">
        <button
          type="button"
          className="im-icon-action im-bot-id-btn"
          aria-expanded={open}
          aria-label={t("查看连接 ID", "View connection ID")}
          onClick={() => setOpen((value) => !value)}
        >
          <ArtemisIcon height={12} name="info" width={12} />
        </button>
      </Tooltip>
      {open && (
        <span className="im-bot-id-pop">
          <code>{id}</code>
          <Tooltip label={t("复制连接 ID", "Copy connection ID")} align="end">
            <button
              type="button"
              className="im-icon-action im-bot-id-btn"
              aria-label={t("复制连接 ID", "Copy connection ID")}
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
