import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
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

export const PATTERN_ACCESSIBLE_NAME_ERROR =
  "Artemis agent patterns require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(PATTERN_ACCESSIBLE_NAME_ERROR);
  }
}

export const PATTERN_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const PATTERN_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-surface-base",
  "--artemis-color-surface-sunken",
  "--artemis-color-interaction-hover",
  "--artemis-color-interaction-selected",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-border-default",
  "--artemis-color-border-strong",
  "--artemis-color-accent-primary",
  "--artemis-color-status-success",
  "--artemis-color-status-warning",
  "--artemis-color-status-danger",
  "--artemis-color-status-warning-subtle",
  "--artemis-color-status-danger-subtle",
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-size-control-compact",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-card",
  "--artemis-radius-pill",
  "--artemis-typography-body-family",
  "--artemis-typography-body-size",
  "--artemis-typography-label-size",
  "--artemis-typography-body-weight",
  "--artemis-opacity-disabled",
] as const);

export type PatternState =
  | "ready"
  | "pending"
  | "queued"
  | "active"
  | "busy"
  | "running"
  | "waiting"
  | "streaming"
  | "resolved"
  | "answered"
  | "approved"
  | "denied"
  | "cancelled"
  | "completed"
  | "failed"
  | "error"
  | "stale"
  | "disabled"
  | "timeout"
  | "idle";

export interface PatternComponentContract {
  readonly schemaVersion: typeof PATTERN_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "run-mode-control"
    | "approval-card"
    | "tool-activity"
    | "task-plan"
    | "context-usage"
    | "user-input"
    | "agent-activity"
    | "agent-team-summary"
    | "turn-status"
    | "result-disclosure";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly PatternState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "no-required-motion";
    readonly mutableTokens: typeof PATTERN_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const PATTERN_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "no-required-motion",
  mutableTokens: PATTERN_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-label",
    "caller-owns-copy-and-formatted-data",
    "caller-owns-policy-and-action-order",
    "caller-disables-injected-actions-for-blocked-states",
    "status-is-not-color-only",
    "no-runtime-or-protocol-dependency",
  ],
} as const;

