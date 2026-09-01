// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECK_CONTROL_STATE_PRIORITY,
  FIELD_STATE_PRIORITY,
  FORM_ACCESSIBLE_NAME_ERROR,
  FORM_COMPONENT_CONTRACTS,
  FORM_CONTROL_BOUNDARY_ERROR,
  FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR,
  FORM_SELECT_OPTION_ERROR,
  SELECT_STATE_PRIORITY,
  Checkbox,
  SearchField,
  Select,
  Switch,
  TextField,
  filterSelectOptions,
  validateFormComponentContracts,
} from "../src/forms.js";

const OPTIONS = [
  { value: "alpha", label: "Alpha model", searchText: "first reasoner" },
  { value: "blocked", label: "Blocked model", disabled: true },
  { value: "beta", label: "Beta model", searchText: "second vision" },
] as const;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Form component contracts", () => {
  it("deep-freezes exact anatomy, finite states, and priority", () => {
    expect(Object.isFrozen(FORM_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(FORM_COMPONENT_CONTRACTS.select.parts)).toBe(true);
    expect(FORM_COMPONENT_CONTRACTS.textField.parts).toEqual([
      "root",
      "label",
      "control",
    ]);
    expect(FORM_COMPONENT_CONTRACTS.searchField.parts).toEqual([
      "root",
      "label",
      "icon",
      "control",
    ]);
    expect(FORM_COMPONENT_CONTRACTS.select.parts).toEqual([
      "root",
      "label",
      "trigger",
      "value",
      "indicator",
      "menu",
      "listbox",
      "option",
      "check",
    ]);
    expect(FORM_COMPONENT_CONTRACTS.checkbox.parts).toEqual([
      "root",
      "control",
      "indicator",
      "label",
    ]);
    expect(FORM_COMPONENT_CONTRACTS.switch.parts).toEqual([
      "root",
      "control",
      "track",
      "thumb",
      "label",
    ]);
    expect(FORM_COMPONENT_CONTRACTS.textField.statePriority).toEqual(
      FIELD_STATE_PRIORITY,
    );
    expect(FORM_COMPONENT_CONTRACTS.select.statePriority).toEqual(
      SELECT_STATE_PRIORITY,
    );
    expect(FORM_COMPONENT_CONTRACTS.switch.statePriority).toEqual(
      CHECK_CONTROL_STATE_PRIORITY,
    );
  });

  it("rejects anatomy, priority, and unreviewed field drift", () => {
    expect(validateFormComponentContracts(FORM_COMPONENT_CONTRACTS)).toEqual({
      valid: true,
      errors: [],
    });
    const anatomy = structuredClone(FORM_COMPONENT_CONTRACTS);
    (anatomy.select.parts as string[])[0] = "container";
    expect(validateFormComponentContracts(anatomy).errors).toContain(
      'contracts.select.parts[0] must equal "root"',
    );
    const priority = structuredClone(FORM_COMPONENT_CONTRACTS);
    (priority.switch.statePriority as string[]).reverse();
    expect(validateFormComponentContracts(priority).valid).toBe(false);
    const extra = structuredClone(FORM_COMPONENT_CONTRACTS) as Record<
      string,
      unknown
    >;
    extra.dateField = {};
    expect(validateFormComponentContracts(extra).errors).toContain(
      "contracts fields are not exact",
    );
  });

  it("renders both frozen sizes for every public form component", () => {
    const { container } = render(
      <div>
        {(["compact", "comfortable"] as const).flatMap((size) => [
          <TextField key={`text-${size}`} label={`Text ${size}`} size={size} />,
          <SearchField
            key={`search-${size}`}
            label={`Search ${size}`}
            size={size}
          />,
          <Select
            key={`select-${size}`}
            label={`Select ${size}`}
            onValueChange={() => undefined}
            options={[{ value: "one", label: "One" }]}
            size={size}
            value="one"
          />,
          <Checkbox
            key={`checkbox-${size}`}
            label={`Checkbox ${size}`}
            size={size}
          />,
          <Switch
            key={`switch-${size}`}
            label={`Switch ${size}`}
            size={size}
          />,
        ])}
      </div>,
    );
    for (const component of [
      "text-field",
      "search-field",
      "select",
      "checkbox",
      "switch",
    ]) {
      expect(
        [
          ...container.querySelectorAll(
            `[data-artemis-component="${component}"]`,
          ),
        ].map((root) => root.getAttribute("data-size")),
      ).toEqual(["compact", "comfortable"]);
    }
  });
});

