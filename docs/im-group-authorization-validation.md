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
