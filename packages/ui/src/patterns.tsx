import {
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
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
export const PATTERN_COLLECTION_ERROR =
  "Artemis agent pattern collections require unique non-empty keys and valid active references";
export const PATTERN_DISCLOSURE_CONTROL_ERROR =
  "Artemis disclosures require one stable controlled or uncontrolled ownership mode";
export const PATTERN_HIDDEN_LABEL_ICON_ERROR =
  "Artemis hidden pattern labels require a renderable icon element";
export const PATTERN_NESTED_AGENT_ACTIVITY_ERROR =
  "Artemis agent activity cannot combine root activation with nested actions";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(PATTERN_ACCESSIBLE_NAME_ERROR);
  }
}

function requireUniqueKeys(values: readonly string[]): void {
  if (
    values.some((value) => !PERCEPTIBLE_LABEL_CHARACTER.test(value)) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(PATTERN_COLLECTION_ERROR);
  }
}

const VISUALLY_HIDDEN_LABEL_STYLE: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

type PatternOwnedLabel =
  | {
      readonly icon?: ReactNode | undefined;
      readonly label: string;
      readonly labelVisibility?: "visible" | undefined;
    }
  | {
      readonly icon: ReactElement;
      readonly label: string;
      readonly labelVisibility: "hidden";
    };

function requireRenderableHiddenLabel(value: PatternOwnedLabel): void {
  if (value.labelVisibility === "hidden" && !isValidElement(value.icon)) {
    throw new Error(PATTERN_HIDDEN_LABEL_ICON_ERROR);
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
  | "blocked"
  | "cancelling"
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
    "every-state-has-visible-status-text",
    "status-is-not-color-only",
    "no-runtime-or-protocol-dependency",
  ],
} as const;

export const PATTERN_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  runModeControl: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "run-mode-control",
    parts: ["root", "option", "label", "status"],
    optionalParts: ["icon", "description"],
    states: ["ready", "busy", "error", "stale", "disabled", "timeout"],
    accessibility: [
      "radiogroup-role",
      "radio-state",
      "roving-tab-stop",
      "arrow-home-end-keyboard",
      "native-disabled-state",
    ],
    interaction: [
      "controlled-value",
      "caller-owned-mode-order",
      "unique-option-values",
    ],
    theme: PATTERN_THEME_CONTRACT,
  },
  approvalCard: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "approval-card",
    parts: ["root", "header", "heading", "title", "status", "actions"],
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
    accessibility: [
      "named-disclosure",
      "expanded-state",
      "persistent-controls-target",
      "live-status",
    ],
    interaction: [
      "controlled-disclosure",
      "stable-control-mode",
      "caller-formats-tool-data",
    ],
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
      "status",
    ],
    states: ["active", "completed", "failed", "stale", "disabled", "timeout"],
    accessibility: [
      "named-disclosure",
      "expanded-state",
      "persistent-controls-target",
      "ordered-steps",
    ],
    interaction: [
      "controlled-disclosure",
      "stable-control-mode",
      "hover-intent",
      "escape-and-outside-close",
      "unique-step-ids-and-current-reference",
    ],
    theme: PATTERN_THEME_CONTRACT,
  },
  contextUsage: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "context-usage",
    parts: ["root", "label", "value", "status", "meter", "fill"],
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
    parts: ["root", "question", "options", "option", "label", "status"],
    optionalParts: ["icon", "description", "actions"],
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
    interaction: [
      "controlled-selection",
      "unique-option-ids",
      "caller-owned-submit-actions",
      "advanced-adapters-may-preserve-consumer-owned-input-controls",
    ],
    theme: PATTERN_THEME_CONTRACT,
  },
  agentActivity: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "agent-activity",
    parts: ["root", "title", "status"],
    optionalParts: ["icon", "description", "indicator", "actions"],
    states: [
      "queued",
      "running",
      "waiting",
      "blocked",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "stale",
      "disabled",
      "timeout",
    ],
    accessibility: [
      "named-status",
      "visible-state-label",
      "native-disabled-state-when-activatable",
    ],
    interaction: [
      "caller-owned-activation-or-actions",
      "root-activation-and-nested-actions-are-mutually-exclusive",
    ],
    theme: PATTERN_THEME_CONTRACT,
  },
  agentTeamSummary: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "agent-team-summary",
    parts: ["root", "title", "status", "members", "member", "label"],
    optionalParts: ["icon"],
    states: ["active", "completed", "failed", "stale", "disabled", "timeout"],
    accessibility: ["named-region", "member-list", "visible-member-status"],
    interaction: [
      "caller-owned-member-order",
      "unique-member-ids",
      "optional-member-activation",
    ],
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
    parts: ["root", "disclosure", "summary", "status", "content"],
    states: ["ready", "streaming", "completed", "failed", "stale", "timeout"],
    accessibility: [
      "named-disclosure",
      "expanded-state",
      "persistent-controls-target",
    ],
    interaction: [
      "controlled-disclosure",
      "stable-control-mode",
      "caller-owned-result-content",
    ],
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

