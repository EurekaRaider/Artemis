import { useEffect, useRef, useState } from "react";
import {
  executionGrantSchema,
  type AppLocale,
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

type Status = ImStatus & { connections?: unknown[]; spaces?: unknown[] };
export function ImSettingsPanel({ locale }: { locale: AppLocale }) {
  const zh = locale.startsWith("zh"),
    t = (cn: string, en: string) => (zh ? cn : en);
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<ImSettings>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("Artemis");
  const [adminToken, setAdminToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageSection, setMessageSection] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [pairCode, setPairCode] = useState("");
  const [channel, setChannel] = useState<"wecom" | "feishu" | "slack">("wecom");
  const [showRemote, setShowRemote] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [spaceJson, setSpaceJson] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
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
          const connected = (current.connections ?? [])[0] as
            { channel?: "wecom" | "feishu" | "slack" } | undefined;
          if (connected?.channel) setChannel(connected.channel);
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
    const timer = window.setInterval(() => {
      if (!running.current)
        void window.artemis
          .getImStatus()
          .then(async (current) => {
            if (current.settings.deviceId)
              current = (await window.artemis.manageIm({
                action: "refresh",
              })) as Status;
            if (active && !running.current) setStatus(current);
          })
          .catch(() => {});
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (message)
      document
        .getElementById("im-feedback")
        ?.scrollIntoView({ block: "nearest" });
  }, [message]);
  const feedback = (section: string) =>
    message && messageSection === section ? (
      <div id="im-feedback" role="status">
        <InlineNotice tone="info">{message}</InlineNotice>
      </div>
    ) : null;
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    setMessageSection(document.activeElement?.closest("section")?.id ?? "");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    await window.artemis.manageIm({ action: "refresh" });
    const current = await window.artemis.getImStatus();
    setStatus(current);
  }
  async function save(next: ImSettings) {
    const current = await window.artemis.saveImSettings(next);
    setStatus(current);
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
          tenantId: t("企业 ID / Tenant Key", "Enterprise ID / Tenant Key"),
          botToken: "Bot User OAuth Token",
          appToken: "App-Level Token",
          botId: "Bot ID",
          secret: "Bot Secret",
          appId: "App ID",
          botOpenId: "Bot Open ID",
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
                  "由你起名，只用英文、数字、短横线或下划线，例如 wecom-team。保存后回调地址会用到它。",
                  "Choose a stable ID using letters, numbers, hyphens or underscores, such as wecom-team. It is used in the callback URL.",
                ),
          name: t(
            "显示名称，例如“研发团队机器人”。",
            "A display name, such as Engineering Bot.",
          ),
          tenantId:
            channel === "wecom"
              ? t(
                  "企业微信管理员提供的企业 ID（Corp ID）。",
                  "The enterprise Corp ID supplied by your WeCom administrator.",
                )
              : t(
                  "飞书当前企业的 Tenant Key，请向应用管理员获取。",
                  "Your Feishu enterprise's Tenant Key, supplied by its app administrator.",
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
          appId: t(
            "飞书应用凭证中的 App ID。",
            "App ID from the Feishu app credentials.",
          ),
          botOpenId: t(
            "机器人的 open_id，用于准确识别 @。请让应用管理员通过飞书“获取机器人信息”接口查询；不要填写 App ID 或个人 Open ID。",
            "The bot's open_id, used to recognize mentions. Ask the app administrator to obtain it with Feishu's Get Bot Info API; do not use an App ID or a person's Open ID.",
          ),
          appSecret: t(
            "与这个 App ID 对应的 App Secret。",
            "The App Secret for this App ID.",
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
      onValueChange={(value) => setFields({ ...fields, [field]: value })}
      disabled={busy}
      autoComplete="off"
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
  const local = !!status?.localGateway;
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
                "verificationToken",
                "encryptKey",
              ]),
        ];
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
  return (
    <div className="im-settings">
      <ImSetupGuide
        locale={locale}
        {...(status ? { status } : {})}
        onNavigate={(id) => {
          const section = document.getElementById(id);
          section?.scrollIntoView({ block: "start" });
          section?.focus({ preventScroll: true });
        }}
      />
      {feedback("")}
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
              document
                .getElementById("im-bot")
                ?.scrollIntoView({ block: "start" });
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
        {feedback("im-prepare")}
      </section>
      <section id="im-device" tabIndex={-1}>
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
            <p role="status">{stateLabels[status?.state ?? "disabled"]}</p>
            {status?.error && (
              <InlineNotice tone="danger">{status.error}</InlineNotice>
            )}
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
                    await window.artemis.manageIm({
                      action: "register",
                      gatewayUrl: url,
                      name,
                      adminToken,
                    });
                    setAdminToken("");
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
            {settings.deviceId && (
              <p className="im-identifier">
                {t("设备编号：", "Device ID: ")}
                {settings.deviceId}
              </p>
            )}
            <p>
              {t(
                "成功标志：上方出现设备编号。无需重复注册；注册新设备前请先暂停连接。",
                "Success check: a device ID appears above. Registration is one-time; pause the connection before registering a different device.",
              )}
            </p>
          </ManagementSection>
        </details>
        {feedback("im-device")}
      </section>
      <section id="im-bot" tabIndex={-1}>
        <ManagementSection
          title={t("3 · 连接聊天机器人", "3 · Connect a chat bot")}
          description={t(
            "先选一个平台完成单聊。团队已经配置机器人时，刷新后查看连接状态即可，无需重复填写密钥。",
            "Start with one platform. If your team already configured a bot, refresh and check its status; do not enter its secrets again.",
          )}
        >
          <Select
            label={t("IM 平台", "IM platform")}
            value={channel}
            onValueChange={(value) => {
              setChannel(value);
              setFields({});
            }}
            disabled={busy}
            options={[
              { value: "wecom", label: t("企业微信", "WeCom") },
              { value: "feishu", label: t("飞书", "Feishu") },
              { value: "slack", label: "Slack" },
            ]}
          />
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
          ) : channel === "wecom" ? (
            <ol>
              <li>
                {t(
                  "请企业微信管理员创建智能机器人，选择 API 模式并启用长连接，取得 Bot ID、Secret 和企业 ID。群机器人 Webhook 地址不能填在这里。",
                  "Ask your WeCom administrator to create an intelligent bot in API mode with a long connection, then obtain its Bot ID, Secret and enterprise ID. A group webhook URL cannot be used here.",
                )}
              </li>
              <li>
                {t(
                  "将下面的连接 ID 命名为 wecom-team，填写机器人信息，再输入管理凭据并保存。同一个 Bot ID 只连接这一份 Gateway。",
                  "Use a connection ID such as wecom-team, fill in the bot details and administrator token, then save. Connect this Bot ID to only one Gateway.",
                )}
              </li>
              <li>
                {t(
                  "状态显示“已连接”后，在企业微信中找到机器人，进入第 4 步配对。",
                  "Once the status says Connected, find the bot in WeCom and continue to pairing in step 4.",
                )}
              </li>
            </ol>
          ) : (
            <ol>
              <li>
                {t(
                  "请飞书管理员在开放平台创建企业自建应用，启用机器人能力，取得应用凭证、Tenant Key 和本机器人的 Bot Open ID。",
                  "Ask your Feishu administrator to create a custom enterprise app with bot capability and obtain its credentials, Tenant Key and this bot's Open ID.",
                )}
              </li>
              <li>
                {t(
                  "在应用的事件与回调配置中设置 Verification Token 和 Encrypt Key。填写下面的所有字段，先保存机器人配置。",
                  "Configure Verification Token and Encrypt Key in the app's event/callback settings. Fill in all fields below and save the bot configuration first.",
                )}
              </li>
              <li>
                {t(
                  "把下方事件回调地址复制到飞书开放平台，订阅 im.message.receive_v1。按实际用途开启单聊消息、群聊 @ 消息、发送及更新消息、图片/文件资源权限，发布版本并将自己加入可用范围。",
                  "Copy the callback URL below into Feishu and subscribe to im.message.receive_v1. Enable the required private-message, group-mention, send/update-message and image/file resource permissions, publish the version and include yourself in its availability.",
                )}
              </li>
              <li>
                {t(
                  "连接状态只确认应用凭证可用；是否收到消息，要在第 4、6 步通过真实单聊验证。",
                  "Connection status confirms the app credentials. Steps 4 and 6 verify real message delivery.",
                )}
              </li>
            </ol>
          )}
          {fieldNames
            .filter(
              (field) => channel !== "slack" || !["id", "name"].includes(field),
            )
            .map(renderBotField)}
          {channel === "slack" && (
            <details>
              <summary>
                {t(
                  "高级：连接名称与多个工作区",
                  "Advanced: connection name and multiple workspaces",
                )}
              </summary>
              {["id", "name"].map(renderBotField)}
            </details>
          )}
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
              (local && channel === "feishu") ||
              !fieldNames
                .filter(
                  (key) => channel !== "slack" || !["id", "name"].includes(key),
                )
                .every((key) => fields[key]?.trim())
            }
            onClick={() =>
              void run(async () => {
                await window.artemis.manageIm({
                  action: "admin",
                  operation: "connections",
                  ...(local ? {} : { adminToken }),
                  configuration: {
                    channel,
                    enabled: true,
                    ...Object.fromEntries(
                      fieldNames
                        .filter(
                          (key) =>
                            !(
                              channel === "slack" &&
                              ["id", "name"].includes(key) &&
                              !fields[key]?.trim()
                            ),
                        )
                        .map((key) => [key, fields[key]?.trim() ?? ""]),
                    ),
                  },
                });
                setFields({
                  id: fields.id || (channel === "slack" ? "slack" : ""),
                  name: fields.name ?? "",
                });
                const pair = (await window.artemis.manageIm({
                  action: "pair",
                })) as { code: string };
                setPairCode(pair.code);
                setAdminToken("");
                setMessage(
                  t(
                    "机器人配置已保存，配对指令已自动生成。状态显示已连接后继续第 4 步；飞书还需设置下方回调地址。",
                    "Bot configuration saved and pairing command generated. Once connected, continue to step 4. Feishu also needs the callback URL configured.",
                  ),
                );
                await refresh();
              })
            }
          >
            {t("保存并连接机器人", "Save and connect bot")}
          </Button>
          {channel === "feishu" && local && (
            <InlineNotice tone="info">
              {t(
                "飞书需要公网 HTTPS 回调；请在第 1 步导出并部署独立 Gateway，或连接团队服务后再配置。",
                "Feishu needs a public HTTPS callback. Export and deploy a standalone Gateway in step 1, or connect to your team service first.",
              )}
            </InlineNotice>
          )}
          {channel === "feishu" && !local && (
            <div className="im-actions">
              <p className="im-identifier">
                {t("事件回调地址：", "Event callback URL: ")}
                {url.replace(/\/$/u, "")}/channels/feishu/
                {fields.id || t("连接ID", "CONNECTION_ID")}
              </p>
              <Button
                disabled={!url || !fields.id}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(
                      `${url.replace(/\/$/u, "")}/channels/feishu/${fields.id}`,
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
          )}
          {(status?.connections ?? []).map((item, index) => {
            const c = item as { name?: string; state?: string; error?: string };
            return (
              <p key={index}>
                {c.name} ·{" "}
                {stateLabels[c.state as keyof typeof stateLabels] ?? c.state}{" "}
                {c.error}
              </p>
            );
          })}
          <Button
            disabled={busy || !settings.deviceId}
            onClick={() => void run(refresh)}
          >
            {t("刷新机器人连接状态", "Refresh bot connection status")}
          </Button>
        </ManagementSection>
        {feedback("im-bot")}
      </section>
      <section id="im-pair" tabIndex={-1}>
        <ManagementSection
          title={t("4 · 绑定你的 IM 账号", "4 · Pair your IM account")}
          description={t(
            "在企业微信、飞书或 Slack 里找到刚才的机器人，打开本人单聊。不要把配对码发到群里。",
            "Find the bot in WeCom, Feishu or Slack and open a private chat. Do not send pairing codes to a group.",
          )}
        >
          <ol>
            <li>
              {t(
                "复制已生成的配对指令；也可重新生成。Slack 使用 pair 配对码，不加开头的 /。",
                "Copy the generated pairing command, or generate a new one. Slack uses pair CODE without a leading /.",
              )}
            </li>
            <li>
              {t(
                "切到 IM，把指令粘贴到机器人单聊，在 5 分钟内发送。",
                "Switch to IM, paste it into the bot's private chat and send within 5 minutes.",
              )}
            </li>
            <li>
              {t(
                "等机器人回复“配对成功”，再回这里刷新状态；下方出现你的账号即完成。",
                "Wait for the bot to confirm pairing, then refresh here. Your account should appear below.",
              )}
            </li>
          </ol>
          <Button
            disabled={busy || !settings.deviceId}
            onClick={() =>
              void run(async () => {
                const result = (await window.artemis.manageIm({
                  action: "pair",
                })) as { code: string };
                setPairCode(result.code);
              })
            }
          >
            {t("生成一次性配对码", "Generate pairing code")}
          </Button>
          {pairCode && (
            <InlineNotice tone="info">
              {t(
                "请在本人的机器人单聊发送以下指令，5 分钟内有效：",
                "Send this command in your private bot conversation within 5 minutes:",
              )}
              <p className="im-identifier">
                {channel === "slack" ? "pair" : "/pair"} {pairCode}
              </p>
              <Button
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(
                      `${channel === "slack" ? "pair" : "/pair"} ${pairCode}`,
                    );
                    setMessage(
                      t(
                        "配对指令已复制，请在本人机器人单聊中发送。",
                        "Pairing command copied. Send it in your private bot chat.",
                      ),
                    );
                  })
                }
              >
                {t("复制配对指令", "Copy pairing command")}
              </Button>
            </InlineNotice>
          )}
          {status?.identities.map((identity) => (
            <div className="im-identity" key={JSON.stringify(identity)}>
              <span>
                {identity.channel} · {identity.userId}
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.artemis.manageIm({
                      action: "unpair",
                      identity,
                    });
                    await refresh();
                  })
                }
              >
                {t("解除绑定", "Unpair")}
              </Button>
            </div>
          ))}
          <Button disabled={busy} onClick={() => void run(refresh)}>
            {t("我已发送，刷新配对结果", "I sent it — refresh pairing")}
          </Button>
        </ManagementSection>
        {feedback("im-pair")}
      </section>
      <section id="im-permissions" tabIndex={-1}>
        <ManagementSection
          title={t(
            "5 · 选择项目并启用连接",
            "5 · Allow a project and enable IM",
          )}
          description={t(
            "仅开放选中的项目。群聊还需填写允许的协作空间；撤销授权会停止对应远程任务。",
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
                "单聊测试时，协作空间 ID 留空，命令与网络权限保持关闭。选中首个项目时会自动设为默认项目，点击“保存并启用连接”即可。",
                "For private-chat testing, leave space IDs empty and command/network permissions off. Your first selected project becomes the default. Select Save and enable connection.",
              )}
            </li>
            <li>
              {t(
                "保存后会自动启用连接，保持 Artemis 运行。成功标志是机器人能列出你授权的项目；下方开关可随时暂停连接。",
                "Saving enables the connection. Keep Artemis running and check that the bot lists your authorized projects. Use the switch below to pause at any time.",
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
                        !checked && settings.defaultProjectId === project.id
                          ? ""
                          : checked && !settings.grants.length
                            ? project.id
                            : settings.defaultProjectId,
                    })
                  }
                />
                {grant && (
                  <div className="im-grant-fields">
                    <Select
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
                      label={t("执行审批", "Execution approval")}
                      value={grant.approval}
                      onValueChange={(approval) =>
                        updateGrant(project.id, { approval })
                      }
                      disabled={busy}
                      options={[
                        { value: "ask", label: t("每次确认", "Ask each time") },
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
                      label={t("允许沙箱命令", "Allow sandboxed commands")}
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
                        busy || !grant.shell || grant.mode !== "execute"
                      }
                      onCheckedChange={(network) =>
                        updateGrant(project.id, { network })
                      }
                    />
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
                )}
              </div>
            );
          })}
          <Select
            label={t("默认项目", "Default project")}
            value={settings.defaultProjectId}
            onValueChange={(defaultProjectId) =>
              setSettings({ ...settings, defaultProjectId })
            }
            disabled={busy}
            options={[
              { value: "", label: t("每次明确选择", "Choose explicitly") },
              ...projects
                .filter((p) =>
                  settings.grants.some((g) => g.projectId === p.id),
                )
                .map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Button
            disabled={busy || !settings.deviceId}
            onClick={() =>
              void run(() =>
                save({ ...settings, enabled: settings.grants.length > 0 }),
              )
            }
          >
            {settings.grants.length
              ? t("保存并启用连接", "Save and enable connection")
              : t("保存远程授权", "Save remote permissions")}
          </Button>
          <p>
            {t(
              "单聊发送 /help 查看项目选择、创建、继续、状态和停止等指令。IM 任务使用独立工具权限；MCP 与扩展暂不开放到远程入口。",
              "Send /help in a private conversation for project selection, new tasks, continue, status and stop commands. Remote tasks have separate tool permissions; MCP and extensions are currently excluded.",
            )}
          </p>
          <Switch
            label={t("启用 IM 连接", "Enable IM connection")}
            checked={settings.enabled}
            disabled={busy || !settings.deviceId}
            onCheckedChange={(enabled) =>
              void run(() => save({ ...settings, enabled }))
            }
          />
        </ManagementSection>
        {feedback("im-permissions")}
      </section>
      <section id="im-test" tabIndex={-1}>
        <ImFirstTaskInstructions
          t={t}
          slack={channel === "slack"}
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
        {feedback("im-test")}
      </section>
      <details>
        <summary>
          {t(
            "进阶：群聊与跨 IM 协作（单聊成功后再设置）",
            "Advanced: groups and cross-IM collaboration (after private chat works)",
          )}
        </summary>
        <ManagementSection
          title={t("协作空间", "Collaboration spaces")}
          description={t(
            "先配对成员，再配置所连接的群和管理员。每个群的指定管理员须 @机器人 /space-confirm 空间ID 确认共享；修改配置会重新要求各群确认。",
            "Pair members first, then configure groups and administrators. Each designated administrator confirms sharing by mentioning the bot with /space-confirm SPACE_ID. Changes require new confirmations.",
          )}
        >
          <ol>
            <li>
              {t(
                "请成员先完成第 4 步配对，再把机器人加入目标群。让已配对的群管理员在群里 @机器人发送 /help。",
                "Pair members in step 4, then add the bot to each target group. A paired group administrator should mention the bot with /help in the group.",
              )}
            </li>
            <li>
              {t(
                "输入管理凭据并查看下方诊断：groups 给出实际群 ID，identities 和 devices 给出成员身份及设备 ID。按字段说明填写空间配置。",
                "Enter the administrator token and view diagnostics below: groups contains the actual chat IDs; identities and devices contain member and device IDs. Use them to fill in the space configuration.",
              )}
            </li>
            <li>
              {t(
                "保存后，请每个群的指定管理员 @机器人发送 /space-confirm 空间ID。每位成员还需在第 5 步的项目授权中填写该空间 ID 并保存；多 Agent 分派需要 Execute 模式，命令和网络仍按需单独授权。",
                "After saving, each designated group administrator mentions the bot with /space-confirm SPACE_ID. Every member adds that space ID to the project grant in step 5 and saves it. Multi-agent assignments require Execute mode; shell and network remain separate permissions.",
              )}
            </li>
            <li>
              {t(
                "全部确认后，在任意已连接群 @机器人发起任务。普通群聊不会同步；只有明确发给机器人的协作内容和成果对所连接的群可见。",
                "Once all groups confirm, mention the bot in a connected group to start a task. Ordinary chat is not synchronized; explicitly addressed collaboration content and results are visible to the connected groups.",
              )}
            </li>
          </ol>
          {!local && (
            <TextField
              label={t("协作空间管理凭据", "Collaboration administrator token")}
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
                const result = await window.artemis.manageIm({
                  action: "admin",
                  operation: "status",
                  ...(local ? {} : { adminToken }),
                });
                setDiagnostics(JSON.stringify(result, null, 2));
              })
            }
          >
            {t(
              "查看连接、成员和投递诊断",
              "View connections, members and delivery diagnostics",
            )}
          </Button>
          {diagnostics && (
            <TextAreaField
              label={t("管理状态", "Administration status")}
              value={diagnostics}
              onValueChange={() => {}}
              readOnly
              rows={10}
            />
          )}
          <TextAreaField
            label={t("空间配置（JSON）", "Space configuration (JSON)")}
            description={t(
              "字段：id、name、endpoints（connectionId / id / kind: group）、participants（deviceId / identity / name）、administrators（稳定 IM identity）。从上方状态复制成员身份。",
              "Fields: id, name, endpoints (connectionId / id / kind: group), participants (deviceId / identity / name), administrators (stable IM identities). Copy member identities from the status above.",
            )}
            value={spaceJson}
            onValueChange={setSpaceJson}
            rows={8}
            disabled={busy}
            spellCheck={false}
          />
          <Button
            disabled={busy || (!local && !adminToken) || !spaceJson}
            onClick={() =>
              void run(async () => {
                const result = await window.artemis.manageIm({
                  action: "admin",
                  operation: "spaces",
                  ...(local ? {} : { adminToken }),
                  configuration: JSON.parse(spaceJson),
                });
                setAdminToken("");
                setDiagnostics(JSON.stringify(result, null, 2));
                setMessage(
                  t(
                    "空间配置已保存，请按上方步骤完成各群确认和个人项目授权。",
                    "Space saved. Complete group confirmations and each member's project permissions using the steps above.",
                  ),
                );
              })
            }
          >
            {t(
              "保存空间并等待各群确认",
              "Save space and await group confirmations",
            )}
          </Button>
        </ManagementSection>
      </details>
    </div>
  );
}
