import {
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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

export const LAYOUT_ACCESSIBLE_NAME_ERROR =
  "Artemis layout components require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(LAYOUT_ACCESSIBLE_NAME_ERROR);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export const LAYOUT_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const LAYOUT_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
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
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-space-6",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-card",
  "--artemis-typography-body-family",
  "--artemis-typography-body-size",
  "--artemis-typography-label-size",
  "--artemis-typography-body-weight",
  "--artemis-motion-duration-fast",
  "--artemis-motion-easing-standard",
  "--artemis-opacity-disabled",
] as const);

export type LayoutState = "ready" | "selected" | "disabled";

export interface LayoutComponentContract {
  readonly schemaVersion: typeof LAYOUT_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    "toolbar" | "list-row" | "panel-header" | "scroll-area" | "split-pane";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly LayoutState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof LAYOUT_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const LAYOUT_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: LAYOUT_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "accessible-name-required-for-landmarks-and-separators",
    "focus-indicator-visible",
    "minimum-target-size-preserved",
    "content-may-shrink-without-clipping",
    "split-size-is-controlled-by-caller",
    "rtl-keyboard-and-pointer-intent",
  ],
} as const;

export const LAYOUT_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  toolbar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "toolbar",
    parts: ["root", "leading", "actions"],
    optionalParts: ["title"],
    states: ["ready"],
    accessibility: ["toolbar-role", "required-perceptible-label"],
    interaction: ["native-child-tab-order", "logical-leading-and-actions"],
    theme: LAYOUT_THEME_CONTRACT,
  },
  listRow: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "list-row",
    parts: ["root", "label"],
    optionalParts: ["icon", "description", "accessory"],
    states: ["ready", "selected", "disabled"],
    accessibility: ["option-or-treeitem-role", "selected-and-disabled-state"],
    interaction: ["native-button-activation", "caller-owned-selection"],
    theme: LAYOUT_THEME_CONTRACT,
  },
  panelHeader: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "panel-header",
    parts: ["root", "title"],
    optionalParts: ["description", "actions"],
    states: ["ready"],
    accessibility: ["visible-heading", "caller-selects-heading-level"],
    interaction: ["caller-owned-actions"],
    theme: LAYOUT_THEME_CONTRACT,
  },
  scrollArea: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "scroll-area",
    parts: ["root", "viewport"],
    states: ["ready"],
    accessibility: [
      "region-role",
      "required-perceptible-label",
      "keyboard-scrollable",
    ],
    interaction: ["native-scroll", "logical-scrollbar-gutter"],
    theme: LAYOUT_THEME_CONTRACT,
  },
  splitPane: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "split-pane",
    parts: ["root", "primary", "separator", "secondary"],
    states: ["ready", "disabled"],
    accessibility: [
      "separator-role",
      "required-perceptible-label",
      "value-min-max-now-text",
      "keyboard-operable",
    ],
    interaction: [
      "controlled-size-only",
      "pointer-drag",
      "arrow-step",
      "home-minimum",
      "end-maximum",
      "rtl-logical-intent",
    ],
    theme: LAYOUT_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, LayoutComponentContract>>);

export interface LayoutComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateLayoutComponentContracts(
  candidate: unknown,
): LayoutComponentContractValidationResult {
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
  compare(candidate, LAYOUT_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface ToolbarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  readonly actions: ReactNode;
  readonly children?: ReactNode | undefined;
  readonly label: string;
  readonly title?: ReactNode | undefined;
}

export function Toolbar({
  actions,
  children,
  label,
  title,
  ...attributes
}: ToolbarProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="toolbar"
      data-part="root"
      data-state="ready"
      role="toolbar"
    >
      <div data-part="leading">
        {title ? <strong data-part="title">{title}</strong> : null}
        {children}
      </div>
      <div data-part="actions">{actions}</div>
    </div>
  );
}

export interface ListRowProps extends Omit<
  HTMLAttributes<HTMLButtonElement>,
  "children" | "role"
> {
  readonly accessory?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly label: ReactNode;
  readonly level?: number | undefined;
  readonly role?: "option" | "treeitem" | undefined;
  readonly selected?: boolean | undefined;
}