interface ControlledDisclosureProps {
  readonly expanded: boolean;
  readonly defaultExpanded?: never;
  readonly onExpandedChange: (expanded: boolean) => void;
}

interface UncontrolledDisclosureProps {
  readonly expanded?: never;
  readonly defaultExpanded?: boolean | undefined;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
}

type DisclosureOwnershipProps =
  ControlledDisclosureProps | UncontrolledDisclosureProps;

function useControlledDisclosure(
  expanded: boolean | undefined,
  defaultExpanded: boolean | undefined,
  onExpandedChange: ((expanded: boolean) => void) | undefined,
): ControlledDisclosure {
  const controlled = expanded !== undefined;
  const initialControlled = useRef(controlled);
  const [internalExpanded, setInternalExpanded] = useState(
    defaultExpanded ?? false,
  );
  if (
    (controlled && defaultExpanded !== undefined) ||
    initialControlled.current !== controlled
  ) {
    throw new Error(PATTERN_DISCLOSURE_CONTROL_ERROR);
  }
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

export type RunModeOption<T extends string> = PatternOwnedLabel & {
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly value: T;
};

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
  readonly statusLabel: string;
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
  requirePerceptibleText(statusLabel);
  requireUniqueKeys(options.map((option) => option.value));
  if (
    options.length === 0 ||
    !options.some((option) => option.value === value)
  ) {
    throw new Error(PATTERN_COLLECTION_ERROR);
  }
  for (const option of options) {
    requirePerceptibleText(option.label);
    requireRenderableHiddenLabel(option);
  }
  const optionLabelId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndices = options.flatMap((option, index) =>
    isBlocked(state) || option.disabled === true ? [] : [index],
  );
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusableIndex = enabledIndices.includes(selectedIndex)
    ? selectedIndex
    : (enabledIndices[0] ?? -1);
  const activateFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (enabledIndices.length === 0) return;
    const position = enabledIndices.indexOf(currentIndex);
    let targetIndex: number | undefined;
    if (event.key === "Home") targetIndex = enabledIndices[0];
    if (event.key === "End") targetIndex = enabledIndices.at(-1);
    if (
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    ) {
      const delta =
        event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const base = position < 0 ? 0 : position;
      targetIndex =
        enabledIndices[
          (base + delta + enabledIndices.length) % enabledIndices.length
        ];
    }
    if (targetIndex === undefined) return;
    event.preventDefault();
    buttonRefs.current[targetIndex]?.focus();
    const next = options[targetIndex];
    if (next && next.value !== value) onValueChange(next.value);
  };
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
      {options.map((option, index) => {
        const disabled = isBlocked(state) || option.disabled === true;
        return (
          <button
            aria-checked={option.value === value}
            aria-labelledby={`${optionLabelId}-${index}`}
            disabled={disabled}
            data-part="option"
            key={option.value}
            onClick={() => {
              if (!disabled && option.value !== value)
                onValueChange(option.value);
            }}
            onKeyDown={(event) => activateFromKeyboard(event, index)}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            role="radio"
            tabIndex={index === focusableIndex ? 0 : -1}
            type="button"
          >
            {option.icon ? (
              <span aria-hidden="true" data-part="icon">
                {option.icon}
              </span>
            ) : null}
            <span
              data-label-visibility={option.labelVisibility ?? "visible"}
              data-part="label"
              id={`${optionLabelId}-${index}`}
              style={
                option.labelVisibility === "hidden"
                  ? VISUALLY_HIDDEN_LABEL_STYLE
                  : undefined
              }
            >
              {option.label}
            </span>
            {option.description ? (
              <small data-part="description">{option.description}</small>
            ) : null}
          </button>
        );
      })}
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
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
  readonly statusLabel: string;
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
  requirePerceptibleText(statusLabel);
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

