# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Artemis is a local-first Electron desktop agent built around the Pi SDK. It is an npm workspace monorepo with a React renderer, an Electron main process, and a Node utility-process agent host.

**Current branch context:** `feat/im-feishu` adds an `@artemis/im` package that bridges IM channels (currently Feishu) into Artemis tasks. This branch is actively wiring Feishu long-connection adapters, channel pairing, binding persistence, and outbound event translation into the main process.

## Common commands

Requires Node.js 24+ and npm 11+. Install dependencies from the repository root with `npm install` or `npm ci --include=dev`.

### Development and build

| Task | Command |
| --- | --- |
| Desktop dev (build core, then Vite + Electron) | `npm run dev` |
| Production build (core + desktop) | `npm run build` |
| Build shared core packages only | `npm run build:core` |
| Typecheck desktop (also builds core first) | `npm run typecheck` |
| Format everything with Prettier | `npm run format` |
| Check formatting | `npm run format:check` |

### Testing

The root `npm test` runs `build:core` first, then every workspace's test suite in order: protocol → platform → agent-host → desktop. The desktop suite runs with `--no-file-parallelism` because many tests share SQLite / filesystem state.

Run a single test file inside a workspace:

```bash
# IM package
npm run test -w @artemis/im -- test/manager.test.ts

# Desktop package
npm run test -w @artemis/desktop -- test/im-service.test.ts

# Or directly with npx (from repo root)
npx vitest run packages/im/test/manager.test.ts
npx vitest run --no-file-parallelism apps/desktop/test/im-service.test.ts
```

Run a single test by name:

```bash
npx vitest run --no-file-parallelism apps/desktop/test/codex-plugin-service.test.ts -t "exposes all four Lite plugins"
```

### Packaging

| Target | Command |
| --- | --- |
| macOS universal (arm64 + x64) | `npm run package:mac` |
| macOS arm64 only | `npm run package:mac:arm64` |
| macOS x64 only | `npm run package:mac:x64` |
| Windows x64 | `npm run package:win` |

Packaging scripts first build core and the desktop app, then run Electron Builder. They also exercise the bundled-plugin gate. Engineering builds are ad-hoc signed / unsigned and are not public release artifacts.

## Workspace layout

```text
apps/desktop/           Electron app: main process, preload, renderer, tests
packages/protocol/      Versioned contracts between renderer, main, and agent host
packages/platform/      Mode policy, workspace path validation, shell/runtime sandbox contracts
packages/agent-host/    Pi SDK adapter, runtime, prompt cache, concurrency, fork helpers
packages/im/            IM adapter abstraction + Feishu implementation (this branch)
```

`@artemis/desktop` depends on all four packages. `@artemis/agent-host` and `@artemis/platform` both depend on `@artemis/protocol`. `@artemis/im` depends on `@larksuiteoapi/node-sdk` and is consumed by the desktop main process.

Each package builds with `tsc -p tsconfig.json` and tests with `vitest run`. Shared compiler settings live in `tsconfig.base.json`.

## High-level architecture

### Process and trust boundaries

- **Renderer** — sandboxed React app with no Node integration. It communicates with main only through the typed `ArtemisApi` exposed by `src/preload/preload.ts`.
- **Main process** — Electron main. Owns lifecycle, SQLite persistence, policy enforcement, Git operations, terminals, MCP, settings encryption, and IM bridging.
- **Agent Host** — Node utility process (`src/agent/agent-worker.ts`) that runs the Pi SDK directly. It is isolated from the window and main process on crash.
- **Pi SDK** — the single agent loop inside the agent host. Handles model/provider behavior, tool use, history compaction, Skills, and JSONL sessions.

Raw Pi events stop at `PiAdapter` (`packages/protocol/src/pi-adapter.ts`). UI and main-process code consume only `@artemis/protocol` types. The renderer never imports Electron main-process or Node APIs.

### Protocol and persistence

