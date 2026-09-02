import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

export const WORKFLOW_ACCESSIBLE_NAME_ERROR =
  "Artemis workflow surfaces require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(WORKFLOW_ACCESSIBLE_NAME_ERROR);
  }
}

function classes(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export const WORKFLOW_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const WORKFLOW_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-canvas",
  "--artemis-color-surface-base",
  "--artemis-color-surface-raised",
  "--artemis-color-surface-sunken",
  "--artemis-color-interaction-hover",
  "--artemis-color-interaction-selected",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-text-tertiary",
  "--artemis-color-border-default",
  "--artemis-color-border-subtle",
  "--artemis-color-border-strong",
  "--artemis-color-accent-primary",
  "--artemis-color-accent-subtle",
  "--artemis-color-status-success",
  "--artemis-color-status-success-subtle",
  "--artemis-color-status-warning",
  "--artemis-color-status-warning-subtle",
  "--artemis-color-status-danger",
  "--artemis-color-status-danger-subtle",
  "--artemis-color-overlay-scrim",
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-space-5",
  "--artemis-space-6",
  "--artemis-size-control-compact",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-card",
  "--artemis-radius-panel",
  "--artemis-typography-body-family",
  "--artemis-typography-code-family",
  "--artemis-typography-body-size",
  "--artemis-typography-label-size",
  "--artemis-typography-metadata-size",
  "--artemis-motion-duration-fast",
  "--artemis-motion-duration-normal",
  "--artemis-motion-easing-standard",
  "--artemis-shadow-overlay",
  "--artemis-opacity-disabled",
] as const);

export type WorkflowComponentState =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "dirty"
  | "saving"
  | "saved"
  | "stale"
  | "selected"
  | "open"
  | "closed"
  | "addition"
  | "deletion"
  | "context";

export interface WorkflowComponentContract {
  readonly schemaVersion: typeof WORKFLOW_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "review-surface"
    | "review-diff"
    | "environment-control"
    | "environment-panel"
    | "goal-editor"
    | "sources-surface";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly WorkflowComponentState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof WORKFLOW_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const WORKFLOW_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: WORKFLOW_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-landmark-and-control-names",
    "focus-indicator-visible",
    "status-and-diff-meaning-is-not-color-only",
    "native-disabled-semantics",
    "caller-owns-data-permissions-and-effects",
    "caller-owns-git-review-and-goal-mutations",
    "portal-content-remains-inside-viewport",
    "long-paths-labels-and-content-do-not-expand-layout",
  ],
} as const;

