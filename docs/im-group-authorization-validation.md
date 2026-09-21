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
