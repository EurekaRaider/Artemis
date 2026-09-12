# README visuals

## Desktop screenshots

The README screenshots were captured on September 11, 2026 from a locally built
Artemis 1.5.7 desktop running on macOS arm64. They show the production Electron
renderer, not the UI prototype or component Gallery.

Each capture is 1440 × 850 CSS pixels at 100% zoom, with the full application viewport
included. The [capture manifest](../images/screenshots/manifest.json) records the
source HEAD, working-tree qualification, timestamp, renderer security settings,
image dimensions and SHA-256 hashes. These are local working-tree captures;
they are not screenshots of a signed release. The two additional environment-panel
captures have their own [capture manifest](../images/screenshots/environment-manifest.json),
preserving the original capture provenance of the other images.

The Field Notes Git repository, conversation, completed Agent-team records,
Token usage and paused automations are synthetic demonstration fixtures. No
model request was submitted and neither automation was enabled. The Terminal
ran `git status --short` against the isolated sample repository. The capture
harness substitutes **Artemis** for the OS profile name in the isolated
process's snapshot response; this also renders the matching avatar initials
and Token Usage identity. Personal names, home-directory paths and credentials
are not shown. Chinese screenshots localize the UI while retaining the English
sample conversation. The IM views use synthetic Feishu/Slack connection responses and a two-member roster in the isolated main-process handlers. No real Gateway, IM account or bot is contacted. The same fixture supplies a no-PR response to avoid personal GitHub access.

| Screenshot                                                                | Surface                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Light workspace](../images/screenshots/workspace-light.png)                 | Projects, persistent tasks and Markdown conversation      |
| [Dark workspace](../images/screenshots/workspace-dark.png)                   | The same task in the dark theme                           |
| [Light environment panel](../images/screenshots/environment-panel-light.png) | Workspace, Git changes, Agent activity and source summary |
| [Dark environment panel](../images/screenshots/environment-panel-dark.png)   | The same environment information in the dark theme        |
| [Git Review](../images/screenshots/git-review.png)                           | Real unstaged TypeScript diff in the sample repository    |
| [Files and Markdown](../images/screenshots/markdown-files.png)               | Project documentation in the Markdown reader              |
| [Terminal](../images/screenshots/terminal.png)                               | Native PTY with real Git output                           |
| [Agent team](../images/screenshots/agent-team.png)                           | Two completed sample member tasks                         |
| [Resource Center](../images/screenshots/resources.png)                       | Bundled plugins and capability management                 |
| [General settings](../images/screenshots/settings-general.png)               | Profile picture, language and theme                       |
| [Automations](../images/screenshots/automations.png)                         | Two disabled weekly project automations                   |
| [Token usage](../images/screenshots/token-usage.png)                         | Synthetic usage totals, heatmap and composition           |
| [IM connections](../images/screenshots/im-connections.png)                   | Bot manager with synthetic connected channels             |
| [Group spaces](../images/screenshots/im-spaces.png)                          | Saved demonstration collaboration space                   |
| [Group conversation](../images/screenshots/im-group-chat.png)                | Group task with synthetic members and computer states     |
| [Dark group conversation](../images/screenshots/im-group-chat-dark.png)      | The same group task in the dark theme                     |
| [Simplified Chinese](../images/screenshots/workspace-zh-CN.png)              | Localized navigation and composer                         |

To refresh the screenshots on macOS, build the desktop and run the
[capture script](../scripts/capture-readme.mjs) with an available Playwright module:

```sh
npm run build -w @artemis/desktop
node docs/scripts/capture-readme.mjs
```

If Playwright is supplied by an external development runtime, set
`ARTEMIS_PLAYWRIGHT_MODULE` to that runtime's `playwright/index.mjs`. No package
installation or dependency change is performed by the script. An optional first
argument selects the output directory. The script creates a temporary user-data
directory and sample Git repository, closes its Electron instance on completion,
and leaves the temporary fixture available for inspection.

The capture checks visible text for the local account name and home paths,
checks that no renderer page errors occurred and records the renderer sandbox
settings. It is a documentation capture recipe, not the full
accessibility, cross-platform or release acceptance suite. Keep those checks in
the existing screenshot-matrix and native verification workflows.

## System architecture

The [self-contained HTML](../diagrams/artemis-system-architecture.html) and
[standalone SVG](../images/artemis-system-architecture.svg) contain the same diagram.
The README uses SVG so labels remain sharp when enlarged. Both work without
remote font or script downloads.

The diagram uses Diagram Design's architecture layout at 1280 × 864, with a
left-to-right command flow and distinct return routes for normalized UI events.
It is an implementation overview for contributors, rather than a complete call
graph. The renderer, Electron Main and Agent utility process have separate
boundaries; providers and the optional IM gateway are shown separately.

The previous overview's React and preload nodes are combined into the Renderer
boundary, and Pi SDK, session persistence, prompt caching and child scheduling
are grouped inside Pi Agent Host. `PiAdapter` and local state remain explicit.
Execution surfaces are moved out of the Agent-process box into a permission
summary, because Shell, Terminal, MCP and executable extensions do not share one
execution boundary. The optional gateway and the UI foundation are now visible.

The overview is grounded in the desktop main/preload services,
`packages/agent-host/src/runtime.ts`, `packages/protocol/src/pi-adapter.ts`, the
desktop IM service and the UI package manifests. Durable events are persisted;
transient child-Agent activity is batched separately. A dashed event-return path
does not imply that every activity delta is stored in SQLite.

The selected Artemis visual style comes from
`packages/theme-artemis/src/index.ts`:

| Role                      | Artemis token                  |
| ------------------------- | ------------------------------ |
| Paper / secondary surface | `#f5f5f7` / `#ececee`          |
| Primary / secondary text  | `#1d1d1f` / `#5a5a60`          |
| Accent / network link     | `#0071e3` / `#0056ae`          |
| Node surface / border     | `#ffffff` / `#68686c`          |
| Heading and body          | Native system sans-serif stack |
| Technical labels          | Native system monospace stack  |

These tokens are scoped to this documentation figure. The installed Diagram
Design style guide and shared profiles are unchanged. When editing the HTML,
update the standalone SVG from its inline `<svg>` block, preserve its accessible
title and description, and inspect the rendered labels and connector geometry.

## IM collaboration architecture

[HTML source](../diagrams/artemis-im-collaboration.html) · [SVG](../images/artemis-im-collaboration.svg)

The 1280 × 560 companion diagram separates existing IM groups, the Gateway and
independently authorized desktops. Solid arrows show task delivery; the dashed
route summarizes public replies through the Gateway to linked groups. It is a
routing overview, not a direct desktop-to-platform network connection. Pairing,
group confirmation, expiring delivery, private approvals and explicit file
publication follow the Gateway router and desktop IM service contracts.

Both diagrams retain the existing Artemis system font stacks and palette, with
no remote resources. The Gateway labels are checked against their containing
boxes as well as the full SVG frame.
