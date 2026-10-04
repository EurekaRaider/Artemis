[English / 简体中文](repository-layout.md)

# Repository layout and file ownership

## Top level

- `apps/desktop/`: the Electron desktop app; `apps/ui-gallery/`: UI foundation demonstrations and verification.
- `packages/`: existing shared packages. Keep package names, public exports and protocol boundaries stable; do not create packages merely for individual pages.
- `scripts/`: cross-project build, CI, dependency maintenance, release, benchmark, UI and plugin tools. Tests and JSON contracts live with their tools.
- `docs/`: official guides, maintained records and visual assets; `examples/`: complete runnable examples.
- `vendor/`: dependency code distributed with the repository; `third-party/`: third-party licenses. `vendor/image-size-parser-blocker/` preserves dependency interfaces while refusing image-parser execution.
- `artifacts/`: Git-ignored build-input caches, acceptance evidence and historical archives, not source code.

## Desktop source and tests

`src/main/`, `renderer/`, `preload/`, `agent/`, `extension/` and `shared/` retain runtime-environment boundaries. Main-process and renderer code are grouped by features such as conversation, workspace, plugins, design, office, capabilities, mcp, connectors, im, automation and appearance. Feature styles and helpers stay with their feature.

`main/main.ts` and `main/bootstrap.ts` remain composition entrypoints. `renderer/main.tsx` is the page entrypoint, and `renderer/app/` manages application composition and navigation. Cross-feature components belong in `renderer/components/`, and global styles in `renderer/styles/`. Do not introduce vague `misc/` directories or flatten business files back into entrypoint directories.

`shared/` contains only cross-process definitions without Node/Electron dependencies; copy and locale resources belong in `shared/i18n/`. Specialized preload files live in `preload/`, while workers stay with their feature. Source moves must not change compiled entrypoint filenames.

`test/main/`, `test/renderer/` and `test/shared/` mirror source ownership. Cross-process flows belong in `test/integration/`; source-structure and packaging contracts in `test/contracts/`; shared fixtures and test helpers in `test/fixtures/`. Source scanners must recurse so new directories cannot reduce coverage.

## UI Gallery

`apps/ui-gallery/src/` retains only the startup entrypoint and environment declaration. `app/` composes pages, `pages/` contains demonstrations, `components/` contains shared components, `themes/` owns theme fixtures and declarations, `conformance/` owns contracts and matrices, and `styles/` owns Gallery styles. The two tests remain in `test/`; new pages follow their feature ownership.

## Shared packages and tools

`agent-host/src/` is grouped into runtime, sessions, context, models, tools and policy. `gateway/src/` uses channels, groups, authorization and i18n, retaining entrypoints and service composition at its root. Smaller packages retain their existing structure.

Desktop-only scripts live in `apps/desktop/scripts/{build,packaging,release,verify,dev}/`; verify is divided into ui, native and features. Cross-project scripts stay in root scripts grouped by responsibility. `scripts/artifacts/` supplies evidence-path helpers.

## Outputs and migration checks

- New desktop verification output defaults to `artifacts/verification/<topic>/<run>/`; existing output arguments can override the location.
- Benchmark output belongs in `artifacts/benchmarks/`, and development demonstration material in `artifacts/dev/`.
- `artifacts/office/`, `artifacts/slack-cli/`, capability-pack outputs and skin tools are inputs to existing build chains and retain their established paths.
- Regular dist and release locations remain unchanged and are excluded by the editor. The desktop build directory also contains tracked icons and installer configuration; never delete it wholesale as generated output.
- Preserve historical evidence; one-off material does not belong in official docs. Retired application artifacts go in `artifacts/legacy/`.

When migrating, update imports, dynamic paths, source assertions, npm commands, CI path filters and resource entrypoints together. Keep npm command names and public package exports compatible; do not leave forwarding files at old internal paths.

Explanatory documents retain their original paths: Chinese originals have `-en.md` counterparts, and English originals have `-zh-CN.md` counterparts. Link both versions and keep their content synchronized. Runtime `SKILL.md` and original third-party license texts are excluded; release notes remain bilingual within one file. `npm run verify:docs` checks pairing, language links and local Markdown targets; translation completeness still requires editorial review.

Run `npm run verify:layout` for entrypoint and public-export checks, followed by affected tests, the complete suite, typechecking and building. Record the platform and evidence for packaging and native checks separately; unit tests do not replace runtime validation.
