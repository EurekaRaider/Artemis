[English / 简体中文](readme-visuals.md)

# README visual assets

## This capture

On October 4, 2026, **20 interface screenshots** used by the README were recaptured from a local production build of Artemis **1.7.0** on macOS arm64. They show the real Electron Renderer: a clean greeting page, current workspace, plugin marketplace, installation confirmation, message integrations and group collaboration.

Every screenshot is a **1440 × 850 CSS-pixel full application viewport at 100% zoom**. The [main manifest](../assets/images/manifest.json) records capture time, source HEAD, workspace notes, main-process and preload build digests, Renderer entry digest, image dimensions and SHA-256. The [environment-panel manifest](../assets/images/environment-manifest.json) retains two panel captures from the same run. HEAD was `f878837df15157766e4b79b382abfbad5b2b9796`; the build included local changes at capture time and does not constitute acceptance of that commit alone or of a signed release package.

Capture sequence: open an isolated Field Notes task → switch theme and language → create an empty task and collapse the sidebar for the greeting hero → open Review, Files, Terminal and Agent team → inspect settings, IM channels and group grants → inspect plugins and installation confirmation → inspect usage and automations → select synthetic group conversations through existing host navigation events and inspect actual rendering.

## Demonstration data and privacy

- Separate temporary user-data and a temporary Field Notes Git repository were used; personal projects and conversations were not read.
- Conversations, child-Agent records, Token usage and two paused automations were synthetic demonstration data. No model request was submitted and no automation was enabled or run.
- Terminal executed real `git status --short` in the demonstration repository with a neutral Field Notes prompt.
- Only the isolated process's snapshot handler changed the displayed identity to **Artemis** and suppressed personal global Skills and real PR queries. Product identity logic was unchanged.
- The IM handler returned synthetic Slack connections, group information and four member identities, without connecting a real Gateway, personal account or bot. `demo-owner` and `demo-device` are demonstration identifiers.
- The plugin installation capture opened and cancelled the confirmation dialog; it did not install third-party capabilities or start account authorization.
- Chinese captures use the actual Chinese interface; demonstration project titles and body text remain English.
- The capture script checked visible text for the current system username and personal home path. Each original-resolution image was also inspected, covering sidebar, terminal, settings, usage and IM content; no personal name, directory or credential was found.

## Screenshot inventory

| Screenshot                                                              | Content                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Greeting page](../assets/images/welcome-dark.png)                      | README hero: clean dark welcome screen with collapsed sidebar   |
| [Light workspace](../assets/images/workspace-light.png)                 | Project, persistent task, Markdown and composer                 |
| [Dark workspace](../assets/images/workspace-dark.png)                   | The same task in dark theme                                     |
| [Chinese workspace](../assets/images/workspace-zh-CN.png)               | Chinese navigation and task actions                             |
| [Light environment panel](../assets/images/environment-panel-light.png) | Git, Agent activity and source summary                          |
| [Dark environment panel](../assets/images/environment-panel-dark.png)   | The same panel in dark theme                                    |
| [Git Review](../assets/images/git-review.png)                           | Real unstaged changes in the demonstration repository           |
| [Files and Markdown](../assets/images/markdown-files.png)               | Document reading and workspace tabs                             |
| [Terminal](../assets/images/terminal.png)                               | Native PTY and real Git output                                  |
| [Agent team](../assets/images/agent-team.png)                           | Two completed demonstration subtasks                            |
| [Plugin marketplace](../assets/images/resources.png)                    | Plugins, MCP and Skills tabs plus four bundled document plugins |
| [Plugin installation confirmation](../assets/images/plugin-install.png) | Capability counts and default enabled state after installation  |
| [General settings](../assets/images/settings-general.png)               | Avatar, language, theme and sleep prevention                    |
| [Token usage](../assets/images/token-usage.png)                         | Demonstration usage, heatmap and statistics                     |
| [Automations](../assets/images/automations.png)                         | Two paused weekly tasks                                         |
| [Message integrations](../assets/images/im-connections.png)             | Service status, channels and separate group authorization       |
| [Channel settings](../assets/images/im-channel-settings.png)            | Slack connection, paired account and verification entry         |
| [Group authorization](../assets/images/im-spaces.png)                   | Native group selection, status and conversation actions         |
| [Light group conversation](../assets/images/im-group-chat.png)          | Synthetic members, request and collaboration result             |
| [Dark group conversation](../assets/images/im-group-chat-dark.png)      | The same group conversation in dark theme                       |

## Reproduction and verification

Use Node.js 26, matching current CI, to run `npm run build`. The capture script uses Playwright's Electron interface. This session had no Browser plugin, so it used environment-provided Playwright without adding a project dependency.

```bash
npm run build
ARTEMIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/ui/capture-readme.mjs /tmp/artemis-readme-capture
```

Without an output directory, the script writes to `docs/assets/images/`. Capture into a temporary directory first and inspect original images before replacing official images and manifests. The script uses macOS titlebar layout and does not replace Windows hardware visual acceptance.

| Check                              | Result for this capture                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Page identity and nonempty content | Actual production page titled Artemis; target pages rendered                                                       |
| Error overlays                     | No Vite error overlay                                                                                              |
| Page and console errors            | Zero `pageerror` and error-level console messages                                                                  |
| Interaction                        | Theme, language, workspace tools, IM group selection/opening and plugin installation dialog/cancellation completed |
| Renderer isolation                 | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`                                                |
| Images                             | All 19 were regenerated at full viewport size; dimensions and SHA-256 match the manifest                           |
| Privacy                            | Visible-text and individual original-resolution inspections passed                                                 |

These results establish this documentation capture and rendering flow. They do not establish real model calls, two-bot IM delivery, provider authorization or complete CI acceptance.

## Architecture diagrams

Both diagrams use self-contained HTML sources, with inline SVG extracted for the README. Their **1280 × 840** canvases retain the Artemis light style, blue emphasis nodes and system fonts, without external fonts, scripts or network resources.

| Diagram                       | Source                                             | README export                                    |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Desktop architecture          | [HTML](../assets/artemis-system-architecture.html) | [SVG](../assets/artemis-system-architecture.svg) |
| Native IM group collaboration | [HTML](../assets/artemis-im-collaboration.html)    | [SVG](../assets/artemis-im-collaboration.svg)    |

The desktop diagram uses eight nodes for Renderer, Main, Pi Agent Host, local state, capabilities/tools, IM services and external services. `PiAdapter` resides in Agent Host and emits Artemis protocol events. Main manages lifecycle, Goals, automations, approvals and Connectors. Model services and external MCP/Connector services are grouped; permission differences are explained beneath the diagram instead of drawing every service separately.

The IM diagram uses five nodes for two independent computers exchanging tasks and results through the same native group. Group dispatch still requires each side's authorization and real IM round-trip verification. Persistent waits, continuation, pending cancellation and unknown status are explained separately. A separate annotation describes paired-owner private chats using local Execute permissions and automatic approval, including projectless temporary sessions.

Semantic sources are `packages/agent-host/src/runtime/runtime.ts`, `packages/protocol/src/im.ts`, desktop `main.ts` / `im-service.ts`, the current Connector v1 contract and native-group routing. Desktop-user Shell/Terminal access, independent MCP/extension sandboxes and restricted group-task tools are represented separately.

Both HTML files passed Diagram Design self-checks and connector geometry checks. Browser inspection verified all text fits its canvas and nodes, system fonts and complete rendering. Exported SVG matches the inline SVG and retains independent accessible titles and descriptions. Colors apply only to these project diagrams; no installed skill or shared styles were changed.
