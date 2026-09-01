# Artemis Skin v1 compatibility ledger

Status: CL3 Feedback/Overlay/Layout candidate on merged CL2C base
`5593e7b161167d6d14b0c733b387a3caecd819da`. This document records what is
enforced now and which runtime behavior remains owned by later serialized
milestones.

## v1 package contract

| Surface           | v1 rule                                                                                                                               | Current evidence                                                  | Owner/status |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------ |
| Schema version    | `schemaVersion` must equal `1`; unknown fields fail                                                                                   | runtime validator + emitted JSON Schema                           | CL0A merged  |
| UI compatibility  | manifest must declare exactly `uiContract: ">=1 <2"`                                                                                  | compatible/incompatible tests                                     | CL0A merged  |
| Manifest identity | reverse-DNS multi-label ID, bounded `name`, semver, `modes`, and fixed token basenames                                                | valid/invalid tests                                               | CL0A merged  |
| Data layout       | Third-party `.artemis-skin`: `manifest.json`, flat token JSON, and `integrity.json`; no user-supplied CSS/code                        | schema, pack, and outside-consumer proof                          | CL0A merged  |
| Color schemes     | manifest `modes` must contain both `light` and `dark`                                                                                 | manifest and mode-completeness validation                         | CL0A merged  |
| Contrast          | `normal` required; `high` and `tokens.contrast.json` are declared together                                                            | manifest/package validation                                       | CL0A merged  |
| Density           | comfortable/compact allowlist; each declared combination needs data                                                                   | capability Cartesian completeness                                 | CL0A merged  |
| Platform          | universal/macos/windows/linux allowlist; each declared combination needs data                                                         | capability Cartesian completeness                                 | CL0A merged  |
| Semantic tokens   | unknown token rejected; every required token present; optional omissions use registered safe fallback                                 | token/document tests                                              | CL0A merged  |
| Token values      | hex colors, bounded numbers with fixed units, font/easing/shadow IDs, fixed weight allowlist                                          | injection/range/field tests                                       | CL0A merged  |
| Generated CSS     | only fixed root data-attribute selectors and `--artemis-*` declarations                                                               | Artemis skin CSS tests                                            | CL0A merged  |
| Code surface      | no arbitrary selector, CSS payload, URL/import, JavaScript, React component, preload, or executable hook in the manifest/token schema | schema shape + boundary tests                                     | CL0A merged  |
| Integrity         | `sha256` only; hashes cover `manifest.json` and every manifest-declared token JSON; unknown/missing files and malformed hashes reject | strict schema, validator, generated hashes, outside recomputation | CL0A merged  |

The JSON Schema artifacts are public exports at
`@artemis/theme-contract/schema/manifest.json` and
`@artemis/theme-contract/schema/tokens.json`, plus
`@artemis/theme-contract/schema/integrity.json`. Runtime validation is still
mandatory; publishing a schema file does not authorize unvalidated data.

The three reusable workspaces remain npm-private. `integrity.json` detects
unexpected changes to package data; it does **not** establish author identity,
trust, signing, provenance, or marketplace safety.
`@artemis/theme-artemis/theme.css` is a trusted build artifact generated from
already validated bundled data; it is not an accepted third-party Skin v1 file
and is deliberately absent from `integrity.json`.

## Built-in and stress coverage

| Case                                          | Expected modes                                                                   | Expected result                                                 | Runtime consumer             | Milestone/status                   |
| --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| Artemis neutral scaffold                      | light/dark × normal/high × comfortable × universal                               | valid; optional omissions reported and filled from the registry | Gallery only                 | CL0A merged; superseded by CL1A    |
| Artemis Direction A                           | same minimum matrix, with frozen v17-aligned values                              | valid; 74 explicit values/mode; zero built-in fallback          | Gallery and Desktop resolver | CL1A merged at `3457e0d`           |
| Synthetic stress skin                         | light/dark × normal/high × compact × universal with extreme allowed token values | valid without changing Probe or Action anatomy, ARIA, or events | Gallery + Desktop verifier   | CL1C merged; CL2A action candidate |
| Missing required token                        | any                                                                              | reject the entire skin                                          | validator                    | CL0A tested                        |
| Unknown token/field                           | any                                                                              | reject the entire skin                                          | validator                    | CL0A tested                        |
| Invalid CSS-like value or out-of-range number | any                                                                              | reject the entire skin                                          | validator                    | CL0A tested                        |
| Unsupported schema/UI contract                | any                                                                              | reject the entire skin                                          | validator                    | CL0A tested                        |
| Missing declared document/mode                | any                                                                              | reject the entire skin                                          | package validator            | CL0A tested                        |
| Optional token omitted                        | any otherwise valid mode                                                         | accept and report registered safe fallback                      | validator                    | CL0A tested                        |
| Entire selected skin invalid/unavailable      | host chooses built-in safe skin before rendering                                 | no partial application                                          | Desktop resolver             | CL1C matrix merged                 |

