// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import {
  McpEditorFeedback,
  type McpEditorFeedbackProps,
  type McpEditorRemoveControl,
  type McpEditorTestConnectionControl,
  type McpEditorTestConnectionState,
} from "../src/renderer/McpEditorFeedback.js";

// Synthetic test data only (PR8 checklist 安全边界 6): no real server names,
// commands, URLs, env values, or credentials ever appear in this file.
const labels = {
  editorContent: "MCP editor fields",
  busy: "Saving…",
  retry: "Try again",
  validationHeading: "Fix these before saving",
  validationEndpoint: "Launch command is required.",
  validationHttps: "Server URL must use HTTPS.",
  saveError: "Save failed because the URL host could not be resolved.",
  removeError: "This server is managed by a plugin and cannot be uninstalled.",
  testConnection: "Test connection",
  testBusy: "Testing connection…",
  testSuccess: "Connected",
  testDetail: "synthetic-stdio-demo is connected",
  testFailure: "Connection failed",
  testFailureDetail: "The process exited before the MCP handshake completed.",
  testSavedOnlyHint: "Tests the saved configuration — save your changes first",
  remove: "Uninstall",
  removeConfirm: "Uninstall synthetic-stdio-demo MCP server?",
};

type Handlers = {
  onConfirm: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
  onTest: ReturnType<typeof vi.fn>;
};

const editorBox = () =>
  screen.getByRole("textbox", { name: labels.editorContent });

function renderFeedback(
  options: {
    overrides?: Partial<McpEditorFeedbackProps>;
    withRemove?: boolean;
    withTestConnection?: boolean;
    onConfirmResult?: boolean;
  } = {},
) {
  const handlers: Handlers = {
    onConfirm:
      vi.fn<
        (message: string, tone?: "default" | "danger") => Promise<boolean>
      >(),
    onRemove: vi.fn(),
    onTest: vi.fn(),
  };
  if (options.onConfirmResult !== undefined) {
    handlers.onConfirm.mockResolvedValue(options.onConfirmResult);
  }
  const testConnection = (
    state: McpEditorTestConnectionState = { status: "idle" },
    extras: Partial<McpEditorTestConnectionControl> = {},
  ): McpEditorTestConnectionControl => ({
    state,
    label: labels.testConnection,
    busyLabel: labels.testBusy,
    successLabel: labels.testSuccess,
    failureLabel: labels.testFailure,
    onTest: handlers.onTest,
    ...extras,
  });
  const remove = (): McpEditorRemoveControl => ({
    label: labels.remove,
    confirmMessage: labels.removeConfirm,
    onConfirm: handlers.onConfirm,
    onRemove: handlers.onRemove,
  });
  const build = (
    overrides: Partial<McpEditorFeedbackProps> = {},
  ): McpEditorFeedbackProps => ({
    busyLabel: labels.busy,
    validationHeading: labels.validationHeading,
    ...overrides,
  });
  const initial = build({
    ...(options.withRemove ? { remove: remove() } : {}),
    ...(options.withTestConnection ? { testConnection: testConnection() } : {}),
    ...options.overrides,
  });
  const utils = render(
    <McpEditorFeedback {...initial}>
      <textarea aria-label={labels.editorContent} />
    </McpEditorFeedback>,
  );
  const feedbackWrapper = () =>
    utils.container.querySelector(".mcp-editor-feedback");
  return {
    ...utils,
    feedbackWrapper,
    handlers,
    remove,
    testConnection,
    rerenderFeedback: (next: Partial<McpEditorFeedbackProps>) =>
      utils.rerender(
        <McpEditorFeedback {...build(next)}>
          <textarea aria-label={labels.editorContent} />
        </McpEditorFeedback>,
      ),
  };
}

