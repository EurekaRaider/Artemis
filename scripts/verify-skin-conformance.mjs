import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const REQUIRED_SKIN_CASES = [
  "anatomy",
  "aria-relations",
  "finite-states",
  "controlled-boundary",
  "ime-enter",
  "callback-order",
  "action-policy",
  "rtl-inheritance",
  "action-anatomy",
  "action-states",
  "action-variants-sizes",
  "action-events",
  "icon-contract",
  "status-semantics",
  "form-anatomy",
  "form-states",
  "form-events-ime",
  "form-semantics",
  "navigation-anatomy",
  "navigation-events",
  "feedback-anatomy",
  "overlay-focus-and-close",
  "portal-viewport-geometry",
  "layout-anatomy",
  "split-pane-events",
  "pattern-anatomy",
  "pattern-state-matrix",
  "pattern-events",
  "pattern-rtl-long-content",
];
const REQUIRED_SWITCH_CASES = [
  "same-node",
  "same-anatomy",
  "same-aria",
  "value-preserved",
  "selection-preserved",
  "focus-preserved",
];
const REQUIRED_RUNTIME_AXES = Object.freeze({
  skins: ["default", "stress"],
  themes: ["light", "dark"],
  contrasts: ["normal", "high"],
  directions: ["ltr", "rtl"],
  zoomFactors: [1, 2],
  reducedMotion: [false, true],
});
const REQUIRED_FALLBACK_CASES = [
  "unknown",
  "unavailable",
  "unsupported",
  "load-failed",
  "default-fatal",
];

const CLI_FLAGS = new Map([
  ["--contract", "contract"],
  ["--matrix", "matrix"],
  ["--skin-package", "skinPackage"],
  ["--css", "css"],
]);