CL0B added stable `verify:skin-package` and `verify:skin-conformance` gates.
The package gate validates bundled Artemis data and the synthetic fixture,
recomputes exact hashes, enforces the five-file data allowlist, rejects nested
or symlinked entries and a symlinked package root, reads each file through one
no-follow handle with pre/post identity and metadata checks, then revalidates
the root identity and exact directory contents. It exercises 18 rejecting
fixtures (13 data/package/path plus five CLI) and two deterministic mutation
hooks that replace a file or add a directory entry during verification. The
conformance gate validates the strict public
`ComponentContract`, public package imports, two valid skin inputs, eight
behavior cases per skin, six identity/state-preservation switch cases, and 18
rejecting fixtures (six contract/matrix/package, seven structural CSS, and five
CLI).
Gallery jsdom parameterizes the same eight real behavior runners across default
and stress (16 executions), including actual stress root attributes and its
installed generated stylesheet; the JSON matrix is only the fail-closed case
inventory, never a substitute for those assertions. CL1C upgrades
that inventory to schema v2, adds six exact runtime axes and five exact fallback
classes, raises conformance negatives from 18 to 25, and traverses the resulting
64 vertices without replacing those behavior runners. CL2A adds five Action,
Icon, Badge, and Status runners, then adds the complete action
variant/state/size inventory, raising the exact inventory to 14 cases per skin
and 28 real executions while retaining the same 25 rejecting fixtures.

## CL1A built-in Direction A evidence boundary

The CL1A candidate changes only trusted built-in token data, its fixed CSS
serializer, and the private Gallery. It does not change the frozen Skin v1
schema or registry. Every one of the 74 registered tokens is explicit for
light/dark × normal/high, including all six optional safe values, so the
built-in package reports an empty fallback list. Independent frozen test data
compares every value in every mode; it is not derived from the production token
objects. Generated JSON, CSS, integrity hashes, package exports, and outside
consumer data remain exact.

Test-side WCAG relative-luminance and alpha-composition code is independent of
production serialization. Small text pairs are asserted at 4.5:1 on their
actual carrying surfaces, including secondary, tertiary, and accent text on all
eight Gallery surface roles; accent/on-primary and status/on-color pairs are
also 4.5:1. Required `border.default`, `border.strong`, status boundaries, and
focus tokens are at least 3:1. The lower-alpha `border.subtle` remains decoration
only and must never be the sole required component boundary. The v17
translucent focus values were deliberately not copied because their actual
composites fail 3:1; the ledger records the opaque v17 role replacements.

Skin v1 deliberately has status solid, subtle-background, and on-solid roles,
but no colored status-text role. Those solid and subtle tokens do not form a
small-text pair: the prototype uses separate `success-text`, `warning-text`,
`danger-text`, and accent-text values. CL2 must use `text.primary` plus redundant
status labelling or pursue a separate finite contract change before rendering
colored small status text; CL1A neither widens the schema nor lowers 4.5:1.

Gallery keeps skin, theme, and contrast as independent root attributes. Its
panel calls `getComputedStyle` for all 74 registry variables and names the
formal `@artemis/theme-artemis/theme.css` provenance; it has no second raw
Direction A palette. Tests cover all eight default/stress vertices, all 74
computed values at each vertex, all three pressed-button groups for every
initial vertex, all 12 single-axis cube edges, and a complete eight-vertex round
trip that preserves the same Probe node, value, React event-order state, focus,
selection, anatomy, and ARIA. The existing eight behavior runners still execute
against both skins (16 runs). A working-tree in-app Browser smoke independently
traversed the same eight vertices with 74 resolved values, preserved Probe
value/focus/selection/ARIA, and produced no warning or error console entries;
reviewed-SHA Browser evidence is still pending. Electron is N/A because no
Desktop consumer, resolver, persistence, main, or preload code is in CL1A.

## CL1B Desktop resolver merged boundary

CL1B adds a finite production registry containing exactly the
public `@artemis/theme-artemis/manifest.json` entry `com.artemis.default` and
imports the package's public `theme.css`. Before `createRoot`, the renderer
loads and validates the default registration, applies only the three skin-owned
root attributes, resolves system light/dark, preserves the existing fourth
`data-theme` system/explicit bridge, and confirms all 74 computed variables.
`rendererReady` waits on that complete default promise. The host installs one
theme `matchMedia` listener, removes it idempotently, ignores system changes for an
explicit preference, and uses a generation counter so a stale asynchronous
load cannot overwrite the newest transition.

