[English / 简体中文](DEPLOY.md)

# Artemis Gateway

For personal use, choose **Start and register automatically** in Artemis Settings → IM connections. No source code, Node.js, npm, command line or separate deployment is needed.

This standalone package is for team service administrators. It supports Slack Socket Mode, WeCom long connections, and Feishu long connections or event callbacks. Install Node.js 24 or later; npm and the Artemis source are not required. Extract the package into a dedicated server directory and run there:

```sh
node gateway.mjs
```

The first launch creates `.env.gateway`, independently generating an administrator credential and a database encryption key. Enter its `ARTEMIS_GATEWAY_ADMIN_TOKEN` value in Artemis's **Use team Gateway** registration form. Later launches read this file and retain the credentials. Keep the service running; when using a service manager, set its working directory to the extracted directory.

By default it listens only on `127.0.0.1:8787`. Open `http://127.0.0.1:8787/health` in a browser; it should return `ok: true`. For other computers, published-file downloads or Feishu callbacks, configure an accessible HTTPS domain and reverse proxy with a request-body limit of at least 14 MiB. Never put the administrator credential in links or public chats.

SQLite data lives in `data/gateway.sqlite`; only one instance may use a database. Stop the service before backing up the entire `data` directory and `.env.gateway`. Losing the encryption key makes bot credentials unreadable. The package contains no user credentials; new credentials are generated on the server after export.

## Slack

Artemis Slack settings provide an importable application manifest that configures Socket Mode, direct-message and mention events, and required permissions. After installing into the workspace, copy the Bot User OAuth Token (`xoxb-`). In Basic Information → App-Level Tokens, create an App-Level Token (`xapp-`) with `connections:write`. Paste only these two tokens into Artemis; workspace, application and bot IDs are detected automatically. Connect each application to only this Gateway instance; create separate applications for multiple workspaces.

In bot private chats use ordinary messages such as `pair CODE`, `projects`, `new TASK` and `status`, without `/`, which Slack would interpret as a Slash Command. Invite the bot to a group before mentioning it with a command. Only the owner's bot private chats and explicitly mentioned group messages are received; pairing and project authorization remain enforced.

Slack Socket Mode, WeCom and Feishu long connections require only outbound networking. Feishu also supports HTTPS callbacks. Enable one transport per connection and stop the old subscription before switching. Feishu buttons need `card.action.trigger`; Typing needs message-reaction read/write permissions.

Feishu defaults to an outbound-only long connection and also supports HTTPS callbacks; each connection owns exactly one ingress transport. Existing callback configurations without a transport field remain callbacks. Subscribe to `im.message.receive_v1` and `card.action.trigger`, enable message resource and reaction permissions as needed, and stop the legacy desktop subscription before migration. Importing credentials does not import identities, grants or pending approvals.