export const PATTERN_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  runModeControl: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "run-mode-control",
    parts: ["root", "option", "label"],
    optionalParts: ["description", "status"],
    states: ["ready", "busy", "error", "stale", "disabled", "timeout"],
    accessibility: ["radiogroup-role", "radio-state", "native-disabled-state"],
    interaction: ["controlled-value", "caller-owned-mode-order"],
    theme: PATTERN_THEME_CONTRACT,
  },
  approvalCard: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "approval-card",
    parts: ["root", "header", "title", "status", "actions"],
    optionalParts: ["icon", "description", "reason"],
    states: [
      "pending",
      "busy",
      "approved",
      "denied",
      "error",
      "stale",
      "disabled",
      "timeout",
    ],
    accessibility: ["named-region", "live-status", "visible-state-label"],
    interaction: ["caller-owned-actions", "caller-owned-action-order"],
    theme: PATTERN_THEME_CONTRACT,
  },
  toolActivity: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "tool-activity",
    parts: ["root", "summary", "status", "disclosure", "content"],
    optionalParts: ["icon", "disclosure-icon", "disclosure-label"],
    states: ["running", "completed", "failed", "stale", "disabled", "timeout"],
    accessibility: ["named-disclosure", "expanded-state", "live-status"],
    interaction: ["controlled-disclosure", "caller-formats-tool-data"],
    theme: PATTERN_THEME_CONTRACT,
  },
  taskPlan: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "task-plan",
    parts: [
      "root",
      "trigger",
      "progress",
      "steps",
      "step",
      "marker",
      "step-status",
    ],
    states: ["active", "completed", "failed", "stale", "disabled", "timeout"],
    accessibility: ["named-disclosure", "expanded-state", "ordered-steps"],
    interaction: [
      "controlled-disclosure",
      "hover-intent",
      "escape-and-outside-close",
    ],
    theme: PATTERN_THEME_CONTRACT,
  },
  contextUsage: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "context-usage",
    parts: ["root", "label", "value", "meter", "fill"],
    optionalParts: ["detail"],
    states: ["ready", "active", "error", "stale", "disabled", "timeout"],
    accessibility: ["progressbar-role", "numeric-range", "visible-value"],
    interaction: ["caller-formats-values"],
    theme: PATTERN_THEME_CONTRACT,
  },
  userInput: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "user-input",
    parts: ["root", "question", "options", "option"],
    optionalParts: ["description", "status", "actions"],
    states: [
      "pending",
      "busy",
      "answered",
      "cancelled",
      "error",
      "stale",
      "disabled",
      "timeout",
    ],
    accessibility: [
      "named-group",
      "pressed-selection",
      "native-disabled-state",
    ],
    interaction: ["controlled-selection", "caller-owned-submit-actions"],
    theme: PATTERN_THEME_CONTRACT,
  },
  agentActivity: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "agent-activity",
    parts: ["root", "title", "status"],
    optionalParts: ["icon", "description", "actions"],
    states: [
      "queued",
      "running",
      "waiting",
      "completed",
      "failed",
      "stale",
      "disabled",
      "timeout",
    ],
    accessibility: ["named-status", "visible-state-label"],
    interaction: ["caller-owned-actions"],
    theme: PATTERN_THEME_CONTRACT,
  },
  agentTeamSummary: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "agent-team-summary",
    parts: ["root", "title", "status", "members", "member"],
    states: ["active", "completed", "failed", "stale", "disabled", "timeout"],
    accessibility: ["named-region", "member-list", "visible-member-status"],
    interaction: ["caller-owned-member-order", "optional-member-activation"],
    theme: PATTERN_THEME_CONTRACT,
  },
  turnStatus: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "turn-status",
    parts: ["root", "indicator", "label"],
    optionalParts: ["duration"],
    states: [
      "idle",
      "running",
      "waiting",
      "completed",
      "failed",
      "stale",
      "timeout",
    ],
    accessibility: ["status-or-alert-role", "visible-state-label"],
    interaction: ["caller-formats-duration"],
    theme: PATTERN_THEME_CONTRACT,
  },
  resultDisclosure: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "result-disclosure",
    parts: ["root", "disclosure", "summary", "content"],
    optionalParts: ["status"],
    states: ["ready", "streaming", "completed", "failed", "stale", "timeout"],
    accessibility: ["named-disclosure", "expanded-state"],
    interaction: ["controlled-disclosure", "caller-owned-result-content"],
    theme: PATTERN_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, PatternComponentContract>>);

export interface PatternComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validatePatternComponentContracts(
  candidate: unknown,
): PatternComponentContractValidationResult {
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
    if (actual !== expected) {
      errors.push(`${path} must equal ${JSON.stringify(expected)}`);
    }
  };
  compare(candidate, PATTERN_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function isBlocked(state: PatternState): boolean {
  return state === "busy" || state === "disabled";
}

interface ControlledDisclosure {
  readonly expanded: boolean;
  readonly requestExpanded: (expanded: boolean) => void;
}

function useControlledDisclosure(
  expanded: boolean | undefined,
  defaultExpanded: boolean,
  onExpandedChange: ((expanded: boolean) => void) | undefined,
): ControlledDisclosure {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const current = expanded ?? internalExpanded;
  const requestExpanded = useCallback(
    (next: boolean) => {
      if (expanded === undefined) setInternalExpanded(next);
      if (next !== current) onExpandedChange?.(next);
    },
    [current, expanded, onExpandedChange],
  );
  return {
    expanded: current,
    requestExpanded,
  };
}

export interface RunModeOption<T extends string> {
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly label: ReactNode;
  readonly value: T;
}

export interface RunModeControlProps<T extends string> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onChange"
> {
  readonly label: string;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly RunModeOption<T>[];
  readonly state?:
    | Extract<
        PatternState,
        "ready" | "busy" | "error" | "stale" | "disabled" | "timeout"
      >
    | undefined;
  readonly statusLabel?: ReactNode | undefined;
  readonly value: T;
}

export function RunModeControl<T extends string>({
  label,
  onValueChange,
  options,
  state = "ready",
  statusLabel,
  value,
  ...attributes
}: RunModeControlProps<T>) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-busy={state === "busy" || undefined}
      aria-label={label}
      data-artemis-component="run-mode-control"
      data-part="root"
      data-state={state}
      role="radiogroup"
    >
      {options.map((option) => {
        const disabled = isBlocked(state) || option.disabled === true;
        return (
          <button
            aria-checked={option.value === value}
            disabled={disabled}
            data-part="option"
            key={option.value}
            onClick={() => {
              if (!disabled && option.value !== value)
                onValueChange(option.value);
            }}
            role="radio"
            type="button"
          >
            <span data-part="label">{option.label}</span>
            {option.description ? (
              <small data-part="description">{option.description}</small>
            ) : null}
          </button>
        );
      })}
      {statusLabel ? <span data-part="status">{statusLabel}</span> : null}
    </div>
  );
}