interface ToolActivityCommonProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly collapseLabel: string;
  readonly disclosureIcon?: ReactNode | undefined;
  readonly expandLabel: string;
  readonly icon?: ReactNode | undefined;
  readonly label: string;
  readonly state: Extract<
    PatternState,
    "running" | "completed" | "failed" | "stale" | "disabled" | "timeout"
  >;
  readonly statusLabel: string;
  readonly summary: ReactNode;
}

export type ToolActivityProps = ToolActivityCommonProps &
  DisclosureOwnershipProps;

export function ToolActivity({
  children,
  collapseLabel,
  defaultExpanded,
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
  requirePerceptibleText(statusLabel);
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
      <div data-part="content" hidden={!disclosure.expanded} id={contentId}>
        {children}
      </div>
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

interface TaskPlanCommonProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onBlur" | "onPointerLeave"
> {
  readonly collapseLabel: string;
  readonly currentStepId: string;
  readonly expandLabel: string;
  readonly label: string;
  readonly progressLabel: ReactNode;
  readonly state: Extract<
    PatternState,
    "active" | "completed" | "failed" | "stale" | "disabled" | "timeout"
  >;
  readonly statusLabel: string;
  readonly steps: readonly TaskPlanStep[];
  readonly stepsLabel: string;
}

export type TaskPlanProps = TaskPlanCommonProps & DisclosureOwnershipProps;

const TASK_PLAN_HOVER_INTENT_MILLISECONDS = 175;

export function TaskPlan({
  collapseLabel,
  currentStepId,
  defaultExpanded,
  expandLabel,
  expanded,
  label,
  onExpandedChange,
  progressLabel,
  state,
  statusLabel,
  steps,
  stepsLabel,
  ...attributes
}: TaskPlanProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(statusLabel);
  requirePerceptibleText(stepsLabel);
  requireUniqueKeys(steps.map((step) => step.id));
  for (const step of steps) requirePerceptibleText(step.statusLabel);
  if (steps.length === 0 || !steps.some((step) => step.id === currentStepId)) {
    throw new Error(PATTERN_COLLECTION_ERROR);
  }
  const disclosure = useControlledDisclosure(
    expanded,
    defaultExpanded,
    onExpandedChange,
  );
  const root = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const stepsId = useId();
  const blocked = state === "disabled";
  const blockedRef = useRef(blocked);
  const requestExpandedRef = useRef(disclosure.requestExpanded);
  blockedRef.current = blocked;
  requestExpandedRef.current = disclosure.requestExpanded;
  const cancelScheduledOpen = useCallback(() => {
    if (openTimer.current === undefined) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  }, []);
  const scheduleOpen = useCallback(() => {
    if (blockedRef.current) return;
    cancelScheduledOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined;
      if (!blockedRef.current) requestExpandedRef.current(true);
    }, TASK_PLAN_HOVER_INTENT_MILLISECONDS);
  }, [cancelScheduledOpen]);

  useEffect(() => () => cancelScheduledOpen(), [cancelScheduledOpen]);
  useEffect(() => {
    if (blocked) cancelScheduledOpen();
  }, [blocked, cancelScheduledOpen]);
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

  const currentStep = steps.find((step) => step.id === currentStepId)!;
  const currentStatus =
    currentStep.status === "pending" ? "in_progress" : currentStep.status;
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
      <ol
        aria-label={stepsLabel}
        data-part="steps"
        hidden={!disclosure.expanded}
        id={stepsId}
      >
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
      <button
        aria-controls={stepsId}
        aria-expanded={disclosure.expanded}
        aria-label={`${disclosure.expanded ? collapseLabel : expandLabel}: ${label}`}
        data-part="trigger"
        disabled={blocked}
        onClick={() => disclosure.requestExpanded(!disclosure.expanded)}
        onFocus={() => {
          cancelScheduledOpen();
          disclosure.requestExpanded(true);
        }}
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
        <span aria-live="polite" data-part="status">
          {statusLabel}
        </span>
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
  readonly statusLabel: string;
  readonly valueLabel: ReactNode;
}

