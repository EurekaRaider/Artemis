# Implementation status

## Delivered

- Greenfield npm workspace and local Git repository.
- Frozen Pi, Electron, React, TypeScript, Vite, and test versions.
- Pure TypeScript event protocol, schemas, reducer, and Pi adapter.
- Mode policy and workspace path/junction protection.
- Pi SDK Agent Host with custom read and brokered write tools.
- Electron utility process, typed preload bridge, sandboxed renderer, IPC
  validation through stored IDs, SQLite projections, and Git operations.
- Working bilingual desktop UI with project/task shell, timeline, modes,
  approval cards, review panel, command menu, shortcuts, and fail-closed
  terminal.
- Task rename/archive/restore, true Pi session fork, steer/follow-up,
  active-turn cancellation, and restart recovery.
- Local one-time, daily, weekday, and weekly automations with timezone-aware
  scheduling, SQLite run history, latest-occurrence startup catch-up, overlap
  prevention, and task navigation from run history. Plan/Review remain
  write-denied; Execute requires a native full-permission warning and a
  configuration-bound authorization that is revoked by edits.
- Restarted Agent Hosts reopen the persisted Pi JSONL session with prior user
  and assistant context intact; the resumed session can be forked without
  losing that history.
- Host-nonce approval replay protection, exact-target task/project approval
  grants, cancellation revocation, and unresolved-approval recovery.
- Last-turn, unstaged, staged, and branch/base Review scopes. File and hunk
  stage/unstage/revert validate server-recomputed IDs; revert writes a recovery
  copy first.
- Inline Review comments use stable diff-line anchors, persist in SQLite, reject
  stale or forged line IDs, and can be created or removed directly beside the
  affected line.
- Managed detached worktree creation, branchization, independent managed
  worktrees for task forks, worktree persistence, dirty cleanup snapshots, and
  Local/Worktree handoff with HEAD/patch/collision preflight.
- Removed-worktree snapshots can be restored from the task menu into Local.
  Restore validates repository identity and HEAD, preflights tracked patches,
  untracked collisions and symlink targets, and rolls back partial application.
- Permanent-worktree discovery and validation, attachment to a new task,
  persistence, and Local/managed/permanent workspace switching.
- xterm renderer terminal backed by `node-pty`. Windows routes through the
  AppContainer helper; macOS routes through Seatbelt. Network is denied by
  default, and Plan/Review receive no workspace-write grant.
- Execute mode with a brokered, versioned Office document contract. PDF, XLSX,
  DOCX and PPTX have real normalized parsers and generators for create, write,
  read, modify and delete; path and policy tests cover Windows and macOS forms.
- Platform-specific `node-pty` Node-API prebuilds are unpacked from asar;
  Windows packaging verifies the win32-x64 prebuild under Electron 43 before
  the native PTY boundary test.
- Windows `CreateProcessInSandbox` probing with a fail-limited classic
  AppContainer fallback, low integrity, capability-scoped network, inherited
  stdio, kill-on-close Job Object, and temporary ACL/profile cleanup.
- Pi model catalog and thinking-level settings; API keys and imported Pi OAuth
  records encrypted with Electron `safeStorage`.
- MCP stdio and Streamable HTTP configuration, encrypted bearer tokens, OAuth
  2.1 authorization-code/PKCE with exact loopback state validation, encrypted
  dynamic client/token persistence, tool inventory, approval brokerage, and
  native-sandboxed stdio processes.
- Hash-pinned trusted Pi tool extensions with explicit trust/change detection,
  network setting, tool inventory, approval scopes, and one-shot native
  sandbox execution.
- Visible tree-structured child Agent status/output in the workspace. Each task
  supports 64 logical members, five levels and eight direct children per Agent.
  Pi-backed in-memory child sessions share a fair global scheduler: automatic
  active capacity is 2–16; manual capacity is 2–64 with safe-value startup,
  gradual recovery and pressure-based admission reduction. Collaboration waits
  release their slot, including through a five-level chain at limit two.
- Local crash diagnostics cover main-process failures, Renderer crashes and
  hangs, and Agent Host stderr/exit. The user can export a gzip JSON bundle;
  paths, authorization material and credentials are redacted, and no automatic
  upload is performed.
- Windows screenshot/a11y matrix for English and Chinese at 100%, 125%, and
  150% zoom. All six artifacts are visually distinct and report zero automated
  accessible-name, form-label, keyboard-focus, image-alt, duplicate-ID, or
  document-language issues.
- macOS HTTPS/GitHub update feed integration, staged rollout metadata,
  signed-release environment gates, recovery artifact retention, startup
  health markers, and watchdog rollback. Windows ZIP packages explicitly use
  manual download-and-extract updates.
- Hidden Electron launch/screenshot smoke test on Windows.
- Windows x64 is packaged only as
  `apps/desktop/release/Artemis-Windows-x64-${version}.zip`, with no
  installer or self-extracting wrapper. Native verification extracts the final
  ZIP to a fresh path and covers PE architecture, contained-executable
  Authenticode state, desktop-user PTY access, AppContainer MCP/extensions,
  effective extracted-path ACLs, bundled Lite plugins, and both unpacked and
  freshly extracted launches.

## Release blockers

1. Real macOS arm64 Seatbelt and desktop-user PTY validation, Developer ID
   signing, notarization, stapling, and rollback execution. The Lite release
   profile does not generate macOS x64 artifacts or claim cross-architecture
   completion.
2. Authenticode signing and final extracted-ZIP validation on Windows x64.
3. Broader destructive Git policy coverage.
4. Controlled real-provider turn/resume/fork smoke tests with configured test
   credentials.
5. Dependency audit: Pi `0.83.0` ships shrinkwrapped
   `brace-expansion@5.0.8` and `undici@8.5.0`; the current MCP SDK chain also
   reports Hono and `fast-uri` advisories. Do not use
   `npm audit fix --force`, which proposes an unrelated Pi downgrade.

## Verification

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run format:check
npm run verify:screenshot-matrix
```

The Windows renderer smoke artifact is generated with
`ARTEMIS_SMOKE_SCREENSHOT=<absolute-path>` when launching Electron. This
environment variable is test-only; normal launches show the application window.
Pass `--user-data-dir=<isolated-directory>` to exercise deterministic SQLite
fixtures without touching the normal app profile.

The current automated suite contains 595 passing tests (4 skipped): protocol 49,
platform 19, Agent Host 58, and desktop 469. Windows-native tests exercise MCP
stdio, trusted Pi tools, and an interactive PTY inside AppContainer while
proving workspace write, outside-write denial, and network denial.

The bilingual accessibility and scale evidence is stored in
`artifacts/screenshot-matrix/manifest.json`: English and Chinese at 100%, 125%,
and 150%, with one PNG and one JSON audit per variant. In the current Codex
host, a sandboxed Chromium Renderer exits before painting, so the script first
tries the production sandbox and then uses a screenshot-only `--no-sandbox`
fallback outside CI. The manifest records this as `rendererSandbox: false`;
the application still sets `webPreferences.sandbox: true`, and this UI matrix
does not replace the separate sandbox security gate.

Archive, executable and smoke-screenshot SHA-256 values are emitted by the
Windows-native ZIP gate and replaced after every engineering package build. A
macOS cross-build is generation evidence only and cannot supply those native
results. Engineering artifacts intentionally report `NotSigned`; Authenticode
signing remains a public-Beta release gate.