export interface ApprovalCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly label: string;
  readonly reason?: ReactNode | undefined;
  readonly state: Extract<
    PatternState,
    | "pending"
    | "busy"
    | "approved"
    | "denied"
    | "error"
    | "stale"
    | "disabled"
    | "timeout"
  >;
  readonly statusLabel: ReactNode;
  readonly title: ReactNode;
}

export function ApprovalCard({
  actions,
  description,
  icon,
  label,
  reason,
  state,
  statusLabel,
  title,
  ...attributes
}: ApprovalCardProps) {
  requirePerceptibleText(label);
  return (
    <article
      {...attributes}
      aria-busy={state === "busy" || undefined}
      aria-label={label}
      data-artemis-component="approval-card"
      data-part="root"
      data-state={state}
    >
      <header data-part="header">
        {icon ? (
          <span aria-hidden="true" data-part="icon">
            {icon}
          </span>
        ) : null}
        <div data-part="heading">
          <strong data-part="title">{title}</strong>
          {description ? (
            <div data-part="description">{description}</div>
          ) : null}
        </div>
        <span aria-live="polite" data-part="status">
          {statusLabel}
        </span>
      </header>
      {reason ? <div data-part="reason">{reason}</div> : null}
      <div data-part="actions">{actions}</div>
    </article>
  );
}

export interface ToolActivityProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly collapseLabel: string;
  readonly defaultExpanded?: boolean | undefined;
  readonly disclosureIcon?: ReactNode | undefined;
  readonly expandLabel: string;
  readonly expanded?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly label: string;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly state: Extract<
    PatternState,
    "running" | "completed" | "failed" | "stale" | "disabled" | "timeout"
  >;
  readonly statusLabel: ReactNode;
  readonly summary: ReactNode;
}