Selection is all-or-nothing. Unknown, empty, malformed, unavailable,
unsupported, not-ready, and load-rejected selections prepare no selected root
state and return a diagnostic fallback reason with a complete default
registration. A failed default is fatal without a duplicate retry and
preserves the last valid DOM. The host never writes inline semantic
tokens, body attributes, storage, IPC, preload, Protocol, query parameters, or
skin-dependent JSX/CSS. There is still no user skin selection or persistence.

`verify:desktop-skin` builds its stress registry and App/preload probes only in
a dedicated compile-time renderer artifact from the one canonical private
Gallery fixture. A working-tree sandboxed Electron run on the CL1A base
observed the complete default at
the first React render; system and explicit bridge behavior; 74-variable
default/stress/fallback snapshots; and default → stress → default without
replacing the same focused Environment portal input, its value/selection, the
portal, xterm root/screen/rows, or terminal contents. Native PTY open count
remained one and Renderer console warning/error capture remained empty. The
Terminal palette, main native-theme/window background/titlebar path, preload,
and shared API are byte-identical to HEAD; this does not claim native titlebar
pixel proof.

The verifier restores a standard build, then scans standard `dist-renderer`,
`dist-electron`, a real macOS `app.asar`, `app.asar.unpacked`, and extra
resources. The merged CL1B evidence found zero synthetic ID,
Gallery/private-fixture, or smoke-hook marker and exercised eight
multi-position rejecting fixtures.
Screenshots are non-empty; they are not expected to differ before CL2/MIG
consumers adopt the semantic variables. The verifier itself requires a clean
checkout, records the current HEAD, and accepts an optional expected-HEAD
guard; the exact-candidate result is recorded externally with the PR evidence.

## CL1C conformance merged boundary

CL1C extends the production host from system light/dark to system contrast:
`prefers-contrast: more` or forced colors resolve to `high`, while explicit
normal/high choices remain stable until returned to `system`. Theme and
contrast listeners are separate and idempotently removed. The host still owns
only root attributes; there is no new persistence, IPC, preload/API, install,
discovery, trust, or arbitrary-CSS surface.

The Gallery schema v2 matrix is exact across default/stress, light/dark,
normal/high, LTR/RTL, 100%/200%, and full/reduced motion: 64 runtime vertices.
Its real behavior harness returns to the starting vertex with the same Probe
node, value, selection, focus, anatomy, ARIA, and React event-order state.
Reduced-motion CSS is a fail-closed part of the contract. A dedicated CI job
runs this Gallery contract on Linux, macOS, and Windows; that proves the
cross-platform web contract, not native Electron parity.

The exact-head Desktop verifier is extended to traverse the same 64 vertices
in one real Electron window. Each 100% direction/motion environment establishes
a real focused Environment portal input; at 200%, where responsive layout hides
that branch control, the matrix uses the real focused Composer textarea. The
chosen node, value, selection, focus, inherited direction, and token values are
retained through all eight skin/theme/contrast vertices. The original Composer
and xterm nodes remain fixed across all 64 vertices; the synthetic `Artemis>`
prompt stays present and the native PTY count remains one.
It asserts real `webFrame` zoom, emulated reduced motion, all 74 computed tokens,
and empty Renderer warnings/errors.
Unknown, unavailable, unsupported, load-failed, and default-fatal paths are
separate fail-closed cases. Standard renderer, main-process, `app.asar`,
unpacked, and resource scans also reject every added temporary fallback marker.
The clean candidate result remains PR evidence; this ledger does not predict
that result or claim a production visual migration.

## CL2A Action/Icon candidate boundary

`@artemis/ui/actions` contains only platform-neutral React anatomy and finite
public props. Text `Button` requires perceptible visible content and derives its
name from that content unless an explicit accessible label contains the visible
label in order; `IconButton` requires a perceptible explicit name. Both
default to `type="button"`, rely on native Enter/Space and disabled behavior,
emit at most one consumer callback per activation, block loading actions with a
native disabled control plus `aria-busy`, and expose finite selected/error/loading
state. Their frozen public contract exposes the exact
disabled > loading > error > selected > ready priority and an exact validator.
`Icon` always keeps `data-part="root"`; the action-owned icon slot is a separate
wrapper. It is decorative and owns xs/sm/base/lg/xl sizing; the consumer owns
the accessible name and supplies a platform-neutral visual. `Badge` and `Status`
require visible text and a redundant dot; Status becomes a live region only by
explicit opt-in. No Apple proprietary asset is copied or embedded.

