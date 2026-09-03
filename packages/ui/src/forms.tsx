import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const FORM_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const FORM_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-surface-base",
  "--artemis-color-surface-raised",
  "--artemis-color-surface-sunken",
  "--artemis-color-interaction-hover",
  "--artemis-color-interaction-selected",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-border-default",
  "--artemis-color-border-strong",
  "--artemis-color-accent-primary",
  "--artemis-color-accent-on-primary",
  "--artemis-color-status-danger",
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-size-control-compact",
  "--artemis-size-control-comfortable",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-input",
  "--artemis-radius-pill",
  "--artemis-typography-body-family",
  "--artemis-typography-body-size",
  "--artemis-typography-label-size",
  "--artemis-typography-body-weight",
  "--artemis-motion-duration-fast",
  "--artemis-motion-easing-standard",
  "--artemis-opacity-disabled",
] as const);

export type FormControlSize = "compact" | "comfortable";
export type FieldState = "ready" | "read-only" | "error" | "disabled";
export type SelectState = "ready" | "open" | "error" | "disabled";
export type CheckControlState = "ready" | "checked" | "error" | "disabled";

export const FIELD_STATE_PRIORITY = /* @__PURE__ */ Object.freeze([
  "disabled",
  "error",
  "read-only",
  "ready",
] as const satisfies readonly FieldState[]);
export const SELECT_STATE_PRIORITY = /* @__PURE__ */ Object.freeze([
  "disabled",
  "error",
  "open",
  "ready",
] as const satisfies readonly SelectState[]);
export const CHECK_CONTROL_STATE_PRIORITY = /* @__PURE__ */ Object.freeze([
  "disabled",
  "error",
  "checked",
  "ready",
] as const satisfies readonly CheckControlState[]);

export interface FormComponentContract {
  readonly schemaVersion: typeof FORM_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "text-field"
    | "textarea-field"
    | "search-field"
    | "select"
    | "checkbox"
    | "switch";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly string[];
  readonly statePriority: readonly string[];
  readonly sizes: readonly FormControlSize[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof FORM_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const FORM_THEME_CONTRACT = {
  direction: "inherit",
  reducedMotion: "disable-transitions",
  mutableTokens: FORM_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "accessible-name-required",
    "focus-indicator-visible",
    "native-disabled-semantics",
    "error-not-color-only",
    "controlled-boundary-fixed-at-mount",
  ],
} as const;

export const FORM_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  textField: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "text-field",
    parts: ["root", "label", "control"],
    optionalParts: ["description", "error"],
    states: ["ready", "read-only", "error", "disabled"],
    statePriority: FIELD_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "native-label-relation",
      "description-and-error-describedby",
      "aria-invalid-on-error",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "one-change-callback-per-native-change",
      "native-text-editing-and-ime",
    ],
    theme: FORM_THEME_CONTRACT,
  },
  textAreaField: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "textarea-field",
    parts: ["root", "label", "control"],
    optionalParts: ["description", "error"],
    states: ["ready", "read-only", "error", "disabled"],
    statePriority: FIELD_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "native-label-relation",
      "description-and-error-describedby",
      "aria-invalid-on-error",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "one-change-callback-per-native-change",
      "native-multiline-editing-and-ime",
    ],
    theme: FORM_THEME_CONTRACT,
  },
  searchField: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "search-field",
    parts: ["root", "label", "icon", "control"],
    optionalParts: ["description", "error"],
    states: ["ready", "read-only", "error", "disabled"],
    statePriority: FIELD_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "native-search-semantics",
      "decorative-icon-hidden",
      "description-and-error-describedby",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "one-change-callback-per-native-change",
      "native-search-editing-and-ime",
    ],
    theme: FORM_THEME_CONTRACT,
  },
  select: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "select",
    parts: [
      "root",
      "label",
      "trigger",
      "value",
      "indicator",
      "menu",
      "listbox",
      "option",
      "check",
    ],
    optionalParts: ["description", "error", "search", "empty"],
    states: ["ready", "open", "error", "disabled"],
    statePriority: SELECT_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "button-haspopup-listbox",
      "listbox-option-selected",
      "disabled-options-excluded-from-choice",
      "perceptible-unique-option-labels",
      "search-and-empty-states-require-perceptible-labels",
    ],
    interaction: [
      "controlled-value",
      "arrow-home-end-navigation",
      "enter-selects-once-space-selects-only-from-listbox",
      "ime-enter-does-not-select",
      "escape-closes-and-restores-focus",
      "no-portal",
    ],
    theme: FORM_THEME_CONTRACT,
  },
  checkbox: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "checkbox",
    parts: ["root", "control", "indicator", "label"],
    optionalParts: ["description", "error"],
    states: ["ready", "checked", "error", "disabled"],
    statePriority: CHECK_CONTROL_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "native-checkbox-semantics",
      "error-described-by-text",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "one-change-callback-per-native-change",
      "native-space-toggle",
    ],
    theme: FORM_THEME_CONTRACT,
  },
  switch: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "switch",
    parts: ["root", "control", "track", "thumb", "label"],
    optionalParts: ["description", "error"],
    states: ["ready", "checked", "error", "disabled"],
    statePriority: CHECK_CONTROL_STATE_PRIORITY,
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "native-input-role-switch",
      "checked-announced-by-platform",
      "error-described-by-text",
    ],
    interaction: [
      "controlled-or-uncontrolled-fixed-at-mount",
      "one-change-callback-per-native-change",
      "native-space-toggle",
    ],
    theme: FORM_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, FormComponentContract>>);

