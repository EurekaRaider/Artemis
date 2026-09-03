import { useRef, useState, type KeyboardEvent } from "react";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const NAVIGATION_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const NAVIGATION_COMPONENT_MUTABLE_TOKENS =
  /* @__PURE__ */ Object.freeze([
    "--artemis-color-surface-base",
    "--artemis-color-surface-sunken",
    "--artemis-color-interaction-hover",
    "--artemis-color-interaction-selected",
    "--artemis-color-text-primary",
    "--artemis-color-text-secondary",
    "--artemis-color-border-default",
    "--artemis-color-border-strong",
    "--artemis-color-accent-primary",
    "--artemis-space-1",
    "--artemis-space-2",
    "--artemis-space-3",
    "--artemis-size-control-compact",
    "--artemis-size-control-comfortable",
    "--artemis-border-width-default",
    "--artemis-radius-control",
    "--artemis-typography-body-family",
    "--artemis-typography-label-size",
    "--artemis-typography-body-weight",
    "--artemis-motion-duration-fast",
    "--artemis-motion-easing-standard",
    "--artemis-opacity-disabled",
  ] as const);

export type NavigationControlSize = "compact" | "comfortable";
export type TabsOrientation = "horizontal" | "vertical";
export type NavigationState = "ready" | "selected" | "disabled";

export const NAVIGATION_STATE_PRIORITY = /* @__PURE__ */ Object.freeze([
  "disabled",
  "selected",
  "ready",
] as const satisfies readonly NavigationState[]);

export interface NavigationComponentContract {
  readonly schemaVersion: typeof NAVIGATION_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name: "tabs" | "segmented-control";
  readonly parts: readonly string[];
  readonly states: readonly NavigationState[];
  readonly statePriority: readonly NavigationState[];
  readonly sizes: readonly NavigationControlSize[];
  readonly orientations?: readonly TabsOrientation[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof NAVIGATION_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const NAVIGATION_THEME_CONTRACT = {
  direction: "inherit",
  reducedMotion: "disable-transitions",
  mutableTokens: NAVIGATION_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "accessible-name-required",
    "perceptible-unique-option-labels",
    "focus-indicator-visible",
    "native-disabled-semantics",
    "selected-state-not-color-only",
    "controlled-boundary-fixed-at-mount",
  ],
} as const;

export const NAVIGATION_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  tabs: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "tabs",
    parts: ["root", "tab"],
    states: ["ready", "selected", "disabled"],
    statePriority: NAVIGATION_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    orientations: ["horizontal", "vertical"],
    accessibility: [
      "named-tablist",
      "orientation-announced",
      "tab-selected-and-controls-relations",
      "roving-tabindex",
      "automatic-activation",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "arrow-keys-follow-orientation",
      "home-end-boundaries",
      "disabled-tabs-skipped",
      "native-enter-and-space",
      "one-change-callback-per-selection",
    ],
    theme: NAVIGATION_THEME_CONTRACT,
  },
  segmentedControl: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "segmented-control",
    parts: ["root", "segment"],
    states: ["ready", "selected", "disabled"],
    statePriority: NAVIGATION_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: ["named-group", "native-buttons", "aria-pressed-selection"],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "native-tab-order",
      "native-enter-and-space",
      "one-change-callback-per-selection",
    ],
    theme: NAVIGATION_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, NavigationComponentContract>>);