export const WORKFLOW_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  reviewSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "review-surface",
    parts: ["root", "toolbar", "workspace", "reader", "files"],
    optionalParts: ["loading", "empty", "error"],
    states: ["ready", "loading", "empty", "error"],
    accessibility: ["named-review-region", "busy-state-exposed"],
    interaction: ["caller-owned-scope-refresh-selection-and-mutations"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
  reviewDiff: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "review-diff",
    parts: ["root", "header", "hunk", "lines", "line"],
    optionalParts: ["actions", "comment", "comment-editor"],
    states: [
      "ready",
      "selected",
      "dirty",
      "error",
      "addition",
      "deletion",
      "context",
    ],
    accessibility: ["diff-lines-have-visible-kind-marker"],
    interaction: ["caller-owned-stage-revert-comments-and-file-selection"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
  environmentControl: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "environment-control",
    parts: ["root", "trigger"],
    states: ["open", "closed"],
    accessibility: ["trigger-controls-labelled-dialog"],
    interaction: ["caller-owned-open-state-and-focus-return"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
  environmentPanel: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "environment-panel",
    parts: ["root", "section", "section-header", "content"],
    optionalParts: ["row", "status", "checks", "source"],
    states: ["ready", "loading", "empty", "error", "open"],
    accessibility: ["named-dialog", "loading-and-error-semantics"],
    interaction: ["caller-owned-git-agent-source-and-permission-actions"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
  goalEditor: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "goal-editor",
    parts: ["root", "input", "footer", "status", "actions"],
    optionalParts: ["notice"],
    states: ["ready", "loading", "dirty", "saving", "saved", "stale", "error"],
    accessibility: ["named-region", "busy-status-and-alert-semantics"],
    interaction: ["caller-owned-load-save-revert-retry-and-ime-policy"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
  sourcesSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "sources-surface",
    parts: ["root", "scroll", "entry", "entry-icon", "entry-body"],
    optionalParts: ["loading", "empty", "details", "preview", "error"],
    states: ["ready", "loading", "empty", "error", "open"],
    accessibility: ["named-region", "image-preview-labelled-dialog"],
    interaction: ["caller-owned-source-data-open-actions-and-image-loading"],
    theme: WORKFLOW_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, WorkflowComponentContract>>);

export interface WorkflowComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateWorkflowComponentContracts(
  candidate: unknown,
): WorkflowComponentContractValidationResult {
  const errors: string[] = [];
  const compare = (actual: unknown, expected: unknown, path: string): void => {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) {
        errors.push(`${path} must contain ${expected.length} entries`);
        return;
      }
      expected.forEach((entry, index) =>
        compare(actual[index], entry, `${path}[${index}]`),
      );
      return;
    }
    if (typeof expected === "object" && expected !== null) {
      if (
        typeof actual !== "object" ||
        actual === null ||
        Array.isArray(actual)
      ) {
        errors.push(`${path} must be an object`);
        return;
      }
      const actualRecord = actual as Record<string, unknown>;
      const expectedRecord = expected as Record<string, unknown>;
      const actualKeys = Object.keys(actualRecord).sort();
      const expectedKeys = Object.keys(expectedRecord).sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        errors.push(`${path} fields are not exact`);
        return;
      }
      for (const key of expectedKeys) {
        compare(actualRecord[key], expectedRecord[key], `${path}.${key}`);
      }
      return;
    }
    if (actual !== expected)
      errors.push(`${path} must equal ${String(expected)}`);
  };
  compare(candidate, WORKFLOW_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface ReviewSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly state?: "ready" | "loading" | "empty" | "error" | undefined;
}

export function ReviewSurface({
  busy = false,
  children,
  className,
  label,
  state = busy ? "loading" : "ready",
  ...attributes
}: ReviewSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      className={classes("review-panel", className)}
      data-artemis-component="review-surface"
      data-part="root"
      data-state={state}
    >
      {children}
    </section>
  );
}

export function ReviewToolbar({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLElement>) {
  return (
    <header
      {...attributes}
      className={classes("review-comparison-toolbar", className)}
      data-artemis-component="review-surface"
      data-part="toolbar"
    >
      {children}
    </header>
  );
}

export function ReviewWorkspace({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("review-workspace", className)}
      data-artemis-component="review-surface"
      data-part="workspace"
    >
      {children}
    </div>
  );
}

export function ReviewDiffReader({
  children,
  className,
  label,
  ...attributes
}: HTMLAttributes<HTMLElement> & { readonly label: string }) {
  requirePerceptibleText(label);
  return (
    <main
      {...attributes}
      aria-label={label}
      className={classes("review-diff-reader", className)}
      data-artemis-component="review-surface"
      data-part="reader"
    >
      {children}
    </main>
  );
}

export function ReviewFileSidebar({
  children,
  className,
  label,
  ...attributes
}: HTMLAttributes<HTMLElement> & { readonly label: string }) {
  requirePerceptibleText(label);
  return (
    <aside
      {...attributes}
      aria-label={label}
      className={classes("review-file-sidebar", className)}
      data-artemis-component="review-surface"
      data-part="files"
    >
      {children}
    </aside>
  );
}

export function ReviewState({
  children,
  className,
  state,
  ...attributes
}: HTMLAttributes<HTMLDivElement> & {
  readonly state: "loading" | "empty" | "error";
}) {
  return (
    <div
      {...attributes}
      className={classes(
        `review-empty${state === "error" ? " error" : ""}`,
        className,
      )}
      data-artemis-component="review-surface"
      data-part={state}
      data-state={state}
      role={state === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export interface ReviewDiffProps extends HTMLAttributes<HTMLDivElement> {
  readonly state?: "ready" | "selected" | "dirty" | "error" | undefined;
}

export function ReviewDiff({
  children,
  className,
  state = "ready",
  ...attributes
}: ReviewDiffProps) {
  return (
    <div
      {...attributes}
      className={classes("review-file", className)}
      data-artemis-component="review-diff"
      data-part="root"
      data-state={state}
    >
      {children}
    </div>
  );
}

export function ReviewDiffHeader({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("changed-file review-diff-file-header", className)}
      data-artemis-component="review-diff"
      data-part="header"
    >
      {children}
    </div>
  );
}

export function ReviewDiffHunk({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("review-hunk-block", className)}
      data-artemis-component="review-diff"
      data-part="hunk"
    >
      {children}
    </div>
  );
}

export function ReviewDiffLines({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("review-lines", className)}
      data-artemis-component="review-diff"
      data-part="lines"
    >
      {children}
    </div>
  );
}

export interface ReviewDiffLineProps extends HTMLAttributes<HTMLDivElement> {
  readonly kind: "addition" | "deletion" | "context";
}

export function ReviewDiffLine({
  children,
  className,
  kind,
  ...attributes
}: ReviewDiffLineProps) {
  return (
    <div
      {...attributes}
      className={classes(`review-line ${kind}`, className)}
      data-artemis-component="review-diff"
      data-part="line"
      data-state={kind}
    >
      {children}
    </div>
  );
}

export const EnvironmentControl = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { readonly open: boolean }
>(function EnvironmentControl(
  { children, className, open, ...attributes },
  ref,
) {
  return (
    <div
      {...attributes}
      className={classes("environment-control", className)}
      data-artemis-component="environment-control"
      data-part="root"
      data-state={open ? "open" : "closed"}
      ref={ref}
    >
      {children}
    </div>
  );
});

export const EnvironmentTrigger = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    readonly expanded: boolean;
    readonly icon: ReactNode;
    readonly label: string;
  }
