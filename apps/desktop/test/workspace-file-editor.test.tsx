// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { WorkspaceFileEditor } from "../src/renderer/WorkspaceFileEditor.js";

const labels = {
  ariaLabel: "Edit file: src/main.rs",
  path: "src/main.rs",
  saveLabel: "Save",
  savedLabel: "Saved",
  savingLabel: "Saving…",
  unsavedLabel: "Unsaved",
};

const content = 'fn main() {\n    println!("hi");\n}';

type EditorHandlers = {
  onChange: ReturnType<typeof vi.fn>;
  onSave: ReturnType<typeof vi.fn>;
};

interface EditorHarnessProps {
  handlers: EditorHandlers;
  overrides: Record<string, unknown>;
}

function EditorHarness({ handlers, overrides }: EditorHarnessProps) {
  return (
    <WorkspaceFileEditor
      ariaLabel={labels.ariaLabel}
      content={content}
      dirty={false}
      onChange={handlers.onChange}
      onSave={handlers.onSave}
      path={labels.path}
      saveError={undefined}
      saveLabel={labels.saveLabel}
      savedLabel={labels.savedLabel}
      saveState={"idle"}
      savingLabel={labels.savingLabel}
      unsavedLabel={labels.unsavedLabel}
      {...overrides}
    />
  );
}

function renderEditor(overrides: Record<string, unknown> = {}) {
  const handlers: EditorHandlers = {
    onChange: vi.fn(),
    onSave: vi.fn(),
  };
  const utils = render(
    <EditorHarness handlers={handlers} overrides={overrides} />,
  );
  return {
    ...utils,
    handlers,
    rerenderEditor: (next: Record<string, unknown>) =>
      utils.rerender(<EditorHarness handlers={handlers} overrides={next} />),
    editorTextarea: () =>
      screen.getByRole("textbox", { name: labels.ariaLabel }),
  };
}

/** Mirror of the toolbar test's bubble-phase defaultPrevented observer. */
function keyDownTracked(element: HTMLElement, init: Record<string, unknown>) {
  const observed: boolean[] = [];
  const listener = (event: KeyboardEvent) => {
    observed.push(event.defaultPrevented);
  };
  document.addEventListener("keydown", listener);
  fireEvent.keyDown(element, { key: "s", ...init });
  document.removeEventListener("keydown", listener);
  return observed;
}

describe("WorkspaceFileEditor shared toolbar wiring (D#76 PR7 item 5)", () => {
  it("renders the save status as a polite live region following dirty/saving/saved props", () => {
    const { rerenderEditor } = renderEditor({ dirty: true });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(labels.unsavedLabel);

    rerenderEditor({ dirty: true, saveState: "saving" });
    expect(screen.getByRole("status")).toHaveTextContent(labels.savingLabel);

    rerenderEditor({ dirty: false, saveState: "saved" });
    expect(screen.getByRole("status")).toHaveTextContent(labels.savedLabel);

    rerenderEditor({ dirty: false, saveState: "idle" });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("renders the save error as an alert only while present", () => {
    const { rerenderEditor } = renderEditor({
      dirty: true,
      saveError: "Workspace file exceeds 4 MiB.",
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Workspace file exceeds 4 MiB.");

    rerenderEditor({ dirty: true, saveError: undefined });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Save while clean or saving and fires onSave once when submittable", async () => {
    const { handlers, rerenderEditor } = renderEditor();
    expect(
      screen.getByRole("button", { name: labels.saveLabel }),
    ).toBeDisabled();

    rerenderEditor({ dirty: true });
    const save = screen.getByRole("button", { name: labels.saveLabel });
    expect(save).toBeEnabled();
    await userEvent.setup().click(save);
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));

    rerenderEditor({ dirty: true, saveState: "saving" });
    expect(
      screen.getByRole("button", { name: labels.saveLabel }),
    ).toBeDisabled();
  });

  it("submits exactly once via Meta+S and Ctrl+S from the editing surface", () => {
    const { handlers, editorTextarea } = renderEditor({ dirty: true });
    expect(keyDownTracked(editorTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(keyDownTracked(editorTextarea(), { ctrlKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(2);
  });

  it("ignores the save chord during IME composition, then saves on a clean chord", () => {
    const { handlers, editorTextarea } = renderEditor({ dirty: true });
    expect(
      keyDownTracked(editorTextarea(), { metaKey: true, isComposing: true }),
    ).toEqual([false]);
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(keyDownTracked(editorTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("claims the chord while clean but does not save", () => {
    const { handlers, editorTextarea } = renderEditor({ dirty: false });
    expect(keyDownTracked(editorTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("blocks saving and disables the editing surface when readOnly", () => {
    const { handlers, editorTextarea } = renderEditor({
      dirty: true,
      readOnly: true,
    });
    expect(
      screen.getByRole("button", { name: labels.saveLabel }),
    ).toBeDisabled();
    expect(editorTextarea()).toBeDisabled();
    expect(keyDownTracked(editorTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("renders no mode toggle group for the plain file editor shape", () => {
    renderEditor({ dirty: true });
    expect(screen.getByTitle(labels.path)).toHaveTextContent(labels.path);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(labels.saveLabel);
  });

  it("keeps reporting draft edits through onChange from the textarea", async () => {
    const { handlers, editorTextarea } = renderEditor({ dirty: true });
    await userEvent.setup().type(editorTextarea(), "!");
    expect(handlers.onChange).toHaveBeenCalledWith(`${content}!`);
  });
});
