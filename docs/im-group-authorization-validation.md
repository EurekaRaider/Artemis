# Group authorization implementation evidence

Baseline: `0e57a8ca5c82524ea50346d2031fb413c47f3b18` on a clean Local checkout.
Branch created by this task: `codex/im-group-authorization-p0-p4`.
Discussion 217 was read through GitHub GraphQL on 2026-09-21; it had no comments.
The implementation follows the reviewed contract: P1 precedes the new UI.

## P0 baseline

- Current management is an expanded settings card and a separate grant dialog.
- Project controls are shared; data scopes and effective revisions are per audience.
- Empty legacy read paths mean whole-project read access. Explicit selected mode with zero paths is invalid.
- Unconfirmed execution consent still permits previously authorized reads.
- Native authorization currently writes Gateway before local settings. Settings can be persisted even when the returned promise rejects.
- Native groups require the local Gateway; owner direct chats retain local semantics.
- Existing policy, native-group, protocol and remote-tool tests are the regression baseline. New behavioral assertions cover future-file scope isolation and preflight rejection without creating group relationships.

## Evidence boundaries

Development, automated integration, rendered interaction, exact-SHA CI, packaging and real-channel acceptance are separate evidence. No real channel message is authorized by this task unless a specific testing identity and group have been explicitly approved.

## P1 implemented foundation

- Narrow version-1 command with target identity, expected absence/versions, operation ID and canonical confirmation contents.
- SQLite operation journal and local settings commit share a savepoint. Old binaries read paused settings after migration.
- Gateway prepare/activate journal preserves the same group revision across response loss and activation.
- Local authorization writes serialize; pending targets fail closed. Restarts resume pending records; legacy grant/binding writes cannot bypass the versioned command after migration.
- Rebind removes old-project effective scopes and starts a fresh group entry while preserving history.
- Node 24.21.0: core build and desktop typecheck passed; 94 native-group/Gateway tests passed, including narrow-command preflight, double clicks, scope-only edits, lost prepare/activate responses, restart and revoked-owner recovery.
- Remaining integration matrix is tracked through P4; this foundation test result does not claim real-provider acceptance or exhaustive failure-boundary coverage.

## P1 recovery follow-up

- A newly confirmed CAS command can supersede the same group's incomplete operation; old IDs remain terminal and cannot reactivate it.
- Journal-write, local-write and post-commit task-effect failures remain recoverable without rolling the applied authorization revision.
- Confirmation also binds the affected authorization audience snapshot when changing shared project policy or enabling the device.
- Node 24.21.0: 99 native-group/Gateway tests passed after these changes.

## P2 manager and P3 localization

- One group-first manager dialog, explicit project/group choices, local three-step drafts, same-shell discard, and fingerprint-bound confirmation.
- Edit, renew, restore, pause and rebind use the narrow command; persisted partial phases remain visible and retryable. Background status refresh continues during editing.
- Selected read mode with zero paths cannot advance; Plan/Review cannot select write access. File and folder semantics remain in the existing scope editor.
- All 14 locale resources include the new manager copy. Arabic applies RTL to the full dialog, including its header.
- Isolated production components were exercised in Electron at 980 × 680 across 14 locales and light/dark themes. Actual webContents zoom factor 2 was checked; native capturePage was used because CDP screenshots cropped high-density zoomed captures.
- Node 24.21.0: full test:im passed, 702 passed and 6 pre-existing skipped. Native screen-reader and real-provider acceptance are not covered by these checks.

## P4 production checks

- The default `verify:im` now exercises the native-group manager with production Electron, preload, main process and the actual local Gateway. Its synthetic roster is inserted only while the isolated app is stopped. The retired shared-space harness is preserved behind `--legacy`; its obsolete guided-flow selector fails against the current UI and is not counted as passing.
- The new gate covers explicit project selection, 980 × 680 and 1440 × 900 light/dark layouts, actual 200% zoom, Escape/discard, create, idempotent replay, pause, restore, rebind and restart persistence. A loopback model drives a real Pi scope-checked README read in a local child task.
- Production testing caught a retained-history selection bug after rebind. Status now identifies the current group entry; the manager opens that entry, and both old-history retention and current-entry selection have regression assertions.
- A related live refresh clears the confirmation checkbox as well as blocking submission.
- Final source checks: 704 IM tests passed; 6 existing tests skipped. Production build, desktop typecheck (following successful core/UI-library checks), UI boundaries and UI convergence passed.
- Device registration and pairing approval share the authorization queue. A held Gateway prepare response reproduces the prior registration race; the regression now confirms registration waits and cannot replace the device after authorization enables IM.
- Exact-head visual/skin validation remains a separate gate; its result is reported against the tested commit. Cross-platform packaging/signing, native screen-reader use and real Slack/Feishu/Lark delivery remain external acceptance work.