export function ContextUsage({
  detail,
  label,
  percent,
  state = "ready",
  statusLabel,
  valueLabel,
  ...attributes
}: ContextUsageProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(statusLabel);
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
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
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

export type UserInputOption = PatternOwnedLabel & {
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly id: string;
};

export interface UserInputFrameProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "role"
> {
  readonly children: ReactNode;
  readonly label: string;
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
}

export function UserInputFrame({
  children,
  label,
  state,
  ...attributes
}: UserInputFrameProps) {
  requirePerceptibleText(label);
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
      {children}
    </section>
  );
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
  readonly statusLabel: string;
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
  requirePerceptibleText(statusLabel);
  requireUniqueKeys(options.map((option) => option.id));
  if (
    selectedOptionId !== undefined &&
    !options.some((option) => option.id === selectedOptionId)
  ) {
    throw new Error(PATTERN_COLLECTION_ERROR);
  }
  for (const option of options) {
    requirePerceptibleText(option.label);
    requireRenderableHiddenLabel(option);
  }
  const optionLabelId = useId();
  const blocked = state !== "pending" && state !== "error" && state !== "stale";
  return (
    <UserInputFrame {...attributes} label={label} state={state}>
      <strong data-part="question">{question}</strong>
      {description ? <div data-part="description">{description}</div> : null}
      <div data-part="options">
        {options.map((option, index) => {
          const disabled = blocked || option.disabled === true;
          return (
            <button
              aria-labelledby={`${optionLabelId}-${index}`}
              aria-pressed={option.id === selectedOptionId}
              data-part="option"
              disabled={disabled}
              key={option.id}
              onClick={() => {
                if (!disabled) onOptionSelect(option.id);
              }}
              type="button"
            >
              {option.icon ? (
                <span aria-hidden="true" data-part="icon">
                  {option.icon}
                </span>
              ) : null}
              <span
                data-label-visibility={option.labelVisibility ?? "visible"}
                data-part="label"
                id={`${optionLabelId}-${index}`}
                style={
                  option.labelVisibility === "hidden"
                    ? VISUALLY_HIDDEN_LABEL_STYLE
                    : undefined
                }
              >
                {option.label}
              </span>
              {option.description ? (
                <small data-part="description">{option.description}</small>
              ) : null}
            </button>
          );
        })}
      </div>
      <span aria-live="polite" data-part="status">
        {statusLabel}
      </span>
      {actions ? <div data-part="actions">{actions}</div> : null}
    </UserInputFrame>
  );
}

interface AgentActivitySharedProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onClick" | "title"
> {
  readonly description?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly indicator?: ReactNode | undefined;
  readonly label: string;
  readonly state: Extract<
    PatternState,
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "stale"
    | "disabled"
    | "timeout"
  >;
  readonly statusLabel: string;
  readonly title: ReactNode;
}

export type AgentActivityProps = AgentActivitySharedProps &
  (
    | {
        readonly actions?: never;
        readonly onActivate: () => void;
      }
    | {
        readonly actions?: ReactNode | undefined;
        readonly onActivate?: undefined;
      }
  );