export interface NavigationComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateNavigationComponentContracts(
  candidate: unknown,
): NavigationComponentContractValidationResult {
  const errors: string[] = [];
  const compare = (actual: unknown, expected: unknown, path: string): void => {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        errors.push(`${path} must be an array`);
        return;
      }
      if (actual.length !== expected.length) {
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

  compare(candidate, NAVIGATION_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

export const NAVIGATION_ACCESSIBLE_NAME_ERROR =
  "Artemis navigation controls require a non-empty accessible label";
export const NAVIGATION_OPTION_ERROR =
  "Artemis navigation options require unique values, perceptibly distinct labels, and at least one enabled option";
export const NAVIGATION_CONTROL_BOUNDARY_ERROR =
  "Artemis navigation controls cannot receive both controlled and default values or switch control mode";
export const NAVIGATION_SELECTION_ERROR =
  "Artemis navigation controls require an enabled selected value";
export const NAVIGATION_TAB_RELATION_ERROR =
  "Artemis Tabs options require unique non-empty tab and panel ids";

function requirePerceptibleLabel(label: string): void {
  if (typeof label !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(label)) {
    throw new Error(NAVIGATION_ACCESSIBLE_NAME_ERROR);
  }
}

function normalizedLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

interface NavigationOptionBase<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

function requireValidOptions<Value extends string>(
  options: readonly NavigationOptionBase<Value>[],
): Value {
  const values = new Set<string>();
  const labels = new Set<string>();
  let firstEnabled: Value | undefined;
  for (const option of options) {
    const label =
      typeof option.label === "string" ? normalizedLabel(option.label) : "";
    if (
      typeof option.value !== "string" ||
      typeof option.label !== "string" ||
      !PERCEPTIBLE_LABEL_CHARACTER.test(option.label) ||
      values.has(option.value) ||
      labels.has(label)
    ) {
      throw new Error(NAVIGATION_OPTION_ERROR);
    }
    values.add(option.value);
    labels.add(label);
    if (!option.disabled && firstEnabled === undefined)
      firstEnabled = option.value;
  }
  if (firstEnabled === undefined) throw new Error(NAVIGATION_OPTION_ERROR);
  return firstEnabled;
}

interface ControlledSelection<Value extends string> {
  readonly value: Value;
  readonly defaultValue?: never;
  readonly onValueChange: (value: Value) => void;
}

interface UncontrolledSelection<Value extends string> {
  readonly value?: never;
  readonly defaultValue?: Value | undefined;
  readonly onValueChange?: ((value: Value) => void) | undefined;
}

type SelectionProps<Value extends string> =
  ControlledSelection<Value> | UncontrolledSelection<Value>;

function useNavigationSelection<Value extends string>(
  value: Value | undefined,
  defaultValue: Value | undefined,
  fallback: Value,
  options: readonly NavigationOptionBase<Value>[],
  onValueChange: ((value: Value) => void) | undefined,
) {
  if (value !== undefined && defaultValue !== undefined) {
    throw new Error(NAVIGATION_CONTROL_BOUNDARY_ERROR);
  }
  const controlled = value !== undefined;
  const initialBoundary = useRef(controlled);
  if (initialBoundary.current !== controlled) {
    throw new Error(NAVIGATION_CONTROL_BOUNDARY_ERROR);
  }
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? fallback,
  );
  const selectedValue = value ?? uncontrolledValue;
  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );
  if (selectedOption === undefined || selectedOption.disabled) {
    throw new Error(NAVIGATION_SELECTION_ERROR);
  }
  const select = (nextValue: Value) => {
    if (!controlled && nextValue !== selectedValue) {
      setUncontrolledValue(nextValue);
    }
    onValueChange?.(nextValue);
  };
  return { selectedValue, select } as const;
}

function optionState(
  selected: boolean,
  disabled: boolean | undefined,
): NavigationState {
  if (disabled) return "disabled";
  if (selected) return "selected";
  return "ready";
}

interface CommonNavigationProps<Value extends string> {
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly id?: string | undefined;
  readonly label: string;
  readonly options: readonly NavigationOptionBase<Value>[];
  readonly size?: NavigationControlSize | undefined;
}

export interface TabOption<
  Value extends string,
> extends NavigationOptionBase<Value> {
  readonly id: string;
  readonly panelId: string;
}

function requireValidTabRelations<Value extends string>(
  options: readonly TabOption<Value>[],
): void {
  const relationIds = new Set<string>();
  for (const option of options) {
    if (
      typeof option.id !== "string" ||
      !/^\S+$/u.test(option.id) ||
      typeof option.panelId !== "string" ||
      !/^\S+$/u.test(option.panelId) ||
      option.id === option.panelId ||
      relationIds.has(option.id) ||
      relationIds.has(option.panelId)
    ) {
      throw new Error(NAVIGATION_TAB_RELATION_ERROR);
    }
    relationIds.add(option.id);
    relationIds.add(option.panelId);
  }
}

export type TabsProps<Value extends string> = Omit<
  CommonNavigationProps<Value>,
  "options"
> & {
  readonly orientation?: TabsOrientation | undefined;
  readonly options: readonly TabOption<Value>[];
} & SelectionProps<Value>;

export function Tabs<Value extends string>({
  className,
  defaultValue,
  disabled,
  id,
  label,
  onValueChange,
  orientation = "horizontal",
  options,
  size = "comfortable",
  value,
}: TabsProps<Value>) {
  requirePerceptibleLabel(label);
  const fallback = requireValidOptions(options);
  requireValidTabRelations(options);
  const { selectedValue, select } = useNavigationSelection(
    value,
    defaultValue,
    fallback,
    options,
    onValueChange,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (event.nativeEvent.isComposing) return;
    const arrowKeys =
      orientation === "vertical"
        ? (["ArrowUp", "ArrowDown"] as const)
        : (["ArrowLeft", "ArrowRight"] as const);
    if (![...arrowKeys, "Home", "End"].includes(event.key)) {
      return;
    }
    const enabledIndexes = options.flatMap((option, index) =>
      option.disabled ? [] : [index],
    );
    const enabledPosition = enabledIndexes.indexOf(currentIndex);
    if (enabledPosition < 0) return;
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = enabledIndexes[0]!;
    } else if (event.key === "End") {
      nextIndex = enabledIndexes.at(-1)!;
    } else {
      let forward = event.key === "ArrowDown";
      if (orientation === "horizontal") {
        const computedDirection = rootRef.current
          ? rootRef.current.ownerDocument.defaultView?.getComputedStyle(
              rootRef.current,
            ).direction
          : undefined;
        const explicitDirection =
          rootRef.current?.closest("[dir]")?.getAttribute("dir") ??
          rootRef.current?.ownerDocument.documentElement.dir;
        const rtl = (computedDirection || explicitDirection) === "rtl";
        forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight");
      }
      const offset = forward ? 1 : -1;
      nextIndex =
        enabledIndexes[
          (enabledPosition + offset + enabledIndexes.length) %
            enabledIndexes.length
        ]!;
    }
    event.preventDefault();
    const nextOption = options[nextIndex]!;
    select(nextOption.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      className={className}
      data-artemis-component="tabs"
      data-part="root"
      data-size={size}
      data-state={disabled ? "disabled" : "ready"}
      id={id}
      ref={rootRef}
      role="tablist"
    >
      {options.map((option, index) => {
        const selected = selectedValue === option.value;
        const optionDisabled = Boolean(disabled || option.disabled);
        return (
          <button
            aria-controls={option.panelId}
            aria-selected={selected}
            data-part="tab"
            data-state={optionState(selected, optionDisabled)}
            disabled={optionDisabled}
            id={option.id}
            key={option.value}
            onClick={() => select(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type SegmentedControlOption<Value extends string> =
  NavigationOptionBase<Value>;

export type SegmentedControlProps<Value extends string> =
  CommonNavigationProps<Value> & SelectionProps<Value>;

export function SegmentedControl<Value extends string>({
  className,
  defaultValue,
  disabled,
  id,
  label,
  onValueChange,
  options,
  size = "comfortable",
  value,
}: SegmentedControlProps<Value>) {
  requirePerceptibleLabel(label);
  const fallback = requireValidOptions(options);
  const { selectedValue, select } = useNavigationSelection(
    value,
    defaultValue,
    fallback,
    options,
    onValueChange,
  );
  return (
    <div
      aria-label={label}
      className={className}
      data-artemis-component="segmented-control"
      data-part="root"
      data-size={size}
      data-state={disabled ? "disabled" : "ready"}
      id={id}
      role="group"
    >
      {options.map((option) => {
        const selected = selectedValue === option.value;
        const optionDisabled = Boolean(disabled || option.disabled);
        return (
          <button
            aria-pressed={selected}
            data-part="segment"
            data-state={optionState(selected, optionDisabled)}
            disabled={optionDisabled}
            key={option.value}
            onClick={() => select(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
