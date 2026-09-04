# Discussion #76 visual migration ledger

Status: MIG6 convergence and governance Draft PR #147. MIG5B final 1.4.58 PR
head `b67d208b7972e2083e8752c677c37f2328913e77` passed fresh CI and merged
through PR #146 as squash commit
`3b024552ab520d83982aaadf5185404d7b8325ce`. MIG6 opened at source head
`ebe6741e2dc92222638bf4b22de07ce43d667b32`; its one permitted post-PR review
completed on that SHA. Findings from that review and initial CI run
`33750952835` were combined at repair head `10e46d8`. Its CI run `33756491896`
then isolated one cross-runner startup-budget issue, addressed at follow-up
head `fcf993c`. CI run `33759335470` passed the full macOS arm64 aggregate and
isolated two timeline sampling boundaries on macOS x64 and Windows x64, both
addressed at head `331448c`. CI run `33762336220` passed the full macOS arm64
aggregate and confirmed the timeline fixes, then isolated one Windows startup
outlier and the macOS x64 Goal workload circuit breaker, addressed at head
`69bd71f`. CI run `33765644502` passed the full macOS arm64 aggregate and then
proved that the remaining startup policy still conflated first cold launch with
the 26 subsequent warm launches on macOS x64 and Windows x64, addressed at head
`f33257c`. CI run `33768726913` then passed seven of eight jobs, including the
complete Windows convergence and final package boundary, but macOS x64 exposed
an over-broad requirement that all locale screenshots have unique hashes. The
current local follow-up retains pixel-difference checks for same-locale resolved
themes and physical window viewports, reports every duplicate group, and keeps
zoom, direction, locale, motion, and CSS viewport as separate runtime evidence.
The next exact PR head, fresh native macOS arm64, macOS
x64 and Windows x64 CI, and merge are not yet complete. This ledger separates
static prototype evidence, package/Gallery evidence, and production Electron
evidence. It must not be used to turn a prototype, Gallery pass, or
attribute-only resolver pass into a migrated production surface.

## Inputs and evidence boundary

- MIG6 candidate base: `3b024552ab520d83982aaadf5185404d7b8325ce`
  (MIG5B merged).
- Draft PR #147 initial source head:
  `ebe6741e2dc92222638bf4b22de07ce43d667b32`; the sole review is scoped to
  this SHA, while final repaired-head CI remains pending.
- Read-only v17 specification inputs:
  companion `ui-prototype/README.md`
  (`sha256:808ee19c05236b8bc1e83b0c9914f9985d3d091c5df4bb36adc46440c229068c`),
  `ui-prototype/components.html`
  (`sha256:8e6926592a21edb6bcaf228b8ed2c86aed563c2a106faa702ccbaf2404f5f28c`),
  `ui-prototype/apple-inspired-ui.html`
  (`sha256:25bb03a28c1e04dd73e57f64d27d3ac2ab6a24ebfe829053e4a540c351c29bbf`),
  `ui-prototype/proposal-ui-library.md`,
  `ui-prototype/capability-matrix.md`,
  `ui-prototype/tools/capability-map.json`,
  `ui-prototype/tools/matrix-stats.json`,
  `ui-prototype/contrast/REPORT.md`,
  `ui-prototype/contrast/prototype-contract-result.json`, and
  `ui-prototype/contrast/summary.json`.
- The prototype directory remains read-only in a companion checkout and is not
  present in this candidate base. MIG5B does not copy or modify it.
- v17's 70/70 generic card contract, 22/22 targeted historical-gap checks, and
  36 contrast combinations are HTML/Chrome specification evidence only. They do
  not prove React anatomy, Desktop integration, Electron geometry, platform
  parity, or production visual migration.

## Token lineage

| Prototype role                                                | CL0A semantic contract                                                  | Owner          | Consumer                             | Legacy/prototype selector                             | Target PR                      | Electron evidence                                 | Status                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- | ------------------------------------ | ----------------------------------------------------- | ------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| `--bg`, `--bg-sidebar`, `--bg-activity`                       | `color.canvas`, `color.background.sidebar`, `color.background.activity` | theme contract | future shell/layout components       | `:root`, `.app-shell`, `.sidebar`, `.activity-bar`    | CL1A values; MIG1 surfaces     | Required on migration SHA                         | Direction A merged; Gallery token output     |
| `--surface`, `--raised`, `--sunken`, `--panel-2`, `--panel-3` | surface base/raised/sunken/composer/user roles                          | theme contract | controls, panels, Composer, timeline | root theme blocks and renderer `styles.css`           | CL1A values; CL2-CL4 consumers | Required on migration SHA                         | Direction A merged; Gallery samples          |
| `--hover`, `--selected`                                       | interaction hover/selected roles                                        | theme contract | all interactive anatomy              | component hover/selected selectors                    | CL0B probe; CL2-CL4            | Gallery interaction first, Electron when consumed | CL2B merged; CL2C navigation candidate       |
| `--text`, `--text-2`, `--text-3`                              | primary/secondary/tertiary text roles                                   | theme contract | all components and surfaces          | root theme blocks                                     | CL1A values                    | Required on migration SHA                         | v17 corrected roles; WCAG candidate          |
| `--border`, `--border-soft`                                   | default/strong/subtle border roles                                      | theme contract | controls, cards, splitters, overlays | renderer `styles.css` local declarations              | CL1A values; CL2-CL4           | Required on migration SHA                         | Required/subtle roles separated and tested   |
| accent fill/text/hover/soft/on-accent                         | primary/hover/subtle/text/on-primary roles                              | theme contract | controls, focus, selection           | v17 role tokens                                       | CL1A values; CL2               | Gallery contrast then Electron                    | Direction A merged; WCAG tested              |
| success/warning/danger/info + soft/on-color                   | status role families                                                    | theme contract | feedback, approvals, diff, countdown | v17 role tokens and renderer status selectors         | CL1A values; CL2/CL4           | State matrix on exact consumer SHA                | Direction A merged; behavior unchanged       |
| terminal/diff roles                                           | terminal foreground/background and diff add/delete pairs                | theme contract | Terminal, change set, editors        | `--terminal-*`, `--diff-*`                            | CL1A values; MIG3-MIG5         | Native Electron evidence required                 | Candidate values; no production consumer yet |
| spacing, control sizes, radius, typography                    | bounded numeric and font-stack-ID tokens                                | theme contract | component anatomy and layout         | v17 direction density/radius/font blocks              | CL0B probe; CL1A values        | Gallery geometry then Electron                    | CL2B merged; CL2C compact/comfortable nav    |
| 180/320/480 timing and standard/shell easing                  | duration/easing IDs with fixed CSS serializers                          | theme contract | transitions only                     | `--t-quick`, `--t-standard`, `--ease`, `--shell-ease` | CL1A/CL2                       | reduced-motion evidence later                     | Candidate serializer and motion sample       |
| card/surface/composer/overlay shadows                         | shadow IDs with fixed CSS serializers                                   | theme contract | cards, Composer, overlays            | `--shadow-*`                                          | CL1A/CL2-CL4                   | Gallery and Electron later                        | Static none; mode-aware trusted serializers  |

Primitive palette authoring and component-private tokens remain implementation
details of `@artemis/theme-artemis` and `@artemis/ui`. Third-party Skin v1 is
semantic token data only; it cannot add primitive names, component selectors, or
CSS code. Its manifest uses `com.example.skin`-style reverse-DNS IDs,
`modes`/`tokens` fields, fixed flat token basenames, and `normal`/`high`
contrast. `integrity.json` covers the manifest and declared token data but is not
an author signature or trust decision.

## CL1A Direction A merged decisions

`components.html` is authoritative where v17 corrected a semantic role for
contrast; `apple-inspired-ui.html` supplements shell surfaces, terminal, diff,
and mode-specific shadows. The README's explicit five-level Direction A
mapping resolves the component-page naming collision as control/input/card/
panel/composer = `8/10/12/16/18px`; the comparison page's local
`--r-card:16px` remains a prototype card-layout alias, not the frozen semantic
`radius.card`. All alpha colors are serialized as deterministic `#RRGGBBAA`.

| Mode         | Canvas / sidebar / activity     | Base / raised / sunken / composer / user  | Primary / secondary / tertiary text | Default / subtle / strong border | Accent fill / hover / text / focus  |
| ------------ | ------------------------------- | ----------------------------------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| light normal | `#f5f5f7/#f0f0f2/#ebebef`       | `#fff/#fff/#f5f5f7/#fff/#f0f0f2`          | `#1d1d1f/#5a5a60/#68686c`           | `#0000006b/#00000012/#68686c`    | `#0071e3/#0071e3/#0056ae/#0071e3`   |
| light high   | same Direction A light surfaces | same Direction A light surfaces           | `#1d1d1f/#3a3a3c/#55555c`           | `#00000080/#0000002e/#55555c`    | same Direction A light accent roles |
| dark normal  | `#1d1d1f/#1a1a1c/#17171a`       | `#232325/#272729/#1a1a1c/#272729/#2c2c2f` | `#f5f5f7/#bcbcc1/#a6a6aa`           | `#ffffff5c/#ffffff14/#a6a6aa`    | `#2077c9/#2076c7/#89b7e2/#89b7e2`   |
| dark high    | same Direction A dark surfaces  | same Direction A dark surfaces            | `#f5f5f7/#dcdce0/#bdbdc2`           | `#ffffff80/#ffffff38/#bdbdc2`    | same Direction A dark accent roles  |

