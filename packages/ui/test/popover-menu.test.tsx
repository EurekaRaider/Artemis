// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Popover, type PopoverProps } from "../src/feedback.js";

afterEach(() => cleanup());

function Example({
  children,
  ...props
}: Pick<PopoverProps, "children"> &
  Partial<Pick<PopoverProps, "onKeyDown" | "role">>) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchorRef} onClick={() => setOpen(true)} type="button">
        Open menu
      </button>
      <Popover
        anchorRef={anchorRef}
        label="Actions"
        onOpenChange={setOpen}
        open={open}
        role="menu"
        {...props}
      >
        {children}
      </Popover>
    </>
  );
}

describe("Popover menu keyboard navigation", () => {
  it("enters the first enabled item and wraps arrows, Home and End without activating actions", async () => {
    const user = userEvent.setup();
    const activate = vi.fn();
    render(
      <Example>
        <button role="menuitem" disabled>
          Unavailable
        </button>
        <button role="menuitem" aria-disabled="true">
          Not permitted
        </button>
        <button role="menuitem" onClick={activate}>
          First
        </button>
        <button role="menuitem" hidden>
          Hidden
        </button>
        <button role="menuitemcheckbox" aria-checked="false" tabIndex={-1}>
          Second
        </button>
        <button role="menuitemradio" aria-checked="true" tabIndex={-1}>
          Last
        </button>
      </Example>,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    const first = screen.getByRole("menuitem", { name: "First" });
    const second = screen.getByRole("menuitemcheckbox", { name: "Second" });
    const last = screen.getByRole("menuitemradio", { name: "Last" });
    expect(document.activeElement).toBe(first);
    for (const [key, target] of [
      ["ArrowDown", second],
      ["ArrowDown", last],
      ["ArrowDown", first],
      ["ArrowUp", last],
      ["Home", first],
      ["End", last],
      ["ArrowUp", second],
    ] as const) {
      await user.keyboard(`{${key}}`);
      expect(document.activeElement).toBe(target);
    }
    expect(activate).not.toHaveBeenCalled();
    await user.keyboard("{Home}{Enter}");
    expect(activate).toHaveBeenCalledTimes(1);
    const menu = screen.getByRole("menu");
    menu.focus();
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(last);
    menu.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(first);
  });

  it("keeps Tab order and Escape focus restoration", async () => {
    const user = userEvent.setup();
    render(
      <Example>
        <button role="menuitem">First</button>
        <button role="menuitem">Second</button>
      </Example>,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Second" }),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "First" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not duplicate navigation handled by a caller or child", async () => {
    const user = userEvent.setup();
    const caller = vi.fn(
      (event: Parameters<NonNullable<PopoverProps["onKeyDown"]>>[0]) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        screen.getByRole("menuitem", { name: "Second" }).focus();
      },
    );
    render(
      <Example onKeyDown={caller}>
        <button role="menuitem">First</button>
        <button
          role="menuitem"
          onKeyDown={(event) => {
            if (event.key !== "End") return;
            event.preventDefault();
            screen.getByRole("menuitem", { name: "First" }).focus();
          }}
        >
          Second
        </button>
        <button role="menuitem">Last</button>
      </Example>,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.keyboard("{ArrowDown}");
    expect(caller).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Second" }),
    );
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "First" }),
    );
  });

  it("does not cross inline or portaled nested menu boundaries", async () => {
    const user = userEvent.setup();
    function Nested() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={anchorRef} role="menuitem" onClick={() => setOpen(true)}>
            Submenu
          </button>
          <Popover
            anchorRef={anchorRef}
            label="Nested"
            onOpenChange={setOpen}
            open={open}
            role="menu"
          >
            <button role="menuitem">Nested first</button>
            <button role="menuitem">Nested last</button>
          </Popover>
        </>
      );
    }
    render(
      <Example>
        <button role="menuitem">First</button>
        <div role="menu" aria-label="Inline nested">
          <button role="menuitem">Inline item</button>
        </div>
        <Nested />
        <button role="menuitem">Last</button>
      </Example>,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Submenu" }),
    );
    const inline = screen.getByRole("menuitem", { name: "Inline item" });
    inline.focus();
    expect(fireEvent.keyDown(inline, { key: "End" })).toBe(true);
    expect(document.activeElement).toBe(inline);
    await user.click(screen.getByRole("menuitem", { name: "Submenu" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Nested last" }),
    );
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Nested first" }),
    );
  });

  it.each(["dialog", "menu"] as const)(
    "preserves editing keys and modifier shortcuts in a %s",
    async (role) => {
      const user = userEvent.setup();
      render(
        <Example role={role}>
          <input aria-label="Search" />
          <button role="menuitem">First</button>
          <button role="menuitem">Last</button>
        </Example>,
      );
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      const input = screen.getByRole("textbox", { name: "Search" });
      input.focus();
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
        expect(fireEvent.keyDown(input, { key })).toBe(true);
        expect(document.activeElement).toBe(input);
      }
      const first = screen.getByRole("menuitem", { name: "First" });
      first.focus();
      expect(fireEvent.keyDown(first, { key: "End", ctrlKey: true })).toBe(
        true,
      );
      expect(
        fireEvent.keyDown(first, { key: "ArrowDown", isComposing: true }),
      ).toBe(true);
      expect(document.activeElement).toBe(first);
      if (role === "dialog") {
        expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(true);
        expect(document.activeElement).toBe(first);
      }
    },
  );

  it("keeps focus on an entirely disabled menu", async () => {
    const user = userEvent.setup();
    render(
      <Example>
        <button role="menuitem" aria-disabled="true">
          Unavailable
        </button>
      </Example>,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(menu);
    await user.keyboard("{ArrowDown}{End}{ArrowUp}{Home}");
    expect(document.activeElement).toBe(menu);
  });
});
