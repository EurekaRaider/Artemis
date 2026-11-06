[English / 简体中文](repository-layout.md)

# Repository layout and file ownership

## Top level

- `apps/desktop/`: the Electron desktop app; `apps/ui-gallery/`: UI foundation demonstrations and verification.
- `packages/`: existing shared packages. Keep package names, public exports and protocol boundaries stable; do not create packages merely for individual pages.
- `scripts/`: cross-project build, CI, dependency maintenance, release, benchmark, UI and plugin tools. Tests and JSON contracts live with their tools.
- `docs/`: official guides, maintained records and visual assets; `examples/`: complete runnable examples.
- `vendor/`: dependency code distributed with the repository; `third-party/`: third-party licenses. `vendor/image-size-parser-blocker/` preserves dependency interfaces while refusing image-parser execution.
- `artifacts/`: Git-ignored build-input caches, acceptance evidence and historical archives, not source code.

## Desktop source and tests

`src/main/`, `renderer/`, `preload/`, `agent/`, `extension/` and `shared/` retain runtime-environment boundaries. Main-process and renderer code are grouped by features such as conversation, workspace, plugins, design, office, capabilities, mcp, connectors, im, automation and appearance. Feature styles and helpers stay with their feature.

Cross-process feature contracts live in `shared/api/`; `shared/api.ts` retains compatible exports and the composed interface, while `shared/ipc-channels.ts` owns the channel inventory. Implementations live in `preload/bridges/`; the preload entry composes them in the original order and exposes `window.artemis`. `test/preload/bridge-contracts.test.ts` uses feature-grouped baselines under `test/fixtures/preload/` to verify the complete method inventory, argument order, event isolation and listener disposal.

`main/main.ts` and `main/bootstrap.ts` remain composition entrypoints. `renderer/main.tsx` is the page entrypoint, and `renderer/app/` manages application composition and navigation. Cross-feature components belong in `renderer/components/`, and global styles in `renderer/styles/`. Do not introduce vague `misc/` directories or flatten business files back into entrypoint directories.

`shared/` contains only cross-process definitions without Node/Electron dependencies; copy and locale resources belong in `shared/i18n/`. Specialized preload files live in `preload/`, while workers stay with their feature. Source moves must not change compiled entrypoint filenames.

`test/main/`, `test/renderer/` and `test/shared/` mirror source ownership. Cross-process flows belong in `test/integration/`; source-structure and packaging contracts in `test/contracts/`; shared fixtures and test helpers in `test/fixtures/`. Source scanners must recurse so new directories cannot reduce coverage.

Main-process lifecycle owners live in `main/application/` (bootstrap, startup, main-window, lifecycle); IPC registration lives in `main/ipc/<feature>.ts`. The entrypoint composes dependencies and feature modules receive narrow typed interfaces. Replaceable services use live getters/setters so registered callbacks do not capture uninitialized or closed instances. Feature modules must not import `main.ts` at runtime.

Smoke data and fault injection live in `test/fixtures/smoke/`, grouped by conversation, workspace, resources, settings, and IPC feature. Window drivers and evidence collection live in `scripts/verify/ui/smoke/`. Development builds assemble verification capabilities through `test/fixtures/application/desktop-entry.ts`; release builds use `src/main/bootstrap.ts`, whose dependency graph must exclude test and verification directories. `test/main/application/`, `test/main/ipc/`, and `test/contracts/application-boundary.test.ts` verifies the channel inventory, entrypoint isolation, and lifecycle order. `tsconfig.verification.json` includes verification entrypoints in the regular typecheck.

Task and session execution belongs to `main/conversation/`, and approval/tool dispatch to `main/broker/`. Feature directories own model settings, MCP connections, hooks, automation and workspace operations. IM delegation, outbound delivery, management and command dispatch collaborate through neutral dependency contracts while the service retains runtime state. Database DDL, migrations and row conversion live in `settings/store-schema.ts`, `store-migrations.ts` and `store-row-codecs.ts`, with feature repositories in `settings/persistence/`. `AppStore` retains the public facade, one database connection and transaction boundaries. Cross-repository calls still use the current facade methods.

`renderer/app/App.tsx` composes navigation, workspace and page state. `AppNavigation.tsx` and `AppWorkspaceDock.tsx` own their rendering boundaries; `use-sidebar-navigation.ts` owns sidebar interaction. Timeline, team, child-agent and tool activity components belong to `renderer/conversation/`. Resource center plugin cards, capability cards and confirmation dialogs live in `renderer/plugins/*-renderers.tsx`, receiving only current render data and callbacks; the resource center retains caches, subscriptions and operation queues. `styles.css` and `nocturne.css` are ordered import entrypoints with feature-owned rules. Verification recursively reads the actual styles through `scripts/build/css-source.mjs`. Fonts ship as separate local assets; splitting styles does not raise the CSS budget.