- The prototype's 35%/50% translucent focus rings composite to only about
  1.62:1/2.29:1 on their carrying surfaces. The semantic focus token therefore
  uses the v17 opaque light accent `#0071e3` and corrected dark accent-text
  `#89b7e2`; both exceed 3:1 without widening the Skin v1 schema.
- The prototype's decorative 12%/16% border cannot carry the Probe's required
  boundary. `border.default` uses the values above (at least 3:1), while
  `border.subtle` retains the decorative raw alpha and is explicitly not valid
  as a sole required boundary. Strong border follows the mode's tertiary ink.
- Light status fills are success/warning/danger/info
  `#23843b/#b25000/#d70015/#0071e3`; dark fills are
  `#30d158/#ffd60a/#ff453a/#2077c9`. Independent tests cover their on-color
  pairs (including dark danger on `#1d1d1f`), solid boundaries, and diff text
  roles. Light inverse text is the Direction A `#f5f5f7`, not generic white.
- Status solid roles are fills/boundaries and status subtle roles are
  backgrounds; they are not an accessible colored-small-text pair. The v17
  prototype instead has separate `success-text`, `warning-text`, `danger-text`,
  and accent-text roles, which frozen Skin v1 cannot express. CL2 must use
  `text.primary` plus a redundant label for colored status text or propose a
  separately reviewed, finite status-text contract extension; CL1A does not
  widen the schema or lower the 4.5:1 small-text threshold.
- Terminal foreground/background is `#e8e8ed/#1d1d1f` in light and
  `#e8e8ed/#141416` in dark. Diff backgrounds retain the page prototype alpha;
  diff text uses the components v17 contrast-corrected text roles.
- Static card/surface shadows are `none`. Existing trusted `raised` and
  `overlay` IDs serialize with the current light/dark mode: composer
  `0 10px 36px #0000002e/#00000066`; overlay light
  `0 12px 40px #00000029, 0 2px 8px #0000000f` and dark
  `0 12px 40px #00000080, 0 2px 8px #0000004d`. No arbitrary shadow string or
  third-party CSS surface was added.
- The six optional safe tokens (overlay scrim, selection background/text,
  pill radius, overlay shadow, disabled opacity) are explicit in every mode;
  overlay scrim is the deterministic 32% black `#00000052`, and the built-in
  skin's validated fallback list is empty. Third-party fallback behavior
  remains the CL0A contract.
- Gallery exposes independent skin, light/dark, and normal/high controls,
  renders all 74 values from `getComputedStyle` with provenance
  `@artemis/theme-artemis/theme.css`, and retains the CL0B Probe across all
  eight Gallery vertices. The test matrix verifies all three pressed-button
  groups at each initialized vertex, all 12 cube edges as single-axis changes,
  and the Probe node, input state, React event-order state, focus, selection,
  anatomy, and ARIA throughout the round trip. This is the merged Gallery/jsdom
  evidence. A working-tree in-app Browser smoke also traversed the eight
  vertices with all 74 computed values resolved, preserved the same Probe state,
  and produced no warning or error console entries; reviewed-SHA Browser
  evidence remains required. Electron is N/A because CL1A adds no Desktop
  consumer.

## CL1B Desktop resolver merged evidence

CL1B installs Direction A as a production renderer dependency without
migrating a component or surface. The production registry is exactly
`com.artemis.default`; the first React render waits for its complete 74-token
light/dark normal snapshot. Skin selection changes only `<html>`
skin/theme/contrast
attributes. Existing `data-theme` behavior remains system-delete and
explicit-light/dark, with a live system media bridge and idempotent listener
cleanup. No skin state, install surface, persistence, Protocol/preload/API,
Browser guest path, main native theme, window background, or titlebar path is
added.

The dedicated `verify:desktop-skin` renderer uses compile-time aliases and a
temporary preload probe; neither is a production runtime flag or packaged
hook. Its real Electron run preserves one focused, controlled Environment
portal input and its value/selection; the portal; active Terminal; xterm root,
screen, rows, and contents; and one native PTY open across default → synthetic
stress → default and complete fallback cases. It verifies all
74 computed variables and an empty Renderer warning/error capture. The smoke
restores the standard build and scans standard renderer/main artifacts plus a
real macOS app's `app.asar`, `app.asar.unpacked`, and extra resources for zero
stress/Gallery/hook markers. Its screenshots can remain pixel-identical here:
legacy Desktop selectors do not consume these tokens until CL2/MIG work.

This is host/resolver proof, not a production visual-migration claim. CL2 owns
foundation components, and MIG1-MIG6 own Desktop selector adoption and visual
evidence.

## CL1C conformance merged evidence

CL1C adds system high-contrast resolution using `prefers-contrast: more` and
forced colors, plus explicit normal/high host transitions, without adding a
user-facing skin or contrast preference. The Gallery's default/stress,
light/dark, normal/high cube is crossed with LTR/RTL, 100%/200%, and
full/reduced motion for 64 exact runtime vertices. The same Probe node, state,
focus, selection, anatomy, ARIA, and event order must survive the round trip.
Linux, macOS, and Windows CI run that Gallery contract.

The clean exact-head Electron verifier traverses those 64 vertices using a real
Desktop Environment portal at 100% and the real Composer textarea when 200%
responsive layout hides the branch control. The chosen focus/value/selection
anchor is preserved through each environment's eight skin/theme/contrast modes;
the original Composer and xterm nodes remain fixed across the full traversal;
the synthetic `Artemis>` prompt stays present and the native PTY count remains
one. It then separately
exercises unknown, unavailable, unsupported,
load-failed, and default-fatal paths and expands production artifact rejection
to every temporary fallback marker. This remains governance and host proof: no
production component or surface selector has migrated, and cross-platform
Gallery CI is not native Windows/Linux Electron evidence.

## CL2A Action/Icon merged evidence

CL2A adds the public `@artemis/ui/actions` subpath with `Button`, `IconButton`,
`Icon`, `Badge`, and `Status`. Its frozen contract covers stable anatomy,
primary/secondary/quiet/danger variants, compact/comfortable controls,
xs/sm/base/lg/xl icons, five finite tones, state priority, native disabled and
default non-submit semantics, opt-in live status, required perceptible action
names, Label-in-Name enforcement for text buttons, RTL inheritance, and reduced
motion. The public contract includes an exact validator and a frozen
disabled > loading > error > selected > ready priority. Loading, error, and selected states
include visible non-color indicators. Status text stays
`color.text.primary`; tone is carried by a redundant dot and subtle background,
so Skin v1 is not widened with inaccessible colored-small-text roles.

The private Gallery renders both control sizes, every Button variant, every
IconButton variant × state × size combination, all five icon sizes, all five
Badge and Status tones, long text, and an explicit live status. Six real behavior
runners raise the matrix from 8 to 14 cases per skin (28 executions) while the
64-vertex traversal preserves the original Probe plus the same Action and
Status nodes, anatomy, state, variant, tone, and ARIA. The public structural CSS
continues to have an exact selector/property/value allowlist; its consumed token
set must equal the union of the Probe and Action contracts, while the fixed
`2px solid Highlight` focus floor remains outside skin control.

Desktop consumes the public package through a thin `GoalBar` adapter. Its
legacy form reset is isolated in `artemis.reset`, so it cannot override the
public `artemis.ui` background, border, color, typography, or fixed focus floor. Protocol
status-to-tone mapping remains in Desktop, while the main edit action, all
icon-only actions, status badge, progress status, and five-size icon wrapper are
owned by `@artemis/ui`. The Goal parity driver now verifies 105 sandboxed real
Electron cases in three bounded, disjoint shards across six Goal states, two
locales, light/dark, two widths, two zoom levels, eight editor states, and one
native reduced-motion press. Every case retains a fresh user-data directory and
independent Electron launch. Concurrent cases do not claim the OS-global
keyboard focus; after all three shards exit, one exclusive real Electron launch
uses fresh user data to prove the active element and fixed focus outline. The
final manifest requires both phases and rejects missing or duplicate case
indexes, shard HEAD or launch-mode disagreement, duplicate case identifiers,
focus inside a concurrent shard, or a missing or drifted exclusive focus probe.
It records the exact candidate HEAD and launch mode, has no `--no-sandbox`
fallback, and checks screenshots, accessibility, action ordering, 28px
controls, 14px icons, shared component identities, finite state/variant/tone
attributes, resolved background/border/color/font, the fixed focus outline,
plus 30 IconButton variant × state × size geometry probes with centered icons
and contained state indicators. This is one migrated production consumer; CL2B
and CL2C still own their distinct field and tab consumers.

