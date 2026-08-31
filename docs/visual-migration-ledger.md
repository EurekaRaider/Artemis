# Discussion #76 visual migration ledger

Status: CL0A contract candidate. This ledger separates static prototype evidence,
package evidence, and production Electron evidence. It must not be used to turn a
prototype pass into a migrated production surface.

## Inputs and evidence boundary

- Candidate base: `c539771377f94046774d570717783a46d28555b7`.
- v17 specification inputs: `ui-prototype/README.md`, `components.html`,
  `apple-inspired-ui.html`, `proposal-ui-library.md`, `capability-matrix.md`,
  `tools/capability-map.json`, `tools/matrix-stats.json`,
  `contrast/REPORT.md`, `contrast/prototype-contract-result.json`, and
  `contrast/summary.json`.
- The prototype directory was available only in a companion checkout and is not
  present in this candidate base. CL0A does not copy or modify it.
- v17's 70/70 generic card contract, 22/22 targeted historical-gap checks, and
  36 contrast combinations are HTML/Chrome specification evidence only. They do
  not prove React anatomy, Desktop integration, Electron geometry, platform
  parity, or production visual migration.

## Token lineage

| Prototype role                                                | CL0A semantic contract                                                  | Owner          | Consumer                             | Legacy/prototype selector                          | Target PR                      | Electron evidence                                 | Status                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- | ------------------------------------ | -------------------------------------------------- | ------------------------------ | ------------------------------------------------- | --------------------------------------- |
| `--bg`, `--bg-sidebar`, `--bg-activity`                       | `color.canvas`, `color.background.sidebar`, `color.background.activity` | theme contract | future shell/layout components       | `:root`, `.app-shell`, `.sidebar`, `.activity-bar` | CL1A values; MIG1 surfaces     | Required on migration SHA                         | Contracted; neutral values only         |
| `--surface`, `--raised`, `--sunken`, `--panel-2`, `--panel-3` | surface base/raised/sunken/composer/user roles                          | theme contract | controls, panels, Composer, timeline | root theme blocks and renderer `styles.css`        | CL1A values; CL2-CL4 consumers | Required on migration SHA                         | Contracted; neutral values only         |
| `--hover`, `--selected`                                       | interaction hover/selected roles                                        | theme contract | all interactive anatomy              | component hover/selected selectors                 | CL0B anatomy; CL2-CL4          | Gallery interaction first, Electron when consumed | Contracted; behavior not implemented    |
| `--text`, `--text-2`, `--text-3`                              | primary/secondary/tertiary text roles                                   | theme contract | all components and surfaces          | root theme blocks                                  | CL1A values                    | Required on migration SHA                         | Contracted; neutral values only         |
| `--border`, `--border-soft`                                   | default/strong/subtle border roles                                      | theme contract | controls, cards, splitters, overlays | renderer `styles.css` local declarations           | CL1A values; CL2-CL4           | Required on migration SHA                         | Contracted; neutral values only         |
| accent fill/text/hover/soft/on-accent                         | primary/hover/subtle/text/on-primary roles                              | theme contract | controls, focus, selection           | v17 role tokens                                    | CL1A values; CL2               | Gallery contrast then Electron                    | Contracted; Direction A values deferred |
| success/warning/danger/info + soft/on-color                   | status role families                                                    | theme contract | feedback, approvals, diff, countdown | v17 role tokens and renderer status selectors      | CL1A values; CL2/CL4           | State matrix on exact consumer SHA                | Contracted; behavior unchanged          |
| terminal/diff roles                                           | terminal foreground/background and diff add/delete pairs                | theme contract | Terminal, change set, editors        | `--terminal-*`, `--diff-*`                         | CL1A values; MIG3-MIG5         | Native Electron evidence required                 | Contracted; not consumed                |
| spacing, control sizes, radius, typography                    | bounded numeric and font-stack-ID tokens                                | theme contract | component anatomy and layout         | v17 direction density/radius/font blocks           | CL0B anatomy; CL1A values      | Gallery geometry then Electron                    | Contracted; no components yet           |
| 180/320 timing and shell easing                               | duration/easing IDs with fixed CSS serializers                          | theme contract | transitions only                     | `--t-quick`, `--t-standard`, `--shell-ease`        | CL1A/CL2                       | reduced-motion evidence later                     | Contracted; no motion behavior yet      |
| card/surface/composer/overlay shadows                         | shadow IDs with fixed CSS serializers                                   | theme contract | cards, Composer, overlays            | `--shadow-*`                                       | CL1A/CL2-CL4                   | Gallery and Electron later                        | Contracted; arbitrary shadows rejected  |

Primitive palette authoring and component-private tokens remain implementation
details of `@artemis/theme-artemis` and `@artemis/ui`. Third-party Skin v1 is
semantic token data only; it cannot add primitive names, component selectors, or
CSS code. Its manifest uses `com.example.skin`-style reverse-DNS IDs,
`modes`/`tokens` fields, fixed flat token basenames, and `normal`/`high`
contrast. `integrity.json` covers the manifest and declared token data but is not
an author signature or trust decision.

## Component and surface sequence

