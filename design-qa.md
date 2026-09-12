# Approval and choice card QA — 2026-09-12

Reference: the user-approved light/dark mock attached in this task. Implementation uses the existing Artemis components and theme tokens, with synthetic reference content rendered in native Electron.

## Visual comparison

- Palm icon replaces the shield; no circular warning surround.
- Waiting and resolved states have visible 7 px semantic status dots in both themes.
- Expanded approval separates the title, command surface, model explanation, recommendation, and compact actions.
- Collapsed approval preserves its operation title and command, with status and disclosure affordance at the right.
- Action buttons use 28 px height and 12 px text; Always allow has no dropdown arrow.
- Unsupported Always allow is absent, along with its scope hint. The scope remains the same operation within the project; this visual change does not broaden authorization.
- Choice rows share a flat bordered list with separators. Radio indicators are vertically centered against the full label/description row; measured deviation is at most 0.51 px.
- Single and multi-question cards use the same typography, palm, status treatment, radio geometry, and submit control. Inactive questions no longer reserve blank vertical space.
- Both 640 px and 300 px container widths were rendered. Commands wrap and controls remain inside the cards. Narrow approvals move the recommendation onto its own line so the three actions can remain together.

Intentional product details beyond the sketch: countdown, custom-answer option, and multi-question progress/navigation are retained. The existing theme palette and font are used, rather than treating the generated mock as exact font/color specifications. This is a component fidelity check, not a claim of pixel identity with a generated bitmap or a packaged release.

## Evidence

- `artifacts/approval-polish/light-components.png`, `dark-components.png`: real source components in Electron.
- `artifacts/approval-polish/light-multi.png`, `dark-multi.png`: multi-question layout.
- `artifacts/approval-polish/light-narrow.png`, `dark-narrow.png`: 300 px containers.
- `artifacts/approval-polish/light-restricted.png`, `dark-restricted.png`: once-only approval.
- `artifacts/approval-polish/geometry-report.json`: status dots, radio alignment, button sizes, retained collapsed content, widths, and hidden unsupported action.
- Reproduce component checks with `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron apps/desktop/scripts/verify-approval-polish.cjs`.

## Validation

Desktop typecheck, production build, UI convergence including negative fixtures, and 29 targeted adapter, choice interaction, and shutdown tests passed. The production build retains the existing large-chunk warning.

The database-closed exception was addressed by ignoring late task-view IPC during shutdown and closing the store after windows close. Native shutdown verification completed without the reported exception.

Final built-production native interaction run passed: 4 cases, 159 assertions, 15 screenshots, covering both themes, mouse selection plus submission, keyboard navigation, IME custom answers, duplicate resolution rejection, legacy single-question input, 200% zoom, timeout, and cancellation. Report: `artifacts/approval-polish/interaction-report.json`.

Result: the reported visual defects and unsupported-action visibility are resolved in the inspected states; no blocking finding remains in this local verification scope.

## Follow-up: compact single-line options

Ordinary options now keep label, recommendation, and description on one line in both single and multi-question menus. Only the custom “Other” row retains two lines. Long descriptions use ellipsis with the full text available on hover; long labels have the same overflow protection. Native light/dark and narrow-container geometry checks were rerun after the change. This follow-up changes presentation only; the prior interaction suite covers the unchanged selection/submission logic.
