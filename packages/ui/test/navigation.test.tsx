// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NAVIGATION_ACCESSIBLE_NAME_ERROR,
  NAVIGATION_COMPONENT_CONTRACTS,
  NAVIGATION_CONTROL_BOUNDARY_ERROR,
  NAVIGATION_OPTION_ERROR,
  NAVIGATION_SELECTION_ERROR,
  NAVIGATION_STATE_PRIORITY,
  NAVIGATION_TAB_RELATION_ERROR,
  SegmentedControl,
  Tabs,
  validateNavigationComponentContracts,
} from "../src/navigation.js";

const TAB_OPTIONS = [
  { id: "alpha-tab", label: "Alpha", panelId: "alpha-panel", value: "alpha" },
  {
    disabled: true,
    id: "blocked-tab",
    label: "Blocked",
    panelId: "blocked-panel",
    value: "blocked",
  },
  { id: "gamma-tab", label: "Gamma", panelId: "gamma-panel", value: "gamma" },
] as const;

afterEach(() => cleanup());

describe("Navigation component contracts", () => {
  it("deep-freezes exact anatomy, states, sizes, and direction policy", () => {
    expect(Object.isFrozen(NAVIGATION_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(NAVIGATION_COMPONENT_CONTRACTS.tabs.parts)).toBe(
      true,
    );
    expect(NAVIGATION_COMPONENT_CONTRACTS.tabs.parts).toEqual(["root", "tab"]);
    expect(NAVIGATION_COMPONENT_CONTRACTS.segmentedControl.parts).toEqual([
      "root",
      "segment",
    ]);
    expect(NAVIGATION_COMPONENT_CONTRACTS.tabs.statePriority).toEqual(
      NAVIGATION_STATE_PRIORITY,
    );
    expect(NAVIGATION_COMPONENT_CONTRACTS.tabs.sizes).toEqual([
      "compact",
      "comfortable",
    ]);
    expect(NAVIGATION_COMPONENT_CONTRACTS.tabs.theme.direction).toBe("inherit");
  });

  it("rejects anatomy, priority, and unreviewed field drift", () => {
    expect(
      validateNavigationComponentContracts(NAVIGATION_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
    const anatomy = structuredClone(NAVIGATION_COMPONENT_CONTRACTS);
    (anatomy.tabs.parts as string[])[0] = "container";
    expect(validateNavigationComponentContracts(anatomy).errors).toContain(
      'contracts.tabs.parts[0] must equal "root"',
    );
    const priority = structuredClone(NAVIGATION_COMPONENT_CONTRACTS);
    (priority.segmentedControl.statePriority as string[]).reverse();
    expect(validateNavigationComponentContracts(priority).valid).toBe(false);
    const extra = structuredClone(NAVIGATION_COMPONENT_CONTRACTS) as Record<
      string,
      unknown
    >;
    extra.dock = {};
    expect(validateNavigationComponentContracts(extra).errors).toContain(
      "contracts fields are not exact",
    );
  });
});

describe("Tabs behavior", () => {
  it("renders named tablist anatomy, exact relations, sizes, and native disabled state", () => {
    const { container } = render(
      <div>
        <Tabs
          label="Compact tabs"
          options={TAB_OPTIONS}
          size="compact"
          value="alpha"
          onValueChange={() => undefined}
        />
        <Tabs
          disabled
          label="Comfortable tabs"
          options={TAB_OPTIONS}
          value="gamma"
          onValueChange={() => undefined}
        />
      </div>,
    );
    const roots = container.querySelectorAll('[data-artemis-component="tabs"]');
    expect([...roots].map((root) => root.getAttribute("data-size"))).toEqual([
      "compact",
      "comfortable",
    ]);
    const compact = screen.getByRole("tablist", { name: "Compact tabs" });
    const tabs = within(compact).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("data-part"))).toEqual([
      "tab",
      "tab",
      "tab",
    ]);
    expect(tabs[0]).toHaveProperty("id", "alpha-tab");
    expect(tabs[0]!.getAttribute("aria-controls")).toBe("alpha-panel");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("tabindex")).toBe("0");
    expect(tabs[1]).toHaveProperty("disabled", true);
    expect(tabs[2]!.getAttribute("tabindex")).toBe("-1");
    expect(
      within(screen.getByRole("tablist", { name: "Comfortable tabs" }))
        .getAllByRole("tab")
        .every((tab) => (tab as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("uses LTR roving focus, skips disabled tabs, wraps, and selects once", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    function Example() {
      const [value, setValue] = useState<"alpha" | "blocked" | "gamma">(
        "alpha",
      );
      return (
        <Tabs
          label="Views"
          onValueChange={(next) => {
            changes(next);
            setValue(next);
          }}
          options={TAB_OPTIONS}
          value={value}
        />
      );
    }
    render(<Example />);
    screen.getByRole("tab", { name: "Alpha" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Gamma" }),
    );
    expect(changes).toHaveBeenLastCalledWith("gamma");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Alpha" }),
    );
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Gamma" }),
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Alpha" }),
    );
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Gamma" }),
    );
    expect(changes).toHaveBeenCalledTimes(5);
  });

  it("reverses horizontal arrows in RTL and ignores navigation during IME", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    function Example() {
      const [value, setValue] = useState<"alpha" | "blocked" | "gamma">(
        "alpha",
      );
      return (
        <div dir="rtl">
          <Tabs
            label="RTL views"
            onValueChange={(next) => {
              changes(next);
              setValue(next);
            }}
            options={TAB_OPTIONS}
            value={value}
          />
        </div>
      );
    }
    render(<Example />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowLeft", isComposing: true });
    expect(changes).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(alpha);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Gamma" }),
    );
    expect(changes).toHaveBeenCalledOnce();
  });

  it("updates uncontrolled selection and uses native Enter and Space exactly once", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(
      <Tabs
        defaultValue="alpha"
        label="Uncontrolled views"
        onValueChange={changes}
        options={TAB_OPTIONS}
      />,
    );
    const gamma = screen.getByRole("tab", { name: "Gamma" });
    gamma.focus();
    await user.keyboard("{Enter}");
    expect(gamma.getAttribute("aria-selected")).toBe("true");
    expect(changes).toHaveBeenCalledOnce();
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    alpha.focus();
    await user.keyboard(" ");
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(changes).toHaveBeenCalledTimes(2);
  });
});

