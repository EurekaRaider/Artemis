// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ComputerPreviewState } from "@artemis/protocol";
import { ComputerPreview } from "../../../src/renderer/computer-use/ComputerPreview.js";
import { COMPUTER_PREVIEW_RESOURCES } from "../../../src/shared/i18n/computer-preview-resources.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

vi.mock("../../../src/renderer/computer-use/PreviewCanvas.js", () => ({
  PreviewCanvas: () => <canvas aria-label="Preview pixels" />,
}));

it.each(["desktop", "browser"] as const)(
  "opens the %s picture on click and closes only its preview",
  async (kind) => {
    const user = userEvent.setup();
    const copy = COMPUTER_PREVIEW_RESOURCES["zh-CN"];
    const state: ComputerPreviewState = {
      version: 1,
      sessionId: "preview-session",
      threadId: "task",
      target: { id: `${kind}:1`, kind, name: "Test app" },
      state: "live",
      timestamp: 0,
      sequence: 0,
      actualFps: 60,
    };
    let publish!: (values: ComputerPreviewState[]) => void;
    const command = vi.fn(async () => {}),
      control = vi.fn();
    stubWindowArtemis({
      getComputerPreviews: async () => [state],
      onComputerPreviews: (callback: typeof publish) => {
        publish = callback;
        return () => {};
      },
      onComputerPreviewExpand: () => () => {},
      computerPreview: command,
      controlComputer: control,
    });
    render(<ComputerPreview locale="zh-CN" threadId="task" />);
    const canvas = await screen.findByLabelText("Preview pixels");
    await user.click(canvas);
    if (kind === "desktop")
      expect(screen.getByRole("complementary")).toHaveClass(
        "computer-preview-expanded",
      );
    expect(command).toHaveBeenLastCalledWith({
      action: "expand",
      sessionId: state.sessionId,
    });
    const close = screen.getByRole("button", { name: copy.hide });
    expect(close.parentElement?.firstElementChild).toBe(close);
    await user.click(close);
    expect(command).toHaveBeenLastCalledWith({
      action: "hide",
      sessionId: state.sessionId,
    });
    act(() => publish([{ ...state, state: "hidden" }]));
    expect(screen.queryByLabelText("Preview pixels")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.show }));
    expect(command).toHaveBeenLastCalledWith({
      action: "show",
      sessionId: state.sessionId,
    });
    expect(control).not.toHaveBeenCalled();
  },
);