Action structural CSS uses only the frozen finite selectors and semantic tokens
declared by its public contract. IconButton state indicators are absolute,
contained overlays, so the icon remains optically centered in both control
sizes. Status labels always use `text.primary`; the
solid tone appears on the redundant dot and the background uses the matching
subtle role, preserving the Skin v1 small-text boundary. Reduced motion removes
action transitions and pressed transforms. The focus indicator keeps the same
non-overridable `2px solid Highlight` safety floor. Skin data cannot branch
component anatomy, choose variants, add selectors, or supply private classes.

Gallery binds all six new behavior cases to both default and stress skins and
retains the same Action/Status nodes and attributes through all 64 runtime
vertices. It renders every Button variant and size, every IconButton
variant × state × size combination, and every Badge/Status tone. Desktop imports
only the public stylesheet and action subpath; its legacy form reset is confined
to `artemis.reset`, and its
GoalBar adapter keeps `ThreadGoal` status-to-tone mapping outside the package.
The 105-case real Electron Goal parity matrix has no `--no-sandbox` fallback,
records the exact HEAD and sandboxed launch mode, and validates the resulting component
identities, state/variant/tone attributes, computed 28px controls, 14px icons,
26px status pills, background/border/color/font contracts, fixed focus outline,
30 IconButton variant × state × size geometry probes, native pressed behavior
under reduced motion, action order, screenshots, and accessibility across locale,
theme, width, and zoom. It does not establish native Windows/Linux parity or
migrate any other Desktop surface.

Installed-package proof resolves the actions declarations and runtime through
the public export. A Button-only browser bundle omits IconButton, Badge, and
Status implementation markers. JavaScript is component-tree-shaken; the single
public `styles.css` is an intentionally whole, audited structural aggregator and
is not component-tree-shaken.

## CL0B component contract boundary

`ConformanceProbe` is a contract/skin harness exported only from
`@artemis/ui/conformance`; it is not a CL2 `TextField` or `Button`. Its v1
contract freezes public props and controlled/uncontrolled ownership, five DOM
parts, finite `data-state` values, ARIA relationships, Enter/IME behavior,
callback order/count, blocked busy/disabled actions, focus/RTL/no-portal
behavior, reduced motion, mutable semantic tokens, and a non-overridable safety
floor. The validator rejects non-plain inherited objects, unknown/missing
fields, duplicate entries, illegal data attributes, incompatible values, and
cross-field mismatches between prop types/boundaries, control references,
required ARIA anatomy, finite-state policies, keyboard/IME outcomes, and
callback order/count.

The accessible-name floor requires the v1 `label` prop to remain a required
static string in the public contract. `ConformanceProbe` rejects labels made
only of Unicode whitespace, Default-Ignorable characters, and Unicode Control
(`Cc`) code points before producing DOM, while retaining Chinese, combining
marks, and emoji with perceptible content. The Gallery's same default/stress
ARIA behavior runner proves both the rejection and the positive accessible
name. The contract is
deep-frozen at runtime; its validator also requires the `value` and
`defaultValue` control props to remain non-required and preserves original
array indexes in issue paths. The Probe rejects simultaneous defined
`value`/`defaultValue` own properties on its first DOM or SSR render while
treating an explicitly supplied `undefined` as absent. The built Gallery CSS is
parsed to require exactly one full layer-order
statement, one theme block, two UI blocks (public structure and Gallery
scaffold), no reset block, no unlayered root nodes, and first encounters of
`artemis.reset` → `artemis.theme` → `artemis.ui`. `!important`, the former
theme-first order, unknown/nested layers, duplicate blocks/order statements,
unlayered focus or Gallery overrides, same-layer focus overrides, and any
Gallery scaffold selector/declaration/value drift are rejecting fixtures. The
first UI block must remain structurally identical to the public
`@artemis/ui/styles.css` block, the theme block must remain structurally
identical to `@artemis/theme-artemis/theme.css`, and the second UI block has an
exact 43-selector/rule Gallery-only allowlist plus exact reduced-motion and
narrow-width media blocks. Twenty-five formal artifact fixtures exercise these layer,
root-node, public/theme-block, Gallery-block, and motion-query rejection paths.