describe("SegmentedControl behavior", () => {
  it("uses named group, pressed semantics, native tab order, and one callback", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    render(
      <SegmentedControl
        defaultValue="rich"
        label="Markdown view"
        onValueChange={changes}
        options={[
          { value: "rich", label: "Rich" },
          { value: "source", label: "Source" },
        ]}
        size="compact"
      />,
    );
    const group = screen.getByRole("group", { name: "Markdown view" });
    expect(group.getAttribute("data-size")).toBe("compact");
    const rich = within(group).getByRole("button", { name: "Rich" });
    const source = within(group).getByRole("button", { name: "Source" });
    expect(rich.getAttribute("aria-pressed")).toBe("true");
    expect(rich.getAttribute("tabindex")).toBeNull();
    source.focus();
    await user.keyboard("{Enter}");
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(changes).toHaveBeenCalledOnce();
    rich.focus();
    await user.keyboard(" ");
    expect(rich.getAttribute("aria-pressed")).toBe("true");
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("preserves one callback when an already selected option is activated", async () => {
    const user = userEvent.setup();
    const tabChanges = vi.fn();
    const segmentChanges = vi.fn();
    render(
      <div>
        <Tabs
          label="Current tab"
          onValueChange={tabChanges}
          options={TAB_OPTIONS}
          value="alpha"
        />
        <SegmentedControl
          label="Current segment"
          onValueChange={segmentChanges}
          options={[
            { value: "rich", label: "Rich" },
            { value: "source", label: "Source" },
          ]}
          value="rich"
        />
      </div>,
    );
    await user.click(screen.getByRole("tab", { name: "Alpha" }));
    await user.click(screen.getByRole("button", { name: "Rich" }));
    expect(tabChanges).toHaveBeenCalledOnce();
    expect(tabChanges).toHaveBeenCalledWith("alpha");
    expect(segmentChanges).toHaveBeenCalledOnce();
    expect(segmentChanges).toHaveBeenCalledWith("rich");
  });
});

describe("Navigation validation boundaries", () => {
  it("rejects non-perceptible names, invalid options, ids, and selections before DOM or SSR", () => {
    expect(() =>
      render(
        <SegmentedControl
          label={"\u200B"}
          options={[{ value: "one", label: "One" }]}
          value="one"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(
        <SegmentedControl
          label="Modes"
          options={[
            { value: "one", label: "Same" },
            { value: "two", label: " SAME\u2060 " },
          ]}
          value="one"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_OPTION_ERROR);
    expect(() =>
      render(
        <SegmentedControl<string>
          label="Modes"
          options={[]}
          value="missing"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_OPTION_ERROR);
    expect(() =>
      render(
        <Tabs
          label="Views"
          options={[
            { id: "bad id", label: "One", panelId: "panel", value: "one" },
          ]}
          value="one"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_TAB_RELATION_ERROR);
    expect(() =>
      renderToString(
        <Tabs
          label="Views"
          options={TAB_OPTIONS}
          value="blocked"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_SELECTION_ERROR);
  });

  it("rejects dual values and controlled-mode drift", () => {
    expect(() =>
      render(
        <SegmentedControl
          defaultValue="one"
          label="Dual"
          options={[{ value: "one", label: "One" }]}
          value="one"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_CONTROL_BOUNDARY_ERROR);
    const { rerender } = render(
      <SegmentedControl
        defaultValue="one"
        label="Stable"
        options={[{ value: "one", label: "One" }]}
      />,
    );
    expect(() =>
      rerender(
        <SegmentedControl
          label="Stable"
          options={[{ value: "one", label: "One" }]}
          value="one"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(NAVIGATION_CONTROL_BOUNDARY_ERROR);
  });
});
