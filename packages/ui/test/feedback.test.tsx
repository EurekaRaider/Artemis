// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfirmationDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FEEDBACK_ACCESSIBLE_NAME_ERROR,
  FEEDBACK_COMPONENT_CONTRACTS,
  FEEDBACK_OVERLAY_LAYER_CONTRACT,
  InlineNotice,
  LoadingState,
  Popover,
  Toast,
  ToastViewport,
  Tooltip,
  validateFeedbackComponentContracts,
} from "../src/feedback.js";

afterEach(() => cleanup());

describe("Feedback component contracts", () => {
  it("freezes exact feedback anatomy and overlay layers", () => {
    expect(Object.isFrozen(FEEDBACK_COMPONENT_CONTRACTS)).toBe(true);
    expect(FEEDBACK_COMPONENT_CONTRACTS.dialog.parts).toEqual([
      "root",
      "content",
    ]);
    expect(FEEDBACK_COMPONENT_CONTRACTS.toast.tones).toEqual([
      "neutral",
      "info",
      "success",
      "warning",
      "danger",
    ]);
    expect(FEEDBACK_OVERLAY_LAYER_CONTRACT).toEqual({
      popover: 80,
      toast: 100,
      nativeDialog: "top-layer",
    });
    expect(
      validateFeedbackComponentContracts(FEEDBACK_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects anatomy and unreviewed field drift", () => {
    const anatomy = structuredClone(FEEDBACK_COMPONENT_CONTRACTS);
    (anatomy.popover.parts as string[])[0] = "anchor";
    expect(validateFeedbackComponentContracts(anatomy).errors).toContain(
      'contracts.popover.parts[0] must equal "root"',
    );
    const extra = structuredClone(FEEDBACK_COMPONENT_CONTRACTS) as Record<
      string,
      unknown
    >;
    extra.banner = {};
    expect(validateFeedbackComponentContracts(extra).errors).toContain(
      "contracts fields are not exact",
    );
  });
});

describe("Feedback overlays", () => {
  it("opens a controlled native dialog, closes from Escape, and restores focus", async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Open settings
          </button>
          <Dialog label="Settings" onOpenChange={setOpen} open={open}>
            <button type="button">Save</button>
          </Dialog>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Open settings" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Save" }),
    );
    fireEvent(
      screen.getByRole("dialog", { name: "Settings" }),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes popovers on outside pointer and Escape while keeping portal content named", async () => {
    const user = userEvent.setup();
    function Example() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            onClick={() => setOpen((value) => !value)}
            ref={anchorRef}
            type="button"
          >
            Menu
          </button>
          <Popover
            anchorRef={anchorRef}
            focusOnOpen={false}
            label="Project menu"
            onOpenChange={setOpen}
            open={open}
          >
            <button onClick={() => setOpen(false)} type="button">
              Archive
            </button>
          </Popover>
          <button type="button">Outside</button>
        </>
      );
    }
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog", { name: "Project menu" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog", { name: "Project menu" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Project menu" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const archive = screen.getByRole("button", { name: "Archive" });
    archive.focus();
    await user.click(archive);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Menu" }),
      ),
    );
  });

  it("connects tooltip text to its trigger", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Create task">
        <button type="button">New</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button", { name: "New" }));
    const tooltip = screen.getByRole("tooltip", { name: "Create task" });
    expect(
      screen
        .getByRole("button", { name: "New" })
        .getAttribute("aria-describedby"),
    ).toContain(tooltip.id);
  });

  it("requires perceptible overlay labels", () => {
    expect(() =>
      render(
        <Dialog label="  " onOpenChange={() => undefined} open>
          Content
        </Dialog>,
      ),
    ).toThrow(FEEDBACK_ACCESSIBLE_NAME_ERROR);
  });
});

describe("Feedback states", () => {
  it("renders confirmation relations, tones, and caller-owned actions", () => {
    render(
      <ConfirmationDialog
        actions={<button type="button">Delete</button>}
        description="This cannot be undone."
        label="Delete project"
        onOpenChange={() => undefined}
        open
        title="Delete project?"
        tone="danger"
      />,
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete project?",
    });
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      dialog
        .querySelector('[data-artemis-component="confirmation"]')
        ?.getAttribute("data-tone"),
    ).toBe("danger");
  });

  it("renders toast live regions in a portal and invokes dismiss once", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    render(
      <ToastViewport label="Notifications">
        <Toast dismissLabel="Dismiss" onDismiss={dismiss} tone="danger">
          Build failed
        </Toast>
      </ToastViewport>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Build failed");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("renders notice, empty, loading, and error anatomy", () => {
    const { container } = render(
      <>
        <InlineNotice title="Connected" tone="success">
          Provider is ready.
        </InlineNotice>
        <EmptyState description="Create a task to begin." title="No tasks" />
        <LoadingState label="Loading resources" lines={8} />
        <ErrorState title="Could not load">Try again.</ErrorState>
      </>,
    );
    expect(
      container.querySelectorAll('[data-part="skeleton"] > i'),
    ).toHaveLength(6);
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent?.includes("Connected")),
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Try again");
    expect(screen.getByText("No tasks")).toBeTruthy();
  });
});
