// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  createThreadViewState,
  reduceAgentEvent,
  PROTOCOL_VERSION,
  type AgentEvent,
} from "@artemis/protocol";
import { Timeline } from "../../../src/renderer/app/App.js";
import "../../fixtures/renderer-test-utils.js";

afterEach(cleanup);

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
  const tooltip = await screen.findByRole("tooltip", { name: "复制消息" });
  expect(tooltip).toHaveAttribute("data-artemis-component", "tooltip");
  expect(copy).toHaveAttribute("aria-describedby", tooltip.id);
  await user.click(copy);
  expect(onCopyText).toHaveBeenCalledWith(state.userMessages.message!.text);
  await user.unhover(copy);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.blur(copy);
  fireEvent.focus(copy);
  expect(
    await screen.findByRole("tooltip", { name: "复制消息" }),
  ).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it.each(["completed", "cancelled", "failed"] as const)(
  "keeps the assistant answer and actual status visible after a %s turn",
  (status) => {
    const state = createThreadViewState("thread");
    state.turnOrder = ["turn"];
    state.order = ["user:user", "part:reply"];
    state.entryTurnIds = { "user:user": "turn", "part:reply": "turn" };
    state.userMessages = { user: { id: "user", text: "Continue this work" } };
    state.messageParts = {
      reply: { id: "reply", type: "text", text: "A useful partial answer" },
    };
    state.turns = {
      turn: { id: "turn", mode: "work", status, order: state.order },
    };
    const { container } = render(
      <Timeline
        installedPlugins={[]}
        installedSkills={[]}
        state={state}
        locale="en"
        onExternalLink={vi.fn()}
        onFileLink={vi.fn()}
        onFileLinkContextMenu={vi.fn()}
        onOpenChildAgent={vi.fn()}
        onOpenTurnReview={vi.fn()}
        onCopyText={vi.fn()}
        onEditUserMessage={vi.fn()}
        onResolve={vi.fn()}
        onResolveUserInput={vi.fn()}
        onUndoTurnChanges={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-artemis-component="timeline-turn"]'),
    ).toHaveAttribute("data-state", status);
    expect(
      container.querySelector(".work-record > summary > svg"),
    ).toHaveAttribute(
      "data-artemis-icon",
      status === "failed" ? "alert" : status === "cancelled" ? "stop" : "check",
    );
    expect(
      container.querySelector<HTMLDetailsElement>(".work-record")!.open,
    ).toBe(status === "failed");
    if (status === "cancelled") {
      expect(
        container.querySelector(".work-record > summary"),
      ).toHaveTextContent("Stopped");
    }
    expect(screen.getByText("A useful partial answer")).toBeVisible();
    expect(
      container.querySelector(".work-record .assistant-message"),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Copy message" }),
    ).toHaveLength(2);
  },
);

it("retains both cancelled questions inside the stopped work record", async () => {
  const user = userEvent.setup();
  const questions = ["Roll out to everyone?", "Announce the release?"];
  const payloads: AgentEvent["payload"][] = [
    { type: "turn.started", mode: "work" },
    {
      type: "user-input.requested",
      kind: "multi-question",
      requestId: "cancel-request",
      nonce: "cancel-request-nonce",
      header: "Release",
      questions: questions.map((question, index) => ({
        questionId: `c${index + 1}`,
        question,
        expiresAt: "2026-11-01T00:10:00Z",
        options: [
          { label: "Continue", description: "", recommended: true },
          { label: "Hold", description: "", recommended: false },
        ],
      })),
    },
    {
      type: "user-input.resolved",
      requestId: "cancel-request",
      nonce: "cancel-request-nonce",
      source: "cancelled",
    },
    { type: "turn.completed", reason: "cancelled" },
  ];
  const state = payloads.reduce(
    (current, payload, index) =>
      reduceAgentEvent(current, {
        protocolVersion: PROTOCOL_VERSION,
        eventId: `event-${index}`,
        threadId: "thread",
        turnId: "turn",
        seq: index + 1,
        timestamp: "2026-11-01T00:00:00Z",
        payload,
      }),
    createThreadViewState("thread"),
  );
  expect(state.userInputs["cancel-request"]?.status).toBe("cancelled");
  const onResolveUserInput = vi.fn();
  const { container } = render(
    <Timeline
      installedPlugins={[]}
      installedSkills={[]}
      state={state}
      locale="en"
      onExternalLink={vi.fn()}
      onFileLink={vi.fn()}
      onFileLinkContextMenu={vi.fn()}
      onOpenChildAgent={vi.fn()}
      onOpenTurnReview={vi.fn()}
      onCopyText={vi.fn()}
      onEditUserMessage={undefined}
      onResolve={vi.fn()}
      onResolveUserInput={onResolveUserInput}
      onUndoTurnChanges={vi.fn()}
    />,
  );
  const record = container.querySelector<HTMLDetailsElement>(".work-record")!;
  expect(record.open).toBe(false);
  expect(container.querySelector(".user-input-result")).toBeNull();
  await user.click(record.querySelector("summary")!);
  const result = container.querySelector<HTMLDetailsElement>(
    '.user-input-result[data-state="cancelled"]',
  )!;
  expect(record.open).toBe(true);
  expect(result).not.toBeNull();
  expect(result.open).toBe(false);
  await user.click(result.querySelector("summary")!);
  expect(result.open).toBe(true);
  for (const question of questions) {
    expect(screen.getByText(question)).toBeVisible();
  }
  expect(
    [...result.querySelectorAll(".decision-result-detail p")].map(
      (element) => element.textContent,
    ),
  ).toEqual(["Cancelled", "Cancelled"]);
  expect(result.querySelector("button, input, textarea")).toBeNull();
  expect(onResolveUserInput).not.toHaveBeenCalled();
});
