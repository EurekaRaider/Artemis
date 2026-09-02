import {
  forwardRef,
  type ButtonHTMLAttributes,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
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

export const PROFESSIONAL_ACCESSIBLE_NAME_ERROR =
  "Artemis professional shells require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(PROFESSIONAL_ACCESSIBLE_NAME_ERROR);
  }
}

function classes(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export const PROFESSIONAL_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const PROFESSIONAL_COMPONENT_MUTABLE_TOKENS =
  /* @__PURE__ */ Object.freeze([
    "--artemis-color-surface-base",
    "--artemis-color-surface-raised",
    "--artemis-color-interaction-hover",
    "--artemis-color-text-primary",
    "--artemis-color-text-secondary",
    "--artemis-color-border-default",
    "--artemis-color-border-subtle",
    "--artemis-color-accent-primary",
    "--artemis-color-status-danger",
    "--artemis-color-status-danger-subtle",
    "--artemis-color-terminal-background",
    "--artemis-color-terminal-foreground",
    "--artemis-space-1",
    "--artemis-space-2",
    "--artemis-space-3",
    "--artemis-size-control-compact",
    "--artemis-border-width-default",
    "--artemis-radius-control",
    "--artemis-typography-body-family",
    "--artemis-typography-code-family",
    "--artemis-typography-label-size",
    "--artemis-typography-metadata-size",
    "--artemis-opacity-disabled",
  ] as const);

export type ProfessionalComponentState =
  | "ready"
  | "connecting"
  | "loading"
  | "empty"
  | "error"
  | "exited"
  | "disabled";

export interface ProfessionalComponentContract {
  readonly schemaVersion: typeof PROFESSIONAL_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "terminal-surface"
    | "terminal-header"
    | "terminal-viewport"
    | "terminal-host"
    | "terminal-state"
    | "browser-surface"
    | "browser-toolbar"
    | "browser-navigation"
    | "browser-navigation-button"
    | "browser-address-form"
    | "browser-address-input"
    | "browser-go-button"
    | "browser-viewport"
    | "browser-state";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly ProfessionalComponentState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-shell-isolate-technical-content";
    readonly reducedMotion: "no-required-motion";
    readonly mutableTokens: typeof PROFESSIONAL_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const PROFESSIONAL_THEME_CONTRACT = {
  direction: "inherit-shell-isolate-technical-content",
  reducedMotion: "no-required-motion",
  mutableTokens: PROFESSIONAL_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-landmark-and-control-names",
    "focus-indicator-visible",
    "native-disabled-semantics",
    "loading-and-error-semantics",
    "terminal-content-remains-left-to-right",
    "browser-address-remains-left-to-right",
    "long-addresses-and-output-do-not-expand-layout",
    "caller-owns-pty-process-input-resize-and-cleanup",
    "caller-owns-webview-navigation-session-and-security",
  ],
} as const;

export const PROFESSIONAL_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  terminalSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "terminal-surface",
    parts: ["root"],
    states: ["ready", "connecting", "empty", "error", "exited"],
    accessibility: ["named-terminal-region", "busy-state-exposed"],
    interaction: ["caller-owned-terminal-runtime"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  terminalHeader: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "terminal-header",
    parts: ["root", "title", "detail"],
    states: ["ready"],
    accessibility: ["visible-title-and-runtime-detail"],
    interaction: ["presentation-only"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  terminalViewport: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "terminal-viewport",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["technical-content-isolated-left-to-right"],
    interaction: ["caller-owned-terminal-child"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  terminalHost: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "terminal-host",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["terminal-library-owns-interactive-semantics"],
    interaction: ["forwarded-host-ref"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  terminalState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "terminal-state",
    parts: ["root"],
    states: ["connecting", "empty", "error", "exited"],
    accessibility: ["error-alert-other-states-status"],
    interaction: ["presentation-only"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-surface",
    parts: ["root"],
    states: ["ready", "loading", "error"],
    accessibility: ["named-browser-region", "busy-state-exposed"],
    interaction: ["caller-owned-browser-runtime"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserToolbar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-toolbar",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["named-toolbar"],
    interaction: ["caller-owned-navigation-actions"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserNavigation: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-navigation",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["named-navigation-group"],
    interaction: ["caller-owned-history-and-reload-actions"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserNavigationButton: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-navigation-button",
    parts: ["root", "icon"],
    states: ["ready", "disabled"],
    accessibility: ["required-name", "icon-hidden-from-accessibility-tree"],
    interaction: ["native-button-activation"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserAddressForm: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-address-form",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["named-navigation-form"],
    interaction: ["caller-owned-submit"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserAddressInput: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-address-input",
    parts: ["root"],
    states: ["ready", "disabled"],
    accessibility: ["required-name", "technical-text-left-to-right"],
    interaction: ["native-input-events"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserGoButton: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-go-button",
    parts: ["root", "label"],
    states: ["ready", "disabled"],
    accessibility: ["required-visible-name"],
    interaction: ["native-submit-button"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserViewport: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-viewport",
    parts: ["root", "content"],
    states: ["ready"],
    accessibility: ["named-browser-content-region"],
    interaction: ["caller-owned-webview-child"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
  browserState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "browser-state",
    parts: ["root"],
    states: ["loading", "error", "empty"],
    accessibility: ["error-alert-other-states-status"],
    interaction: ["presentation-only"],
    theme: PROFESSIONAL_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, ProfessionalComponentContract>>);

export interface ProfessionalComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateProfessionalComponentContracts(
  candidate: unknown,
): ProfessionalComponentContractValidationResult {
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
      errors.push(`${path} must equal ${String(expected)}`);
    }
  };
  compare(candidate, PROFESSIONAL_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface TerminalSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly state?:
    "ready" | "connecting" | "empty" | "error" | "exited" | undefined;
}

export function TerminalSurface({
  busy = false,
  children,
  className,
  label,
  state = busy ? "connecting" : "ready",
  ...attributes
}: TerminalSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      className={classes("artemis-terminal-surface", className)}
      data-artemis-component="terminal-surface"
      data-state={state}
    >
      {children}
    </section>
  );
}

export interface TerminalHeaderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly detail: ReactNode;
  readonly heading: ReactNode;
}

export function TerminalHeader({
  className,
  detail,
  heading,
  ...attributes
}: TerminalHeaderProps) {
  return (
    <div
      {...attributes}
      className={classes("artemis-terminal-header", className)}
      data-artemis-component="terminal-header"
      data-state="ready"
    >
      <span data-part="title">{heading}</span>
      <span data-part="detail">{detail}</span>
    </div>
  );
}

export function TerminalViewport({
  children,
  className,
  ...attributes
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...attributes}
      className={classes("artemis-terminal-viewport", className)}
      data-artemis-component="terminal-viewport"
      data-state="ready"
    >
      {children}
    </div>
  );
}

export const TerminalHost = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function TerminalHost({ className, ...attributes }, ref) {
  return (
    <div
      {...attributes}
      className={classes("artemis-terminal-host", className)}
      data-artemis-component="terminal-host"
      data-state="ready"
      ref={ref}
    />
  );
});

export interface TerminalStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly state: "connecting" | "empty" | "error" | "exited";
}

export function TerminalState({
  children,
  className,
  state,
  ...attributes
}: TerminalStateProps) {
  return (
    <div
      {...attributes}
      aria-live={state === "error" ? "assertive" : "polite"}
      className={classes("artemis-terminal-state", className)}
      data-artemis-component="terminal-state"
      data-state={state}
      role={state === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export interface BrowserSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly state?: "ready" | "loading" | "error" | undefined;
}

export function BrowserSurface({
  busy = false,
  children,
  className,
  label,
  state = busy ? "loading" : "ready",
  ...attributes
}: BrowserSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      className={classes("artemis-browser-surface", className)}
      data-artemis-component="browser-surface"
      data-state={state}
    >
      {children}
    </section>
  );
}

export interface BrowserToolbarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function BrowserToolbar({
  children,
  className,
  label,
  ...attributes
}: BrowserToolbarProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-toolbar", className)}
      data-artemis-component="browser-toolbar"
      data-state="ready"
      role="toolbar"
    >
      {children}
    </div>
  );
}

export interface BrowserNavigationProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function BrowserNavigation({
  children,
  className,
  label,
  ...attributes
}: BrowserNavigationProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-navigation", className)}
      data-artemis-component="browser-navigation"
      data-state="ready"
      role="group"
    >
      {children}
    </div>
  );
}

export interface BrowserNavigationButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "title" | "type"
> {
  readonly icon: ReactNode;
  readonly label: string;
}

export function BrowserNavigationButton({
  className,
  disabled = false,
  icon,
  label,
  ...attributes
}: BrowserNavigationButtonProps) {
  requirePerceptibleText(label);
  return (
    <button
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-navigation-button", className)}
      data-artemis-component="browser-navigation-button"
      data-state={disabled ? "disabled" : "ready"}
      disabled={disabled}
      title={label}
      type="button"
    >
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
    </button>
  );
}

export interface BrowserAddressFormProps extends Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "aria-label" | "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function BrowserAddressForm({
  children,
  className,
  label,
  ...attributes
}: BrowserAddressFormProps) {
  requirePerceptibleText(label);
  return (
    <form
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-address-form", className)}
      data-artemis-component="browser-address-form"
      data-state="ready"
    >
      {children}
    </form>
  );
}

export interface BrowserAddressInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "aria-label" | "type"
> {
  readonly label: string;
}

export function BrowserAddressInput({
  className,
  disabled = false,
  label,
  ...attributes
}: BrowserAddressInputProps) {
  requirePerceptibleText(label);
  return (
    <input
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-address-input", className)}
      data-artemis-component="browser-address-input"
      data-state={disabled ? "disabled" : "ready"}
      disabled={disabled}
      type="text"
    />
  );
}

export interface BrowserGoButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "type"
> {
  readonly label: string;
}

export function BrowserGoButton({
  className,
  disabled = false,
  label,
  ...attributes
}: BrowserGoButtonProps) {
  requirePerceptibleText(label);
  return (
    <button
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-go-button", className)}
      data-artemis-component="browser-go-button"
      data-state={disabled ? "disabled" : "ready"}
      disabled={disabled}
      type="submit"
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export interface BrowserViewportProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "aria-label" | "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function BrowserViewport({
  children,
  className,
  label,
  ...attributes
}: BrowserViewportProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      className={classes("artemis-browser-viewport", className)}
      data-artemis-component="browser-viewport"
      data-state="ready"
      role="region"
    >
      <div data-part="content">{children}</div>
    </div>
  );
}

export interface BrowserStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly state: "loading" | "error" | "empty";
}

export function BrowserState({
  children,
  className,
  state,
  ...attributes
}: BrowserStateProps) {
  return (
    <div
      {...attributes}
      aria-live={state === "error" ? "assertive" : "polite"}
      className={classes("artemis-browser-state", className)}
      data-artemis-component="browser-state"
      data-state={state}
      role={state === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
