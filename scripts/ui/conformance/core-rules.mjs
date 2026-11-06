export const PROBE = '[data-artemis-component="conformance-probe"]';

export const BUTTON = '[data-artemis-component="button"]';

export const ICON_BUTTON = '[data-artemis-component="icon-button"]';

export const ICON = '[data-artemis-component="icon"]';

export const BADGE = '[data-artemis-component="badge"]';

export const STATUS = '[data-artemis-component="status"]';

export const expectedCssRules = new Map([
  [
    `normal|${PROBE}`,
    {
      display: "grid",
      gap: "var(--artemis-space-1)",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    `normal|${PROBE} [data-part="label"]`,
    {
      color: "var(--artemis-color-text-primary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    `normal|${PROBE} [data-part="control"]`,
    {
      "box-sizing": "border-box",
      "min-inline-size": "0",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-input)",
      font: "inherit",
      transition:
        "border-color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    `normal|${PROBE} [data-part="control"]:focus-visible`,
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    `normal|${PROBE} [data-part="description"], ${PROBE} [data-part="error"]`,
    {
      "min-block-size": "var(--artemis-space-3)",
      margin: "0",
      color: "var(--artemis-color-text-secondary)",
    },
  ],
  [
    `normal|${PROBE} [data-part="error"]`,
    { color: "var(--artemis-color-status-danger)" },
  ],
  [
    `normal|${PROBE}[data-state="disabled"]`,
    { opacity: "var(--artemis-opacity-disabled)" },
  ],
  [`reduced-motion|${PROBE} [data-part="control"]`, { transition: "none" }],
  [
    `normal|${BUTTON}, ${ICON_BUTTON}`,
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "var(--artemis-size-control-compact)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-label-size)",
      "font-weight": "var(--artemis-typography-body-weight)",
      "line-height": "1",
      cursor: "pointer",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), border-color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [`normal|${BUTTON}`, { "padding-inline": "var(--artemis-space-3)" }],
  [`normal|${BUTTON} > [data-part="label"]`, { display: "contents" }],
  [`normal|${BUTTON}[data-size="compact"]`, { "padding-inline": "9px" }],
  [
    `normal|${BUTTON} > [data-part="icon"], ${ICON_BUTTON} > [data-part="icon"]`,
    {
      display: "inline-flex",
      flex: "0 0 auto",
      "align-items": "center",
      "justify-content": "center",
    },
  ],
  [`normal|${BUTTON}[data-align="start"]`, { "justify-content": "flex-start" }],
  [
    `normal|${ICON_BUTTON}`,
    {
      position: "relative",
      gap: "0",
      "inline-size": "var(--artemis-size-control-compact)",
      overflow: "hidden",
      padding: "0",
    },
  ],
  [
    `normal|${BUTTON}[data-size="comfortable"], ${ICON_BUTTON}[data-size="comfortable"]`,
    { "min-block-size": "var(--artemis-size-control-comfortable)" },
  ],
  [
    `normal|${ICON_BUTTON}[data-size="comfortable"]`,
    { "inline-size": "var(--artemis-size-control-comfortable)" },
  ],
  [
    `normal|${BUTTON}[data-variant="primary"]`,
    {
      color: "var(--artemis-color-accent-on-primary)",
      background: "var(--artemis-color-accent-primary)",
      "border-color": "var(--artemis-color-accent-primary)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="secondary"], ${ICON_BUTTON}[data-variant="secondary"]`,
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="quiet"], ${ICON_BUTTON}[data-variant="quiet"]`,
    {
      color: "var(--artemis-color-text-secondary)",
      background: "transparent",
      "border-color": "transparent",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="danger"], ${ICON_BUTTON}[data-variant="danger"]`,
    {
      color: "var(--artemis-color-status-on-danger)",
      background: "var(--artemis-color-status-danger)",
      "border-color": "var(--artemis-color-status-danger)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="primary"]:hover:not(:disabled)`,
    {
      background: "var(--artemis-color-accent-hover)",
      "border-color": "var(--artemis-color-accent-hover)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="secondary"]:hover:not(:disabled), ${ICON_BUTTON}[data-variant="secondary"]:hover:not(:disabled)`,
    {
      background: "var(--artemis-color-surface-sunken)",
      "border-color": "var(--artemis-color-border-default)",
      color: "var(--artemis-color-text-primary)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="quiet"]:hover:not(:disabled), ${ICON_BUTTON}[data-variant="quiet"]:hover:not(:disabled)`,
    {
      background: "var(--artemis-color-surface-sunken)",
      "border-color": "transparent",
      color: "var(--artemis-color-text-primary)",
    },
  ],
  [
    `normal|${BUTTON}[data-variant="danger"]:hover:not(:disabled), ${ICON_BUTTON}[data-variant="danger"]:hover:not(:disabled)`,
    { "border-color": "var(--artemis-color-border-strong)" },
  ],
  [
    `normal|${BUTTON}:active:not(:disabled), ${ICON_BUTTON}:active:not(:disabled)`,
    { transform: "scale(0.97)" },
  ],
  [
    `normal|${BUTTON}:focus-visible, ${ICON_BUTTON}:focus-visible`,
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    `normal|${BUTTON}[data-state="selected"], ${ICON_BUTTON}[data-state="selected"]`,
    {
      background: "var(--artemis-color-interaction-selected)",
      "box-shadow":
        "inset 0 0 0 var(--artemis-border-width-default) var(--artemis-color-border-strong)",
    },
  ],
  [
    `normal|${BUTTON}[data-state="disabled"], ${BUTTON}[data-state="loading"], ${ICON_BUTTON}[data-state="disabled"], ${ICON_BUTTON}[data-state="loading"]`,
    { cursor: "default", opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    `normal|${BUTTON} [data-part="state-indicator"], ${ICON_BUTTON} [data-part="state-indicator"]`,
    {
      flex: "0 0 auto",
      color: "currentColor",
      "font-size": "var(--artemis-typography-label-size)",
      "font-weight": "var(--artemis-typography-body-weight)",
    },
  ],
  [
    `normal|${BUTTON}[data-state="ready"] > [data-part="state-indicator"], ${BUTTON}[data-state="disabled"] > [data-part="state-indicator"], ${ICON_BUTTON}[data-state="ready"] > [data-part="state-indicator"], ${ICON_BUTTON}[data-state="disabled"] > [data-part="state-indicator"]`,
    { display: "none" },
  ],
  [
    `normal|${ICON_BUTTON} > [data-part="state-indicator"]`,
    {
      position: "absolute",
      "inset-block-end": "var(--artemis-space-1)",
      "inset-inline-end": "var(--artemis-space-1)",
      "font-size": "var(--artemis-space-2)",
      "line-height": "1",
      "pointer-events": "none",
    },
  ],
  [
    `normal|${ICON}`,
    {
      display: "inline-flex",
      flex: "0 0 auto",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "1em",
      "block-size": "1em",
      color: "currentColor",
      "line-height": "1",
    },
  ],
  [`normal|${ICON}[data-size="xs"]`, { "font-size": "var(--artemis-space-3)" }],
  [
    `normal|${ICON}[data-size="sm"]`,
    {
      "font-size": "calc(var(--artemis-space-3) + var(--artemis-space-1) / 2)",
    },
  ],
  [
    `normal|${ICON}[data-size="base"]`,
    { "font-size": "var(--artemis-space-4)" },
  ],
  [
    `normal|${ICON}[data-size="lg"]`,
    {
      "font-size": "calc(var(--artemis-space-4) + var(--artemis-space-1))",
    },
  ],
  [`normal|${ICON}[data-size="xl"]`, { "font-size": "var(--artemis-space-6)" }],
  [
    `normal|${ICON} > svg`,
    { display: "block", "inline-size": "1em", "block-size": "1em" },
  ],
  [
    `normal|${BADGE}, ${STATUS}`,
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      gap: "6px",
      "min-block-size": "22px",
      "min-inline-size": "0",
      padding: "0 8px",
      color: "var(--artemis-color-text-secondary)",
      background: "var(--artemis-color-surface-sunken)",
      border: "0",
      "border-radius": "var(--artemis-radius-pill)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-label-size)",
      "font-weight": "500",
      "line-height": "1.5",
      "white-space": "nowrap",
    },
  ],
  [
    `normal|${BADGE} [data-part="indicator"], ${STATUS} [data-part="indicator"]`,
    {
      flex: "0 0 auto",
      "inline-size":
        "calc( var(--artemis-space-1) + var(--artemis-border-width-default) * 2 )",
      "block-size":
        "calc( var(--artemis-space-1) + var(--artemis-border-width-default) * 2 )",
      background: "var(--artemis-color-border-strong)",
      "border-radius": "var(--artemis-radius-pill)",
    },
  ],
  [
    `normal|${BADGE} [data-part="indicator"][data-icon="true"], ${STATUS} [data-part="indicator"][data-icon="true"]`,
    {
      display: "inline-flex",
      "align-items": "center",
      "inline-size": "auto",
      "block-size": "auto",
      background: "transparent",
      "border-radius": "0",
    },
  ],
  [
    `normal|${BADGE}[data-tone="info"], ${STATUS}[data-tone="info"]`,
    {
      color: "var(--artemis-color-status-info)",
      background: "var(--artemis-color-status-info-subtle)",
    },
  ],
  [
    `normal|${BADGE}[data-tone="success"], ${STATUS}[data-tone="success"]`,
    {
      color: "var(--artemis-color-status-success-text)",
      background: "var(--artemis-color-status-success-subtle)",
    },
  ],
  [
    `normal|${BADGE}[data-tone="warning"], ${STATUS}[data-tone="warning"]`,
    {
      color: "var(--artemis-color-status-warning-text)",
      background: "var(--artemis-color-status-warning-subtle)",
    },
  ],
  [
    `normal|${BADGE}[data-tone="danger"], ${STATUS}[data-tone="danger"]`,
    {
      color: "var(--artemis-color-status-danger-text)",
      background: "var(--artemis-color-status-danger-subtle)",
    },
  ],
  [
    `normal|${BADGE}[data-tone="info"] [data-part="indicator"], ${STATUS}[data-tone="info"] [data-part="indicator"]`,
    { background: "var(--artemis-color-status-info)" },
  ],
  [
    `normal|${BADGE}[data-tone="success"] [data-part="indicator"], ${STATUS}[data-tone="success"] [data-part="indicator"]`,
    { background: "var(--artemis-color-status-success)" },
  ],
  [
    `normal|${BADGE}[data-tone="warning"] [data-part="indicator"], ${STATUS}[data-tone="warning"] [data-part="indicator"]`,
    { background: "var(--artemis-color-status-warning)" },
  ],
  [
    `normal|${BADGE}[data-tone="danger"] [data-part="indicator"], ${STATUS}[data-tone="danger"] [data-part="indicator"]`,
    { background: "var(--artemis-color-status-danger)" },
  ],
  [`normal|${STATUS}`, { "font-variant-numeric": "tabular-nums" }],
  [
    'normal|[data-artemis-component="text-field"], [data-artemis-component="textarea-field"], [data-artemis-component="search-field"], [data-artemis-component="select"]',
    {
      position: "relative",
      "box-sizing": "border-box",
      display: "grid",
      gap: "var(--artemis-space-1)",
      "min-inline-size": "0",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="label"], [data-artemis-component="textarea-field"] [data-part="label"], [data-artemis-component="search-field"] [data-part="label"], [data-artemis-component="select"] [data-part="label"], [data-artemis-component="checkbox"] [data-part="label"], [data-artemis-component="switch"] [data-part="label"]',
    {
      color: "var(--artemis-color-text-primary)",
      "font-size": "var(--artemis-typography-label-size)",
      "font-weight": "var(--artemis-typography-body-weight)",
    },
  ],
  [
    'normal|[data-artemis-component][data-label-visibility="hidden"] [data-part="label"]',
    {
      position: "absolute",
      "inline-size": "1px",
      "block-size": "1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      "clip-path": "inset(50%)",
      "white-space": "nowrap",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="control"], [data-artemis-component="textarea-field"] [data-part="control"], [data-artemis-component="search-field"] [data-part="control"], [data-artemis-component="select"] [data-part="trigger"], [data-artemis-component="select"] [data-part="search"]',
    {
      "box-sizing": "border-box",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      "min-inline-size": "0",
      "inline-size": "100%",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-input)",
      font: "inherit",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), border-color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"][data-size="compact"] [data-part="control"], [data-artemis-component="textarea-field"][data-size="compact"] [data-part="control"], [data-artemis-component="search-field"][data-size="compact"] [data-part="control"]',
    { "min-block-size": "var(--artemis-size-control-compact)" },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="control"]:focus-visible, [data-artemis-component="textarea-field"] [data-part="control"]:focus-visible, [data-artemis-component="search-field"] [data-part="control"]:focus-visible, [data-artemis-component="select"] [data-part="trigger"]:focus-visible, [data-artemis-component="select"] [data-part="search"]:focus-visible, [data-artemis-component="select"] [data-part="listbox"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"][data-state="error"] [data-part="control"], [data-artemis-component="textarea-field"][data-state="error"] [data-part="control"], [data-artemis-component="search-field"][data-state="error"] [data-part="control"], [data-artemis-component="select"][data-state="error"] [data-part="trigger"]',
    { "border-color": "var(--artemis-color-status-danger)" },
  ],
  [
    'normal|[data-artemis-component="text-field"][data-state="disabled"], [data-artemis-component="textarea-field"][data-state="disabled"], [data-artemis-component="search-field"][data-state="disabled"], [data-artemis-component="select"][data-state="disabled"], [data-artemis-component="checkbox"][data-state="disabled"], [data-artemis-component="switch"][data-state="disabled"]',
    { cursor: "default", opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="description"], [data-artemis-component="textarea-field"] [data-part="description"], [data-artemis-component="search-field"] [data-part="description"], [data-artemis-component="select"] [data-part="description"], [data-artemis-component="checkbox"] [data-part="description"], [data-artemis-component="switch"] [data-part="description"], [data-artemis-component="text-field"] [data-part="error"], [data-artemis-component="textarea-field"] [data-part="error"], [data-artemis-component="search-field"] [data-part="error"], [data-artemis-component="select"] [data-part="error"], [data-artemis-component="checkbox"] [data-part="error"], [data-artemis-component="switch"] [data-part="error"]',
    {
      margin: "0",
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="error"], [data-artemis-component="textarea-field"] [data-part="error"], [data-artemis-component="search-field"] [data-part="error"], [data-artemis-component="select"] [data-part="error"], [data-artemis-component="checkbox"] [data-part="error"], [data-artemis-component="switch"] [data-part="error"]',
    { color: "var(--artemis-color-text-primary)" },
  ],
  [
    'normal|[data-artemis-component="textarea-field"] [data-part="control"]',
    {
      "min-block-size": "calc(var(--artemis-size-control-comfortable) * 4)",
      "line-height": "1.5",
      resize: "vertical",
    },
  ],
  [
    'normal|[data-artemis-component="search-field"] [data-part="icon"]',
    {
      position: "absolute",
      "inset-block-start":
        "calc( var(--artemis-size-control-comfortable) / 2 - var(--artemis-space-2) )",
      "inset-inline-start": "var(--artemis-space-3)",
      display: "inline-flex",
      "inline-size": "var(--artemis-space-4)",
      "block-size": "var(--artemis-space-4)",
      color: "var(--artemis-color-text-secondary)",
      "pointer-events": "none",
    },
  ],
  [
    'normal|[data-artemis-component="search-field"][data-label-visibility="visible"] [data-part="icon"]',
    {
      "inset-block-start":
        "calc( var(--artemis-typography-label-size) + var(--artemis-space-1) + var(--artemis-size-control-comfortable) / 2 - var(--artemis-space-2) )",
    },
  ],
  [
    'normal|[data-artemis-component="search-field"][data-size="compact"] [data-part="icon"]',
    {
      "inset-block-start":
        "calc( var(--artemis-size-control-compact) / 2 - var(--artemis-space-2) )",
    },
  ],
  [
    'normal|[data-artemis-component="search-field"][data-size="compact"][data-label-visibility="visible"] [data-part="icon"]',
    {
      "inset-block-start":
        "calc( var(--artemis-typography-label-size) + var(--artemis-space-1) + var(--artemis-size-control-compact) / 2 - var(--artemis-space-2) )",
    },
  ],
  [
    'normal|[data-artemis-component="search-field"] [data-part="icon"] > svg',
    { "inline-size": "100%", "block-size": "100%" },
  ],
  [
    'normal|[data-artemis-component="search-field"] [data-part="control"]',
    {
      "padding-inline-start":
        "calc( var(--artemis-space-3) + var(--artemis-space-4) + var(--artemis-space-2) )",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="trigger"], [data-artemis-component="select"] [data-part="search"]',
    {
      "min-block-size": "30px",
      padding: "0 8px",
      "padding-inline-start": "10px",
      "font-size": "12.5px",
      "line-height": "1.5",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="trigger"]',
    {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "8px",
      "text-align": "start",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="value"], [data-artemis-component="select"] [data-part="option"] > span:not([data-part="check"])',
    {
      "min-inline-size": "0",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="indicator"]',
    {
      display: "inline-flex",
      flex: "0 0 auto",
      "inline-size": "14px",
      "block-size": "14px",
      color: "var(--artemis-color-text-tertiary)",
      transition:
        "transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="indicator"] > svg',
    { "inline-size": "100%", "block-size": "100%" },
  ],
  [
    'normal|[data-artemis-component="select"][data-state="open"] [data-part="indicator"]',
    { transform: "rotate(180deg)" },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="menu"]',
    {
      position: "absolute",
      "z-index": "20",
      "inset-block-start": "calc(var(--select-anchor-end, 100%) + 10px)",
      "inset-inline-start": "0",
      "box-sizing": "border-box",
      "inline-size": "max-content",
      "min-inline-size": "min(100%, 12rem)",
      "max-inline-size": "20rem",
      "font-size": "var(--artemis-typography-body-size)",
      "line-height": "1.5",
      overflow: "hidden",
      padding: "5px",
      background: "var(--artemis-color-surface-popover)",
      border: "0",
      "box-shadow": "var(--artemis-shadow-overlay)",
      "border-radius": "11px",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="search"]',
    {
      "min-block-size": "32px",
      "margin-block-end": "var(--artemis-space-1)",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="listbox"]',
    {
      display: "flex",
      "flex-direction": "column",
      gap: "0",
      "max-block-size": "192px",
      overflow: "auto",
      "scrollbar-width": "none",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="footer"]',
    {
      margin: "5px 4px 0",
      padding: "9px 6px 6px",
      "border-top": "1px solid var(--artemis-color-border-default)",
      "font-size": "var(--artemis-typography-label-size)",
      color: "var(--artemis-color-text-tertiary)",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"]',
    {
      display: "grid",
      "flex-shrink": "0",
      "box-sizing": "border-box",
      "grid-template-columns": "minmax(0, 1fr) 14px",
      "align-items": "center",
      gap: "10px",
      "min-block-size": "32px",
      padding: "0 10px",
      "border-radius": "7px",
      "text-align": "start",
      "overflow-wrap": "anywhere",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"] small',
    {
      display: "block",
      "white-space": "normal",
      "font-size": "var(--artemis-typography-label-size)",
      color: "var(--artemis-color-text-secondary)",
      "line-height": "1.5",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"]:hover, [data-artemis-component="select"] [data-part="option"][data-active="true"]',
    { background: "var(--artemis-color-interaction-hover)" },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"][aria-selected="true"]',
    { background: "var(--artemis-color-interaction-selected)" },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"][data-disabled="true"]',
    { cursor: "default", opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="check"]',
    {
      display: "flex",
      "inline-size": "14px",
      color: "var(--artemis-color-text-primary)",
      "text-align": "center",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="empty"]',
    {
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-secondary)",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"], [data-artemis-component="switch"]',
    {
      position: "relative",
      "box-sizing": "border-box",
      display: "inline-grid",
      "grid-template-columns": "auto 1fr",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"][data-size="compact"], [data-artemis-component="switch"][data-size="compact"]',
    { "min-block-size": "var(--artemis-size-control-compact)" },
  ],
  [
    'normal|[data-artemis-component="checkbox"] > label, [data-artemis-component="switch"] > label',
    { display: "contents" },
  ],
  [
    'normal|[data-artemis-component="checkbox"] [data-part="control"], [data-artemis-component="switch"] [data-part="control"]',
    {
      position: "absolute",
      "inline-size": "1px",
      "block-size": "1px",
      opacity: "0",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"] [data-part="indicator"]',
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "var(--artemis-space-4)",
      "block-size": "var(--artemis-space-4)",
      color: "var(--artemis-color-accent-on-primary)",
      background: "transparent",
      border:
        "calc(var(--artemis-border-width-default) * 1.5) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-space-1)",
      "font-size":
        "calc(var(--artemis-space-3) - var(--artemis-border-width-default))",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"][data-state="checked"] [data-part="indicator"]',
    {
      background: "var(--artemis-color-accent-primary)",
      "border-color": "var(--artemis-color-accent-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"] [data-part="track"]',
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "inline-size": "32px",
      "block-size": "18px",
      padding: "2px",
      background: "var(--artemis-color-surface-sunken)",
      border: "0",
      "border-radius": "var(--artemis-radius-pill)",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"] [data-part="thumb"]',
    {
      "inline-size": "14px",
      "block-size": "14px",
      background: "#fff",
      "border-radius": "var(--artemis-radius-pill)",
      transform: "translateX(0)",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="switch"] [data-part="thumb"]',
    { transform: "translateX(0)" },
  ],
  [
    'normal|[data-artemis-component="switch"]:has([data-part="control"]:checked) [data-part="track"]',
    {
      background: "var(--artemis-color-accent-primary)",
      "border-color": "var(--artemis-color-accent-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"]:has([data-part="control"]:checked) [data-part="thumb"]',
    {
      background: "var(--artemis-color-accent-on-primary)",
      transform: "translateX(14px)",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="switch"]:has([data-part="control"]:checked) [data-part="thumb"]',
    { transform: "translateX(-14px)" },
  ],
  [
    'normal|[data-artemis-component="checkbox"] [data-part="control"]:focus-visible + [data-part="indicator"], [data-artemis-component="switch"] [data-part="control"]:focus-visible + [data-part="track"]',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"] [data-part="description"], [data-artemis-component="checkbox"] [data-part="error"], [data-artemis-component="switch"] [data-part="description"], [data-artemis-component="switch"] [data-part="error"]',
    { "grid-column": "2" },
  ],
  [
    'normal|[data-artemis-component="tabs"], [data-artemis-component="segmented-control"]',
    {
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "min-inline-size": "0",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"]',
    {
      gap: "var(--artemis-space-3)",
      "border-block-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"], [data-artemis-component="segmented-control"] [data-part="segment"]',
    {
      "box-sizing": "border-box",
      "min-inline-size": "0",
      color: "var(--artemis-color-text-secondary)",
      font: "inherit",
      cursor: "pointer",
      transition:
        "color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), border-color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"]',
    {
      "min-block-size": "var(--artemis-size-control-comfortable)",
      "padding-inline": "var(--artemis-space-1)",
      background: "transparent",
      border: "0",
      "border-block-end":
        "calc(var(--artemis-border-width-default) * 2) solid transparent",
      "border-radius": "0",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"][data-size="compact"] [data-part="tab"]',
    { "min-block-size": "var(--artemis-size-control-compact)" },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"]:hover:not(:disabled), [data-artemis-component="tabs"] [data-part="tab"][aria-selected="true"]',
    { color: "var(--artemis-color-text-primary)" },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"][aria-selected="true"]',
    {
      "border-block-end-color": "var(--artemis-color-accent-primary)",
      "font-weight": "calc(var(--artemis-typography-body-weight) + 200)",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"]',
    {
      gap: "2px",
      padding: "2px",
      background: "var(--artemis-color-surface-sunken)",
      border: "0",
      "border-radius": "9px",
      position: "relative",
      isolation: "isolate",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"][data-selection-indicator="ready"]::before',
    {
      content: '""',
      position: "absolute",
      top: "0",
      left: "0",
      width: "var(--selection-width)",
      height: "var(--selection-height)",
      transform: "translate(var(--selection-x), var(--selection-y))",
      "border-radius": "7px",
      background: "var(--artemis-color-canvas)",
      "box-shadow":
        "0 1px 2px rgb(0 0 0 / 0.16), 0 0 0 1px var(--artemis-color-border-subtle)",
      "pointer-events": "none",
      transition:
        "transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), width var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), height var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"][data-selection-indicator="ready"] > [data-part="segment"]',
    { position: "relative", "z-index": "1" },
  ],
  [
    'normal|[data-artemis-component="segmented-control"][data-selection-indicator="ready"] > [data-part="segment"][aria-pressed="true"]',
    { background: "transparent", "box-shadow": "none" },
  ],
  [
    'reduced-motion|[data-artemis-component="segmented-control"][data-selection-indicator="ready"]::before',
    { transition: "none" },
  ],
  [
    'normal|[data-artemis-component="segmented-control"] [data-part="segment"]',
    {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      gap: "6px",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      padding: "0 10px",
      background: "transparent",
      border: "0",
      "border-radius": "7px",
      "white-space": "nowrap",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"] [data-part="segment"] > span[aria-hidden="true"]',
    { display: "inline-flex", flex: "none" },
  ],
  [
    'normal|[data-artemis-component="segmented-control"][data-size="compact"] [data-part="segment"]',
    {
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "10px",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"] [data-part="segment"]:hover:not(:disabled)',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-hover)",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"] [data-part="segment"][aria-pressed="true"]',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-canvas)",
      "border-color": "transparent",
      "box-shadow":
        "0 1px 2px rgb(0 0 0 / 0.16), 0 0 0 1px var(--artemis-color-border-subtle)",
      "font-weight": "500",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"]:focus-visible, [data-artemis-component="segmented-control"] [data-part="segment"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"]:disabled, [data-artemis-component="segmented-control"] [data-part="segment"]:disabled',
    { cursor: "default", opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    `reduced-motion|${BUTTON}, ${ICON_BUTTON}`,
    { transition: "none", transform: "none" },
  ],
  [
    `reduced-motion|${BUTTON}:active:not(:disabled), ${ICON_BUTTON}:active:not(:disabled)`,
    { transform: "none" },
  ],
  [
    'reduced-motion|[data-artemis-component="text-field"] [data-part="control"], [data-artemis-component="textarea-field"] [data-part="control"], [data-artemis-component="search-field"] [data-part="control"], [data-artemis-component="select"] [data-part="trigger"], [data-artemis-component="select"] [data-part="search"], [data-artemis-component="select"] [data-part="indicator"], [data-artemis-component="switch"] [data-part="track"], [data-artemis-component="switch"] [data-part="thumb"], [data-artemis-component="tabs"] [data-part="tab"], [data-artemis-component="segmented-control"] [data-part="segment"]',
    { transition: "none" },
  ],
]);
