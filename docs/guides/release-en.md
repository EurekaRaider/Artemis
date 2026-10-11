[English / 简体中文](release.md)

# Building and releasing

Desktop builds and validation cover Windows x64, macOS arm64 and macOS x64. CI uses GitHub-hosted `windows-2025`, `macos-15` and `macos-15-intel` runners for main pushes, external fork PRs and manual invocations. PR permissions are read-only: they do not read signing keys or execute contributor code through `pull_request_target`. Public Intel downloads await the first official Release containing x64 assets.

macOS CI and packaging jobs cache npm and Electron downloads by architecture and lockfile. Each job still runs `npm ci` and its required builds; user data, signing credentials and acceptance results are not cached.

## Desktop application

The Release workflow may be started manually only from main. `release_tag` must equal `v<version>` in package.json, and the first release-notes line must match. All three targets rerun CI against that same commit every time; evidence from other commits is not reused. `publish=false` performs complete signing, notarization, packaging and artifact-collection validation without creating a Release or updating channels. Only `publish=true` publishes artifacts.

macOS builds are signed first and handed to the notarization job through a short-lived Actions artifact. Only explicitly listed assets are uploaded after notarization, stapling and final DMG/ZIP checks pass. The build tool manages signing keys in a temporary keychain; private keychains and intermediate signing materials must not be uploaded to a Release.

arm64 and x64 build and validate on their own native runners, including PTY, Seatbelt, signatures, notarization, stapling and rollback. `npm run package:mac:arm64` and `npm run package:mac:x64` select one architecture; `npm run package:mac` builds both. The collector requires both independent macOS manifests, verifies their digests, merges asset lists for matching update channels and recalculates the merged metadata digest so architectures cannot overwrite each other.

Windows produces a per-user NSIS installer and a manual ZIP. NSIS does not request elevation. Releases require `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`; public keys live in `apps/desktop/resources/update-public-keys.json`. The signed index binds platform, architecture, version, increasing sequence and EXE/ZIP hashes. `ARTEMIS_UPDATE_SEQUENCE` comes from the Release workflow run number. Confirm it cannot decrease before recreating the workflow or moving the repository.

Final assets are published to the public `EurekaRaider/Artemis` repository. The publisher verifies all asset digests and reads uploaded results back before making the release public. It then updates the signed index in the separate `windows-x64-stable` Release and downloads it for a byte comparison. Do not determine Windows update availability from whether GitHub's latest Release contains Windows assets.

Required secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`. Release uploads use the repository `GITHUB_TOKEN` with `contents: write` limited to the publishing job. Release credentials do not bypass source-repository main-branch rules.

## Windows recovery and key rotation

Before installation, download and verify the installer for the currently running version, save a consistent SQLite snapshot and launch a recovery helper outside the installation directory. Running tasks or unsaved edits block installation. The helper waits for the old process to exit, installs the new version and allows 120 seconds for database, renderer, IPC and agent-host health confirmation. Failure permits at most one rollback and quarantines the failed version. User project files are not rolled back and task side effects are not replayed.

The first NSIS-capable release supplies a corresponding signed index so the next update can obtain its previous installer. ZIP users must manually install NSIS once; user data stays in the existing userData directory. Installers from the former registration-code era cannot serve as the new recovery baseline.

Rotate keys across two releases: first sign a client containing the new public key with the old key; after sufficient adoption, sign with the new private key. Keep the old public key until supported clients have migrated. Unknown key IDs, wrong digests and decreasing indexes are rejected. Ed25519 integrity verification is distinct from Authenticode and SmartScreen reputation.

## Capability packs

Office uses fixed versions and SHA-256 digests from `scripts/office/sources.json` and can build from public upstream sources with an empty cache. After ordinary-user installation and preview checks, the candidate package passes to the publish job as an artifact of the same run. A Windows Office release requires a new immutable version number.

`office-macos-release.yml` builds the Intel Office runtime on `macos-15-intel`: it fetches pinned engine and SDK inputs, compiles the UNO bridge, verifies and signs each Mach-O architecture, notarizes and staples the app, then installs the final signed ZIP and exercises editing, PDF export and reopening of the Word, Excel and PowerPoint corpus. After publication it verifies anonymous online installation before proposing a catalog PR. New Intel manifests require Artemis `>=1.7.14 <2`; update the host version before releasing them. Use a new immutable runtime version and preserve the existing arm64 and Windows manifests.

Design packs are built only for darwin-arm64 and win32-x64. Release credentials exist only in trusted publishing jobs. Office and Design catalog changes create PRs; clients discover new capability packs after maintainer review and merge. Automation does not write directly to main.

Office and Design catalog PRs still use `ARTEMIS_RELEASE_TOKEN`, which must have Contents and Pull requests write access to `EurekaRaider/Artemis`. The catalog paths are `apps/desktop/resources/office-runtime/catalog.json` and `apps/desktop/resources/design-plugins/catalog.json` on main.

Existing signed Office manifests retain their original URL bytes to preserve signatures. After signature verification, the downloader maps the exact legacy release prefix to Artemis; archive sizes and SHA-256 checks remain mandatory. Copy the immutable runtime assets to the same tags in Artemis before shipping a client using the new source, and keep capability releases marked `--latest=false`. New manifests are signed with Artemis URLs. Older clients keep their embedded update source, so retain the old releases and provide a migration release there if automatic transition is required.

Intel targets use the catalog's `additionalManifests` field. Updated hosts validate them under the same signature, architecture and version boundaries; older hosts continue reading `manifests` without rejecting the whole feed for an unknown x64 target. Computer Use version catalogs retain all three manifests while the stable catalog uses this compatible layout. Office catalog PRs preserve previous targets and trust roots.

## Acceptance evidence

Keep CI links for the same commit, final package hashes, signing/notarization results and installation-directory checks. A hosted Windows Server result must not be described as manual Windows 11 desktop acceptance. Record the actual environment and result for desktop interaction, Unicode installation paths, permission denial, process-tree cleanup and recovery from failed startup. Checks that were not run must not be marked as passed.
