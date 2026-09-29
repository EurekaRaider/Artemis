# Artemis Hooks

Hooks are explicitly trusted local command scripts attached to the existing Pi lifecycle. They run as the current desktop user, with filesystem and network access, without automatic administrator elevation. The extension **Full local access** setting does not control hooks.

## Configure and authorize

1. Create `~/.artemis/hooks.json` for all local projects, or `<workspace>/.artemis/hooks.json` for one project. For managed worktrees, use that worktree's configuration.
2. Put managed scripts in the sibling `hooks/` directory. Copy the [examples](../../examples/hooks/hooks.json), placing the three `.mjs` scripts in `.artemis/hooks/`. The examples require Node.js; the completion example assumes an npm project with a `test` script.
3. Open **Settings → Hooks**. Project menus and installed plugin cards link to the same review surface. Execute tasks also show a pending-review notice above the composer.
4. Inspect the source, command, matcher, working directory, timeout, script contents and changes. Select individual hooks, choose their authorization scope, then click **Trust and enable**. Nothing is selected automatically.
5. Unchanged trusted hooks run automatically. New, changed or untrusted hooks are skipped, without repeatedly prompting. Approval never replays past events.

User hooks apply to all local projects. Project hooks apply only to their project; identical worktree contents can reuse project trust. Plugin hooks default to a selected project and may explicitly be authorized for all local projects. Installation/signature verification and hook trust are separate. Disabling a plugin stops its hooks; removal revokes their trust.

Trust and bounded execution history are stored in the application data directory, not in the repository. Definition changes, managed script changes and plugin content changes invalidate approval. Arbitrary external script dependencies and interpreters are not content-locked: review them yourself. Symlinks in managed script trees are rejected. Script inspection is bounded to 30 text files of at most 64 KiB each; file hashes show the full monitored set.

Plan and Review skip command hooks and continue the conversation normally. In Execute, local interactive tasks, IM direct and group chats, automations and their subagents use the same hook trust rules; IM tasks must still pass current conversation authorization checks. With no configured or trusted hooks, the prompt continues. A submission hook that blocks an initial prompt reports a failure reason. Switching between tasks does not end a session.

## Configuration and command protocol

```json
{
  "description": "Repository checks",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|write",
        "hooks": [
          {
            "type": "command",
            "command": "node .artemis/hooks/protect-files.mjs",
            "timeout": 5,
            "statusMessage": "Checking the target file"
          }
        ]
      }
    ]
  }
}
```

Matching sources accumulate. Handlers for an event run concurrently; denial wins. Conflicting input rewrites block the call. Matchers are bounded JavaScript regular expressions (quantified groups, lookarounds, backreferences and more than two repetition operators are rejected); omit the matcher, or use `*`, to match all. `UserPromptSubmit` and `Stop` ignore matchers. Use real Artemis tool names; `shell` also matches `Bash`, and `write` also matches `Write` and `Edit`. Tool input remains the Artemis tool's argument object, including any required approval metadata. This is a documented Codex-style subset, not binary compatibility with every Codex tool.

Only synchronous `command` handlers are supported. `commandWindows` overrides the command on Windows. `async`, `prompt` and `agent` handlers are rejected. Timeouts default to 30 seconds (maximum 600); `SessionEnd` defaults to one second (maximum three). Commands use the task workspace as `cwd`. macOS uses the user's shell with `-lc`; Windows uses `cmd.exe /d /s /c`. Use `commandWindows` or a cross-platform executable for portable scripts.

Each command receives one JSON object on stdin with `version: 1`, `hook_event_name`, `session_id`, optional `turn_id`, `cwd`, `permission_mode` and event-specific fields. `transcript_path` is currently null; do not depend on Pi's internal transcript format. Tool events include `tool_name`, `tool_use_id`, `tool_input` and, for results, `tool_response`. Subagent events include `agent_id` and `agent_type`.

Exit zero without output means success. Return JSON on stdout; diagnostics belong on stderr. `SessionStart`, `SubagentStart` and `UserPromptSubmit` also accept plain text as additional context. A hook process cannot invoke other hook events itself.

| Event                  | Supported output / behavior                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`         | `hookSpecificOutput.additionalContext`; fires on first Execute use, resume, and after compaction                                                           |
| `UserPromptSubmit`     | `decision: "block"` with `reason`, or additional context                                                                                                   |
| `PreToolUse`           | `hookSpecificOutput.permissionDecision: "deny"`, or `"allow"` with `updatedInput`; rewritten arguments are validated and execution policy is checked again |
| `PermissionRequest`    | `hookSpecificOutput.decision.behavior: "allow" / "deny"`; absent decision uses normal approval; hard restrictions remain in force                          |
| `PostToolUse`          | Additional context; `decision: "block"` or `continue: false` replaces the model-facing result with feedback, without undoing effects                       |
| `PreCompact`           | `continue: false` prevents manual or automatic compaction                                                                                                  |
| `PostCompact`          | `continue: false` stops further generation after compaction                                                                                                |
| `SubagentStart`        | Additional context for the child                                                                                                                           |
| `Stop`, `SubagentStop` | `decision: "block"` and `reason` requests one continuation; `continue: false` wins and ends; `stop_hook_active` prevents loops                             |
| `SessionEnd`           | Advisory cleanup on archive, delete and normal application shutdown; no output can keep a session open                                                     |

Exit code two supplies a denial via stderr for pre-hooks, feedback for `PostToolUse`, or continuation feedback for stop hooks. Pre-hook failures block the current operation. Approval-hook errors fall back to normal approval; post-hook failures are recorded and retain the original result. Cancellation and budget termination take priority over continuation. Shell polling does not rerun the original pre-hook; the post-hook runs when a later poll reports final completion.

Combined stdout/stderr is limited to 256 KiB; exceeding it fails and terminates the hook. Model-visible feedback is bounded to 10,000 characters. The local record stores at most 16,000 output characters, 4,000 error characters and 200 executions. Do not emit secrets. Cancellation, timeout and trust revocation terminate the process tree. Interrupted commands are recorded as interrupted after restart and are not automatically replayed; external side effects are not guaranteed exactly once.

## Plugins

A manifest may declare `"hooks": "./hooks/hooks.json"`, an array of relative paths, an inline hooks object, or an array of inline objects. Without a declaration, `hooks/hooks.json` is discovered. Paths must remain inside the plugin root. Scripts receive `PLUGIN_ROOT`, `PLUGIN_DATA` and their `CLAUDE_PLUGIN_*` aliases. The [example plugin](../../examples/hooks/plugin/.codex-plugin/plugin.json) supplies a session-start hook. Installing it does not authorize it.

## Verification

```sh
npm run build:core
npx vitest run apps/desktop/test/hooks-service.test.ts packages/agent-host/test/hooks-bridge.test.ts apps/desktop/test/hooks-settings.test.tsx
npm run typecheck
npm run build
node apps/desktop/scripts/verify-hooks-native.mjs
```

The service tests execute real platform-native processes, including timeout and cancellation. Run them on both macOS and Windows; a passing mock or protocol test does not prove native Windows behavior. Packaged-app verification must separately check Settings, the three shortcuts, content-change invalidation and native command execution from the installed application.

The CI workflow accepts `hooks_only=true` for native acceptance on the self-hosted macOS and Windows runners. It uses an isolated development license fixture for the trust UI, then rebuilds clean engineering artifacts. Windows packaged checks validate the actual ZIP, ACLs and activation boundary. Hooks UI after activation in a production package still requires a valid license for that machine; the fixture never runs in packaged applications.