export function ToolActivity({
  children,
  collapseLabel,
  defaultExpanded = false,
  disclosureIcon,
  expandLabel,
  expanded,
  icon,
  label,
  onExpandedChange,
  state,
  statusLabel,
  summary,
  ...attributes
}: ToolActivityProps) {
  requirePerceptibleText(label);
  const disclosure = useControlledDisclosure(
    expanded,
    defaultExpanded,
    onExpandedChange,
  );
  const contentId = useId();
  return (
    <section
      {...attributes}
      aria-busy={state === "running" || undefined}
      aria-label={label}
      data-artemis-component="tool-activity"
      data-expanded={disclosure.expanded}
      data-part="root"
      data-state={state}
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <span data-part="summary">{summary}</span>
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
      <button
        aria-controls={contentId}
        aria-expanded={disclosure.expanded}
        aria-label={`${disclosure.expanded ? collapseLabel : expandLabel}: ${label}`}
        data-part="disclosure"
        disabled={state === "disabled"}
        onClick={() => disclosure.requestExpanded(!disclosure.expanded)}
        type="button"
      >
        {disclosureIcon ? (
          <span aria-hidden="true" data-part="disclosure-icon">
            {disclosureIcon}
          </span>
        ) : (
          <span data-part="disclosure-label">
            {disclosure.expanded ? collapseLabel : expandLabel}
          </span>
        )}
      </button>
      {disclosure.expanded ? (
        <div data-part="content" id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export type TaskPlanStepStatus =
  "pending" | "in_progress" | "completed" | "failed";

export interface TaskPlanStep {
  readonly id: string;
  readonly label: ReactNode;
  readonly status: TaskPlanStepStatus;
  readonly statusLabel: string;
}

export interface TaskPlanProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onBlur" | "onPointerLeave"
> {
  readonly collapseLabel: string;
  readonly currentStepId?: string | undefined;
  readonly defaultExpanded?: boolean | undefined;
  readonly expandLabel: string;
  readonly expanded?: boolean | undefined;
  readonly label: string;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly progressLabel: ReactNode;
  readonly state: Extract<
    PatternState,
    "active" | "completed" | "failed" | "stale" | "disabled" | "timeout"
  >;
  readonly steps: readonly TaskPlanStep[];
  readonly stepsLabel: string;
}

const TASK_PLAN_HOVER_INTENT_MILLISECONDS = 175;

export function TaskPlan({
  collapseLabel,
  currentStepId,
  defaultExpanded = false,
  expandLabel,
  expanded,
  label,
  onExpandedChange,
  progressLabel,
  state,
  steps,
  stepsLabel,
  ...attributes
}: TaskPlanProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(stepsLabel);
  const disclosure = useControlledDisclosure(
    expanded,
    defaultExpanded,
    onExpandedChange,
  );
  const root = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const stepsId = useId();
  const blocked = state === "disabled";
  const cancelScheduledOpen = () => {
    if (openTimer.current === undefined) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  };
  const scheduleOpen = () => {
    if (blocked) return;
    cancelScheduledOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      disclosure.requestExpanded(true);
    }, TASK_PLAN_HOVER_INTENT_MILLISECONDS);
  };

  useEffect(() => () => {
    if (openTimer.current !== undefined) window.clearTimeout(openTimer.current);
  });
  useEffect(() => {
    if (!disclosure.expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node))
        disclosure.requestExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") disclosure.requestExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [disclosure.expanded, disclosure.requestExpanded]);

  const currentStep =
    steps.find((step) => step.id === currentStepId) ?? steps[0];
  const currentStatus =
    currentStep?.status === "pending"
      ? "in_progress"
      : (currentStep?.status ?? "pending");
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="task-plan"
      data-expanded={disclosure.expanded}
      data-part="root"
      data-state={state}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          cancelScheduledOpen();
          disclosure.requestExpanded(false);
        }
      }}
      onPointerLeave={() => {
        cancelScheduledOpen();
        disclosure.requestExpanded(false);
      }}
      ref={root}
    >
      {disclosure.expanded ? (
        <ol aria-label={stepsLabel} data-part="steps" id={stepsId}>
          {steps.map((step) => {
            const visibleStatus =
              step.id === currentStepId && step.status === "pending"
                ? "in_progress"
                : step.status;
            return (
              <li data-part="step" data-status={visibleStatus} key={step.id}>
                <span
                  aria-hidden="true"
                  data-part="marker"
                  data-status={visibleStatus}
                />
                <span>{step.label}</span>
                <small data-part="step-status">{step.statusLabel}</small>
              </li>
            );
          })}
        </ol>
      ) : null}
      <button
        aria-controls={stepsId}
        aria-expanded={disclosure.expanded}
        aria-label={`${disclosure.expanded ? collapseLabel : expandLabel}: ${label}`}
        data-part="trigger"
        disabled={blocked}
        onClick={() => disclosure.requestExpanded(!disclosure.expanded)}
        onFocus={() => disclosure.requestExpanded(true)}
        onPointerEnter={scheduleOpen}
        onPointerLeave={cancelScheduledOpen}
        type="button"
      >
        <span
          aria-hidden="true"
          data-part="marker"
          data-status={currentStatus}
        />
        <span data-part="progress">{progressLabel}</span>
      </button>
    </div>
  );
}

