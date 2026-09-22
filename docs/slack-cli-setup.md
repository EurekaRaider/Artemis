# Slack local automatic setup

Artemis bundles the official Slack CLI for initial local setup. The CLI obtains
authorization, creates and installs an app from Artemis's shared manifest, and
passes app and bot tokens to the main process through a one-time authenticated
loopback connection. The existing Gateway validates the identities, encrypts the
connection configuration, and owns Socket Mode traffic after the CLI exits.

## User flow and recovery

1. Register the local Gateway, open Slack settings, choose a bot name (up to 35
   characters), and start automatic setup. The exact trimmed name is used for
   both the Slack app and bot; the suggested name remains editable.
2. In the intended Slack workspace, open a direct message with any person or bot,
   paste and send the displayed `/slackauthticket` command, review Slack's
   permissions in its dialog, and enter the confirmation code in Artemis.
3. Artemis creates or resumes the app, connects it, and opens the existing pairing
   flow. Setup does not grant project or native group access.

The local creation page only offers automatic setup; manual app-creation and
credential-entry shortcuts are removed. Setup uses
`apps/desktop/src/shared/slack-manifest.ts` for scopes, subscribed events, bot
naming, and Socket Mode settings. Known Slack connections are checked
for duplicate names (ignoring case, surrounding whitespace, and Unicode width)
in both the form and the service, before authorization and again before app
creation. A conflict asks for another name. This checks Artemis's connected-bot
registry, not all applications in the Slack workspace. An existing setup's own
connection is excluded when resuming it.

The four management commands are `slack-setup-start`, `slack-setup-submit`,
`slack-setup-status`, and `slack-setup-cancel`. Public status contains only a state,
session ID, bot name, temporary authorization command, expiry, application/connection IDs,
and allowlisted error codes. Raw CLI output and credentials never reach the
renderer.

Each setup has a private home, CLI configuration directory, and fixed project
hooks. Management credentials are encrypted with the desktop secure-storage
adapter between commands. Temporary CLI credential files and logs are removed
after each command, including encryption failures; interrupted files are sealed
on recovery. Success or cancellation attempts management-token revocation and
removes local CLI credentials. Gateway credentials stay in its encrypted store.

Incorrect confirmation codes can be retried before expiry. Revoked management
credentials require fresh authorization. Administrator approval, cancellation,
and application restart retain the app ID and reuse it on retry. Cancellation
returns the editable initial form and clears the command, confirmation code, and
expiry. If the user changes the name when resuming, the same app's manifest is
updated. Legacy encrypted sessions are migrated without changing their prior
bot name. Creation intent
is persisted before the remote operation: an uncertain result without a recorded
app ID requires manual investigation instead of automatically creating another
app. A changed local device, workspace, user, app, or bot identity is rejected.

## Official binary and update contract

`slack-cli.lock.json` pins one official stable release and these three assets:

| Package     | Official asset       | Installed executable            |
| ----------- | -------------------- | ------------------------------- |
| macOS arm64 | `macOS_arm64.zip`    | `Resources/slack-cli/slack`     |
| macOS x64   | `macOS_amd64.zip`    | `Resources/slack-cli/slack`     |
| Windows x64 | `windows_64-bit.zip` | `resources/slack-cli/slack.exe` |

Every package contains only its target executable, the lock, and the upstream
license. The lock records official URLs, archive SHA-256 and sizes, executable
architecture, original executable SHA-256, and a content digest that survives
code signing. The digest excludes only signature fields, signature bytes, and
alignment padding; executable code and load commands remain checked.

All runtime invocations pass `--skip-update`. Artemis does not run `slack upgrade`
or replace CLI files in an installed application. Updates ship with Artemis.

`npm run verify:slack-cli` makes fresh official GitHub Release requests and
downloads all three assets for SHA-256 validation. Any newer stable patch, minor,
or major version blocks the old lock. Drafts, prereleases, and development tags
are excluded. Missing assets, conflicting latest-release metadata, checksum
mismatches, or network/rate-limit failure after bounded retries block the gate.
There is no offline success or cached-success fallback.

The gate runs in `verify:ci`, the existing pre-push verification, packaging entry
points, Electron Builder's `beforePack`, and immediately before Release publishes
assets. The last check catches a stable version published while packages build.
Normal CI and Release use Node 26.

To update deliberately:

```sh
npm run update:slack-cli
npm run verify:ci
node scripts/test-slack-cli-native.mjs
```

Review the lock and license diff, run native compatibility and package checks on
all three target hosts, and repeat the real-workspace acceptance below. The
updater downloads and validates new official assets and rechecks the release
before writing the lock. Verification itself never changes the lock.

## Verification boundaries

- Portable tests cover version changes, upstream/network failures, binary
  architecture and tampering, authorization errors/expiry, cancellation,
  concurrent calls, encrypted recovery, approval retry, identity rejection, and
  renderer behavior in all supported locales.
- `node scripts/test-slack-cli-native.mjs` stages the locked binary on its actual
  target host, runs its version and real manifest hook, obtains an official
  authorization ticket without logging in, and exercises the bundled Electron
  token hook with synthetic credentials.
- `node apps/desktop/scripts/verify-slack-cli-native.mjs <slack-cli directory>`
  checks the packaged binary and uses the executable and hook from that package.
  Release extracts the final macOS ZIP before this check. Windows native
  verification performs it on the extracted final ZIP alongside its ACL checks.
- Real-workspace acceptance additionally requires official authorization,
  automatic creation/install, actual token delivery by the CLI deploy hook,
  identity validation, messages after CLI exit, a full process restart using
  encrypted saved configuration, and another message round trip.

Synthetic recovery tests and native compatibility checks do not establish
real-workspace approval behavior. A cross-built binary does not establish native
execution. Engineering ad-hoc macOS packages do not establish Developer ID
signing, notarization, update, or rollback acceptance.