The JavaScript subpath is independently bundled from an installed tarball: a
Button-only entry excludes IconButton, Badge, and Status implementation markers.
The public `styles.css` is intentionally one structural CSS aggregator and is
not component-tree-shaken; consumers import that whole audited stylesheet.
Neither the package nor Gallery imports Protocol, provider/settings types,
Electron/Node APIs, private Gallery state, or skin-specific structural branches.

CL2A merged through PR #135 at
`f0834dd48cf7fcbe556fca6530359cea52436e13`.

## CL2B Field/Select/Checkbox/Switch merged evidence

CL2B adds the public `@artemis/ui/forms` subpath with `TextField`,
`SearchField`, `Select`, `Checkbox`, and `Switch`. Its frozen, fail-closed
contract defines exact anatomy, compact/comfortable sizes, visible/hidden
labels, disabled/error/read-only/open/checked priorities, required perceptible
names, native input semantics, and controlled/uncontrolled boundaries that
reject dual props or mode drift. Text fields intentionally expose only the
finite `text`/`email`/`password`/`url`/`number` set. Existing native date and
file consumers remain native until a later stage has a real abstraction
consumer; CL2B does not create speculative date/file wrappers.

The controlled generic Select owns one non-portal listbox, disabled options,
normalized substring/ordered-fuzzy search, Arrow/Home/End navigation,
Enter/Space selection, Escape focus restoration, outside dismissal, and IME
composition protection. Closing clears the search so reopening always restores
the complete option set. Checkbox and Switch keep native checkbox inputs;
Switch adds `role="switch"`. Error text is described by, but not nested in, the
label so it cannot contaminate the accessible name. Fixed focus-visible styles,
RTL switch movement, long text, disabled/error redundancy, and reduced motion
remain structural CSS outside skin control.

The private Gallery renders field/search types, all states and sizes, searchable
Select with disabled/error/no-result paths, native Checkbox/Switch combinations,
long text, RTL, IME, and controlled event evidence. Four new behavior runners
raise the exact matrix from 14 to 18 cases per skin (36 executions), while the
64-vertex default/stress traversal preserves form anatomy, ARIA, state, values,
checked state, selection, focus, event order, direction, zoom, and motion.
Exact CSS and mutable-token allowlists, 25 contract/CSS negative cases, 23 safe
boundary cases, and 113 rejected boundary violations stay fail-closed.

Desktop consumes the public controls through seven real surfaces: Archive uses
`SearchField`; Settings Built-in uses `TextField` plus the public Select through
a thin `CodexSelect` compatibility adapter; Settings Custom uses `Checkbox`;
Resource Center uses `Switch`; Composer, MCP Editor, and Review use that public
Select adapter. Settings and MCP keep the comfortable size, while Composer and
Review explicitly keep compact geometry. Desktop-owned external layout restores
Composer right alignment, Review left alignment and compact toolbar treatment,
and menu layering without adding private component anatomy. Model labels include
the stable provider/model ID so perceptibly duplicate display names remain
unambiguous. The former private Select implementation and private
Search/Switch/Checkbox structural CSS are removed.

The production Electron verifier runs all seven surfaces in light and dark with
fresh isolated user data: 14 cases and 288 assertions cover screenshots,
positive geometry, required public parts, resolved semantic tokens,
focus-visible evidence, controlled Search/Checkbox updates, Select IME
preservation and one keyboard commit, native checkbox/switch semantics, zero
portals, empty accessibility findings, and no local-path leakage. Focus evidence
records both `BrowserWindow.isFocused()` and `document.hasFocus()`: a focused
document must retain the target `document.activeElement` plus its visible public
outline, while an automation session whose OS refuses foreground activation must
report both window and document focus as false and retain a keyboard-focusable
target. This
keeps the CI boundary explicit instead of claiming a focus ring the host cannot
render. Composer, MCP Editor, and Review additionally use DevTools-protocol Tab
and ArrowDown events to keyboard-open the real menu, retain the same Select root,
stay inside the viewport, preserve their required alignment, and resolve at
`z-index: 80`. The verifier has no
`--no-sandbox` fallback and records an explicit renderer-sandbox assertion. Root
Linux tests do not launch Electron; the existing macOS Desktop-skin CI job owns
this production Electron gate. The Resource and MCP fixtures are disabled
synthetic configurations, so they perform zero spawn and zero dial-out.

The installed-tarball consumer verifies all five runtime exports and declarations,
SSR output, the frozen contract, and a TextField-only bundle that excludes the
SearchField, Select, Checkbox, and Switch implementation markers. Neither the
package nor Gallery imports Protocol, provider/settings types, Electron/Node
APIs, private Gallery state, or skin-specific structural branches.

CL2B merged through PR #136 at
`6fbbe14e9f34d3f8edd2a4cb6b37f92a6c695770`.

## CL2C Tabs/Segmented candidate evidence

CL2C adds the public `@artemis/ui/navigation` subpath with `Tabs` and
`SegmentedControl`. Its frozen, fail-closed contract defines exact anatomy,
compact/comfortable sizes, required perceptible group and option labels,
unique values, explicit Tabs `id`/`panelId` relations, disabled-option rules,
one disjoint ID namespace per Tabs instance, and controlled/uncontrolled
boundaries that reject dual props or mode drift.
Tabs use the tablist/tab pattern with one selected tab, roving tab stop,
automatic activation, Arrow/Home/End movement, disabled-item skip and wrap,
RTL-aware horizontal arrows, and IME protection. SegmentedControl deliberately
keeps ordinary native buttons in the Tab order with `aria-pressed`; it does not
masquerade as a tablist or radio group.

The private Gallery renders controlled and uncontrolled examples, both sizes,
long labels, disabled items, and RTL for both components. Two navigation
behavior runners raise the exact matrix from 18 to 20 cases per skin (40
executions), while the 64-vertex default/stress traversal preserves navigation
roots and parts, selected state, tab stop, focus, ARIA relations, direction,
zoom, and motion. The installed-tarball consumer checks runtime exports,
declarations, SSR output, the frozen contract, and a Tabs-only bundle that
excludes the SegmentedControl implementation marker. Exact structural CSS and
mutable-token allowlists remain fail-closed. The 64-vertex test retains every
assertion with a 40-second cross-platform budget; its Windows runtime crossed
the former 20-second default after CL2C added stable relationship checks.

Desktop consumes the public Tabs in Token Usage and the public compact
SegmentedControl in both Workspace Editor and Markdown Reader rich/source
switches. The former private anatomy and structural CSS are removed; Desktop
retains only surrounding page layout. Token Usage adds explicit tab/panel IDs
and keeps all three labelled `tabpanel` nodes stable, with only the selected
panel exposed, without changing its daily, weekly, or cumulative data behavior.
Gallery does the same for controlled, RTL, and disabled examples and verifies
both directions of every `aria-controls`/`aria-labelledby` relationship.

The production Electron verifier uses six fresh, isolated light/dark cases
across those three real consumers. Its 174 assertions cover screenshots,
strict renderer sandboxing, exact public parts and roles, selected-state and
panel relations, fixed focus-visible evidence, semantic computed styles,
one callback per activation, node stability, and zero accessibility findings.
Keyboard interaction is sent through the DevTools protocol: Tab plus
ArrowRight selects the next Token Usage tab, while Tab plus Space selects each
real rich/source segment. The fixtures use only synthetic local data, perform
no provider request or dial-out, and expose no local paths. The report records
and rechecks its exact candidate/completed Git SHA, requires a clean worktree,
asserts the sandboxed preload and context-isolation state plus the absence of
main-world Node globals, and requires an empty renderer warning/error capture. The in-app
Browser also exercised Gallery tab arrows, state preservation, dark/stress
styling, and an empty warning/error console; native Space activation is
established by the production Electron matrix rather than the Browser
automation wrapper.

CL2C merged through PR #137 at
`5593e7b161167d6d14b0c733b387a3caecd819da`.

## CL3 Feedback/Overlay/Layout candidate evidence

CL3 adds public `@artemis/ui/feedback` and `@artemis/ui/layout` subpaths.
Feedback owns Tooltip, Popover, Dialog, ConfirmationDialog, Toast,
ToastViewport, InlineNotice, EmptyState, LoadingState, and ErrorState. Layout
owns Toolbar, ListRow, PanelHeader, ScrollArea, and a controlled-only
SplitPane. Frozen validators cover exact anatomy, finite states and tones,
accessible naming, logical placement, controlled ownership, focus entry and
return, close policy, viewport clamping, separator values, keyboard intent,
RTL, and reduced motion. SplitPane does not persist size or import Workspace
business state.

