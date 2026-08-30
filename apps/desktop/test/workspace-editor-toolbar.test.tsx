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
  WorkspaceEditorToolbar,
  type WorkspaceEditorModeToggle,
  type WorkspaceEditorToolbarProps,
  type WorkspaceEditorView,
} from "../src/renderer/WorkspaceEditorToolbar.js";

const editorLabel = "Editor content";

const labels = {
  path: "notes/meeting.md",
  richLabel: "Rich text",
  saveLabel: "Save",
  savedLabel: "Saved",
  savingLabel: "Saving…",
  sourceLabel: "Source",
  unsavedLabel: "Unsaved",
};

type ToolbarHandlers = {
  onViewChange: ReturnType<typeof vi.fn>;
  onSave: ReturnType<typeof vi.fn>;
};

const editorBox = () => screen.getByRole("textbox", { name: editorLabel });

const saveButton = () => screen.getByRole("button", { name: labels.saveLabel });

function ToolbarHarness({
  handlers,
  props,
}: {
  handlers: ToolbarHandlers;
  props: WorkspaceEditorToolbarProps;
}) {
  return (
    <WorkspaceEditorToolbar {...props} onSave={handlers.onSave}>
      <textarea aria-label={editorLabel} />
    </WorkspaceEditorToolbar>
  );
}

function renderToolbar(
  options: {
    overrides?: Partial<WorkspaceEditorToolbarProps>;
    withModeToggle?: boolean;
  } = {},
) {
  const handlers: ToolbarHandlers = {
    onViewChange: vi.fn(),
    onSave: vi.fn(),
  };
  const modeToggle = (
    value: WorkspaceEditorView = "rich",
  ): WorkspaceEditorModeToggle => ({
    ariaLabel: "View mode",
    onChange: handlers.onViewChange,
    richLabel: labels.richLabel,
    sourceLabel: labels.sourceLabel,
    value,
  });
  const build = (
    overrides: Partial<WorkspaceEditorToolbarProps> = {},
  ): WorkspaceEditorToolbarProps => ({
    dirty: false,
    modeToggle: options.withModeToggle ? modeToggle() : undefined,
    path: labels.path,
    readOnly: false,
    saveError: undefined,
    saveErrorDetail: undefined,
    saveLabel: labels.saveLabel,
    savedLabel: labels.savedLabel,
    saveState: "idle",
    savingLabel: labels.savingLabel,
    unsavedLabel: labels.unsavedLabel,
    onSave: handlers.onSave,
    ...overrides,
  });
  const utils = render(
    <ToolbarHarness handlers={handlers} props={build(options.overrides)} />,
  );
  return {
    ...utils,
    handlers,
    modeToggle,
    rerenderToolbar: (next: Partial<WorkspaceEditorToolbarProps>) =>
      utils.rerender(
        <ToolbarHarness handlers={handlers} props={build(next)} />,
      ),
  };
}

/**
 * Dispatch a keydown and report `defaultPrevented` as observed once the event
 * has finished bubbling past the React root (document bubble phase), so the
 * assertion reflects what the toolbar's own handler decided.
 */
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

