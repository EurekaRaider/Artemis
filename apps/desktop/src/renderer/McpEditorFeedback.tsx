import { useRef, useState, type ReactNode } from "react";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";

/** Tri-state reported by the parent for the edit-mode connection check. */
export type McpEditorTestConnectionState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "success"; detail?: string }
  | { status: "failure"; message: string };

/**
 * Remove control for edit mode. `onConfirm` mirrors the App
 * `requestConfirmation` primitive (also exposed as the ResourceCenter
 * `onConfirm` prop) so the existing alertdialog chain is reused verbatim.
 */
export interface McpEditorRemoveControl {
  label: string;
  confirmMessage: string;
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onRemove(): void;
}

/** Test-connection control; provided in edit mode only (see file docblock). */
export interface McpEditorTestConnectionControl {
  state: McpEditorTestConnectionState;
  label: string;
  busyLabel: string;
  successLabel: string;
  failureLabel: string;
  /**
   * True when the editor draft no longer matches the saved configuration.
   * The reconnect IPC only exercises the saved server, so the button stays
   * disabled and `disabledHint` explains why. Disabling is behavior, not
   * aria: the tri-state `state` keeps flowing while blocked.
   */
  disabled?: boolean;
  /**
   * Static copy only — SECURITY: must never contain a credential value.
   */
  disabledHint?: string;
  onTest(): void;
}

export interface McpEditorFeedbackProps {
  /**
   * Editor field cards stay in McpServerEditor.tsx (renderer-layout source
   * assertions bind them there); this slot exists only so the feedback
   * wrapper can carry `aria-busy` for the whole form while saving/removing.
   * SECURITY: never render credential values through this slot.
   */
  children?: ReactNode;
  /**
   * True while the parent's `run()` wrapper is awaiting save or remove.
   * Sets `aria-busy` on the wrapper and disables in-component controls.
   */
  busy?: boolean;
  /** Announcement for the busy live region, e.g. "Saving…". */
  busyLabel?: string;
  /** Optional heading rendered inside the validation alert. */
  validationHeading?: string;
  /** Field-level validation findings; empty/omitted means no alert. */
  validationErrors?: readonly string[];
  /**
   * Save/remove failure message shown in an alert. Parent-composed string —
   * SECURITY: must never contain a credential value.
   */
  actionError?: string;
  /** Retry affordance rendered inside the action-error alert. */
  actionErrorRetryLabel?: string;
  onActionErrorRetry?(): void;
  /** Omit for new servers (no saved id to confirm against). */
  remove?: McpEditorRemoveControl;
  /**
   * Omit for new servers: `reconnectMcpServer` only accepts a saved id, so
   * the unsaved-draft test path stays "save and connect" (checklist §3-1
   * Discussion tradeoff). Omitting renders no test control at all.
   */
  testConnection?: McpEditorTestConnectionControl;
}

/**
 * Shared feedback surface for the MCP server editor (D#76 PR8).
 *
 * Scope — pure feedback layer only:
 * - Renders the shared feedback chrome from the PR8 checklist §5 matrix:
 *   the validation alert list, the busy live region with the `aria-busy`
 *   wrapper, the save/remove error alert with optional retry, the edit-mode
 *   test-connection tri-state control, and the remove confirmation control
 *   that defers to the App `requestConfirmation` alertdialog chain.
 * - Field cards, the Save button (and its
 *   `disabled={actionsLocked || !endpoint.trim()}` guard), and every
 *   `window.artemis` call (`saveMcpServer`/`removeMcpServer`/
 *   `reconnectMcpServer`) stay in McpServerEditor.tsx —
 *   test/renderer-layout.test.ts asserts those source strings there.
 * - Zero `window.artemis` access, zero IPC, zero business logic: every state
 *   arrives as a prop and every intent leaves through a callback.
 *
 * Mutual exclusion (PR8 review F1): the save/remove/test/confirm actions are
 * four-way exclusive. While any one is in flight the other in-component
 * controls disable: a pending test disables Remove, a pending confirmation
 * or test disables the test control, and a pending save/remove (`busy`)
 * disables both. The Save button participates through the parent's
 * `actionsLocked` expression. Disabling is behavior, not aria — see the
 * wrapper note below.
 *
 * SECURITY (PR8 checklist 安全边界 2/3 — hard constraints):
 * - Credential values must never be passed into this component — not through
 *   props, not through `children`. The bearer input stays a
 *   `type="password"` field owned by McpServerEditor.
 * - `validationErrors`, `actionError`, `disabledHint`, and failure messages
 *   are parent-composed strings and must never embed bearer tokens, env
 *   values, or any other secret.
 * - This component performs no logging whatsoever (no `console.*` in any
 *   state transition), so no feedback path can leak a credential into logs.
 */
