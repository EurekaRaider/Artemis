import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import {
  Checkbox,
  SearchField,
  Select,
  Switch,
  TextField,
} from "@artemis/ui/forms";

export const formsCases = {
  "form-anatomy"() {
    const { container } = render(
      <div>
        <TextField label="Text" defaultValue="value" />
        <SearchField label="Search" defaultValue="query" />
        <Select
          label="Select"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "One" }]}
          value="one"
        />
        <Checkbox label="Checkbox" defaultChecked />
        <Switch label="Switch" defaultChecked />
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-artemis-component"),
      ),
    ).toEqual(["text-field", "search-field", "select", "checkbox", "switch"]);
    expect(
      container
        .querySelector('[data-artemis-component="search-field"]')
        ?.querySelectorAll("[data-part]"),
    ).toHaveLength(3);
    expect(
      container
        .querySelector('[data-artemis-component="switch"]')
        ?.querySelector('[data-part="track"] > [data-part="thumb"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
  "form-states"() {
    const { container } = render(
      <div>
        <TextField label="Ready" defaultValue="ready" />
        <TextField
          label="Read only"
          readOnly
          value="fixed"
          onValueChange={() => undefined}
        />
        <TextField
          error="Invalid"
          label="Error"
          value="bad"
          onValueChange={() => undefined}
        />
        <TextField
          disabled
          error="Invalid"
          label="Disabled"
          value="bad"
          onValueChange={() => undefined}
        />
        <Select
          error="Invalid"
          label="Error select"
          onValueChange={() => undefined}
          options={[{ value: "one", label: "One" }]}
          value="one"
        />
        <Checkbox checked label="Checked" onCheckedChange={() => undefined} />
        <Checkbox
          checked
          error="Invalid"
          label="Error checkbox"
          onCheckedChange={() => undefined}
        />
        <Switch
          checked
          disabled
          error="Invalid"
          label="Disabled switch"
          onCheckedChange={() => undefined}
        />
      </div>,
    );
    expect(
      [...container.querySelectorAll("[data-artemis-component]")].map((node) =>
        node.getAttribute("data-state"),
      ),
    ).toEqual([
      "ready",
      "read-only",
      "error",
      "disabled",
      "error",
      "checked",
      "error",
      "disabled",
    ]);
  },
  async "form-events-ime"() {
    const user = userEvent.setup();
    const onText = vi.fn();
    const onSelect = vi.fn();
    const onChecked = vi.fn();
    render(
      <div>
        <TextField label="Text event" value="a" onValueChange={onText} />
        <Select
          label="Select event"
          onValueChange={onSelect}
          options={[
            { value: "one", label: "One" },
            { value: "disabled", label: "Disabled", disabled: true },
            { value: "two", label: "Two", searchText: "vision" },
          ]}
          searchPlaceholder="Search options"
          value="one"
        />
        <Switch
          checked={false}
          label="Switch event"
          onCheckedChange={onChecked}
        />
      </div>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Text event" }), {
      target: { value: "ab" },
    });
    expect(onText).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Select event One" }));
    const search = screen.getByRole("combobox", { name: "Search options" });
    fireEvent.change(search, { target: { value: "vision" } });
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("two");
    await user.click(screen.getByRole("switch", { name: "Switch event" }));
    expect(onChecked).toHaveBeenCalledOnce();
    expect(onChecked).toHaveBeenCalledWith(true);
  },
  "form-semantics"() {
    const { container } = render(
      <div dir="rtl">
        <SearchField
          label="Archive search"
          value=""
          onValueChange={() => undefined}
        />
        <TextField
          description="Description"
          error="Error"
          label="Described field"
          value="bad"
          onValueChange={() => undefined}
        />
        <Checkbox error="Required" label="Capability" />
        <Switch label="Enabled" defaultChecked />
      </div>,
    );
    const search = screen.getByRole("searchbox", { name: "Archive search" });
    const described = screen.getByRole("textbox", { name: "Described field" });
    expect(search.getAttribute("type")).toBe("search");
    expect(search.closest('[dir="rtl"]')).not.toBeNull();
    expect(described.getAttribute("aria-describedby")?.split(" ")).toHaveLength(
      2,
    );
    expect(described.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Capability" })).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Enabled" })).not.toBeNull();
    expect(
      container.querySelector(
        '[data-label-visibility="hidden"] [data-part="label"]',
      ),
    ).not.toBeNull();
  },
};
