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
- Plan and Review writes are denied before an executor or filesystem call runs.
  They do not receive Pi `bash`, MCP tools, or executable extensions.
- Pi's built-in `bash` is available only in Execute and intentionally
  runs with the current desktop user's full filesystem and network permissions.
  The user-opened integrated Terminal does the same and never auto-elevates.
- Enabled local stdio MCP servers intentionally run with the current desktop
  user's full filesystem and network permissions, and their tools are
  auto-approved. Enabling an MCP server is the explicit trust boundary.
- The **Full local access** setting affects executable Pi extensions only. It
  must not change Pi `bash`, Terminal, or MCP permissions.
- Executable Pi extensions remain disabled until explicit project and
  content-hash trust exists. They use the platform-native sandbox by default;
  the extension-only **Full local access** setting may opt them into the current
  desktop user's permissions.
- The Browser may access HTTP and HTTPS with JavaScript, cookies, and web
  storage, but must not expose Node integration, preload APIs, or local-file
  access.
- Interactive tasks run only in the project's Local checkout. Do not
  reintroduce managed or permanent Worktree user flows without an explicit
  product request; preserve legacy persisted data and backend compatibility.
- Tests for a policy regression precede any relaxation of these boundaries.

## Product and release contracts

- Configuration import from Codex, OpenCode, or Claude is category-selective
  and must not silently copy credentials.
- Experiential memory is project-first, bounded, validated, and lower priority
  than the current request and system policy. Do not store secrets or transient
  task state in memory.
- Do not claim Windows/macOS parity from protocol tests alone. macOS completion
  requires real arm64 and x64 packaging plus native PTY, Seatbelt, signing,
  notarization, stapling, update, and rollback evidence on macOS.
- Windows release verification must inspect the final packaged artifact,
  including its effective ACLs, from the path users will run.