export interface ContextUsageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly detail?: ReactNode | undefined;
  readonly label: string;
  readonly percent: number;
  readonly state?:
    | Extract<
        PatternState,
        "ready" | "active" | "error" | "stale" | "disabled" | "timeout"
      >
    | undefined;
  readonly valueLabel: ReactNode;
}

export function ContextUsage({
  detail,
  label,
  percent,
  state = "ready",
  valueLabel,
  ...attributes
}: ContextUsageProps) {
  requirePerceptibleText(label);
  const normalizedPercent = Math.min(
    100,
    Math.max(0, Number.isFinite(percent) ? percent : 0),
  );
  return (
    <div
      {...attributes}
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={normalizedPercent}
      data-artemis-component="context-usage"
      data-part="root"
      data-state={state}
      role="progressbar"
    >
      <span data-part="label">{label}</span>
      <span data-part="value">{valueLabel}</span>
      <span aria-hidden="true" data-part="meter">
        <span
          data-part="fill"
          style={{ inlineSize: `${normalizedPercent}%` }}
        />
      </span>
      {detail ? <small data-part="detail">{detail}</small> : null}
    </div>
  );
}

export interface UserInputOption {
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly id: string;
  readonly label: ReactNode;
}

export interface UserInputProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly actions?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly label: string;
  readonly onOptionSelect: (id: string) => void;
  readonly options: readonly UserInputOption[];
  readonly question: ReactNode;
  readonly selectedOptionId?: string | undefined;
  readonly state: Extract<
    PatternState,
    | "pending"
    | "busy"
    | "answered"
    | "cancelled"
    | "error"
    | "stale"
    | "disabled"
    | "timeout"
  >;
  readonly statusLabel?: ReactNode | undefined;
}

export function UserInput({
  actions,
  description,
  label,
  onOptionSelect,
  options,
  question,
  selectedOptionId,
  state,
  statusLabel,
  ...attributes
}: UserInputProps) {
  requirePerceptibleText(label);
  const blocked = state !== "pending" && state !== "error" && state !== "stale";
  return (
    <section
      {...attributes}
      aria-busy={state === "busy" || undefined}
      aria-label={label}
      data-artemis-component="user-input"
      data-part="root"
      data-state={state}
      role="group"
    >
      <strong data-part="question">{question}</strong>
      {description ? <div data-part="description">{description}</div> : null}
      <div data-part="options">
        {options.map((option) => {
          const disabled = blocked || option.disabled === true;
          return (
            <button
              aria-pressed={option.id === selectedOptionId}
              data-part="option"
              disabled={disabled}
              key={option.id}
              onClick={() => {
                if (!disabled) onOptionSelect(option.id);
              }}
              type="button"
            >
              <span data-part="label">{option.label}</span>
              {option.description ? (
                <small data-part="description">{option.description}</small>
              ) : null}
            </button>
          );
        })}
      </div>
      {statusLabel ? (
        <span aria-live="polite" data-part="status">
          {statusLabel}
        </span>
      ) : null}
      {actions ? <div data-part="actions">{actions}</div> : null}
    </section>
  );
}

export interface AgentActivityProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly label: string;
  readonly state: Extract<
    PatternState,
    | "queued"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "stale"
    | "disabled"
    | "timeout"
  >;
  readonly statusLabel: ReactNode;
  readonly title: ReactNode;
}

