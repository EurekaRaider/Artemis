// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { QueuedMessageEditor } from "../src/renderer/QueuedMessageEditor.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const labels = {
  cancelLabel: "Cancel",
  errorLabel: "Failed to save message",
  retryLabel: "Retry",
  saveLabel: "Save",
  textareaLabel: "Queued message",
};

type EditorHandlers = {
  onCancel: ReturnType<typeof vi.fn>;
  onSave: ReturnType<typeof vi.fn>;
  onSuccess: ReturnType<typeof vi.fn>;
  focusReturnTarget: ReturnType<typeof vi.fn>;
};

const editorBox = () =>
  screen.getByRole("textbox", { name: labels.textareaLabel });

function EditorHarness({
  busy,
  errorDetail,
  initial,
  handlers,
}: {
  busy: boolean;
  errorDetail?: string | null;
  initial: string;
  handlers: EditorHandlers;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QueuedMessageEditor
      busy={busy}
      cancelLabel={labels.cancelLabel}
      errorDetail={errorDetail}
      errorLabel={labels.errorLabel}
      retryLabel={labels.retryLabel}
      saveLabel={labels.saveLabel}
      textareaLabel={labels.textareaLabel}
      value={value}
      focusReturnTarget={handlers.focusReturnTarget}
      onCancel={handlers.onCancel}
      onSave={handlers.onSave}
      onSuccess={handlers.onSuccess}
      onValueChange={setValue}
    />
  );
}

function renderEditor(
  options: {
    busy?: boolean;
    errorDetail?: string | null;
    initial?: string;
    onSave?: EditorHandlers["onSave"];
  } = {},
) {
  const focusTarget = document.createElement("button");
  const focusSpy = vi.spyOn(focusTarget, "focus");
  const handlers: EditorHandlers = {
    onCancel: vi.fn(),
    onSave: options.onSave ?? vi.fn(async () => true),
    onSuccess: vi.fn(),
    focusReturnTarget: vi.fn(() => focusTarget),
  };
  const busy = options.busy ?? false;
  const initial = options.initial ?? "Queued steer text";
  const utils = render(
    <EditorHarness
      busy={busy}
      errorDetail={options.errorDetail}
      initial={initial}
      handlers={handlers}
    />,
  );
  return {
    ...utils,
    handlers,
    focusSpy,
    rerenderEditor: (nextBusy: boolean) =>
      utils.rerender(
        <EditorHarness busy={nextBusy} initial={initial} handlers={handlers} />,
      ),
  };
}

