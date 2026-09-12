# Design workflow: P0 implementation and evidence

Development follows the [final execution plan in Discussion #165](https://github.com/EurekaRaider/Artemis/discussions/165#discussioncomment-18368743).

This change is the first P0 work package, **not an enabled `/design` feature or a completed P0 acceptance gate**. The desktop UI and Main broker do not yet expose these primitives. P1/P2 must not be declared complete from the probes below.

## Implemented

- `design-source.ts`: source-based leaf text edits, unique IDs (including template contents), numeric CSS parameters with fixed units and ranges. Preserves surrounding icons and scripts; rejects stale/unsupported targets. Runtime DOM is not a persistence input. P0 supports up to 128 numeric declarations; color parameters and script-owned slot detection remain future work.
- `design-store.ts`: isolated additive P0 SQLite tables, flushed hash-addressed source blobs, compare-and-swap revision heads, retained conflict branches, same-operation replay validation, task/workspace ownership checks, integrity validation, and a 50-revision cap. Request records retain workflow, workspace, mode, request and turn IDs. Dispatch waits for host activity to end; unknown dispatch after recovery becomes `needs-reconciliation` and cannot be replayed automatically.
- `ArtemisAgentHost.prompt`: an internal optional workflow argument defaults to `code`. Design turns expose only project reading, attachment reading, and questions. Previously retained tools reject execution during design turns. Explicit/custom automatic delegation is disabled. Subsequent code turns reuse the same Pi session and restore the ordinary mode tool set. No public command enables this argument yet.
- Native Electron probe: an ephemeral session and controlled protocol serve a sandboxed generated iframe beneath a preview shell. The fixture reads the built renderer's CSP without changing it. It enumerates all preview frame OS PIDs, checks separation from trusted/Browser control contents, renders saved/reopened Chinese text and a CSS parameter, checks script execution and denied capabilities, then runs a real infinite loop and verifies termination of all owned renderer processes and continued control responsiveness.
- CI runs the probe on macOS arm64, macOS x64 and Windows x64, with commit-bound JSON artifacts.
- Main-owned watchdog probes once per second with at most one outstanding request. Five seconds without a response terminates the fixture preview independently of the generated page. Three consecutive RSS samples above 512 MiB also stop monitoring and request termination; memory thresholds are unit tested and are not a hard allocation limit.

## Reproduce

```sh
npm run build:core
npx vitest run apps/desktop/test/design-source.test.ts apps/desktop/test/design-store.test.ts apps/desktop/test/design-watchdog.test.ts packages/agent-host/test/design-workflow.test.ts
npm run verify:design-p0
```

`ARTEMIS_DESIGN_P0_OUTPUT` optionally selects a report parent directory. The probe creates an isolated subdirectory for its profile, SQLite file, source blobs and report. It does not load user tasks, models or project files. `ARTEMIS_EXPECTED_HEAD` makes CI reject a mismatched checkout. Reports include Electron version, platform, architecture, commit, frame PIDs, and individual results. A missing/incomplete report or failed cleanup makes the launcher fail.

Local macOS arm64 / Electron 43.2.0 passed 13 native assertions. The preview shell and generated iframe used **different** OS processes, both distinct from the controls. Closing the view after crashing its top renderer also terminated its separate iframe process in this run; this is evidence for this fixture, not a universal process-reclamation guarantee. The initial 12-assertion fixture also passed on all three GitHub runner platforms in [run 34664670730](https://github.com/EurekaRaider/Artemis/actions/runs/34664670730); that run predates the watchdog assertion and does not validate later changes.

The unit/integration tests cover leaf text and parameter round trips, malformed/duplicate targets, invalid ranges, revision replay after reopening, conflict retention, SQLite rollback after blob publication, content corruption, read-only mode rejection, workspace mismatch, ordered code/design requests, ambiguous dispatch recovery, and retained Pi tool rejection.

## Remaining P0 gates

- Main-owned request integration with real `startTaskTurn`, active descendant tools, broker identity checks, attachments, queue editing/cancellation/compaction, and persisted mode/workspace-change handling. The standalone queue tests do not establish these production boundaries.
- Production preview manager with one-preview ownership, rate-limited bridge, all-frame navigation/download/permission adversarial tests, stale-instance rejection and preview stop on read-only mode changes. The watchdog core is tested; its production manager integration remains outstanding.
- Native packaged-application acceptance on supported platforms. A fixture using the built CSP is not the installed production app or signing/update/rollback evidence.
- Full document/variant/page/resource protocol, versioned UI events and atomic outbox, blob cleanup/aggregate limits, and richer fault injection. The P0 schema deliberately has its own table prefix; production migration is not yet defined.

Only after these gates pass does the final plan allow P1 UI/tools/editor/implementation/export integration, followed by P2 multiple variants/pages and expanded editing. Static slots are declarations in the P0 parser; arbitrary JavaScript can still overwrite them, so no user-facing reliable-editing guarantee is made yet.