Gallery isolation covers Desktop TypeScript/Vite configuration, CSS imports,
URLs and `image-set()` string candidates, HTML `src`/`href`/`srcset`, and
structured electron-builder resources. Vite configuration first resolves one
unique static root, then resolves `publicDir`, `envDir`, `cacheDir`, output and
asset directories, Rollup input, and alias replacements from the effective
root/output bases; unknown or multivalent values fail closed. Test-only Vite
`resolveConfig` fixtures confirm the root-relative public directory behavior.
The builder normalizer covers string and `FileSet` forms for `files`,
`asarUnpack`, `extraResources`, and `extraFiles` across build, macOS/MAS,
Windows, and Linux levels with their documented app/project directory bases.
The root's exact `minimatch@10.2.5`, `app-builder-lib@26.15.3`, and
`builder-util@26.15.3` development dependencies mirror the locked
electron-builder `FileMatcher`, macro, and filename-sanitization behavior over
the actual Gallery file set, including brace and character-class globs. Official macros
expand from static manifest/config metadata and bounded OS/platform/architecture
values; environment and unknown macros fail closed. `appDir` and `FileSet.from`
are checked for lexical and realpath overlap in both directions, including
direct and intermediate directory symlinks. `directories.app` follows the
builder's literal project-relative resolution, while resource fields reject
the unsupported `${projectDir}` and `${appDir}` macros. A parent FileSet remains
valid only when its ordered filters exclude every Gallery entry. Its fixtures
also reject Desktop use of the test-only UI conformance subpath, executable
inline HTML Gallery references, and Node/Electron bypasses in CJS/MTS/CTS and
declaration variants. They prove 23 safe cases and reject 113 cross-boundary
cases.

The Gallery build is explicitly single-page: exactly one `index.html`, with the
exact emitted local module and stylesheet assets. Eight HTML artifact fixtures
reject remote, absolute, extra-resource, `srcset`, and additional-page cases.
Final Desktop renderer files are all traversed; CSS selectors, at-rules and
resources are structurally parsed, HTML attributes, executable inline
scripts/styles, and JS markers use exact private identities, and non-script
files are compared only against non-empty, path-identifiable Gallery static
assets. Fourteen formal artifact
fixtures cover those paths while allowing ordinary text and URLs such as
`docs.gallery-example`. This is a static configuration and renderer-build
boundary; it is not evidence that a final installer/package was inspected.

The Probe, Action, Form, Navigation, Feedback, and Layout structural stylesheet
is parsed with PostCSS and compared against an exact selector/property/value
allowlist. Its consumed `--artemis-*` token set must exactly equal the union of the six public
contracts' `mutableTokens`; raw named/rgb/hsl/transparent colors, undeclared
tokens, skin selectors, imports/URLs, and an overridable focus rule all fail.
Focus visibility has a fixed structural floor of
`2px solid Highlight` with a `2px` offset, so a schema-valid skin setting the
ordinary border width to zero and the otherwise available focus color token to
transparent cannot remove the Probe focus indicator.

## Selector and host contract

Built-in CSS generation uses only this controlled selector shape:

```text
:root[data-artemis-skin="<validated-id>"]
  [data-artemis-theme="light|dark"]
  [data-artemis-contrast="normal|high"]
```

The line breaks above are explanatory; generated selectors are a single root
selector. Token data cannot add selectors or property names. The merged CL1B
host owns attribute resolution and the orthogonal bridge from the existing
`AppTheme` value; CL1C adds system contrast resolution without changing
persisted `AppTheme`, adding persisted skin state, or making third-party data
trusted.

## SKIN1 ownership after MIG6

The following are explicitly outside CL0A-CL2A and all MIG PRs unless a new
scope is approved:

- user installation, deletion, enablement, and selection;
- `skinId` persistence or migration;
- filesystem/package discovery and trust UI;
- marketplace, remote download, update, signing, or revocation;
- arbitrary CSS, selector, JavaScript, React, or Electron extension points.

They belong to the independent SKIN1 sequence after MIG6. A packable workspace
tarball and an outside consumer proof are packaging tests, not publication or a
user-install feature.

## Stop conditions and rollback

- Reject before applying any partial mode if validation has an issue.
- Do not silently widen enums/ranges or ignore unknown fields for compatibility.
- Do not use CSS escaping as permission for user-defined selectors; selectors
  remain generated by trusted code.
- Do not let a stress skin change component anatomy, ARIA, event order, product
  state, or permission behavior.
- Roll back CL1C independently by removing system contrast resolution, the
  schema v2 runtime/fallback axes, cross-platform Gallery job, expanded Desktop
  matrix, and its temporary-marker policies; no component/surface migration or
  user-facing skin state depends on it.
- Roll back CL2A independently by removing the public action subpath and its
  structural rules, the five Gallery cases, the GoalBar adapter, and their
  package/Electron assertions. Skin v1 data and the CL1C host stay unchanged.
- Roll back a skin package independently from `@artemis/ui`; the contract package
  must remain stable for every already-merged consumer.