export interface FormComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateFormComponentContracts(
  candidate: unknown,
): FormComponentContractValidationResult {
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
  compare(candidate, FORM_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;
export const FORM_ACCESSIBLE_NAME_ERROR =
  "Artemis form controls require a non-empty accessible label";
export const FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR =
  "Artemis form control errors require perceptible text";
export const FORM_CONTROL_BOUNDARY_ERROR =
  "Artemis form controls cannot receive both controlled and default values";
export const FORM_SELECT_OPTION_ERROR =
  "Artemis Select options require unique values and perceptibly distinct labels";

function requirePerceptibleLabel(label: string): void {
  if (typeof label !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(label)) {
    throw new Error(FORM_ACCESSIBLE_NAME_ERROR);
  }
}

function requirePerceptibleErrorMessage(error: string | undefined): void {
  if (
    error !== undefined &&
    (typeof error !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(error))
  ) {
    throw new Error(FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR);
  }
}

function requireValidSelectOptions<Value extends string>(
  options: readonly SelectOption<Value>[],
): void {
  const values = new Set<string>();
  const labels = new Set<string>();
  for (const option of options) {
    const normalizedLabel =
      typeof option.label === "string"
        ? option.label
            .normalize("NFKC")
            .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
            .replace(/\p{White_Space}+/gu, " ")
            .trim()
            .toLowerCase()
        : "";
    if (
      typeof option.value !== "string" ||
      typeof option.label !== "string" ||
      !PERCEPTIBLE_LABEL_CHARACTER.test(option.label) ||
      values.has(option.value) ||
      labels.has(normalizedLabel)
    ) {
      throw new Error(FORM_SELECT_OPTION_ERROR);
    }
    values.add(option.value);
    labels.add(normalizedLabel);
  }
}

function requireExclusiveBoundary(
  controlled: unknown,
  uncontrolled: unknown,
): void {
  if (controlled !== undefined && uncontrolled !== undefined) {
    throw new Error(FORM_CONTROL_BOUNDARY_ERROR);
  }
}

function useStableControlBoundary(controlled: boolean): void {
  const initial = useRef(controlled);
  if (initial.current !== controlled) {
    throw new Error(FORM_CONTROL_BOUNDARY_ERROR);
  }
}

function fieldState(
  disabled: boolean | undefined,
  error: string | undefined,
  readOnly: boolean | undefined,
): FieldState {
  if (disabled) return "disabled";
  if (error !== undefined) return "error";
  if (readOnly) return "read-only";
  return "ready";
}

interface FieldShellProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly component: "text-field" | "textarea-field" | "search-field";
  readonly description?: string | undefined;
  readonly descriptionId: string;
  readonly error?: string | undefined;
  readonly errorId: string;
  readonly htmlFor: string;
  readonly label: string;
  readonly labelVisibility: "hidden" | "visible";
  readonly size: FormControlSize;
  readonly state: FieldState;
}

function FieldShell({
  children,
  className,
  component,
  description,
  descriptionId,
  error,
  errorId,
  htmlFor,
  label,
  labelVisibility,
  size,
  state,
}: FieldShellProps) {
  return (
    <div
      className={className}
      data-artemis-component={component}
      data-label-visibility={labelVisibility}
      data-part="root"
      data-size={size}
      data-state={state}
    >
      <label data-part="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {description === undefined ? null : (
        <p data-part="description" id={descriptionId}>
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p data-part="error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface CommonFieldProps {
  readonly autoCapitalize?: string | undefined;
  readonly autoComplete?: string | undefined;
  readonly autoCorrect?: string | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly className?: string | undefined;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: string | undefined;
  readonly id?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly label: string;
  readonly labelVisibility?: "hidden" | "visible" | undefined;
  readonly maxLength?: number | undefined;
  readonly name?: string | undefined;
  readonly onBlur?: FocusEventHandler<HTMLInputElement> | undefined;
  readonly placeholder?: string | undefined;
  readonly pattern?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly size?: FormControlSize | undefined;
  readonly spellCheck?: boolean | undefined;
}

interface ControlledFieldProps {
  readonly value: string;
  readonly defaultValue?: never;
  readonly onValueChange: (value: string) => void;
}

interface UncontrolledFieldProps {
  readonly value?: never;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
}

interface TextFieldSpecificProps extends CommonFieldProps {
  readonly inputMode?:
    | "decimal"
    | "email"
    | "numeric"
    | "search"
    | "tel"
    | "text"
    | "url"
    | undefined;
  readonly max?: number | string | undefined;
  readonly min?: number | string | undefined;
  readonly step?: number | string | undefined;
  readonly type?: "email" | "number" | "password" | "text" | "url";
}

export type TextFieldProps = TextFieldSpecificProps &
  (ControlledFieldProps | UncontrolledFieldProps);

export function TextField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  autoFocus,
  className,
  defaultValue,
  description,
  disabled,
  error,
  id,
  inputMode,
  inputRef,
  label,
  labelVisibility = "visible",
  max,
  maxLength,
  min,
  name,
  onBlur,
  onValueChange,
  placeholder,
  pattern,
  readOnly,
  required,
  size = "comfortable",
  spellCheck,
  step,
  type = "text",
  value,
}: TextFieldProps) {
  requirePerceptibleLabel(label);
  requirePerceptibleErrorMessage(error);
  requireExclusiveBoundary(value, defaultValue);
  useStableControlBoundary(value !== undefined);
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldShell
      className={className}
      component="text-field"
      description={description}
      descriptionId={descriptionId}
      error={error}
      errorId={errorId}
      htmlFor={controlId}
      label={label}
      labelVisibility={labelVisibility}
      size={size}
      state={fieldState(disabled, error, readOnly)}
    >
      <input
        aria-describedby={describedBy || undefined}
        aria-invalid={error === undefined ? undefined : true}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        autoFocus={autoFocus}
        data-part="control"
        defaultValue={defaultValue}
        disabled={disabled}
        id={controlId}
        inputMode={inputMode}
        ref={inputRef}
        max={max}
        maxLength={maxLength}
        min={min}
        name={name}
        onBlur={onBlur}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
        placeholder={placeholder}
        pattern={pattern}
        readOnly={readOnly}
        required={required}
        step={step}
        spellCheck={spellCheck}
        type={type}
        value={value}
      />
    </FieldShell>
  );
}

