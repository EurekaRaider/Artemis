import { Children, isValidElement } from "react";
import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const ACTION_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const ACTION_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-surface-base",
  "--artemis-color-surface-sunken",
  "--artemis-color-interaction-hover",
  "--artemis-color-interaction-selected",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-border-default",
  "--artemis-color-border-strong",
  "--artemis-color-accent-primary",
  "--artemis-color-accent-hover",
  "--artemis-color-accent-on-primary",
  "--artemis-color-status-success",
  "--artemis-color-status-warning",
  "--artemis-color-status-danger",
  "--artemis-color-status-info",
  "--artemis-color-status-success-subtle",
  "--artemis-color-status-warning-subtle",
  "--artemis-color-status-danger-subtle",
  "--artemis-color-status-info-subtle",
  "--artemis-color-status-on-danger",
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-space-6",
  "--artemis-size-control-compact",
  "--artemis-size-control-comfortable",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-pill",
  "--artemis-typography-body-family",
  "--artemis-typography-label-size",
  "--artemis-typography-body-weight",
  "--artemis-motion-duration-fast",
  "--artemis-motion-easing-standard",
  "--artemis-opacity-disabled",
] as const);

export type ActionButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ActionControlSize = "compact" | "comfortable";
export type ActionIconSize = "xs" | "sm" | "base" | "lg" | "xl";
export type ActionTone = "neutral" | "info" | "success" | "warning" | "danger";
export type ActionState =
  "ready" | "selected" | "error" | "loading" | "disabled";

export const ACTION_STATE_PRIORITY = /* @__PURE__ */ Object.freeze([
  "disabled",
  "loading",
  "error",
  "selected",
  "ready",
] as const satisfies readonly ActionState[]);

export interface ActionComponentContract {
  readonly schemaVersion: typeof ACTION_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name: "button" | "icon-button" | "icon" | "badge" | "status";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly ActionState[];
  readonly statePriority?: readonly ActionState[];
  readonly variants?: readonly string[];
  readonly sizes?: readonly string[];
  readonly tones?: readonly string[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit";
    readonly reducedMotion: "disable-transitions-and-transform";
    readonly mutableTokens: typeof ACTION_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const ACTION_THEME_CONTRACT = {
  direction: "inherit",
  reducedMotion: "disable-transitions-and-transform",
  mutableTokens: ACTION_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "accessible-name-required-for-buttons",
    "button-accessible-name-contains-visible-label",
    "focus-indicator-visible",
    "loading-blocks-action",
    "native-disabled-semantics",
    "status-not-color-only",
  ],
} as const;

export const ACTION_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  button: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "button",
    parts: ["root", "label", "state-indicator"],
    optionalParts: ["icon"],
    states: ["ready", "selected", "error", "loading", "disabled"],
    statePriority: ACTION_STATE_PRIORITY,
    variants: ["primary", "secondary", "quiet", "danger"],
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-visible-label",
      "optional-aria-label-must-contain-visible-label",
      "aria-busy-while-loading",
      "aria-invalid-on-error",
      "aria-pressed-only-when-selectable",
    ],
    interaction: [
      "default-type-button",
      "native-enter-and-space",
      "one-callback-per-activation",
      "loading-and-disabled-block-activation",
    ],
    theme: ACTION_THEME_CONTRACT,
  },
  iconButton: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "icon-button",
    parts: ["root", "icon", "state-indicator"],
    states: ["ready", "selected", "error", "loading", "disabled"],
    statePriority: ACTION_STATE_PRIORITY,
    variants: ["secondary", "quiet", "danger"],
    sizes: ["compact", "comfortable"],
    accessibility: [
      "required-perceptible-label",
      "decorative-icon-hidden",
      "aria-busy-while-loading",
      "aria-invalid-on-error",
      "aria-pressed-only-when-selectable",
    ],
    interaction: [
      "default-type-button",
      "native-enter-and-space",
      "one-callback-per-activation",
      "loading-and-disabled-block-activation",
    ],
    theme: ACTION_THEME_CONTRACT,
  },
  icon: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "icon",
    parts: ["root"],
    states: ["ready"],
    sizes: ["xs", "sm", "base", "lg", "xl"],
    accessibility: [
      "decorative-only",
      "consumer-control-owns-accessible-name",
      "platform-neutral-consumer-asset",
    ],
    interaction: ["none"],
    theme: ACTION_THEME_CONTRACT,
  },
  badge: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "badge",
    parts: ["root", "indicator", "label"],
    states: ["ready"],
    tones: ["neutral", "info", "success", "warning", "danger"],
    accessibility: ["visible-text-required", "indicator-is-redundant"],
    interaction: ["none"],
    theme: ACTION_THEME_CONTRACT,
  },
  status: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "status",
    parts: ["root", "indicator", "label"],
    states: ["ready"],
    tones: ["neutral", "info", "success", "warning", "danger"],
    accessibility: [
      "visible-text-required",
      "indicator-is-redundant",
      "live-region-is-explicit-opt-in",
    ],
    interaction: ["none"],
    theme: ACTION_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, ActionComponentContract>>);

