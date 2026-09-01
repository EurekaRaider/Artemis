import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";

import {
  validateComponentContract,
  type ComponentContract,
} from "./component-contract.js";

export const CONFORMANCE_PROBE_CONTRACT = {
  schemaVersion: 1,
  uiContractVersion: 1,
  name: "conformance-probe",
  props: [
    { name: "id", type: "identifier", required: false, boundary: "static" },
    { name: "label", type: "string", required: true, boundary: "static" },
    {
      name: "description",
      type: "string",
      required: false,
      boundary: "static",
    },
    { name: "error", type: "string", required: false, boundary: "static" },
    { name: "disabled", type: "boolean", required: false, boundary: "static" },
    { name: "busy", type: "boolean", required: false, boundary: "static" },
    { name: "stale", type: "boolean", required: false, boundary: "static" },
    { name: "value", type: "string", required: false, boundary: "controlled" },
    {
      name: "defaultValue",
      type: "string",
      required: false,
      boundary: "uncontrolled-default",
    },
    {
      name: "onValueChange",
      type: "callback",
      required: false,
      boundary: "callback",
    },
    {
      name: "onCommit",
      type: "callback",
      required: false,
      boundary: "callback",
    },
    {
      name: "onEvent",
      type: "callback",
      required: false,
      boundary: "callback",
    },
  ],
  controlBoundary: {
    value: "value",
    defaultValue: "defaultValue",
    changeCallback: "onValueChange",
    fixedAtMount: true,
    mutuallyExclusive: true,
  },
  parts: [
    { name: "root", element: "div" },
    { name: "label", element: "label" },
    { name: "control", element: "input" },
    { name: "description", element: "p" },
    { name: "error", element: "p" },
  ],
  dataAttributes: {
    component: "data-artemis-component",
    part: "data-part",
    state: "data-state",
  },
  states: [
    {
      name: "ready",
      dataValue: "ready",
      priority: 0,
      change: "allow",
      commit: "allow",
      focus: "allow",
    },
    {
      name: "error",
      dataValue: "error",
      priority: 1,
      change: "allow",
      commit: "allow",
      focus: "allow",
    },
    {
      name: "stale",
      dataValue: "stale",
      priority: 2,
      change: "allow",
      commit: "allow",
      focus: "allow",
    },
    {
      name: "busy",
      dataValue: "busy",
      priority: 3,
      change: "block",
      commit: "block",
      focus: "allow",
    },
    {
      name: "disabled",
      dataValue: "disabled",
      priority: 4,
      change: "block",
      commit: "block",
      focus: "block",
    },
  ],
  aria: {
    rootRole: "group",
    accessibleName: "label-element",
    labelRelation: "for-control",
    descriptionRelation: "aria-describedby",
    errorRelation: "aria-describedby",
    invalidRelation: "aria-invalid",
    busyRelation: "aria-busy",
  },
  keyboard: [
    {
      key: "Enter",
      when: "control-focused",
      duringComposition: false,
      outcome: "commit-once",
    },
    {
      key: "Enter",
      when: "control-focused",
      duringComposition: true,
      outcome: "no-commit",
    },
  ],
  callbacks: [
    {
      trigger: "change",
      order: ["onValueChange", "onEvent"],
      callsPerEvent: 1,
    },
    { trigger: "commit", order: ["onCommit", "onEvent"], callsPerEvent: 1 },
  ],
  portal: {
    mode: "none",
    themeInheritance: "same-dom-tree",
    layer: "artemis.ui",
  },
  theme: {
    direction: "inherit",
    reducedMotion: "disable-transitions",
    mutableTokens: [
      "--artemis-color-surface-base",
      "--artemis-color-text-primary",
      "--artemis-color-text-secondary",
      "--artemis-color-status-danger",
      "--artemis-color-border-default",
      "--artemis-border-width-default",
      "--artemis-space-1",
      "--artemis-space-2",
      "--artemis-space-3",
      "--artemis-radius-input",
      "--artemis-typography-body-family",
      "--artemis-typography-body-size",
      "--artemis-typography-label-size",
      "--artemis-motion-duration-fast",
      "--artemis-motion-easing-standard",
      "--artemis-opacity-disabled",
    ],
    safetyFloor: [
      "accessible-name-required",
      "disabled-native-semantics",
      "focus-indicator-visible",
      "no-action-while-busy",
      "no-action-while-disabled",
    ],
  },
} as const satisfies ComponentContract;

