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
  initial,
  handlers,
}: {
  busy: boolean;
  initial: string;
  handlers: EditorHandlers;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QueuedMessageEditor
      busy={busy}
      cancelLabel={labels.cancelLabel}
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
    <EditorHarness busy={busy} initial={initial} handlers={handlers} />,
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
});
