// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import "../../fixtures/renderer-test-utils.js";
import { ModelCompatibilityFields } from "../../../src/renderer/settings/ModelCompatibilityFields.js";
afterEach(cleanup);
it("preserves unrelated JSON when explicitly disabling a Responses capability", async () => {
  const onChange = vi.fn();
  render(
    <ModelCompatibilityFields
      api="openai-responses"
      value={'{"samplingParams":{"temperature":0.2}}'}
      disabled={false}
      locale="en"
      onChange={onChange}
    />,
  );
  expect(screen.queryByLabelText("Developer role")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Output token limit Default" }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Disabled" }));
  expect(JSON.parse(onChange.mock.calls[0]![0])).toEqual({
    samplingParams: { temperature: 0.2 },
    compat: { supportsMaxOutputTokens: false },
  });
});
it("does not overwrite invalid JSON", () => {
  const onChange = vi.fn();
  const { container } = render(
    <ModelCompatibilityFields
      api="openai-completions"
      value="{"
      disabled={false}
      locale="en"
      onChange={onChange}
    />,
  );
  expect(container).toBeEmptyDOMElement();
  expect(onChange).not.toHaveBeenCalled();
});