`@artemis/protocol` owns renderer-visible contracts: `RunMode`, `AgentPayload`, `AgentEvent`, `ReviewQuery`, `OfficeDocumentRequest`, etc. Main assigns authoritative event IDs and persists versioned events to SQLite (`PRAGMA journal_mode=WAL`). Reducers are idempotent and merge deltas rather than replaying them.

Pi JSONL files remain the model-history source of truth. SQLite stores UI projections, projects, approval grants, worktree state, and IM bindings.

### Execution policy

Three formal modes: `plan`, `execute`, `review`. Plan and Review deny writes before an executor or filesystem call runs and do not expose Shell, MCP, or executable extensions. Execute uses brokered approvals for writes, shell, MCP calls, Office documents, and trusted extensions.

Key surfaces:

- `bash` — Pi's built-in tool, available only in Execute, runs with the desktop user's permissions after brokered approval.
- `write` / `read` — workspace-scoped filesystem tools validated by main.
- `office_document` — versioned PDF/OOXML operations in Execute only.
- MCP — enabled per-server; local stdio servers run in AppContainer (Windows) or Seatbelt (macOS) by default.
- Trusted extensions — require project and content-hash trust; run in a native sandbox unless the extension-only "Full local access" setting is enabled.

### IM integration (`packages/im`)

The IM package is platform-agnostic. It defines `IMAdapter`, `IMManager`, pairing, dedup, inbound routing, and outbound event translation. The Feishu adapter uses the official `@larksuiteoapi/node-sdk` WebSocket client with auto-reconnect.

The desktop main process bridges `@artemis/im` to Artemis internals in `src/main/im-service.ts` and persists bindings through `src/main/im-bindings-store.ts`. Lifecycle:

1. `IMService.startAdapter(config)` creates a `FeishuAdapter`, registers it with `IMManager`, and starts the WebSocket.
2. Inbound messages from an unbound channel enter the pairing flow (`/pair` command plus pairing code challenge).
3. After desktop approval, `IMService.approvePairing()` creates an Artemis thread and stores a `ChannelBinding`.
4. Bound inbound messages are submitted to the thread as turns (`submitTurn`) or follow-ups (`followUp`).
5. Outbound agent events are translated by `createTurnTranslator` and delivered back to the IM channel, including approval-request cards and approval-resolution updates.

When working in this branch, keep the seam thin: `@artemis/im` must stay platform-agnostic; Electron/store/turn logic stays in `im-service.ts` and `main.ts`.

## Important invariants

These are taken from `AGENTS.md` and the architecture docs. They are non-obvious constraints that future instances should not violate:

- Pi is the only agent loop. Do not introduce a second orchestration framework.
- Raw Pi events stop at `PiAdapter`; UI code consumes only `@artemis/protocol`.
- Renderer code never imports Electron main-process or Node APIs.
- Plan and Review writes are denied before an executor or filesystem call runs.
- Every persisted UI event uses a versioned envelope and an idempotent reducer.
- Project-backed interactive tasks always use the project's Local checkout.
- Temporary chats use only their generated workspace and cannot enter Review, worktree, or handoff flows.
- Enabled local stdio MCP servers use AppContainer/Seatbelt by default.
- The "Full local access" setting affects executable Pi extensions only; it must not change Pi `bash`, Terminal, or per-server MCP permissions.
- Credentials (API keys, OAuth records, MCP bearer tokens) use Electron `safeStorage`; if OS encryption is unavailable, writes fail closed.

## Release and CI

`.github/workflows/ci.yml` runs formatting, tests, typechecking, production build, and a high-severity dependency audit on pushes to `main` and pull requests.

`.github/workflows/release.yml` triggers on `v*.*.*` tags that match the root `package.json` version (currently `1.4.40`). It builds Windows x64, macOS arm64, and macOS x64 packages and verifies the exact artifact set before publishing a GitHub Release.

```bash
git tag v1.4.40
git push origin v1.4.40
```
