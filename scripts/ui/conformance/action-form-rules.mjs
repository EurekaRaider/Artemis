export const CL4_EXPECTED_CSS_RULES = [
  [
    'normal|[data-artemis-component="run-mode-control"], [data-artemis-component="approval-card"], [data-artemis-component="tool-activity"], [data-artemis-component="task-plan"], [data-artemis-component="context-usage"], [data-artemis-component="user-input"], [data-artemis-component="agent-activity"], [data-artemis-component="agent-team-summary"], [data-artemis-component="turn-status"], [data-artemis-component="result-disclosure"]',
    {
      "box-sizing": "border-box",
      "min-inline-size": "0",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"], [data-artemis-component="tool-activity"], [data-artemis-component="context-usage"], [data-artemis-component="user-input"], [data-artemis-component="agent-activity"], [data-artemis-component="agent-team-summary"], [data-artemis-component="result-disclosure"]',
    {
      display: "grid",
      gap: "var(--artemis-space-3)",
      padding: "var(--artemis-space-3)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-card)",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"][data-state="disabled"], [data-artemis-component="approval-card"][data-state="disabled"], [data-artemis-component="tool-activity"][data-state="disabled"], [data-artemis-component="task-plan"][data-state="disabled"], [data-artemis-component="context-usage"][data-state="disabled"], [data-artemis-component="user-input"][data-state="disabled"], [data-artemis-component="agent-activity"][data-state="disabled"], [data-artemis-component="agent-team-summary"][data-state="disabled"]',
    { opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    'normal|[data-artemis-component="approval-card"][data-state="error"], [data-artemis-component="approval-card"][data-state="denied"], [data-artemis-component="tool-activity"][data-state="failed"], [data-artemis-component="task-plan"][data-state="failed"], [data-artemis-component="context-usage"][data-state="error"], [data-artemis-component="user-input"][data-state="error"], [data-artemis-component="agent-activity"][data-state="failed"], [data-artemis-component="agent-team-summary"][data-state="failed"], [data-artemis-component="result-disclosure"][data-state="failed"]',
    {
      background: "var(--artemis-color-status-danger-subtle)",
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"][data-state="timeout"], [data-artemis-component="tool-activity"][data-state="timeout"], [data-artemis-component="task-plan"][data-state="timeout"], [data-artemis-component="context-usage"][data-state="timeout"], [data-artemis-component="user-input"][data-state="timeout"], [data-artemis-component="agent-activity"][data-state="timeout"], [data-artemis-component="agent-team-summary"][data-state="timeout"], [data-artemis-component="result-disclosure"][data-state="timeout"]',
    {
      background: "var(--artemis-color-status-warning-subtle)",
      "border-color": "var(--artemis-color-status-warning)",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"] [data-part="header"]',
    {
      display: "grid",
      "grid-template-columns": "auto minmax(0, 1fr) auto",
      "align-items": "start",
      gap: "var(--artemis-space-3)",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"] [data-part="heading"], [data-artemis-component="agent-activity"] [data-part="description"]',
    {
      display: "grid",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"] [data-part="title"], [data-artemis-component="tool-activity"] [data-part="summary"], [data-artemis-component="user-input"] [data-part="question"], [data-artemis-component="agent-activity"] [data-part="title"], [data-artemis-component="agent-team-summary"] [data-part="title"], [data-artemis-component="result-disclosure"] [data-part="summary"]',
    { "font-weight": "var(--artemis-typography-body-weight)" },
  ],
  [
    'normal|[data-artemis-component="approval-card"] [data-part="description"], [data-artemis-component="approval-card"] [data-part="reason"], [data-artemis-component="user-input"] [data-part="description"], [data-artemis-component="agent-activity"] [data-part="description"], [data-artemis-component="context-usage"] [data-part="detail"], [data-artemis-component="task-plan"] [data-part="step-status"]',
    {
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="status"], [data-artemis-component="approval-card"] [data-part="status"], [data-artemis-component="tool-activity"] [data-part="status"], [data-artemis-component="task-plan"] [data-part="status"], [data-artemis-component="context-usage"] [data-part="status"], [data-artemis-component="user-input"] [data-part="status"], [data-artemis-component="agent-activity"] [data-part="status"], [data-artemis-component="agent-team-summary"] [data-part="status"], [data-artemis-component="result-disclosure"] [data-part="status"]',
    {
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="approval-card"] [data-part="actions"], [data-artemis-component="user-input"] [data-part="actions"], [data-artemis-component="agent-activity"] [data-part="actions"]',
    {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "flex-end",
      gap: "var(--artemis-space-2)",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"]',
    {
      display: "flex",
      "flex-wrap": "wrap",
      gap: "var(--artemis-space-2)",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="option"], [data-artemis-component="user-input"] [data-part="option"], [data-artemis-component="agent-team-summary"] [data-part="member"] > button',
    {
      "box-sizing": "border-box",
      display: "grid",
      gap: "var(--artemis-space-1)",
      "min-block-size": "var(--artemis-size-control-compact)",
      "min-inline-size": "0",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      "text-align": "start",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
      font: "inherit",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="option"][aria-checked="true"], [data-artemis-component="user-input"] [data-part="option"][aria-pressed="true"]',
    {
      background: "var(--artemis-color-interaction-selected)",
      "border-color": "var(--artemis-color-border-strong)",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="option"]:hover:not(:disabled), [data-artemis-component="user-input"] [data-part="option"]:hover:not(:disabled), [data-artemis-component="agent-team-summary"] [data-part="member"] > button:hover:not(:disabled)',
    { background: "var(--artemis-color-interaction-hover)" },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="option"]:focus-visible, [data-artemis-component="user-input"] [data-part="option"]:focus-visible, [data-artemis-component="agent-team-summary"] [data-part="member"] > button:focus-visible, [data-artemis-component="tool-activity"] [data-part="disclosure"]:focus-visible, [data-artemis-component="task-plan"] [data-part="trigger"]:focus-visible, [data-artemis-component="result-disclosure"] [data-part="disclosure"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="run-mode-control"] [data-part="description"], [data-artemis-component="user-input"] [data-part="option"] small',
    {
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="tool-activity"]',
    {
      "grid-template-columns": "auto minmax(0, 1fr) auto auto",
      "align-items": "center",
    },
  ],
  [
    'normal|[data-artemis-component="tool-activity"] [data-part="icon"]',
    {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
    },
  ],
  [
    'normal|[data-artemis-component="tool-activity"] [data-part="content"]',
    { "grid-column": "1 / -1", "min-inline-size": "0" },
  ],
  [
    'normal|[data-artemis-component="tool-activity"] [data-part="content"][hidden], [data-artemis-component="task-plan"] [data-part="steps"][hidden], [data-artemis-component="result-disclosure"] [data-part="content"][hidden]',
    { display: "none" },
  ],
  [
    'normal|[data-artemis-component="tool-activity"] [data-part="disclosure"], [data-artemis-component="result-disclosure"] [data-part="disclosure"]',
    {
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "var(--artemis-space-2)",
      color: "var(--artemis-color-text-secondary)",
      background: "transparent",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
      font: "inherit",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"]',
    { position: "relative", display: "inline-flex" },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="trigger"]',
    {
      display: "inline-flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-pill)",
      font: "inherit",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="steps"]',
    {
      position: "absolute",
      "inset-block-end": "calc(100% + var(--artemis-space-2))",
      "inset-inline-start": "50%",
      "z-index": "1",
      display: "grid",
      gap: "var(--artemis-space-1)",
      "inline-size": "min(32rem, calc(100vw - var(--artemis-space-4)))",
      "max-block-size": "20rem",
      margin: "0",
      overflow: "auto",
      padding: "var(--artemis-space-2)",
      "list-style": "none",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-card)",
      transform: "translateX(-50%)",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="step"]',
    {
      display: "flex",
      "align-items": "flex-start",
      gap: "var(--artemis-space-2)",
      padding: "var(--artemis-space-2)",
      color: "var(--artemis-color-text-secondary)",
      "border-radius": "var(--artemis-radius-control)",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="step"][data-status="in_progress"]',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-selected)",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="marker"]',
    {
      display: "inline-flex",
      flex: "0 0 auto",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "var(--artemis-space-4)",
      "block-size": "var(--artemis-space-4)",
      color: "var(--artemis-color-text-secondary)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-strong)",
      "border-radius": "var(--artemis-radius-pill)",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="marker"][data-status="completed"]',
    {
      color: "var(--artemis-color-status-success)",
      "border-color": "var(--artemis-color-status-success)",
    },
  ],
  [
    'normal|[data-artemis-component="task-plan"] [data-part="marker"][data-status="failed"]',
    {
      color: "var(--artemis-color-status-danger)",
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="context-usage"]',
    { "grid-template-columns": "minmax(0, 1fr) auto" },
  ],
  [
    'normal|[data-artemis-component="context-usage"] [data-part="status"]',
    { "grid-column": "1 / -1" },
  ],
  [
    'normal|[data-artemis-component="context-usage"] [data-part="meter"]',
    {
      "grid-column": "1 / -1",
      "block-size": "var(--artemis-space-2)",
      overflow: "hidden",
      background: "var(--artemis-color-surface-sunken)",
      "border-radius": "var(--artemis-radius-pill)",
    },
  ],
  [
    'normal|[data-artemis-component="context-usage"] [data-part="fill"]',
    {
      display: "block",
      "block-size": "100%",
      background: "var(--artemis-color-accent-primary)",
      "border-radius": "inherit",
    },
  ],
  [
    'normal|[data-artemis-component="context-usage"] [data-part="value"], [data-artemis-component="turn-status"] [data-part="duration"]',
    {
      color: "var(--artemis-color-text-secondary)",
      "font-variant-numeric": "tabular-nums",
    },
  ],
  [
    'normal|[data-artemis-component="user-input"] [data-part="options"], [data-artemis-component="agent-team-summary"] [data-part="members"]',
    {
      display: "grid",
      gap: "var(--artemis-space-2)",
      margin: "0",
      padding: "0",
      "list-style": "none",
    },
  ],
  [
    'normal|[data-artemis-component="agent-team-summary"] [data-part="member"]',
    { "min-inline-size": "0" },
  ],
  [
    'normal|[data-artemis-component="turn-status"]',
    {
      display: "inline-flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-status"] [data-part="indicator"]',
    {
      "inline-size": "var(--artemis-space-2)",
      "block-size": "var(--artemis-space-2)",
      background: "var(--artemis-color-border-strong)",
      "border-radius": "var(--artemis-radius-pill)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-status"][data-state="running"] [data-part="indicator"]',
    { background: "var(--artemis-color-accent-primary)" },
  ],
  [
    'normal|[data-artemis-component="turn-status"][data-state="completed"] [data-part="indicator"]',
    { background: "var(--artemis-color-status-success)" },
  ],
  [
    'normal|[data-artemis-component="turn-status"][data-state="failed"] [data-part="indicator"], [data-artemis-component="turn-status"][data-state="timeout"] [data-part="indicator"]',
    { background: "var(--artemis-color-status-danger)" },
  ],
  [
    'normal|[data-artemis-component="result-disclosure"] [data-part="disclosure"]',
    {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "var(--artemis-space-3)",
      "inline-size": "100%",
    },
  ],
];
