// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../../src/renderer/app/App.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type AgentPayload,
} from "@artemis/protocol";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { changeLanguage: vi.fn() } }),
}));
vi.mock("../../../src/renderer/appearance/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
  desktopSkinReady: Promise.resolve(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("keeps historical review stable during live output while preserving refresh and live scopes", async () => {
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("cancelIdleCallback", () => {});
  localStorage.setItem(
    "artemis-sidebar-open",
    JSON.stringify({ protocolVersion: 1, value: true }),
  );
  const now = "2026-10-13T00:00:00Z";
  const payloads: AgentPayload[] = [
    { type: "turn.started", mode: "work" },
    {
      type: "message.part.delta",
      partId: "answer",
      partType: "text",
      delta: "Done.",
    },
    {
      type: "turn.change-set.updated",
      status: "ready",
      undoAvailable: true,
      additions: 1,
      deletions: 0,
      files: [
        {
          path: "audit.md",
          status: "added",
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ],
    },
    { type: "turn.completed", reason: "completed", finalPartId: "answer" },
  ];
  const events = payloads.map((payload, seq) => ({
    protocolVersion: PROTOCOL_VERSION,
    eventId: `event-${seq}`,
    threadId: "thread",
    turnId: "turn",
    seq: seq + 1,
    timestamp: now,
    payload,
  })) as AgentEvent[];
  const getReviewDiff = vi.fn(async (query: { scope: string }) => ({
    available: true,
    scope: query.scope,
    text: "",
    files: [],
  }));
  const pending = new Promise(() => {});
  let receiveEvents!: (events: AgentEvent[]) => void;
  const handlers: Record<string, unknown> = {
    getSnapshot: async () => ({
      projects: [
        {
          id: "project",
          name: "Fixture",
          path: "/fixture",
          createdAt: now,
          updatedAt: now,
        },
      ],
      threads: [
        {
          id: "thread",
          projectId: "project",
          title: "Review fixture",
          mode: "work",
          target: "local",
          status: "idle",
          pinned: false,
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      worktrees: [],
      events: { thread: events },
      locale: "en",
      platform: "darwin",
      userName: "QA",
      sandbox: { available: true },
    }),
    getThreadHistory: undefined,
    getThreadEvents: async () => events,
    onAgentEvents: (receive: typeof receiveEvents) => {
      receiveEvents = receive;
      return () => {};
    },
    getReviewDiff,
    listReviewComments: async () => [],
    listInstalledSkills: async () => [],
    listArtemisPlugins: async () => [],
  };
  stubWindowArtemis(
    new Proxy(handlers, {
      get(target, key) {
        if (String(key) in target) return target[String(key)];
        if (String(key).startsWith("on")) return () => () => {};
        return () => pending;
      },
    }),
  );
  render(<App />);
  await screen.findAllByText("Review fixture");
  fireEvent.click(document.querySelector(".thread-title-copy")!);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review audit.md" }),
  );
  await waitFor(() =>
    expect(getReviewDiff).toHaveBeenCalledWith({
      threadId: "thread",
      scope: "turn",
      turnId: "turn",
    }),
  );
  expect(getReviewDiff.mock.calls.map(([query]) => query.scope)).toEqual([
    "turn",
  ]);
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      receiveEvents([
        {
          protocolVersion: PROTOCOL_VERSION,
          eventId: `live-${index}`,
          threadId: "thread",
          turnId: "live-turn",
          seq: 5 + index,
          timestamp: now,
          payload: {
            type: "message.part.delta",
            partId: "live-answer",
            partType: "text",
            delta: `Live response ${index}.`,
          },
        },
      ]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
  }
  expect(
    await screen.findByText("Live response 0.Live response 1.Live response 2."),
  ).toBeInTheDocument();
  expect(getReviewDiff).toHaveBeenCalledTimes(1);
  await act(async () => {
    receiveEvents([
      {
        protocolVersion: PROTOCOL_VERSION,
        eventId: "live-file",
        threadId: "thread",
        turnId: "live-turn",
        seq: 8,
        timestamp: now,
        payload: { type: "file.changed", path: "live.ts", operation: "update" },
      },
    ]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  expect(getReviewDiff).toHaveBeenCalledTimes(1);

  fireEvent.click(document.querySelector(".review-toolbar-action")!);
  await waitFor(() => expect(getReviewDiff).toHaveBeenCalledTimes(2));
  fireEvent.click(document.querySelector(".review-scope-select button")!);
  fireEvent.click(
    await screen.findByRole("option", { name: "Unstaged", exact: true }),
  );
  await waitFor(() =>
    expect(getReviewDiff).toHaveBeenLastCalledWith({
      threadId: "thread",
      scope: "unstaged",
    }),
  );
  const requestsBeforeLiveUpdate = getReviewDiff.mock.calls.length;
  await act(async () => {
    receiveEvents([
      {
        protocolVersion: PROTOCOL_VERSION,
        eventId: "live-unstaged",
        threadId: "thread",
        turnId: "live-turn",
        seq: 9,
        timestamp: now,
        payload: { type: "file.changed", path: "live.ts", operation: "update" },
      },
    ]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  await waitFor(() =>
    expect(getReviewDiff).toHaveBeenCalledTimes(requestsBeforeLiveUpdate + 1),
  );
  expect(getReviewDiff).toHaveBeenLastCalledWith({
    threadId: "thread",
    scope: "unstaged",
  });
});
