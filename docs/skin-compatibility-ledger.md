# Artemis Skin v1 compatibility ledger

Status: CL0B component-contract candidate on merged CL0A base
`244aacf78978597fec9996458ddbe590adfc8c7a`. This document records what is
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

| Case                                          | Expected modes                                                                   | Expected result                                                 | Runtime consumer               | Milestone/status                     |
| --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| Artemis neutral scaffold                      | light/dark × normal/high × comfortable × universal                               | valid; optional omissions reported and filled from the registry | Gallery only                   | CL0A merged at `244aacf`             |
| Artemis Direction A                           | same minimum matrix, with frozen v17-aligned values                              | valid and visual/contrast evidence                              | Gallery, then Desktop resolver | CL1A pending                         |
| Synthetic stress skin                         | light/dark × normal/high × compact × universal with extreme allowed token values | valid without changing Probe anatomy, ARIA, or event order      | Gallery test harness           | CL0B candidate; CL1C remains pending |
| Missing required token                        | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                          |
| Unknown token/field                           | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                          |
| Invalid CSS-like value or out-of-range number | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                          |
| Unsupported schema/UI contract                | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                          |
| Missing declared document/mode                | any                                                                              | reject the entire skin                                          | package validator              | CL0A tested                          |
| Optional token omitted                        | any otherwise valid mode                                                         | accept and report registered safe fallback                      | validator                      | CL0A tested                          |
| Entire selected skin invalid/unavailable      | host chooses built-in safe skin before rendering                                 | no partial application                                          | Desktop resolver               | CL1B pending; not claimed by CL0A    |

CL0B adds stable `verify:skin-package` and `verify:skin-conformance` skeletons.
The package gate validates bundled Artemis data and the synthetic fixture,
recomputes exact hashes, enforces the five-file data allowlist, and exercises
eight rejecting fixtures. The conformance gate validates the strict public
`ComponentContract`, public package imports, two valid skin inputs, eight
behavior cases per skin, six identity/state-preservation switch cases, and 13
rejecting fixtures (six contract/matrix/package plus seven structural CSS).
Gallery jsdom parameterizes the same eight real behavior
runners across default and stress (16 executions), including actual stress root
attributes and its installed generated stylesheet; the JSON matrix is only the
fail-closed case inventory, never a substitute for those assertions. Full
default/stress/fallback governance remains CL1C pending.

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
static string in the public contract. `ConformanceProbe` rejects empty or
whitespace-only labels before producing DOM; the Gallery's same default/stress
ARIA behavior runner proves both the rejection and the positive accessible
name. The built Gallery CSS is parsed to require exactly one full layer-order
statement, exactly one theme block, exactly one UI block, no reset block, and
first encounters of `artemis.reset` → `artemis.theme` → `artemis.ui`. The former
theme-first order plus duplicate theme/UI blocks and duplicate order statements
are rejecting fixtures.

The Probe structural stylesheet is parsed with PostCSS and compared against an
exact selector/property/value allowlist. Its consumed `--artemis-*` token set
must exactly equal the contract's `mutableTokens`; raw named/rgb/hsl/transparent
colors, undeclared tokens, skin selectors, imports/URLs, and an overridable
focus rule all fail. Focus visibility has a fixed structural floor of
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
selector. Token data cannot add selectors or property names. Host attribute
resolution and the orthogonal bridge from the existing `AppTheme` value are
CL1B work. CL0A does not change persisted `AppTheme` or Desktop state.

## SKIN1 ownership after MIG6

The following are explicitly outside CL0A-CL1C and all MIG PRs unless a new
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
- Roll back a skin package independently from `@artemis/ui`; the contract package
  must remain stable for every already-merged consumer.
