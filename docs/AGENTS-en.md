[English / 简体中文](AGENTS.md)

# Documentation management rules

This file governs the placement, naming and cleanup of official documentation and assets. See root [AGENTS.md](../AGENTS.md) for engineering rules and [README.md](README.md) for the documentation index.

## Directory structure

```text
docs/
├── AGENTS.md        # Documentation rules
├── README.md        # Index
├── architecture.md # System architecture
├── install.md      # Installation
├── guides/         # Current usage, development and maintenance guides
├── assets/         # Images, editable sources and screenshot manifests
└── records/        # Necessary records maintained over time
```

## Placement

- Keep overall architecture and installation instructions at this level. Put other official documentation in `guides/` with clear topic names, such as `hooks.md` and `hooks-en.md`. Do not create a directory for a single document; group a topic only when it actually needs several companion files.
- `guides/` describes current capabilities, procedures, developer contracts and real limitations. It does not collect unimplemented proposals or phase-by-phase logs.
- Do not create separate user manuals for actions already fully guided in the UI. Configuration, authorization and integration steps belong in the product interface, avoiding duplicated, stale instructions.
- `records/` retains only release notes, CI conventions and asset standards that need continuing maintenance. Update existing files rather than collecting historical copies. The Release workflow reads `records/release-notes.md` directly; update the workflow if that path changes.
- Images and their HTML/SVG sources belong in `assets/`, using the same basename for the same image. UI screenshots belong in `assets/images/` and must match manifest filenames, dimensions and digests.
- Documentation companion scripts belong in root `scripts/`; runnable examples belong in root `examples/`.
- Dedicated proposal and prototype directories are no longer permanent fixtures. Merge necessary lasting conclusions into official guides. Git history preserves proposals, prototypes and process material. Prefer fixed source links to copying whole external reference trees.

## Naming and indexes

- Use English kebab-case filenames. Preserve existing entry paths; Chinese-primary documents use `-en.md` for English companions, while existing English-primary documents use `-zh-CN.md` for Chinese companions. Preserve conventional names such as README and AGENTS.
- All first-party explanatory documents provide complete Chinese and English content, either in linked companion files or complete sections in one file. Update both versions together. Runtime `SKILL.md` instructions are excluded; third-party legal texts retain their original content.
- Use relative links between documents and traceable links for external sources. Register new official guides in [README.md](README.md).
- Do not put temporary notes, prototype source, build output, complete external specifications or one-off acceptance reports in `docs/`. Temporary results belong in `/tmp` or Git-ignored `artifacts/`.

## Cleanup and migration

1. Use `rg` to check references in documentation, source, scripts, tests, CI and manifests.
2. Confirm that content has been superseded or the user has accepted completion; age alone is not grounds for removal.
3. Use `git rm` for tracked-file deletion. Protect untracked files and existing uncommitted changes. Authorized migrations preserve content and adjust only necessary path references.
4. Update indexes, script root resolution, tests and manifest paths. Validate local links and affected checks.
5. Local artifacts such as `.DS_Store` do not belong in Git; remove them when found.

Maintain these rules together with the actual structure so empty categories, single-document directories and obsolete material do not return.
