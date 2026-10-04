# Contributing to Artemis

Fork the repository, create a branch and open a pull request against `main`.
Only EurekaRaider and huangwp retain repository write access. Other contributors
can propose changes through forks; do not request a write role merely to submit a PR.

Ordinary pull requests require one maintainer approval, resolved conversations
and the required Windows x64 / macOS arm64 CI checks. New commits dismiss stale
approvals. Maintainers can push directly; main still forbids force pushes and deletion,
and every push runs CI. Automation must propose source and catalog changes through PRs.

Use Node.js 26 and npm 11+, run `npm ci`, then `npm test`, `npm run typecheck`,
`npm run format:check` and `npm run verify:public-workflows`. New contributors do
not need private credentials or an activation key. Signing credentials are only
needed for trusted release jobs, never for pull request checks.

Keep Pi as the only agent loop. Renderer imports only public protocol and preload
contracts, never main-process or Node modules. Preserve versioned events,
idempotent reducers, content trust, account authorization and sandbox boundaries.
See [engineering guidance](AGENTS.md), [architecture](docs/architecture.md),
[plugin development](docs/guides/plugin-development.md) and [release guide](docs/guides/release.md).

Report actual test environments. A protocol test or hosted Windows Server run
cannot establish Windows 11 desktop acceptance. Never commit real credentials,
user conversations or private screenshots. Retain MIT and upstream notices.
