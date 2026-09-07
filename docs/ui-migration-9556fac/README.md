# Latest prototype migration

Specification: commit `9556fac`, `docs/ui-prototype/artemis-ui.html` and its
complete local dependency tree, pinned in `prototype-manifest.json`. The v69
record in `docs/discussion-151` is historical and remains unchanged.

The product uses the existing React components, data owners and IPC. Prototype
fixtures, browser globals and simulated successful operations are not runtime
inputs. The requested monochrome appearance, focus treatment and tiered contrast
policy supersede the previous visual baseline, not the keyboard or policy tests.

## Capability and acceptance ledger

| Surface         | Production owner                             | Operations retained                                                                               | Required scenarios                                                                   |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Navigation      | App / NavigationSidebar                      | Search, project and task ordering, drag, context menus, archive, temporary tasks, source identity | Expanded, 48px rail, peek, pin, instant collapse, focus, saved width, narrow and RTL |
| Composer        | App / ComposerContextBar                     | Drafts, attachments, queue edit/steer, modes, model/reasoning selection, submit and stop          | Empty, typing, busy, stream, stop, failed send, model search, project switch         |
| Conversation    | App / conversation components                | Markdown, tool groups, approvals, multi-question replies, retry                                   | Streaming, settled, error, scroll retention, queued input and approval races         |
| Goals and plans | GoalBar / GoalEditorPanel / TaskPlanProgress | Budget, pause, resume, clear, edit and plan steps                                                 | Every goal status, long objective, narrow input, floating progress and expanded plan |
| Environment     | EnvironmentPanel                             | Git actions, members, sources, agent/team navigation                                              | Loading, failure, nested menu, open/closed Dock, overlay hit testing                 |
| Dock            | Workspace components / TerminalPanel         | File and Markdown editing, Review, Terminal, Browser, Sources, Goal, child agent and team         | Nine views, dirty buffer, close/reopen, resize, theme switch without remount         |
| Settings        | SettingsPanel                                | General, providers/models, agent, execution, maintenance and IM                                   | Save, cancel, validation, import, diagnostics, download/install/error/rollback       |
| IM              | ImSettingsPanel and existing subcomponents   | Gateway, connections, grants, pairing, accounts, spaces, handoff, migration, diagnostics          | Wizard/manage/compact, offline, partial failure, expiry, refreshing races            |
| Resources       | ResourceCenter / McpServerEditor             | All resource categories, install, configuration and trust                                         | List/detail, empty, loading, error, edit, enable and remove                          |
| Archive         | ArchivePage                                  | Search, restore, open and delete                                                                  | Empty, populated, filtering and confirmation                                         |
| Usage           | TokenUsagePage / TokenUsageHeatmap           | Filters, aggregates, chart details and keyboard heatmap                                           | Zero/populated, five levels, light/dark, tooltip and RTL                             |
| Automation      | AutomationPage                               | Create, edit, enable, pause, delete and open runs                                                 | Empty/populated, invalid schedule, pending and failure                               |

## Evidence

Implementation checks and runtime evidence are recorded separately. Existing
prototype reports and v69 screenshots do not establish current acceptance.
Browser policy blocked opening the local prototype during planning; do not
substitute a different browser or transport to bypass that restriction.

Migration is accepted only when the capability ledger, engineering checks and
native visual/interaction evidence pass. Unavailable platforms and live external
accounts remain explicit boundaries. No commit, push or release is implied.

## Current implementation result

See [acceptance.md](acceptance.md) for completed checks, artifact paths and remaining acceptance gaps. The implementation and native checks are available; whole-prototype visual acceptance is still open.