export function ListRow({
  accessory,
  description,
  disabled,
  icon,
  label,
  level,
  role = "option",
  selected,
  style,
  ...attributes
}: ListRowProps) {
  return (
    <button
      {...attributes}
      aria-disabled={disabled || undefined}
      aria-level={role === "treeitem" ? Math.max(1, level ?? 1) : undefined}
      aria-selected={selected}
      data-artemis-component="list-row"
      data-part="root"
      data-state={disabled ? "disabled" : selected ? "selected" : "ready"}
      disabled={disabled}
      role={role}
      style={style}
      type="button"
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <span data-part="content">
        <span data-part="label">{label}</span>
        {description ? (
          <span data-part="description">{description}</span>
        ) : null}
      </span>
      {accessory ? <span data-part="accessory">{accessory}</span> : null}
    </button>
  );
}

export interface PanelHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  readonly title: ReactNode;
}

export function PanelHeader({
  actions,
  description,
  headingLevel = 2,
  title,
  ...attributes
}: PanelHeaderProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <header
      {...attributes}
      data-artemis-component="panel-header"
      data-part="root"
      data-state="ready"
    >
      <div data-part="content">
        <Heading data-part="title">{title}</Heading>
        {description ? <div data-part="description">{description}</div> : null}
      </div>
      {actions ? <div data-part="actions">{actions}</div> : null}
    </header>
  );
}

export interface ScrollAreaProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function ScrollArea({
  children,
  label,
  tabIndex = 0,
  ...attributes
}: ScrollAreaProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="scroll-area"
      data-part="root"
      data-state="ready"
      role="region"
    >
      <div data-part="viewport" tabIndex={tabIndex}>
        {children}
      </div>
    </div>
  );
}

export interface SplitPaneProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onChange"
> {
  readonly disabled?: boolean | undefined;
  readonly label: string;
  readonly maximumSize: number;
  readonly minimumSize: number;
  readonly onSizeChange: (size: number) => void;
  readonly primary: ReactNode;
  readonly secondary: ReactNode;
  readonly size: number;
  readonly step?: number | undefined;
  readonly valueText?: ((size: number) => string) | undefined;
}

interface DragState {
  readonly direction: 1 | -1;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startSize: number;
}

export function SplitPane({
  disabled,
  label,
  maximumSize,
  minimumSize,
  onSizeChange,
  primary,
  secondary,
  size,
  step = 16,
  style,
  valueText = (value) => `${Math.round(value)} pixels`,
  ...attributes
}: SplitPaneProps) {
  requirePerceptibleText(label);
  if (
    !Number.isFinite(minimumSize) ||
    !Number.isFinite(maximumSize) ||
    !Number.isFinite(size) ||
    !Number.isFinite(step) ||
    step <= 0 ||
    minimumSize > maximumSize
  ) {
    throw new Error(
      "Artemis SplitPane requires finite size bounds and a positive step",
    );
  }
  const resolvedSize = clamp(size, minimumSize, maximumSize);
  const dragRef = useRef<DragState | null>(null);
  const resize = (nextSize: number) => {
    const next = clamp(Math.round(nextSize), minimumSize, maximumSize);
    if (next !== resolvedSize) onSizeChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const direction = getComputedStyle(event.currentTarget).direction;
    const logicalStep = Math.max(1, Math.round(step));
    let next: number | null = null;
    if (event.key === "Home") next = minimumSize;
    if (event.key === "End") next = maximumSize;
    if (event.key === "ArrowLeft") {
      next = resolvedSize + (direction === "rtl" ? logicalStep : -logicalStep);
    }
    if (event.key === "ArrowRight") {
      next = resolvedSize + (direction === "rtl" ? -logicalStep : logicalStep);
    }
    if (next === null) return;
    event.preventDefault();
    resize(next);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    const direction = getComputedStyle(event.currentTarget).direction;
    dragRef.current = {
      direction: direction === "rtl" ? -1 : 1,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startSize: resolvedSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resize(
      drag.startSize + (event.clientX - drag.startClientX) * drag.direction,
    );
  };
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };
  const splitStyle = {
    ...style,
    "--_artemis-split-pane-size": `${resolvedSize}px`,
  } as CSSProperties;
  return (
    <div
      {...attributes}
      data-artemis-component="split-pane"
      data-part="root"
      data-state={disabled ? "disabled" : "ready"}
      style={splitStyle}
    >
      <div data-part="primary">{primary}</div>
      <div
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemax={maximumSize}
        aria-valuemin={minimumSize}
        aria-valuenow={resolvedSize}
        aria-valuetext={valueText(resolvedSize)}
        data-part="separator"
        onKeyDown={handleKeyDown}
        onLostPointerCapture={() => {
          dragRef.current = null;
        }}
        onPointerCancel={finishPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        role="separator"
        tabIndex={disabled ? -1 : 0}
      />
      <div data-part="secondary">{secondary}</div>
    </div>
  );
}
