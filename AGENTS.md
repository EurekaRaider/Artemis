# Artemis engineering guidance

## Commands

- Install: `npm install`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Production build: `npm run build`
- Desktop development: `npm run dev`
- Windows package: `npm run package:win`
- macOS package: `npm run package:mac`

## Architecture invariants

- Pi is the only agent loop. Do not introduce a second orchestration framework.
- Renderer code never imports Electron main-process or Node APIs.
- Raw Pi events stop at `PiAdapter`; UI code consumes only
  `@artemis/protocol`.
- Every persisted UI event uses a versioned envelope and an idempotent reducer.
- Plan writes are denied before an executor or filesystem call runs.
  It does not receive Pi `bash`, MCP tools, or executable extensions.
- Pi's built-in `bash` is available only in Work and Codemode and intentionally
  runs with the current desktop user's full filesystem and network permissions.
  The user-opened integrated Terminal does the same and never auto-elevates.
- Enabled local stdio MCP servers use AppContainer on Windows or Seatbelt on
  macOS by default. File access is limited to the task workspace plus the
  server's private runtime directory, network access is per-server, and the
  child receives only a minimal or explicitly forwarded environment. A
  per-server compatibility option may explicitly opt a trusted server into the
  current desktop user's permissions. Tool calls retain model auto-approval.
  Work and Codemode may request host-approved, single-call sandbox escalation
  with a justification and fresh risk assessment. Elevated MCP connections are
  isolated and closed after the call; saved settings and the default environment
  stay unchanged. Plan, remote permission profiles, trust checks, and account
  authorization cannot be bypassed by escalation.
- The **Full local access** setting affects executable Pi extensions only. It
  must not change Pi `bash`, Terminal, or per-server MCP permissions.
- Executable Pi extensions remain disabled until explicit project and
  content-hash trust exists. They use the platform-native sandbox by default;
  the extension-only **Full local access** setting may opt them into the current
  desktop user's permissions.
  A host-approved single-call escalation may also use desktop-user permissions
  without changing that extension setting or its content-hash trust.
- The Browser may access HTTP and HTTPS with JavaScript, cookies, and web
  storage, but must not expose Node integration, preload APIs, or local-file
  access.
- Interactive tasks default to the project's Local checkout. Users may
  explicitly hand off to a managed worktree through the workspace menu.
  Managed worktrees are limited to 10 across all projects, including pending
  creations. Cleanup defaults select idle, clean worktrees whose task has not
  changed for 30 days and whose HEAD is confirmed on GitHub; deletion requires
  user confirmation. Preserve legacy permanent-worktree data and backend
  compatibility without reintroducing permanent-worktree creation controls.
- Tests for a policy regression precede any relaxation of these boundaries.

## Product and release contracts

- Configuration import from Codex, OpenCode, or Claude is category-selective
  and must not silently copy credentials.
- Experiential memory is project-first, bounded, validated, and lower priority
  than the current request and system policy. Do not store secrets or transient
  task state in memory.
- Do not claim Windows/macOS parity from protocol tests alone. macOS completion
  requires real arm64 packaging plus native PTY, Seatbelt, signing,
  notarization, stapling, update, and rollback evidence on macOS.
- Windows release verification must inspect the final packaged artifact,
  including its effective ACLs, from the path users will run.

## Repository layout

- Follow [the directory guide](docs/guides/repository-layout.md). Keep process boundaries and group feature code within them.
- Tests mirror their source owner; structural checks belong in `test/contracts/` and shared fixtures in `test/fixtures/`. Source scanners must recurse into feature directories.
- Never add test fixtures, synthetic or smoke-test data, verification-only IPC handlers, or test automation drivers to `main.ts`, `App.tsx`, or other production entrypoints and business modules. Keep them in dedicated test or verification files, organized by their owning module and feature.
- Put fixtures and test helpers in `test/fixtures/<feature>/`, test scenarios in the matching `test/main/`, `test/renderer/`, or `test/integration/` feature directory, and desktop verification drivers in the appropriate `scripts/verify/{ui,native,features}/` feature directory. Use dedicated test or verification entrypoints to assemble them; production modules must not import test fixtures or verification drivers. Preserve this separation when moving existing embedded test code out of production files.
- Keep public package exports, npm command names and compiled worker/preload paths stable when moving source files. Update CI path filters and script root resolution together.
- Keep task/session execution in `main/conversation/`, Goal handling in its
  conversation runtime, and approvals/tool dispatch in `main/broker/`.
  `main.ts` composes these owners through narrow dependencies; do not add new
  broker implementations or task execution branches to the entrypoint.
- Contracts-only modules and their consumers must use explicit `import type` /
  `export type`; check emitted import graphs when splitting modules so erased
  type references do not introduce runtime imports or cycles.
- Keep cross-process feature contracts in `shared/api/` and preload bridge
  implementations in `preload/bridges/`. Preserve `shared/api.ts` exports,
  `window.artemis`, channel names, argument order and listener disposal; bridge
  regression fixtures belong in `test/fixtures/preload/`.
- Preserve live service lookups across startup, restart and shutdown. Do not
  capture a replaceable service in a long-lived callback during module creation.
- Keep stylesheet entrypoints as ordered imports. Source-level checks must
  follow local CSS imports recursively; never reorder rules or raise a bundle
  budget simply to make a refactor pass.
- Run `npm run verify:layout` after directory changes. Store verification output under ignored `artifacts/verification/<topic>/<run>/`; do not put generated reports at the repository root.

- Protocol payload schemas and reducers belong in `packages/protocol/src/schema/`
  and `reducer/` by feature. Preserve the public barrels and the single event
  version, de-duplication, sequence and replay owner; do not introduce parallel
  reducer entrypoints.
- Renderer entry views compose feature controllers. Keep hooks unconditional,
  preserve effect registration/cleanup order, and distinguish per-render values
  from live callback/service references when extracting code.
- Verification matrices, native probes and test scenarios belong in their
  feature directories. Keep npm entrypoints, scenario counts and negative cases
  stable. Windows sandbox C# lives beside its PowerShell host in `resources/`;
  verify both files are shipped and rerun the native permission probes after edits.
