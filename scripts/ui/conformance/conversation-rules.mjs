export const CL3_EXPECTED_CSS_RULES = [
  [
    'normal|[data-artemis-component="tooltip-anchor"]',
    {
      display: "inline-flex",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="tooltip"], [data-artemis-component="popover"]',
    {
      position: "fixed",
      "box-sizing": "border-box",
      "max-inline-size": "min(22rem, calc(100vw - var(--artemis-space-4)))",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "box-shadow": "var(--artemis-shadow-overlay)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="tooltip"]',
    {
      "z-index": "80",
      padding: "6px 9px",
      color: "#f5f5f7",
      background: "#24252a",
      "border-color": "rgb(255 255 255 / 0.12)",
      "box-shadow": "0 4px 12px rgb(0 0 0 / 12%)",
      "border-radius": "7px",
      "pointer-events": "none",
    },
  ],
  [
    'normal|[data-artemis-component="popover"]',
    {
      "z-index": "80",
      "min-inline-size": "12rem",
      "max-block-size": "calc(100vh - var(--artemis-space-4))",
      overflow: "auto",
      padding: "var(--artemis-space-3)",
      "border-radius": "var(--artemis-radius-card)",
    },
  ],
  [
    'normal|[data-artemis-component="popover"] > [data-part="content"], [data-artemis-component="dialog"] > [data-part="content"]',
    {
      display: "contents",
    },
  ],
  [
    'normal|[data-artemis-component="popover"]:focus-visible, [data-artemis-component="dialog"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="dialog"]',
    {
      "box-sizing": "border-box",
      "inline-size": "min(27.5rem, calc(100vw - var(--artemis-space-6)))",
      "max-inline-size": "calc(100vw - var(--artemis-space-6))",
      "max-block-size": "calc(100vh - var(--artemis-space-6))",
      overflow: "auto",
      margin: "auto",
      padding: "var(--artemis-space-6)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-panel)",
      "box-shadow": "var(--artemis-shadow-overlay)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="dialog"]::backdrop',
    {
      background: "var(--artemis-color-overlay-scrim)",
      "backdrop-filter": "none",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"]',
    {
      display: "grid",
      gap: "var(--artemis-space-3)",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"] [data-part="icon"]',
    {
      color: "var(--artemis-color-accent-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"][data-tone="danger"] [data-part="icon"]',
    {
      color: "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"] [data-part="title"]',
    {
      "font-size":
        "calc( var(--artemis-typography-body-size) + var(--artemis-space-1) )",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"] [data-part="description"]',
    {
      color: "var(--artemis-color-text-secondary)",
      "line-height": "1.5",
    },
  ],
  [
    'normal|[data-artemis-component="confirmation"] [data-part="actions"]',
    {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "flex-end",
      gap: "var(--artemis-space-2)",
      "margin-block-start": "var(--artemis-space-2)",
    },
  ],
  [
    "normal|[data-artemis-toast-viewport]",
    {
      position: "fixed",
      "z-index": "100",
      "inset-block-end": "var(--artemis-space-4)",
      "inset-inline-end": "var(--artemis-space-4)",
      display: "grid",
      gap: "var(--artemis-space-2)",
      "inline-size": "min(24rem, calc(100vw - var(--artemis-space-6)))",
      "pointer-events": "none",
    },
  ],
  [
    'normal|[data-artemis-component="toast"]',
    {
      "--_artemis-toast-icon-color": "var(--artemis-color-text-secondary)",
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      gap: "10px",
      "justify-content": "space-between",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      padding: "10px 10px 10px 14px",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-popover)",
      border: "0",
      "border-radius": "11px",
      "box-shadow": "var(--artemis-shadow-overlay)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
      "pointer-events": "auto",
      transition:
        "opacity var(--artemis-motion-duration-normal) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-normal) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-tone="success"]',
    {
      "--_artemis-toast-icon-color": "var(--artemis-color-status-success)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-tone="warning"]',
    {
      "--_artemis-toast-icon-color": "var(--artemis-color-status-warning)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-tone="danger"]',
    {
      "--_artemis-toast-icon-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-state="exiting"]',
    {
      opacity: "0",
      transform: "translateY(var(--artemis-space-2))",
    },
  ],
  [
    'normal|[data-artemis-component="toast"] [data-part="action"]',
    {
      flex: "0 0 auto",
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
    'normal|[data-artemis-component="toast"] [data-part="action"]:hover',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-hover)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"] [data-part="action"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"], [data-artemis-component="error-state"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "flex-start",
      gap: "var(--artemis-space-3)",
      "min-inline-size": "0",
      padding: "var(--artemis-space-3) var(--artemis-space-4)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-status-info-subtle)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-status-info)",
      "border-radius": "var(--artemis-radius-card)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="neutral"]',
    {
      background: "var(--artemis-color-surface-sunken)",
      "border-color": "var(--artemis-color-border-default)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="success"]',
    {
      background: "var(--artemis-color-status-success-subtle)",
      "border-color": "var(--artemis-color-status-success)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="warning"]',
    {
      background: "var(--artemis-color-status-warning-subtle)",
      "border-color": "var(--artemis-color-status-warning)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="danger"], [data-artemis-component="error-state"]',
    {
      background: "var(--artemis-color-status-danger-subtle)",
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone]',
    {
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-secondary)",
      background: "var(--artemis-color-surface-sunken)",
      "border-color": "var(--artemis-color-border-subtle)",
      "border-radius": "var(--artemis-radius-control)",
      "font-size": "var(--artemis-typography-metadata-size)",
      "line-height": "1.5",
      "overflow-wrap": "anywhere",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"] > [data-part="icon"]',
    {
      display: "inline-flex",
      "align-items": "center",
      flex: "0 0 auto",
      "block-size": "1.5em",
      color: "var(--artemis-color-text-tertiary)",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="warning"] > [data-part="icon"]',
    { color: "var(--artemis-color-status-warning)" },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="danger"] > [data-part="icon"]',
    { color: "var(--artemis-color-status-danger)" },
  ],
  [
    'normal|[data-artemis-component="inline-notice"][data-tone="success"] > [data-part="icon"]',
    { color: "var(--artemis-color-status-success)" },
  ],
  [
    'normal|[data-artemis-component="inline-notice"] [data-part="message"], [data-artemis-component="error-state"] [data-part="message"]',
    {
      display: "grid",
      flex: "1 1 auto",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="inline-notice"] [data-part="action"], [data-artemis-component="error-state"] [data-part="action"]',
    {
      flex: "0 0 auto",
    },
  ],
  [
    'normal|[data-artemis-component="empty-state"], [data-artemis-component="loading-state"]',
    {
      "box-sizing": "border-box",
      display: "grid",
      "place-items": "center",
      gap: "var(--artemis-space-3)",
      "min-block-size": "10rem",
      padding: "var(--artemis-space-6)",
      color: "var(--artemis-color-text-secondary)",
      "text-align": "center",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="empty-state"] [data-part="title"]',
    {
      color: "var(--artemis-color-text-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="loading-state"] [data-part="skeleton"]',
    {
      display: "grid",
      gap: "var(--artemis-space-2)",
      "inline-size": "min(24rem, 100%)",
    },
  ],
  [
    'normal|[data-artemis-component="loading-state"] [data-part="skeleton"] > i',
    {
      display: "block",
      "block-size": "var(--artemis-space-3)",
      background:
        "linear-gradient( 90deg, var(--artemis-color-surface-sunken), var(--artemis-color-interaction-hover), var(--artemis-color-surface-sunken) )",
      "background-size": "200% 100%",
      "border-radius": "var(--artemis-radius-pill)",
      animation: "artemis-loading-sweep 1.4s linear infinite",
    },
  ],
  [
    'normal|[data-artemis-component="loading-state"] [data-part="skeleton"] > i:last-child',
    {
      "inline-size": "70%",
    },
  ],
  [
    'normal|[data-artemis-component="toolbar"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "var(--artemis-space-3)",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      "min-inline-size": "0",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      "border-block-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="toolbar"] [data-part="leading"], [data-artemis-component="toolbar"] [data-part="actions"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="toolbar"] [data-part="actions"]',
    {
      flex: "0 0 auto",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-3)",
      "inline-size": "100%",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      "min-inline-size": "0",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      "text-align": "start",
      background: "transparent",
      border: "var(--artemis-border-width-default) solid transparent",
      "border-radius": "var(--artemis-radius-control)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"]:hover:not(:disabled)',
    {
      background: "var(--artemis-color-interaction-hover)",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"][data-state="selected"]',
    {
      background: "var(--artemis-color-interaction-selected)",
      "border-color": "var(--artemis-color-border-strong)",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"][data-state="disabled"]',
    {
      cursor: "default",
      opacity: "var(--artemis-opacity-disabled)",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"] [data-part="content"]',
    {
      display: "grid",
      flex: "1 1 auto",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"] [data-part="description"]',
    {
      overflow: "hidden",
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    },
  ],
  [
    'normal|[data-artemis-component="list-row"] [data-part="accessory"]',
    {
      flex: "0 0 auto",
      color: "var(--artemis-color-text-secondary)",
    },
  ],
  [
    'normal|[data-artemis-component="panel-header"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "var(--artemis-space-4)",
      "min-inline-size": "0",
      padding: "var(--artemis-space-4)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      "border-block-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
      "font-family": "var(--artemis-typography-body-family)",
    },
  ],
  [
    'normal|[data-artemis-component="panel-header"] [data-part="content"]',
    {
      display: "grid",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="panel-header"] [data-part="title"]',
    {
      margin: "0",
      "font-size":
        "calc( var(--artemis-typography-body-size) + var(--artemis-space-1) )",
    },
  ],
  [
    'normal|[data-artemis-component="panel-header"] [data-part="description"]',
    {
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="scroll-area"]',
    {
      display: "grid",
      "min-block-size": "0",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="scroll-area"] [data-part="viewport"]',
    {
      "box-sizing": "border-box",
      "min-block-size": "0",
      "min-inline-size": "0",
      overflow: "auto",
      "scrollbar-gutter": "stable",
    },
  ],
  [
    'normal|[data-artemis-component="scroll-area"] [data-part="viewport"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "-2px",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"]',
    {
      "box-sizing": "border-box",
      display: "grid",
      "grid-template-columns":
        "minmax(0, var(--_artemis-split-pane-size)) var(--artemis-space-2) minmax(0, 1fr)",
      "min-block-size": "0",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"] [data-part="primary"], [data-artemis-component="split-pane"] [data-part="secondary"]',
    {
      "min-block-size": "0",
      "min-inline-size": "0",
      overflow: "hidden",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"] [data-part="separator"]',
    {
      position: "relative",
      "min-inline-size": "var(--artemis-space-2)",
      background: "var(--artemis-color-surface-sunken)",
      cursor: "col-resize",
      "touch-action": "none",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"] [data-part="separator"]::after',
    {
      position: "absolute",
      "inset-block": "0",
      "inset-inline-start":
        "calc(50% - var(--artemis-border-width-default) / 2)",
      "inline-size": "var(--artemis-border-width-default)",
      content: '""',
      background: "var(--artemis-color-border-default)",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"] [data-part="separator"]:hover::after, [data-artemis-component="split-pane"] [data-part="separator"]:focus-visible::after',
    {
      background: "var(--artemis-color-accent-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"] [data-part="separator"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "-2px",
    },
  ],
  [
    'normal|[data-artemis-component="split-pane"][data-state="disabled"] [data-part="separator"]',
    {
      cursor: "default",
      opacity: "var(--artemis-opacity-disabled)",
    },
  ],
  [
    'reduced-motion|[data-artemis-component="toast"]',
    {
      transition: "none",
      transform: "none",
    },
  ],
  [
    'reduced-motion|[data-artemis-component="loading-state"] [data-part="skeleton"] > i',
    {
      animation: "none",
    },
  ],
  [
    'reduced-motion|[data-artemis-component="split-pane"] [data-part="separator"]::after',
    {
      transition: "none",
    },
  ],
];
