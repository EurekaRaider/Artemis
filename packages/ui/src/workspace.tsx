import {
  forwardRef,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  type UIEvent,
} from "react";

import { SegmentedControl } from "./navigation.js";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

export const WORKSPACE_ACCESSIBLE_NAME_ERROR =
  "Artemis workspace components require a non-empty accessible label";
export const WORKSPACE_GEOMETRY_ERROR =
  "Artemis workspace geometry requires finite ordered pixel bounds";
export const WORKSPACE_TREE_DEPTH_ERROR =
  "Artemis workspace tree depth requires a non-negative integer";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(WORKSPACE_ACCESSIBLE_NAME_ERROR);
  }
}

function requireGeometry(minimum: number, maximum: number, current: number) {
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(current) ||
    minimum > maximum ||
    current < minimum ||
    current > maximum
  ) {
    throw new Error(WORKSPACE_GEOMETRY_ERROR);
  }
}

export const WORKSPACE_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const WORKSPACE_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze(
  [
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
    "--artemis-color-accent-on-primary",
    "--artemis-color-status-warning",
    "--artemis-color-status-danger",
    "--artemis-color-status-danger-subtle",
    "--artemis-space-1",
    "--artemis-space-2",
    "--artemis-space-3",
    "--artemis-space-4",
    "--artemis-space-5",
    "--artemis-space-6",
    "--artemis-size-control-compact",
    "--artemis-size-control-comfortable",
    "--artemis-border-width-default",
    "--artemis-radius-control",
    "--artemis-radius-card",
    "--artemis-typography-body-family",
    "--artemis-typography-code-family",
    "--artemis-typography-body-size",
    "--artemis-typography-label-size",
    "--artemis-typography-metadata-size",
    "--artemis-motion-duration-fast",
    "--artemis-motion-duration-normal",
    "--artemis-motion-easing-standard",
    "--artemis-motion-easing-shell",
    "--artemis-opacity-disabled",
  ] as const,
);

export type WorkspaceComponentState =
  | "ready"
  | "active"
  | "open"
  | "closed"
  | "resizing"
  | "empty"
  | "loading"
  | "error"
  | "read-only"
  | "dirty"
  | "saving"
  | "saved"
  | "disabled"
  | "directory"
  | "selected";

export interface WorkspaceComponentContract {
  readonly schemaVersion: typeof WORKSPACE_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "workspace-dock"
    | "workspace-dock-resizer"
    | "workspace-tab-bar"
    | "workspace-tab"
    | "workspace-tab-pane"
    | "workspace-launcher"
    | "workspace-editor-toolbar"
    | "workspace-file-header"
    | "workspace-file-layout"
    | "workspace-file-tree"
    | "workspace-file-tree-row"
    | "workspace-source-editor"
    | "workspace-preview"
    | "workspace-content-state";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly WorkspaceComponentState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof WORKSPACE_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const WORKSPACE_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: WORKSPACE_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-landmark-and-control-names",
    "tab-and-panel-id-relations",
    "separate-tab-selection-and-close-controls",
    "native-disabled-semantics",
    "separator-values-use-pixels",
    "caller-owns-size-clamp-and-persistence",
    "caller-owns-file-data-permissions-and-save-effects",
    "dirty-and-error-state-is-not-color-only",
    "long-paths-and-content-do-not-expand-layout",
  ],
} as const;

