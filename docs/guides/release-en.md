[English / 简体中文](release.md)

# Building and releasing

Only Windows x64 and macOS arm64 are supported. CI uses GitHub-hosted `windows-2025` and `macos-15` runners for main pushes, external fork PRs and manual invocations. PR permissions are read-only: they do not read signing keys or execute contributor code through `pull_request_target`.

## Desktop application

The Release workflow may be started manually only from main. `release_tag` must equal `v<version>` in package.json, and the first release-notes line must match. Both platforms rerun CI against that same commit every time; evidence from other commits is not reused.

macOS builds are signed first and handed to the notarization job through a short-lived Actions artifact. Only explicitly listed assets are uploaded after notarization, stapling and final DMG/ZIP checks pass. The build tool manages signing keys in a temporary keychain; private keychains and intermediate signing materials must not be uploaded to a Release.

Windows produces a per-user NSIS installer and a manual ZIP. NSIS does not request elevation. Releases require `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`; public keys live in `apps/desktop/resources/update-public-keys.json`. The signed index binds platform, architecture, version, increasing sequence and EXE/ZIP hashes. `ARTEMIS_UPDATE_SEQUENCE` comes from the Release workflow run number. Confirm it cannot decrease before recreating the workflow or moving the repository.

Final assets remain published to the public `EurekaRaider/ArtemisRelease` repository. The publisher verifies all asset digests and reads uploaded results back before making the release public. It then updates the signed index in the separate `windows-x64-stable` Release and downloads it for a byte comparison. Do not determine Windows update availability from whether GitHub's latest Release contains Windows assets.

Required secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `ARTEMIS_RELEASE_TOKEN` and `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`. Release credentials do not bypass source-repository main-branch rules.

## Windows recovery and key rotation

Before installation, download and verify the installer for the currently running version, save a consistent SQLite snapshot and launch a recovery helper outside the installation directory. Running tasks or unsaved edits block installation. The helper waits for the old process to exit, installs the new version and allows 120 seconds for database, renderer, IPC and agent-host health confirmation. Failure permits at most one rollback and quarantines the failed version. User project files are not rolled back and task side effects are not replayed.

The first NSIS-capable release supplies a corresponding signed index so the next update can obtain its previous installer. ZIP users must manually install NSIS once; user data stays in the existing userData directory. Installers from the former registration-code era cannot serve as the new recovery baseline.

Rotate keys across two releases: first sign a client containing the new public key with the old key; after sufficient adoption, sign with the new private key. Keep the old public key until supported clients have migrated. Unknown key IDs, wrong digests and decreasing indexes are rejected. Ed25519 integrity verification is distinct from Authenticode and SmartScreen reputation.

## Capability packs

Office uses fixed versions and SHA-256 digests from `scripts/office/sources.json` and can build from public upstream sources with an empty cache. After ordinary-user installation and preview checks, the candidate package passes to the publish job as an artifact of the same run. A Windows Office release requires a new immutable version number.

Design packs are built only for darwin-arm64 and win32-x64. Release credentials exist only in trusted publishing jobs. Office and Design catalog changes create PRs; clients discover new capability packs after maintainer review and merge. Automation does not write directly to main.

## Acceptance evidence

Keep CI links for the same commit, final package hashes, signing/notarization results and installation-directory checks. A hosted Windows Server result must not be described as manual Windows 11 desktop acceptance. Record the actual environment and result for desktop interaction, Unicode installation paths, permission denial, process-tree cleanup and recovery from failed startup. Checks that were not run must not be marked as passed.
