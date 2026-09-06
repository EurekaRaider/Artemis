import { useEffect, useRef, useState } from "react";
import {
  executionGrantSchema,
  type AppLocale,
  type ImConnectionStatus,
  type ImSettings,
  type ImStatus,
  type Project,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice, LoadingState } from "@artemis/ui/feedback";
import {
  Checkbox,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from "@artemis/ui/forms";
import { ManagementSection } from "@artemis/ui/management";
import {
  ImSetupGuide,
  ImGatewayInstructions,
  ImFirstTaskInstructions,
} from "./ImSetupGuide";

import { ImSlackSetup, SLACK_APP_MANIFEST } from "./ImSlackSetup";
import {
  ImNavigation,
  IM_CHANNELS,
  imChannelLabel,
  imChannelConstraint,
  imConnectionLabel,
  imConnectionHealth,
  imConnectionSummary,
  type ImView,
  type ImChannel,
} from "./ImNavigation";
import {
  ImAccounts,
  ImPairingCode,
  type ImPairCode,
} from "./ImAccountControls";

import { ImDiagnostics, diagnosticSchema } from "./ImDiagnostics";
import { ImSpaceBuilder } from "./ImSpaceBuilder";
import { ImGatewayDeployment } from "./ImGatewayDeployment";
import { ImGroupTaskComposer } from "./ImGroupTaskComposer";
import { ImSavedSpaces } from "./ImSavedSpaces";
import { ImLegacyImport } from "./ImLegacyImport";
import { ImPlatformSetup } from "./ImPlatformSetup";
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
  const [view, setView] = useState<ImView | "guide">("guide");
  const [reviewing, setReviewing] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [compact, setCompact] = useState(false);
  const [focusTarget, setFocusTarget] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const wasReady = useRef(false);
  const mounted = useRef(true);
  const [channel, setChannel] = useState<ImChannel>("wecom");
  const [pairingPlatform, setPairingPlatform] = useState<ImChannel | "lark">();
  const [showRemote, setShowRemote] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [spaceJson, setSpaceJson] = useState("");
  const [spaceFormRevision, setSpaceFormRevision] = useState(0);
  const [diagnostics, setDiagnostics] = useState<unknown>();
  const [spaceConfirmation, setSpaceConfirmation] = useState("");
  const [savedMetadata, setSavedMetadata] = useState<
    Partial<Record<ImChannel, BotMetadata>>
  >({});
  useEffect(() => {
    setSavedMetadata({});
    setDiagnostics(undefined);
    setSpaceJson("");
    setSpaceConfirmation("");
    setPairCode(undefined);
    setPairingPlatform(undefined);
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
    const timer = window.setInterval(async () => {
      if (running.current || refreshing) return;
      refreshing = true;
      const epoch = refreshEpoch.current;
      try {
        let current = await window.artemis.getImStatus();
        if (current.settings.deviceId)
          current = (await window.artemis.manageIm({
            action: "refresh",
          })) as Status;
        if (active && !running.current && epoch === refreshEpoch.current) {
          setStatus(current);
          setRefreshError("");
        }
      } catch (error) {
        if (active && !running.current && epoch === refreshEpoch.current)
          setRefreshError(String(error));
      } finally {
        refreshing = false;
      }
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
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
      setCompact(
        root.clientWidth < 560 || (!!dialog && dialog.clientWidth < 720),
      ),
    );
    observer.observe(root);
    if (dialog) observer.observe(dialog);
    return () => observer.disconnect();
  }, [!!settings]);
  const connections = (status?.connections ?? []) as ImConnectionStatus[];
  const hasBot = connections.some((c) => c.state === "connected");
  const ready = hasBot && !!status?.identities.length;
  useEffect(() => {
    if (ready && !wasReady.current && !reviewing) {
      const connected = connections.find((c) => c.state === "connected");
      if (connected) {
        setView(connected.channel);
        setChannel(connected.channel);
        setConnectionId(connected.id);
        setFields({});
        setAdminToken("");
        setEditingCredentials(false);
        setPairCode(undefined);
        setFocusTarget("im-bot");
      }
    }
    wasReady.current = ready;
  }, [ready, reviewing]);
  useEffect(() => {
    if (!focusTarget) return;
    const section = document.getElementById(focusTarget);
    section?.scrollIntoView?.({ block: "nearest" });
    section?.focus({ preventScroll: true });
    setFocusTarget("");
  }, [view, focusTarget]);
  function selectView(next: ImView) {
    setView(next);
    setPairingPlatform(undefined);
    setFields({});
    setAdminToken("");
    setEditingCredentials(false);
    if (IM_CHANNELS.includes(next as ImChannel)) {
      setChannel(next as ImChannel);
      setConnectionId(connections.find((c) => c.channel === next)?.id ?? "");
    }
  }
  function navigateStep(id: string) {
    const next =
      id === "im-prepare" || id === "im-device"
        ? "gateway"
        : id === "im-bot"
          ? channel
          : id === "im-permissions"
            ? "permissions"
            : "pairing";
    selectView(next);
    if (id === "im-device") setShowRemote(true);
    if (id === "im-test") setFirstTaskOpen(true);
    setFocusTarget(id);
  }
  const [firstTaskOpen, setFirstTaskOpen] = useState(false);
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    refreshEpoch.current++;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      await action();
      return true;
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
          ? executionGrantSchema.parse({ ...g, ...changes })
          : g,
      ),
    });
  }
  const channelConnections = connections.filter((c) => c.channel === channel);
  const selectedConnection =
    channelConnections.find((c) => c.id === connectionId) ??
    channelConnections[0];
  const credentialMetadata = selectedConnection
    ? {
        ...selectedConnection.configuration,
        id: selectedConnection.id,
        name: selectedConnection.name,
      }
    : savedMetadata[channel];
  const savedCredentials = !!credentialMetadata;
  const feishuTransport =
    fields.transport ??
    credentialMetadata?.transport ??
    (savedCredentials ? "webhook" : "websocket");
  const feishuDomain = fields.domain ?? credentialMetadata?.domain ?? "feishu";
  const activePairingPlatform =
    pairingPlatform ??
    (channel === "feishu" && feishuDomain === "lark" ? "lark" : channel);
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
    if (view !== "spaces" || !local || !status?.settings.deviceId) return;
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
  }, [view, local, status?.settings.deviceId]);
  const accounts = (requestsOnly = false) => (
    <ImAccounts
      key={`${view}:${requestsOnly}`}
      t={t}
      busy={busy}
      identities={
        requestsOnly
          ? []
          : (status?.identities ?? []).filter(
              (i) => view === "pairing" || i.channel === channel,
            )
      }
      requests={
        requestsOnly
          ? (status?.pairingRequests ?? []).filter(
              (r) => view === "pairing" || r.identity.channel === channel,
            )
          : []
      }
      showAccounts={!requestsOnly}
      resolve={(requestId, approve) =>
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
        })
      }
      unpair={(identity) =>
        run(async () => {
          await window.artemis.manageIm({ action: "unpair", identity });
          await refresh();
          setMessage(t("账号已解除绑定。", "Account unpaired."));
        })
      }
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
  const adminSpaces =
    diagnostics &&
    typeof diagnostics === "object" &&
    "spaces" in diagnostics &&
    Array.isArray(diagnostics.spaces)
      ? diagnostics.spaces
      : [];
  let spaceReady = false;
  try {
    const parsed = diagnosticSchema.shape.spaces.element.safeParse(
      JSON.parse(spaceJson),
    );
    if (parsed.success) {
      const draft = parsed.data;
      spaceReady =
        !!draft.name.trim() &&
        /^[\w-]{1,100}$/u.test(draft.id) &&
        draft.endpoints.length > 0 &&
        draft.endpoints.length <= 8 &&
        draft.participants.length > 0 &&
        draft.participants.every((p) => !!p.name.trim()) &&
        draft.participants.length <= 50 &&
        draft.endpoints.every(
          (e) =>
            e.kind === "group" &&
            draft.administrators.some((a) => a.connectionId === e.connectionId),
        );
    }
  } catch {
    /* The advanced editor may contain incomplete JSON. */
  }
  if (!settings)
    return message ? (
      <InlineNotice tone="danger">{message}</InlineNotice>
    ) : (
      <LoadingState
        label={t("正在加载 IM 设置", "Loading IM settings")}
        lines={3}
      />
    );
  const stateLabels = {
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
  const summary = !settings.deviceId
    ? t("未配置", "Not configured")
    : !settings.enabled
      ? t("已暂停", "Paused")
      : status?.state === "error"
        ? stateLabels.error
        : !hasBot
          ? t("等待机器人连接", "Waiting for a bot")
          : stateLabels[status?.state ?? "connecting"];
  const health = imConnectionHealth(connections);
  return (
    <div
      ref={panelRef}
      className="im-settings"
      data-mode={view === "guide" ? "wizard" : "manage"}
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
        <div className="im-header-state">
          <span className="im-status-pill" role="status">
            <span
              className="im-dot"
              data-state={
                settings.enabled
                  ? health.failed
                    ? "error"
                    : status?.state
                  : "disabled"
              }
              aria-hidden="true"
            />
            {summary}
            {health.failed > 0 && ` · ${imConnectionSummary(connections, t)}`}
          </span>
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
            checked={settings.enabled}
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
      {view === "guide" ? (
        <div className="im-wizard">
          <ImSetupGuide
            locale={locale}
            {...(status ? { status } : {})}
            onNavigate={navigateStep}
          />
          <div
            className="im-platform-cards"
            aria-label={t("支持的平台与接入要求", "Platforms and requirements")}
          >
            {IM_CHANNELS.map((platform) => (
              <Button
                className="im-platform-card"
                key={platform}
                onClick={() => {
                  selectView(platform);
                  setFocusTarget("im-bot");
                }}
              >
                <strong>{imChannelLabel(platform, t)}</strong>
                <span>{imChannelConstraint(platform, t)}</span>
              </Button>
            ))}
          </div>
          {ready && (
            <Button
              onClick={() => {
                setReviewing(false);
                selectView(channel);
              }}
            >
              {t("返回管理", "Back to management")}
            </Button>
          )}
        </div>
      ) : (
        <div className="im-layout">
          <ImNavigation
            view={view}
            onSelect={selectView}
            busy={busy}
            connections={connections}
            compact={compact}
            t={t}
          />
          {[
            ...IM_CHANNELS,
            "gateway",
            "pairing",
            "permissions",
            "spaces",
            "setup-guide",
          ]
            .filter((id) => id !== view)
            .map((id) => (
              <div
                hidden
                role="tabpanel"
                id={`im-panel-${id}`}
                aria-labelledby={`im-nav-${id}`}
                key={id}
              />
            ))}
          <div
            className="im-detail"
            role="tabpanel"
            id={`im-panel-${view}`}
            aria-labelledby={`im-nav-${view}`}
            tabIndex={0}
          >
            {view === "setup-guide" && (
              <ImSetupGuide
                locale={locale}
                {...(status ? { status } : {})}
                onNavigate={navigateStep}
              />
            )}

            {view === "gateway" && (
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
                    onToggle={(event) =>
                      setShowRemote(event.currentTarget.open)
                    }
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
                        label={t(
                          "Gateway 管理凭据",
                          "Gateway administrator token",
                        )}
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
                          disabled={
                            busy || settings.enabled || !url || !adminToken
                          }
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
                              const current =
                                await window.artemis.getImStatus();
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
                        <Button
                          disabled={busy}
                          onClick={() => void run(refresh)}
                        >
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
            )}
            {IM_CHANNELS.includes(view as ImChannel) && (
              <section id="im-bot" tabIndex={-1}>
                <ManagementSection
                  className="im-channel-section"
                  title={imChannelLabel(channel, t)}
                  description={imChannelConstraint(channel, t)}
                  actions={
                    <span className="im-status-pill">
                      <span
                        className="im-dot"
                        data-state={
                          imConnectionHealth(channelConnections).state
                        }
                        aria-hidden="true"
                      />
                      {imConnectionLabel(
                        imConnectionHealth(channelConnections).state,
                        t,
                      )}
                    </span>
                  }
                >
                  {accounts(true)}
                  {channelConnections.length > 1 && (
                    <Select
                      labelVisibility="visible"
                      label={t("机器人连接", "Bot connection")}
                      value={selectedConnection?.id ?? ""}
                      onValueChange={(id) => {
                        setConnectionId(id);
                        setEditingCredentials(false);
                        setFields({});
                        setAdminToken("");
                      }}
                      options={channelConnections.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                      disabled={busy}
                    />
                  )}
                  {channel === "feishu" && (
                    <>
                      {savedCredentials && !editingCredentials ? (
                        <p>
                          {t("应用区域：", "App region: ")}
                          {feishuDomain === "lark"
                            ? "Lark · open.larksuite.com"
                            : t(
                                "飞书 · open.feishu.cn",
                                "Feishu · open.feishu.cn",
                              )}
                        </p>
                      ) : (
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
                    </>
                  )}
                  {channel !== "slack" &&
                    (!savedCredentials || editingCredentials) && (
                      <ImPlatformSetup
                        key={channel}
                        channel={channel}
                        transport={feishuTransport}
                        domain={feishuDomain}
                        t={t}
                      />
                    )}
                  {!settings.deviceId && (
                    <InlineNotice tone="info">
                      <p>
                        {t(
                          "先为这台电脑启动消息服务，再保存机器人凭据。个人使用只需点一次启动并注册。",
                          "Start the message service on this computer before saving credentials. Personal setup takes one start-and-register action.",
                        )}
                      </p>
                      <Button onClick={() => navigateStep("im-prepare")}>
                        {t(
                          "去启动本机消息服务",
                          "Set up the local message service",
                        )}
                      </Button>
                    </InlineNotice>
                  )}
                  <div className="im-block im-credentials">
                    <div className="im-block-header">
                      <h4>
                        {channel !== "slack" &&
                          (!savedCredentials || editingCredentials) && (
                            <span aria-hidden="true">2 · </span>
                          )}
                        {t("应用凭据", "App credentials")}
                      </h4>
                      {savedCredentials && !editingCredentials && (
                        <>
                          <span>{t("已保存", "Saved")}</span>
                          <Button
                            variant="quiet"
                            className="management-text-action"
                            disabled={busy}
                            onClick={() => {
                              setFields(
                                Object.fromEntries(
                                  PUBLIC_BOT_FIELDS.flatMap((key) =>
                                    typeof credentialMetadata?.[key] ===
                                    "string"
                                      ? [[key, credentialMetadata[key]!]]
                                      : [],
                                  ),
                                ),
                              );
                              setEditingCredentials(true);
                            }}
                          >
                            {t("更换", "Replace")}
                          </Button>
                        </>
                      )}
                    </div>
                    <p className="im-credential-location">
                      {local
                        ? t(
                            "凭据加密保存在本机内置 Gateway。",
                            "Credentials are encrypted in this computer's built-in Gateway.",
                          )
                        : t(
                            "凭据加密保存在团队 Gateway。",
                            "Credentials are encrypted in the team Gateway.",
                          )}
                    </p>
                    {(!savedCredentials || editingCredentials) && (
                      <>
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
                              <>
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
                              </>
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
                          onClick={() =>
                            void run(async () => {
                              const token = adminToken;
                              setAdminToken("");
                              const savedId =
                                fields.id?.trim() ||
                                credentialMetadata?.id ||
                                `${channel}-${crypto.randomUUID()}`;
                              const savedName =
                                fields.name?.trim() ||
                                credentialMetadata?.name ||
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
                                      .map((key) => [
                                        key,
                                        fields[key]?.trim() ?? "",
                                      ]),
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
                                      fields[key]
                                        ? [[key, fields[key]!.trim()]]
                                        : [],
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
                              setEditingCredentials(false);
                              setMessage(
                                t(
                                  "机器人凭据已保存。",
                                  "Bot credentials saved.",
                                ),
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
                            })
                          }
                        >
                          {t("保存并连接机器人", "Save and connect bot")}
                        </Button>
                        {editingCredentials && (
                          <Button
                            disabled={busy}
                            onClick={() => {
                              setFields({});
                              setAdminToken("");
                              setEditingCredentials(false);
                            }}
                          >
                            {t("取消", "Cancel")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {channel === "feishu" && feishuTransport === "websocket" && (
                    <InlineNotice tone="info">
                      {t(
                        `在 ${feishuDomain === "lark" ? "Lark" : "飞书"} 开放平台选择“使用长连接接收事件”，订阅 im.message.receive_v1 并发布应用。此连接不会同时接收 HTTPS 回调。`,
                        `Select long connection delivery in the ${feishuDomain === "lark" ? "Lark" : "Feishu"} console, subscribe to im.message.receive_v1 and publish the app. This connection does not also accept HTTPS callbacks.`,
                      )}
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
                            "旧机器人配置已导入。请在“配对与账号”重新配对，并在“项目授权”选择可执行项目。",
                            "Legacy bot imported. Pair again in Pairing & accounts, then grant a project in Project permissions.",
                          ),
                        );
                      }}
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
                  {channel === "feishu" &&
                    feishuTransport === "webhook" &&
                    !local &&
                    selectedConnection?.callbackUrl && (
                      <div className="im-actions">
                        <p className="im-identifier">
                          {t("事件回调地址：", "Event callback URL: ")}
                          {selectedConnection.callbackUrl}
                        </p>
                        <Button
                          disabled={
                            !settings.gatewayUrl ||
                            !(credentialMetadata?.id || fields.id)
                          }
                          onClick={() =>
                            void run(async () => {
                              await navigator.clipboard.writeText(
                                selectedConnection.callbackUrl!,
                              );
                              setMessage(
                                t(
                                  "事件回调地址已复制。",
                                  "Callback URL copied.",
                                ),
                              );
                            })
                          }
                        >
                          {t("复制回调地址", "Copy callback URL")}
                        </Button>
                      </div>
                    )}
                  <h4>{t("连接状态", "Connection status")}</h4>
                  {!channelConnections.length && (
                    <p>
                      {savedCredentials
                        ? t(
                            "凭据已保存，请刷新确认连接状态。",
                            "Credentials saved. Refresh to confirm the connection.",
                          )
                        : t("尚未保存机器人连接", "No saved bot connection")}
                    </p>
                  )}
                  {channelConnections.map((connection) => (
                    <div className="im-connection" key={connection.id}>
                      <span
                        className="im-dot"
                        data-state={connection.state}
                        aria-hidden="true"
                      />
                      <code>{connection.name}</code>
                      <strong>{imConnectionLabel(connection.state, t)}</strong>
                      {connection.error && (
                        <InlineNotice tone="danger">
                          {connection.error}
                        </InlineNotice>
                      )}
                    </div>
                  ))}
                  {selectedConnection && (
                    <ImConnectionRemoval
                      key={`${settings.deviceId}:${selectedConnection.id}`}
                      name={selectedConnection.name}
                      local={local}
                      busy={busy}
                      t={t}
                      remove={(token) =>
                        run(async () => {
                          const id = selectedConnection.id;
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
                                  ).filter(
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
                          setEditingCredentials(false);
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
                  )}
                  <Button
                    variant="quiet"
                    className="management-text-action im-secondary-action"
                    disabled={busy || !settings.deviceId}
                    onClick={() => void run(refresh)}
                  >
                    {t("刷新机器人连接状态", "Refresh bot connection status")}
                  </Button>
                  {accounts()}
                  {savedCredentials && channel !== "slack" && (
                    <p>
                      {t(
                        "3 · 连接后绑定本人账号，再选择项目并发送第一条任务。",
                        "3 · Once connected, pair your account, allow a project and send your first task.",
                      )}
                    </p>
                  )}
                  <Button
                    variant="quiet"
                    className="management-text-action im-secondary-action"
                    onClick={() => {
                      selectView("pairing");
                      setFocusTarget("im-pair");
                    }}
                  >
                    {t("前往配对与账号", "Open pairing & accounts")}
                  </Button>
                  {(channel === "slack" ||
                    (savedCredentials && !editingCredentials)) && (
                    <details>
                      <summary>
                        {t("平台接入指引", "Platform setup guide")}
                      </summary>
                      {channel === "slack" ? (
                        <ImSlackSetup
                          t={t}
                          busy={busy}
                          copy={() =>
                            void run(async () => {
                              await navigator.clipboard.writeText(
                                SLACK_APP_MANIFEST,
                              );
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
                    </details>
                  )}
                </ManagementSection>
              </section>
            )}
            {view === "pairing" && (
              <>
                <section id="im-pair" tabIndex={-1}>
                  <ManagementSection
                    title={t(
                      "4 · 绑定你的 IM 账号",
                      "4 · Pair your IM account",
                    )}
                    description={t(
                      `在 ${pairingPlatformLabel} 中找到刚配置的机器人，打开本人单聊。不要把配对码发到群里。`,
                      `Find the configured bot in ${pairingPlatformLabel} and open a private chat. Do not send pairing codes to a group.`,
                    )}
                  >
                    {accounts(true)}
                    <Select
                      labelVisibility="visible"
                      label={t("配对平台", "Pairing platform")}
                      value={activePairingPlatform}
                      onValueChange={setPairingPlatform}
                      options={pairingOptions}
                      disabled={busy}
                    />
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
                          "发送后在这里核对账号并批准请求；机器人回复“配对成功”、下方出现账号即完成。",
                          "After sending, verify your account and approve the request here. The bot confirms pairing and your account appears below.",
                        )}
                      </li>
                    </ol>
                    <ImPairingCode
                      t={t}
                      pair={pairCode}
                      slack={activePairingPlatform === "slack"}
                      busy={busy || !settings.deviceId}
                      generate={() => void run(generatePairCode)}
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
                    {accounts()}
                    <Button disabled={busy} onClick={() => void run(refresh)}>
                      {t(
                        "我已发送，刷新配对结果",
                        "I sent it — refresh pairing",
                      )}
                    </Button>
                  </ManagementSection>
                </section>
                <details
                  open={firstTaskOpen}
                  onToggle={(event) =>
                    setFirstTaskOpen(event.currentTarget.open)
                  }
                >
                  <summary>
                    {t("试试第一条任务", "Try your first task")}
                  </summary>
                  <section id="im-test" tabIndex={-1}>
                    <ImFirstTaskInstructions
                      t={t}
                      slack={activePairingPlatform === "slack"}
                      copy={(text) =>
                        void run(async () => {
                          await navigator.clipboard.writeText(text);
                          setMessage(
                            t(
                              "指令已复制，请粘贴到机器人单聊中发送。",
                              "Command copied. Paste and send it in your private bot chat.",
                            ),
                          );
                        })
                      }
                    />
                  </section>
                </details>
              </>
            )}
            {view === "permissions" && (
              <section id="im-permissions" tabIndex={-1}>
                <ManagementSection
                  title={t(
                    "5 · 选择项目并启用连接",
                    "5 · Allow a project and enable IM",
                  )}
                  description={t(
                    "仅开放选中的项目。群聊还需勾选允许的协作空间；撤销授权会停止对应远程任务。",
                    "Only selected projects are accessible. Groups also require an allowed space. Revocation cancels the affected remote work.",
                  )}
                >
                  <ol>
                    <li>
                      {t(
                        "勾选你允许从 IM 使用的项目。先选择 Plan（只读分析）；需要修改文件时再改为 Execute。",
                        "Select the projects you want to use from IM. Start with Plan (read-only analysis); switch to Execute when you need file changes.",
                      )}
                    </li>
                    <li>
                      {t(
                        "单聊测试时，协作空间 ID 留空，命令与网络权限保持关闭。选中首个项目时会自动设为默认项目，保存项目授权后，在顶部启用连接。",
                        "For private-chat testing, leave space IDs empty and command/network permissions off. Your first selected project becomes the default. Save project permissions, then enable the connection at the top.",
                      )}
                    </li>
                    <li>
                      {t(
                        "保存授权后，使用顶部开关启用或暂停连接。保持 Artemis 运行，并在机器人中核对授权的项目。",
                        "After saving permissions, use the switch at the top to enable or pause. Keep Artemis running and check that the bot lists your authorized projects.",
                      )}
                    </li>
                  </ol>
                  {!projects.length && (
                    <p>
                      {t(
                        "先在 Artemis 打开一个项目。",
                        "Open a project in Artemis first.",
                      )}
                    </p>
                  )}
                  {projects.map((project) => {
                    const grant = settings.grants.find(
                      (g) => g.projectId === project.id,
                    );
                    return (
                      <div className="im-project" key={project.id}>
                        <Checkbox
                          label={project.name}
                          checked={!!grant}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            setSettings({
                              ...settings,
                              grants: checked
                                ? [
                                    ...settings.grants,
                                    executionGrantSchema.parse({
                                      projectId: project.id,
                                      expiresAt: Date.now() + 30 * 86400000,
                                    }),
                                  ]
                                : settings.grants.filter(
                                    (g) => g.projectId !== project.id,
                                  ),
                              defaultProjectId:
                                !checked &&
                                settings.defaultProjectId === project.id
                                  ? ""
                                  : checked && !settings.grants.length
                                    ? project.id
                                    : settings.defaultProjectId,
                            })
                          }
                        />
                        {grant && (
                          <details className="im-grant-details">
                            <summary>
                              {t("授权设置", "Permission settings")} ·{" "}
                              {grant.mode} ·{" "}
                              {grant.expiresAt > Date.now()
                                ? t("有效", "Active")
                                : t("已过期", "Expired")}
                            </summary>
                            <div className="im-grant-fields">
                              <Select
                                labelVisibility="visible"
                                label={t("任务模式", "Task mode")}
                                value={grant.mode}
                                onValueChange={(mode) =>
                                  updateGrant(project.id, { mode })
                                }
                                disabled={busy}
                                options={[
                                  {
                                    value: "plan",
                                    label: t(
                                      "Plan · 只读分析（首次推荐）",
                                      "Plan · Read-only analysis (start here)",
                                    ),
                                  },
                                  {
                                    value: "review",
                                    label: t(
                                      "Review · 只读审查",
                                      "Review · Read-only review",
                                    ),
                                  },
                                  {
                                    value: "execute",
                                    label: t(
                                      "Execute · 允许授权范围内修改",
                                      "Execute · Changes within your grant",
                                    ),
                                  },
                                ]}
                              />
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
                              <Checkbox
                                label={t(
                                  "允许沙箱命令",
                                  "Allow sandboxed commands",
                                )}
                                checked={grant.shell}
                                disabled={busy || grant.mode !== "execute"}
                                onCheckedChange={(shell) =>
                                  updateGrant(project.id, { shell })
                                }
                              />
                              <Checkbox
                                label={t(
                                  "允许命令访问网络",
                                  "Allow command network access",
                                )}
                                checked={grant.network}
                                disabled={
                                  busy ||
                                  !grant.shell ||
                                  grant.mode !== "execute"
                                }
                                onCheckedChange={(network) =>
                                  updateGrant(project.id, { network })
                                }
                              />
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
                                      "还没有可选的群空间。先到“群协作空间”保存配置，再回来选择。",
                                      "No group spaces yet. Save a space in Group spaces, then return here.",
                                    )}
                                  </p>
                                )}
                                {availableSpaces.map((space) => (
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
                                          ? [
                                              ...grant.groups,
                                              `space:${space.id}`,
                                            ]
                                          : grant.groups.filter(
                                              (id) =>
                                                id !== `space:${space.id}`,
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
                                {new Date(grant.expiresAt).toLocaleString(
                                  locale,
                                )}{" "}
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
                          </details>
                        )}
                      </div>
                    );
                  })}
                  <Select
                    labelVisibility="visible"
                    label={t("默认项目", "Default project")}
                    value={settings.defaultProjectId}
                    onValueChange={(defaultProjectId) =>
                      setSettings({ ...settings, defaultProjectId })
                    }
                    disabled={busy}
                    options={[
                      {
                        value: "",
                        label: t("每次明确选择", "Choose explicitly"),
                      },
                      ...projects
                        .filter((p) =>
                          settings.grants.some((g) => g.projectId === p.id),
                        )
                        .map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  <Button
                    disabled={busy || !settings.deviceId}
                    onClick={() => void run(() => save(settings))}
                  >
                    {t("保存项目授权", "Save project permissions")}
                  </Button>
                  <p>
                    {t(
                      "单聊发送 /help 查看项目选择、创建、继续、状态和停止等指令。IM 任务使用独立工具权限；MCP 与扩展暂不开放到远程入口。",
                      "Send /help in a private conversation for project selection, new tasks, continue, status and stop commands. Remote tasks have separate tool permissions; MCP and extensions are currently excluded.",
                    )}
                  </p>
                </ManagementSection>
              </section>
            )}
            {view === "spaces" && (
              <section id="im-spaces" tabIndex={-1}>
                <ManagementSection
                  className="im-space-setup"
                  title={t(
                    "创建与连接 IM 群协作空间",
                    "Create and connect an IM collaboration space",
                  )}
                  description={t(
                    "协作空间在 Artemis 中创建，把一个或多个 IM 群或频道连接起来。可以连接同一平台的多个群，也可以组合任意已接入且支持群会话的平台；目前支持企业微信、飞书、Lark 和 Slack。",
                    "Create a collaboration space in Artemis to connect one or more IM groups or channels. Combine groups from the same platform or any connected platforms that support group conversations. Currently supported: WeCom, Feishu, Lark and Slack.",
                  )}
                >
                  <p>
                    {t(
                      "群建在哪里：各群或频道仍建在各自的 IM 平台，Artemis 负责把它们关联到同一个空间，不会自动在外部平台建群。成员留在自己使用的 IM 中，无需注册其他平台的账号。尚未接入 Artemis 的 IM 需先获得对应平台适配支持。",
                      "Where groups live: create each group or channel in its own IM platform. Artemis links them into one space; it does not create external groups automatically. Members stay in their own IM without accounts on other platforms. An unsupported IM needs a platform adapter first.",
                    )}
                  </p>
                  <p>
                    {t(
                      "空间由同一个 Gateway 保存和转发。使用内置服务时保存在运行它的电脑上；团队服务则保存在团队服务器。跨电脑协作需连接同一个可访问的团队 Gateway，各自启动独立内置服务不会自动合群。",
                      "One Gateway stores the space and routes its messages. A built-in service stores it on its host computer; a team service stores it on the team's server. Computers must connect to the same reachable team Gateway. Separate built-in services do not merge automatically.",
                    )}
                  </p>
                  <ImGatewayDeployment
                    t={t}
                    busy={busy}
                    exportPackage={() =>
                      void run(async () => {
                        const path = await window.artemis.manageIm({
                          action: "export-gateway",
                        });
                        if (path)
                          setMessage(
                            t(
                              `独立运行包已导出到 ${path}，解压后按下方说明启动。`,
                              `Standalone package exported to ${path}. Extract it and follow the instructions below.`,
                            ),
                          );
                      })
                    }
                    connect={() => {
                      setShowRemote(true);
                      selectView("gateway");
                      setFocusTarget("im-device");
                    }}
                  />
                  <p>
                    {t(
                      "共享范围：只有发给机器人的任务消息、公开进度和成果会在这些群之间共享，普通聊天不会自动互通。加入空间不等于开放整台电脑，每位成员自行授权项目和操作权限。",
                      "Sharing scope: bot-directed task messages, public progress and results are shared across these groups. Ordinary chatter is not relayed. Joining a space does not open the whole computer; each member grants project and operation access.",
                    )}
                  </p>
                  <h4>
                    {t(
                      "1 · 让 Artemis 发现你的群",
                      "1 · Let Artemis find your group",
                    )}
                  </h4>
                  {status?.groupConversationError && (
                    <InlineNotice tone="warning">
                      {t(
                        "群协作对话同步失败：",
                        "Group conversation sync failed: ",
                      )}
                      {status.groupConversationError}
                    </InlineNotice>
                  )}
                  <ImSavedSpaces
                    spaces={[...adminSpaces, ...(status?.spaces ?? [])]}
                    settings={status?.settings ?? settings}
                    tasks={status?.remoteTasks}
                    busy={busy}
                    canRemove={local || !!adminToken}
                    t={t}
                    edit={(json, confirmation) => {
                      setSpaceJson(json);
                      setSpaceConfirmation(confirmation);
                    }}
                    remove={async (id) => {
                      return run(async () => {
                        const token = adminToken;
                        setAdminToken("");
                        await window.artemis.manageIm({
                          action: "admin",
                          operation: "remove-space",
                          ...(local ? {} : { adminToken: token }),
                          configuration: { id },
                        });
                        setSpaceJson("");
                        setSpaceConfirmation("");
                        setSpaceFormRevision((value) => value + 1);
                        await refresh();
                        const result = await window.artemis.manageIm({
                          action: "admin",
                          operation: "status",
                          ...(local ? {} : { adminToken: token }),
                        });
                        setDiagnostics(result);
                        setMessage(
                          t(
                            "协作空间已删除，原生 IM 群和对话历史已保留。",
                            "Collaboration space deleted. Native IM groups and conversation history remain.",
                          ),
                        );
                      });
                    }}
                  />
                  <ol className="im-space-steps">
                    <li>
                      {t(
                        "先把各平台的机器人连接到同一个 Gateway。在“配对与账号”绑定你自己；其他要参与的成员也连接这个 Gateway，分别绑定自己的账号和电脑。",
                        "Connect each platform's bot to the same Gateway. Pair your account in Pairing & accounts; other participants connect to this Gateway and pair their own accounts and computers too.",
                      )}
                    </li>
                    <li>
                      {t(
                        "在各 IM 平台创建或选择已有的群／频道，把该平台的机器人加入。在每个群里由已配对成员选中 @机器人，然后发送 /help（Slack 发 help）。普通群消息不会触发接入。",
                        "Create or choose a group/channel in each IM and add that platform's bot. In every group, a paired member mentions the bot and sends /help (help in Slack). Ordinary group messages do not trigger discovery.",
                      )}
                    </li>
                    <li>
                      {t(
                        "机器人回复“已发现这个群”表示发现成功，此时空间还没有配置。点击下面的“刷新群和成员”，第 2 步会列出刚发现的群和已配对成员；继续选择并保存，再按第 3 步确认和授权。",
                        "The bot's ‘group discovered’ reply confirms discovery; the space is not configured yet. Select Refresh groups and members below, choose the groups and paired members in step 2 and save, then complete confirmation and permissions in step 3.",
                      )}
                    </li>
                  </ol>
                  <Button variant="quiet" onClick={() => selectView("pairing")}>
                    {t("先去绑定账号", "Pair an account first")}
                  </Button>
                  {!local && (
                    <TextField
                      label={t(
                        "协作空间管理凭据",
                        "Collaboration administrator token",
                      )}
                      type="password"
                      value={adminToken}
                      onValueChange={setAdminToken}
                      autoComplete="off"
                      disabled={busy}
                    />
                  )}
                  <Button
                    disabled={busy || (!local && !adminToken)}
                    onClick={() =>
                      void run(async () => {
                        const token = adminToken;
                        setAdminToken("");
                        const result = await window.artemis.manageIm({
                          action: "admin",
                          operation: "status",
                          ...(local ? {} : { adminToken: token }),
                        });
                        setDiagnostics(result);
                      })
                    }
                  >
                    {t("刷新群和成员", "Refresh groups and members")}
                  </Button>
                  <h4>
                    {t(
                      "2 · 选择群和参与成员",
                      "2 · Choose groups and participants",
                    )}
                  </h4>
                  <ImSpaceBuilder
                    key={spaceFormRevision}
                    diagnostics={diagnostics}
                    value={spaceJson}
                    connections={connections}
                    busy={busy}
                    t={t}
                    onChange={(value) => {
                      setSpaceJson(value);
                      setSpaceConfirmation("");
                    }}
                  />
                  <details>
                    <summary>
                      {t(
                        "高级：查看诊断或手动编辑配置",
                        "Advanced: diagnostics and manual configuration",
                      )}
                    </summary>
                    {diagnostics !== undefined && (
                      <ImDiagnostics
                        value={diagnostics}
                        t={t}
                        editSpace={(json) => {
                          setSpaceJson(json);
                          setSpaceConfirmation("");
                        }}
                      />
                    )}
                    <TextAreaField
                      label={t(
                        "空间配置（JSON）",
                        "Space configuration (JSON)",
                      )}
                      description={t(
                        "字段：id、name、endpoints（connectionId / id / kind: group）、participants（deviceId / identity / name）、administrators（稳定 IM identity）。从上方状态复制成员身份。",
                        "Fields: id, name, endpoints (connectionId / id / kind: group), participants (deviceId / identity / name), administrators (stable IM identities). Copy member identities from the status above.",
                      )}
                      value={spaceJson}
                      onValueChange={(value) => {
                        setSpaceJson(value);
                        setSpaceConfirmation("");
                      }}
                      rows={8}
                      disabled={busy}
                      spellCheck={false}
                    />
                  </details>
                  <Button
                    disabled={busy || (!local && !adminToken) || !spaceReady}
                    onClick={() =>
                      void run(async () => {
                        const configuration: unknown = JSON.parse(spaceJson);
                        const token = adminToken;
                        setAdminToken("");
                        await window.artemis.manageIm({
                          action: "admin",
                          operation: "spaces",
                          ...(local ? {} : { adminToken: token }),
                          configuration,
                        });
                        setAdminToken("");
                        if (
                          configuration &&
                          typeof configuration === "object" &&
                          "id" in configuration &&
                          typeof configuration.id === "string"
                        )
                          setSpaceConfirmation(
                            `/space-confirm ${configuration.id}`,
                          );
                        setMessage(
                          t(
                            "空间配置已保存，请按上方步骤完成各群确认和个人项目授权。",
                            "Space saved. Complete group confirmations and each member's project permissions using the steps above.",
                          ),
                        );
                        try {
                          await refresh();
                        } catch {
                          setRefreshError(
                            t(
                              "群配置已保存，请刷新后到项目授权中选择这个空间。",
                              "Space saved. Refresh before selecting it in Project permissions.",
                            ),
                          );
                        }
                      })
                    }
                  >
                    {t(
                      "保存空间并等待各群确认",
                      "Save space and await group confirmations",
                    )}
                  </Button>
                  {spaceConfirmation && (
                    <InlineNotice tone="info">
                      <h4>
                        {t(
                          "3 · 在群里确认，再选择允许使用的项目",
                          "3 · Confirm in the group, then allow a project",
                        )}
                      </h4>
                      <p>
                        {t(
                          "让刚才选的确认人在每个已选群里 @机器人，发送下面的指令。收到“已确认协作空间”后，每位成员还要到“项目授权”允许该空间使用自己的项目。",
                          "Have the selected confirmer mention the bot with this command in each group. After the bot confirms the space, each participant allows the space in their own Project permissions.",
                        )}
                      </p>
                      <p>
                        {t(
                          "Slack 请删除指令开头的 /。修改群或成员后，需要重新确认。",
                          "Remove the leading / in Slack. Changing groups or members requires confirmation again.",
                        )}
                      </p>
                      <code className="im-identifier">{spaceConfirmation}</code>
                      <Button
                        onClick={() =>
                          void run(async () => {
                            await navigator.clipboard.writeText(
                              spaceConfirmation,
                            );
                            setMessage(
                              t(
                                "群确认指令已复制。",
                                "Group confirmation command copied.",
                              ),
                            );
                          })
                        }
                      >
                        {t("复制群确认指令", "Copy group confirmation command")}
                      </Button>
                      <Button onClick={() => selectView("permissions")}>
                        {t(
                          "去选择项目并授权",
                          "Choose a project and grant access",
                        )}
                      </Button>
                      <p>
                        {t(
                          "各群确认并保存项目授权后，保持 IM 连接启用，对话列表会自动出现“群协作 · 空间名称”，打开即可输入任务，无需先从 IM 发消息。多个项目都授权给该空间时，请选择默认项目。也可在群里 @机器人直接描述任务，进入同一个群协作对话；/new 会另建任务（Slack 使用 new）。",
                          "After group confirmation and saved project permissions, keep IM enabled. A Group collaboration conversation appears automatically; open it to enter a task without first sending an IM message. Choose a default project if several projects allow this space. Mention the bot with a task to use the same conversation, or use /new for a separate task (new in Slack).",
                        )}
                      </p>
                    </InlineNotice>
                  )}
                  <ImGroupTaskComposer
                    spaces={status?.spaces ?? []}
                    settings={settings}
                    projects={projects}
                    canRemove={local || !!adminToken}
                    remove={(spaceId, deviceId) =>
                      run(async () => {
                        const token = adminToken;
                        setAdminToken("");
                        await window.artemis.manageIm({
                          action: "admin",
                          operation: "remove-space-member",
                          ...(token ? { adminToken: token } : {}),
                          configuration: { spaceId, deviceId },
                        });
                        const current = (await window.artemis.manageIm({
                          action: "refresh",
                        })) as Status;
                        setStatus(current);
                        setDiagnostics(
                          await window.artemis.manageIm({
                            action: "admin",
                            operation: "status",
                            ...(token ? { adminToken: token } : {}),
                          }),
                        );
                        setMessage(
                          t(
                            "成员已从整个协作空间移除。",
                            "Member removed from the entire collaboration space.",
                          ),
                        );
                      })
                    }
                    busy={busy}
                    t={t}
                    open={(spaceId, participantIds, projectId) =>
                      void run(async () => {
                        const result = (await window.artemis.manageIm({
                          action: "open-group-conversation",
                          spaceId,
                          participantIds,
                          projectId,
                        })) as { threadId: string };
                        setStatus(await window.artemis.getImStatus());
                        await onOpenThread?.(result.threadId);
                      })
                    }
                    rename={(deviceId, name, deviceName) =>
                      run(async () => {
                        await window.artemis.manageIm({
                          action: "rename-group-member",
                          deviceId,
                          name,
                          deviceName,
                        });
                        setStatus(await window.artemis.getImStatus());
                        setMessage(
                          t(
                            "名称已保存，重启 Artemis 后仍会保留。",
                            "Names saved. They will remain after restarting Artemis.",
                          ),
                        );
                      })
                    }
                  />
                </ManagementSection>
              </section>
            )}
            <Button
              className="im-guide-link management-text-action"
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setReviewing(ready);
                setView("guide");
                setFields({});
                setAdminToken("");
                setFocusTarget("im-guide");
              }}
            >
              {ready
                ? t("重看设置指引", "Review setup guide")
                : t("返回设置指引", "Back to setup guide")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
