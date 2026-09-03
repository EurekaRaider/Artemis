import {
  useId,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
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

export const DATA_ACCESSIBLE_NAME_ERROR =
  "Artemis data displays require perceptible labels";
export const DATA_HEATMAP_GEOMETRY_ERROR =
  "Artemis data heatmaps require positive integer rows and columns";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(DATA_ACCESSIBLE_NAME_ERROR);
  }
}

export const DATA_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const DATA_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
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
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-space-5",
  "--artemis-space-6",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-card",
  "--artemis-typography-body-family",
  "--artemis-typography-code-family",
  "--artemis-typography-body-size",
  "--artemis-typography-body-weight",
  "--artemis-typography-label-size",
  "--artemis-typography-metadata-size",
  "--artemis-motion-duration-fast",
  "--artemis-motion-easing-standard",
  "--artemis-shadow-overlay",
  "--artemis-opacity-disabled",
] as const);

export type DataState =
  "ready" | "loading" | "empty" | "error" | "busy" | "disabled";

export interface DataComponentContract {
  readonly schemaVersion: typeof DATA_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name: "data-surface" | "data-stat" | "data-heatmap";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly DataState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof DATA_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const DATA_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: DATA_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-labels",
    "heatmap-values-have-text-alternatives",
    "heatmap-focus-indicator-visible",
    "heatmap-intensity-is-not-color-only",
    "caller-owns-data-loading-calculation-and-effects",
    "long-labels-and-values-do-not-expand-layout",
  ],
} as const;

export const DATA_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  dataSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "data-surface",
    parts: ["root", "content"],
    optionalParts: ["header", "toolbar"],
    states: ["ready", "loading", "empty", "error", "busy", "disabled"],
    accessibility: ["named-data-region", "busy-state-exposed"],
    interaction: ["caller-owned-loading-filtering-and-effects"],
    theme: DATA_THEME_CONTRACT,
  },
  dataStat: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "data-stat",
    parts: ["root", "value", "label"],
    states: ["ready"],
    accessibility: ["visible-label-and-value"],
    interaction: ["presentation-only"],
    theme: DATA_THEME_CONTRACT,
  },
  dataHeatmap: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "data-heatmap",
    parts: ["root", "grid", "row", "cell", "column-labels", "column-label"],
    optionalParts: ["tooltip"],
    states: ["ready", "loading", "empty", "error", "busy", "disabled"],
    accessibility: [
      "named-grid",
      "every-cell-has-a-perceptible-value-label",
      "intensity-is-supplemented-by-text",
      "roving-grid-focus",
    ],
    interaction: [
      "arrow-navigation-follows-direction",
      "caller-owns-active-cell-and-period",
      "caller-owns-cell-values-and-formatting",
    ],
    theme: DATA_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, DataComponentContract>>);

export interface DataComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateDataComponentContracts(
  candidate: unknown,
): DataComponentContractValidationResult {
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
  compare(candidate, DATA_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface DataSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly header?: ReactNode | undefined;
  readonly label: string;
  readonly state?: DataState | undefined;
  readonly toolbar?: ReactNode | undefined;
}

export function DataSurface({
  busy,
  children,
  header,
  label,
  state = busy ? "busy" : "ready",
  toolbar,
  ...attributes
}: DataSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      data-artemis-component="data-surface"
      data-part="root"
      data-state={state}
      role="region"
    >
      {header ? <div data-part="header">{header}</div> : null}
      {toolbar ? <div data-part="toolbar">{toolbar}</div> : null}
      <div data-part="content">{children}</div>
    </section>
  );
}

export interface DataStatProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly label: string;
  readonly value: string;
}

export function DataStat({ label, value, ...attributes }: DataStatProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(value);
  return (
    <div
      {...attributes}
      data-artemis-component="data-stat"
      data-part="root"
      data-state="ready"
    >
      <strong data-part="value">{value}</strong>
      <span data-part="label">{label}</span>
    </div>
  );
}

export interface DataHeatmapCell {
  readonly id: string;
  readonly label: string;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly periodKey: string;
  readonly tooltipAlign?: "start" | "end" | undefined;
}

export interface DataHeatmapColumnLabel {
  readonly column: number;
  readonly id: string;
  readonly label: string;
}

export interface DataHeatmapProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onChange"
> {
  readonly activeCellId?: string | undefined;
  readonly cells: readonly DataHeatmapCell[];
  readonly columnLabels?: readonly DataHeatmapColumnLabel[] | undefined;
  readonly columns: number;
  readonly label: string;
  readonly onActiveCellChange: (cellId: string | undefined) => void;
  readonly rows: number;
  readonly state?: DataState | undefined;
}

function inheritedDirection(element: HTMLElement): "ltr" | "rtl" {
  const declared = element.closest<HTMLElement>("[dir]")?.getAttribute("dir");
  if (declared === "rtl") return "rtl";
  if (declared === "ltr") return "ltr";
  return getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr";
}

