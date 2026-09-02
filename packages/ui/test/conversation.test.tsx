// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_ACCESSIBLE_NAME_ERROR,
  CONVERSATION_COMPONENT_CONTRACTS,
  CONVERSATION_COMPONENT_MUTABLE_TOKENS,
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
  validateConversationComponentContracts,
} from "../src/conversation.js";

afterEach(() => cleanup());

describe("Conversation component contracts", () => {
  it("freezes the exact conversation anatomy and ownership boundary", () => {
    expect(Object.isFrozen(CONVERSATION_COMPONENT_CONTRACTS)).toBe(true);
    expect(CONVERSATION_COMPONENT_CONTRACTS.conversationMessage.parts).toEqual([
      "root",
      "content",
    ]);
    expect(
      CONVERSATION_COMPONENT_CONTRACTS.timelineViewport.interaction,
    ).toContain("caller-owned-scroll-anchor-wheel-and-pointer-events");
    expect(CONVERSATION_COMPONENT_MUTABLE_TOKENS).toContain(
      "--artemis-typography-code-family",
    );
    expect(
      validateConversationComponentContracts(CONVERSATION_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
  });

  it("rejects additions to the reviewed contract", () => {
    const drift = structuredClone(CONVERSATION_COMPONENT_CONTRACTS);
    (drift.timeline.states as string[]).push("streaming");
    expect(validateConversationComponentContracts(drift).valid).toBe(false);
  });
});

describe("Conversation surfaces", () => {
  it("keeps scroll state and events caller-owned without remounting content", () => {
    const onScroll = vi.fn();
    const { rerender } = render(
      <ConversationSurface label="Conversation">
        <TimelineViewport label="Conversation history" onScroll={onScroll}>
          <TimelineSurface>
            <span>Entry</span>
          </TimelineSurface>
        </TimelineViewport>
      </ConversationSurface>,
    );
    const conversation = screen.getByRole("region", {
      name: "Conversation",
    });
    const viewport = screen.getByRole("region", {
      name: "Conversation history",
    });
    const entry = screen.getByText("Entry");
    fireEvent.scroll(viewport);
    expect(onScroll).toHaveBeenCalledTimes(1);
    rerender(
      <ConversationSurface label="Conversation" state="empty">
        <TimelineViewport label="Conversation history" onScroll={onScroll}>
          <TimelineSurface>
            <span>Entry</span>
          </TimelineSurface>
        </TimelineViewport>
      </ConversationSurface>,
    );
    expect(screen.getByText("Entry")).toBe(entry);
    expect(conversation.dataset.state).toBe("empty");
    expect(viewport.dataset.state).toBe("ready");
  });

  it("keeps author, actions, capabilities, and content structurally distinct", async () => {
    const user = userEvent.setup();
    const copy = vi.fn();
    render(
      <ConversationMessage
        actions={
          <button onClick={copy} type="button">
            Copy
          </button>
        }
        capabilities={<span>Execute</span>}
        kind="user"
      >
        Build the app
      </ConversationMessage>,
    );
    const message = screen.getByText("Build the app").closest("article")!;
    expect(message.dataset.artemisComponent).toBe("conversation-message");
    expect(message.dataset.messageKind).toBe("user");
    expect(message.querySelector('[data-part="actions"]')).toBeTruthy();
    expect(message.querySelector('[data-part="capabilities"]')).toBeTruthy();
    expect(message.querySelector('[data-part="content"]')).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("uses native turn and disclosure semantics", async () => {
    const user = userEvent.setup();
    render(
      <TimelineTurn state="completed">
        <TurnExecutionDisclosure label="Completed work" summary="Worked 12s">
          Tool output
        </TurnExecutionDisclosure>
        <TurnChangeSummary
          header={<strong>Edited two files</strong>}
          label="Edited two files"
          state="undone"
        >
          Changes undone
        </TurnChangeSummary>
      </TimelineTurn>,
    );
    const turn = screen.getByText("Worked 12s").closest("section")!;
    expect(turn.dataset.state).toBe("completed");
    const details = screen.getByText("Worked 12s").closest("details")!;
    expect(details.open).toBe(false);
    await user.click(screen.getByText("Worked 12s"));
    expect(details.open).toBe(true);
    expect(
      screen.getByRole("article", { name: "Edited two files" }).dataset.state,
    ).toBe("undone");
  });

  it("renders named empty and queued states with ordered items", () => {
    render(
      <>
        <ConversationEmptyState
          detail="Artemis"
          icon={<span>Mark</span>}
          label="Empty conversation"
          title="What should we build?"
        />
        <QueuedMessageGroup heading="Two queued" label="Two queued messages">
          <QueuedMessageItem actions={<button>Steer</button>} index={1}>
            First message
          </QueuedMessageItem>
        </QueuedMessageGroup>
      </>,
    );
    expect(screen.getByRole("status", { name: "Empty conversation" })).toBe(
      screen.getByText("What should we build?").parentElement,
    );
    const queue = screen.getByRole("status", { name: "Two queued messages" });
    expect(queue.querySelector("ol > li")?.textContent).toContain(
      "First message",
    );
    expect(queue.querySelector('[data-part="index"]')?.textContent).toBe("1");
  });

  it("rejects imperceptible landmark labels", () => {
    expect(() =>
      render(<ConversationSurface label=" ">Conversation</ConversationSurface>),
    ).toThrow(CONVERSATION_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(<TimelineViewport label={"\u200b"}>Timeline</TimelineViewport>),
    ).toThrow(CONVERSATION_ACCESSIBLE_NAME_ERROR);
  });
});