export interface ActionComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateActionComponentContracts(
  candidate: unknown,
): ActionComponentContractValidationResult {
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

  compare(candidate, ACTION_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

export const ACTION_ACCESSIBLE_NAME_ERROR =
  "Artemis action controls require a non-empty accessible label";
export const ACTION_BUTTON_VISIBLE_LABEL_ERROR =
  "Artemis Button requires non-empty visible text";
export const ACTION_LABEL_IN_NAME_ERROR =
  "Artemis Button accessible labels must contain the visible label";
export const ACTION_VISIBLE_TEXT_ERROR =
  "Artemis Badge and Status require non-empty visible text";

function requirePerceptibleLabel(label: string): void {
  if (typeof label !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(label)) {
    throw new Error(ACTION_ACCESSIBLE_NAME_ERROR);
  }
}

function requireVisibleText(children: string): void {
  if (
    typeof children !== "string" ||
    !PERCEPTIBLE_LABEL_CHARACTER.test(children)
  ) {
    throw new Error(ACTION_VISIBLE_TEXT_ERROR);
  }
}

function perceptibleText(node: ReactNode): string {
  let value = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      value += String(child);
      return;
    }
    if (!isValidElement(child)) return;
    const props = child.props as {
      readonly "aria-hidden"?: boolean | "true" | "false";
      readonly children?: ReactNode;
    };
    if (props["aria-hidden"] === true || props["aria-hidden"] === "true") {
      return;
    }
    const nestedText = perceptibleText(props.children);
    if (nestedText) value += ` ${nestedText} `;
  });
  return value
    .replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, " ")
    .trim();
}

function requireButtonLabel(
  children: ReactNode,
  label: string | undefined,
): void {
  const visibleLabel = perceptibleText(children);
  if (!PERCEPTIBLE_LABEL_CHARACTER.test(visibleLabel)) {
    throw new Error(ACTION_BUTTON_VISIBLE_LABEL_ERROR);
  }
  if (label === undefined) return;
  requirePerceptibleLabel(label);
  if (!perceptibleText(label).includes(visibleLabel)) {
    throw new Error(ACTION_LABEL_IN_NAME_ERROR);
  }
}

function actionState({
  disabled,
  error,
  loading,
  selected,
}: {
  readonly disabled: boolean | undefined;
  readonly error: boolean | undefined;
  readonly loading: boolean | undefined;
  readonly selected: boolean | undefined;
}): ActionState {
  const active: Readonly<Record<ActionState, boolean>> = {
    disabled: Boolean(disabled),
    loading: Boolean(loading),
    error: Boolean(error),
    selected: Boolean(selected),
    ready: true,
  };
  return ACTION_STATE_PRIORITY.find((state) => active[state]) ?? "ready";
}

function stateIndicator(state: ActionState) {
  const content =
    state === "loading"
      ? "…"
      : state === "error"
        ? "!"
        : state === "selected"
          ? "✓"
          : null;
  return (
    <span aria-hidden="true" data-part="state-indicator">
      {content}
    </span>
  );
}

type NativeButtonType = NonNullable<
  ButtonHTMLAttributes<HTMLButtonElement>["type"]
