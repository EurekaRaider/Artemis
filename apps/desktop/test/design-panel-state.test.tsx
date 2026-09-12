// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesignPanelState } from "@artemis/protocol";
import { DesignPanel } from "../src/renderer/DesignPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

it("does not carry a pending action or its late result into another task", async () => {
  let finish!: (state: DesignPanelState) => void;
  const pending = new Promise<DesignPanelState>((resolve) => {
    finish = resolve;
  });
  const empty: DesignPanelState = {
    workflow: "code",
    documents: [],
    requests: [],
  };
  const action = vi.fn(() => pending);
  stubWindowArtemis({
    getDesignState: vi.fn(async () => empty),
    designAction: action,
  });
  const props = {
    mode: "execute" as const,
    active: true,
    onConversation: vi.fn(),
  };
  const view = render(<DesignPanel {...props} threadId="a" />);
  fireEvent.click(await screen.findByRole("button", { name: "进入设计" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(
    (screen.getByRole("button", { name: "进入设计" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(<DesignPanel {...props} threadId="b" />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "进入设计" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await act(async () => {
    finish({ ...empty, workflow: "design" });
    await pending;
  });
  expect(screen.queryByRole("button", { name: "返回代码" })).toBeNull();
});