interface TextAreaFieldSpecificProps {
  readonly autoCapitalize?: string | undefined;
  readonly autoComplete?: string | undefined;
  readonly autoCorrect?: string | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly className?: string | undefined;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: string | undefined;
  readonly id?: string | undefined;
  readonly label: string;
  readonly labelVisibility?: "hidden" | "visible" | undefined;
  readonly maxLength?: number | undefined;
  readonly name?: string | undefined;
  readonly onBlur?: FocusEventHandler<HTMLTextAreaElement> | undefined;
  readonly placeholder?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly rows?: number | undefined;
  readonly size?: FormControlSize | undefined;
  readonly spellCheck?: boolean | undefined;
}

export type TextAreaFieldProps = TextAreaFieldSpecificProps &
  (ControlledFieldProps | UncontrolledFieldProps);

export function TextAreaField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  autoFocus,
  className,
  defaultValue,
  description,
  disabled,
  error,
  id,
  label,
  labelVisibility = "visible",
  maxLength,
  name,
  onBlur,
  onValueChange,
  placeholder,
  readOnly,
  required,
  rows,
  size = "comfortable",
  spellCheck,
  value,
}: TextAreaFieldProps) {
  requirePerceptibleLabel(label);
  requirePerceptibleErrorMessage(error);
  requireExclusiveBoundary(value, defaultValue);
  useStableControlBoundary(value !== undefined);
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldShell
      className={className}
      component="textarea-field"
      description={description}
      descriptionId={descriptionId}
      error={error}
      errorId={errorId}
      htmlFor={controlId}
      label={label}
      labelVisibility={labelVisibility}
      size={size}
      state={fieldState(disabled, error, readOnly)}
    >
      <textarea
        aria-describedby={describedBy || undefined}
        aria-invalid={error === undefined ? undefined : true}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        autoFocus={autoFocus}
        data-part="control"
        defaultValue={defaultValue}
        disabled={disabled}
        id={controlId}
        maxLength={maxLength}
        name={name}
        onBlur={onBlur}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        rows={rows}
        spellCheck={spellCheck}
        value={value}
      />
    </FieldShell>
  );
}

