import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
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

export const SURFACE_ACCESSIBLE_NAME_ERROR =
  "Artemis surfaces require a non-empty accessible label";
export const SURFACE_SIDEBAR_SIZE_ERROR =
  "Artemis ApplicationShell requires a finite non-negative sidebar size";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(SURFACE_ACCESSIBLE_NAME_ERROR);
  }
}

export const SURFACE_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const SURFACE_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-canvas",
  "--artemis-color-background-sidebar",
  "--artemis-color-background-activity",
  "--artemis-color-surface-composer",
  "--artemis-color-interaction-hover",
  "--artemis-color-interaction-selected",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-text-tertiary",
  "--artemis-color-border-default",
  "--artemis-color-border-subtle",
  "--artemis-color-accent-primary",
  "--artemis-color-accent-subtle",
  "--artemis-color-accent-text",
  "--artemis-space-1",
  "--artemis-space-2",
  "--artemis-space-3",
  "--artemis-space-4",
  "--artemis-size-control-compact",
  "--artemis-border-width-default",
  "--artemis-radius-control",
  "--artemis-radius-composer",
  "--artemis-typography-body-family",
  "--artemis-typography-body-size",
  "--artemis-motion-duration-fast",
  "--artemis-motion-duration-normal",
  "--artemis-motion-easing-standard",
  "--artemis-motion-easing-shell",
  "--artemis-shadow-composer",
] as const);

export type SurfaceState = "ready" | "selected" | "collapsed";

export interface SurfaceComponentContract {
  readonly schemaVersion: typeof SURFACE_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "application-shell"
    | "application-shell-resizer"
    | "activity-bar"
    | "activity-bar-item"
    | "navigation-sidebar"
    | "composer-surface";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly SurfaceState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof SURFACE_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const SURFACE_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: SURFACE_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "landmarks-have-perceptible-names",
    "focus-indicator-visible",
    "collapsed-sidebar-is-removed-from-interaction",
    "activity-selection-is-not-color-only",
    "composer-content-may-shrink-without-clipping",
    "skin-cannot-change-anatomy-or-interaction",
  ],
} as const;

export const SURFACE_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  applicationShell: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "application-shell",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["single-main-landmark", "document-direction-inherited"],
    interaction: ["caller-owned-sidebar-state-and-size"],
    theme: SURFACE_THEME_CONTRACT,
  },
  applicationShellResizer: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "application-shell-resizer",
    parts: ["root"],
    states: ["ready", "collapsed"],
    accessibility: [
      "required-perceptible-label",
      "vertical-separator-role",
      "collapsed-state-is-aria-hidden",
    ],
    interaction: ["caller-owned-pointer-and-keyboard-resize"],
    theme: SURFACE_THEME_CONTRACT,
  },
  activityBar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "activity-bar",
    parts: ["root", "brand", "items", "footer"],
    states: ["ready"],
    accessibility: ["named-navigation-landmark"],
    interaction: ["native-child-tab-order", "caller-owned-navigation"],
    theme: SURFACE_THEME_CONTRACT,
  },
  activityBarItem: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "activity-bar-item",
    parts: ["root", "icon"],
    states: ["ready", "selected"],
    accessibility: [
      "required-perceptible-label",
      "decorative-icon-hidden",
      "selected-marker-not-color-only",
    ],
    interaction: ["native-button-activation", "caller-owned-selection"],
    theme: SURFACE_THEME_CONTRACT,
  },
  navigationSidebar: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "navigation-sidebar",
    parts: ["root", "header", "content", "footer"],
    states: ["ready", "collapsed"],
    accessibility: [
      "named-complementary-landmark",
      "collapsed-state-is-aria-hidden",
    ],
    interaction: ["caller-owned-content-and-collapse"],
    theme: SURFACE_THEME_CONTRACT,
  },
  composerSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "composer-surface",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["named-region"],
    interaction: ["caller-owned-input-actions-and-drop-target"],
    theme: SURFACE_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, SurfaceComponentContract>>);