describe("WorkspaceEditorToolbar contract (D#76 PR7 §5 shared toolbar)", () => {
  it("renders the save status as a polite live region showing the dirty label (status)", () => {
    renderToolbar({ overrides: { dirty: true } });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(labels.unsavedLabel);
  });

  it("applies saving > dirty > saved status priority across rerenders (status)", () => {
    const { rerenderToolbar } = renderToolbar({
      overrides: { dirty: true, saveState: "saving" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(labels.savingLabel);
    rerenderToolbar({ dirty: true, saveState: "idle" });
    expect(screen.getByRole("status")).toHaveTextContent(labels.unsavedLabel);
    rerenderToolbar({ dirty: true, saveState: "saved" });
    expect(screen.getByRole("status")).toHaveTextContent(labels.unsavedLabel);
    rerenderToolbar({ dirty: false, saveState: "saved" });
    expect(screen.getByRole("status")).toHaveTextContent(labels.savedLabel);
    rerenderToolbar({ dirty: false, saveState: "idle" });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("renders the save error as an alert with the optional detail (error)", () => {
    renderToolbar({
      overrides: {
        saveError: "Workspace file exceeds 4 MiB.",
        saveErrorDetail: "notes/big.md is 5.1 MiB",
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Workspace file exceeds 4 MiB.");
    const detail = alert.querySelector(
      "small.workspace-file-editor-error-detail",
    );
    expect(detail).not.toBeNull();
    expect(detail).toHaveTextContent("notes/big.md is 5.1 MiB");
  });

  it("omits the alert when there is no error and omits the detail when none is provided (error)", () => {
    const withoutError = renderToolbar();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    withoutError.unmount();

    renderToolbar({ overrides: { saveError: "Write failed" } });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Write failed");
    expect(
      alert.querySelector("small.workspace-file-editor-error-detail"),
    ).toBeNull();
  });

  it("disables Save when the draft is clean (save button)", async () => {
    const { handlers } = renderToolbar();
    const save = saveButton();
    expect(save).toBeDisabled();
    await userEvent.setup().click(save);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("disables Save while saving even when dirty (save button)", () => {
    renderToolbar({ overrides: { dirty: true, saveState: "saving" } });
    expect(saveButton()).toBeDisabled();
  });

  it("disables Save when readOnly even when dirty (read-only)", () => {
    renderToolbar({ overrides: { dirty: true, readOnly: true } });
    expect(saveButton()).toBeDisabled();
  });

  it("fires onSave exactly once on Save click when submittable (save button)", async () => {
    const { handlers } = renderToolbar({ overrides: { dirty: true } });
    expect(saveButton()).toBeEnabled();
    await userEvent.setup().click(saveButton());
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1));
  });

  it("submits exactly once with Meta+S and prevents the browser default (shortcuts)", () => {
    const { handlers } = renderToolbar({ overrides: { dirty: true } });
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("submits exactly once with Ctrl+S (shortcuts)", () => {
    const { handlers } = renderToolbar({ overrides: { dirty: true } });
    expect(keyDownTracked(editorBox(), { ctrlKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("ignores Meta+S during IME composition, then submits on a clean chord (ime)", () => {
    const { handlers } = renderToolbar({ overrides: { dirty: true } });
    expect(
      keyDownTracked(editorBox(), { metaKey: true, isComposing: true }),
    ).toEqual([false]);
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("prevents the chord default while clean or saving but submits once submittable (shortcuts)", () => {
    const { handlers, rerenderToolbar } = renderToolbar();
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).not.toHaveBeenCalled();

    rerenderToolbar({ dirty: true, saveState: "saving" });
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).not.toHaveBeenCalled();

    rerenderToolbar({ dirty: true, saveState: "idle" });
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("prevents the chord default when readOnly but never calls onSave (read-only)", () => {
    const { handlers } = renderToolbar({
      overrides: { dirty: true, readOnly: true },
    });
    expect(keyDownTracked(editorBox(), { metaKey: true })).toEqual([true]);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("renders the mode toggle group with a single aria-pressed selection and reports switches (mode toggle)", async () => {
    const { handlers, modeToggle, rerenderToolbar } = renderToolbar({
      withModeToggle: true,
      overrides: { dirty: true },
    });
    const group = screen.getByRole("group", { name: "View mode" });
    const rich = within(group).getByRole("button", {
      name: labels.richLabel,
    });
    const source = within(group).getByRole("button", {
      name: labels.sourceLabel,
    });
    expect(rich).toHaveAttribute("aria-pressed", "true");
    expect(source).toHaveAttribute("aria-pressed", "false");

    await userEvent.setup().click(source);
    expect(handlers.onViewChange).toHaveBeenCalledWith("source");
    await userEvent.setup().click(rich);
    expect(handlers.onViewChange).toHaveBeenCalledWith("rich");

    rerenderToolbar({ dirty: true, modeToggle: modeToggle("source") });
    const updatedGroup = screen.getByRole("group", { name: "View mode" });
    expect(
      within(updatedGroup).getByRole("button", { name: labels.richLabel }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(updatedGroup).getByRole("button", { name: labels.sourceLabel }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("omits the mode toggle when not provided while keeping the save controls (mode toggle)", () => {
    renderToolbar({ overrides: { dirty: true } });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
  });

  it("disables the mode toggle buttons when readOnly (read-only)", () => {
    renderToolbar({
      withModeToggle: true,
      overrides: { dirty: true, readOnly: true },
    });
    const group = screen.getByRole("group", { name: "View mode" });
    expect(
      within(group).getByRole("button", { name: labels.richLabel }),
    ).toBeDisabled();
    expect(
      within(group).getByRole("button", { name: labels.sourceLabel }),
    ).toBeDisabled();
  });

  it("renders the editing surface through the children slot (composition)", () => {
    renderToolbar({ overrides: { dirty: true } });
    expect(editorBox()).toBeInTheDocument();
  });
});