export interface SearchFieldSpecificProps extends CommonFieldProps {
  readonly icon?: ReactNode | undefined;
}

export type SearchFieldProps = SearchFieldSpecificProps &
  (ControlledFieldProps | UncontrolledFieldProps);

function DefaultSearchIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" />
      <path d="m10.4 10.4 3.1 3.1" stroke="currentColor" />
    </svg>
  );
}

export function SearchField({
  autoCapitalize,
  autoComplete,
  autoCorrect,
  autoFocus,
  className,
  defaultValue,
  description,
  disabled,
  error,
  icon = <DefaultSearchIcon />,
  id,
  inputRef,
  label,
  labelVisibility = "hidden",
  maxLength,
  name,
  onBlur,
  onValueChange,
  placeholder,
  pattern,
  readOnly,
  required,
  size = "comfortable",
  spellCheck,
  value,
}: SearchFieldProps) {
  requirePerceptibleLabel(label);
  requirePerceptibleErrorMessage(error);
  requireExclusiveBoundary(value, defaultValue);
  useStableControlBoundary(value !== undefined);
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldShell
      className={className}
      component="search-field"
      description={description}
      descriptionId={descriptionId}
      error={error}
      errorId={errorId}
      htmlFor={controlId}
      label={label}
      labelVisibility={labelVisibility}
      size={size}
      state={fieldState(disabled, error, readOnly)}
    >
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
      <input
        aria-describedby={describedBy || undefined}
        aria-invalid={error === undefined ? undefined : true}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        autoFocus={autoFocus}
        data-part="control"
        defaultValue={defaultValue}
        disabled={disabled}
        id={controlId}
        ref={inputRef}
        maxLength={maxLength}
        name={name}
        onBlur={onBlur}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
        placeholder={placeholder}
        pattern={pattern}
        readOnly={readOnly}
        required={required}
        spellCheck={spellCheck}
        type="search"
        value={value}
      />
    </FieldShell>
  );
}