export interface SurfaceComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateSurfaceComponentContracts(
  candidate: unknown,
): SurfaceComponentContractValidationResult {
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
  compare(candidate, SURFACE_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

interface ApplicationShellStyle extends CSSProperties {
  readonly "--_artemis-application-shell-sidebar-size": string;
}

export interface ApplicationShellProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly sidebarOpen: boolean;
  readonly sidebarSize: number;
}

export function ApplicationShell({
  children,
  sidebarOpen,
  sidebarSize,
  style,
  ...attributes
}: ApplicationShellProps) {
  if (!Number.isFinite(sidebarSize) || sidebarSize < 0) {
    throw new Error(SURFACE_SIDEBAR_SIZE_ERROR);
  }
  const shellStyle: ApplicationShellStyle = {
    ...style,
    "--_artemis-application-shell-sidebar-size": `${Math.round(
      sidebarOpen ? sidebarSize : 0,
    )}px`,
  };
  return (
    <main
      {...attributes}
      data-artemis-component="application-shell"
      data-part="root"
      data-sidebar-open={sidebarOpen}
      data-state="ready"
      style={shellStyle}
    >
      {children}
    </main>
  );
}

export interface ApplicationShellResizerProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly label: string;
  readonly open: boolean;
}

export const ApplicationShellResizer = /* @__PURE__ */ forwardRef<
  HTMLDivElement,
  ApplicationShellResizerProps
>(function ApplicationShellResizer(
  { label, open, tabIndex = open ? 0 : -1, ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-hidden={!open}
      aria-label={label}
      aria-orientation="vertical"
      data-artemis-component="application-shell-resizer"
      data-part="root"
      data-state={open ? "ready" : "collapsed"}
      ref={ref}
      role="separator"
      tabIndex={tabIndex}
    />
  );
});

export interface ActivityBarProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly brand: ReactNode;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly label: string;
}

export function ActivityBar({
  brand,
  children,
  footer,
  label,
  ...attributes
}: ActivityBarProps) {
  requirePerceptibleText(label);
  return (
    <nav
      {...attributes}
      aria-label={label}
      data-artemis-component="activity-bar"
      data-part="root"
      data-state="ready"
    >
      <div data-part="brand">{brand}</div>
      <div data-part="items">{children}</div>
      <div data-part="footer">{footer}</div>
    </nav>
  );
}

export interface ActivityBarItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly selected?: boolean | undefined;
  readonly type?: "button" | "submit" | "reset" | undefined;
}

export const ActivityBarItem = /* @__PURE__ */ forwardRef<
  HTMLButtonElement,
  ActivityBarItemProps
>(function ActivityBarItem(
  { icon, label, selected, type = "button", ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <button
      {...attributes}
      aria-label={label}
      data-artemis-component="activity-bar-item"
      data-part="root"
      data-state={selected ? "selected" : "ready"}
      ref={ref}
      type={type}
    >
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
    </button>
  );
});

export interface NavigationSidebarProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly header: ReactNode;
  readonly label: string;
  readonly open: boolean;
}

export const NavigationSidebar = /* @__PURE__ */ forwardRef<
  HTMLElement,
  NavigationSidebarProps
>(function NavigationSidebar(
  { children, footer, header, label, open, ...attributes },
  ref,
) {
  requirePerceptibleText(label);
  return (
    <aside
      {...attributes}
      aria-hidden={!open}
      aria-label={label}
      data-artemis-component="navigation-sidebar"
      data-part="root"
      data-state={open ? "ready" : "collapsed"}
      ref={ref}
    >
      <div data-part="header">{header}</div>
      <div data-part="content">{children}</div>
      <div data-part="footer">{footer}</div>
    </aside>
  );
});

export interface ComposerSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export function ComposerSurface({
  children,
  label,
  ...attributes
}: ComposerSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="composer-surface"
      data-part="root"
      data-state="ready"
    >
      {children}
    </section>
  );
}
