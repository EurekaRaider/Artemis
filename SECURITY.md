# Security

Artemis is pre-release software. Do not use it for untrusted or unattended
work until the native executor rows in
[`docs/p0-acceptance-matrix.md`](docs/p0-acceptance-matrix.md) pass.

The current slice provides:

- Chromium renderer sandboxing and context isolation;
- typed, minimal renderer IPC;
- project/thread lookup by stored identifiers;
- workspace lexical and real-path validation;
- Plan/Review write denial before execution;
- approval-gated brokered file writes with host nonces, single-consumption
  decisions, and exact-operation/exact-target task or project grants;
- restart recovery that denies unresolved approvals and fails interrupted
  turns;
- server-recomputed Review file/hunk IDs rather than renderer-supplied patches;
- recoverable Git revert and managed-worktree cleanup;
- handoff HEAD matching, `git apply --check`, untracked collision checks, and
  recovery bundles;
- executable Pi extensions disabled by default;
- shell, PTY, and arbitrary network execution disabled.

It does not yet provide Windows AppContainer/restricted-token execution or macOS
Seatbelt execution. The UI states this explicitly and keeps terminal execution
locked.

Report security issues privately to the repository owner. Do not include secrets,
provider tokens, prompts, source code, or full session logs in a report.
