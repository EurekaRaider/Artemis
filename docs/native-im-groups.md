# Native IM groups: implementation and acceptance status

## Current implementation

The native group path uses one independently configured local gateway per Artemis instance. Group work uses the existing Pi task executor and project security grants. Shared-gateway collaboration commands are retired.

1. Pair the owner's IM identity with the local bot.
2. Mention the bot in an IM group. The authenticated event discovers the group; that first message does not start a task.
3. In Message access → IM groups, select the discovered group and local project. Use the file tree to select individual files or entire directories in the read/share and write columns, then confirm consent. Clearing all readable paths disables authorization; it never grants whole-project access.
4. Any human group member may send a new mention without pairing to the receiving computer. The receiver routes it to its own group project grant, records the actual sender, and denies owner control commands from other members. Paused, unconfigured, cross-tenant and pre-authorization messages cannot execute.
5. Human group messages reuse the current normal project session across senders; `/new` explicitly starts and selects a new session. Existing histories remain separate. The environment member context menu allows the bot owner to deny or restore a human member's assignment permission without pairing or changing the project grant. Group tasks use the normal project session UI. Settings show a searchable group selector and only the selected group's configuration; automatic bot cooperation is collapsed under advanced settings.

Discovered groups display their cached platform names before authorization, with platform labels and IDs only for unknown or duplicate names. Metadata lookup is bounded and uses supported adapter APIs.

The environment panel owns the member directory and assignment controls. Opening or focusing the panel requests a throttled refresh; Slack membership events invalidate the roster, with a 60-second fallback sync. Existing Slack apps can subscribe to member_joined_channel and member_left_channel for event-driven updates. The owner and local bot have no assignment toggle. Other bots start blocked unless already authorized; enabling one saves permission and schedules an automatic correlated IM proof. Directory membership alone never grants execution access. Re-saving the group preserves existing bot authorizations and sender denials.

Only this bot's participating tasks and messages are shown; this is not a full IM history mirror. Automatic bot collaboration requires a successful IM round-trip identity probe and explicit peer authorization for the group. Unknown capabilities remain manual. Human mentions use the Feishu/Lark, Slack and WeCom adapters.

A group entry is independent of its current default project. Child tasks use the authorized project and their own execution context. Changing authorization invalidates old execution/sharing contexts; existing history stays available. Pausing stops task routing and setup replies. Task notifications use versioned, idempotent group activity events. Assignment, completion, failure and required input produce notifications; ordinary progress does not.

The 30-minute assignment deadline applies before execution starts. A started native task remains bounded by its project grant, identity and group authorization, including grant expiry and revocation.

IM tasks have no cumulative token-use cap. Saved legacy `tokenBudget` values are accepted but ignored. Model context limits and Pi's automatic context compaction still apply; usage reporting remains available independently of authorization.

## Automatic cooperation

Artemis generates and parses versioned text envelopes through the same IM group. Platform sender identity, tenant, group, recipient, expiry and local authorization are checked before execution. Human copies of protocol text cannot dispatch tasks. Receiving bots persist dispatches before sending acceptance receipts, then use the existing Pi executor.

The initiating bot coordinates the workflow. There is no cumulative handoff limit or manual continuation gate. Dependencies reference existing tasks in that workflow and advance only after successful, nonempty results. Progress does not start new Pi tasks. Failed, missing, expired or oversized results require attention rather than silently advancing dependencies.

Single-bot `delegate` calls from the same coordinator session continue that peer's previous session after its result arrives, including across coordinator turns. Each turn has a separate task ID and correlated receipts. Use `newTask: true` for an independent session; batch `delegate-many` assignments remain independent. `message` only appends a note and never executes it. Continuations require both instances to support the continuation envelope, preserve peer/group identity checks, and reject inaccessible or changed authorization contexts instead of silently creating a new session.

Outgoing requests distinguish queued/platform-sent from peer-accepted. Cancellation uses an IM request and remains pending until the peer confirms its outcome. Authorization revocation blocks new work and results, and requests cancellation of affected work. Dispatch expiry does not terminate already running tasks.