// D#76 PR8: wrapper `aria-busy` is driven only by the save/remove `busy`
// prop; a pending connection check marks its own `.mcp-editor-test` region
// instead (parent ruling), so the form fields are never announced as busy
// while the user edits credentials mid-test.
export function McpEditorFeedback(props: McpEditorFeedbackProps): ReactNode {
  const {
    actionError,
    actionErrorRetryLabel,
    busy,
    busyLabel,
    children,
    onActionErrorRetry,
    remove,
    testConnection,
    validationErrors,
    validationHeading,
  } = props;

  // Pending-confirmation guard: while the danger alertdialog chain is open,
  // a second Uninstall click must not re-enter `onConfirm`. The guard resets
  // on both denial and completion, so a denied flow stays fully usable. It
  // also takes part in the four-way mutual exclusion: no test can start (or
  // re-enter) while the confirmation is open.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const confirmingRemoveRef = useRef(false);

  const testState = testConnection?.state;
  const testPending = testState?.status === "busy";
  const testBlocked = testConnection?.disabled === true;

  const handleRemove = async () => {
    if (!remove || confirmingRemoveRef.current || busy || testPending) return;
    confirmingRemoveRef.current = true;
    setConfirmingRemove(true);
    try {
      const confirmed = await remove.onConfirm(remove.confirmMessage, "danger");
      if (confirmed) remove.onRemove();
    } finally {
      confirmingRemoveRef.current = false;
      setConfirmingRemove(false);
    }
  };

  return (
    <div aria-busy={busy ? "true" : undefined} className="mcp-editor-feedback">
      {busy && busyLabel ? (
        <InlineNotice
          aria-live="polite"
          className="mcp-editor-busy"
          tone="info"
        >
          {busyLabel}
        </InlineNotice>
      ) : null}
      {validationErrors && validationErrors.length > 0 ? (
        <InlineNotice
          className="mcp-editor-validation"
          title={validationHeading}
          tone="danger"
        >
          <ul>
            {validationErrors.map((error, index) => (
              <li key={`${index}-${error}`}>{error}</li>
            ))}
          </ul>
        </InlineNotice>
      ) : null}
      {actionError ? (
        <InlineNotice
          action={
            actionErrorRetryLabel && onActionErrorRetry ? (
              <Button
                className="mcp-editor-action-retry"
                onClick={() => onActionErrorRetry()}
                variant="danger"
              >
                {actionErrorRetryLabel}
              </Button>
            ) : undefined
          }
          className="mcp-editor-action-error"
          tone="danger"
        >
          {actionError}
        </InlineNotice>
      ) : null}
      {children}
      {testConnection ? (
        <div
          aria-busy={testPending ? "true" : undefined}
          className="mcp-editor-test"
        >
          <Button
            className="mcp-editor-test-button"
            disabled={busy || confirmingRemove || testBlocked}
            loading={testPending}
            onClick={() => testConnection.onTest()}
          >
            {testConnection.label}
          </Button>
          {testBlocked && !testPending && testConnection.disabledHint ? (
            <InlineNotice className="mcp-editor-test-hint" tone="info">
              {testConnection.disabledHint}
            </InlineNotice>
          ) : null}
          {testPending ? (
            <InlineNotice
              aria-live="polite"
              className="mcp-editor-test-status"
              tone="info"
            >
              {testConnection.busyLabel}
            </InlineNotice>
          ) : null}
          {testState?.status === "success" ? (
            <InlineNotice
              aria-live="polite"
              className="mcp-editor-test-status"
              tone="success"
            >
              {testConnection.successLabel}
              {testState.detail ? (
                <small className="mcp-editor-test-detail">
                  {" "}
                  {testState.detail}
                </small>
              ) : null}
            </InlineNotice>
          ) : null}
          {testState?.status === "failure" ? (
            <InlineNotice
              className="mcp-editor-test-failure"
              title={testConnection.failureLabel}
              tone="danger"
            >
              <p className="mcp-editor-test-failure-message">
                {testState.message}
              </p>
            </InlineNotice>
          ) : null}
        </div>
      ) : null}
      {remove ? (
        <Button
          className="mcp-editor-remove"
          disabled={busy || testPending}
          loading={confirmingRemove}
          onClick={handleRemove}
          variant="danger"
        >
          {remove.label}
        </Button>
      ) : null}
    </div>
  );
}