Gallery raises the same default/stress matrix from 20 to 25 cases per skin and
keeps the 64 runtime vertices. The added runners cover feedback and layout
anatomy, Dialog/Popover focus and close behavior, portal geometry, and
SplitPane pointer/keyboard callbacks. The public stylesheet and installed
tarball verifier include both new subpaths, their declarations and SSR output,
their exact mutable-token union, and isolated tree-shaking checks.

Desktop now consumes the public Dialog and PanelHeader in Settings, Popover in
Environment PR checks, Toast and pending-approval PanelHeader in App, and
InlineNotice/EmptyState/LoadingState in Resource Center. Existing unrelated
feature dialogs and menus are not silently widened into CL3; Settings model
result/delete overlays are migrated with the parent surface to preserve native
top-layer stacking and focus return. The production Electron gate defines six
fresh isolated cases spanning Settings Dialog,
Environment Popover and approval PanelHeader, and Resource Center empty/loading
states across light/dark, RTL, reduced motion, narrow width, and 200% zoom. It
requires native modal focus close/return/reopen behavior, portal ownership,
public anatomy, viewport containment, semantic computed styles, clean console
and accessibility audits, strict sandboxing, screenshots, and exact clean HEAD.

CL3 merged through PR #138 at
`f6c1a361015a001e7fc1ba92d76bf1fc1e705e44`.

## CL4 Artemis pattern merged evidence

CL4 adds the public `@artemis/ui/patterns` subpath for RunModeControl,
ApprovalCard, ToolActivity, TaskPlan, ContextUsage, UserInput, AgentActivity,
AgentTeamSummary, TurnStatus, and ResultDisclosure. The package owns only
presentational anatomy, finite visual states, accessibility, and controlled
disclosures. It imports no Protocol, Electron, or Node API and does not parse
raw Pi events, choose approval scope or order, localize copy, persist state, or
format tool data.

Gallery raises the same default/stress matrix from 25 to 29 cases per skin.
The added runners cover public anatomy, pending/resolved/error/stale/disabled/
timeout states, controlled interactions, long content, and RTL. Exact contract
and CSS-token verification, installed-tarball consumption, SSR output,
tree-shaking, and the UI boundary fixtures include the new public subpath.

Desktop adapters retain Protocol and localization ownership for the three real
CL4 consumers: pending approval actions preserve deny, project, session, once
order; grouped tool activity preserves summary/status/detail formatting; and
Task Plan preserves ordered steps, progress, hover intent, keyboard/outside
close, and completed auto-dismiss behavior. The existing production feedback
matrix continues to exercise the pending approval card on an exact clean HEAD;
the broader CL4 component matrix remains Gallery-first as required by the
sequence.

CL4 merged through PR #139 at
`44634b9e42525ee61ec047d457a48a7b53063ad8`.

## MIG1 reference-slice candidate evidence

MIG1 adds the public `@artemis/ui/surfaces` subpath for ApplicationShell,
ApplicationShellResizer, ActivityBar, ActivityBarItem, NavigationSidebar, and
ComposerSurface. The frozen contracts keep App state, navigation, sidebar
size, resize events, Composer actions, approval policy, persistence, and
Protocol ownership in Desktop. Skins may change only the declared semantic
tokens; they cannot change surface anatomy, state, events, focus behavior, or
mount identity.

Desktop consumes these surfaces for the real App shell, Activity Bar, project
and task Sidebar, and Composer. The workspace header consumes the public
Toolbar, while pending Approval continues to use ApprovalCard and resolved and
grouped Approval now use ResultDisclosure. Existing callbacks, ordering,
drag/drop, keyboard resize, project-tree behavior, approval scopes, attachment
actions, send behavior, and shortcuts remain in the Desktop adapter.

Gallery raises the default/stress conformance matrix from 29 to 32 cases per
skin and preserves the same 64 runtime vertices. The new cases cover surface
anatomy, controlled events, long content, and RTL. The exact public contract,
per-family CSS token set, selector/property/value allowlist, reduced motion,
installed subpath resolution, boundary checks, and negative fixtures remain
fail-closed.

The production Electron gates add resolved and grouped Approval states to the
existing feedback matrix and extend the Desktop skin traversal with stable
surface identity, exact 935/943/949-pixel content widths, 1440×900 Sidebar and
Dock toggles, the timeline/Dock scrollbar boundary, Environment overlay content
avoidance, semantic computed styles, 200% zoom, RTL, and no per-character
wrapping of model, approval, or send controls. Final evidence must record a
clean exact candidate HEAD; build, unit, static conformance, or screenshots by
themselves are not that proof.

The implementation/evidence head `6a5aef6974cacc5c5fe025671bcdc9b3f80a435c`
passes the Desktop skin verifier on a real strict-sandbox Electron launch. The
run traverses 64 production vertices, records the exact 935/943/949-pixel
Conversation content widths, exercises the 1440x900 Sidebar, Dock, and
Environment geometry, and scans the packaged macOS arm64 `app.asar` without a
finding. Its audit SHA-256 is
`1895967b5f01460bbea1833fdb42411dc37d4364942dcf7fd3a7f8aacc807bbb`.
The implementation-era feedback run covers eight production cases and 177
assertions, including pending, resolved, and grouped Approval at 200% zoom and
RTL. Resolved and grouped checks first expand the completed turn through the
same public disclosure path a user follows, then prove the title is visible
and the final item is scroll-reachable; they do not substitute hidden-node
geometry or an unrelated absolute-scroll-end condition for reachability.

A same-state prototype/current approval comparison and the 1440x900 reference
slice were inspected together for cropping, padding, typography, borders, and
control wrapping. The current slice preserves the source hierarchy and keeps
all primary controls reachable without per-character wrapping. The final
documentation-only PR head must still rerun the complete root test, typecheck,
build, feedback, and Desktop skin gates. Those exact-head results belong in the
PR evidence because adding the resulting HEAD to this tracked ledger would
create a self-referential commit.

MIG1 merged through PR #140 at
`db17c67544df5c04e5f667a810ca1d89fb172dcb`.

## MIG2 Conversation and Timeline candidate evidence

MIG2 adds the public `@artemis/ui/conversation` subpath for
ConversationSurface, TimelineViewport, TimelineSurface, TimelineTurn,
ConversationMessage, ConversationEmptyState, TurnExecutionDisclosure,
TurnChangeSummary, QueuedMessageGroup, and QueuedMessageItem. Their frozen
contracts own presentational anatomy, finite visual state, accessible landmark
names, logical-direction geometry, and long-content safety. Desktop continues
to own Protocol reduction, turn grouping, scroll snapshots and pinning, copy and
edit callbacks, disclosure content, queue mutations, UserInput resolution,
child-agent activation, localization, and error recovery.

The real Desktop timeline now consumes those public components for user,
assistant, and steered messages; completed execution disclosure; file-change
summary; empty, running, failed, cancelled, blocked, and queued states; single
and multi-question UserInput frames; and queued follow-ups. Thinking parts
remain deliberately hidden. AgentActivity uses a native button only when the
Desktop adapter supplies activation, while the advanced UserInput adapters keep
their existing listbox, roving focus, Other input, timeout, IME, and retry
behavior inside the shared frame.

Gallery raises the default/stress matrix from 32 to 36 cases per skin. Its four
new cases cover full conversation anatomy, state combinations, controlled
events, long content, and RTL. Installed-package consumption verifies the new
subpath, SSR output, declarations, and ConversationMessage tree-shaking. The
skin verifier keeps an exact selector/property/value allowlist and exact
per-family token set, so a skin cannot alter anatomy, scrolling, actions, or
runtime ownership.

The dedicated production Electron gate runs four isolated strict-sandbox cases:
a rich light/LTR timeline, the same rich state at dark/RTL/200% zoom with
reduced motion, an interrupted failure, and an empty conversation. It checks
native disclosure and AgentActivity activation, keyboard-visible message
actions and UserInput focus, completed/cancelled/running turn states and
completed/failed/running tool states, pinned scroll after disclosure resize,
vertical scrollbar ownership, long unbroken content, logical user-message
alignment, zero unintended horizontal overflow, hidden Thinking content,
accessible landmarks, renderer security, console output, and private-path
leaks. Exact candidate-head results are recorded in PR evidence because adding
that resulting HEAD to this tracked ledger would create a self-reference.

MIG2 merged through PR #141 at
`a9dd2d4b4e0bda75ab4721399a244e29e5e36980`.

## MIG3A Workspace and Dock candidate evidence

