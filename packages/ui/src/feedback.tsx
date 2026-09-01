import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

interface DismissibleOverlayRegistration {
  readonly id: symbol;
  readonly outsidePointer: boolean;
}

const dismissibleOverlayStack: DismissibleOverlayRegistration[] = [];

function registerDismissibleOverlay(
  registration: DismissibleOverlayRegistration,
): () => void {
  const existing = dismissibleOverlayStack.findIndex(
    (candidate) => candidate.id === registration.id,
  );
  if (existing >= 0) dismissibleOverlayStack.splice(existing, 1);
  dismissibleOverlayStack.push(registration);
  return () => {
    const index = dismissibleOverlayStack.findIndex(
      (candidate) => candidate.id === registration.id,
    );
    if (index >= 0) dismissibleOverlayStack.splice(index, 1);
  };
}

function isTopDismissibleOverlay(id: symbol): boolean {
  return dismissibleOverlayStack[dismissibleOverlayStack.length - 1]?.id === id;
}

function isTopOutsidePointerOverlay(id: symbol): boolean {
  for (let index = dismissibleOverlayStack.length - 1; index >= 0; index -= 1) {
    const candidate = dismissibleOverlayStack[index];
    if (candidate?.outsidePointer) return candidate.id === id;
  }
  return false;
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export const FEEDBACK_COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const FEEDBACK_COMPONENT_MUTABLE_TOKENS = /* @__PURE__ */ Object.freeze([
  "--artemis-color-surface-base",
  "--artemis-color-surface-raised",
  "--artemis-color-surface-sunken",
  "--artemis-color-overlay-scrim",
  "--artemis-color-interaction-hover",
  "--artemis-color-text-primary",
  "--artemis-color-text-secondary",
  "--artemis-color-border-default",
  "--artemis-color-border-strong",
  "--artemis-color-accent-primary",
  "--artemis-color-status-info",
  "--artemis-color-status-success",
  "--artemis-color-status-warning",
  "--artemis-color-status-danger",
  "--artemis-color-status-info-subtle",
  "--artemis-color-status-success-subtle",
  "--artemis-color-status-warning-subtle",
  "--artemis-color-status-danger-subtle",
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
  "--artemis-radius-card",
  "--artemis-radius-panel",
  "--artemis-radius-pill",
  "--artemis-typography-body-family",
  "--artemis-typography-body-size",
  "--artemis-typography-label-size",
  "--artemis-typography-body-weight",
  "--artemis-motion-duration-fast",
  "--artemis-motion-duration-normal",
  "--artemis-motion-easing-standard",
  "--artemis-shadow-overlay",
  "--artemis-opacity-disabled",
] as const);

export type FeedbackTone =
  "neutral" | "info" | "success" | "warning" | "danger";
export type OverlayPlacement =
  "block-start" | "block-end" | "inline-start" | "inline-end";
export type OverlayAlignment = "start" | "center" | "end";
export type FeedbackState = "hidden" | "visible" | "exiting" | "disabled";

export interface FeedbackComponentContract {
  readonly schemaVersion: typeof FEEDBACK_COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name:
    | "tooltip"
    | "popover"
    | "dialog"
    | "confirmation"
    | "toast"
    | "inline-notice"
    | "empty-state"
    | "loading-state"
    | "error-state";
  readonly parts: readonly string[];
  readonly optionalParts?: readonly string[];
  readonly states: readonly FeedbackState[];
  readonly tones?: readonly FeedbackTone[];
  readonly accessibility: readonly string[];
  readonly interaction: readonly string[];
  readonly theme: {
    readonly direction: "inherit-and-place-logically";
    readonly reducedMotion: "disable-transform-and-shimmer";
    readonly mutableTokens: typeof FEEDBACK_COMPONENT_MUTABLE_TOKENS;
    readonly safetyFloor: readonly string[];
  };
}

const FEEDBACK_THEME_CONTRACT = {
  direction: "inherit-and-place-logically",
  reducedMotion: "disable-transform-and-shimmer",
  mutableTokens: FEEDBACK_COMPONENT_MUTABLE_TOKENS,
  safetyFloor: [
    "accessible-name-required",
    "portal-container-explicit-or-document-body",
    "closed-overlays-removed-from-accessibility-tree",
    "escape-closes-top-overlay",
    "focus-entry-and-return",
    "status-not-color-only",
    "overlay-geometry-clamped-to-viewport",
  ],
} as const;

export const FEEDBACK_COMPONENT_CONTRACTS = /* @__PURE__ */ deepFreeze({
  tooltip: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "tooltip",
    parts: ["root", "anchor", "content"],
    states: ["hidden", "visible"],
    accessibility: ["trigger-describedby-tooltip", "tooltip-role"],
    interaction: [
      "hover-and-focus-open",
      "pointer-and-blur-close",
      "escape-closes",
    ],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  popover: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "popover",
    parts: ["root", "content"],
    states: ["hidden", "visible"],
    accessibility: ["required-perceptible-label", "focus-entry-and-return"],
    interaction: [
      "controlled-open-state",
      "escape-closes",
      "outside-pointer-closes",
      "resize-and-scroll-reposition",
    ],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  dialog: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "dialog",
    parts: ["root", "content"],
    states: ["hidden", "visible"],
    accessibility: [
      "native-modal-top-layer",
      "required-perceptible-label",
      "focus-trap-and-return",
    ],
    interaction: [
      "controlled-open-state",
      "escape-closes",
      "backdrop-closes-when-enabled",
    ],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  confirmation: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "confirmation",
    parts: ["root", "title", "description", "actions"],
    optionalParts: ["icon"],
    states: ["hidden", "visible", "disabled"],
    tones: ["neutral", "info", "success", "warning", "danger"],
    accessibility: ["alertdialog-role", "title-and-description-relations"],
    interaction: ["caller-owned-actions", "dialog-close-contract"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  toast: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "toast",
    parts: ["root", "message"],
    optionalParts: ["action"],
    states: ["visible", "exiting"],
    tones: ["neutral", "info", "success", "warning", "danger"],
    accessibility: ["polite-or-assertive-live-region", "visible-message"],
    interaction: ["caller-owned-timeout", "optional-dismiss-action"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  inlineNotice: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "inline-notice",
    parts: ["root", "message"],
    optionalParts: ["icon", "title", "action"],
    states: ["visible"],
    tones: ["neutral", "info", "success", "warning", "danger"],
    accessibility: ["status-or-alert-role", "visible-message"],
    interaction: ["caller-owned-action"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  emptyState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "empty-state",
    parts: ["root", "title"],
    optionalParts: ["description", "icon", "action"],
    states: ["visible"],
    accessibility: ["visible-title-and-optional-description"],
    interaction: ["caller-owned-action"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  loadingState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "loading-state",
    parts: ["root", "label", "skeleton"],
    states: ["visible"],
    accessibility: ["busy-status", "perceptible-label"],
    interaction: ["none"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
  errorState: {
    schemaVersion: 1,
    uiContractVersion: 1,
    name: "error-state",
    parts: ["root", "message"],
    optionalParts: ["icon", "title", "action"],
    states: ["visible"],
    tones: ["danger"],
    accessibility: ["alert-role", "visible-message"],
    interaction: ["caller-owned-retry"],
    theme: FEEDBACK_THEME_CONTRACT,
  },
} as const satisfies Readonly<Record<string, FeedbackComponentContract>>);

export interface FeedbackComponentContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateFeedbackComponentContracts(
  candidate: unknown,
): FeedbackComponentContractValidationResult {
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
  compare(candidate, FEEDBACK_COMPONENT_CONTRACTS, "contracts");
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

const PERCEPTIBLE_LABEL_CHARACTER =
  /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;
const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const FEEDBACK_ACCESSIBLE_NAME_ERROR =
  "Artemis feedback components require a non-empty accessible label";
export const FEEDBACK_VISIBLE_TEXT_ERROR =
  "Artemis feedback states require non-empty visible text";

function requirePerceptibleText(value: string): void {
  if (typeof value !== "string" || !PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    throw new Error(FEEDBACK_ACCESSIBLE_NAME_ERROR);
  }
}

function requireVisibleText(value: ReactNode): void {
  if (typeof value === "string" && PERCEPTIBLE_LABEL_CHARACTER.test(value)) {
    return;
  }
  if (typeof value === "number") return;
  if (value !== null && value !== undefined && value !== false) return;
  throw new Error(FEEDBACK_VISIBLE_TEXT_ERROR);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

function portalTarget(container: HTMLElement | null | undefined) {
  if (container) return container;
  return typeof document === "undefined" ? null : document.body;
}

interface AnchoredPosition {
  readonly left: number;
  readonly measured: boolean;
  readonly top: number;
}

function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  placement: OverlayPlacement,
  align: OverlayAlignment,
): AnchoredPosition {
  const [position, setPosition] = useState<AnchoredPosition>({
    left: 0,
    measured: false,
    top: 0,
  });

  useLayoutEffect(() => {
    if (!open) {
      setPosition({ left: 0, measured: false, top: 0 });
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      const content = contentRef.current;
      if (!anchor || !content) return;
      const anchorRect = anchor.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const gap = 8;
      const margin = 8;
      const direction = getComputedStyle(anchor).direction;
      const inlineStart =
        direction === "rtl"
          ? anchorRect.right - contentRect.width
          : anchorRect.left;
      const inlineEnd =
        direction === "rtl"
          ? anchorRect.left
          : anchorRect.right - contentRect.width;
      const below = anchorRect.bottom + gap;
      const above = anchorRect.top - contentRect.height - gap;
      let left: number;
      let top: number;
      if (placement === "block-start" || placement === "block-end") {
        left =
          align === "center"
            ? anchorRect.left + (anchorRect.width - contentRect.width) / 2
            : align === "start"
              ? inlineStart
              : inlineEnd;
        top = placement === "block-end" ? below : above;
        if (
          placement === "block-end" &&
          top + contentRect.height > window.innerHeight - margin &&
          above >= margin
        ) {
          top = above;
        } else if (
          placement === "block-start" &&
          top < margin &&
          below + contentRect.height <= window.innerHeight - margin
        ) {
          top = below;
        }
      } else {
        top =
          align === "center"
            ? anchorRect.top + (anchorRect.height - contentRect.height) / 2
            : align === "start"
              ? anchorRect.top
              : anchorRect.bottom - contentRect.height;
        const before =
          direction === "rtl"
            ? anchorRect.right + gap
            : anchorRect.left - contentRect.width - gap;
        const after =
          direction === "rtl"
            ? anchorRect.left - contentRect.width - gap
            : anchorRect.right + gap;
        left = placement === "inline-start" ? before : after;
        const alternate = placement === "inline-start" ? after : before;
        if (
          (left < margin ||
            left + contentRect.width > window.innerWidth - margin) &&
          alternate >= margin &&
          alternate + contentRect.width <= window.innerWidth - margin
        ) {
          left = alternate;
        }
      }
      left = Math.min(
        Math.max(margin, left),
        Math.max(margin, window.innerWidth - contentRect.width - margin),
      );
      top = Math.min(
        Math.max(margin, top),
        Math.max(margin, window.innerHeight - contentRect.height - margin),
      );
      setPosition({ left, measured: true, top });
    };
    update();
    const frame = window.requestAnimationFrame(update);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [align, anchorRef, contentRef, open, placement]);

  return position;
}

export interface TooltipProps {
  readonly align?: OverlayAlignment | undefined;
  readonly children: ReactElement<Record<string, unknown>>;
  readonly label: string;
  readonly placement?: OverlayPlacement | undefined;
  readonly portalContainer?: HTMLElement | null | undefined;
}

export function Tooltip({
  align = "center",
  children,
  label,
  placement = "block-start",
  portalContainer,
}: TooltipProps) {
  requirePerceptibleText(label);
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const overlayId = useRef(Symbol("artemis-tooltip")).current;
  const open = hovered || focused;
  const position = useAnchoredPosition(
    open,
    anchorRef,
    contentRef,
    placement,
    align,
  );
  const currentDescribedBy = children.props["aria-describedby"];
  const describedBy = [
    typeof currentDescribedBy === "string" ? currentDescribedBy : undefined,
    id,
  ]
    .filter(Boolean)
    .join(" ");
  const target = portalTarget(portalContainer);
  useEffect(() => {
    if (!open) return;
    const unregister = registerDismissibleOverlay({
      id: overlayId,
      outsidePointer: false,
    });
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopDismissibleOverlay(overlayId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHovered(false);
      setFocused(false);
    };
    document.addEventListener("keydown", closeEscape, true);
    return () => {
      document.removeEventListener("keydown", closeEscape, true);
      unregister();
    };
  }, [open, overlayId]);
  return (
    <span
      data-artemis-component="tooltip-anchor"
      data-part="anchor"
      onBlur={(event: FocusEvent<HTMLSpanElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      onFocus={() => setFocused(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={anchorRef}
    >
      {cloneElement(children, { "aria-describedby": describedBy })}
      {open && target
        ? createPortal(
            <div
              data-artemis-component="tooltip"
              data-part="root"
              data-state="visible"
              id={id}
              ref={contentRef}
              role="tooltip"
              style={{
                left: position.left,
                top: position.top,
                visibility: position.measured ? "visible" : "hidden",
              }}
            >
              <span data-part="content">{label}</span>
            </div>,
            target,
          )
        : null}
    </span>
  );
}

export interface PopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role"
> {
  readonly align?: OverlayAlignment | undefined;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly contentRef?: Ref<HTMLDivElement> | undefined;
  readonly focusOnOpen?: boolean | undefined;
  readonly label: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly placement?: OverlayPlacement | undefined;
  readonly portalContainer?: HTMLElement | null | undefined;
  readonly role?: "dialog" | "menu" | undefined;
}

export function Popover({
  align = "start",
  anchorRef,
  children,
  contentRef: forwardedRef,
  focusOnOpen = true,
  label,
  onOpenChange,
  open,
  placement = "block-end",
  portalContainer,
  role = "dialog",
  style,
  ...attributes
}: PopoverProps) {
  requirePerceptibleText(label);
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const overlayId = useRef(Symbol("artemis-popover")).current;
  const anchorRefRef = useLatestRef(anchorRef);
  const onOpenChangeRef = useLatestRef(onOpenChange);
  const position = useAnchoredPosition(
    open,
    anchorRef,
    contentRef,
    placement,
    align,
  );

  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    const unregister = registerDismissibleOverlay({
      id: overlayId,
      outsidePointer: true,
    });
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : anchorRefRef.current.current;
    const closeOutside = (event: PointerEvent) => {
      if (!isTopOutsidePointerOverlay(overlayId)) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        anchorRefRef.current.current?.contains(target) ||
        contentRef.current?.contains(target)
      ) {
        return;
      }
      onOpenChangeRef.current(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopDismissibleOverlay(overlayId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onOpenChangeRef.current(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeEscape, true);
      unregister();
      if (
        content?.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        const restoreFocus =
          restoreFocusRef.current ?? anchorRefRef.current.current;
        window.requestAnimationFrame(() => {
          if (restoreFocus?.isConnected) {
            restoreFocus.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [anchorRefRef, onOpenChangeRef, open, overlayId]);

  useEffect(() => {
    if (!open || !focusOnOpen || !position.measured) return;
    const target =
      contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      contentRef.current;
    target?.focus({ preventScroll: true });
  }, [focusOnOpen, open, position.measured]);

  if (!open) return null;
  const target = portalTarget(portalContainer);
  if (!target) return null;
  return createPortal(
    <div
      {...attributes}
      aria-label={label}
      data-artemis-component="popover"
      data-part="root"
      data-state="visible"
      ref={(node) => {
        contentRef.current = node;
        assignRef(forwardedRef, node);
      }}
      role={role}
      style={{
        ...style,
        left: position.left,
        top: position.top,
        visibility: position.measured ? "visible" : "hidden",
      }}
      tabIndex={attributes.tabIndex ?? -1}
    >
      <div data-part="content">{children}</div>
    </div>,
    target,
  );
}

export interface DialogProps extends Omit<
  HTMLAttributes<HTMLDialogElement>,
  "children" | "role"
> {
  readonly children: ReactNode;
  readonly closeOnBackdrop?: boolean | undefined;
  readonly closeOnEscape?: boolean | undefined;
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly label: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly portalContainer?: HTMLElement | null | undefined;
  readonly returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly role?: "dialog" | "alertdialog" | undefined;
}

export function Dialog({
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocusRef,
  label,
  onClick,
  onOpenChange,
  open,
  portalContainer,
  returnFocusRef,
  role = "dialog",
  ...attributes
}: DialogProps) {
  requirePerceptibleText(label);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const restoreFocus =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const focusTarget =
      initialFocusRef?.current ??
      dialog.querySelector<HTMLElement>("[autofocus]") ??
      dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialog;
    focusTarget.focus({ preventScroll: true });
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      if (restoreFocus?.isConnected)
        restoreFocus.focus({ preventScroll: true });
    };
  }, [initialFocusRef, open, returnFocusRef]);

  if (!open) return null;
  const target = portalTarget(portalContainer);
  if (!target) return null;
  return createPortal(
    <dialog
      {...attributes}
      aria-label={label}
      aria-modal="true"
      data-artemis-component="dialog"
      data-part="root"
      data-state="visible"
      onCancel={(event) => {
        event.preventDefault();
        if (closeOnEscape) onOpenChange(false);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!closeOnBackdrop || event.defaultPrevented) return;
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onOpenChange(false);
        }
      }}
      ref={dialogRef}
      role={role}
      tabIndex={-1}
    >
      <div data-part="content">{children}</div>
    </dialog>,
    target,
  );
}

export interface ConfirmationDialogProps {
  readonly actions: ReactNode;
  readonly className?: string | undefined;
  readonly description: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly icon?: ReactNode | undefined;
  readonly label: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly portalContainer?: HTMLElement | null | undefined;
  readonly title: ReactNode;
  readonly tone?: FeedbackTone | undefined;
}

export function ConfirmationDialog({
  actions,
  className,
  description,
  disabled,
  icon,
  label,
  onOpenChange,
  open,
  portalContainer,
  title,
  tone = "neutral",
}: ConfirmationDialogProps) {
  requireVisibleText(title);
  requireVisibleText(description);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={className}
      closeOnBackdrop={!disabled}
      closeOnEscape={!disabled}
      label={label}
      onOpenChange={onOpenChange}
      open={open}
      portalContainer={portalContainer}
      role="alertdialog"
    >
      <div
        data-artemis-component="confirmation"
        data-part="root"
        data-state={disabled ? "disabled" : "visible"}
        data-tone={tone}
      >
        {icon ? (
          <span aria-hidden="true" data-part="icon">
            {icon}
          </span>
        ) : null}
        <strong data-part="title" id={titleId}>
          {title}
        </strong>
        <div data-part="description" id={descriptionId}>
          {description}
        </div>
        <div data-part="actions">{actions}</div>
      </div>
    </Dialog>
  );
}

export interface ToastProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly children: ReactNode;
  readonly dismissLabel?: string | undefined;
  readonly exiting?: boolean | undefined;
  readonly onDismiss?: (() => void) | undefined;
  readonly tone?: FeedbackTone | undefined;
}

export function Toast({
  children,
  dismissLabel,
  exiting,
  onDismiss,
  tone = "neutral",
  ...attributes
}: ToastProps) {
  requireVisibleText(children);
  if (onDismiss) requirePerceptibleText(dismissLabel ?? "");
  const assertive = tone === "danger";
  return (
    <div
      {...attributes}
      aria-live={assertive ? "assertive" : "polite"}
      data-artemis-component="toast"
      data-part="root"
      data-state={exiting ? "exiting" : "visible"}
      data-tone={tone}
      role={assertive ? "alert" : "status"}
    >
      <span data-part="message">{children}</span>
      {onDismiss ? (
        <button
          aria-label={dismissLabel}
          data-part="action"
          onClick={onDismiss}
          type="button"
        >
          {dismissLabel}
        </button>
      ) : null}
    </div>
  );
}

export interface ToastViewportProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly label: string;
  readonly portalContainer?: HTMLElement | null | undefined;
}

export function ToastViewport({
  children,
  className,
  label,
  portalContainer,
}: ToastViewportProps) {
  requirePerceptibleText(label);
  const target = portalTarget(portalContainer);
  if (!target) return null;
  return createPortal(
    <div
      aria-label={label}
      className={className}
      data-artemis-toast-viewport=""
    >
      {children}
    </div>,
    target,
  );
}

export interface InlineNoticeProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  readonly action?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly icon?: ReactNode | undefined;
  readonly title?: ReactNode | undefined;
  readonly tone?: FeedbackTone | undefined;
}

export function InlineNotice({
  action,
  children,
  icon,
  title,
  tone = "info",
  ...attributes
}: InlineNoticeProps) {
  requireVisibleText(children);
  const assertive = tone === "danger";
  return (
    <div
      {...attributes}
      data-artemis-component="inline-notice"
      data-part="root"
      data-state="visible"
      data-tone={tone}
      role={assertive ? "alert" : "status"}
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <div data-part="message">
        {title ? <strong data-part="title">{title}</strong> : null}
        {children}
      </div>
      {action ? <div data-part="action">{action}</div> : null}
    </div>
  );
}

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  readonly action?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly icon?: ReactNode | undefined;
  readonly title: ReactNode;
}

export function EmptyState({
  action,
  description,
  icon,
  title,
  ...attributes
}: EmptyStateProps) {
  requireVisibleText(title);
  if (description !== undefined) requireVisibleText(description);
  return (
    <div
      {...attributes}
      data-artemis-component="empty-state"
      data-part="root"
      data-state="visible"
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <strong data-part="title">{title}</strong>
      {description !== undefined ? (
        <div data-part="description">{description}</div>
      ) : null}
      {action ? <div data-part="action">{action}</div> : null}
    </div>
  );
}

export interface LoadingStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly label: string;
  readonly lines?: number | undefined;
}

export function LoadingState({
  label,
  lines = 3,
  ...attributes
}: LoadingStateProps) {
  requirePerceptibleText(label);
  const count = Math.max(1, Math.min(6, Math.round(lines)));
  return (
    <div
      {...attributes}
      aria-busy="true"
      data-artemis-component="loading-state"
      data-part="root"
      data-state="visible"
      role="status"
    >
      <span data-part="label">{label}</span>
      <span aria-hidden="true" data-part="skeleton">
        {Array.from({ length: count }, (_, index) => (
          <i key={index} />
        ))}
      </span>
    </div>
  );
}

export interface ErrorStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  readonly action?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly icon?: ReactNode | undefined;
  readonly title?: ReactNode | undefined;
}

export function ErrorState({
  action,
  children,
  icon,
  title,
  ...attributes
}: ErrorStateProps) {
  requireVisibleText(children);
  return (
    <div
      {...attributes}
      data-artemis-component="error-state"
      data-part="root"
      data-state="visible"
      data-tone="danger"
      role="alert"
    >
      {icon ? (
        <span aria-hidden="true" data-part="icon">
          {icon}
        </span>
      ) : null}
      <div data-part="message">
        {title ? <strong data-part="title">{title}</strong> : null}
        {children}
      </div>
      {action ? <div data-part="action">{action}</div> : null}
    </div>
  );
}

export const FEEDBACK_OVERLAY_LAYER_CONTRACT = /* @__PURE__ */ Object.freeze({
  popover: 80,
  toast: 100,
  nativeDialog: "top-layer",
} as const);