describe("McpEditorFeedback contract (D#76 PR8 §5 shared feedback surface)", () => {
  it("renders the editor surface through the children slot without aria-busy when idle (composition)", () => {
    const { feedbackWrapper } = renderFeedback();
    expect(editorBox()).toBeInTheDocument();
    const wrapper = feedbackWrapper();
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveAttribute("aria-busy");
  });

  it("omits the validation alert when there are no validation errors (validation)", () => {
    renderFeedback();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists every validation error inside a role=alert container with its heading (validation)", () => {
    renderFeedback({
      overrides: {
        validationErrors: [labels.validationEndpoint, labels.validationHttps],
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(labels.validationHeading);
    expect(alert).toHaveTextContent(labels.validationEndpoint);
    expect(alert).toHaveTextContent(labels.validationHttps);
    expect(within(alert).getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks the wrapper aria-busy and announces the busy label via role=status, then clears both (busy)", () => {
    const { feedbackWrapper, rerenderFeedback } = renderFeedback({
      overrides: { busy: true },
    });
    expect(feedbackWrapper()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(labels.busy);
    rerenderFeedback({ busy: false });
    expect(feedbackWrapper()).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("suppresses the busy status region when no busyLabel is provided (busy)", () => {
    renderFeedback({ overrides: { busy: true, busyLabel: undefined } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the remove and test-connection controls while busy (busy)", () => {
    renderFeedback({
      withRemove: true,
      withTestConnection: true,
      overrides: { busy: true },
    });
    expect(screen.getByRole("button", { name: labels.remove })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: labels.testConnection }),
    ).toBeDisabled();
  });

  it("disables the Uninstall control while a connection test is pending (mutual exclusion)", () => {
    const {
      feedbackWrapper,
      handlers,
      rerenderFeedback,
      remove,
      testConnection,
    } = renderFeedback({ withRemove: true, withTestConnection: true });
    rerenderFeedback({
      remove: remove(),
      testConnection: testConnection({ status: "busy" }),
    });
    expect(
      screen.getByRole("button", { name: labels.testConnection }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: labels.remove })).toBeDisabled();
    // Disabling is behavior, not aria: the wrapper stays idle (only the test
    // region carries aria-busy) and a programmatic Uninstall click must open
    // no confirmation while the test is in flight.
    expect(feedbackWrapper()).not.toHaveAttribute("aria-busy");
    fireEvent.click(screen.getByRole("button", { name: labels.remove }));
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it("disables the test control while the remove confirmation is pending (mutual exclusion)", async () => {
    const { handlers } = renderFeedback({
      withRemove: true,
      withTestConnection: true,
    });
    let resolveConfirm!: (confirmed: boolean) => void;
    handlers.onConfirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const uninstall = screen.getByRole("button", { name: labels.remove });
    await userEvent.setup().click(uninstall);
    expect(uninstall).toBeDisabled();
    const testButton = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(testButton).toBeDisabled();
    fireEvent.click(testButton);
    expect(handlers.onTest).not.toHaveBeenCalled();
    resolveConfirm(false);
    await waitFor(() => expect(testButton).toBeEnabled());
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it("renders the action error as an alert and clears it from the tree on rerender (save/remove error)", () => {
    const { rerenderFeedback } = renderFeedback({
      overrides: { actionError: labels.saveError },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(labels.saveError);
    rerenderFeedback({ actionError: undefined });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers an in-alert retry control only when both the retry label and callback are provided (retry)", async () => {
    const onActionErrorRetry = vi.fn();
    const withRetry = renderFeedback({
      overrides: {
        actionError: labels.removeError,
        actionErrorRetryLabel: labels.retry,
        onActionErrorRetry,
      },
    });
    const retry = within(screen.getByRole("alert")).getByRole("button", {
      name: labels.retry,
    });
    await userEvent.setup().click(retry);
    expect(onActionErrorRetry).toHaveBeenCalledTimes(1);
    withRetry.unmount();

    const withoutCallback = renderFeedback({
      overrides: {
        actionError: labels.removeError,
        actionErrorRetryLabel: labels.retry,
      },
    });
    expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
    withoutCallback.unmount();

    renderFeedback({
      overrides: {
        actionError: labels.removeError,
        onActionErrorRetry,
      },
    });
    expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
  });

  it("omits the test-connection control entirely for new servers (test connection)", () => {
    renderFeedback();
    expect(
      screen.queryByRole("button", { name: labels.testConnection }),
    ).not.toBeInTheDocument();
  });

  it("disables the test button, marks only its own region aria-busy, and announces testing while pending (test busy)", async () => {
    const { container, handlers, rerenderFeedback, testConnection } =
      renderFeedback({ withTestConnection: true });
    const button = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(handlers.onTest).toHaveBeenCalledTimes(1);

    rerenderFeedback({ testConnection: testConnection({ status: "busy" }) });
    expect(
      screen.getByRole("button", { name: labels.testConnection }),
    ).toBeDisabled();
    const testRegion = container.querySelector(".mcp-editor-test");
    expect(testRegion).not.toBeNull();
    expect(testRegion).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(labels.testBusy);
  });

  it("announces test success via a polite status region including the detail and re-enables retesting (test success)", () => {
    const { handlers, rerenderFeedback, testConnection } = renderFeedback({
      withTestConnection: true,
    });
    rerenderFeedback({
      testConnection: testConnection({
        status: "success",
        detail: labels.testDetail,
      }),
    });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(labels.testSuccess);
    expect(status).toHaveTextContent(labels.testDetail);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: labels.testConnection }),
    ).toBeEnabled();
    expect(handlers.onTest).not.toHaveBeenCalled();
  });

  it("reports test failure through role=alert and allows an immediate retest (test failure)", async () => {
    const { handlers, rerenderFeedback, testConnection } = renderFeedback({
      withTestConnection: true,
    });
    rerenderFeedback({
      testConnection: testConnection({
        status: "failure",
        message: labels.testFailureDetail,
      }),
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(labels.testFailure);
    expect(alert).toHaveTextContent(labels.testFailureDetail);
    const button = screen.getByRole("button", {
      name: labels.testConnection,
    });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(handlers.onTest).toHaveBeenCalledTimes(1);
  });

  it("blocks the test button behind the saved-only hint while the control reports draft drift (drift gate)", () => {
    const { handlers, rerenderFeedback, testConnection } = renderFeedback({
      withTestConnection: true,
    });
    rerenderFeedback({
      testConnection: testConnection(
        { status: "idle" },
        { disabled: true, disabledHint: labels.testSavedOnlyHint },
      ),
    });
    const button = screen.getByRole("button", { name: labels.testConnection });
    expect(button).toBeDisabled();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    fireEvent.click(button);
    expect(handlers.onTest).not.toHaveBeenCalled();
    // The tri-state still flows while blocked: a prior success stays
    // announced next to the hint until the draft is saved or reverted.
    rerenderFeedback({
      testConnection: testConnection(
        { status: "success", detail: labels.testDetail },
        { disabled: true, disabledHint: labels.testSavedOnlyHint },
      ),
    });
    expect(screen.getByText(labels.testSuccess)).toBeInTheDocument();
    expect(screen.getByText(labels.testSavedOnlyHint)).toBeInTheDocument();
    rerenderFeedback({ testConnection: testConnection() });
    expect(
      screen.queryByText(labels.testSavedOnlyHint),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: labels.testConnection }),
    ).toBeEnabled();
  });

  it("routes Uninstall through onConfirm exactly once with the danger message; a denial keeps the editor usable and never removes (remove confirmation)", async () => {
    const { handlers } = renderFeedback({ withRemove: true });
    let resolveConfirm!: (confirmed: boolean) => void;
    handlers.onConfirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const uninstall = screen.getByRole("button", { name: labels.remove });
    await userEvent.setup().click(uninstall);
    await userEvent.setup().click(uninstall);
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).toHaveBeenCalledWith(
      labels.removeConfirm,
      "danger",
    );

    resolveConfirm(false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: labels.remove })).toBeEnabled(),
    );
    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(editorBox()).toBeInTheDocument();
  });

  it("removes exactly once after the danger confirmation is accepted (remove confirmation)", async () => {
    const { handlers } = renderFeedback({
      withRemove: true,
      onConfirmResult: true,
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.remove }));
    await waitFor(() => expect(handlers.onRemove).toHaveBeenCalledTimes(1));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).toHaveBeenCalledWith(
      labels.removeConfirm,
      "danger",
    );
  });

  it("never logs to the console across a busy → error → failure → success cycle (credential safety)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { rerenderFeedback, testConnection } = renderFeedback({
        withTestConnection: true,
      });
      rerenderFeedback({ busy: true });
      rerenderFeedback({
        busy: false,
        actionError: labels.saveError,
      });
      rerenderFeedback({
        actionError: undefined,
        testConnection: testConnection({
          status: "failure",
          message: labels.testFailureDetail,
        }),
      });
      rerenderFeedback({
        testConnection: testConnection({ status: "success" }),
      });
      rerenderFeedback({
        testConnection: undefined,
        validationErrors: [labels.validationEndpoint],
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