MIG3A adds the public `@artemis/ui/workspace` subpath for WorkspaceDock,
WorkspaceDockResizer, WorkspaceTabBar, WorkspaceTab, WorkspaceTabPane,
WorkspaceLauncher, WorkspaceLauncherAction, WorkspaceEditorToolbar,
WorkspaceFileHeader, WorkspaceFileLayout, WorkspaceFileTree,
WorkspaceFileTreeRow, WorkspaceSourceEditor, WorkspacePreview, and
WorkspaceContentState. The package owns presentational anatomy, finite visual
states, accessible roles, focus floors, tokenized layout, and bounded geometry
validation. Desktop continues to own tab identity and reduction, focus transfer,
resize callbacks and persistence, project/file IPC, syntax tokenization, draft
state, save effects and errors, save-shortcut and IME guards, image resolution,
localization, and permission decisions.

The real Desktop Dock, tabs, launcher, file tree, source editor, Markdown
source/preview toggle, standalone Markdown reader, binary read-only state, and
save toolbar now consume the public components. The migration preserves the
62% default Dock presentation, compact and narrow responsive geometry, animated
open/close visibility, transition-free live resizing, exact pixel separator
ARIA, mouse and Arrow/Home/End resize behavior, tab roving focus and close focus
transfer, Meta/Ctrl+S with IME guard, dirty/saving/saved/error states, the
250,000-character syntax-highlight limit without invoking the tokenizer above
that threshold, and accessible missing-image fallbacks. Browser and Terminal
remain outside this phase.

Gallery raises the default/stress conformance matrix from 36 to 40 cases per
skin while preserving the same 64 runtime vertices. Its four Workspace cases
cover anatomy, finite states, controlled events, long content, RTL, disabled
and read-only surfaces, loading/error states, tabs, files, Markdown, and Dock
geometry. The exact public contract, package tarball/declaration/SSR consumer,
Workspace tree-shaking, selector/property/value allowlist, per-family CSS token
set, reduced motion, boundary tests, and negative fixtures remain fail-closed.

The dedicated production Electron gates use only the built renderer and a
single strict-sandbox launch per case. The Markdown matrix covers light/dark
opening, dirty state, Meta+S saving, save failure, production binary read-only,
missing-image fallback, Rich text/Source switching, and a source file above the
highlight threshold. The Dock matrix covers the four-action empty launcher,
two closable tabs, roving selection, focus transfer after close, real mouse
drag, Arrow/Home/End resizing, exact pixel separator ARIA, open/closed/reopened
states, conversation minimum width, scrollbar boundary ownership, and dark
200% zoom, plus mirrored pointer and Arrow behavior in an Arabic RTL case. Both
verifiers reject a dirty worktree or an unexpected candidate SHA. Exact
candidate-head results belong in PR evidence because writing the resulting SHA
into this tracked ledger would create a self-reference.

MIG3A merged through PR #142 at
`6fa4887c8850f3d7e21af87bf6b9b705a6b18e6e`.

## MIG3B workflow surfaces candidate evidence

MIG3B adds the public `@artemis/ui/workflow` subpath for ReviewSurface,
ReviewToolbar, ReviewWorkspace, ReviewDiffReader, ReviewFileSidebar,
ReviewState, ReviewDiff, ReviewDiffHeader, ReviewDiffHunk, ReviewDiffLines,
ReviewDiffLine,
EnvironmentControl, EnvironmentTrigger, EnvironmentPanelSurface,
EnvironmentSection, GoalEditorSurface, GoalEditorInput, GoalEditorFooter,
SourcesSurface, SourcesScroll, SourcesState, SourceEntry, SourceEntryButton,
SourceEntryIcon, and SourceEntryBody. The frozen contract owns
presentational anatomy, finite visual states, accessible landmark and control
names, logical-direction geometry, reduced-motion behavior, long-content
safety, and the exact semantic-token allowlist. Callers continue to own Git
and review mutations, goal persistence and IME policy, source loading and
preview effects, Environment data and permissions, localization, and all IPC.

The real Desktop Review/Diff reader, Environment trigger/panel/sections, Goal
editor, and Sources workspace consume these public surfaces without moving raw
Pi events, Git operations, filesystem calls, or permission decisions into the
renderer package. Source-image entries use an explicitly named public button;
Review keeps immutable turn-diff data and caller-owned staging, reverting, and
comments; Environment keeps its existing Git/PR/agent/source behavior and
popover focus rules; Goal keeps its existing dirty/saving/saved/stale/error
lifecycle; and Sources keeps image-preview and external-link behavior.

Gallery raises the default/stress conformance matrix from 40 to 45 cases per
skin while preserving the same 64 runtime vertices. Its five workflow cases
cover exact anatomy, loading/empty/error/dirty/stale states, controlled events,
permission ownership, long RTL content, and overlay geometry. Installed-package
consumption verifies the new subpath, declarations, SSR output, exact contract,
and package boundaries. The skin verifier adds an exact workflow selector,
property, value, and per-family token allowlist; negative fixtures remain
fail-closed.

The dedicated production Electron gate runs nine isolated strict-sandbox
cases. It verifies public Review/Diff anatomy on a persisted immutable turn
diff at dark/RTL/200% zoom, responsive reader/sidebar separation, public Goal
dirty state, public Sources image entry and labelled preview, Environment
panel and trigger anatomy, in-viewport PR-check overlay geometry, all five
real check-row states plus the empty summary state, Dock coexistence, wide and
narrow layout behavior, renderer accessibility, and startup evidence. Static
prototype, Gallery, and Electron results remain separate evidence: no combined
prototype-versus-runtime pixel comparison or cross-platform native acceptance
is claimed by this phase.

The first consolidated independent review of PR #143 requested one revision
batch: production Diff lines had lost their visible `+`/`−` markers, the
RTL/200% Dock and Review could collapse to 86 px while the geometry gate still
passed, and the Environment trigger did not identify its named dialog. The
implementation revision now renders caller-independent non-color Diff markers,
switches the narrow Dock to a full-width overlay with a stacked Review reader
and file list, requires `aria-controls`/`id` linkage in the public Environment
API, and makes every Electron case fail closed on reported accessibility
issues. The rebuilt nine-case Electron run proves a 413 px Dock, Review root,
toolbar, reader, and file list at RTL/200%, visible addition/deletion markers,
and the named-dialog relationship. Root tests (Desktop 1,217 passed/5 skipped),
typecheck, production build, format, exact skin/CSS governance, package
consumer, Gallery isolation, and boundary suites pass locally. The same sole
Reviewer approved exact implementation head
`61de3d996cd8a4f899786b5a14a52633be405d6a`. A newly published production audit
advisory then required lockfile-only transitive updates to `fast-uri` 3.1.7,
`@xmldom/xmldom` 0.9.12, and `qs` 6.16.0; `npm audit --omit=dev
--audit-level=high` reports zero vulnerabilities. Per the final-head workflow,
the 1.4.55 manifests/README and this automated security update proceeded through
fresh CI and automated comments without another Validator/Reviewer pass. PR
#143 merged at `ad28231944c80a52449a6755d3763e19fce33450`.

## MIG4 professional shells candidate evidence

MIG4 adds the public `@artemis/ui/professional` subpath for TerminalSurface,
TerminalHeader, TerminalViewport, TerminalHost, TerminalState, BrowserSurface,
BrowserToolbar, BrowserNavigation, BrowserNavigationButton,
BrowserAddressForm, BrowserAddressInput, BrowserGoButton, BrowserViewport, and
BrowserState. The frozen contract owns presentational anatomy, finite visual
states, accessible landmark and control names, logical-direction layout,
reduced-motion behavior, long-content safety, and the exact semantic-token
allowlist. Callers continue to own PTY process/input/resize/cleanup, webview
navigation/session/security, localization, and all IPC.

The real Desktop Terminal and Browser consume these public shells without
moving process or permission authority into `@artemis/ui`. Gallery raises the
default/stress conformance matrix from 45 to 49 cases per skin while preserving
all 64 runtime vertices. Installed-package consumption verifies the new
subpath, declarations, SSR output, exact contract, generic Browser child
sizing, tree-shaking, and the absence of Desktop-private `.browser-frame`
selectors from public CSS.

The exact-head Desktop skin verifier proves real native PTY input/output,
resize IPC, xterm selection/copy, one close/cleanup, all 64 skin vertices, and
that smoke-only instrumentation is absent from built package artifacts. The
three-case Workspace Dock verifier covers light, dark 200% compact overlay,
and Arabic RTL in strict-sandbox Electron. It drives the real Browser address
form, loading/error transition over a dynamically reserved closed loopback
port, two-document history, back, forward, and reload; verifies isolated
webview security and responsive geometry; and reads guest and host canvas
colors to fail closed below 4.5:1. The approved dark cases compose transparent
guest content with black default text over the Desktop-owned white webview
canvas at 21:1.