describe("QueuedMessageEditor interactions (D#76 PR6 section 8 contract)", () => {
  it("submits exactly once with Meta+Enter when the draft is submittable (a)", async () => {
    const { handlers } = renderEditor();
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("submits exactly once with Ctrl+Enter when the draft is submittable (a)", async () => {
    const { handlers } = renderEditor();
    fireEvent.keyDown(editorBox(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("ignores the submit shortcut while the draft is blank, then submits once text exists (a, b)", async () => {
    const { handlers } = renderEditor({ initial: "   " });
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    expect(handlers.onSave).not.toHaveBeenCalled();

    await userEvent.setup().type(editorBox(), "steer");
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("ignores the submit shortcut while the parent is busy, then submits once idle (b)", async () => {
    const { handlers, rerenderEditor } = renderEditor({ busy: true });
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    expect(handlers.onSave).not.toHaveBeenCalled();

    rerenderEditor(false);
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("ignores Enter during IME composition, then submits on a clean Meta+Enter (c)", async () => {
    const { handlers } = renderEditor();
    fireEvent.keyDown(editorBox(), {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    });
    expect(handlers.onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("ignores Esc during IME composition, then cancels on a clean Esc (c, d)", async () => {
    const { handlers } = renderEditor();
    fireEvent.keyDown(editorBox(), { key: "Escape", isComposing: true });
    expect(handlers.onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(editorBox(), { key: "Escape" });
    await waitFor(() => expect(handlers.onCancel).toHaveBeenCalledTimes(1));
  });

  it("cancels exactly once when Esc is pressed and never saves (d)", async () => {
    const { handlers } = renderEditor();
    fireEvent.keyDown(editorBox(), { key: "Escape" });
    await waitFor(() => expect(handlers.onCancel).toHaveBeenCalledTimes(1));
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("does not cancel with Esc while the parent is busy, then cancels once idle (d)", async () => {
    const { handlers, rerenderEditor } = renderEditor({ busy: true });
    fireEvent.keyDown(editorBox(), { key: "Escape" });
    expect(handlers.onCancel).not.toHaveBeenCalled();

    rerenderEditor(false);
    fireEvent.keyDown(editorBox(), { key: "Escape" });
    await waitFor(() => expect(handlers.onCancel).toHaveBeenCalledTimes(1));
  });

  it("locks the editor while saving: aria-busy, disabled buttons, no repeat submits or cancel (d, e)", async () => {
    const gate = deferred<boolean>();
    const { container, handlers } = renderEditor({
      onSave: vi.fn(() => gate.promise),
    });
    const save = screen.getByRole("button", { name: labels.saveLabel });
    const cancel = screen.getByRole("button", { name: labels.cancelLabel });
    const root = container.firstElementChild as HTMLElement;

    await userEvent.setup().click(save);
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(root).toHaveAttribute("aria-busy", "true"));
    expect(save).toBeDisabled();
    expect(cancel).toBeDisabled();

    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await userEvent.setup().click(save);
    fireEvent.keyDown(editorBox(), { key: "Escape" });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();

    gate.resolve(true);
    await waitFor(() => expect(handlers.onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(root).not.toHaveAttribute("aria-busy"));
  });

  it("keeps the draft and offers a retryable alert when onSave fails (f)", async () => {
    let attempts = 0;
    const { handlers } = renderEditor({
      onSave: vi.fn(async () => {
        attempts += 1;
        return attempts === 1 ? false : true;
      }),
    });
    const box = editorBox();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(labels.errorLabel);
    expect(box).toHaveValue("Queued steer text");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.retryLabel }));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(handlers.onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("notifies success once and returns focus to the target after saving (g)", async () => {
    const { handlers, focusSpy } = renderEditor();
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handlers.onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(focusSpy).toHaveBeenCalledTimes(1));
  });

  it("clears the save error as soon as the draft changes (h)", async () => {
    renderEditor({ onSave: vi.fn(async () => false) });
    const box = editorBox();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      labels.errorLabel,
    );

    await userEvent.setup().type(box, " more");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(box).toHaveValue("Queued steer text more");
  });

  it("stops propagation of the submit shortcut so parents do not react", async () => {
    const handlers: EditorHandlers = {
      onCancel: vi.fn(),
      onSave: vi.fn(async () => true),
      onSuccess: vi.fn(),
      focusReturnTarget: vi.fn(() => document.createElement("button")),
    };
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <EditorHarness
          busy={false}
          initial="Queued steer text"
          handlers={handlers}
        />
      </div>,
    );
    fireEvent.keyDown(editorBox(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("wraps Save and Cancel in an actions container that is a direct child of the root (review fix: actions container)", async () => {
    const { container } = renderEditor({
      onSave: vi.fn(async () => false),
    });
    const root = container.firstElementChild as HTMLElement;
    const actions = container.querySelector(
      "div.queued-message-editor-actions",
    );
    expect(actions).not.toBeNull();
    expect(actions?.parentElement).toBe(root);

    const save = screen.getByRole("button", { name: labels.saveLabel });
    const cancel = screen.getByRole("button", { name: labels.cancelLabel });
    expect(save.closest("div.queued-message-editor-actions")).toBe(actions);
    expect(cancel.closest("div.queued-message-editor-actions")).toBe(actions);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));
    const alert = await screen.findByRole("alert");
    const retry = screen.getByRole("button", { name: labels.retryLabel });
    expect(retry.closest('[role="alert"]')).toBe(alert);
    expect(retry.closest("div.queued-message-editor-actions")).toBeNull();
  });

  it("returns focus to the target after Esc cancels the editor (review fix: escape focus return)", async () => {
    let target: HTMLElement | null = null;
    const handlers: EditorHandlers = {
      onCancel: vi.fn(),
      onSave: vi.fn(async () => true),
      onSuccess: vi.fn(),
      focusReturnTarget: vi.fn(() => target),
    };
    render(
      <div>
        <button data-testid="row-steer" type="button">
          Row steer
        </button>
        <EditorHarness
          busy={false}
          initial="Queued steer text"
          handlers={handlers}
        />
      </div>,
    );
    target = screen.getByTestId("row-steer");
    const box = editorBox();
    box.focus();
    expect(document.activeElement).toBe(box);

    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(handlers.onCancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(target));
  });

  it("shares the focus return between save success and Esc cancel without saving on cancel (review fix)", async () => {
    let target: HTMLElement | null = null;
    const handlers: EditorHandlers = {
      onCancel: vi.fn(),
      onSave: vi.fn(async () => true),
      onSuccess: vi.fn(),
      focusReturnTarget: vi.fn(() => target),
    };
    render(
      <div>
        <button data-testid="row-steer" type="button">
          Row steer
        </button>
        <EditorHarness
          busy={false}
          initial="Queued steer text"
          handlers={handlers}
        />
      </div>,
    );
    target = screen.getByTestId("row-steer");
    const box = editorBox();
    box.focus();

    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(handlers.onCancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(handlers.onSuccess).not.toHaveBeenCalled();

    box.focus();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handlers.onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(handlers.focusReturnTarget).toHaveBeenCalledTimes(2),
    );
    expect(document.activeElement).toBe(target);
  });

  it("keeps focus in the textarea when Esc is pressed while the parent is busy (review fix: no focus return)", async () => {
    let target: HTMLElement | null = null;
    const handlers: EditorHandlers = {
      onCancel: vi.fn(),
      onSave: vi.fn(async () => true),
      onSuccess: vi.fn(),
      focusReturnTarget: vi.fn(() => target),
    };
    render(
      <div>
        <button data-testid="row-steer" type="button">
          Row steer
        </button>
        <EditorHarness busy initial="Queued steer text" handlers={handlers} />
      </div>,
    );
    target = screen.getByTestId("row-steer");
    const box = editorBox();
    box.focus();
    expect(document.activeElement).toBe(box);

    fireEvent.keyDown(box, { key: "Escape" });
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(handlers.focusReturnTarget).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it("renders the save error detail when provided", async () => {
    renderEditor({
      errorDetail: "Task has no active turn.",
      onSave: vi.fn(async () => false),
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(labels.errorLabel);
    const detail = alert.querySelector(
      "small.queued-message-editor-error-detail",
    );
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent("Task has no active turn.");
  });

  it("omits the detail affordance when none", async () => {
    const withoutDetail = renderEditor({
      onSave: vi.fn(async () => false),
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));
    const defaultAlert = await screen.findByRole("alert");
    expect(defaultAlert).toHaveTextContent(labels.errorLabel);
    expect(
      defaultAlert.querySelector("small.queued-message-editor-error-detail"),
    ).toBeNull();
    withoutDetail.unmount();

    renderEditor({
      errorDetail: null,
      onSave: vi.fn(async () => false),
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.saveLabel }));
    const nullAlert = await screen.findByRole("alert");
    expect(nullAlert).toHaveTextContent(labels.errorLabel);
    expect(
      nullAlert.querySelector("small.queued-message-editor-error-detail"),
    ).toBeNull();
  });

  it("focuses the textarea when the editor opens (review fix: autofocus)", () => {
    renderEditor();
    expect(document.activeElement).toBe(editorBox());
  });

  it("returns focus to the target when the Cancel button is clicked (review fix: cancel focus return)", async () => {
    let target: HTMLElement | null = null;
    const handlers: EditorHandlers = {
      onCancel: vi.fn(),
      onSave: vi.fn(async () => true),
      onSuccess: vi.fn(),
      focusReturnTarget: vi.fn(() => target),
    };
    render(
      <div>
        <button data-testid="row-steer" type="button">
          Row steer
        </button>
        <EditorHarness
          busy={false}
          initial="Queued steer text"
          handlers={handlers}
        />
      </div>,
    );
    target = screen.getByTestId("row-steer");
    const cancel = screen.getByRole("button", { name: labels.cancelLabel });
    expect(cancel).toBeEnabled();

    await userEvent.setup().click(cancel);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(handlers.onSave).not.toHaveBeenCalled();
  });
});
