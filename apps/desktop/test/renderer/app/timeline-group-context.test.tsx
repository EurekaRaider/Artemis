// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createThreadViewState,
  reduceAgentEventBatch,
  PROTOCOL_VERSION,
  type AgentEvent,
  type ImGroupContext,
} from "@artemis/protocol";
import { Timeline } from "../../../src/renderer/app/App.js";
import "../../fixtures/renderer-test-utils.js";

vi.mock("../../../src/renderer/appearance/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
}));
afterEach(cleanup);
const events: AgentEvent[] = [
  {
    protocolVersion: PROTOCOL_VERSION,
    eventId: "user",
    threadId: "thread",
    seq: 1,
    timestamp: "2026-10-31T10:42:00Z",
    payload: {
      type: "user.message",
      messageId: "user",
      text: "Review the sources",
    },
  },
  {
    protocolVersion: PROTOCOL_VERSION,
    eventId: "part",
    threadId: "thread",
    seq: 2,
    timestamp: "2026-10-31T10:49:00Z",
    payload: {
      type: "message.part.delta",
      partId: "part",
      partType: "text",
      delta: "Shared summary",
    },
  },
];
const group: ImGroupContext = {
  spaceId: "team",
  name: "Research",
  confirmed: true,
  stale: false,
  executingDeviceId: "local",
  members: [
    {
      deviceId: "local",
      name: "Not a proven message author",
      deviceName: "Laptop",
      state: "online",
      identity: {
        channel: "feishu",
        userId: "member",
        connectionId: "feishu",
        appId: "bot",
        tenantId: "tenant",
      },
    },
  ],
};

it("shows message event times and the thread channel without inventing a member author", () => {
  const state = reduceAgentEventBatch(createThreadViewState("thread"), events);
  const props = {
    imGroup: group,
    imChannel: "slack",
    installedPlugins: [],
    installedSkills: [],
    state,
    locale: "en" as const,
    onExternalLink: vi.fn(),
    onFileLink: vi.fn(),
    onFileLinkContextMenu: vi.fn(),
    onOpenChildAgent: vi.fn(),
    onOpenTurnReview: vi.fn(),
    onCopyText: vi.fn(),
    onEditUserMessage: undefined,
    onResolve: vi.fn(),
    onResolveUserInput: vi.fn(),
    onUndoTurnChanges: vi.fn(),
  };
  const { container, rerender } = render(
    <Timeline {...props} events={events} />,
  );
  expect(screen.getByText("Member")).toBeVisible();
  expect(screen.getByText("slack")).toBeVisible();
  expect(screen.queryByText("Not a proven message author")).toBeNull();
  expect(
    [...container.querySelectorAll(".group-message-heading time")].map((node) =>
      node.getAttribute("datetime"),
    ),
  ).toEqual(events.map((event) => event.timestamp));
  rerender(<Timeline {...props} />);
  expect(container.querySelector(".group-message-heading time")).toBeNull();
});
