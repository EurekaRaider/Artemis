# Open-source implementation status

Base: merged PR #245, a5006f5f. Implementation and acceptance in progress; no release claim.

## Repository settings verified

- Public visibility, fork enabled. Only EurekaRaider (admin) and huangwp (write) have write access; no deploy keys.
- Main rulesets 24457338 prohibit deletion/force-push without bypass. Ruleset 24457339 requires one fresh approval, resolved discussions and eight dual-platform checks. Only the two named User actors bypass the PR rule.
- Actions default token is read-only; external contributor workflow approval required. An actual third-party fork PR is not yet acceptance evidence.
- Gitleaks 8.30.1 scanned 880 commits and tracked source. Historical published assets: 64 ZIP and 42 DMG reports. Inspected findings were hashes/code/test fixtures; no confirmed credential leak. This is not a guarantee of exhaustive secret detection.
- Update and Design Ed25519 private keys stored as Actions secrets; only public keys enter source.

## Implemented

- Activation source/UI/issuer/build key dependency removed. Normal bootstrap retains protocol registration, single-instance behavior and Windows ACL preparation.
- Hosted macOS arm64 / Windows x64 workflows, fork PR read-only execution, public pinned Office inputs, temporary signing artifacts, explicit release attachment lists and catalog changes through PRs.
- Windows Design AppContainer adapter with per-task identity, read-only runtime, private writable task storage, no network, child-process limit and cleanup. Runtime calls bounded to 32 outstanding and 240 KiB arguments.
- NSIS current-user distribution, signed per-platform update index shared with manual ZIP discovery, verified old/new installers, SQLite snapshot, external recovery helper, health deadline and one rollback/quarantine.
- Pure plugin-contract package, v1 adapters and v2 resource/interactive schema, SDK runtime, init/validate/dev/pack/migrate CLI, examples and durable installation journal.
- Update service factory, plugin installation transaction and renderer streaming state extracted. History page projections, shared visibility scheduling, 8-session/64 MiB cache and batch event processing implemented.
- README/developer/release/architecture guides updated, obsolete private/Intel release guides removed; images moved to docs/assets/images, four architecture figures refreshed. Screenshot capture updated for current native menu and group collaboration UI.

## Evidence as of 2026-10-04

- Full npm test passed: desktop 332 files / 3066 tests passed, 12 existing tests skipped. Other workspace suites and UI contract/package/budget gates passed.
- Desktop typecheck and complete formatting check passed; 126 local README/docs links resolve.
- Local history benchmark: 1500 turns / 49 pages, baseline total pagination 257.9 ms, current 7.6 ms; initial page 40.7 ms versus 49.2 ms. Hosted benchmark is configured but not yet measured.
- Desktop CSS 499459 bytes, below unchanged 500000-byte limit. Removed identical obsolete Chromium prefix fallbacks; differing fallback values retained.
- SDK integration: generated interactive plugin validates, packs, starts as a child, handshakes, calls tools and rejects unknown tools/bad arguments; migration preserves identity and refuses dropped fields.
- Real macOS Seatbelt isolation tests passed. Dispatch disposal and bounded queue regressions passed.
- Parallels Windows 11 ARM, ordinary logged-in user: real recovery PowerShell helper passed healthy update, failed installer, 120-second health timeout, tampered installer and cancellation. Fake disposable installer executables isolate helper behavior; this does not prove final NSIS installation or native x64 behavior.

## Remaining acceptance and work

- Commit/push and repair exact-head hosted CI. Build final Windows NSIS/ZIP on windows-2025 and verify installed Unicode path, effective ACLs, Design handshake/tools/denials/cleanup.
- Exercise final x64 package in Parallels using isolated profiles; label ARM emulation accurately. Native Windows 11 x64 interactive acceptance remains a distinct evidence layer.
- Publish signed Design pack and review/merge catalog PR; verify installation from the real catalog.
- Complete measured streaming/rendering/memory/lifecycle performance evidence and further business-boundary extraction where main/App still contain orchestration.
- Finish screenshot recapture and full-resolution privacy inspection; update its provenance record. Verify native macOS packaging/signing/notarization and update behavior.
- Publish v1.7.0 only after same-commit platform gates pass; verify public attachments, signed update channel and source parity. Do not equate helper/unit tests with final release acceptance.