export const WORKSPACE_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  dock: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-dock",
    parts: ["root", "content"],
    states: ["open", "closed", "resizing"],
    accessibility: ["named-complementary-region", "closed-region-hidden"],
    interaction: ["caller-owned-open-resizing-state-and-width"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  dockResizer: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-dock-resizer",
    parts: ["root"],
    states: ["open", "closed"],
    accessibility: [
      "named-vertical-separator",
      "pixel-min-max-now-and-text",
      "controls-conversation-and-dock",
    ],
    interaction: [
      "caller-owned-pointer-drag",
      "caller-owned-arrow-home-end-and-persistence",
      "closed-separator-removed-from-tab-order",
    ],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  tabBar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-tab-bar",
    parts: ["root", "scroll", "track"],
    optionalParts: ["scroll-start", "scroll-end", "add"],
    states: ["ready"],
    accessibility: ["named-tablist"],
    interaction: ["caller-owned-roving-tabindex-and-overflow"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  tab: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-tab",
    parts: ["root", "select", "label", "close"],
    optionalParts: ["icon"],
    states: ["ready", "active"],
    accessibility: [
      "tab-selected-and-controls-relation",
      "close-is-a-sibling-native-button",
    ],
    interaction: [
      "caller-owned-selection",
      "caller-owned-close-focus-transfer",
    ],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  tabPane: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-tab-pane",
    parts: ["root"],
    states: ["ready", "active"],
    accessibility: ["tabpanel-labelled-by-tab", "inactive-panel-hidden"],
    interaction: ["caller-owned-active-panel"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  launcher: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-launcher",
    parts: ["root", "actions"],
    optionalParts: ["action", "icon", "shortcut"],
    states: ["empty", "disabled"],
    accessibility: ["named-empty-region", "native-disabled-actions"],
    interaction: ["caller-owned-launch-actions"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  editorToolbar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-editor-toolbar",
    parts: ["root", "path", "actions", "status", "save", "content"],
    optionalParts: ["mode", "error", "error-detail"],
    states: ["ready", "dirty", "saving", "saved", "error", "read-only"],
    accessibility: [
      "visible-path",
      "polite-save-status",
      "assertive-save-error",
      "native-disabled-save",
    ],
    interaction: [
      "caller-owned-save-effect",
      "single-meta-or-control-s-save",
      "ime-composition-does-not-save",
      "caller-owned-source-preview-mode",
    ],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  fileHeader: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-file-header",
    parts: ["root", "path"],
    optionalParts: ["actions"],
    states: ["ready", "read-only"],
    accessibility: ["visible-full-path"],
    interaction: ["caller-owned-actions"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  fileLayout: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-file-layout",
    parts: ["root", "body", "viewer", "tree"],
    states: ["ready"],
    accessibility: ["named-file-workspace"],
    interaction: ["caller-owned-file-state-and-selection"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  fileTree: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-file-tree",
    parts: ["root", "toolbar", "filter", "refresh", "items"],
    states: ["ready", "loading"],
    accessibility: ["named-navigation", "named-filter-and-refresh"],
    interaction: ["caller-owned-filter-refresh-and-directory-loading"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  fileTreeRow: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-file-tree-row",
    parts: ["root", "indicator", "icon", "label"],
    states: ["ready", "directory", "selected", "loading", "disabled"],
    accessibility: ["treeitem-level-expanded-selected-and-disabled-state"],
    interaction: ["native-button-activation", "caller-owned-tree-state"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  sourceEditor: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-source-editor",
    parts: ["root", "source"],
    optionalParts: ["highlight"],
    states: ["ready", "read-only", "disabled"],
    accessibility: ["named-native-textarea", "decorative-highlight-hidden"],
    interaction: ["caller-owned-content-change-scroll-and-ime"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  preview: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-preview",
    parts: ["root", "content"],
    states: ["ready", "read-only", "disabled"],
    accessibility: ["named-preview-region"],
    interaction: ["caller-owned-rendered-content-links-and-images"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
  contentState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "workspace-content-state",
    parts: ["root"],
    states: ["empty", "loading", "error", "read-only"],
    accessibility: ["status-or-alert-matches-state"],
    interaction: ["caller-owned-retry-or-recovery-actions"],
    theme: WORKSPACE_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, WorkspaceComponentContract>>);

export interface WorkspaceComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateWorkspaceComponentContracts(
  candidate: unknown,
): WorkspaceComponentContractValidationResult {
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
  compare(candidate, WORKSPACE_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface WorkspaceDockProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly open: boolean;
  readonly resizing?: boolean | undefined;
}

export const WorkspaceDock = /* @__PURE__ */ forwardRef<
  HTMLElement,
  WorkspaceDockProps
>(function WorkspaceDock(
  { children, label, open, resizing, ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <aside
      {...attributes}
      aria-hidden={!open}
      aria-label={label}
      data-artemis-component="workspace-dock"
      data-part="root"
      data-state={!open ? "closed" : resizing ? "resizing" : "open"}
      inert={open ? undefined : true}
      ref={ref}
    >
      <div data-part="content">{children}</div>
    </aside>
  );
});

export interface WorkspaceDockResizerProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly controls: string;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly open: boolean;
  readonly value: number;
  readonly valueText: string;
}

export function WorkspaceDockResizer({
  controls,
  label,
  maximum,
  minimum,
  open,
  value,
  valueText,
  ...attributes
}: WorkspaceDockResizerProps) {
  requirePerceptibleText(label);
  requirePerceptibleText(controls);
  requirePerceptibleText(valueText);
  requireGeometry(minimum, maximum, value);
  return (
    <div
      {...attributes}
      aria-controls={controls}
      aria-hidden={!open}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={value}
      aria-valuetext={valueText}
      data-artemis-component="workspace-dock-resizer"
      data-part="root"
      data-state={open ? "open" : "closed"}
      role="separator"
      tabIndex={open ? 0 : -1}
    />
  );
}

export interface WorkspaceTabBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly add?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly overflow?: boolean | undefined;
  readonly scrollEnd?: ReactNode | undefined;
  readonly scrollProps?: HTMLAttributes<HTMLDivElement> | undefined;
  readonly scrollStart?: ReactNode | undefined;
  readonly scrollRef?: Ref<HTMLDivElement> | undefined;
  readonly trackRef?: Ref<HTMLDivElement> | undefined;
}

export function WorkspaceTabBar({
  add,
  children,
  label,
  overflow,
  scrollEnd,
  scrollProps,
  scrollRef,
  scrollStart,
  trackRef,
  ...attributes
}: WorkspaceTabBarProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="workspace-tab-bar"
      data-part="root"
      data-state="ready"
      role="tablist"
    >
      <div data-overflow={Boolean(overflow)} data-part="scroll-shell">
        {scrollStart ? (
          <span data-part="scroll-start">{scrollStart}</span>
        ) : null}
        <div {...scrollProps} data-part="scroll" ref={scrollRef}>
          <div data-part="track" ref={trackRef}>
            {children}
          </div>
        </div>
        {scrollEnd ? <span data-part="scroll-end">{scrollEnd}</span> : null}
      </div>
      {add ? <div data-part="add">{add}</div> : null}
    </div>
  );
}

export interface WorkspaceTabProps {
  readonly active: boolean;
  readonly closeLabel: string;
  readonly closeIcon: ReactNode;
  readonly closeTitle?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly id: string;
  readonly label: string;
  readonly onClose: () => void;
  readonly onSelect: () => void;
  readonly panelId: string;
  readonly rootRef?: Ref<HTMLDivElement> | undefined;
  readonly selectRef?: Ref<HTMLButtonElement> | undefined;
  readonly tabIndex: 0 | -1;
  readonly title?: string | undefined;
}

export function WorkspaceTab({
  active,
  closeLabel,
  closeIcon,
  closeTitle,
  icon,
  id,
  label,
  onClose,
  onSelect,
  panelId,
  rootRef,
  selectRef,
  tabIndex,
  title,
}: WorkspaceTabProps) {
  requirePerceptibleText(closeLabel);
  requirePerceptibleText(label);
  requirePerceptibleText(id);
  requirePerceptibleText(panelId);
  return (
    <div
      data-artemis-component="workspace-tab"
      data-part="root"
      data-state={active ? "active" : "ready"}
      ref={rootRef}
    >
      <button
        aria-controls={panelId}
        aria-selected={active}
        data-part="select"
        id={id}
        onClick={onSelect}
        ref={selectRef}
        role="tab"
        tabIndex={tabIndex}
        title={title ?? label}
        type="button"
      >
        {icon ? (
          <span aria-hidden="true" data-part="icon">
            {icon}
          </span>
        ) : null}
        <span data-part="label">{label}</span>
      </button>
      <button
        aria-label={closeLabel}
        data-part="close"
        onClick={onClose}
        title={closeTitle ?? closeLabel}
        type="button"
      >
        <span aria-hidden="true">{closeIcon}</span>
      </button>
    </div>
  );
}

export interface WorkspaceTabPaneProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly labelledBy: string;
}

export function WorkspaceTabPane({
  active,
  children,
  labelledBy,
  ...attributes
}: WorkspaceTabPaneProps) {
  requirePerceptibleText(labelledBy);
  return (
    <div
      {...attributes}
      aria-labelledby={labelledBy}
      data-artemis-component="workspace-tab-pane"
      data-part="root"
      data-state={active ? "active" : "ready"}
      hidden={!active}
      role="tabpanel"
    >
      {children}
    </div>
  );
}

export interface WorkspaceLauncherProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function WorkspaceLauncher({
  children,
  label,
  ...attributes
}: WorkspaceLauncherProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="workspace-launcher"
      data-part="root"
      data-state="empty"
      role="region"
    >
      <div data-part="actions">{children}</div>
    </div>
  );
}

export interface WorkspaceLauncherActionProps {
  readonly disabled?: boolean | undefined;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onActivate: () => void;
  readonly shortcut?: ReactNode | undefined;
}

export function WorkspaceLauncherAction({
  disabled,
  icon,
  label,
  onActivate,
  shortcut,
}: WorkspaceLauncherActionProps) {
  requirePerceptibleText(label);
  return (
    <button
      data-part="action"
      data-state={disabled ? "disabled" : "ready"}
      disabled={disabled}
      onClick={onActivate}
      type="button"
    >
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
      <span>{label}</span>
      {shortcut ? <kbd data-part="shortcut">{shortcut}</kbd> : null}
    </button>
  );
}

export type WorkspaceEditorSaveState = "idle" | "saving" | "saved";
export type WorkspaceEditorView = "rich" | "source";

export interface WorkspaceEditorModeToggle {
  readonly ariaLabel: string;
  readonly onChange: (view: WorkspaceEditorView) => void;
  readonly richLabel: string;
  readonly sourceLabel: string;
  readonly value: WorkspaceEditorView;
}

export interface WorkspaceEditorToolbarProps {
  readonly children?: ReactNode | undefined;
  readonly dirty: boolean;
  readonly modeToggle?: WorkspaceEditorModeToggle | undefined;
  readonly path: string;
  readonly readOnly: boolean;
  readonly saveError?: string | undefined;
  readonly saveErrorDetail?: string | undefined;
  readonly saveLabel: string;
  readonly savedLabel: string;
  readonly saveState: WorkspaceEditorSaveState;
  readonly savingLabel: string;
  readonly unsavedLabel: string;
  readonly tools?: ReactNode | undefined;
  readonly onSave: () => void;
}

function editorState(
  readOnly: boolean,
  saveError: string | undefined,
  saveState: WorkspaceEditorSaveState,
  dirty: boolean,
): "read-only" | "error" | "saving" | "dirty" | "saved" | "ready" {
  if (readOnly) return "read-only";
  if (saveError) return "error";
  if (saveState === "saving") return "saving";
  if (dirty) return "dirty";
  if (saveState === "saved") return "saved";
  return "ready";
}

export function WorkspaceEditorToolbar({
  children,
  dirty,
  modeToggle,
  path,
  readOnly,
  saveError,
  saveErrorDetail,
  saveLabel,
  savedLabel,
  saveState,
  savingLabel,
  unsavedLabel,
  tools,
  onSave,
}: WorkspaceEditorToolbarProps) {
  requirePerceptibleText(path);
  requirePerceptibleText(saveLabel);
  const canSave = dirty && saveState !== "saving" && !readOnly;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    if (canSave) onSave();
  };
  return (
    <div
      data-artemis-component="workspace-editor-toolbar"
      data-part="root"
      data-state={editorState(readOnly, saveError, saveState, dirty)}
      onKeyDown={handleKeyDown}
    >
      <div data-part="path">
        <span title={path}>{path}</span>
        <span data-part="actions">
          {modeToggle ? (
            <span data-part="mode">
              <SegmentedControl
                disabled={readOnly}
                label={modeToggle.ariaLabel}
                onValueChange={modeToggle.onChange}
                options={[
                  { value: "rich", label: modeToggle.richLabel },
                  { value: "source", label: modeToggle.sourceLabel },
                ]}
                size="compact"
                value={modeToggle.value}
              />
            </span>
          ) : null}
          {tools}
          <span aria-live="polite" data-part="status" role="status">
            {saveState === "saving"
              ? savingLabel
              : dirty
                ? unsavedLabel
                : saveState === "saved"
                  ? savedLabel
                  : ""}
          </span>
          <button
            data-part="save"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            {saveLabel}
          </button>
        </span>
      </div>
      {saveError ? (
        <div data-part="error" role="alert">
          {saveError}
          {saveErrorDetail ? (
            <small data-part="error-detail">{saveErrorDetail}</small>
          ) : null}
        </div>
      ) : null}
      <div data-part="content">{children}</div>
    </div>
  );
}

export interface WorkspaceFileLayoutProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly label: string;
  readonly tree: ReactNode;
  readonly viewer: ReactNode;
}

export interface WorkspaceFileHeaderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly actions?: ReactNode | undefined;
  readonly path: string;
  readonly readOnly?: boolean | undefined;
}

export function WorkspaceFileHeader({
  actions,
  path,
  readOnly,
  ...attributes
}: WorkspaceFileHeaderProps) {
  requirePerceptibleText(path);
  return (
    <div
      {...attributes}
      data-artemis-component="workspace-file-header"
      data-part="root"
      data-state={readOnly ? "read-only" : "ready"}
    >
      <span data-part="path" title={path}>
        {path}
      </span>
      {actions ? <span data-part="actions">{actions}</span> : null}
    </div>
  );
}

export function WorkspaceFileLayout({
  label,
  tree,
  viewer,
  ...attributes
}: WorkspaceFileLayoutProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="workspace-file-layout"
      data-part="root"
      data-state="ready"
    >
      <div data-part="body">
        <div data-part="viewer">{viewer}</div>
        <div data-part="tree">{tree}</div>
      </div>
    </section>
  );
}

export interface WorkspaceFileTreeProps {
  readonly children: ReactNode;
  readonly filterLabel: string;
  readonly filterPlaceholder: string;
  readonly filterValue: string;
  readonly label: string;
  readonly loading?: boolean | undefined;
  readonly refreshLabel: string;
  readonly refreshIcon: ReactNode;
  readonly onFilterChange: (value: string) => void;
  readonly onRefresh: () => void;
}

export function WorkspaceFileTree({
  children,
  filterLabel,
  filterPlaceholder,
  filterValue,
  label,
  loading,
  refreshLabel,
  refreshIcon,
  onFilterChange,
  onRefresh,
}: WorkspaceFileTreeProps) {
  for (const value of [filterLabel, label, refreshLabel]) {
    requirePerceptibleText(value);
  }
  return (
    <nav
      aria-busy={loading || undefined}
      aria-label={label}
      data-artemis-component="workspace-file-tree"
      data-part="root"
      data-state={loading ? "loading" : "ready"}
    >
      <div data-part="toolbar">
        <input
          aria-label={filterLabel}
          data-part="filter"
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={filterPlaceholder}
          type="search"
          value={filterValue}
        />
        <button
          aria-label={refreshLabel}
          data-part="refresh"
          onClick={onRefresh}
          title={refreshLabel}
          type="button"
        >
          <span aria-hidden="true">{refreshIcon}</span>
        </button>
      </div>
      <div data-part="items" role="tree">
        {children}
      </div>
    </nav>
  );
}

export interface WorkspaceFileTreeRowProps {
  readonly depth: number;
  readonly directory?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly indicator?: ReactNode | undefined;
  readonly label: string;
  readonly loading?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly title?: string | undefined;
  readonly onActivate: () => void;
}

export function WorkspaceFileTreeRow({
  depth,
  directory,
  disabled,
  expanded,
  icon,
  indicator,
  label,
  loading,
  selected,
  title,
  onActivate,
}: WorkspaceFileTreeRowProps) {
  requirePerceptibleText(label);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(WORKSPACE_TREE_DEPTH_ERROR);
  }
  const state = disabled
    ? "disabled"
    : loading
      ? "loading"
      : selected
        ? "selected"
        : directory
          ? "directory"
          : "ready";
  return (
    <button
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      aria-expanded={directory ? Boolean(expanded) : undefined}
      aria-level={depth + 1}
      aria-selected={Boolean(selected)}
      data-artemis-component="workspace-file-tree-row"
      data-part="root"
      data-state={state}
      disabled={disabled}
      onClick={onActivate}
      role="treeitem"
      style={{ "--_artemis-workspace-tree-depth": depth } as CSSProperties}
      title={title ?? label}
      type="button"
    >
      <span aria-hidden="true" data-part="indicator">
        {indicator}
      </span>
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
      <span data-part="label">{label}</span>
    </button>
  );
}

export interface WorkspaceSourceEditorProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "aria-label" | "children" | "className"
> {
  readonly highlight?: ReactNode | undefined;
  readonly label: string;
  readonly language: string;
  readonly variant?: "code" | "markdown" | undefined;
}

export const WorkspaceSourceEditor = /* @__PURE__ */ forwardRef<
  HTMLTextAreaElement,
  WorkspaceSourceEditorProps
>(function WorkspaceSourceEditor(
  {
    highlight,
    label,
    language,
    onScroll,
    disabled,
    readOnly,
    variant = "code",
    ...attributes
  },
  ref,
) {
  requirePerceptibleText(label);
  requirePerceptibleText(language);
  const highlightRef = useRef<HTMLPreElement>(null);
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    }
    onScroll?.(event);
  };
  return (
    <div
      data-artemis-component="workspace-source-editor"
      data-language={language}
      data-part="root"
      data-state={disabled ? "disabled" : readOnly ? "read-only" : "ready"}
      data-variant={variant}
    >
      {highlight ? (
        <pre aria-hidden="true" data-part="highlight" ref={highlightRef}>
          <code>{highlight}</code>
        </pre>
      ) : null}
      <textarea
        {...attributes}
        aria-label={label}
        data-part="source"
        disabled={disabled}
        onScroll={handleScroll}
        readOnly={readOnly}
        ref={ref}
      />
    </div>
  );
});

export interface WorkspacePreviewProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly readOnly?: boolean | undefined;
}

export function WorkspacePreview({
  children,
  label,
  readOnly,
  ...attributes
}: WorkspacePreviewProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="workspace-preview"
      data-part="root"
      data-state={readOnly ? "read-only" : "ready"}
      role="region"
    >
      <div data-part="content">{children}</div>
    </div>
  );
}

export interface WorkspaceContentStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly state: "empty" | "loading" | "error" | "read-only";
}

export function WorkspaceContentState({
  children,
  label,
  state,
  ...attributes
}: WorkspaceContentStateProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-busy={state === "loading" || undefined}
      aria-label={label}
      data-artemis-component="workspace-content-state"
      data-part="root"
      data-state={state}
      role={state === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
