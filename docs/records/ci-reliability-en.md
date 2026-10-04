[English / 简体中文](ci-reliability.md)

# CI and verification maintenance

Maintenance baseline: 2026-09-29, Artemis 1.6.11. The [root package.json](../../package.json), [CI workflow](../../.github/workflows/ci.yml) and [Release workflow](../../.github/workflows/release.yml) define executable entrypoints. This document retains lasting verification conventions; historical test counts and pipeline durations are not current results.

## Environment and check entrypoints

Current CI uses Node.js 26 and installs dependencies with `npm ci`. Local reproduction should use the same Node distribution, version and platform as the target CI. Diagnose failures caused by differences between local Homebrew native-library layouts and CI separately.

| Entrypoint                          | Purpose                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm test`                          | Repository checks including builds, workspace tests, skin/UI contracts, boundaries and performance |
| `npm run typecheck`                 | Workspace typechecking after core and UI-library builds                                            |
| `npm run format:check`              | Formatting under repository Prettier configuration; README and prototypes have explicit exclusions |
| `npm run verify:ci`                 | CI aggregation; the executing script defines order and dependency auditing                         |
| `npm run verify:visual-convergence` | Real Electron visual and native workloads for the built candidate commit                           |
| `npm run test:im`                   | IM policy, protocol and integration regression tests                                               |
| `git diff --check`                  | Whitespace errors in changes                                                                       |

For documentation-only changes, check local links, references, formatting and the diff. Changes involving images, scripts, manifests or prototypes also require verification by their consumers. Documentation cleanup must not weaken business, permission or performance gates.

## Workflow coverage

Regular CI runs portable validation, native Slack CLI compatibility, visual convergence and native Hooks checks on both macOS arm64 and Windows x64. Manual `hooks_only=true` runs only Hooks acceptance. Repository, event and origin conditions also affect scheduling; consult the workflow for exact conditions.

Final release acceptance is separate from ordinary CI. Release consumes the [current bilingual release notes](release-notes.md) and verifies the version heading; do not remove this file as an obsolete audit. Office Runtime has an independent release process. The desktop release reuses an existing runtime; desktop CI does not prove that runtime publication is complete.

## Diagnosing failures and preserving evidence

- Confirm the candidate source SHA, build digest and native environment before analyzing failed steps and uploaded artifacts. Passing another commit does not turn an earlier failure into a pass.
- Distinguish network downloads, missing runtimes, framework startup and application assertions. Electron runtime preparation time must not enter renderer-startup measurements.
- Cold startup uses a fresh profile and warm startup reuses that profile. Record each language, theme and scaling variant as its own cold/warm pair; array order cannot make a later fresh profile a warm run.
- Retain complete manifests, timings, screenshots and diagnostics on failure. Do not remove slow samples or hide failures with unbounded retries. Current budget files define performance ceilings.
- Test timeouts and product performance budgets differ. Environment costs such as compiling a native helper can be explained separately but do not justify raising product latency thresholds.
- UI contract changes update both expected behavior and evidence. Do not disable whole CSS, accessibility, renderer-boundary or Windows ACL gates.
- Renderer tests use fixed inputs rather than reading the real README to freeze versions, badges or copy. Before removing duplicate checks, identify remaining coverage and assertions deliberately dropped; source-reading tests are not automatically useless.
- Local macOS checks, simulated Gateways, protocol tests and development builds prove only their own scope. Record Windows final-path ACLs, macOS signing/notarization, real accounts and two-device acceptance separately.
- Release conclusions must correspond to the final remote SHA, actual installer and public-asset readback. Unrun or skipped checks are not passes.

Git history retains individual accounts of earlier CI simplifications and failure repairs.
