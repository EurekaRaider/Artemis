# Design workflow implementation and acceptance

The implementation follows [Discussion #165's final execution plan](https://github.com/EurekaRaider/Artemis/discussions/165#discussioncomment-18368743). The user additionally authorized bounded P3 development, on the current branch, with local verification followed by PR delivery.

## P3 scope

P3 supports three explicit source contracts:

- A flat, typed JSON data map binds declared static leaf nodes through `data-design-bind`. Editing data preserves the HTML source binding. Scripts must not own or recreate these nodes.
- Structural moves reorder declared children or move them between `data-design-container` elements. Stable IDs, static ownership, original parent, destination and insertion target are checked against the exact base revision. Cycles, script/template subtrees, stale IDs and unmarked containers are rejected. The keyboard-selectable tree and destination selector accompany drag ordering.
- Source locations refer to normalized, immutable HTML, and include revision, variant, page, element ID, parent ID and source line. They are not mappings into arbitrary React components or generated runtime DOM.

Arbitrary framework compilation, rewriting script-generated DOM, remote asset fetching, new agent loops and unrestricted structural editing remain outside this scope. Unsupported changes use selection conversation in the same task.

## Implementation

`DesignRepository` stores immutable, hash-verified content, operation IDs, retained conflict branches, inspection evidence and durable dispatch records. `DesignService` authorizes trusted panel operations and broker calls. The host workflow and mode are checked independently of tool arguments. Plan and Review cannot save, preview new JavaScript, export or implement.

`DesignPreviewHost` owns one ephemeral protocol session and isolated view. Generated content has no preload or desktop API and runs in an opaque sandboxed iframe. The host enumerates the shell and child renderer processes separately: a shell crash alone does not reliably terminate a separate child. Stop therefore terminates verified, exclusively owned child PIDs before crashing and closing the shell. An unresponsive preview must leave the trusted window responsive.

Cross-workflow requests use a durable Main queue. The runtime waits for child execution and cancelled shell settlement before completing the dispatch boundary. An uncertain dispatched request cannot replay automatically after restart. An explicit redo gets a new identity; transport retries of an unchanged identified request return its existing result.

Design panels preserve manual drafts independently of agent revisions. Static editing produces source patches; parameter/data previews are temporary and never become persisted facts until save. Export removes executable content and uses a sandboxed static HTML wrapper. Implementation references a saved revision and an explicit page set.

## Verification record

These are development results, not a release or cross-platform completion claim:

- Earlier P0 native fixture passed 13 assertions on Windows x64, macOS arm64 and macOS x64 at commit `e977b49ede7fe8b06e47f0ed33166548fd3f5bde`.
- The production-host native development runner on macOS covers actual interaction and screenshot, no desktop API, network/eval denial, trusted renderer isolation, watchdog stop, all shell/child PID termination, static export with current form values, serial inspection, controlled page navigation, oversized messages, sustained bridge flood, trusted window survival, and read-only denial. Capture targets the owned renderer through a fixed debugger screenshot command; no debugger capability is exposed to generated content.
- Repository/runtime regression coverage includes CAS conflicts, idempotency, restart reconciliation, immutable page handoff, static data/structure patches and waiting for cancelled shell settlement.
- Model/reasoning picker geometry was checked in native Electron before/after the narrow-container CSS correction. Hover sections now retain the same navigation geometry at 600 and 900 pixel test widths.

- `npm test` and `npm run typecheck` passed locally; the final desktop regression run has 1,663 passing tests and 10 skips. Production renderer/Main builds and formatting checks passed.
- `verify:design-workflow` exercises the real application in light and dark themes: compact vertical model/reasoning navigation, 20 native hover transitions, saved native preview, Chinese editing, retained drafts, undo to the saved preview, redo, immutable save, actual screenshot thumbnail and trusted stop. The saved screenshot was inspected and contains the edited Chinese source. The smoke window stays on the active display because an offscreen native view has no usable window capture surface.
- Real Kimi K3 acceptance used isolated synthetic settings, state-form and two-page projects. Each design used actual saved native inspection evidence, then the same Pi session read the exact selection and wrote self-contained implementation files. The two-page run resumed its original Pi session with a 262k window after the test's 128k cap was exhausted. Independent native implementation checks verified toggles/save, required fields/email validation/success/error/reset, and forward/finish/back navigation. No design turn mutated project source.
- Fault tests additionally cover corrupted/missing blobs, failed blob-write rollback with an identical retry, the 50-revision cap, Plan/Review denial, cancelled draft leave, changed-workspace save refusal, and preserved goal continuation identity.

The new Windows x64 and macOS x64 CI checks have not run for these local changes. The CI matrix includes both native production-host checks and the rendered application workflow, and must pass on the eventual PR head. These local development results do not claim signed/notarized packaging, update/rollback verification, or cross-platform release completion.
