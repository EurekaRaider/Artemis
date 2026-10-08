[English / 简体中文](README.md)

# Artemis documentation

This directory retains current usage, development and maintenance guides, necessary release records and visual assets. [Documentation rules](AGENTS-en.md) define placement, naming, bilingual maintenance and cleanup.

## Overview

- [System architecture](architecture.md): processes, package boundaries, protocol and execution policy.
- [Installation](install-en.md): installation, plugins and model configuration.

## Usage and development guides

| Document                                                         | Contents                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Repository layout](guides/repository-layout-en.md)              | Ownership and migration rules for source, tests, tools and outputs |
| [Attachment context](guides/attachment-context.md)               | Context budgets and attachment protection                          |
| [Hooks](guides/hooks-en.md)                                      | Configuration, command protocol, trust and plugin development      |
| [Connectors](guides/connectors.md)                               | Account connections, credentials and developer configuration       |
| [Plugin OAuth](guides/plugin-oauth-en.md)                        | Declarations, authorization and developer-backend protocol         |
| [Plugins and Git marketplaces](guides/plugin-marketplaces-en.md) | Plugin formats, signing, distribution and updates                  |
| [Visual skin plugins](guides/visual-skins-en.md)                 | Skin v2, asset contracts, tools and complete examples              |
| [Localization](guides/localization-en.md)                        | Terminology, RTL and verification conventions                      |
| [Computer Use live preview](guides/computer-preview-en.md)       | GPU lifetime, capability pack compatibility and runtime acceptance |
| [Plugin development](guides/plugin-development-en.md)            | v2 contracts, SDK, tools, examples and v1 compatibility            |
| [Pi upgrade and execution modes](guides/pi-upgrade-modes.md)     | Runtime upgrade, modes, compatibility and validation               |
| [Cross-platform releases](guides/release-en.md)                  | Public CI, signing, updates and recovery acceptance                |

## Maintained records

- [Release notes](records/release-notes.md): Chinese and English notes for the current version, consumed directly by the Release workflow.
- [CI and verification maintenance](records/ci-reliability-en.md): commands, workflow scope and evidence requirements.
- [README visual assets](records/readme-visuals-en.md): screenshot standards, privacy checks and reproduction.

## Assets and companion projects

- [Visual assets](assets/) and the [screenshot manifest](assets/images/manifest.json): images, HTML/SVG sources and screenshots.
- [Screenshot capture script](../scripts/ui/capture-readme.mjs): captures the production UI with isolated demonstration data.
- [Hooks examples](../examples/hooks/hooks.json): configuration, scripts and an [example plugin](../examples/hooks/plugin/artemis.plugin.json).

Every first-party explanatory document has complete English and Chinese content. Follow the language links at the top of each document; runtime skill instructions and original third-party legal texts are excluded.
