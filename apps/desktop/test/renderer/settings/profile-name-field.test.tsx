// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../fixtures/renderer-test-utils.js";

import { ProfileNameField } from "../../../src/renderer/settings/ProfileNameField.js";

function renderField(savedName?: string) {
  const onCommit = vi.fn();
  const view = render(
    <ProfileNameField
      defaultName="williamji"
      disabled={false}
      label="What to call you"
      onCommit={onCommit}
      savedName={savedName}
    />,
  );
  const input = screen.getByLabelText("What to call you") as HTMLInputElement;
  return { input, onCommit, view };
}

describe("profile name field", () => {
  it("shows the system user name until a name is saved", () => {
    const { input } = renderField();
    expect(input.value).toBe("williamji");
    expect(input.placeholder).toBe("williamji");
    expect(input.maxLength).toBe(40);
  });

  it("saves a trimmed, single-spaced name on Enter", async () => {
    const { input, onCommit } = renderField();
    await userEvent.clear(input);
    await userEvent.type(input, "  William   Ji {Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("William Ji");
    expect(input.value).toBe("William Ji");
  });

  it("saves on blur and ignores an unchanged name", async () => {
    const { input, onCommit } = renderField("小明");
    await userEvent.click(input);
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.type(input, "同学");
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("小明同学");
  });

  it.each(["", "williamji"])(
    "clears the saved name when the field is %j",
    async (typed) => {
      const { input, onCommit } = renderField("小明");
      await userEvent.clear(input);
      if (typed) await userEvent.type(input, typed);
      await userEvent.type(input, "{Enter}");
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(input.value).toBe("williamji");
    },
  );

  it("restores the default without saving when nothing was saved", async () => {
    const { input, onCommit } = renderField();
    await userEvent.clear(input);
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("williamji");
  });

  it("follows a name saved elsewhere", () => {
    const { input, view } = renderField();
    view.rerender(
      <ProfileNameField
        defaultName="williamji"
        disabled={false}
        label="What to call you"
        onCommit={() => {}}
        savedName="Ada"
      />,
    );
    expect(input.value).toBe("Ada");
  });
});