>;

interface CommonActionProps {
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: boolean | undefined;
  readonly id?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  readonly selected?: boolean | undefined;
  readonly size?: ActionControlSize | undefined;
  readonly title?: string | undefined;
  readonly type?: NativeButtonType | undefined;
}

export interface ButtonProps extends CommonActionProps {
  readonly align?: "center" | "start" | undefined;
  readonly children: ReactNode;
  readonly icon?: ReactNode | undefined;
  readonly iconSize?: ActionIconSize | undefined;
  readonly label?: string | undefined;
  readonly variant?: ActionButtonVariant | undefined;
}

export function Button({
  align = "center",
  children,
  className,
  disabled,
  error,
  icon,
  iconSize = "base",
  id,
  label,
  loading,
  onClick,
  selected,
  size = "compact",
  title,
  type = "button",
  variant = "secondary",
}: ButtonProps) {
  requireButtonLabel(children, label);
  const state = actionState({ disabled, error, loading, selected });
  return (
    <button
      aria-busy={loading || undefined}
      aria-invalid={error || undefined}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      className={className}
      data-align={align}
      data-artemis-component="button"
      data-part="root"
      data-size={size}
      data-state={state}
      data-variant={variant}
      disabled={disabled || loading}
      id={id}
      onClick={onClick}
      title={title}
      type={type}
    >
      {icon === undefined ? null : (
        <span data-part="icon">
          <Icon size={iconSize}>{icon}</Icon>
        </span>
      )}
      <span data-part="label">{children}</span>
      {stateIndicator(state)}
    </button>
  );
}

export interface IconButtonProps extends CommonActionProps {
  readonly icon: ReactNode;
  readonly iconSize?: ActionIconSize | undefined;
  readonly label: string;
  readonly variant?: Exclude<ActionButtonVariant, "primary"> | undefined;
}

export function IconButton({
  className,
  disabled,
  error,
  icon,
  iconSize = "base",
  id,
  label,
  loading,
  onClick,
  selected,
  size = "compact",
  title,
  type = "button",
  variant = "quiet",
}: IconButtonProps) {
  requirePerceptibleLabel(label);
  const state = actionState({ disabled, error, loading, selected });
  return (
    <button
      aria-busy={loading || undefined}
      aria-invalid={error || undefined}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      className={className}
      data-artemis-component="icon-button"
      data-part="root"
      data-size={size}
      data-state={state}
      data-variant={variant}
      disabled={disabled || loading}
      id={id}
      onClick={onClick}
      title={title}
      type={type}
    >
      <span data-part="icon">
        <Icon size={iconSize}>{icon}</Icon>
      </span>
      {stateIndicator(state)}
    </button>
  );
}

export interface IconProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly size?: ActionIconSize | undefined;
}

export function Icon({ children, className, size = "base" }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      data-artemis-component="icon"
      data-part="root"
      data-size={size}
      data-state="ready"
    >
      {children}
    </span>
  );
}

interface StatusTextProps {
  readonly children: string;
  readonly className?: string | undefined;
  readonly tone?: ActionTone | undefined;
}

export type BadgeProps = StatusTextProps;

export function Badge({ children, className, tone = "neutral" }: BadgeProps) {
  requireVisibleText(children);
  return (
    <span
      className={className}
      data-artemis-component="badge"
      data-part="root"
      data-state="ready"
      data-tone={tone}
    >
      <span aria-hidden="true" data-part="indicator" />
      <span data-part="label">{children}</span>
    </span>
  );
}

export interface StatusProps extends StatusTextProps {
  readonly live?: "assertive" | "polite" | undefined;
}

export function Status({
  children,
  className,
  live,
  tone = "neutral",
}: StatusProps) {
  requireVisibleText(children);
  return (
    <span
      aria-live={live}
      className={className}
      data-artemis-component="status"
      data-part="root"
      data-state="ready"
      data-tone={tone}
      role={live === undefined ? undefined : "status"}
    >
      <span aria-hidden="true" data-part="indicator" />
      <span data-part="label">{children}</span>
    </span>
  );
}
