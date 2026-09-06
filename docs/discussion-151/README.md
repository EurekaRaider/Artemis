# Discussion #151 implementation

The implementation follows [Discussion #151](https://github.com/EurekaRaider/Artemis/discussions/151): one Gateway control plane, Feishu WebSocket or HTTPS transport per connection, and direction A in the existing React/theme packages. Pi remains the sole agent loop. Implementation and native acceptance are separate milestones.

## Frozen UI specification (UI-0)

- Product baseline: `bdded70d937b54aad615f0f87de57d5fb31271b8` (1.4.62).
- Snapshot: v69, 82 files, including the proposal author's uncommitted prototype changes.
- [Original ZIP](https://github.com/EurekaRaider/Artemis/raw/78d4857/docs/proposals/2026-09-05-im-ui/artemis-ui-prototype-2026-09-05.zip), fixed proposal commit `78d4857`.
- ZIP SHA-256: `e11a02906e9d17778ea44ff418b9025fbad1d843661299f8332a804334b82227`.
- All 82 files in `../ui-prototype` match [the attachment manifest](prototype-manifest.json) byte for byte. Historical reports inside that snapshot are retained as supplied.
- [73-card inventory](cards.json) supersedes the old 70-card count for this implementation. Each entry separates prototype, React and Electron status; the snapshot's historical migration map is not rewritten to claim production acceptance.
- Entry points: [workspace](../ui-prototype/artemis-ui.html) and [catalog](../ui-prototype/components.html).

Fresh baseline checks on 2026-09-05: existing `verify-desktop-skin` passed on the clean baseline SHA using isolated user data, including its real Electron matrix and macOS arm64 engineering-package resource checks. [Screenshot hashes](baseline.json) identify that run. This is not signing, notarization, update/rollback, macOS x64 or Windows acceptance. The selected Gateway/protocol/remote tools/desktop IM/settings suite passed 76 tests; the first sandboxed attempt could not bind loopback, and the rerun with local ports enabled passed.

The copied prototype passed 12 library checks (73 cards) and 34 workspace checks using installed Playwright and Chrome. Fresh reports and screenshots are retained in ignored `artifacts/discussion-151/`; checked-in reports inside the frozen prototype remain historical evidence.

## Delivery sequence

| Batch | Scope                                                                               | Implementation status                                                                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-0  | Frozen attachment, 73-card inventory, source/native baseline, data gaps             | Complete; all 82 source files match the supplied manifest                                                                                                                                                                    |
| IM-0  | Identity, grants, one-shot approval, persistence and policy regressions             | Retained the main contracts; added operator/tenant/connection, persistence retry and desktop/card race regressions                                                                                                           |
| IM-1  | Gateway Feishu WebSocket transport, exclusive subscription, lifecycle, package      | Implemented SDK 1.73.3 transport and region selection; standalone bundle and dependency licenses verified; live tenant acceptance remains open                                                                               |
| IM-2  | Incoming image/post content, typing lifecycle, authenticated approval cards         | Implemented resource-preserving post parsing, persisted Typing cleanup, single-use cards, desktop result updates and confirmed-rejection text fallback                                                                       |
| IM-3  | Explicit legacy configuration import, re-pairing, diagnostics and callback rollback | Implemented native file selection, expiring main-process preview, explicit credential import, new connection identity, fresh pairing/grants and queue diagnostics                                                            |
| UI-1  | Tokens, task tree, Composer and Approval reference slice                            | Added the inset Composer context, 1px input focus, flat Composer and persistent sidebar search; aligned 46px/252px defaults and 44px/220px compact defaults while retaining saved widths                                     |
| UI-2  | Conversation, workspace/Dock and specialized panels                                 | Mapped all nine existing views; aligned reading surface and structural dividers while retaining existing flow, state and focus owners                                                                                        |
| UI-3  | Settings/IM navigation, counts/health, guide and transport fields                   | Aligned settings dimensions and channel rows; separate count/health with partial failure priority, shared guide, actual storage/callback information and migration controls                                                  |
| UI-4  | Resources, archive, usage, automation and convergence                               | Mapped existing page owners and acceptance workloads; aligned archive surface; exact component contracts updated; full tests, 26 prototype comparisons and all 11 native workloads passed on the recorded implementation SHA |

The additional terminal fix supplies complete light/dark ANSI palettes, a 4.5 minimum contrast setting, and transparent xterm overlay layers. A real native PTY check preserved one terminal and its transcript through light/dark/light changes, including ANSI, true-color and equal foreground/background samples. The same checks are included in `verify-desktop-skin`.

Each implementation batch must preserve drafts, tasks, grants, user theme/width preferences and existing persisted data. Native acceptance requires actual evidence on the candidate revision; passing a historical baseline or the static prototype does not close that gate.

## Pages and required states

| Area                          | Existing production owners                                                                        | Required comparisons and regression states                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell/task tree               | App, project-sidebar-layout, UI surfaces/navigation                                               | 46px activity bar; 252px default / 220px compact / persisted and clamped sidebar; search, drag, selection, IM source and keyboard            |
| Conversation/Composer         | App, TaskPlanProgress, ComposerContextBar, UI conversation/patterns                               | Streaming/append/stop; scroll retention; collapsed tools; queued prompts; approval and multi-question inputs; attachments and 1px focus      |
| Nine Dock views               | workspace-tabs, workspace-dock-layout, WorkspaceFiles/Preview, UI workspace/workflow/professional | File, Markdown, Review, Terminal, Browser, Sources, Goal, child-agent, agent-team; empty/error/loading; close/reopen; dirty drafts and focus |
| Environment/goal/sources/team | EnvironmentPanel, GoalEditorPanel, SourcesPanel, App                                              | Git and source groups; live agent events; save failure; nested overlay focus                                                                 |
| Settings                      | SettingsPanel and IM subcomponents, UI forms/management                                           | Six sections; provider controls; save/cancel/failure; narrow content after outer navigation                                                  |
| IM                            | ImSettingsPanel, ImNavigation, ImAccountControls, ImSetupGuide, ImDiagnostics                     | Wizard/manage/compact; per-channel counts; partial failure; transport/storage guidance; refreshing races; expired pairing and unpair focus   |
| Resources                     | ResourceCenter, MCP editor, UI management                                                         | Categories/list/detail; loading/empty/error; existing install and trust services                                                             |
| Secondary pages               | ArchivePage, TokenUsagePage, AutomationPage, UI data                                              | Read-only archive/recovery/deletion; localized tables, density, charts and states                                                            |

## Data and semantic boundaries

1. Phone/PC presence is unavailable: do not infer it from a connected bot. Use actual Gateway, connection and device status.
2. Display names require real metadata with stable-ID fallback. Grant mode belongs to a selected project/task. Account mute has no defined protocol and must not become an interactive fixture control.
3. Credentials reside in the Gateway (local or team). Generate callback addresses from real configuration; hide them for WebSocket connections.
4. Channel counts and health are independent. One connected bot must not hide another failed connection; pairing, device connectivity and executable grants are separate facts.
5. Compact layout uses actual remaining settings width. Reuse the existing guide state machine for the General navigation entry.
6. Preserve required control contrast and professional Diff colors. The user's additional terminal requirement supersedes the prototype's dark terminal exception: light mode uses a light terminal, both modes protect text contrast, and xterm overlay canvases remain transparent. Vendor xterm CSS loads in the reset layer so its viewport background cannot cover the public terminal theme. Selected usage tabs retain a heavier font as a non-color selection cue. Map tokens by semantic role, not matching names.
7. Prototype controllers and fixtures never become production orchestration or state. The minimum desktop window remains 980×680; no mobile product is introduced.

## Common acceptance

Run applicable tests, typecheck/build, `verify:desktop-skin`, `verify:visual-convergence`, `verify:ui-boundaries`, `verify:ui-performance` and `verify:im`. Compare 1440/1280/1024/980×680, real 200% zoom, light/dark, normal/high contrast, reduced motion, Chinese/English and existing RTL locales without relaxing performance budgets.

Live Feishu pairing/tasks, offline/sleep/restart recovery, native macOS arm64/x64 and Windows, signing/notarization/stapling, update/rollback and final Windows installation-path ACLs remain distinct acceptance gates requiring their actual environments.

## Candidate acceptance (2026-09-06)

Implementation commit: `60c8a8ad9bb9a80b251e43d519228830e5cce379` on `codex/discussion-151`, with a clean worktree throughout the native runs. The subsequent evidence-only commit changes this record, the card inventory and the ledger; it does not change the tested application. [Machine-readable acceptance](acceptance.json) records results, timings, budgets and report hashes.

| Check                           | Current result                                                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen specification            | Latest Discussion timestamp rechecked: 2026-09-05T12:56:59Z; same v69 ZIP, all 82 files exact; 12 library and 34 workspace checks passed                                                                                                        |
| Full repository validation      | `npm test`, `npm run typecheck`, `npm run build` and `npm run format:check` passed; Desktop 1,283 passed / 5 existing skips, other packages 805 passed / 2 existing skips                                                                       |
| Boundaries and contracts        | Public CSS/component and skin contracts, package consumer, 24 safe CSS fixtures and 114 rejected boundary violations passed                                                                                                                     |
| Production/prototype comparison | Same Electron engine and equal content area; 26 checks, 328 geometry assertions with measured maximum difference **0 CSS px**, no JavaScript errors                                                                                             |
| Native convergence              | All 11 workloads passed on the implementation SHA, with original per-workload and bundle budgets                                                                                                                                                |
| Theme and Terminal              | 64 real Electron runtime vertices passed; light/dark, contrast, RTL, real 200% zoom and reduced motion; one PTY and transcript retained, readable ANSI/true-color text and transparent overlays; viewport background equals terminal background |
| IM                              | Real Electron, isolated Gateway and loopback Pi smoke passed; channel events are synthetic and do not prove a real Feishu tenant                                                                                                                |
| Engineering package             | macOS arm64 app.asar and unpacked/resources scan passed, with no smoke-only fixture leakage                                                                                                                                                     |

The geometry assertions cover the activity bar, sidebar, workspace header, conversation, Composer/context/input/toolbar, all nine Dock containers and tab bars, and all six settings panel/header/body/navigation boundaries. Four main surface backgrounds also match in light/dark and normal/high contrast. [Measurements](../../artifacts/discussion-151/parity/metrics.json) and paired screenshots live beside them. This is not a whole-page bitmap-equality claim: task/account data, required control and focus contrast, non-color state cues and professional palettes have the semantic differences described above. The 73-card inventory records workload coverage separately from these measured page regions.

The original prototype validation sequence was followed: shell and independent scrolling; nine Dock entry/close/reopen/keyboard and panel operations; nested environment dialogs; six settings sections; four resource categories and secondary pages; the requested prototype widths and 12 appearance combinations; screenshot/error checks. Production acceptance adds the actual minimum desktop window, native focus, save/failure/dirty states, IM race checks and the existing accessibility matrix. The 768/390px cases remain prototype web checks.

Reproduce with the commands under Common acceptance, plus `npm run verify:prototype-parity`. The parity command requires Playwright; when it is installed outside the repository, set `ARTEMIS_PLAYWRIGHT_MODULE` to its absolute module entry. Run builds and native verifiers serially because smoke verifiers temporarily replace and then restore generated renderer artifacts. Keep the candidate worktree clean; do not disable exact-head, sandbox or performance gates.

Authored-source `git diff --check` passes. The attachment itself contains three trailing-whitespace lines (`components.html:424`, `contrast/REPORT.md:4`, `contrast/run-headless.zsh:178`); they are preserved byte for byte and excluded from that authored-source check.

Local evidence is in `artifacts/discussion-151/` (ignored), with hashes for the principal reports in `acceptance.json`. No push, PR or release was performed. Real Feishu tenant and other native platform/release gates listed above remain unverified.