| Scope                                                                    | Type               | Owner                     | Consumer                   | Legacy selector/source                           | Target PR | Electron evidence                                           | Status                                            |
| ------------------------------------------------------------------------ | ------------------ | ------------------------- | -------------------------- | ------------------------------------------------ | --------- | ----------------------------------------------------------- | ------------------------------------------------- |
| Manifest/token/integrity schemas, registry, validators, public artifacts | token/package      | `@artemis/theme-contract` | theme packages and Gallery | scattered root variables                         | CL0A      | N/A: no Desktop dependency or UI change                     | Candidate implemented                             |
| Public React/CSS boundary                                                | package            | `@artemis/ui`             | Gallery, later Desktop     | no package boundary                              | CL0A      | N/A: no components or Desktop consumer                      | Candidate implemented                             |
| Neutral built-in skin data/CSS/integrity artifacts                       | token/package      | `@artemis/theme-artemis`  | Gallery                    | v17 role vocabulary only                         | CL0A      | N/A: no Desktop resolver                                    | Candidate implemented; Direction A still deferred |
| Anatomy, states, events, ARIA, focus                                     | component          | `@artemis/ui`             | Gallery harness            | v17 70 cards                                     | CL0B      | Gallery runtime required; Electron not yet production proof | Pending                                           |
| Direction A Artemis values                                               | skin               | `@artemis/theme-artemis`  | Gallery                    | v17 A light/dark/high                            | CL1A      | Gallery before/after required                               | Pending                                           |
| Resolver/registry and host attributes                                    | integration        | Desktop renderer glue     | Desktop                    | current `data-theme` bridge                      | CL1B      | Exact-head Electron required                                | Pending                                           |
| Default/stress/fallback conformance                                      | governance         | Gallery + validators      | CI                         | v17 A/B/C stress input                           | CL1C      | Gallery proof; Desktop fallback proof when resolver exists  | Pending                                           |
| Foundation controls                                                      | component          | `@artemis/ui`             | Desktop consumers later    | buttons, badge, inputs, select, switch           | CL2       | Gallery cases first                                         | Pending                                           |
| Feedback, overlays, layout primitives                                    | component          | `@artemis/ui`             | Desktop consumers later    | dialog/menu/toast/tabs/tree/splitter/panels      | CL3       | Gallery cases first                                         | Pending                                           |
| Artemis-specific presentational patterns                                 | component          | `@artemis/ui`             | Desktop adapter layer      | Composer, approval, UserInput, activity patterns | CL4       | Gallery cases first                                         | Pending                                           |
| Shell, activity bar, sidebar, navigation                                 | surface            | Desktop                   | users                      | `App.tsx`, renderer `styles.css`                 | MIG1      | Exact-head light/dark/contrast/zoom matrix                  | Pending                                           |
| Composer and approval surfaces                                           | surface            | Desktop                   | users                      | renderer Composer/approval selectors             | MIG2      | Exact-head interaction + screenshot evidence                | Pending                                           |
| Conversation, timeline, sources, task activity                           | surface            | Desktop                   | users                      | timeline/source selectors                        | MIG3      | Exact-head state and Electron evidence                      | Pending                                           |
| Workspace, Dock, editors, Browser, Terminal                              | surface            | Desktop                   | users                      | workspace/dock/editor selectors                  | MIG4      | Geometry, PTY, Browser boundaries, exact-head Electron      | Pending                                           |
| Review, Environment, Settings, Resource Center, MCP                      | surface            | Desktop                   | users                      | feature-local renderer styles                    | MIG5      | Feature state matrix + exact-head Electron                  | Pending                                           |
| Remaining pages and governance cleanup                                   | surface/governance | Desktop + CI              | users/contributors         | remaining legacy selectors                       | MIG6      | Complete exact-head screenshot/runtime matrix               | Pending                                           |

## Production behavior regression input

The following v17 matrix is retained unchanged as migration input. `covered`
means a production symbol existed at v17's historical `d0b7b9f` baseline; it
does not mean the component-library visual migration is complete.

| Module            | Covered | Partial | Uncovered |  Total |
| ----------------- | ------: | ------: | --------: | -----: |
| tokens-design     |       5 |       0 |         0 |      5 |
| basic-controls    |       6 |       0 |         0 |      6 |
| iconography       |       2 |       2 |         0 |      4 |
| form-inputs       |       4 |       1 |         0 |      5 |
| overlays          |       3 |       0 |         0 |      3 |
| shell-navigation  |       1 |       6 |         1 |      8 |
| data-display      |       5 |       2 |         0 |      7 |
| feedback-states   |       4 |       0 |         0 |      4 |
| sources-panel     |       2 |       3 |         0 |      5 |
| goal-editor       |       0 |       2 |         0 |      2 |
| environment       |       1 |       1 |         0 |      2 |
| composer          |       3 |       0 |         0 |      3 |
| run-control       |       2 |       0 |         0 |      2 |
| task-activity     |       2 |       0 |         0 |      2 |
| agents            |       1 |       0 |         0 |      1 |
| workspace-panels  |       1 |       1 |         0 |      2 |
| settings-mcp      |       0 |       1 |         0 |      1 |
| session-messaging |       6 |       1 |         1 |      8 |
| **Total**         |  **48** |  **20** |     **2** | **70** |

The two uncovered v17 inputs remain Breadcrumb/path navigation and multi-group
UserInput. Multi-group UserInput remains blocked on its versioned protocol and
idempotent reducer contract; visual migration must not synthesize that protocol.

## Rollback dependencies and stop conditions

- CL0A rollback is limited to the four new workspaces, root orchestration,
  verification scripts, release-version workspace registration, and these
  ledgers. Desktop production source and renderer CSS remain untouched.
- A later PR may depend only on a CL milestone already merged into the latest
  `main`; a Draft PR or stale candidate SHA is not a dependency.
- Stop if a component requires Protocol/Desktop/Electron/Node or
  `window.artemis` inside `@artemis/ui`, if Gallery requires a private source
  import, or if a skin requires selectors/code rather than schema-valid data.
- Stop on missing cases, `NO_RESULT`, empty screenshots, console errors,
  renderer-SHA mismatch, or a sandbox fallback. None may be reclassified as a
  pass.
