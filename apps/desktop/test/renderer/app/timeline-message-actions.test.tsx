// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  createThreadViewState,
  reduceAgentEvent,
  PROTOCOL_VERSION,
} from "@artemis/protocol";
import { Timeline } from "../../../src/renderer/app/App.js";
import "../../fixtures/renderer-test-utils.js";

vi.mock("../../../src/renderer/appearance/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
}));

it("uses the shared copy tooltip on hover and keyboard focus and copies the message", async () => {
  const user = userEvent.setup();
  const onCopyText = vi.fn().mockResolvedValue(undefined);
  const state = reduceAgentEvent(createThreadViewState("thread"), {
    protocolVersion: PROTOCOL_VERSION,
    eventId: "event",
    threadId: "thread",
    turnId: "turn",
    seq: 1,
    timestamp: "2026-10-03T00:00:00Z",
    payload: {
      type: "user.message",
      messageId: "message",
      text: "为什么数量这一列我无法手动修改？",
    },
  });
  render(
    <Timeline
      installedPlugins={[]}
      installedSkills={[]}
      state={state}
      locale="zh-CN"
      onExternalLink={vi.fn()}
      onFileLink={vi.fn()}
      onFileLinkContextMenu={vi.fn()}
      onOpenChildAgent={vi.fn()}
      onOpenTurnReview={vi.fn()}
      onCopyText={onCopyText}
      onEditUserMessage={undefined}
      onResolve={vi.fn()}
      onResolveUserInput={vi.fn()}
      onUndoTurnChanges={vi.fn()}
    />,
  );
  const copy = screen.getByRole("button", { name: "复制消息" });
  expect(copy).not.toHaveAttribute("title");
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.hover(copy);
  const tooltip = screen.getByRole("tooltip", { name: "复制消息" });
  expect(tooltip).toHaveAttribute("data-artemis-component", "tooltip");
  expect(copy).toHaveAttribute("aria-describedby", tooltip.id);
  await user.click(copy);
  expect(onCopyText).toHaveBeenCalledWith(state.userMessages.message!.text);
  await user.unhover(copy);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.blur(copy);
  fireEvent.focus(copy);
  expect(screen.getByRole("tooltip", { name: "复制消息" })).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