The first independent review requested a cross-platform budget for the full
Windows Gallery matrix, deterministic compact-Dock evidence, missing Browser
and Terminal action/effect evidence, and removal of a Desktop-private selector
from public CSS. A subsequent full-resolution screenshot review caught the
dark Browser canvas regression. Both revision rounds were rechecked by the
same sole Reviewer, who approved exact implementation head
`0cce243333af7a6192e35493d9e363e518276da1`. Local root tests, typecheck,
production build, format, package consumer, skin/CSS governance, and boundary
suites pass; the final exact-head Electron matrix records 74 + 44 + 74 = 192
assertions. Required CI passed all six jobs, including native Windows and
macOS Electron runs. Per the final-head workflow, the 1.4.56 manifests, README,
and this ledger update proceeded through fresh CI and automated comments
without another Validator/Reviewer pass. PR #144 merged at
`94d1c0d22ffdfc7ce84a3ef8fb4a4a3429f39913`.

## MIG5A management surfaces candidate evidence

MIG5A moves Settings, Resource Center, and MCP Editor presentation onto the
public `@artemis/ui` management, form, action, notice, overlay, and navigation
contracts while retaining provider credentials, connector authorization,
resource trust, MCP sandbox/network policy, extension trust, and all mutation
authority in Desktop. The public Tabs contract now exposes explicit horizontal
and vertical orientation semantics and orientation-correct keyboard behavior;
inactive tabpanels remain mounted, hidden, and linked bidirectionally for
assistive technology.

The Desktop adapters preserve native `disabled` state throughout Resource and
MCP operations and use same-tick guards for submission and dangerous removal
confirmation. Marketplace and import feedback presents canonical repository
identity, source ownership, complete warnings, unsupported features, and safe
import diagnostics without exposing local source paths. RTL uses logical CSS
properties and direction-aware icon treatment. Synthetic privacy validation
confirmed that a bearer credential exists only in its controlled password
input while open, then disappears without entering unrelated DOM attributes,
serialized markup, console output, or smoke audit JSON.

The sole independent Validator/Reviewer approved exact implementation head
`72f0325b33f5b6d2b0a56624e354a7ce28e7711a` with no blocking findings. Local
root tests report 1511 core passes with 7 skips, while `@artemis/ui` reports 182
passes and Gallery reports 134 passes. Typecheck, production build, format,
public-package consumption, UI boundaries, skin conformance, and Gallery
governance all pass. Exact-head strict-sandbox Electron evidence records
Navigation 6 cases/174 assertions, Form controls 14/288, MCP Editor 26/326, and
Feedback/Layout 8/180 across light, dark, RTL, narrow-width, and 200% cases.
PR #145 passed all six required exact-head CI jobs, including the three-platform
Gallery matrix, Desktop Electron/package boundary, and Windows native sandbox.
Per the final-head workflow, the 1.4.57 manifests, README, and this ledger update
proceeded through fresh CI and automated comments without another
Validator/Reviewer pass. PR #145 merged at
`e855865dec086be24321852999e5917becdc4d00`.

## MIG5B secondary data surfaces candidate evidence

MIG5B moves Archive, Token Usage, and Automation presentation onto public
`@artemis/ui` data, management, form, action, feedback, and overlay contracts.
The reusable `DataSurface`, `DataStat`, and `DataHeatmap` exports remain
React-only presentation: archived-task mutations, token-event IPC and usage
calculation, and automation scheduling, authorization, persistence, and project
identity remain owned by Desktop.

The heatmap exposes each value through a perceptible label and a real
`grid → row → gridcell` hierarchy, retains one roving tab stop, follows LTR/RTL
arrow direction, scrolls only its nearest horizontal viewport, and keeps the
focused cell and tooltip visible at both edges. Its disabled state uses native
disabled controls and suppresses focus, pointer, keyboard, blur, and leave
callbacks. Automation project labels disambiguate duplicate and reserved names
without altering stored IDs, and missing-project edits retain a localized
fallback rather than changing scheduling data.

Smoke fixtures require both smoke mode and the matching secondary-page view,
use isolated user data and synthetic archive, usage, and automation records,
and never enter production persistence. Electron audits verify direct row/cell
ownership, non-color value labels, real bounding rectangles, renderer sandbox
state, console output, horizontal overflow, long localized content, and
Automation status containment instead of relying on component markers alone.

The first independent review requested valid row ownership, non-interactive
disabled semantics, and real RTL/narrow focus and tooltip geometry. The same
sole Validator/Reviewer approved exact implementation head
`1194e2bd0a289cee3c64d9bf36996d56004f8160` after those fixes and a separate
card-smoke self-audit repair, with no remaining blockers. Local root tests
report 1510 core passes with 7 skips, while `@artemis/ui` reports 188 passes and
Gallery reports 142 passes. Typecheck, production build, format, public-package
consumption, UI boundaries, skin conformance, and Gallery governance all pass.
Exact-head strict-sandbox Electron evidence records the secondary-page matrix
at 15 cases/270 assertions and Card/Heatmap at 2/38. Per the final-head workflow,
the 1.4.58 manifests, README, and this ledger update proceed through fresh CI
and automated comments without another Validator/Reviewer pass.

## MIG6 convergence candidate evidence

MIG6 removes only selectors proven unreachable from the production renderer
entry point. A TypeScript AST reachability pass now owns that decision and
recognizes only real `className`, DOM class, and generated-markup sinks. It
checks exact compound class combinations, production ID and data-attribute
consumers, finite runtime class unions, and renderer reachability before CSS
cleanup can be accepted. The candidate removes 65 proven-unused selector
alternatives and replaces 22 hardcoded spacing or border values with existing
Artemis tokens. Fifteen documented mappings register 45 exact runtime or
cross-component class-name sets, including complete task, automation, child
agent, review, syntax, token-usage, Sources, and external-link state domains.
Three necessary public overrides remain exactly allowlisted, including
`!important` state, owner, reason, and evidence: the Composer and Review select
stacking contexts, plus the isolated Browser white canvas.

The convergence gate includes four accepted and thirteen rejected fixtures for
real class sinks, compound selectors, ID/data selectors, finite domains, and
raw/token-only public-component declarations. Raw registrations cannot be
bypassed by adding a token reference to a hardcoded color, dimension, or
unitless stacking value. The performance gate records byte and startup budgets
against merged base `3b02455`; each warm-stage ceiling is derived from the
corresponding merged-base maximum times eight plus 500 ms of cross-runner
jitter. All 27 launch variants
are still measured, but the first post-build launch is now explicitly governed
as a cold start with a 10,000 ms hard maximum. The remaining 26 warm launches
retain their individual derived stage ceilings; at most two may exceed those
ceilings, and no warm timing may exceed 4,000 ms. Empty evidence, three warm
outliers, a five-second warm regression, and a greater-than-ten-second cold
regression remain fail-closed. Implementation checkpoint `2a38040` measured
Desktop CSS at 287,911 bytes, Desktop JavaScript at
1,855,194 bytes, largest Desktop chunk at 853,244 bytes, Gallery CSS at 180,175
bytes, Gallery JavaScript at 355,604 bytes, and public UI CSS at 151,849 bytes.
Its observed startup maxima were 26.4 ms for app start, 80 ms for diagnostics,
87.8 ms for core readiness, 152 ms for the window, 157.8 ms for update setup,
and 290.7 ms for renderer readiness.

The strict-sandbox macOS arm64 checkpoint audit passed a 27-case screenshot
matrix spanning all 14 locales, LTR and RTL, system/light/dark themes,
100/125/150/200 percent zoom, reduced motion, and desktop/narrow viewports. It
also passed Timeline, Composer/feedback, Environment/Diff, Terminal/Browser,
forms, navigation, MCP/Resources, secondary pages, Goal parity, Gallery, public
package consumption, and an arm64 packaged-app inspection with the native PTY
state preserved. Every fixture used isolated synthetic data, required context
isolation with Node integration disabled, and rejected sandbox fallbacks. Root
tests, typecheck, production build, formatting, UI boundaries, skin
conformance, and bundle/startup budgets passed at that checkpoint.

The sole post-PR review examined exact source head `ebe6741` and found six
issues: CI was testing GitHub's synthetic merge SHA, Windows packaging omitted
the native boundary verifier, selector evidence allowed unrelated strings and
partial compounds, explicit light/dark smoke cases did not persist the matching
application preference, startup ceilings were too permissive, and raw override
identity did not include `!important` or mixed token/raw values. Initial CI run
`33750952835` passed its base test/typecheck/build/format jobs, all three Gallery
jobs, and Windows native sandbox verification. Its three visual-convergence
jobs exposed two additional environment assumptions: Windows started at a
1024×768 desktop and macOS runners reported reduced motion during the Dock
animation case. The combined repair pins checkout and expected evidence to the
PR source SHA, configures a 1920×1080 Windows desktop, runs the final Windows
native-package verifier, forces and asserts normal motion for that animation,
persists and observes the requested smoke theme, and closes all six review
findings. Because the repair changes the source head, that one review remains
evidence for `ebe6741` only; no second review will be started.

