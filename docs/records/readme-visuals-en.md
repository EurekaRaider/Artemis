[English / 简体中文](readme-visuals.md)

# README visual assets

## Current screenshots

On November 2, 2026, the README's **20 interface screenshots** were recaptured from a local production build of Artemis **2.0.0** on macOS arm64, replacing the 1.7.0 interface assets.

All captures show the real Electron Renderer at **1440 × 850 CSS pixels and 100% zoom**, covering the complete application viewport without cropping or compositing. Themes, language, settings, workspace tools, resources and group conversations use the product's existing controls and host navigation.

The [main manifest](../assets/images/manifest.json) records capture time, application version, source HEAD, working-tree state, build digests, image dimensions and SHA-256. The [environment manifest](../assets/images/environment-manifest.json) records the two environment-panel captures from the same run. The recorded working-tree state bounds the provenance; it does not establish signed-package or three-platform CI acceptance.

## Demonstration data and privacy

- Separate temporary user-data and a Field Notes Git repository avoid personal projects, conversations and global Skills.
- Conversations, child-Agent records, usage, IM members and connections, and two paused automations are synthetic. No model request, real IM account connection or automation execution occurs.
- Terminal runs real `git status --short` in the demonstration repository with a neutral prompt.
- Only the isolated snapshot handler sets the displayed identity to Artemis and suppresses real PR queries; product identity logic stays unchanged.
- The installation image shows and cancels the Computer Use confirmation dialog without installing capabilities or starting account authorization.
- The Chinese capture uses the actual Chinese interface; demonstration project titles and body text remain English.
- The script checks visible text for the system username and personal home path and records page and console errors. Images are reviewed individually before delivery.
- Renderer preferences are `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`.

## Screenshot inventory

| File                                                                        | Content                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [welcome-dark.png](../assets/images/welcome-dark.png)                       | Dark welcome page and task composer                                |
| [workspace-light.png](../assets/images/workspace-light.png)                 | Light task, structured work record and Markdown                    |
| [workspace-dark.png](../assets/images/workspace-dark.png)                   | The same task in dark theme                                        |
| [workspace-zh-CN.png](../assets/images/workspace-zh-CN.png)                 | Chinese navigation and task actions                                |
| [environment-panel-light.png](../assets/images/environment-panel-light.png) | Light workspace environment panel                                  |
| [environment-panel-dark.png](../assets/images/environment-panel-dark.png)   | Dark workspace environment panel                                   |
| [git-review.png](../assets/images/git-review.png)                           | Real repository diff and segmented review scopes                   |
| [markdown-files.png](../assets/images/markdown-files.png)                   | Markdown reader and workspace tabs                                 |
| [terminal.png](../assets/images/terminal.png)                               | Native terminal and Git output                                     |
| [agent-team.png](../assets/images/agent-team.png)                           | Two completed demonstration subtasks                               |
| [resources.png](../assets/images/resources.png)                             | Unified Office entry, Design, Computer Use and resource categories |
| [plugin-install.png](../assets/images/plugin-install.png)                   | Computer Use installation confirmation                             |
| [settings-general.png](../assets/images/settings-general.png)               | General settings and appearance preferences                        |
| [token-usage.png](../assets/images/token-usage.png)                         | Synthetic usage, heatmap and statistics                            |
| [automations.png](../assets/images/automations.png)                         | Two paused weekly tasks                                            |
| [im-connections.png](../assets/images/im-connections.png)                   | Message integrations, channels and group authorization             |
| [im-channel-settings.png](../assets/images/im-channel-settings.png)         | Synthetic Slack connection settings                                |
| [im-spaces.png](../assets/images/im-spaces.png)                             | Group project authorization and members                            |
| [im-group-chat.png](../assets/images/im-group-chat.png)                     | Light group conversation and context                               |
| [im-group-chat-dark.png](../assets/images/im-group-chat-dark.png)           | The same group conversation in dark theme                          |

## Reproduction and verification

Use Node.js 26 as in CI, build first, and capture through the existing Playwright Electron interface. The Browser plugin skill was unavailable in this session, so the environment's existing Playwright was used without adding project dependencies.

```bash
npm run build
ARTEMIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/ui/capture-readme.mjs /tmp/artemis-readme-capture
```

Without an output directory, the script writes to `docs/assets/images/`. Inspect every original and its manifest in a temporary directory before replacing official assets. Checks cover page title and meaningful content, absence of framework error overlays, page and console errors, theme and language changes, tool navigation, group conversations, installation confirmation and cancellation, privacy, dimensions, file sizes and SHA-256.

Architecture and permission diagrams using obsolete mode terminology or omitting macOS x64 have been removed with their source files. The [architecture documentation](../architecture.md) and README prose and tables describe the current system.

These assets establish documentation rendering and capture results, without claiming real model calls, IM delivery, provider authorization, Windows hardware visual acceptance or signed-package acceptance.
