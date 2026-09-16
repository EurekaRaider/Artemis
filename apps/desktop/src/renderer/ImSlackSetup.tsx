import { type UiTranslate } from "../shared/ui-text.js";
import { Button } from "@artemis/ui/actions";

export const slackAppManifest = (userName: string) => JSON.stringify(
  {
    display_information: {
      name: `${userName}_bot`,
      description: "Connect your Artemis desktop tasks to Slack",
    },
    features: {
      bot_user: { display_name: `${userName}_bot`, always_online: false },
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
  t: UiTranslate;
  copy(): void;
  busy: boolean;
}) {
  return (
    <>
      <p>{t("ImSlackSetup.message1")}</p>
      <Button disabled={busy} onClick={copy}>
        {t("ImSlackSetup.message2")}
      </Button>
      <p>{t("ImSlackSetup.message3")}</p>
      <details>
        <summary>{t("ImSlackSetup.message4")}</summary>
        <ol>
          <li>
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("ImSlackSetup.message5")}
            </a>
            {t("ImSlackSetup.message6")}
          </li>
          <li>{t("ImSlackSetup.message7")}</li>
          <li>
            {t("ImSlackSetup.message8")}
            <ul>
              <li>
                <code>member_joined_channel</code>
                {t("ImSlackSetup.message9")}
              </li>
              <li>
                <code>member_left_channel</code>
                {t("ImSlackSetup.message10")}
              </li>
            </ul>
            {t("ImSlackSetup.message11")}
          </li>
          <li>{t("ImSlackSetup.message12")}</li>
          <li>{t("ImSlackSetup.message13")}</li>
        </ol>
        <p>{t("ImSlackSetup.message14")}</p>
      </details>
      <details>
        <summary>{t("ImSlackSetup.message15")}</summary>
        <ol>
          <li>
            {t("ImSlackSetup.message16")}{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("ImSlackSetup.message5")}
            </a>
          </li>
          <li>{t("ImSlackSetup.message18")}</li>
          <li>{t("ImSlackSetup.message19")}</li>
          <li>{t("ImSlackSetup.message20")}</li>
        </ol>
      </details>
    </>
  );
}
