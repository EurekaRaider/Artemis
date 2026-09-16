import { Button } from "@artemis/ui/actions";

export const SLACK_APP_MANIFEST = JSON.stringify(
  {
    display_information: {
      name: "Artemis",
      description: "Connect your Artemis desktop tasks to Slack",
    },
    features: {
      bot_user: { display_name: "Artemis", always_online: false },
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "channels:read",
          "groups:read",
          "im:history",
          "app_mentions:read",
          "files:read",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          "message.im",
          "app_mention",
          "member_joined_channel",
          "member_left_channel",
        ],
      },
      socket_mode_enabled: true,
      org_deploy_enabled: false,
      token_rotation_enabled: false,
    },
  },
  null,
  2,
);

export function ImSlackSetup({
  t,
  copy,
  busy,
}: {
  t(cn: string, en: string): string;
  copy(): void;
  busy: boolean;
}) {
  return (
    <>
      <p>
        {t(
          "使用长连接，无需公网域名或回调地址。只需填入两个令牌，工作区和机器人编号会自动识别。",
          "Socket Mode needs no public domain or callback URL. Enter two tokens; workspace and bot IDs are discovered automatically.",
        )}
      </p>
      <Button disabled={busy} onClick={copy}>
        {t("复制 Slack 应用配置", "Copy Slack app manifest")}
      </Button>
      <p>
        {t(
          "群名显示需要 channels:read（公开频道）和 groups:read（私有频道），上方应用配置已包含。已有应用请在 OAuth & Permissions → Bot Token Scopes 检查并补齐；修改后必须 Reinstall to Workspace 重新授权，再回到 Artemis 刷新群列表。如 Slack 签发了新 Bot Token，请同时更新下方令牌。",
          "Channel names require channels:read (public) and groups:read (private), included in the manifest above. For an existing app, check OAuth & Permissions → Bot Token Scopes. After changes, use Reinstall to Workspace to authorize them, then refresh groups in Artemis. If Slack issues a new Bot Token, update it below too.",
        )}
      </p>
      <details>
        <summary>
          {t(
            "已有应用：开启群成员自动更新",
            "Existing app: enable membership updates",
          )}
        </summary>
        <ol>
          <li>
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("打开 Slack 应用管理", "Open Slack app management")}
            </a>
            {t(
              "，选择 Artemis 当前使用的机器人应用。",
              " and select the bot app currently connected to Artemis.",
            )}
          </li>
          <li>
            {t(
              "进入 Event Subscriptions，将 Enable Events 设为 On。保持 Socket Mode 开启，无需填写 Request URL。",
              "Open Event Subscriptions and turn Enable Events On. Keep Socket Mode enabled; no Request URL is needed.",
            )}
          </li>
          <li>
            {t(
              "展开 Subscribe to bot events，点击 Add Bot User Event，分别添加：",
              "Expand Subscribe to bot events, choose Add Bot User Event, and add:",
            )}
            <ul>
              <li>
                <code>member_joined_channel</code>
                {t("（成员加入）", " (member joins)")}
              </li>
              <li>
                <code>member_left_channel</code>
                {t("（成员退出）", " (member leaves)")}
              </li>
            </ul>
            {t(
              "保留已有事件，点击 Save Changes。",
              "Keep existing events and click Save Changes.",
            )}
          </li>
          <li>
            {t(
              "在 OAuth & Permissions → Bot Token Scopes 确认 channels:read（公开频道）、groups:read（私有频道）和 users:read（成员名称）已授权。若新增权限或 Slack 提示重新安装，点击 Reinstall to Workspace 完成授权；若签发了新 Bot Token，在 Artemis 中更新。",
              "In OAuth & Permissions → Bot Token Scopes, verify channels:read (public channels), groups:read (private channels), and users:read (member names). If scopes were added or Slack requests reinstallation, use Reinstall to Workspace to authorize them. Update the Bot Token in Artemis if Slack issues a new one.",
            )}
          </li>
          <li>
            {t(
              "确认机器人已加入目标群，并且 Artemis 中 Slack 连接正常。打开该群会话的环境面板，后续成员加入或退出会自动同步；未订阅事件时仍会定时同步，变化可能稍有延迟。",
              "Ensure the bot belongs to the channel and Slack is connected in Artemis. Open the conversation's environment panel; later joins and leaves sync automatically. Without these subscriptions, periodic sync remains available with some delay.",
            )}
          </li>
        </ol>
        <p>
          {t(
            "通过上方“复制 Slack 应用配置”新建的应用已包含这两个事件，无需重复添加。",
            "New apps created with the manifest above already include both events; no duplicate setup is needed.",
          )}
        </p>
      </details>
      <details>
        <summary>
          {t(
            "首次配置：创建 Slack 应用并取得令牌",
            "First-time setup: create the Slack app and get tokens",
          )}
        </summary>
        <ol>
          <li>
            {t(
              "打开 Slack 应用管理页，选择 Create New App → From a manifest，选择工作区并粘贴已复制的配置。权限、消息事件及 Socket Mode 会自动配置。",
              "Open Slack app management, choose Create New App → From a manifest, select your workspace and paste the copied configuration. It configures scopes, message events and Socket Mode.",
            )}{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("打开 Slack 应用管理", "Open Slack app management")}
            </a>
          </li>
          <li>
            {t(
              "在 OAuth & Permissions → Bot Token Scopes 确认包含 channels:read 和 groups:read，再点击 Install to Workspace，授权后复制 Bot User OAuth Token（xoxb- 开头）。",
              "In OAuth & Permissions → Bot Token Scopes, confirm channels:read and groups:read, then select Install to Workspace, authorize it and copy the Bot User OAuth Token (starts with xoxb-).",
            )}
          </li>
          <li>
            {t(
              "在 Basic Information → App-Level Tokens 创建一个令牌，勾选 connections:write，复制生成的 App-Level Token（xapp- 开头）。两个令牌必须来自同一个应用。",
              "In Basic Information → App-Level Tokens, create a token with connections:write and copy the App-Level Token (starts with xapp-). Both tokens must belong to the same app.",
            )}
          </li>
          <li>
            {t(
              "粘贴下方令牌并保存。连接成功后，在机器人的 Messages 页发送 pair 配对码。Slack 指令使用普通消息，不加开头的 /；群聊先邀请机器人，再 @ 机器人发起任务。",
              "Paste the tokens below and save. Once connected, send pair CODE in the bot's Messages tab. Use ordinary messages without a leading /. For channels, invite the bot and mention it to start a task.",
            )}
          </li>
        </ol>
      </details>
    </>
  );
}