describe("Perceptible error messages", () => {
  it("rejects empty or ignorable errors before DOM and SSR output", () => {
    expect(() =>
      render(
        <TextField
          error=""
          label="Text"
          value="bad"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR);
    expect(() =>
      renderToString(
        <SearchField
          error={"\u200B"}
          label="Search"
          value="bad"
          onValueChange={() => undefined}
        />,
      ),
    ).toThrowError(FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR);
    expect(() =>
      render(
        <Select
          error=" "
          label="Select"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "One" }]}
          value="one"
        />,
      ),
    ).toThrowError(FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR);
    expect(() =>
      renderToString(<Checkbox error={"\u2060"} label="Checkbox" />),
    ).toThrowError(FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR);
    expect(() => render(<Switch error="" label="Switch" />)).toThrowError(
      FORM_PERCEPTIBLE_ERROR_MESSAGE_ERROR,
    );
  });
});

describe("TextField and SearchField", () => {
  it("keeps label, description, error, finite input type, and state relations", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <TextField
        description="Between 1 and 10"
        error="Out of range"
        label="Context length"
        max={10}
        min={1}
        onValueChange={onValueChange}
        step={1}
        type="number"
        value="20"
      />,
    );
    const field = screen.getByRole("spinbutton", { name: "Context length" });
    const root = field.closest('[data-artemis-component="text-field"]');
    expect(root?.getAttribute("data-state")).toBe("error");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    fireEvent.change(field, { target: { value: "7" } });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("7");

    rerender(
      <TextField
        disabled
        error="Out of range"
        label="Context length"
        onValueChange={onValueChange}
        readOnly
        value="20"
      />,
    );
    expect(
      screen
        .getByRole("textbox", { name: "Context length" })
        .closest('[data-artemis-component="text-field"]')
        ?.getAttribute("data-state"),
    ).toBe("disabled");
  });

  it("supports uncontrolled text, hidden labels, and native search semantics", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <SearchField
        defaultValue="start"
        label="Search archive"
        onValueChange={onValueChange}
        placeholder="Find a task"
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Search archive" });
    expect(search.getAttribute("type")).toBe("search");
    expect(
      container
        .querySelector('[data-artemis-component="search-field"]')
        ?.getAttribute("data-label-visibility"),
    ).toBe("hidden");
    expect(
      container
        .querySelector('[data-part="icon"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    await user.clear(search);
    await user.type(search, "IME 搜索");
    expect((search as HTMLInputElement).value).toBe("IME 搜索");
    expect(onValueChange).toHaveBeenCalled();
  });

  it("rejects empty names, dual values, and controlled-mode drift in DOM and SSR", () => {
    expect(() =>
      render(<TextField defaultValue="x" label={"\u200B"} />),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(<SearchField defaultValue="x" label="  " />),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(
        <TextField
          defaultValue="x"
          label="Dual"
          onValueChange={() => undefined}
          value="y"
        />,
      ),
    ).toThrowError(FORM_CONTROL_BOUNDARY_ERROR);

    const { rerender } = render(<TextField defaultValue="x" label="Stable" />);
    expect(() =>
      rerender(
        <TextField label="Stable" onValueChange={() => undefined} value="x" />,
      ),
    ).toThrowError(FORM_CONTROL_BOUNDARY_ERROR);
  });
});

