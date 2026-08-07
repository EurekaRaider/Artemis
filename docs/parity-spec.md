# Observable desktop parity specification

Baseline date: 2026-07-26.

Artemis targets independent visual, interaction, and workflow
compatibility with the public Codex desktop workspace. It does not target
OpenAI private prompts, backend services, wire protocols, accounts, trademarks,
or assets.

## Beta scope

The signed Beta must provide:

1. Local projects and searchable, restorable tasks.
2. Streaming Pi turns with text, optional thinking, tool cards, cancellation,
   steering, follow-up, and forking.
3. Execute, Plan, and Review modes with enforced tool policies.
4. Explicit approvals with once/session/project scopes and replay protection.
5. Integrated sandboxed terminal and environment actions.
6. Git review for last turn, staged, unstaged, and branch/base scopes, including
   hunk stage/unstage/revert.
7. Managed/permanent worktrees, handoff, snapshots, and cleanup.
8. Pi providers, OAuth/API-key status, models, thinking levels, Skills, prompt
   templates, packages, and trusted extensions.
9. MCP connection and authorization management.
10. Local in-app automations with one-time, daily, weekday, and weekly
    recurrence, durable run history, and latest-occurrence startup catch-up.
11. Dark/light themes, system English/Chinese UI, command palette, documented
    shortcuts, keyboard navigation, and accessibility labels.
12. Signed Windows x64 and signed/notarized macOS arm64/x64 packages with
    rollback-capable updates.

Browser, Computer Use, Remote/cloud execution, operating-system background or
cloud scheduling, and a Codex plugin marketplace are explicitly outside the
first Beta. Local automations run only while the desktop app is open.

## Current implementation

The current implementation contains a real Electron/Pi flow,
persisted/recoverable task events, nonce-protected approvals, four Review scopes
with file/hunk mutations, managed and permanent worktrees, conflict-checked
handoff, AppContainer/Seatbelt execution for brokered tools, an integrated
desktop-user PTY, model and encrypted credential settings, MCP, trusted Pi tool
extensions, local automations, signed-update feeds, and watchdog rollback.

Inline Review comments, snapshot restore UI, MCP OAuth, visible subagents,
bounded concurrency, controlled real-provider smoke tests, actual Windows
Authenticode signing, and real macOS arm64/x64 signing/notarization/native
validation remain open.