>(function EnvironmentTrigger(
  { className, expanded, icon, label, title = label, ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <button
      {...attributes}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-label={label}
      className={classes(
        `environment-trigger${expanded ? " active" : ""}`,
        className,
      )}
      data-artemis-component="environment-control"
      data-part="trigger"
      data-state={expanded ? "open" : "closed"}
      ref={ref}
      title={title}
      type={attributes.type ?? "button"}
    >
      {icon}
    </button>
  );
});

export const EnvironmentPanelSurface = forwardRef<
  HTMLDivElement,
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    readonly children: ReactNode;
    readonly label: string;
    readonly state?:
      "ready" | "loading" | "empty" | "error" | "open" | undefined;
  }
>(function EnvironmentPanelSurface(
  { children, className, label, state = "open", ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      className={classes("environment-popover", className)}
      data-artemis-component="environment-panel"
      data-part="root"
      data-state={state}
      ref={ref}
      role="dialog"
      tabIndex={attributes.tabIndex ?? -1}
    >
      {children}
    </div>
  );
});

export function EnvironmentSection({
  action,
  children,
  className,
  title,
  ...attributes
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  readonly action?: ReactNode | undefined;
  readonly title: ReactNode;
}) {
  return (
    <section
      {...attributes}
      className={classes("environment-section", className)}
      data-artemis-component="environment-panel"
      data-part="section"
    >
      <header data-part="section-header">
        <h2>{title}</h2>
        {action}
      </header>
      <div data-part="content">{children}</div>
    </section>
  );
}

export interface GoalEditorSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly state:
    "ready" | "loading" | "dirty" | "saving" | "saved" | "stale" | "error";
}

export function GoalEditorSurface({
  busy = false,
  children,
  className,
  label,
  state,
  ...attributes
}: GoalEditorSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      className={classes("goal-editor-panel", className)}
      data-artemis-component="goal-editor"
      data-part="root"
      data-state={state}
    >
      {children}
    </section>
  );
}

export const GoalEditorInput = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function GoalEditorInput({ className, ...attributes }, ref) {
  return (
    <textarea
      {...attributes}
      className={classes("goal-editor-input", className)}
      data-artemis-component="goal-editor"
      data-part="input"
      ref={ref}
    />
  );
});

export function GoalEditorFooter({
  actions,
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLElement> & { readonly actions: ReactNode }) {
  return (
    <footer
      {...attributes}
      className={classes("goal-editor-footer", className)}
      data-artemis-component="goal-editor"
      data-part="footer"
    >
      <span data-part="status">{children}</span>
      <div data-part="actions">{actions}</div>
    </footer>
  );
}

export interface SourcesSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly state?: "ready" | "loading" | "empty" | "error" | "open" | undefined;
}

export function SourcesSurface({
  children,
  className,
  label,
  state = "ready",
  ...attributes
}: SourcesSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      className={classes("sources-panel", className)}
      data-artemis-component="sources-surface"
      data-part="root"
      data-state={state}
    >
      {children}
    </section>
  );
}

export function SourcesScroll({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("sources-panel-scroll", className)}
      data-artemis-component="sources-surface"
      data-part="scroll"
    >
      {children}
    </div>
  );
}

export function SourcesState({
  children,
  className,
  state,
  ...attributes
}: HTMLAttributes<HTMLParagraphElement> & {
  readonly state: "empty" | "error" | "loading";
}) {
  return (
    <p
      {...attributes}
      className={classes(
        state === "error"
          ? "sources-panel-preview-error"
          : "sources-panel-empty",
        className,
      )}
      data-artemis-component="sources-surface"
      data-part={state}
      data-state={state}
      role={state === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function SourceEntry({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLElement>) {
  return (
    <article
      {...attributes}
      className={classes("sources-panel-entry", className)}
      data-artemis-component="sources-surface"
      data-part="entry"
    >
      {children}
    </article>
  );
}

export const SourceEntryButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    readonly label: string;
  }
>(function SourceEntryButton(
  { children, className, label, type = "button", ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <button
      {...attributes}
      aria-label={label}
      className={classes("sources-panel-entry", className)}
      data-artemis-component="sources-surface"
      data-part="entry"
      ref={ref}
      type={type}
    >
      {children}
    </button>
  );
});

export function SourceEntryIcon({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...attributes}
      className={classes("sources-panel-icon", className)}
      data-artemis-component="sources-surface"
      data-part="entry-icon"
    >
      {children}
    </span>
  );
}

export function SourceEntryBody({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("sources-panel-entry-body", className)}
      data-artemis-component="sources-surface"
      data-part="entry-body"
    >
      {children}
    </div>
  );
}