Repair-head CI run `33756491896` then passed its base job, Windows native
sandbox integration, all three Gallery jobs, and the full macOS arm64
visual-convergence audit. It also confirmed the Windows desktop was actually
1920×1080. macOS x64 and Windows reached the screenshot matrix but exceeded
the first `4× baseline + 500 ms` cold-start ceilings: x64 `update-ready` was
1367.8 ms against 1222 ms, and Windows `renderer-ready` was 2120.7 ms against
1782.8 ms. The follow-up uses `8× baseline + 500 ms`, giving those observations
about 42–45 percent headroom while keeping every derived ceiling below 3.1
seconds; the 5-second regression fixture still fails. No functional, geometry,
theme, or motion failure was reported before those budget stops. The later x64
and Windows workloads, including the final Windows package step, were not
reached and still require fresh CI on the follow-up head.

Follow-up-head CI run `33759335470` confirmed the revised startup budgets on
both slower runners. It passed the base job, Windows native sandbox integration,
all three Gallery jobs, and the complete macOS arm64 visual-convergence audit
in 16 minutes 7 seconds. macOS x64 and Windows both progressed beyond startup
and reached the conversation Timeline. The x64 action-visibility sample caught
opacity `0.96808` during its CSS transition against the required `0.99`; the
Windows message-visibility sample measured `19.5390625` CSS pixels against a
20-pixel boundary at device-pixel ratio 2. The follow-up now polls the actual
action opacity for at most one second and still fails if it never reaches
`0.99`. The geometry assertion retains the 20-CSS-pixel target while tolerating
at most one physical pixel of cross-platform rounding (`19.5` CSS pixels at
DPR 2). Later x64 and Windows workloads, including the final Windows package
step, were not reached and require a fresh run on the new source head.

Timeline-repair CI run `33762336220` passed its base job, Windows native sandbox
integration, all three Gallery jobs, and the full macOS arm64 aggregate. The
macOS x64 run passed every workload through secondary pages, including the
repaired Timeline, but `goal-parity` hit its 360,000 ms aggregate circuit breaker
at 360,007.9 ms. That workload performs 105 isolated Electron launches; the
same exact head completed locally in 227,210.3 ms, and every individual launch
retains its independent 45-second timeout. The follow-up raises only this
workload's aggregate circuit breaker to 600,000 ms and records per-case progress
for any future timeout.

Windows stopped in its screenshot matrix when one `ar-dark-125` launch recorded
`core-state-ready` at 2211.4 ms against the 1345.6 ms stage ceiling. The previous
Windows run had passed the same startup matrix, so the follow-up keeps every
derived ceiling unchanged and permits only one of 27 variants to exceed its
stage ceiling while still requiring that launch to stay below 3065.6 ms. Two
outliers and the five-second regression fixture fail. The Windows build also
showed Gallery CSS at about 185.44 kB versus 180,175 bytes on macOS because its
5,266 tracked source-CSS lines were checked out with CRLF. CSS checkout is now
fixed to LF rather than weakening the 182,000-byte package budget. Windows did
not reach later workloads or its final package step, and x64 did not reach its
last Desktop-skin/package workload; both still require fresh CI.

Cross-platform-policy CI run `33765644502` passed its base job, Windows native
sandbox integration, all three Gallery jobs, and the complete macOS arm64
aggregate in 15 minutes 36 seconds. Windows Gallery built at the same 180.17 kB
as LF platforms, confirming the CSS checkout fix without changing its budget.
macOS x64 stopped when one warm `zh-CN-base` renderer launch measured 3107.7 ms,
42.1 ms above the shared 3065.6 ms hard maximum. Windows recorded its first
post-build `en-base` cold launch at 6724.9 ms for core readiness and 7267.3 ms
for renderer readiness, followed by two sparse warm renderer outliers at
3324.4 ms and 3108.8 ms. Separating the known first cold launch from the warm
population preserves the merged-base-derived warm stage ceilings, bounds the
cold launch at 10 seconds, permits no more than two of 26 warm outliers, and
keeps a 4-second hard maximum on every warm timing. Both slower platforms
stopped in the screenshot matrix, so no later workload or final Windows package
result is claimed from this run.

Commit `f33257c` separates the first post-build cold launch from the 26 warm
launches while preserving the merged-base-derived warm ceilings. Exact-head CI
run `33768726913` passed its base job, Windows native sandbox integration, all
three Gallery jobs, the complete macOS arm64 aggregate, and the complete
Windows x64 aggregate. Windows also built and inspected the final local package
boundary for the first time in this PR. macOS x64 passed every screenshot
variant's semantic locale, direction, theme, zoom, reduced-motion, viewport,
accessibility, console, and renderer-sandbox checks, then stopped because at
least two of the 27 PNG hashes were identical. The prior assertion required
all hashes to be globally unique even when two different locale cases rendered
fixture content with no visible translated text, and it did not identify the
repeated variants.

The first follow-up kept the per-file size gate and every semantic assertion,
recorded all duplicate hash groups with their concrete variant IDs, and required
every same-locale variant to remain visually distinct. Exact-head CI run
`33818824213` then identified the prior hidden duplicate as `ar-base` and
`ar-dark-125`: both cases used Arabic, the resolved dark theme, and the same
1440×900 physical window, while only Electron zoom changed. Both cases already
proved their requested zoom and different zoom-adjusted CSS viewports through
the renderer audit, but macOS x64 normalized their captured pixels to the same
PNG.

The current follow-up therefore requires distinct pixels for same-locale pairs
whose resolved theme or physical window viewport differs. It reports all other
duplicate groups in the manifest and log, while locale, direction, zoom,
reduced motion, and the resulting CSS viewport remain independent runtime
assertions. Focused fixtures accept cross-locale and zoom-only duplicate hashes
but reject identical PNGs across resolved themes or physical viewports. This
keeps each dimension tied to evidence it can actually produce on native runners
instead of treating byte identity as proof for runtime geometry.

The rest of exact-head run `33818824213` completed while that repair was being
prepared. It passed all three Gallery jobs, Windows native sandbox integration,
the complete macOS arm64 aggregate in 17 minutes 4 seconds, and the complete
Windows x64 aggregate plus final local package-boundary inspection in 23 minutes
7 seconds. The base job passed formatting, tests, typecheck, and production
build, but its final `npm audit --omit=dev --audit-level=high` call waited 300
seconds for the npm advisory endpoint and then returned a network timeout with
no audit result. That timeout is neither a vulnerability finding nor an audit
pass; the unchanged audit command must run again in fresh exact-head CI.

Exact-head run `33821282416` then passed the base job, Windows native sandbox
integration, all three Gallery jobs, and the complete macOS arm64 aggregate.
It exposed three independent final-run conditions: the macOS x64 Dock smoke
sampled once during its animation, one Windows warm renderer launch exceeded
the unchanged 4-second hard maximum, and the npm advisory endpoint again
returned no audit report. The repaired Dock smoke now pauses the live Web
Animation, seeks its midpoint, and proves start/midpoint/final geometry. The
production audit now makes at most three 30-second no-retry requests, accepts
only a real audit report, fails immediately on vulnerabilities, and still fails
closed after repeated transport failures.

Exact-head run `33823637536` on `b6bad9b` passed the base job including that
production audit, Windows native integration, all three Gallery jobs, the full
macOS arm64 aggregate, and the full Windows aggregate plus final package
boundary. Its first macOS x64 attempt rejected three warm startup outliers,
including a 4730.1 ms renderer timing against the unchanged 4000 ms hard
maximum. The same-head, same-budget failed-job retry passed the startup matrix
and reached Goal parity, where the serial 105-launch driver completed 94 cases
before its 600,008.6 ms aggregate timeout. Because that second failure
reproduced a runner-capacity limit after the startup matrix rather than a Goal
assertion failure, the follow-up keeps all 105 cases, every 45-second per-case
timeout, and the 600-second aggregate budget, but distributes disjoint cases
across three bounded workers. Each worker writes a separate manifest from its
own throwaway user-data root; the final manifest requires identical candidate
HEADs and complete indexes 0 through 104. A local host run completed all 105
cases in about 97 seconds.

Exact-head CI run `33828873690` on `c2ec144` passed the base job, including a
real production audit report, Windows native sandbox integration, all three
Gallery jobs, the full macOS arm64 aggregate, and the full macOS x64 aggregate.
Windows reached Goal parity and completed the workload in 169,730.3 ms, but the
merged result failed: shard 1 completed all 35 cases while shards 2 and 3 lost
the fixed focus outline on `goal-blocked-en-light-1512-1` and
`goal-blocked-zh-CN-light-1512-1`. Their audits still reported the intended
button as active, but its computed outline style was `none`. Three concurrent
Electron windows cannot simultaneously own Windows' single native keyboard
focus, so per-shard `:focus-visible` assertions were competing with one another.
Windows did not reach its later workload or final package-boundary inspection.

