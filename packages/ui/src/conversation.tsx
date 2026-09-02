import {
  forwardRef,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type LiHTMLAttributes,
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

export const CONVERSATION_ACCESSIBLE_NAME_ERROR =
  "Artemis conversation components require a non-empty accessible label";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(CONVERSATION_ACCESSIBLE_NAME_ERROR);
  }
}

export const CONVERSATION_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const CONVERSATION_COMPONENT_MUTABLE_TOKENS =
  /* @__PURE__ */ Object.freeze([
    "--artemis-color-canvas",
    "--artemis-color-surface-base",
    "--artemis-color-surface-raised",
    "--artemis-color-surface-sunken",
    "--artemis-color-interaction-hover",
    "--artemis-color-text-primary",
    "--artemis-color-text-secondary",
    "--artemis-color-text-tertiary",
    "--artemis-color-border-default",
    "--artemis-color-border-subtle",
    "--artemis-color-accent-primary",
    "--artemis-color-accent-subtle",
    "--artemis-color-accent-text",
    "--artemis-color-status-success",
    "--artemis-color-status-danger",
    "--artemis-color-status-danger-subtle",
    "--artemis-space-1",
    "--artemis-space-2",
    "--artemis-space-3",
    "--artemis-space-4",
    "--artemis-space-5",
    "--artemis-space-6",
    "--artemis-size-control-compact",
    "--artemis-border-width-default",
    "--artemis-radius-control",
    "--artemis-radius-card",
    "--artemis-radius-pill",
    "--artemis-typography-body-family",
    "--artemis-typography-code-family",
    "--artemis-typography-body-size",
    "--artemis-typography-body-line-height",
    "--artemis-typography-label-size",
    "--artemis-typography-metadata-size",
    "--artemis-motion-duration-fast",
    "--artemis-motion-easing-standard",
    "--artemis-opacity-disabled",
    "--artemis-shadow-card",
  ] as const);

export type ConversationComponentState =
  | "ready"
  | "empty"
  | "queued"
  | "busy"
  | "streaming"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "undone";

export interface ConversationComponentContract {
  readonly schemaVersion: typeof CONVERSATION_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "conversation-surface"
    | "timeline-viewport"
    | "timeline"
    | "timeline-turn"
    | "conversation-message"
    | "conversation-empty-state"
    | "turn-execution-disclosure"
    | "turn-change-summary"
    | "queued-message-group"
    | "queued-message-item";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly ConversationComponentState[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-use-logical-geometry";
    readonly reducedMotion: "no-required-motion";
    readonly mutableTokens: typeof CONVERSATION_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const CONVERSATION_THEME_CONTRACT = {
  direction: "inherit-and-use-logical-geometry",
  reducedMotion: "no-required-motion",
  mutableTokens: CONVERSATION_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "required-perceptible-landmark-names",
    "message-author-is-not-color-only",
    "status-is-not-color-only",
    "caller-owns-scroll-state-and-events",
    "caller-owns-content-actions-and-data",
    "long-content-may-wrap-or-scroll-without-clipping",
    "skin-cannot-change-anatomy-interaction-or-mount-identity",
  ],
} as const;

export const CONVERSATION_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  conversationSurface: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "conversation-surface",
    parts: ["root"],
    states: ["ready", "empty"],
    accessibility: ["named-region"],
    interaction: ["caller-owned-active-conversation"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  timelineViewport: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "timeline-viewport",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["named-scroll-region"],
    interaction: ["caller-owned-scroll-anchor-wheel-and-pointer-events"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  timeline: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "timeline",
    parts: ["root"],
    states: ["ready"],
    accessibility: ["document-order-is-reading-order"],
    interaction: ["caller-owned-entry-order-and-virtualization"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  timelineTurn: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "timeline-turn",
    parts: ["root"],
    states: ["running", "completed", "failed", "cancelled"],
    accessibility: ["turn-state-is-visible-in-descendants"],
    interaction: ["caller-owned-folding-and-entry-membership"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  conversationMessage: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "conversation-message",
    parts: ["root", "content"],
    optionalParts: ["actions", "capabilities"],
    states: ["ready", "queued", "streaming", "failed"],
    accessibility: ["semantic-article", "author-kind-is-structural"],
    interaction: ["caller-owned-copy-edit-links-and-markdown"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  conversationEmptyState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "conversation-empty-state",
    parts: ["root", "icon", "title"],
    optionalParts: ["detail"],
    states: ["empty"],
    accessibility: ["named-status", "decorative-icon-hidden"],
    interaction: ["caller-owned-prompt-copy"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  turnExecutionDisclosure: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "turn-execution-disclosure",
    parts: ["root", "summary", "content"],
    states: ["ready"],
    accessibility: ["native-details-summary"],
    interaction: [
      "native-disclosure",
      "caller-owned-open-state-when-controlled",
    ],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  turnChangeSummary: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "turn-change-summary",
    parts: ["root", "header"],
    optionalParts: ["content"],
    states: ["ready", "undone", "failed"],
    accessibility: ["named-article", "change-state-is-visible-in-content"],
    interaction: ["caller-owned-review-undo-and-file-disclosure"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  queuedMessageGroup: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "queued-message-group",
    parts: ["root", "heading", "items"],
    states: ["queued", "busy", "failed"],
    accessibility: ["named-polite-status", "ordered-items"],
    interaction: ["caller-owned-queue-order-and-actions"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
  queuedMessageItem: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "queued-message-item",
    parts: ["root", "index", "content"],
    optionalParts: ["actions"],
    states: ["queued", "busy", "failed"],
    accessibility: ["native-list-item", "visible-queue-index"],
    interaction: ["caller-owned-edit-steer-prioritize-delete"],
    theme: CONVERSATION_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, ConversationComponentContract>>);

export interface ConversationComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateConversationComponentContracts(
  candidate: unknown,
): ConversationComponentContractValidationResult {
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
  compare(candidate, CONVERSATION_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export interface ConversationSurfaceProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly state?: "ready" | "empty" | undefined;
}

export function ConversationSurface({
  children,
  label,
  state = "ready",
  ...attributes
}: ConversationSurfaceProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="conversation-surface"
      data-part="root"
      data-state={state}
    >
      {children}
    </section>
  );
}

export interface TimelineViewportProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly children: ReactNode;
  readonly label: string;
}

export const TimelineViewport = /* @__PURE__ */ forwardRef<
  HTMLDivElement,
  TimelineViewportProps
>(function TimelineViewport({ children, label, ...attributes }, ref) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="timeline-viewport"
      data-part="root"
      data-state="ready"
      ref={ref}
      role="region"
    >
      {children}
    </div>
  );
});

export interface TimelineSurfaceProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
}

export function TimelineSurface({
  children,
  ...attributes
}: TimelineSurfaceProps) {
  return (
    <div
      {...attributes}
      data-artemis-component="timeline"
      data-part="root"
      data-state="ready"
    >
      {children}
    </div>
  );
}

export interface TimelineTurnProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly state: "running" | "completed" | "failed" | "cancelled";
}

export function TimelineTurn({
  children,
  state,
  ...attributes
}: TimelineTurnProps) {
  return (
    <section
      {...attributes}
      data-artemis-component="timeline-turn"
      data-part="root"
      data-state={state}
    >
      {children}
    </section>
  );
}

export interface ConversationMessageProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly actions?: ReactNode | undefined;
  readonly capabilities?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly kind: "user" | "assistant" | "steering";
  readonly state?: "ready" | "queued" | "streaming" | "failed" | undefined;
}

export function ConversationMessage({
  actions,
  capabilities,
  children,
  kind,
  state = "ready",
  ...attributes
}: ConversationMessageProps) {
  return (
    <article
      {...attributes}
      data-artemis-component="conversation-message"
      data-message-kind={kind}
      data-part="root"
      data-state={state}
    >
      {actions ? <div data-part="actions">{actions}</div> : null}
      {capabilities ? <div data-part="capabilities">{capabilities}</div> : null}
      <div data-part="content">{children}</div>
    </article>
  );
}

export interface ConversationEmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  readonly detail?: ReactNode | undefined;
  readonly icon: ReactNode;
  readonly label: string;
  readonly title: ReactNode;
}

export function ConversationEmptyState({
  detail,
  icon,
  label,
  title,
  ...attributes
}: ConversationEmptyStateProps) {
  requirePerceptibleText(label);
  return (
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="conversation-empty-state"
      data-part="root"
      data-state="empty"
      role="status"
    >
      <span aria-hidden="true" data-part="icon">
        {icon}
      </span>
      <div data-part="title">{title}</div>
      {detail ? <div data-part="detail">{detail}</div> : null}
    </div>
  );
}

export interface TurnExecutionDisclosureProps extends Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly label: string;
  readonly summary: ReactNode;
}