Persistent inbox, outbox, command IDs and task records deduplicate retries and survive restarts. Uncertain sends/execution are not blindly replayed. Terminal states cannot be overwritten by late progress. Local timeline entries combine linked tasks, public messages, protocol receipts, remote task states and local activity chronologically; private instructions and outputs stay local.

The two-instance simulation uses separate stores and exchanges serialized IM messages only. It covers identity spoofing, human protocol copies, receipts, dependencies, cancellation races, revocation, restart uncertainty, command deduplication and more than 16 handoffs.

## Legacy retirement and storage

Native bindings are stored separately in `native-groups`; old binaries do not see them as `spaces`. The identity key uses the platform, tenant, real bot identity and group ID. A local connection ID is only the endpoint index.

When legacy spaces exist, startup first creates a private SQLite snapshot beside the gateway database, named `gateway.sqlite.pre-native-groups.sqlite`. The snapshot is completed through a temporary file before migration starts. It is never overwritten by repeated migration. Old spaces are retained in `retired-spaces`; associated pending queues are cancelled and old writable space/delegation paths cannot resume their former routing. Existing task and conversation history is retained.

## Verification

- `NODE_OPTIONS=--no-experimental-webstorage npm test`
- `npm run typecheck`
- `npm run build`
- `node apps/desktop/scripts/verify-native-im.mjs <output-directory>`

The Electron verifier uses a throwaway profile and synthetic authenticated discovery. It verifies the actual production group entry, refresh/reload uniqueness, public message queuing without task execution, retry deduplication, persisted long-message rendering, English/Chinese, light/dark themes and 720/1280-pixel windows. It does not use live IM credentials and is not real-platform acceptance.

Node 26's experimental global web storage conflicts with the existing jsdom test setup; the test command above disables that runtime feature.

## Remaining work and acceptance limits

The complete original execution plan is **not yet fully implemented or accepted**:

- Feishu, Lark, Slack and WeCom still need two independent bots/instances for live capability and end-to-end acceptance. No environment has been verified for bot message delivery, trustworthy bot identities, history pagination or native mentions between bots.
- Event-driven protocol cooperation is implemented with verified peer authorization. History-query-only automatic reception remains unavailable; WeCom and environments without trustworthy bot events retain manual assignment. Existing shared-gateway delegation is rejected, never used as a fallback.
- Group metadata lookup is integrated for Slack and Feishu/Lark. Slack supports archive/removal/access-denied evidence; Feishu/Lark supports dissolved-group evidence. WeCom still uses the authorized display name and stable group ID; reliable group metadata/removal evidence needs a supported API. Feishu bot-removal event handling is also pending.
- Public message receipts now distinguish local queueing, gateway submission, platform acceptance, failure, revocation and uncertainty. All chunks must be accepted before a message is shown as platform-accepted; this does not mean a human has read it. The group timeline also shows protocol receipts, remote tasks and local activity in chronological order.
- Group `/publish` now uploads through the bound IM adapter (Slack external upload completion, Feishu/Lark file messages, WeCom chunked media upload). It retains project read/share checks and desktop review for binary or sensitive content. Upload bodies are encrypted in the local queue, public posting rechecks authorization, and uncertain sends are not automatically retried. Group files never get shared-gateway download links. This path has simulated adapter/security coverage; real-platform acceptance and a dedicated desktop file picker remain pending.
- The Electron matrix verifies group entry and queued public messages. Live task cards, platform events and two-machine workflows still require end-to-end acceptance.
- No release, remote commit CI or publication has been performed by this change.

## Adapter references

- [Slack conversation metadata](https://docs.slack.dev/reference/methods/conversations.info/)
- [Slack upload ticket](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/) and [completion](https://docs.slack.dev/reference/methods/files.completeUploadExternal/)
- [Feishu group metadata](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat/get) and [file upload](https://open.feishu.cn/document/server-docs/im-v1/file/create), also checked against the installed official Node SDK declarations.
- [Official WeCom bot upload command definitions](https://github.com/WecomTeam/aibot-node-sdk/blob/main/src/types/api.ts) and [client upload flow](https://github.com/WecomTeam/aibot-node-sdk/blob/main/src/client.ts).

No real accounts/devices were available for this iteration; the user requested code and simulated acceptance first. Synthetic verification does not activate automatic cooperation on any platform.