Plugin installation coordination, transaction commits, manifest parsing, marketplace management and persistence have separate owners in `main/plugins/`; online resource catalogs live in `plugins/catalog/`. IM configuration, authorization, connections, group synchronization, event observation, scoped operations and local execution are separate from the service facade while retaining the same runtime state and authorization boundaries.

Frontend controllers live in `app/controllers/`, `plugins/controllers/`, `settings/controllers/` and `workspace/environment/`. Drafts, history, submission, Review, Goals, queues, resource installation and Git subscriptions have separate operation owners with explicitly typed shared view state. Extractions preserve hook order, effect cleanup and stale-request protection. Later-declared callbacks are read when needed; function declarations captured earlier retain compatible delegates. Resource caches live in `plugins/resource-cache.ts`, and stylesheet side effects remain at the original view entry. `renderer-controller-boundary.test.ts` guards extracted responsibilities and composition-root budgets.

## UI Gallery

`apps/ui-gallery/src/` retains only the startup entrypoint and environment declaration. `app/` composes pages, `pages/` contains demonstrations, `components/` contains shared components, `themes/` owns theme fixtures and declarations, `conformance/` owns contracts and matrices, and `styles/` owns Gallery styles. The two tests remain in `test/`; new pages follow their feature ownership.

## Shared packages and tools

`agent-host/src/` is grouped into runtime, sessions, context, models, tools and policy. `gateway/src/` uses channels, groups, authorization, i18n, http and runtime, retaining entrypoints and service composition at its root. The HTTP entry preserves the order of public capability links, browser-origin rejection, administrator authentication and device authentication; separate `http/` route modules handle administrator and device operations. Modules under `runtime/` own channel ingress, attachment caching, delivery and group synchronization, accessing shared state through neutral dependency interfaces. UI component contracts share `ui/src/internal/compare-contract.ts`, while public validators retain their existing diagnostic rules. Shared broker, routing, OAuth, update and attachment-work contracts live in neutral type modules; consumers use explicit `import type` / `export type`. Smaller packages retain their existing structure.

Connection configuration, contracts and error types are separate channel owners. Feishu and WeCom implementations live in `channels/feishu/` and `channels/wecom/`; `channels/channels.ts` preserves compatible exports.

Desktop-only scripts live in `apps/desktop/scripts/{build,packaging,release,verify,dev}/`; verify is divided into ui, native and features. Cross-project scripts stay in root scripts grouped by responsibility. `scripts/artifacts/` supplies evidence-path helpers.

Agent host `runtime.ts` retains the public facade and state composition. Model admission, session observation, parent/child sessions, team coordination and lifecycle have separate owners under `runtime/`. Session tools are grouped by feature in `runtime/tools/`; Plan counters and dynamic MCP tool sets remain isolated per session. Child sessions access shared tool factories through a live context, preserving cancellation propagation and concurrency lease release order. Gateway routing lives in `routing/`, and native group cooperation lives in `groups/cooperation/`; their facades retain compatible methods and persisted state.

## Outputs and migration checks

- New desktop verification output defaults to `artifacts/verification/<topic>/<run>/`; existing output arguments can override the location.
- Benchmark output belongs in `artifacts/benchmarks/`, and development demonstration material in `artifacts/dev/`.
- `artifacts/office/`, `artifacts/slack-cli/`, capability-pack outputs and skin tools are inputs to existing build chains and retain their established paths.
- Regular dist and release locations remain unchanged and are excluded by the editor. The desktop build directory also contains tracked icons and installer configuration; never delete it wholesale as generated output.
- Preserve historical evidence; one-off material does not belong in official docs. Retired application artifacts go in `artifacts/legacy/`.

When migrating, update imports, dynamic paths, source assertions, npm commands, CI path filters and resource entrypoints together. Keep npm command names and public package exports compatible; do not leave forwarding files at old internal paths.

Explanatory documents retain their original paths: Chinese originals have `-en.md` counterparts, and English originals have `-zh-CN.md` counterparts. Link both versions and keep their content synchronized. Runtime `SKILL.md` and original third-party license texts are excluded; release notes remain bilingual within one file. `npm run verify:docs` checks pairing, language links and local Markdown targets; translation completeness still requires editorial review.

Run `npm run verify:layout` for entrypoint and public-export checks, followed by affected tests, the complete suite, typechecking and building. Record the platform and evidence for packaging and native checks separately; unit tests do not replace runtime validation.
