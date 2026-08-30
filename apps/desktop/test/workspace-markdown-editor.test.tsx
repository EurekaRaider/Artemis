// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { WorkspaceMarkdownEditor } from "../src/renderer/WorkspaceMarkdownEditor.js";

const labels = {
  ariaLabel: "Edit file: notes/meeting.md",
  path: "notes/meeting.md",
  richLabel: "Rich text",
  saveLabel: "Save",
  savedLabel: "Saved",
  savingLabel: "Saving…",
  sourceLabel: "Source",
  unsavedLabel: "Unsaved",
};

const content = "# Meeting notes";

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
    <WorkspaceMarkdownEditor
      ariaLabel={labels.ariaLabel}
      content={content}
      dirty={false}
      onChange={handlers.onChange}
      onSave={handlers.onSave}
      path={labels.path}
      richLabel={labels.richLabel}
      saveError={undefined}
      saveLabel={labels.saveLabel}
      savedLabel={labels.savedLabel}
      saveState={"idle"}
      savingLabel={labels.savingLabel}
      sourceLabel={labels.sourceLabel}
      threadId={undefined}
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
    sourceTextarea: () =>
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

async function openSourceView() {
  const utils = renderEditor({ dirty: true });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: labels.sourceLabel }));
  return utils;
}

describe("WorkspaceMarkdownEditor shared toolbar wiring (D#76 PR7 item 3)", () => {
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

  it("wires the mode toggle: unique aria-pressed selection switches the editing surface", async () => {
    renderEditor({ dirty: true });
    const group = screen.getByRole("group", { name: labels.ariaLabel });
    const rich = screen.getByRole("button", { name: labels.richLabel });
    const source = screen.getByRole("button", { name: labels.sourceLabel });
    expect(rich).toHaveAttribute("aria-pressed", "true");
    expect(source).toHaveAttribute("aria-pressed", "false");
    expect(group).toContainElement(rich);
    expect(group).toContainElement(source);
    expect(
      screen.getByRole("heading", { name: "Meeting notes", level: 1 }),
    ).toBeInTheDocument();

    await userEvent.setup().click(source);
    expect(source).toHaveAttribute("aria-pressed", "true");
    expect(rich).toHaveAttribute("aria-pressed", "false");
    const textarea = screen.getByRole("textbox", { name: labels.ariaLabel });
    expect(textarea).toHaveValue(content);

    await userEvent.setup().click(rich);
    expect(rich).toHaveAttribute("aria-pressed", "true");
    expect(source).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("textbox", { name: labels.ariaLabel }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Meeting notes", level: 1 }),
    ).toBeInTheDocument();
  });

  it("submits exactly once via Meta+S and Ctrl+S from the source editing surface", async () => {
    const { handlers, sourceTextarea } = await openSourceView();
    expect(keyDownTracked(sourceTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(keyDownTracked(sourceTextarea(), { ctrlKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(2);
  });

  it("ignores the save chord during IME composition, then saves on a clean chord", async () => {
    const { handlers, sourceTextarea } = await openSourceView();
    expect(
      keyDownTracked(sourceTextarea(), { metaKey: true, isComposing: true }),
    ).toEqual([false]);
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(keyDownTracked(sourceTextarea(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("claims the chord while clean but does not save", async () => {
    const utils = renderEditor({ dirty: false });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: labels.sourceLabel }));
    expect(keyDownTracked(utils.sourceTextarea(), { metaKey: true })).toEqual([
      true,
    ]);
    expect(utils.handlers.onSave).not.toHaveBeenCalled();
  });

  it("blocks saving and the source textarea when readOnly", async () => {
    const utils = await openSourceView();
    utils.rerenderEditor({ dirty: true, readOnly: true });
    expect(
      screen.getByRole("button", { name: labels.saveLabel }),
    ).toBeDisabled();
    expect(utils.sourceTextarea()).toBeDisabled();
    expect(keyDownTracked(utils.sourceTextarea(), { metaKey: true })).toEqual([
      true,
    ]);
    expect(utils.handlers.onSave).not.toHaveBeenCalled();
  });

  it("keeps reporting draft edits through onChange from the source textarea", async () => {
    const { handlers, sourceTextarea } = await openSourceView();
    await userEvent.setup().type(sourceTextarea(), "!");
    expect(handlers.onChange).toHaveBeenCalledWith("# Meeting notes!");
  });
});