function scrollIntoNearestInlineView(element: HTMLElement): void {
  let scrollPort = element.parentElement;
  while (scrollPort) {
    const overflow = getComputedStyle(scrollPort).overflowX;
    if (
      /^(auto|overlay|scroll)$/u.test(overflow) &&
      scrollPort.scrollWidth > scrollPort.clientWidth
    ) {
      const bounds = element.getBoundingClientRect();
      const portBounds = scrollPort.getBoundingClientRect();
      const margin = 3;
      const delta =
        bounds.left < portBounds.left + margin
          ? bounds.left - portBounds.left - margin
          : bounds.right > portBounds.right - margin
            ? bounds.right - portBounds.right + margin
            : 0;
      if (delta !== 0) scrollPort.scrollLeft += delta;
      return;
    }
    scrollPort = scrollPort.parentElement;
  }
}

export function DataHeatmap({
  activeCellId,
  cells,
  columnLabels = [],
  columns,
  label,
  onActiveCellChange,
  rows,
  state = "ready",
  style,
  ...attributes
}: DataHeatmapProps) {
  requirePerceptibleText(label);
  for (const cell of cells) {
    requirePerceptibleText(cell.id);
    requirePerceptibleText(cell.label);
    requirePerceptibleText(cell.periodKey);
  }
  for (const columnLabel of columnLabels) {
    requirePerceptibleText(columnLabel.id);
    requirePerceptibleText(columnLabel.label);
  }
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isInteger(columns) ||
    columns < 1
  ) {
    throw new Error(DATA_HEATMAP_GEOMETRY_ERROR);
  }
  const tooltipId = useId();
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = state === "disabled";
  const activeIndex = Math.max(
    0,
    cells.findIndex((cell) => cell.id === activeCellId),
  );
  const activePeriod = cells.find(
    (cell) => cell.id === activeCellId,
  )?.periodKey;
  const geometryStyle = {
    ...style,
    "--data-columns": columns,
    "--data-rows": rows,
  } as CSSProperties;
  const gridRows = Array.from({ length: rows }, (_, rowIndex) =>
    cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ index }) => index % rows === rowIndex),
  );

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    const row = index % rows;
    const rtl = inheritedDirection(event.currentTarget) === "rtl";
    let nextIndex = index;
    if (event.key === "ArrowDown" && row < rows - 1) {
      nextIndex = Math.min(index + 1, cells.length - 1);
    } else if (event.key === "ArrowUp" && row > 0) {
      nextIndex = index - 1;
    } else if (event.key === "ArrowRight") {
      nextIndex = index + (rtl ? -rows : rows);
    } else if (event.key === "ArrowLeft") {
      nextIndex = index + (rtl ? rows : -rows);
    } else if (event.key === "Home") {
      nextIndex = index - row;
    } else if (event.key === "End") {
      nextIndex = Math.min(index - row + rows - 1, cells.length - 1);
    } else {
      return;
    }
    event.preventDefault();
    if (nextIndex < 0 || nextIndex >= cells.length || nextIndex === index) {
      return;
    }
    const next = cells[nextIndex];
    if (!next) return;
    onActiveCellChange(next.id);
    const nextElement = cellRefs.current[nextIndex];
    nextElement?.focus({ preventScroll: true });
    if (nextElement) scrollIntoNearestInlineView(nextElement);
  };

  return (
    <div
      {...attributes}
      data-artemis-component="data-heatmap"
      data-part="root"
      data-state={state}
      style={geometryStyle}
    >
      <div
        aria-colcount={columns}
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-rowcount={rows}
        data-part="grid"
        onBlur={(event) => {
          if (!disabled && !event.currentTarget.contains(event.relatedTarget)) {
            onActiveCellChange(undefined);
          }
        }}
        onMouseLeave={() => {
          if (!disabled) onActiveCellChange(undefined);
        }}
        role="grid"
      >
        {gridRows.map((rowCells, rowIndex) => (
          <div
            aria-rowindex={rowIndex + 1}
            data-part="row"
            key={rowIndex}
            role="row"
          >
            {rowCells.map(({ cell, index }) => {
              const active = !disabled && cell.id === activeCellId;
              return (
                <button
                  aria-colindex={Math.floor(index / rows) + 1}
                  aria-describedby={active ? tooltipId : undefined}
                  aria-disabled={disabled || undefined}
                  aria-label={cell.label}
                  data-level={cell.level}
                  data-part="cell"
                  data-period-active={
                    activePeriod !== undefined &&
                    cell.periodKey === activePeriod
                      ? "true"
                      : undefined
                  }
                  disabled={disabled}
                  key={cell.id}
                  onFocus={() => {
                    if (!disabled) onActiveCellChange(cell.id);
                  }}
                  onKeyDown={(event) => move(event, index)}
                  onMouseEnter={() => {
                    if (!disabled) onActiveCellChange(cell.id);
                  }}
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  role="gridcell"
                  tabIndex={!disabled && index === activeIndex ? 0 : -1}
                  type="button"
                >
                  {active ? (
                    <span
                      data-align={cell.tooltipAlign ?? "start"}
                      data-part="tooltip"
                      id={tooltipId}
                      role="tooltip"
                    >
                      {cell.label}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div aria-hidden="true" data-part="column-labels">
        {columnLabels.map((columnLabel) => (
          <span
            data-part="column-label"
            key={columnLabel.id}
            style={{ gridColumnStart: columnLabel.column }}
          >
            {columnLabel.label}
          </span>
        ))}
      </div>
    </div>
  );
}
