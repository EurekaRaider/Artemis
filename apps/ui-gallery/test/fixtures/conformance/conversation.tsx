import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import {
  CONVERSATION_COMPONENT_CONTRACTS,
  ConversationEmptyState,
  ConversationMessage,
  ConversationSurface,
  QueuedMessageGroup,
  QueuedMessageItem,
  TimelineSurface,
  TimelineTurn,
  TimelineViewport,
  TurnChangeSummary,
  TurnExecutionDisclosure,
} from "@artemis/ui/conversation";
import { MatrixIcon } from "./shared.js";

export const conversationCases = {
  "conversation-anatomy"() {
    const { container } = render(
      <ConversationSurface label="Conversation">
        <TimelineViewport label="History">
          <TimelineSurface>
            <TimelineTurn state="running">
              <ConversationMessage kind="assistant">Reply</ConversationMessage>
              <ConversationEmptyState
                icon={<MatrixIcon />}
                label="No messages"
                title="Start a conversation"
              />
              <TurnExecutionDisclosure label="Worked" summary="Worked">
                Details
              </TurnExecutionDisclosure>
              <TurnChangeSummary
                header="One file changed"
                label="Changes"
                state="ready"
              >
                Details
              </TurnChangeSummary>
            </TimelineTurn>
          </TimelineSurface>
        </TimelineViewport>
        <QueuedMessageGroup heading="Queue" label="Queue">
          <QueuedMessageItem index={1}>Message</QueuedMessageItem>
        </QueuedMessageGroup>
      </ConversationSurface>,
    );
    for (const contract of Object.values(CONVERSATION_COMPONENT_CONTRACTS)) {
      const root = container.querySelector(
        `[data-artemis-component="${contract.name}"]`,
      );
      expect(root).not.toBeNull();
      const actualParts = new Set(
        [root!, ...root!.querySelectorAll("[data-part]")].map((node) =>
          node.getAttribute("data-part"),
        ),
      );
      for (const requiredPart of contract.parts) {
        expect(actualParts.has(requiredPart)).toBe(true);
      }
    }
  },
  "conversation-state-matrix"() {
    const { container } = render(
      <ConversationSurface label="Conversation states">
        <TimelineViewport label="History">
          <TimelineSurface>
            {(["running", "completed", "failed", "cancelled"] as const).map(
              (state) => (
                <TimelineTurn key={state} state={state}>
                  <ConversationMessage
                    kind={state === "running" ? "assistant" : "user"}
                    state={state === "running" ? "streaming" : "ready"}
                  >
                    {state}
                  </ConversationMessage>
                </TimelineTurn>
              ),
            )}
          </TimelineSurface>
        </TimelineViewport>
        <QueuedMessageGroup heading="Queue" label="Queue" state="failed">
          <QueuedMessageItem index={1} state="failed">
            Failed edit
          </QueuedMessageItem>
        </QueuedMessageGroup>
      </ConversationSurface>,
    );
    expect(
      [
        ...container.querySelectorAll(
          '[data-artemis-component="timeline-turn"]',
        ),
      ].map((node) => node.getAttribute("data-state")),
    ).toEqual(["running", "completed", "failed", "cancelled"]);
    expect(
      container.querySelector(
        '[data-artemis-component="conversation-message"][data-state="streaming"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-artemis-component="queued-message-group"][data-state="failed"]',
      ),
    ).not.toBeNull();
  },
  async "conversation-controlled-events"() {
    const user = userEvent.setup();
    const scroll = vi.fn();
    const wheel = vi.fn();
    const copy = vi.fn();
    const queueAction = vi.fn();
    render(
      <ConversationSurface label="Interactive conversation">
        <TimelineViewport label="History" onScroll={scroll} onWheel={wheel}>
          <TimelineSurface>
            <TimelineTurn state="completed">
              <ConversationMessage
                actions={
                  <button onClick={copy} type="button">
                    Copy
                  </button>
                }
                kind="assistant"
              >
                Reply
              </ConversationMessage>
              <TurnExecutionDisclosure label="Worked" summary="Worked">
                Details
              </TurnExecutionDisclosure>
            </TimelineTurn>
          </TimelineSurface>
        </TimelineViewport>
        <QueuedMessageGroup heading="Queue" label="Queue">
          <QueuedMessageItem
            actions={
              <button onClick={queueAction} type="button">
                Edit
              </button>
            }
            index={1}
          >
            Message
          </QueuedMessageItem>
        </QueuedMessageGroup>
      </ConversationSurface>,
    );
    const viewport = screen.getByRole("region", { name: "History" });
    fireEvent.scroll(viewport);
    fireEvent.wheel(viewport);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(scroll).toHaveBeenCalledOnce();
    expect(wheel).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(queueAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Details")).toBeNull();
    await user.click(screen.getByText("Worked"));
    expect(await screen.findByText("Details")).toBeTruthy();
  },
  "conversation-rtl-long-content"() {
    const longLabel =
      "محادثة طويلة جدا تظل مقروءة وتحافظ على ترتيب المحتوى والهندسة المنطقية من اليمين إلى اليسار";
    const { container } = render(
      <div dir="rtl">
        <ConversationSurface label={longLabel}>
          <TimelineViewport label={`سجل ${longLabel}`}>
            <TimelineSurface>
              <TimelineTurn state="cancelled">
                <ConversationMessage kind="user">
                  {longLabel}
                </ConversationMessage>
                <ConversationMessage kind="assistant" state="failed">
                  {longLabel.repeat(12)}
                </ConversationMessage>
              </TimelineTurn>
            </TimelineSurface>
          </TimelineViewport>
        </ConversationSurface>
      </div>,
    );
    for (const root of container.querySelectorAll("[data-artemis-component]")) {
      expect(root.closest('[dir="rtl"]')).not.toBeNull();
    }
    expect(
      screen.getByRole("region", { name: `سجل ${longLabel}` }),
    ).toBeTruthy();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
};