export function TurnExecutionDisclosure({
  children,
  label,
  summary,
  ...attributes
}: TurnExecutionDisclosureProps) {
  requirePerceptibleText(label);
  return (
    <details
      {...attributes}
      aria-label={label}
      data-artemis-component="turn-execution-disclosure"
      data-part="root"
      data-state="ready"
    >
      <summary data-part="summary">{summary}</summary>
      <div data-part="content">{children}</div>
    </details>
  );
}

export interface TurnChangeSummaryProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children?: ReactNode | undefined;
  readonly header: ReactNode;
  readonly label: string;
  readonly state: "ready" | "undone" | "failed";
}

export function TurnChangeSummary({
  children,
  header,
  label,
  state,
  ...attributes
}: TurnChangeSummaryProps) {
  requirePerceptibleText(label);
  return (
    <article
      {...attributes}
      aria-label={label}
      data-artemis-component="turn-change-summary"
      data-part="root"
      data-state={state}
    >
      <header data-part="header">{header}</header>
      {children ? <div data-part="content">{children}</div> : null}
    </article>
  );
}

export interface QueuedMessageGroupProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly heading: ReactNode;
  readonly label: string;
  readonly state?: "queued" | "busy" | "failed" | undefined;
}

export function QueuedMessageGroup({
  children,
  heading,
  label,
  state = "queued",
  ...attributes
}: QueuedMessageGroupProps) {
  requirePerceptibleText(label);
  return (
    <section
      {...attributes}
      aria-label={label}
      data-artemis-component="queued-message-group"
      data-part="root"
      data-state={state}
      role="status"
    >
      <div data-part="heading">{heading}</div>
      <ol data-part="items">{children}</ol>
    </section>
  );
}

export interface QueuedMessageItemProps extends Omit<
  LiHTMLAttributes<HTMLLIElement>,
  "children"
> {
  readonly actions?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly index: ReactNode;
  readonly state?: "queued" | "busy" | "failed" | undefined;
}

export function QueuedMessageItem({
  actions,
  children,
  index,
  state = "queued",
  ...attributes
}: QueuedMessageItemProps) {
  return (
    <li
      {...attributes}
      data-artemis-component="queued-message-item"
      data-part="root"
      data-state={state}
    >
      <span aria-hidden="true" data-part="index">
        {index}
      </span>
      <div data-part="content">{children}</div>
      {actions ? <div data-part="actions">{actions}</div> : null}
    </li>
  );
}
