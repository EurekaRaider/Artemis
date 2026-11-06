import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { expect } from "vitest";
import {
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  Popover,
  Toast,
  ToastViewport,
} from "@artemis/ui/feedback";

export const feedbackCases = {
  "feedback-anatomy"() {
    const { container } = render(
      <>
        <InlineNotice title="Ready" tone="success">
          Connected
        </InlineNotice>
        <Toast tone="warning">Review required</Toast>
        <EmptyState description="Create one" title="No tasks" />
        <LoadingState label="Loading tasks" lines={2} />
        <ErrorState title="Load failed">Try again</ErrorState>
      </>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual([
      "inline-notice",
      "toast",
      "empty-state",
      "loading-state",
      "error-state",
    ]);
    expect(screen.getByRole("alert").textContent).toContain("Try again");
    expect(
      container.querySelectorAll('[data-part="skeleton"] > i'),
    ).toHaveLength(2);
  },
  async "overlay-focus-and-close"() {
    const user = userEvent.setup();
    function MatrixDialogExample() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Open confirmation
          </button>
          <ConfirmationDialog
            actions={<button type="button">Continue</button>}
            description="Focus remains contained."
            label="Continue migration"
            onOpenChange={setOpen}
            open={open}
            title="Continue migration?"
          />
        </>
      );
    }
    render(<MatrixDialogExample />);
    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Continue" }),
    );
    fireEvent(
      screen.getByRole("alertdialog", { name: "Continue migration?" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
  "portal-viewport-geometry"() {
    const anchorRef = createRef<HTMLButtonElement>();
    const portal = document.createElement("div");
    document.body.append(portal);
    const { container, unmount } = render(
      <>
        <button ref={anchorRef} type="button">
          Anchor
        </button>
        <Popover
          anchorRef={anchorRef}
          focusOnOpen={false}
          label="Viewport popover"
          onOpenChange={() => undefined}
          open
          portalContainer={portal}
        >
          Popover content
        </Popover>
        <ToastViewport label="Matrix notifications" portalContainer={portal}>
          <Toast>Saved</Toast>
        </ToastViewport>
      </>,
    );
    expect(
      container.querySelector('[data-artemis-component="popover"]'),
    ).toBeNull();
    const popover = within(portal).getByRole("dialog", {
      name: "Viewport popover",
    });
    expect(popover.style.left).toBe("8px");
    expect(popover.style.top).toBe("8px");
    expect(within(portal).getByRole("status").textContent).toBe("Saved");
    unmount();
    portal.remove();
  },
};
