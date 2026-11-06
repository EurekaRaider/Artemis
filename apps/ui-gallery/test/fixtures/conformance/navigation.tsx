import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";
import { SegmentedControl, Tabs } from "@artemis/ui/navigation";

export const navigationCases = {
  "navigation-anatomy"() {
    const { container } = render(
      <div>
        <Tabs
          label="Matrix tabs"
          onValueChange={() => undefined}
          options={[
            {
              id: "matrix-one-tab",
              label: "One",
              panelId: "matrix-one-panel",
              value: "one",
            },
            {
              disabled: true,
              id: "matrix-two-tab",
              label: "Two",
              panelId: "matrix-two-panel",
              value: "two",
            },
          ]}
          value="one"
        />
        <div
          aria-labelledby="matrix-one-tab"
          id="matrix-one-panel"
          role="tabpanel"
        >
          One panel
        </div>
        <div
          aria-labelledby="matrix-two-tab"
          hidden
          id="matrix-two-panel"
          role="tabpanel"
        >
          Two panel
        </div>
        <SegmentedControl
          label="Matrix segmented"
          onValueChange={() => undefined}
          options={[
            { label: "Rich", value: "rich" },
            { label: "Source", value: "source" },
          ]}
          size="compact"
          value="rich"
        />
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual(["tabs", "segmented-control"]);
    const tabs = within(
      screen.getByRole("tablist", { name: "Matrix tabs" }),
    ).getAllByRole("tab");
    expect(tabs[0]!.getAttribute("aria-controls")).toBe("matrix-one-panel");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("tabindex")).toBe("0");
    expect(tabs[1]).toHaveProperty("disabled", true);
    const segments = within(
      screen.getByRole("group", { name: "Matrix segmented" }),
    ).getAllByRole("button");
    expect(
      segments.map((segment) => segment.getAttribute("aria-pressed")),
    ).toEqual(["true", "false"]);
  },
  async "navigation-events"() {
    const user = userEvent.setup();
    const onTab = vi.fn();
    const onSegment = vi.fn();
    function MatrixNavigationExample() {
      const [tab, setTab] = useState<"one" | "two">("one");
      return (
        <div dir="rtl">
          <Tabs
            label="Matrix RTL tabs"
            onValueChange={(value) => {
              onTab(value);
              setTab(value);
            }}
            options={[
              {
                id: "matrix-rtl-one-tab",
                label: "One",
                panelId: "matrix-rtl-one-panel",
                value: "one",
              },
              {
                id: "matrix-rtl-two-tab",
                label: "Two",
                panelId: "matrix-rtl-two-panel",
                value: "two",
              },
            ]}
            value={tab}
          />
          {(["one", "two"] as const).map((value) => (
            <div
              aria-labelledby={`matrix-rtl-${value}-tab`}
              hidden={tab !== value}
              id={`matrix-rtl-${value}-panel`}
              key={value}
              role="tabpanel"
            >
              {value} panel
            </div>
          ))}
          <SegmentedControl
            defaultValue="rich"
            label="Matrix mode"
            onValueChange={onSegment}
            options={[
              { label: "Rich", value: "rich" },
              { label: "Source", value: "source" },
            ]}
          />
        </div>
      );
    }
    render(<MatrixNavigationExample />);
    const one = screen.getByRole("tab", { name: "One" });
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowLeft", isComposing: true });
    expect(onTab).not.toHaveBeenCalled();
    await user.keyboard("{ArrowLeft}");
    expect(onTab).toHaveBeenCalledOnce();
    expect(onTab).toHaveBeenCalledWith("two");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Two" }),
    );
    expect(
      screen.getByRole("tabpanel", { name: "Two" }).getAttribute("hidden"),
    ).toBeNull();
    const source = screen.getByRole("button", { name: "Source" });
    source.focus();
    await user.keyboard(" ");
    expect(onSegment).toHaveBeenCalledOnce();
    expect(source.getAttribute("aria-pressed")).toBe("true");
  },
};
