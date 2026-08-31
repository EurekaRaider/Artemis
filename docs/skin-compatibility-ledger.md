# Artemis Skin v1 compatibility ledger

Status: CL0A data contract candidate. This document records what is enforced
now and which runtime behavior remains owned by later serialized milestones.

## v1 package contract

| Surface           | v1 rule                                                                                                                               | Current evidence                                                  | Owner/status   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------- |
| Schema version    | `schemaVersion` must equal `1`; unknown fields fail                                                                                   | runtime validator + emitted JSON Schema                           | CL0A candidate |
| UI compatibility  | manifest must declare exactly `uiContract: ">=1 <2"`                                                                                  | compatible/incompatible tests                                     | CL0A candidate |
| Manifest identity | reverse-DNS multi-label ID, bounded `name`, semver, `modes`, and fixed token basenames                                                | valid/invalid tests                                               | CL0A candidate |
| Data layout       | Third-party `.artemis-skin`: `manifest.json`, flat token JSON, and `integrity.json`; no user-supplied CSS/code                        | schema, pack, and outside-consumer proof                          | CL0A candidate |
| Color schemes     | manifest `modes` must contain both `light` and `dark`                                                                                 | manifest and mode-completeness validation                         | CL0A candidate |
| Contrast          | `normal` required; `high` and `tokens.contrast.json` are declared together                                                            | manifest/package validation                                       | CL0A candidate |
| Density           | comfortable/compact allowlist; each declared combination needs data                                                                   | capability Cartesian completeness                                 | CL0A candidate |
| Platform          | universal/macos/windows/linux allowlist; each declared combination needs data                                                         | capability Cartesian completeness                                 | CL0A candidate |
| Semantic tokens   | unknown token rejected; every required token present; optional omissions use registered safe fallback                                 | token/document tests                                              | CL0A candidate |
| Token values      | hex colors, bounded numbers with fixed units, font/easing/shadow IDs, fixed weight allowlist                                          | injection/range/field tests                                       | CL0A candidate |
| Generated CSS     | only fixed root data-attribute selectors and `--artemis-*` declarations                                                               | Artemis skin CSS tests                                            | CL0A candidate |
| Code surface      | no arbitrary selector, CSS payload, URL/import, JavaScript, React component, preload, or executable hook in the manifest/token schema | schema shape + boundary tests                                     | CL0A candidate |
| Integrity         | `sha256` only; hashes cover `manifest.json` and every manifest-declared token JSON; unknown/missing files and malformed hashes reject | strict schema, validator, generated hashes, outside recomputation | CL0A candidate |

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

| Case                                          | Expected modes                                                                   | Expected result                                                 | Runtime consumer               | Milestone/status                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| Artemis neutral scaffold                      | light/dark × normal/high × comfortable × universal                               | valid; optional omissions reported and filled from the registry | Gallery only                   | CL0A candidate                           |
| Artemis Direction A                           | same minimum matrix, with frozen v17-aligned values                              | valid and visual/contrast evidence                              | Gallery, then Desktop resolver | CL1A pending                             |
| Synthetic stress skin                         | extreme but allowed spacing, labels, contrast, density and platform combinations | valid without changing anatomy, ARIA, or event order            | Gallery                        | CL0B seed; CL1C full conformance pending |
| Missing required token                        | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                              |
| Unknown token/field                           | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                              |
| Invalid CSS-like value or out-of-range number | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                              |
| Unsupported schema/UI contract                | any                                                                              | reject the entire skin                                          | validator                      | CL0A tested                              |
| Missing declared document/mode                | any                                                                              | reject the entire skin                                          | package validator              | CL0A tested                              |
| Optional token omitted                        | any otherwise valid mode                                                         | accept and report registered safe fallback                      | validator                      | CL0A tested                              |
| Entire selected skin invalid/unavailable      | host chooses built-in safe skin before rendering                                 | no partial application                                          | Desktop resolver               | CL1B pending; not claimed by CL0A        |

CL0A intentionally does not add the full `verify:skin-package` or
`verify:skin-conformance` workflow. Those names, the stress-skin matrix, and
component anatomy/behavior assertions begin in CL0B and are completed in CL1C.

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
