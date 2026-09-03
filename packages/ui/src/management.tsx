import { useId, type HTMLAttributes, type ReactNode } from "react";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

export const MANAGEMENT_ACCESSIBLE_NAME_ERROR =
  "Artemis management surfaces require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(MANAGEMENT_ACCESSIBLE_NAME_ERROR);
  }
}

export const MANAGEMENT_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const MANAGEMENT_COMPONENT_MUTABLE_TOKENS =
  /* @__PURE__ */ Object.freeze([
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
    "--artemis-color-status-info",
    "--artemis-color-status-info-subtle",
    "--artemis-color-status-warning",
    "--artemis-color-status-warning-subtle",
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
    "--artemis-radius-panel",
    "--artemis-typography-body-family",
    "--artemis-typography-code-family",
    "--artemis-typography-body-size",
    "--artemis-typography-label-size",
    "--artemis-typography-metadata-size",
    "--artemis-motion-duration-fast",
    "--artemis-motion-easing-standard",
    "--artemis-shadow-overlay",
    "--artemis-opacity-disabled",
  ] as const);

export type ManagementState =
  "ready" | "loading" | "empty" | "error" | "busy" | "disabled";
export type ManagementTone = "neutral" | "info" | "warning" | "danger";

export interface ManagementComponentContract {
  readonly schemaVersion: typeof MANAGEMENT_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "settings-surface"
    | "resource-surface"
    | "management-header"
    | "management-section"
    | "management-card"
    | "management-row"
    | "mcp-editor-surface";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly ManagementState[];
  readonly tones?: readonly ManagementTone[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: typeof MANAGEMENT_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const MANAGEMENT_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "disable-transitions",
  mutableTokens: MANAGEMENT_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-landmark-names",
    "focus-indicator-visible",
    "status-and-danger-meaning-is-not-color-only",
    "native-disabled-semantics",
    "caller-owns-provider-credential-connector-and-mcp-effects",
    "caller-owns-sandbox-network-and-full-access-policy",
    "credentials-never-become-presentational-props",
    "long-labels-and-content-do-not-expand-layout",
  ],
} as const;