describe("Select", () => {
  it("filters normalized terms with substring and ordered fuzzy matching", () => {
    expect(
      filterSelectOptions(OPTIONS, "REASONER").map(({ value }) => value),
    ).toEqual(["alpha"]);
    expect(
      filterSelectOptions(OPTIONS, "scnd vsn").map(({ value }) => value),
    ).toEqual(["beta"]);
    expect(filterSelectOptions(OPTIONS, "not present")).toEqual([]);
  });

  it("renders stable listbox anatomy and selects once with keyboard", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        label="Model"
        onValueChange={onValueChange}
        options={OPTIONS}
        value="alpha"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Model Alpha model" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const listbox = screen.getByRole("listbox", { name: "Model" });
    expect(listbox).toBeTruthy();
    expect(
      trigger
        .closest('[data-artemis-component="select"]')
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(
      screen
        .getByRole("option", { name: "Blocked model" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("beta");
    expect(document.activeElement).toBe(trigger);
  });

  it("searches, preserves IME Enter, then commits after composition", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        label="Model"
        onValueChange={onValueChange}
        options={OPTIONS}
        searchPlaceholder="Search models"
        value="alpha"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Model Alpha model" }));
    const search = screen.getByRole("combobox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "vision" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("beta");

    await user.click(screen.getByRole("button", { name: "Model Alpha model" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("keeps Space as search input instead of selecting the active option", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        label="Model"
        onValueChange={onValueChange}
        options={OPTIONS}
        searchPlaceholder="Search models"
        value="alpha"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Model Alpha model" }));
    const search = screen.getByRole("combobox", { name: "Search models" });
    await user.type(search, "second ");
    expect((search as HTMLInputElement).value).toBe("second ");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("clears an empty search after outside dismissal so the trigger remains usable", async () => {
    const user = userEvent.setup();
    render(
      <Select
        label="Model"
        onValueChange={() => undefined}
        options={OPTIONS}
        searchPlaceholder="Search models"
        value="alpha"
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Model Alpha model",
    });
    await user.click(trigger);
    fireEvent.change(screen.getByRole("combobox", { name: "Search models" }), {
      target: { value: "not present" },
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      trigger
        .closest('[data-artemis-component="select"]')
        ?.getAttribute("data-state"),
    ).toBe("open");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    await user.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("closes on Escape, exposes error text, and blocks disabled selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Select
        error="Choose a supported model"
        label="Model"
        onValueChange={onValueChange}
        options={OPTIONS}
        value="alpha"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Model Alpha model" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    rerender(
      <Select
        disabled
        error="Choose a supported model"
        label="Model"
        onValueChange={onValueChange}
        options={OPTIONS}
        value="alpha"
      />,
    );
    expect(
      trigger
        .closest('[data-artemis-component="select"]')
        ?.getAttribute("data-state"),
    ).toBe("disabled");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("uses effective disabled state for empty and all-disabled option sets", () => {
    const { container, rerender } = render(
      <Select<string>
        label="Empty model list"
        onValueChange={() => undefined}
        options={[]}
        value="missing"
      />,
    );
    const root = container.querySelector('[data-artemis-component="select"]');
    const trigger = screen.getByRole("button", {
      name: "Empty model list missing",
    }) as HTMLButtonElement;
    expect(root?.getAttribute("data-state")).toBe("disabled");
    expect(trigger.disabled).toBe(true);

    rerender(
      <Select
        label="Empty model list"
        onValueChange={() => undefined}
        options={[{ value: "blocked", label: "Blocked", disabled: true }]}
        value="blocked"
      />,
    );
    expect(root?.getAttribute("data-state")).toBe("disabled");
    expect(trigger.disabled).toBe(true);
    expect(
      renderToString(
        <Select<string>
          label="SSR empty"
          onValueChange={() => undefined}
          options={[]}
          value="missing"
        />,
      ),
    ).toContain('data-state="disabled"');
  });

  it("keeps keyboard navigation inside the listbox scroll viewport", async () => {
    const user = userEvent.setup();
    render(
      <Select
        label="Long model list"
        onValueChange={() => undefined}
        options={Array.from({ length: 8 }, (_, index) => ({
          value: `model-${index}`,
          label: `Model ${index}`,
        }))}
        value="model-0"
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Long model list Model 0",
    });
    await user.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Long model list" });
    const finalOption = screen.getByRole("option", { name: "Model 7" });
    listbox.getBoundingClientRect = () => ({ bottom: 100, top: 0 }) as DOMRect;
    finalOption.getBoundingClientRect = () =>
      ({ bottom: 150, top: 120 }) as DOMRect;
    await user.keyboard("{End}");
    expect(listbox.scrollTop).toBe(50);
  });

  it("rejects non-perceptible labels before DOM or SSR output", () => {
    expect(() =>
      render(
        <Select
          label={"\u2060"}
          onValueChange={() => undefined}
          options={OPTIONS}
          value="alpha"
        />,
      ),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);

    expect(() =>
      render(
        <Select
          label="Model"
          onValueChange={() => undefined}
          options={OPTIONS}
          searchPlaceholder={"\u2060"}
          value="alpha"
        />,
      ),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(
        <Select
          label=" "
          onValueChange={() => undefined}
          options={OPTIONS}
          value="alpha"
        />,
      ),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
  });

  it("rejects empty or perceptually duplicate labels and duplicate values", () => {
    expect(() =>
      render(
        <Select
          label="Model"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "\u200B" }]}
          value="one"
        />,
      ),
    ).toThrowError(FORM_SELECT_OPTION_ERROR);
    expect(() =>
      render(
        <Select
          label="Model"
          onValueChange={() => undefined}
          options={[
            { value: "one", label: "Same model" },
            { value: "two", label: "  SAME\u2060 model  " },
          ]}
          value="one"
        />,
      ),
    ).toThrowError(FORM_SELECT_OPTION_ERROR);
    expect(() =>
      renderToString(
        <Select
          label="Model"
          onValueChange={() => undefined}
          options={[
            { value: "one", label: "Invisible\u200Bjoin" },
            { value: "two", label: "invisiblejoin" },
          ]}
          value="one"
        />,
      ),
    ).toThrowError(FORM_SELECT_OPTION_ERROR);
    expect(() =>
      renderToString(
        <Select
          label="Model"
          onValueChange={() => undefined}
          options={[
            { value: "one", label: "One" },
            { value: "one", label: "Duplicate" },
          ]}
          value="one"
        />,
      ),
    ).toThrowError(FORM_SELECT_OPTION_ERROR);
  });
});

describe("Checkbox and Switch", () => {
  it("uses native semantics, one callback, and checked state for controlled controls", async () => {
    const user = userEvent.setup();
    const onCheckbox = vi.fn();
    const onSwitch = vi.fn();
    const { container } = render(
      <div dir="rtl">
        <Checkbox
          checked={false}
          label="Reasoning model"
          onCheckedChange={onCheckbox}
        />
        <Switch checked label="Enabled" onCheckedChange={onSwitch} />
      </div>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Reasoning model" });
    const toggle = screen.getByRole("switch", { name: "Enabled" });
    expect(checkbox.getAttribute("type")).toBe("checkbox");
    expect(toggle.getAttribute("type")).toBe("checkbox");
    expect(
      toggle
        .closest('[data-artemis-component="switch"]')
        ?.getAttribute("data-state"),
    ).toBe("checked");
    expect(
      container.querySelector('[data-part="track"] [data-part="thumb"]'),
    ).not.toBeNull();
    await user.click(checkbox);
    await user.click(toggle);
    expect(onCheckbox).toHaveBeenCalledOnce();
    expect(onCheckbox).toHaveBeenCalledWith(true);
    expect(onSwitch).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledWith(false);
  });

  it("updates uncontrolled anatomy and applies disabled over error over checked", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Checkbox defaultChecked={false} label="Capability" />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Capability" });
    await user.click(checkbox);
    expect(
      checkbox
        .closest('[data-artemis-component="checkbox"]')
        ?.getAttribute("data-state"),
    ).toBe("checked");
    expect(
      checkbox
        .closest('[data-artemis-component="checkbox"]')
        ?.querySelector('[data-part="indicator"]')?.textContent,
    ).toBe("✓");

    unmount();
    render(
      <Checkbox
        checked
        disabled
        error="Unavailable"
        label="Capability"
        onCheckedChange={() => undefined}
      />,
    );
    const disabledCheckbox = screen.getByRole("checkbox", {
      name: "Capability",
    });
    expect(
      disabledCheckbox
        .closest('[data-artemis-component="checkbox"]')
        ?.getAttribute("data-state"),
    ).toBe("disabled");
    expect(disabledCheckbox.getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects empty names and controlled/default boundary drift", () => {
    expect(() =>
      render(<Switch defaultChecked label={"\u200B"} />),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      renderToString(<Checkbox defaultChecked label=" " />),
    ).toThrowError(FORM_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(
        <Switch
          checked
          defaultChecked
          label="Dual"
          onCheckedChange={() => undefined}
        />,
      ),
    ).toThrowError(FORM_CONTROL_BOUNDARY_ERROR);

    const { rerender } = render(<Checkbox defaultChecked label="Stable" />);
    expect(() =>
      rerender(
        <Checkbox checked label="Stable" onCheckedChange={() => undefined} />,
      ),
    ).toThrowError(FORM_CONTROL_BOUNDARY_ERROR);
  });

  it("supports an ordinary controlled wrapper without duplicate updates", async () => {
    const user = userEvent.setup();
    const changes = vi.fn();
    function Example() {
      const [enabled, setEnabled] = useState(false);
      return (
        <Switch
          checked={enabled}
          label="Live switch"
          onCheckedChange={(next) => {
            changes(next);
            setEnabled(next);
          }}
        />
      );
    }
    render(<Example />);
    const toggle = screen.getByRole("switch", { name: "Live switch" });
    await user.keyboard("{Tab} ");
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(changes).toHaveBeenCalledOnce();
  });
});
