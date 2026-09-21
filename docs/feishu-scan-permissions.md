# Feishu / Lark scan permissions

Artemis encodes `addons` as gzip-compressed JSON and base64url in the scan URL.
`preset: false` selects the minimal bot base instead of the broad PersonalAgent
permission preset. The user confirms the requested permissions on the platform.

| Tenant scope                                   | Used by Artemis                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `im:chat:read`                                 | Group name/metadata and disband events                                   |
| `im:chat.members:read`                         | Member directory and user membership events                              |
| `im:chat.members:bot_access`                   | Bot added/removed events                                                 |
| `im:message.group_at_msg.include_bot:readonly` | Group mentions from both humans and cooperating bots                     |
| `im:message.p2p_msg:readonly`                  | Existing direct-chat pairing and messages                                |
| `im:message:send_as_bot`                       | Replies, coordination messages, approval cards, and message-card updates |
| `im:message:readonly`                          | Download resources attached to received messages                         |
| `im:resource`                                  | Upload result files                                                      |
| `im:message.reactions:read`                    | Find the bot's existing Typing reaction                                  |
| `im:message.reactions:write_only`              | Add/remove the Typing reaction                                           |
| `cardkit:card:write`                           | Create/update streaming cards                                            |

Subscriptions: `im.message.receive_v1`, `im.chat.member.user.added_v1`,
`im.chat.member.user.deleted_v1`, `im.chat.member.user.withdrawn_v1`,
`im.chat.member.bot.added_v1`, `im.chat.member.bot.deleted_v1`, and
`im.chat.disbanded_v1`. The `card.action.trigger` callback handles approvals.

Do not request all-group-message access, group creation/deletion, membership
management, announcements, pins, menus, tabs, mass messaging, urgent messages,
directory, cloud-document, or user OAuth scopes for these adapter features.
The human-only mention scope is covered by the include-bot mention scope.
`im:message:update` is unnecessary because `im:message:send_as_bot` also
authorizes the message-card update API. Bot profile lookup requires bot
capability but no additional scope.

This defines new scan requests; it does not revoke permissions previously
granted to existing apps. Audit/remove old scopes in the developer console.
Event transport settings cannot be carried in `addons`; real scan acceptance
must verify the long connection, member refresh, bot mentions, attachment
transfer, streaming cards, and approval callbacks. Local tests do not prove
platform grants or tenant approval.

Sources:

- [Official registration addons and minimal preset](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs)
- [Message receive scopes](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=zh-CN)
- [Message resource downloads](https://open.feishu.cn/document/server-docs/im-v1/message/get-2?lang=zh-CN)
- [Message-card updates](https://open.feishu.cn/document/server-docs/im-v1/message-card/patch?lang=zh-CN)
- [CardKit API scopes](https://open.feishu.cn/document/cardkit-v1/feishu-card-resource-overview?lang=zh-CN)
- [Bot profile](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info?lang=zh-CN)