export interface SelectOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly searchText?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export function filterSelectOptions<Value extends string>(
  options: readonly SelectOption<Value>[],
  query: string,
): SelectOption<Value>[] {
  const compact = (text: string) =>
    text
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/\p{Mark}/gu, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "");
  const terms = query
    .normalize("NFKD")
    .toLocaleLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map(compact)
    .filter(Boolean);
  if (terms.length === 0) return [...options];
  return options.filter((option) => {
    const text = compact(
      option.searchText ?? `${option.label} ${option.value}`,
    );
    return terms.every((term) => {
      if (text.includes(term)) return true;
      let index = 0;
      for (const character of term) {
        index = text.indexOf(character, index);
        if (index < 0) return false;
        index += 1;
      }
      return true;
    });
  });
}

export interface SelectProps<Value extends string> {
  readonly className?: string | undefined;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: string | undefined;
  readonly id?: string | undefined;
  readonly label: string;
  readonly labelVisibility?: "hidden" | "visible" | undefined;
  readonly noResultsLabel?: string | undefined;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SelectOption<Value>[];
  readonly searchPlaceholder?: string | undefined;
  readonly size?: FormControlSize | undefined;
  readonly value: Value;
}

function SelectIndicator() {
  return (
    <svg viewBox="0 0 16 16">
      <path
        d="m4.5 6.25 3.5 3.5 3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Select<Value extends string>({
  className,
  description,
  disabled,
  error,
  id,
  label,
  labelVisibility = "hidden",
  noResultsLabel = "No matching options",
  onValueChange,
  options,
  searchPlaceholder,
  size = "comfortable",
  value,
}: SelectProps<Value>) {
  requirePerceptibleLabel(label);
  requirePerceptibleErrorMessage(error);
  requirePerceptibleLabel(noResultsLabel);
  if (searchPlaceholder !== undefined) {
    requirePerceptibleLabel(searchPlaceholder);
  }
  requireValidSelectOptions(options);
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const listboxId = `${controlId}-listbox`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleOptions = useMemo(
    () => filterSelectOptions(options, query),
    [options, query],
  );
  const allEnabledOptions = options.filter((option) => !option.disabled);
  const enabledOptions = visibleOptions.filter((option) => !option.disabled);
  const effectiveDisabled = Boolean(disabled) || allEnabledOptions.length === 0;
  const menuAvailable = !effectiveDisabled;
  const selected = options.find((option) => option.value === value);
  const selectedMenuIndex = Math.max(
    0,
    allEnabledOptions.findIndex((option) => option.value === value),
  );
  const selectedEnabledIndex = Math.max(
    0,
    enabledOptions.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedMenuIndex);
  const activeVisibleIndex =
    enabledOptions[activeIndex] === undefined
      ? -1
      : visibleOptions.indexOf(enabledOptions[activeIndex]);
  const state: SelectState = effectiveDisabled
    ? "disabled"
    : error !== undefined
      ? "error"
      : open
        ? "open"
        : "ready";
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      (searchPlaceholder === undefined
        ? listbox.current
        : search.current
      )?.focus({ preventScroll: true });
    });
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open, searchPlaceholder]);

  useEffect(() => {
    setActiveIndex(query ? 0 : selectedEnabledIndex);
  }, [query, selectedEnabledIndex]);

  useEffect(() => {
    if (!open || menuAvailable) return;
    setOpen(false);
    setQuery("");
  }, [menuAvailable, open]);

  useLayoutEffect(() => {
    if (!open || activeVisibleIndex < 0) return;
    const listboxElement = listbox.current;
    const option = listboxElement?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    if (!listboxElement || !option) return;
    const listboxBounds = listboxElement.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < listboxBounds.top) {
      listboxElement.scrollTop -= listboxBounds.top - optionBounds.top;
    } else if (optionBounds.bottom > listboxBounds.bottom) {
      listboxElement.scrollTop += optionBounds.bottom - listboxBounds.bottom;
    }
  }, [activeVisibleIndex, open]);

  const openMenu = (initialIndex = selectedMenuIndex) => {
    if (!menuAvailable) return;
    setQuery("");
    setActiveIndex(initialIndex);
    setOpen(true);
  };
  const closeAndFocus = () => {
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  };
  const choose = (option: SelectOption<Value> | undefined) => {
    if (option === undefined || option.disabled) return;
    if (option.value !== value) onValueChange(option.value);
    closeAndFocus();
  };
  const move = (next: number) => {
    if (enabledOptions.length === 0) return;
    setActiveIndex((next + enabledOptions.length) % enabledOptions.length);
  };
  const handleNavigation = (event: KeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, enabledOptions.length - 1));
        break;
      case "Enter":
        if (composing.current || event.nativeEvent.isComposing) return;
        event.preventDefault();
        choose(enabledOptions[activeIndex]);
        break;
      case " ":
        if (event.currentTarget === search.current) return;
        if (composing.current || event.nativeEvent.isComposing) return;
        event.preventDefault();
        choose(enabledOptions[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        closeAndFocus();
        break;
    }
  };

  return (
    <div
      className={className}
      data-artemis-component="select"
      data-label-visibility={labelVisibility}
      data-part="root"
      data-size={size}
      data-state={state}
      ref={root}
    >
      <span data-part="label" id={`${controlId}-label`}>
        {label}
      </span>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-describedby={describedBy || undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={error === undefined ? undefined : true}
        aria-labelledby={`${controlId}-label ${controlId}-value`}
        data-part="trigger"
        disabled={!menuAvailable}
        id={controlId}
        onClick={() => (open ? closeAndFocus() : openMenu())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(
              event.key === "ArrowUp"
                ? Math.max(0, allEnabledOptions.length - 1)
                : selectedEnabledIndex,
            );
          }
        }}
        ref={trigger}
        type="button"
      >
        <span data-part="value" id={`${controlId}-value`}>
          {selected?.label ?? value}
        </span>
        <span aria-hidden="true" data-part="indicator">
          <SelectIndicator />
        </span>
      </button>
      {description === undefined ? null : (
        <p data-part="description" id={descriptionId}>
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p data-part="error" id={errorId}>
          {error}
        </p>
      )}
      {open ? (
        <div data-part="menu">
          {searchPlaceholder === undefined ? null : (
            <input
              aria-activedescendant={
                activeVisibleIndex < 0
                  ? undefined
                  : `${listboxId}-option-${activeVisibleIndex}`
              }
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-label={searchPlaceholder}
              data-part="search"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.currentTarget.value)
              }
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onKeyDown={handleNavigation}
              placeholder={searchPlaceholder}
              ref={search}
              role="combobox"
              type="search"
              value={query}
            />
          )}
          <div
            aria-activedescendant={
              activeVisibleIndex < 0
                ? undefined
                : `${listboxId}-option-${activeVisibleIndex}`
            }
            aria-labelledby={`${controlId}-label`}
            data-part="listbox"
            id={listboxId}
            onKeyDown={handleNavigation}
            ref={listbox}
            role="listbox"
            tabIndex={searchPlaceholder === undefined ? 0 : -1}
          >
            {visibleOptions.length === 0 ? (
              <div data-part="empty">{noResultsLabel}</div>
            ) : (
              visibleOptions.map((option, visibleIndex) => {
                const enabledIndex = enabledOptions.indexOf(option);
                return (
                  <div
                    aria-disabled={option.disabled || undefined}
                    aria-selected={option.value === value}
                    data-active={
                      enabledIndex >= 0 && enabledIndex === activeIndex
                        ? "true"
                        : undefined
                    }
                    data-disabled={option.disabled || undefined}
                    data-part="option"
                    id={`${listboxId}-option-${visibleIndex}`}
                    key={option.value}
                    onClick={() => choose(option)}
                    onMouseMove={() => {
                      if (enabledIndex >= 0) setActiveIndex(enabledIndex);
                    }}
                    role="option"
                  >
                    <span aria-hidden="true" data-part="check">
                      {option.value === value ? "✓" : ""}
                    </span>
                    <span>{option.label}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface CommonCheckControlProps {
  readonly className?: string | undefined;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: string | undefined;
  readonly id?: string | undefined;
  readonly label: string;
  readonly labelVisibility?: "hidden" | "visible" | undefined;
  readonly name?: string | undefined;
  readonly size?: FormControlSize | undefined;
  readonly title?: string | undefined;
}

interface ControlledCheckControlProps {
  readonly checked: boolean;
  readonly defaultChecked?: never;
  readonly onCheckedChange: (checked: boolean) => void;
}

interface UncontrolledCheckControlProps {
  readonly checked?: never;
  readonly defaultChecked?: boolean | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
}

export type CheckControlProps = CommonCheckControlProps &
  (ControlledCheckControlProps | UncontrolledCheckControlProps);

function CheckControl({
  checked,
  className,
  component,
  defaultChecked,
  description,
  disabled,
  error,
  id,
  label,
  labelVisibility = "visible",
  name,
  onCheckedChange,
  size = "compact",
  title,
}: CheckControlProps & { readonly component: "checkbox" | "switch" }) {
  requirePerceptibleLabel(label);
  requirePerceptibleErrorMessage(error);
  requireExclusiveBoundary(checked, defaultChecked);
  useStableControlBoundary(checked !== undefined);
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");
  const [uncontrolledChecked, setUncontrolledChecked] = useState(
    defaultChecked ?? false,
  );
  const resolvedChecked = checked ?? uncontrolledChecked;
  const state: CheckControlState = disabled
    ? "disabled"
    : error !== undefined
      ? "error"
      : resolvedChecked
        ? "checked"
        : "ready";
  return (
    <div
      className={className}
      data-artemis-component={component}
      data-label-visibility={labelVisibility}
      data-part="root"
      data-size={size}
      data-state={state}
      title={title}
    >
      <label htmlFor={controlId}>
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={error === undefined ? undefined : true}
          checked={checked}
          data-part="control"
          defaultChecked={defaultChecked}
          disabled={disabled}
          id={controlId}
          name={name}
          onChange={(event) => {
            if (checked === undefined) {
              setUncontrolledChecked(event.currentTarget.checked);
            }
            onCheckedChange?.(event.currentTarget.checked);
          }}
          role={component === "switch" ? "switch" : undefined}
          type="checkbox"
        />
        {component === "switch" ? (
          <span aria-hidden="true" data-part="track">
            <span data-part="thumb" />
          </span>
        ) : (
          <span aria-hidden="true" data-part="indicator">
            {resolvedChecked ? "✓" : ""}
          </span>
        )}
        <span data-part="label">{label}</span>
      </label>
      {description === undefined ? null : (
        <span data-part="description" id={descriptionId}>
          {description}
        </span>
      )}
      {error === undefined ? null : (
        <span data-part="error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Checkbox(props: CheckControlProps) {
  return <CheckControl {...props} component="checkbox" />;
}

export function Switch(props: CheckControlProps) {
  return <CheckControl {...props} component="switch" />;
}