const contractReport = validateComponentContract(CONFORMANCE_PROBE_CONTRACT);
if (!contractReport.valid) {
  throw new Error("The built-in ConformanceProbe contract is invalid");
}

export type ConformanceProbeEvent =
  | { readonly type: "change"; readonly value: string }
  | { readonly type: "commit"; readonly value: string };

interface ConformanceProbeBaseProps {
  readonly id?: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly stale?: boolean;
  readonly onCommit?: (value: string) => void;
  readonly onEvent?: (event: ConformanceProbeEvent) => void;
}

interface ControlledConformanceProbeProps extends ConformanceProbeBaseProps {
  readonly value: string;
  readonly defaultValue?: never;
  readonly onValueChange: (value: string) => void;
}

interface UncontrolledConformanceProbeProps extends ConformanceProbeBaseProps {
  readonly value?: never;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
}

export type ConformanceProbeProps =
  ControlledConformanceProbeProps | UncontrolledConformanceProbeProps;

export const CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR =
  "ConformanceProbe requires a non-empty accessible label";

export function ConformanceProbe(props: ConformanceProbeProps) {
  if (typeof props.label !== "string" || props.label.trim().length === 0) {
    throw new Error(CONFORMANCE_PROBE_ACCESSIBLE_NAME_ERROR);
  }

  const generatedId = useId().replaceAll(":", "");
  const baseId = props.id ?? `artemis-probe-${generatedId}`;
  const controlId = `${baseId}-control`;
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;
  const errorId = `${baseId}-error`;
  const controlled = props.value !== undefined;
  const controlledAtMount = useRef(controlled);
  const composing = useRef(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    () => props.defaultValue ?? "",
  );

  if (controlledAtMount.current !== controlled) {
    throw new Error(
      "ConformanceProbe cannot switch between controlled and uncontrolled modes",
    );
  }

  const currentValue = controlled ? props.value : uncontrolledValue;
  const invalid = props.error !== undefined && props.error.length > 0;
  const state = props.disabled
    ? "disabled"
    : props.busy
      ? "busy"
      : props.stale
        ? "stale"
        : invalid
          ? "error"
          : "ready";
  const actionBlocked = props.disabled === true || props.busy === true;
  const describedBy = [
    props.description === undefined ? undefined : descriptionId,
    invalid ? errorId : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (actionBlocked) return;
    const nextValue = event.currentTarget.value;
    if (!controlled) setUncontrolledValue(nextValue);
    props.onValueChange?.(nextValue);
    props.onEvent?.({ type: "change", value: nextValue });
  };

  const handleCompositionStart = (
    _event: CompositionEvent<HTMLInputElement>,
  ) => {
    composing.current = true;
  };
  const handleCompositionEnd = (_event: CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      composing.current ||
      actionBlocked
    ) {
      return;
    }
    props.onCommit?.(currentValue);
    props.onEvent?.({ type: "commit", value: currentValue });
  };

  return (
    <div
      id={`${baseId}-root`}
      role="group"
      aria-labelledby={labelId}
      aria-busy={props.busy === true ? "true" : undefined}
      data-artemis-component="conformance-probe"
      data-part="root"
      data-state={state}
    >
      <label id={labelId} htmlFor={controlId} data-part="label">
        {props.label}
      </label>
      <input
        id={controlId}
        value={currentValue}
        disabled={props.disabled}
        readOnly={props.busy}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        aria-invalid={invalid ? "true" : undefined}
        aria-busy={props.busy === true ? "true" : undefined}
        data-part="control"
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
      />
      <p id={descriptionId} data-part="description">
        {props.description ?? ""}
      </p>
      <p id={errorId} data-part="error" aria-live="polite">
        {props.error ?? ""}
      </p>
    </div>
  );
}