export function AgentActivity({
  actions,
  description,
  icon,
  indicator,
  label,
  onActivate,
  state,
  statusLabel,
  title,
  ...attributes
}: AgentActivityProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(statusLabel);
  if (onActivate && actions !== undefined && actions !== null) {
    throw new Error(PATTERN_NESTED_AGENT_ACTIVITY_ERROR);
  }
  const content = (
    <>
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
      {indicator ? (
        <span aria-hidden="true" data-part="indicator">
          {indicator}
        </span>
      ) : null}
      {actions ? <div data-part="actions">{actions}</div> : null}
    </>
  );
  const sharedAttributes = {
    ...attributes,
    "aria-label": label,
    "data-artemis-component": "agent-activity",
    "data-part": "root",
    "data-state": state,
  } as const;
  if (onActivate) {
    return (
      <button
        {...sharedAttributes}
        disabled={state === "disabled"}
        onClick={onActivate}
        type="button"
      >
        {content}
      </button>
    );
  }
  return <article {...sharedAttributes}>{content}</article>;
}

export type AgentTeamMember = PatternOwnedLabel & {
  readonly id: string;
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
  readonly statusLabel: string;
};

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
  readonly statusLabel: string;
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
  requirePerceptibleText(statusLabel);
  requireUniqueKeys(members.map((member) => member.id));
  for (const member of members) {
    requirePerceptibleText(member.label);
    requireRenderableHiddenLabel(member);
    requirePerceptibleText(member.statusLabel);
  }
  const memberLabelId = useId();
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
        {members.map((member, index) => (
          <li data-part="member" data-state={member.state} key={member.id}>
            {onMemberSelect ? (
              <button
                aria-labelledby={`${memberLabelId}-${index}`}
                disabled={state === "disabled" || member.state === "disabled"}
                onClick={() => onMemberSelect(member.id)}
                type="button"
              >
                {member.icon ? (
                  <span aria-hidden="true" data-part="icon">
                    {member.icon}
                  </span>
                ) : null}
                <span
                  data-label-visibility={member.labelVisibility ?? "visible"}
                  data-part="label"
                  id={`${memberLabelId}-${index}`}
                  style={
                    member.labelVisibility === "hidden"
                      ? VISUALLY_HIDDEN_LABEL_STYLE
                      : undefined
                  }
                >
                  {member.label}
                </span>
                <span data-part="status">{member.statusLabel}</span>
              </button>
            ) : (
              <>
                {member.icon ? (
                  <span aria-hidden="true" data-part="icon">
                    {member.icon}
                  </span>
                ) : null}
                <span
                  data-label-visibility={member.labelVisibility ?? "visible"}
                  data-part="label"
                  style={
                    member.labelVisibility === "hidden"
                      ? VISUALLY_HIDDEN_LABEL_STYLE
                      : undefined
                  }
                >
                  {member.label}
                </span>
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
  readonly statusLabel: string;
}

export function TurnStatus({
  durationLabel,
  label,
  state,
  statusLabel,
  ...attributes
}: TurnStatusProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(statusLabel);
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

interface ResultDisclosureCommonProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly collapseLabel: string;
  readonly expandLabel: string;
  readonly label: string;
  readonly state: Extract<
    PatternState,
    "ready" | "streaming" | "completed" | "failed" | "stale" | "timeout"
  >;
  readonly statusLabel: string;
  readonly summary: ReactNode;
}

export type ResultDisclosureProps = ResultDisclosureCommonProps &
  DisclosureOwnershipProps;

export function ResultDisclosure({
  children,
  collapseLabel,
  defaultExpanded,
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
  requirePerceptibleText(statusLabel);
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
      data-expanded={disclosure.expanded}
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
        <span data-part="status">{statusLabel}</span>
      </button>
      <div data-part="content" hidden={!disclosure.expanded} id={contentId}>
        {children}
      </div>
    </section>
  );
}
