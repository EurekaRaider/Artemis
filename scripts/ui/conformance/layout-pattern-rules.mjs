export const MIG2_EXPECTED_CSS_RULES = [
  [
    'normal|[data-artemis-component="conversation-surface"]',
    {
      position: "relative",
      "container-type": "inline-size",
      display: "flex",
      flex: "1",
      "flex-direction": "column",
      "min-inline-size": "0",
      "min-block-size": "0",
      overflow: "hidden",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="timeline-viewport"]',
    {
      flex: "1 1 0",
      "min-block-size": "0",
      "overflow-y": "auto",
      "overscroll-behavior": "contain",
      "scrollbar-gutter": "stable",
    },
  ],
  [
    'normal|[data-artemis-component="timeline"]',
    {
      "box-sizing": "border-box",
      "inline-size": "100%",
      "max-inline-size": "60rem",
      "margin-inline": "auto",
      padding:
        "calc(var(--artemis-space-6) + var(--artemis-space-2) + 2px) var(--artemis-space-5) var(--artemis-space-6)",
    },
  ],
  [
    'normal|[data-artemis-component="timeline"] > *, [data-artemis-component="timeline-turn"] > *, [data-artemis-component="turn-execution-disclosure"] [data-part="content"] > *',
    {
      contain: "layout paint style",
      "contain-intrinsic-size": "auto 6rem",
      "content-visibility": "auto",
    },
  ],
  [
    'normal|[data-artemis-component="timeline-turn"]',
    {
      display: "flow-root",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"]',
    {
      "padding-block-end": "var(--artemis-space-2)",
      margin: "var(--artemis-space-1) 0 calc(var(--artemis-space-5) + 2px)",
      "border-block-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"] > [data-part="summary"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "var(--artemis-size-control-compact)",
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
      "list-style": "none",
      cursor: "pointer",
      "user-select": "none",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"] > [data-part="summary"]::-webkit-details-marker',
    {
      display: "none",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"] > [data-part="summary"] svg',
    {
      "inline-size": "0.9375rem",
      "block-size": "0.9375rem",
      transition:
        "transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"][open] > [data-part="summary"] svg',
    {
      transform: "rotate(90deg)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-execution-disclosure"] > [data-part="content"]',
    {
      "padding-block-start": "var(--artemis-space-3)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"]',
    {
      position: "relative",
      contain: "layout style",
      "content-visibility": "visible",
      "min-inline-size": "0",
      "margin-block-end":
        "calc(var(--artemis-size-control-compact) + var(--artemis-space-2))",
      color: "var(--artemis-color-text-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"][data-message-kind="user"], [data-artemis-component="conversation-message"][data-message-kind="steering"]',
    {
      "inline-size": "fit-content",
      "max-inline-size": "78%",
      "margin-inline-start": "auto",
      padding:
        "calc(var(--artemis-space-3) - 1px) calc(var(--artemis-space-3) + 2px)",
      "overflow-wrap": "anywhere",
      "white-space": "pre-wrap",
      background: "var(--artemis-color-surface-user)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-surface)",
      "border-radius":
        "var(--artemis-radius-card) var(--artemis-radius-card) calc(var(--artemis-space-1) - 1px) var(--artemis-radius-card)",
      "line-height": "1.55",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="conversation-message"][data-message-kind="user"], [dir="rtl"] [data-artemis-component="conversation-message"][data-message-kind="steering"]',
    {
      "border-radius":
        "var(--artemis-radius-card) var(--artemis-radius-card) var(--artemis-radius-card) calc(var(--artemis-space-1) - 1px)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"][data-message-kind="assistant"]',
    {
      "max-inline-size": "100%",
      "font-size": "calc(var(--artemis-typography-body-size) + 0.5px)",
      "letter-spacing": "normal",
      "line-height": "1.68",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"] [data-part="content"] code',
    {
      "overflow-wrap": "anywhere",
      "font-family": "var(--artemis-typography-mono-family)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"] > [data-part="actions"]',
    {
      position: "absolute",
      "inset-inline-end": "0",
      "inset-block-end":
        "calc((var(--artemis-size-control-compact) - 2px) * -1)",
      "z-index": "2",
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-1)",
      opacity: "0",
      transition: "opacity 120ms ease-out 200ms",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"]:hover > [data-part="actions"], [data-artemis-component="conversation-message"]:focus-within > [data-part="actions"]',
    {
      opacity: "1",
      "transition-delay": "0ms",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"] > [data-part="actions"] button',
    {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "calc(var(--artemis-size-control-compact) - 2px)",
      "block-size": "calc(var(--artemis-size-control-compact) - 2px)",
      padding: "0",
      color: "var(--artemis-color-text-tertiary)",
      background: "transparent",
      border: "var(--artemis-border-width-default) solid transparent",
      "border-radius": "var(--artemis-radius-control)",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"] > [data-part="actions"] button:is(:hover, :focus-visible)',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-hover)",
      "border-color": "var(--artemis-color-border-subtle)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-message"] > [data-part="capabilities"]',
    {
      display: "flex",
      "flex-wrap": "wrap",
      gap: "var(--artemis-space-2)",
      "margin-block-end": "var(--artemis-space-2)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-empty-state"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      "min-block-size": "21.25rem",
      "block-size": "100%",
      padding: "var(--artemis-space-6)",
      "text-align": "center",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-empty-state"] > [data-part="icon"]',
    {
      display: "inline-flex",
      "inline-size": "3.375rem",
      "block-size": "3.375rem",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-empty-state"] > [data-part="title"]',
    {
      "margin-block-start": "calc(var(--artemis-space-5) + 2px)",
    },
  ],
  [
    'normal|[data-artemis-component="conversation-empty-state"] > [data-part="detail"]',
    {
      "margin-block-start": "var(--artemis-space-2)",
      color: "var(--artemis-color-text-tertiary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-change-summary"]',
    {
      margin:
        "calc(var(--artemis-space-4) + 2px) 0 calc(var(--artemis-space-6) + 2px)",
      overflow: "hidden",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-card)",
      "box-shadow": "var(--artemis-shadow-card)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-change-summary"] > [data-part="header"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-3)",
      "min-block-size": "4.875rem",
      padding: "var(--artemis-space-3) var(--artemis-space-4)",
    },
  ],
  [
    'normal|[data-artemis-component="turn-change-summary"][data-state="failed"]',
    {
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-group"]',
    {
      position: "relative",
      display: "flex",
      "flex-direction": "column",
      "align-items": "stretch",
      gap: "var(--artemis-space-2)",
      "max-block-size": "min(17.5rem, 42vh)",
      margin: "0 var(--artemis-space-5) calc(var(--artemis-space-5) * -1)",
      overflow: "auto",
      padding:
        "calc(var(--artemis-space-2) + 2px) var(--artemis-space-3) calc(var(--artemis-space-4) + 2px)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
      "border-block-end": "0",
      "border-radius":
        "var(--artemis-radius-card) var(--artemis-radius-card) 0 0",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-group"] > [data-part="heading"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
      "font-weight": "600",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-group"] > [data-part="items"]',
    {
      display: "grid",
      gap: "var(--artemis-space-2)",
      margin: "0",
      padding: "0",
      "list-style": "none",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-inline-size": "0",
      "min-block-size": "calc(var(--artemis-size-control-compact) + 0.75rem)",
      padding:
        "calc(var(--artemis-space-1) + 2px) calc(var(--artemis-space-2) + 2px)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="index"]',
    {
      display: "inline-flex",
      flex: "0 0 calc(var(--artemis-space-5) + 1px)",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "calc(var(--artemis-space-5) + 1px)",
      "block-size": "calc(var(--artemis-space-5) + 1px)",
      color: "var(--artemis-color-text-secondary)",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-pill)",
      "font-size": "var(--artemis-typography-metadata-size)",
      "font-variant-numeric": "tabular-nums",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="content"]',
    {
      flex: "1 1 auto",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="actions"]',
    {
      display: "flex",
      flex: "0 0 auto",
      "align-items": "center",
      gap: "var(--artemis-space-1)",
      "margin-inline-start": "auto",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="actions"] button',
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "var(--artemis-size-control-compact)",
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "var(--artemis-space-2)",
      color: "var(--artemis-color-text-secondary)",
      background: "transparent",
      border: "0",
      "border-radius": "var(--artemis-radius-control)",
      font: "inherit",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="actions"] button:hover:not(:disabled)',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-hover)",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="actions"] button:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"] > [data-part="actions"] button:disabled',
    {
      cursor: "default",
      opacity: "var(--artemis-opacity-disabled)",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"][data-state="busy"]',
    {
      opacity: "var(--artemis-opacity-disabled)",
    },
  ],
  [
    'normal|[data-artemis-component="queued-message-item"][data-state="failed"]',
    {
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'reduced-motion|[data-artemis-component="turn-execution-disclosure"] > [data-part="summary"] svg, [data-artemis-component="conversation-message"] > [data-part="actions"]',
    {
      transition: "none",
    },
  ],
];
