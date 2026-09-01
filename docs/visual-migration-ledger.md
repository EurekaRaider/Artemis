# Discussion #76 visual migration ledger

Status: CL2C Tabs/Segmented candidate on merged CL2B base
`6fbbe14e9f34d3f8edd2a4cb6b37f92a6c695770`; CL2B is merged. This
ledger separates static prototype evidence, package/Gallery evidence, and
production Electron evidence. It must not be used to turn a prototype,
Gallery pass, or attribute-only resolver pass into a migrated production
surface.

## Inputs and evidence boundary

- Candidate base: `6fbbe14e9f34d3f8edd2a4cb6b37f92a6c695770` (CL2B merged).
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
  present in this candidate base. CL2C does not copy or modify it.
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
Electron cases across six Goal states, two locales, light/dark, two widths, two
zoom levels, eight editor states, and one native reduced-motion press. It records
the exact candidate HEAD and launch mode, has no `--no-sandbox` fallback, and
checks screenshots, accessibility,
action ordering, 28px controls, 14px icons, shared component identities,
finite state/variant/tone attributes, resolved background/border/color/font,
the fixed focus outline, plus 30 IconButton variant × state × size geometry
probes with centered icons and contained state indicators. This is
one migrated production consumer; CL2B and CL2C still own their distinct field
and tab consumers.

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

## Component and surface sequence

| Scope                                                                    | Type               | Owner                     | Consumer                          | Legacy selector/source                           | Target PR | Electron evidence                                           | Status                                  |
| ------------------------------------------------------------------------ | ------------------ | ------------------------- | --------------------------------- | ------------------------------------------------ | --------- | ----------------------------------------------------------- | --------------------------------------- |
| Manifest/token/integrity schemas, registry, validators, public artifacts | token/package      | `@artemis/theme-contract` | theme packages and Gallery        | scattered root variables                         | CL0A      | N/A: no Desktop dependency or UI change                     | Merged at `244aacf`                     |
| Public React/CSS boundary                                                | package            | `@artemis/ui`             | Gallery, later Desktop            | no package boundary                              | CL0A      | N/A: no components or Desktop consumer                      | Merged at `244aacf`                     |
| Neutral built-in skin data/CSS/integrity artifacts                       | token/package      | `@artemis/theme-artemis`  | Gallery                           | v17 role vocabulary only                         | CL0A      | N/A: no Desktop resolver                                    | Merged at `244aacf`; superseded by CL1A |
| Anatomy, states, events, ARIA, focus                                     | component          | `@artemis/ui`             | Gallery harness                   | v17 70 cards                                     | CL0B      | Gallery runtime required; Electron not yet production proof | Merged at `facb262`                     |
| Direction A Artemis values                                               | skin               | `@artemis/theme-artemis`  | Gallery and Desktop host          | v17 A light/dark/high                            | CL1A      | Gallery/browser; Desktop first-frame variables in CL1B      | Merged at `3457e0d`                     |
| Resolver/registry and host attributes                                    | integration        | Desktop renderer glue     | Desktop                           | current `data-theme` bridge                      | CL1B      | Exact-head Electron state/Portal/xterm/package proof        | Merged at `70691d9`                     |
| Default/stress/fallback conformance                                      | governance         | Gallery + validators      | CI                                | v17 A/B/C stress input                           | CL1C      | 64-vertex Gallery + exact-head Desktop matrix               | Merged at `38e40ae`                     |
| Action and icon controls                                                 | component          | `@artemis/ui`             | Gallery + GoalBar                 | buttons, icon buttons, badge, status, icon sizes | CL2A      | 105-case sandboxed Goal parity Electron matrix              | Merged at `f0834dd`                     |
| Field and selection controls                                             | component          | `@artemis/ui`             | Gallery + real Desktop            | field, search, select, checkbox, switch          | CL2B      | 14-case/288-assertion strict-sandbox Electron matrix        | Merged at `6fbbe14`                     |
| Tabs and segmented controls                                              | component          | `@artemis/ui`             | Gallery + three Desktop consumers | tabs and segmented controls                      | CL2C      | 6-case/174-assertion strict-sandbox Electron matrix         | Candidate                               |
| Feedback, overlays, layout primitives                                    | component          | `@artemis/ui`             | Desktop consumers later           | dialog/menu/toast/tabs/tree/splitter/panels      | CL3       | Gallery cases first                                         | Pending                                 |
| Artemis-specific presentational patterns                                 | component          | `@artemis/ui`             | Desktop adapter layer             | Composer, approval, UserInput, activity patterns | CL4       | Gallery cases first                                         | Pending                                 |
| Shell, activity bar, sidebar, navigation                                 | surface            | Desktop                   | users                             | `App.tsx`, renderer `styles.css`                 | MIG1      | Exact-head light/dark/contrast/zoom matrix                  | Pending                                 |
| Composer and approval surfaces                                           | surface            | Desktop                   | users                             | renderer Composer/approval selectors             | MIG2      | Exact-head interaction + screenshot evidence                | Pending                                 |
| Conversation, timeline, sources, task activity                           | surface            | Desktop                   | users                             | timeline/source selectors                        | MIG3      | Exact-head state and Electron evidence                      | Pending                                 |
| Workspace, Dock, editors, Browser, Terminal                              | surface            | Desktop                   | users                             | workspace/dock/editor selectors                  | MIG4      | Geometry, PTY, Browser boundaries, exact-head Electron      | Pending                                 |
| Review, Environment, Settings, Resource Center, MCP                      | surface            | Desktop                   | users                             | feature-local renderer styles                    | MIG5      | Feature state matrix + exact-head Electron                  | Pending                                 |
| Remaining pages and governance cleanup                                   | surface/governance | Desktop + CI              | users/contributors                | remaining legacy selectors                       | MIG6      | Complete exact-head screenshot/runtime matrix               | Pending                                 |

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
