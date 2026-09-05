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
          "im:history",
          "app_mentions:read",
          "files:read",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: { bot_events: ["message.im", "app_mention"] },
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
              "在 OAuth & Permissions 点击 Install to Workspace，授权后复制 Bot User OAuth Token（xoxb- 开头）。",
              "In OAuth & Permissions, select Install to Workspace, authorize it and copy the Bot User OAuth Token (starts with xoxb-).",
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