function parseCli(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key = CLI_FLAGS.get(argument);
    if (key === undefined) {
      if (argument.startsWith("--")) {
        throw new Error(`CLI error: unknown flag ${argument}`);
      }
      throw new Error(`CLI error: unexpected positional argument ${argument}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`CLI error: duplicate ${argument} flag`);
    }
    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith("--") ||
      value.trim().length === 0
    ) {
      throw new Error(`CLI error: ${argument} requires a non-empty path`);
    }
    values[key] = value;
    index += 1;
  }
  return Object.freeze(values);
}

const cli = parseCli(process.argv.slice(2));
const canonical = (value) => JSON.stringify(value);
const normalizeWhitespace = (value) => value.replace(/\s+/gu, " ").trim();
const normalizeSelector = (value) =>
  normalizeWhitespace(value)
    .replace(/\s*,\s*/gu, ", ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")");
const normalizeValue = (value) =>
  normalizeWhitespace(value).replace(/\s*,\s*/gu, ", ");

const PROBE = '[data-artemis-component="conformance-probe"]';
const BUTTON = '[data-artemis-component="button"]';
const ICON_BUTTON = '[data-artemis-component="icon-button"]';
const ICON = '[data-artemis-component="icon"]';
const BADGE = '[data-artemis-component="badge"]';
const STATUS = '[data-artemis-component="status"]';
const expectedCssRules = new Map([
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
      outline: "2px solid Highlight",
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
      background: "var(--artemis-color-surface-sunken)",
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
    `normal|${BUTTON}[data-variant="secondary"]:hover:not(:disabled), ${BUTTON}[data-variant="quiet"]:hover:not(:disabled), ${ICON_BUTTON}[data-variant="secondary"]:hover:not(:disabled), ${ICON_BUTTON}[data-variant="quiet"]:hover:not(:disabled)`,
    {
      background: "var(--artemis-color-interaction-hover)",
      "border-color": "var(--artemis-color-border-strong)",
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
    { outline: "2px solid Highlight", "outline-offset": "2px" },
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
      gap: "var(--artemis-space-2)",
      "min-block-size":
        "calc( var(--artemis-space-6) + var(--artemis-border-width-default) * 2 )",
      "min-inline-size": "0",
      "padding-inline": "var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-pill)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-label-size)",
      "line-height": "1",
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
    `normal|${BADGE}[data-tone="info"], ${STATUS}[data-tone="info"]`,
    { background: "var(--artemis-color-status-info-subtle)" },
  ],
  [
    `normal|${BADGE}[data-tone="success"], ${STATUS}[data-tone="success"]`,
    { background: "var(--artemis-color-status-success-subtle)" },
  ],
  [
    `normal|${BADGE}[data-tone="warning"], ${STATUS}[data-tone="warning"]`,
    { background: "var(--artemis-color-status-warning-subtle)" },
  ],
  [
    `normal|${BADGE}[data-tone="danger"], ${STATUS}[data-tone="danger"]`,
    { background: "var(--artemis-color-status-danger-subtle)" },
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
    'normal|[data-artemis-component="text-field"], [data-artemis-component="search-field"], [data-artemis-component="select"]',
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
    'normal|[data-artemis-component="text-field"] [data-part="label"], [data-artemis-component="search-field"] [data-part="label"], [data-artemis-component="select"] [data-part="label"], [data-artemis-component="checkbox"] [data-part="label"], [data-artemis-component="switch"] [data-part="label"]',
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
    'normal|[data-artemis-component="text-field"] [data-part="control"], [data-artemis-component="search-field"] [data-part="control"], [data-artemis-component="select"] [data-part="trigger"], [data-artemis-component="select"] [data-part="search"]',
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
    'normal|[data-artemis-component="text-field"][data-size="compact"] [data-part="control"], [data-artemis-component="search-field"][data-size="compact"] [data-part="control"], [data-artemis-component="select"][data-size="compact"] [data-part="trigger"], [data-artemis-component="select"][data-size="compact"] [data-part="search"]',
    { "min-block-size": "var(--artemis-size-control-compact)" },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="control"]:focus-visible, [data-artemis-component="search-field"] [data-part="control"]:focus-visible, [data-artemis-component="select"] [data-part="trigger"]:focus-visible, [data-artemis-component="select"] [data-part="search"]:focus-visible, [data-artemis-component="select"] [data-part="listbox"]:focus-visible',
    { outline: "2px solid Highlight", "outline-offset": "2px" },
  ],
  [
    'normal|[data-artemis-component="text-field"][data-state="error"] [data-part="control"], [data-artemis-component="search-field"][data-state="error"] [data-part="control"], [data-artemis-component="select"][data-state="error"] [data-part="trigger"]',
    { "border-color": "var(--artemis-color-status-danger)" },
  ],
  [
    'normal|[data-artemis-component="text-field"][data-state="disabled"], [data-artemis-component="search-field"][data-state="disabled"], [data-artemis-component="select"][data-state="disabled"], [data-artemis-component="checkbox"][data-state="disabled"], [data-artemis-component="switch"][data-state="disabled"]',
    { cursor: "default", opacity: "var(--artemis-opacity-disabled)" },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="description"], [data-artemis-component="search-field"] [data-part="description"], [data-artemis-component="select"] [data-part="description"], [data-artemis-component="checkbox"] [data-part="description"], [data-artemis-component="switch"] [data-part="description"], [data-artemis-component="text-field"] [data-part="error"], [data-artemis-component="search-field"] [data-part="error"], [data-artemis-component="select"] [data-part="error"], [data-artemis-component="checkbox"] [data-part="error"], [data-artemis-component="switch"] [data-part="error"]',
    {
      margin: "0",
      color: "var(--artemis-color-text-secondary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="text-field"] [data-part="error"], [data-artemis-component="search-field"] [data-part="error"], [data-artemis-component="select"] [data-part="error"], [data-artemis-component="checkbox"] [data-part="error"], [data-artemis-component="switch"] [data-part="error"]',
    { color: "var(--artemis-color-text-primary)" },
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
    'normal|[data-artemis-component="select"] [data-part="trigger"]',
    {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "var(--artemis-space-3)",
      "text-align": "start",
      cursor: "pointer",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="value"]',
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
      "inline-size": "var(--artemis-space-4)",
      "block-size": "var(--artemis-space-4)",
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
      "inset-block-start": "calc(100% + var(--artemis-space-1))",
      "inset-inline": "0",
      "min-inline-size": "100%",
      overflow: "hidden",
      padding: "var(--artemis-space-1)",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="search"]',
    { "margin-block-end": "var(--artemis-space-1)" },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="listbox"]',
    {
      "max-block-size": "calc(var(--artemis-size-control-comfortable) * 6)",
      overflow: "auto",
    },
  ],
  [
    'normal|[data-artemis-component="select"] [data-part="option"]',
    {
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-2)",
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "var(--artemis-space-2)",
      "border-radius": "var(--artemis-radius-control)",
      cursor: "pointer",
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
      "inline-size": "var(--artemis-space-4)",
      color: "var(--artemis-color-accent-primary)",
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
      "inline-size": "calc(var(--artemis-space-4) + var(--artemis-space-2))",
      "block-size": "calc(var(--artemis-space-4) + var(--artemis-space-2))",
      color: "var(--artemis-color-accent-on-primary)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    'normal|[data-artemis-component="checkbox"][data-size="compact"] [data-part="indicator"]',
    {
      "inline-size": "calc(var(--artemis-space-4) + var(--artemis-space-1))",
      "block-size": "calc(var(--artemis-space-4) + var(--artemis-space-1))",
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
      "inline-size": "calc(var(--artemis-space-4) * 3)",
      "block-size": "calc(var(--artemis-space-4) + var(--artemis-space-3))",
      padding:
        "calc( (var(--artemis-space-2) - var(--artemis-border-width-default) * 2) / 2 )",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-pill)",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"][data-size="compact"] [data-part="track"]',
    {
      "inline-size":
        "calc(var(--artemis-space-4) * 2 + var(--artemis-space-2))",
      "block-size": "calc(var(--artemis-space-4) + var(--artemis-space-2))",
    },
  ],
  [
    'normal|[data-artemis-component="switch"] [data-part="thumb"]',
    {
      "inline-size": "calc(var(--artemis-space-4) + var(--artemis-space-1))",
      "block-size": "calc(var(--artemis-space-4) + var(--artemis-space-1))",
      background: "var(--artemis-color-text-secondary)",
      "border-radius": "var(--artemis-radius-pill)",
      transform: "translateX(0)",
      transition:
        "background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"][data-size="compact"] [data-part="thumb"]',
    {
      "inline-size": "var(--artemis-space-4)",
      "block-size": "var(--artemis-space-4)",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="switch"] [data-part="thumb"]',
    { transform: "translateX(0)" },
  ],
  [
    'normal|[data-artemis-component="switch"][data-state="checked"] [data-part="track"]',
    {
      background: "var(--artemis-color-accent-primary)",
      "border-color": "var(--artemis-color-accent-primary)",
    },
  ],
  [
    'normal|[data-artemis-component="switch"][data-state="checked"] [data-part="thumb"]',
    {
      background: "var(--artemis-color-surface-base)",
      transform:
        "translateX( calc(var(--artemis-space-4) + var(--artemis-space-1)) )",
    },
  ],
  [
    'normal|[data-artemis-component="switch"][data-size="compact"][data-state="checked"] [data-part="thumb"]',
    { transform: "translateX(var(--artemis-space-4))" },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="switch"][data-state="checked"] [data-part="thumb"]',
    {
      transform:
        "translateX( calc((var(--artemis-space-4) + var(--artemis-space-1)) * -1) )",
    },
  ],
  [
    'normal|[dir="rtl"] [data-artemis-component="switch"][data-size="compact"][data-state="checked"] [data-part="thumb"]',
    { transform: "translateX(calc(var(--artemis-space-4) * -1))" },
  ],
  [
    'normal|[data-artemis-component="checkbox"] [data-part="control"]:focus-visible + [data-part="indicator"], [data-artemis-component="switch"] [data-part="control"]:focus-visible + [data-part="track"]',
    { outline: "2px solid Highlight", "outline-offset": "2px" },
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
      gap: "var(--artemis-space-1)",
      padding: "var(--artemis-space-1)",
      background: "var(--artemis-color-surface-sunken)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-control)",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"] [data-part="segment"]',
    {
      "min-block-size": "var(--artemis-size-control-comfortable)",
      "padding-inline": "var(--artemis-space-3)",
      background: "transparent",
      border: "var(--artemis-border-width-default) solid transparent",
      "border-radius": "var(--artemis-radius-control)",
    },
  ],
  [
    'normal|[data-artemis-component="segmented-control"][data-size="compact"] [data-part="segment"]',
    {
      "min-block-size": "var(--artemis-size-control-compact)",
      "padding-inline": "var(--artemis-space-2)",
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
      background: "var(--artemis-color-interaction-selected)",
      "border-color": "var(--artemis-color-border-strong)",
      "font-weight": "calc(var(--artemis-typography-body-weight) + 200)",
    },
  ],
  [
    'normal|[data-artemis-component="tabs"] [data-part="tab"]:focus-visible, [data-artemis-component="segmented-control"] [data-part="segment"]:focus-visible',
    { outline: "2px solid Highlight", "outline-offset": "2px" },
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
    'reduced-motion|[data-artemis-component="text-field"] [data-part="control"], [data-artemis-component="search-field"] [data-part="control"], [data-artemis-component="select"] [data-part="trigger"], [data-artemis-component="select"] [data-part="search"], [data-artemis-component="select"] [data-part="indicator"], [data-artemis-component="switch"] [data-part="track"], [data-artemis-component="switch"] [data-part="thumb"], [data-artemis-component="tabs"] [data-part="tab"], [data-artemis-component="segmented-control"] [data-part="segment"]',
    { transition: "none" },
  ],
]);
const CL3_EXPECTED_CSS_RULES = [
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
      padding: "var(--artemis-space-1) var(--artemis-space-2)",
      color: "var(--artemis-color-surface-base)",
      background: "var(--artemis-color-text-primary)",
      border: "0",
      "border-radius": "var(--artemis-radius-control)",
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
      outline: "2px solid Highlight",
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
      "backdrop-filter": "blur(3px)",
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
      "box-sizing": "border-box",
      display: "flex",
      "align-items": "center",
      gap: "var(--artemis-space-3)",
      "justify-content": "space-between",
      "min-block-size": "var(--artemis-size-control-comfortable)",
      padding: "var(--artemis-space-3) var(--artemis-space-4)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-raised)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-inline-start":
        "calc(var(--artemis-border-width-default) * 3) solid var(--artemis-color-accent-primary)",
      "border-radius": "var(--artemis-radius-card)",
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
      "border-inline-start-color": "var(--artemis-color-status-success)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-tone="warning"]',
    {
      "border-inline-start-color": "var(--artemis-color-status-warning)",
    },
  ],
  [
    'normal|[data-artemis-component="toast"][data-tone="danger"]',
    {
      "border-inline-start-color": "var(--artemis-color-status-danger)",
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
      outline: "2px solid Highlight",
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
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
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
      outline: "2px solid Highlight",
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
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
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
      outline: "2px solid Highlight",
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
      outline: "2px solid Highlight",
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
for (const [key, declarations] of CL3_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`CL3 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}

const CL4_EXPECTED_CSS_RULES = [
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
    { outline: "2px solid Highlight", "outline-offset": "2px" },
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
for (const [key, declarations] of CL4_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`CL4 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}

function verifyStructuralCss(css, from, tokenFamilies) {
  const parsed = postcss.parse(css, { from });
  const rootNodes = parsed.nodes ?? [];
  if (rootNodes.length !== 2) {
    throw new Error("UI structural CSS must contain exactly two root at-rules");
  }

  const [layerOrder, uiLayer] = rootNodes;
  if (
    layerOrder.type !== "atrule" ||
    layerOrder.name !== "layer" ||
    normalizeWhitespace(layerOrder.params) !==
      "artemis.reset, artemis.theme, artemis.ui" ||
    layerOrder.nodes !== undefined
  ) {
    throw new Error("UI structural CSS layer order is not exact");
  }
  if (
    uiLayer.type !== "atrule" ||
    uiLayer.name !== "layer" ||
    normalizeWhitespace(uiLayer.params) !== "artemis.ui" ||
    uiLayer.nodes === undefined
  ) {
    throw new Error("UI structural CSS must use only @layer artemis.ui");
  }

  let commentCount = 0;
  parsed.walkComments(() => {
    commentCount += 1;
  });
  if (commentCount !== 0) {
    throw new Error("UI structural CSS comments are not allowed");
  }

  const seenRules = new Set();
  const consumedTokens = new Set();
  const familyConsumption = tokenFamilies.map((family) => ({
    ...family,
    consumedTokens: new Set(),
    markers: [
      ...family.components.map(
        (component) => `[data-artemis-component="${component}"]`,
      ),
      ...(family.extraMarkers ?? []),
    ],
  }));
  let loadingKeyframes = 0;
  const verifyRule = (rule, context) => {
    if (rule.type !== "rule") {
      throw new Error("UI structural CSS contains an unexpected nested node");
    }
    const selector = normalizeSelector(rule.selector);
    const key = `${context}|${selector}`;
    const expected = expectedCssRules.get(key);
    if (expected === undefined) {
      throw new Error(`UI structural CSS selector is not allowed: ${selector}`);
    }
    if (seenRules.has(key)) {
      throw new Error(`UI structural CSS rule is duplicated: ${selector}`);
    }
    seenRules.add(key);

    const matchingFamilies = familyConsumption.filter((family) =>
      family.markers.some((marker) => selector.includes(marker)),
    );
    if (matchingFamilies.length === 0) {
      throw new Error(
        `UI structural CSS selector must belong to a public family: ${selector}`,
      );
    }

    const declarations = new Map();
    for (const node of rule.nodes ?? []) {
      if (node.type !== "decl") {
        throw new Error(
          `UI structural CSS rule contains a non-declaration: ${selector}`,
        );
      }
      if (node.important) {
        throw new Error(
          `UI structural CSS must not use !important: ${node.prop}`,
        );
      }
      if (declarations.has(node.prop)) {
        throw new Error(
          `UI structural CSS declaration is duplicated: ${node.prop}`,
        );
      }
      const value = normalizeValue(node.value);
      declarations.set(node.prop, value);
      for (const match of value.matchAll(
        /var\(\s*(--artemis-[a-z0-9]+(?:-[a-z0-9]+)*)\s*\)/gu,
      )) {
        consumedTokens.add(match[1]);
        for (const matchingFamily of matchingFamilies) {
          matchingFamily.consumedTokens.add(match[1]);
        }
      }
    }

    const expectedEntries = Object.entries(expected);
    if (declarations.size !== expectedEntries.length) {
      throw new Error(
        `UI structural CSS declarations are not exact for: ${selector}`,
      );
    }
    for (const [property, expectedValue] of expectedEntries) {
      if (declarations.get(property) !== expectedValue) {
        throw new Error(
          `UI structural CSS value is not allowed: ${property}: ${String(declarations.get(property))}`,
        );
      }
    }
  };

  for (const node of uiLayer.nodes) {
    if (node.type === "rule") {
      verifyRule(node, "normal");
      continue;
    }
    if (
      node.type === "atrule" &&
      node.name === "keyframes" &&
      normalizeWhitespace(node.params) === "artemis-loading-sweep"
    ) {
      loadingKeyframes += 1;
      const frames = node.nodes ?? [];
      const frame = frames[0];
      const declaration = frame?.nodes?.[0];
      if (
        loadingKeyframes !== 1 ||
        frames.length !== 1 ||
        frame?.type !== "rule" ||
        normalizeWhitespace(frame.selector) !== "to" ||
        frame.nodes?.length !== 1 ||
        declaration?.type !== "decl" ||
        declaration.prop !== "background-position" ||
        normalizeValue(declaration.value) !== "-200% 0" ||
        declaration.important
      ) {
        throw new Error("UI loading keyframes do not match the exact contract");
      }
      continue;
    }
    if (
      node.type !== "atrule" ||
      node.name !== "media" ||
      normalizeWhitespace(node.params) !== "(prefers-reduced-motion: reduce)" ||
      node.nodes === undefined ||
      node.nodes.length !== 7
    ) {
      throw new Error("UI structural CSS contains an unexpected at-rule");
    }
    for (const nested of node.nodes) verifyRule(nested, "reduced-motion");
  }

  if (loadingKeyframes !== 1) {
    throw new Error("UI loading keyframes are missing");
  }

  if (
    seenRules.size !== expectedCssRules.size ||
    [...expectedCssRules.keys()].some((key) => !seenRules.has(key))
  ) {
    throw new Error("UI structural CSS is missing a required rule");
  }

  const actualTokens = [...consumedTokens].sort();
  const declaredTokens = [
    ...new Set(tokenFamilies.flatMap((family) => family.mutableTokens)),
  ].sort();
  if (canonical(actualTokens) !== canonical(declaredTokens)) {
    throw new Error(
      `UI structural CSS tokens differ from ComponentContract: CSS=${canonical(actualTokens)} contract=${canonical(declaredTokens)}`,
    );
  }
  for (const family of familyConsumption) {
    const declared = new Set(family.mutableTokens);
    const undeclared = [...family.consumedTokens]
      .filter((token) => !declared.has(token))
      .sort();
    if (undeclared.length > 0) {
      throw new Error(
        `UI ${family.label} structural CSS consumes tokens outside its family contract: ${canonical(undeclared)}`,
      );
    }
  }
}

const ui = await import(
  pathToFileURL(join(root, "packages/ui/dist/index.js")).href
);
const conformance = await import(
  pathToFileURL(join(root, "packages/ui/dist/conformance.js")).href
);
const actions = await import(
  pathToFileURL(join(root, "packages/ui/dist/actions.js")).href
);
const forms = await import(
  pathToFileURL(join(root, "packages/ui/dist/forms.js")).href
);
const navigation = await import(
  pathToFileURL(join(root, "packages/ui/dist/navigation.js")).href
);
const feedback = await import(
  pathToFileURL(join(root, "packages/ui/dist/feedback.js")).href
);
const layout = await import(
  pathToFileURL(join(root, "packages/ui/dist/layout.js")).href
);
const patterns = await import(
  pathToFileURL(join(root, "packages/ui/dist/patterns.js")).href
);
const themeContract = await import(
  pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
);
const themeArtemis = await import(
  pathToFileURL(join(root, "packages/theme-artemis/dist/index.js")).href
);
const stress = await import(
  pathToFileURL(join(root, "apps/ui-gallery/src/stress-skin-fixture.mjs")).href
);

const contractPath = cli.contract;
const candidateContract =
  contractPath === undefined
    ? conformance.CONFORMANCE_PROBE_CONTRACT
    : JSON.parse(await readFile(resolve(contractPath), "utf8"));
const report = ui.validateComponentContract(candidateContract);
if (!report.valid) {
  throw new Error(
    `ComponentContract failed validation: ${JSON.stringify(report.issues)}`,
  );
}
if (
  canonical(candidateContract) !==
  canonical(conformance.CONFORMANCE_PROBE_CONTRACT)
) {
  throw new Error(
    "ConformanceProbe contract differs from the frozen public contract",
  );
}
for (const [label, candidate, validate] of [
  [
    "feedback",
    feedback.FEEDBACK_COMPONENT_CONTRACTS,
    feedback.validateFeedbackComponentContracts,
  ],
  [
    "layout",
    layout.LAYOUT_COMPONENT_CONTRACTS,
    layout.validateLayoutComponentContracts,
  ],
  [
    "patterns",
    patterns.PATTERN_COMPONENT_CONTRACTS,
    patterns.validatePatternComponentContracts,
  ],
]) {
  const candidateReport = validate(candidate);
  if (!candidateReport.valid) {
    throw new Error(
      `${label} component contracts failed validation: ${JSON.stringify(candidateReport.errors)}`,
    );
  }
}

const matrixPath =
  cli.matrix ?? join(root, "apps/ui-gallery/src/conformance-matrix.json");
const matrix = JSON.parse(await readFile(resolve(matrixPath), "utf8"));
if (
  matrix === null ||
  Array.isArray(matrix) ||
  typeof matrix !== "object" ||
  canonical(Object.keys(matrix).sort()) !==
    canonical(
      [
        "component",
        "fallbackCases",
        "runtimeAxes",
        "schemaVersion",
        "skins",
        "switchCases",
      ].sort(),
    )
) {
  throw new Error("Conformance matrix top-level fields are not exact");
}
if (matrix.schemaVersion !== 2 || matrix.component !== "conformance-probe") {
  throw new Error("Conformance matrix version or component is invalid");
}
if (
  matrix.skins === null ||
  Array.isArray(matrix.skins) ||
  typeof matrix.skins !== "object" ||
  canonical(Object.keys(matrix.skins).sort()) !==
    canonical(["default", "stress"])
) {
  throw new Error(
    "Conformance matrix must contain exactly default and stress skins",
  );
}
if (
  matrix.runtimeAxes === null ||
  Array.isArray(matrix.runtimeAxes) ||
  typeof matrix.runtimeAxes !== "object" ||
  canonical(Object.keys(matrix.runtimeAxes).sort()) !==
    canonical(Object.keys(REQUIRED_RUNTIME_AXES).sort())
) {
  throw new Error("Runtime conformance axes are not exact");
}
for (const [axis, expectedValues] of Object.entries(REQUIRED_RUNTIME_AXES)) {
  const values = matrix.runtimeAxes[axis];
  if (
    !Array.isArray(values) ||
    values.length !== expectedValues.length ||
    new Set(values).size !== values.length ||
    canonical(values) !== canonical(expectedValues)
  ) {
    throw new Error(`Runtime conformance axis ${axis} is incomplete`);
  }
}
if (
  !Array.isArray(matrix.fallbackCases) ||
  matrix.fallbackCases.length !== REQUIRED_FALLBACK_CASES.length ||
  new Set(matrix.fallbackCases).size !== matrix.fallbackCases.length ||
  canonical(matrix.fallbackCases) !== canonical(REQUIRED_FALLBACK_CASES)
) {
  throw new Error("Runtime fallback cases are incomplete");
}
for (const skin of ["default", "stress"]) {
  const cases = matrix.skins[skin];
  if (
    !Array.isArray(cases) ||
    cases.length !== REQUIRED_SKIN_CASES.length ||
    new Set(cases).size !== cases.length ||
    REQUIRED_SKIN_CASES.some((required) => !cases.includes(required))
  ) {
    throw new Error(`${skin} skin conformance cases are missing or duplicated`);
  }
}
if (
  !Array.isArray(matrix.switchCases) ||
  matrix.switchCases.length !== REQUIRED_SWITCH_CASES.length ||
  new Set(matrix.switchCases).size !== matrix.switchCases.length ||
  REQUIRED_SWITCH_CASES.some(
    (required) => !matrix.switchCases.includes(required),
  )
) {
  throw new Error(
    "Skin-switch identity/state preservation cases are incomplete",
  );
}

for (const [label, skinPackage] of [
  [
    "bundled Artemis",
    {
      manifest: themeArtemis.artemisThemeManifest,
      tokenDocuments: themeArtemis.artemisTokenDocuments,
    },
  ],
  ["synthetic stress", stress.stressSkinPackage],
]) {
  const skinReport = themeContract.validateSkinPackage(skinPackage);
  if (!skinReport.valid) {
    throw new Error(
      `${label} skin is invalid: ${JSON.stringify(skinReport.issues)}`,
    );
  }
}

const hostileFocusSkin = structuredClone(stress.stressSkinPackage);
for (const tokenDocument of Object.values(hostileFocusSkin.tokenDocuments)) {
  for (const mode of tokenDocument.modes) {
    mode.tokens["border.width.default"] = {
      kind: "length",
      value: 0,
      unit: "px",
    };
    mode.tokens["color.focus.ring"] = {
      kind: "color",
      value: "#00000000",
    };
  }
}
const hostileFocusReport = themeContract.validateSkinPackage(hostileFocusSkin);
if (!hostileFocusReport.valid) {
  throw new Error(
    `Focus-floor skin fixture must remain schema-valid: ${JSON.stringify(hostileFocusReport.issues)}`,
  );
}

const externalSkin = cli.skinPackage;
if (externalSkin !== undefined) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts/verify-skin-package.mjs"),
      "--package",
      resolve(externalSkin),
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `External skin failed package validation:\n${result.stdout}${result.stderr}`,
    );
  }
}

for (const specifier of [
  "@artemis/ui",
  "@artemis/ui/actions",
  "@artemis/ui/conformance",
  "@artemis/ui/forms",
  "@artemis/ui/navigation",
  "@artemis/ui/feedback",
  "@artemis/ui/layout",
  "@artemis/ui/patterns",
]) {
  const resolved = import.meta.resolve(specifier);
  const expectedRoot = pathToFileURL(join(root, "packages/ui/dist/")).href;
  if (!resolved.startsWith(expectedRoot)) {
    throw new Error(
      `Public UI import did not resolve through the package: ${specifier}`,
    );
  }
}
const cssPath = resolve(cli.css ?? join(root, "packages/ui/dist/styles.css"));
const css = await readFile(cssPath, "utf8");
verifyStructuralCss(css, cssPath, [
  {
    label: "conformance",
    components: [candidateContract.name],
    mutableTokens: candidateContract.theme.mutableTokens,
  },
  {
    label: "action",
    components: Object.values(actions.ACTION_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: actions.ACTION_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "form",
    components: Object.values(forms.FORM_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    extraMarkers: ['[data-artemis-component][data-label-visibility="hidden"]'],
    mutableTokens: forms.FORM_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "navigation",
    components: Object.values(navigation.NAVIGATION_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: navigation.NAVIGATION_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "feedback",
    components: Object.values(feedback.FEEDBACK_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    extraMarkers: [
      '[data-artemis-component="tooltip-anchor"]',
      "[data-artemis-toast-viewport]",
    ],
    mutableTokens: feedback.FEEDBACK_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "layout",
    components: Object.values(layout.LAYOUT_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: layout.LAYOUT_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "pattern",
    components: Object.values(patterns.PATTERN_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: patterns.PATTERN_COMPONENT_MUTABLE_TOKENS,
  },
]);

console.log(
  `Skin conformance verification passed (${REQUIRED_SKIN_CASES.length} cases × 2 skins; ${REQUIRED_SWITCH_CASES.length} switch cases; 64 runtime vertices; ${REQUIRED_FALLBACK_CASES.length} fallback cases; exact public and per-family contract/CSS tokens; fixed focus floor survives a valid zero-border/transparent-focus skin)`,
);
