export const slackBotNameKey = (name: string) =>
  name.trim().normalize("NFKC").toLowerCase();

export const slackAppManifest = (botName: string) =>
  JSON.stringify(
    {
      display_information: {
        name: botName,
        description: "Connect your Artemis desktop tasks to Slack",
      },
      features: {
        bot_user: { display_name: botName, always_online: false },
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
            "channel_deleted",
            "group_deleted",
            "channel_archive",
            "group_archive",
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