The follow-up retains the complete 105-case matrix, every 45-second per-case
timeout, and the unchanged 600-second aggregate budget. Concurrent shards now
require their focus evidence to be null. Only after all three workers exit, one
exclusive real Electron probe launches case 0 with its own fresh user data and
must prove the active element plus the fixed `2px solid Highlight` floor. The
version 5 merged manifest requires complete indexes 0 through 104 and the
exclusive focus result on the same exact HEAD and sandboxed launch mode; it
fails if a shard requests OS focus or if the probe is absent or drifts. Fresh
exact-clean-head CI remains required.

The final acceptance target is the exact clean 1.4.59 PR head. Its SHA and
generated report paths belong in PR evidence rather than as a self-referential
value in this commit. CI must reproduce the aggregate audit on native macOS
arm64, macOS x64, and Windows x64 runners; Windows must also inspect its final
package. Per the review policy, MIG6 received no separate pre-PR validator and
exactly one review after the PR existed. This local evidence does not establish
the still-pending final repaired-head native results, signing, notarization,
stapling, clean-install/update/rollback behavior, real provider or hardware
behavior, screen-reader acceptance, or soak stability. No release artifact was
downloaded for checksum, ZIP, or DMG verification. SKIN1 has not started.

## Component and surface sequence

| Scope                                                                     | Type               | Owner                     | Consumer                          | Legacy selector/source                           | Target PR | Electron evidence                                            | Status                                                       |
| ------------------------------------------------------------------------- | ------------------ | ------------------------- | --------------------------------- | ------------------------------------------------ | --------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Manifest/token/integrity schemas, registry, validators, public artifacts  | token/package      | `@artemis/theme-contract` | theme packages and Gallery        | scattered root variables                         | CL0A      | N/A: no Desktop dependency or UI change                      | Merged at `244aacf`                                          |
| Public React/CSS boundary                                                 | package            | `@artemis/ui`             | Gallery, later Desktop            | no package boundary                              | CL0A      | N/A: no components or Desktop consumer                       | Merged at `244aacf`                                          |
| Neutral built-in skin data/CSS/integrity artifacts                        | token/package      | `@artemis/theme-artemis`  | Gallery                           | v17 role vocabulary only                         | CL0A      | N/A: no Desktop resolver                                     | Merged at `244aacf`; superseded by CL1A                      |
| Anatomy, states, events, ARIA, focus                                      | component          | `@artemis/ui`             | Gallery harness                   | v17 70 cards                                     | CL0B      | Gallery runtime required; Electron not yet production proof  | Merged at `facb262`                                          |
| Direction A Artemis values                                                | skin               | `@artemis/theme-artemis`  | Gallery and Desktop host          | v17 A light/dark/high                            | CL1A      | Gallery/browser; Desktop first-frame variables in CL1B       | Merged at `3457e0d`                                          |
| Resolver/registry and host attributes                                     | integration        | Desktop renderer glue     | Desktop                           | current `data-theme` bridge                      | CL1B      | Exact-head Electron state/Portal/xterm/package proof         | Merged at `70691d9`                                          |
| Default/stress/fallback conformance                                       | governance         | Gallery + validators      | CI                                | v17 A/B/C stress input                           | CL1C      | 64-vertex Gallery + exact-head Desktop matrix                | Merged at `38e40ae`                                          |
| Action and icon controls                                                  | component          | `@artemis/ui`             | Gallery + GoalBar                 | buttons, icon buttons, badge, status, icon sizes | CL2A      | 105-case sandboxed Goal parity Electron matrix               | Merged at `f0834dd`                                          |
| Field and selection controls                                              | component          | `@artemis/ui`             | Gallery + real Desktop            | field, search, select, checkbox, switch          | CL2B      | 14-case/288-assertion strict-sandbox Electron matrix         | Merged at `6fbbe14`                                          |
| Tabs and segmented controls                                               | component          | `@artemis/ui`             | Gallery + three Desktop consumers | tabs and segmented controls                      | CL2C      | 6-case/174-assertion strict-sandbox Electron matrix          | Merged at `5593e7b`                                          |
| Feedback, overlays, layout primitives                                     | component          | `@artemis/ui`             | Gallery + four Desktop surfaces   | dialog/menu/toast/tabs/tree/splitter/panels      | CL3       | 6-case strict-sandbox Electron matrix                        | Merged at `f6c1a36`                                          |
| Artemis-specific presentational patterns                                  | component          | `@artemis/ui`             | Desktop adapter layer             | Composer, approval, UserInput, activity patterns | CL4       | Gallery cases first                                          | Merged at `44634b9`                                          |
| Reference slice: shell, activity bar, sidebar, header, Composer, Approval | surface            | `@artemis/ui` + Desktop   | users                             | `App.tsx`, renderer `styles.css`                 | MIG1      | Exact-head light/dark/contrast/zoom and state matrix         | Merged at `db17c67`                                          |
| Conversation, Timeline, trusted-AI states                                 | surface            | `@artemis/ui` + Desktop   | users                             | message/timeline/status selectors                | MIG2      | State, scroll, interaction, performance, exact-head Electron | Merged at `a9dd2d4`                                          |
| Workspace, Dock, file/Markdown edit and preview                           | surface            | `@artemis/ui` + Desktop   | users                             | workspace/dock/editor selectors                  | MIG3A     | Tabs, resize, save/error, geometry, exact-head Electron      | Merged at `6fa4887`                                          |
| Review, Diff, Environment, Goal, Sources                                  | surface            | `@artemis/ui` + Desktop   | users                             | review/environment/source selectors              | MIG3B     | State, permission and overlay geometry matrix                | Merged at `ad28231`                                          |
| Terminal and Browser professional shells                                  | surface            | `@artemis/ui` + Desktop   | users                             | terminal/browser shell selectors                 | MIG4      | Native PTY and Browser isolation on each actual platform     | Merged at `94d1c0d`                                          |
| Settings, Resource Center, MCP Editor                                     | surface            | `@artemis/ui` + Desktop   | users                             | feature-local renderer styles                    | MIG5A     | Form, permission, privacy and exact-head Electron matrix     | Merged at `e855865`                                          |
| Archive, Usage, Automation                                                | surface            | `@artemis/ui` + Desktop   | users                             | secondary-page selectors                         | MIG5B     | Real-data, a11y, schedule and exact-head Electron matrix     | Merged at `3b02455` via PR #146                              |
| Convergence and governance cleanup                                        | surface/governance | Desktop + CI              | users/contributors                | remaining proven-unused legacy selectors         | MIG6      | Complete exact-head runtime/performance/platform matrix      | Draft #147; platform repair/CI pending; sole review complete |

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
- CL0B rollback is limited to the public component-contract/conformance
  subpath, Gallery-only stress harness, verification scripts, root command
  wiring, package-consumer proof, and these ledgers. It adds no Desktop
  dependency, resolver, persisted skin selection, or production renderer CSS.
- CL1A rollback is limited to built-in Direction A token values and trusted CSS
  serialization, Gallery-only mode controls/samples/tests, its exact artifact
  allowlist, and these ledgers. It adds no Desktop dependency, resolver,
  persisted selection, protocol, main/preload code, or user-install surface.
- CL1B rollback is limited to the Desktop default registry/resolver/root bridge,
  the public theme dependencies, compile-time smoke verifier and boundaries,
  clean-build entry wiring, and these ledger entries. It adds no persisted
  skin selection, install/discovery/trust flow, Protocol/preload/shared API, or
  component/surface migration.
- CL1C rollback is limited to system contrast resolution, the schema v2
  conformance axes/fallback inventory, Gallery reduced-motion and runtime
  traversal, cross-platform Gallery CI, expanded temporary-marker rejection,
  and exact-head Electron matrix assertions. It adds no component/surface
  migration or user-facing skin/contrast state.
- CL2A rollback is limited to the Action/Icon public subpath and structural
  rules, five new Gallery cases/samples, GoalBar's thin public-component
  adapter, package-consumer tree-shaking proof, Goal parity computed-style
  assertions, and these ledger entries. It does not alter protocol state,
  persistence, IPC/preload, provider/settings types, or Skin v1 data.
- A later PR may depend only on a CL milestone already merged into the latest
  `main`; a Draft PR or stale candidate SHA is not a dependency.
- Stop if a component requires Protocol/Desktop/Electron/Node or
  `window.artemis` inside `@artemis/ui`, if Gallery requires a private source
  import, or if a skin requires selectors/code rather than schema-valid data.
- Stop on missing cases, `NO_RESULT`, empty screenshots, console errors,
  renderer-SHA mismatch, or a sandbox fallback. None may be reclassified as a
  pass.