export function AgentActivity({
  actions,
  description,
  icon,
  label,
  state,
  statusLabel,
  title,
  ...attributes
}: AgentActivityProps) {
  requirePerceptibleText(label);
  return (
    <article
      {...attributes}
      aria-label={label}
      data-artemis-component="agent-activity"
      data-part="root"
      data-state={state}
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <strong data-part="title">{title}</strong>
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
      {description ? <div data-part="description">{description}</div> : null}
      {actions ? <div data-part="actions">{actions}</div> : null}
    </article>
  );
}

export interface AgentTeamMember {
  readonly id: string;
  readonly label: ReactNode;
  readonly state: Extract<
    PatternState,
    | "queued"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "stale"
    | "disabled"
    | "timeout"
  >;
  readonly statusLabel: ReactNode;
}

export interface AgentTeamSummaryProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly label: string;
  readonly members: readonly AgentTeamMember[];
  readonly onMemberSelect?: ((id: string) => void) | undefined;
  readonly state: Extract<
    PatternState,
    "active" | "completed" | "failed" | "stale" | "disabled" | "timeout"
  >;
  readonly statusLabel: ReactNode;
  readonly title: ReactNode;
}

export function AgentTeamSummary({
  label,
  members,
  onMemberSelect,
  state,
  statusLabel,
  title,
  ...attributes
}: AgentTeamSummaryProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="agent-team-summary"
      data-part="root"
      data-state={state}
    >
      <strong data-part="title">{title}</strong>
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
      <ul data-part="members">
        {members.map((member) => (
          <li data-part="member" data-state={member.state} key={member.id}>
            {onMemberSelect ? (
              <button
                disabled={state === "disabled" || member.state === "disabled"}
                onClick={() => onMemberSelect(member.id)}
                type="button"
              >
                <span data-part="label">{member.label}</span>
                <span data-part="status">{member.statusLabel}</span>
              </button>
            ) : (
              <>
                <span data-part="label">{member.label}</span>
                <span data-part="status">{member.statusLabel}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface TurnStatusProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly durationLabel?: ReactNode | undefined;
  readonly label: string;
  readonly state: Extract<
    PatternState,
    | "idle"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "stale"
    | "timeout"
  >;
  readonly statusLabel: ReactNode;
}

export function TurnStatus({
  durationLabel,
  label,
  state,
  statusLabel,
  ...attributes
}: TurnStatusProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="turn-status"
      data-part="root"
      data-state={state}
      role={state === "failed" || state === "timeout" ? "alert" : "status"}
    >
      <span aria-hidden="true" data-part="indicator" />
      <span data-part="label">{statusLabel}</span>
      {durationLabel ? <span data-part="duration">{durationLabel}</span> : null}
    </div>
  );
}

export interface ResultDisclosureProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly collapseLabel: string;
  readonly defaultExpanded?: boolean | undefined;
  readonly expandLabel: string;
  readonly expanded?: boolean | undefined;
  readonly label: string;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly state: Extract<
    PatternState,
    "ready" | "streaming" | "completed" | "failed" | "stale" | "timeout"
  >;
  readonly statusLabel?: ReactNode | undefined;
  readonly summary: ReactNode;
}

export function ResultDisclosure({
  children,
  collapseLabel,
  defaultExpanded = false,
  expandLabel,
  expanded,
  label,
  onExpandedChange,
  state,
  statusLabel,
  summary,
  ...attributes
}: ResultDisclosureProps) {
  requirePerceptibleText(label);
  const disclosure = useControlledDisclosure(
    expanded,
    defaultExpanded,
    onExpandedChange,
  );
  const contentId = useId();
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="result-disclosure"
      data-part="root"
      data-state={state}
    >
      <button
        aria-controls={contentId}
        aria-expanded={disclosure.expanded}
        aria-label={`${disclosure.expanded ? collapseLabel : expandLabel}: ${label}`}
        data-part="disclosure"
        onClick={() => disclosure.requestExpanded(!disclosure.expanded)}
        type="button"
      >
        <span data-part="summary">{summary}</span>
        {statusLabel ? <span data-part="status">{statusLabel}</span> : null}
      </button>
      {disclosure.expanded ? (
        <div data-part="content" id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
