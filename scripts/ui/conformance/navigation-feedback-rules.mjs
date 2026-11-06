export const MIG1_EXPECTED_CSS_RULES = [
  [
    'normal|[data-artemis-component="application-shell"]',
    {
      "--_artemis-application-shell-rail-size": "46px",
      "--_artemis-application-shell-effective-sidebar-size":
        "var(--_artemis-application-shell-sidebar-size)",
      position: "relative",
      display: "grid",
      "grid-template-columns":
        "var(--_artemis-application-shell-rail-size) minmax(0, var(--_artemis-application-shell-effective-sidebar-size)) minmax(0, 1fr)",
      "block-size": "100%",
      "min-block-size": "0",
      overflow: "hidden",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-canvas)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
      transition:
        "grid-template-columns var(--artemis-motion-duration-normal) var(--artemis-motion-easing-shell)",
    },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"]',
    {
      position: "absolute",
      "inset-block": "0",
      "inset-inline-start":
        "calc(var(--_artemis-application-shell-rail-size) + var(--_artemis-application-shell-effective-sidebar-size) - var(--artemis-space-1))",
      "z-index": "55",
      "inline-size": "var(--artemis-space-2)",
      cursor: "col-resize",
      "touch-action": "none",
    },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"]::after',
    {
      position: "absolute",
      "inset-block": "0",
      "inset-inline-start": "calc(50% - var(--artemis-border-width-default))",
      "inline-size": "calc(var(--artemis-border-width-default) * 2)",
      content: '""',
      background: "transparent",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"]:hover::after',
    { background: "var(--artemis-color-border-default)" },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"]:focus-visible::after',
    { background: "var(--artemis-color-focus-ring)" },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "-2px",
    },
  ],
  [
    'normal|[data-artemis-component="application-shell-resizer"][data-state="collapsed"]',
    { opacity: "0", "pointer-events": "none" },
  ],
  [
    'normal|[data-artemis-component="activity-bar"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "0",
      padding:
        "calc(var(--artemis-space-2) + var(--artemis-space-1) / 2) calc(var(--artemis-space-2) - var(--artemis-space-1) / 2)",
      color: "var(--artemis-color-text-tertiary)",
      background: "var(--artemis-color-background-activity)",
      "border-inline-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar"] > [data-part="brand"], [data-artemis-component="activity-bar"] > [data-part="items"], [data-artemis-component="activity-bar"] > [data-part="footer"]',
    {
      display: "flex",
      flex: "0 0 auto",
      "flex-direction": "column",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar"] > [data-part="brand"]',
    {
      "margin-block-end": "calc(var(--artemis-space-1) / 2)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar"] > [data-part="footer"]',
    { "margin-block-start": "auto" },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"]',
    {
      position: "relative",
      "box-sizing": "border-box",
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "inline-size":
        "calc(var(--artemis-size-control-compact) + var(--artemis-space-1) * 1.5)",
      "block-size":
        "calc(var(--artemis-size-control-compact) + var(--artemis-space-1) * 1.5)",
      padding: "0",
      color: "var(--artemis-color-text-tertiary)",
      background: "transparent",
      border: "0",
      "border-radius": "calc(var(--artemis-radius-control) + 1px)",
      cursor: "pointer",
      transition:
        "color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"]:hover',
    {
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-interaction-hover)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"][data-state="selected"]',
    {
      color: "var(--artemis-color-accent-primary)",
      background: "var(--artemis-color-accent-subtle)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"][data-state="selected"]::before',
    {
      position: "absolute",
      "inset-block-start": "50%",
      "inset-inline-start": "calc(var(--artemis-space-1) * -1.5)",
      "inline-size": "calc(var(--artemis-space-1) - 1px)",
      "block-size": "calc(var(--artemis-space-4) - 1px)",
      content: '""',
      background: "var(--artemis-color-accent-primary)",
      "border-radius": "calc(var(--artemis-space-1) / 2)",
      transform: "translateY(-50%)",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"]:active',
    { transform: "scale(0.96)" },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"]:focus-visible',
    {
      outline: "2px solid var(--artemis-color-focus-ring)",
      "outline-offset": "2px",
    },
  ],
  [
    'normal|[data-artemis-component="activity-bar-item"] [data-part="icon"]',
    {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
    },
  ],
  [
    'normal|[data-artemis-component="navigation-sidebar"]',
    {
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      "min-block-size": "0",
      "min-inline-size": "0",
      overflow: "hidden",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-background-sidebar)",
      "border-inline-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
      opacity: "1",
      transform: "translateX(0)",
      transition:
        "opacity var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-normal) var(--artemis-motion-easing-shell), visibility 0s linear",
      visibility: "visible",
    },
  ],
  [
    'normal|[data-artemis-component="navigation-sidebar"] > [data-part="header"], [data-artemis-component="navigation-sidebar"] > [data-part="footer"]',
    { flex: "0 0 auto", "min-inline-size": "0" },
  ],
  [
    'normal|[data-artemis-component="navigation-sidebar"] > [data-part="content"]',
    {
      display: "flex",
      flex: "1 1 auto",
      "flex-direction": "column",
      "min-block-size": "0",
      "min-inline-size": "0",
    },
  ],
  [
    'normal|[data-artemis-component="navigation-sidebar"][data-state="collapsed"]',
    {
      opacity: "0",
      "pointer-events": "none",
      transform: "translateX(calc(var(--artemis-space-4) * -1))",
      transition:
        "opacity var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-normal) var(--artemis-motion-easing-shell), visibility 0s linear",
      visibility: "hidden",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="navigation-sidebar"][data-state="collapsed"]',
    { transform: "translateX(var(--artemis-space-4))" },
  ],
  [
    'normal|[data-artemis-component="composer-surface"]',
    {
      position: "relative",
      "box-sizing": "border-box",
      "min-inline-size": "0",
      padding: "0 var(--artemis-space-3) calc(var(--artemis-space-2) + 1px)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-composer)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-surface)",
      "border-radius": "var(--artemis-radius-composer)",
      "box-shadow": "var(--artemis-shadow-composer)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    'normal|[data-artemis-component="composer-surface"] > [data-part="context"]',
    {
      margin: "0 calc(-1 * var(--artemis-space-3))",
      padding:
        "var(--artemis-space-2) var(--artemis-space-3) calc(var(--artemis-space-2) - 1px)",
      background: "var(--artemis-color-surface-sunken)",
      "border-block-end":
        "var(--artemis-border-width-default) solid var(--artemis-color-border-subtle)",
      "border-start-start-radius":
        "calc(var(--artemis-radius-composer) - var(--artemis-border-width-default))",
      "border-start-end-radius":
        "calc(var(--artemis-radius-composer) - var(--artemis-border-width-default))",
    },
  ],
  [
    'compact-width|[data-artemis-component="application-shell"]',
    {
      "--_artemis-application-shell-rail-size": "44px",
    },
  ],
  [
    'reduced-motion|[data-artemis-component="application-shell"], [data-artemis-component="application-shell-resizer"]::after, [data-artemis-component="activity-bar-item"], [data-artemis-component="navigation-sidebar"]',
    { transition: "none" },
  ],
  [
    'reduced-motion|[data-artemis-component="activity-bar-item"]:active',
    { transform: "none" },
  ],
];