export const MANAGEMENT_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  settingsSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "settings-surface",
    parts: ["root", "header", "body", "navigation", "content"],
    states: ["ready", "loading", "error", "busy"],
    accessibility: ["named-settings-region", "busy-state-exposed"],
    interaction: ["caller-owned-tab-selection-settings-and-persistence"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  resourceSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "resource-surface",
    parts: ["root", "content"],
    optionalParts: ["header", "toolbar"],
    states: ["ready", "loading", "empty", "error", "busy"],
    accessibility: ["named-resource-region", "busy-state-exposed"],
    interaction: ["caller-owned-catalog-install-remove-and-enable-actions"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  managementHeader: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "management-header",
    parts: ["root", "copy", "title"],
    optionalParts: ["leading", "description", "actions"],
    states: ["ready"],
    accessibility: ["visible-heading"],
    interaction: ["caller-owned-leading-and-actions"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  managementSection: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "management-section",
    parts: ["root", "header", "title", "content"],
    optionalParts: ["description", "actions"],
    states: ["ready", "loading", "empty", "error", "busy", "disabled"],
    tones: ["neutral", "info", "warning", "danger"],
    accessibility: ["section-labelled-by-visible-heading"],
    interaction: ["caller-owned-fields-actions-and-effects"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  managementCard: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "management-card",
    parts: ["root", "content"],
    states: ["ready", "loading", "error", "busy", "disabled"],
    tones: ["neutral", "info", "warning", "danger"],
    accessibility: ["caller-owned-card-content-semantics"],
    interaction: ["caller-owned-fields-actions-and-effects"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  managementRow: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "management-row",
    parts: ["root", "copy", "title"],
    optionalParts: ["leading", "description", "actions"],
    states: ["ready", "loading", "error", "busy", "disabled"],
    tones: ["neutral", "info", "warning", "danger"],
    accessibility: ["visible-row-title", "status-not-color-only"],
    interaction: ["caller-owned-row-actions"],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
  mcpEditorSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "mcp-editor-surface",
    parts: ["root", "header", "content", "actions"],
    optionalParts: ["feedback"],
    states: ["ready", "error", "busy", "disabled"],
    accessibility: ["named-editor-region", "busy-state-exposed"],
    interaction: [
      "caller-owned-save-test-remove-confirmation-and-permission-effects",
    ],
    theme: MANAGEMENT_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, ManagementComponentContract>>);

export interface ManagementComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateManagementComponentContracts(
  candidate: unknown,
): ManagementComponentContractValidationResult {
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
  compare(candidate, MANAGEMENT_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

interface SurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly busy?: boolean | undefined;
  readonly children: ReactNode;
  readonly label: string;
  readonly state?: ManagementState | undefined;
}

export interface SettingsSurfaceProps extends SurfaceProps {
  readonly header: ReactNode;
  readonly navigation: ReactNode;
}

export function SettingsSurface({
  busy,
  children,
  header,
  label,
  navigation,
  state = busy ? "busy" : "ready",
  ...attributes
}: SettingsSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      data-artemis-component="settings-surface"
      data-part="root"
      data-state={state}
      role="region"
    >
      <div data-part="header">{header}</div>
      <div data-part="body">
        <div data-part="navigation">{navigation}</div>
        <div data-part="content">{children}</div>
      </div>
    </section>
  );
}

export interface ResourceSurfaceProps extends SurfaceProps {
  readonly header?: ReactNode | undefined;
  readonly toolbar?: ReactNode | undefined;
}

export function ResourceSurface({
  busy,
  children,
  header,
  label,
  state = busy ? "busy" : "ready",
  toolbar,
  ...attributes
}: ResourceSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      data-artemis-component="resource-surface"
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

export interface ManagementHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  readonly leading?: ReactNode | undefined;
  readonly title: ReactNode;
}

export function ManagementHeader({
  actions,
  description,
  headingLevel = 1,
  leading,
  title,
  ...attributes
}: ManagementHeaderProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <header
      {...attributes}
      data-artemis-component="management-header"
      data-part="root"
      data-state="ready"
    >
      {leading ? <div data-part="leading">{leading}</div> : null}
      <div data-part="copy">
        <Heading data-part="title">{title}</Heading>
        {description ? <div data-part="description">{description}</div> : null}
      </div>
      {actions ? <div data-part="actions">{actions}</div> : null}
    </header>
  );
}

export interface ManagementSectionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6 | undefined;
  readonly labelledBy?: string | undefined;
  readonly state?: ManagementState | undefined;
  readonly title: ReactNode;
  readonly tone?: ManagementTone | undefined;
}

export function ManagementSection({
  actions,
  children,
  description,
  headingLevel = 2,
  labelledBy,
  state = "ready",
  title,
  tone = "neutral",
  ...attributes
}: ManagementSectionProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <section
      {...attributes}
      aria-labelledby={labelledBy ?? titleId}
      data-artemis-component="management-section"
      data-part="root"
      data-state={state}
      data-tone={tone}
    >
      <header data-part="header">
        <div>
          <Heading data-part="title" id={titleId}>
            {title}
          </Heading>
          {description ? (
            <div data-part="description">{description}</div>
          ) : null}
        </div>
        {actions ? <div data-part="actions">{actions}</div> : null}
      </header>
      <div data-part="content">{children}</div>
    </section>
  );
}

export interface ManagementCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly state?: ManagementState | undefined;
  readonly tone?: ManagementTone | undefined;
}

export function ManagementCard({
  children,
  state = "ready",
  tone = "neutral",
  ...attributes
}: ManagementCardProps) {
  return (
    <article
      {...attributes}
      data-artemis-component="management-card"
      data-part="root"
      data-state={state}
      data-tone={tone}
    >
      <div data-part="content">{children}</div>
    </article>
  );
}

export interface ManagementRowProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  readonly actions?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly leading?: ReactNode | undefined;
  readonly state?: ManagementState | undefined;
  readonly title: ReactNode;
  readonly tone?: ManagementTone | undefined;
}

export function ManagementRow({
  actions,
  description,
  leading,
  state = "ready",
  title,
  tone = "neutral",
  ...attributes
}: ManagementRowProps) {
  return (
    <article
      {...attributes}
      data-artemis-component="management-row"
      data-part="root"
      data-state={state}
      data-tone={tone}
    >
      {leading ? <div data-part="leading">{leading}</div> : null}
      <div data-part="copy">
        <strong data-part="title">{title}</strong>
        {description ? <div data-part="description">{description}</div> : null}
      </div>
      {actions ? <div data-part="actions">{actions}</div> : null}
    </article>
  );
}

export interface McpEditorSurfaceProps extends SurfaceProps {
  readonly actions: ReactNode;
  readonly feedback?: ReactNode | undefined;
  readonly header: ReactNode;
}

export function McpEditorSurface({
  actions,
  busy,
  children,
  feedback,
  header,
  label,
  state = busy ? "busy" : "ready",
  ...attributes
}: McpEditorSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-busy={busy || undefined}
      aria-label={label}
      data-artemis-component="mcp-editor-surface"
      data-part="root"
      data-state={state}
      role="region"
    >
      <div data-part="header">{header}</div>
      {feedback ? <div data-part="feedback">{feedback}</div> : null}
      <div data-part="content">{children}</div>
      <div data-part="actions">{actions}</div>
    </section>
  );
}
