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
          path: "docs/audit.md",
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
    files: [
      {
        id: "file",
        path: "docs/audit.md",
        status: "modified",
        additions: 1,
        deletions: 0,
        binary: false,
        untracked: false,
        hunks: [
          {
            id: "hunk",
            header: "@@ -1 +1 @@",
            additions: 1,
            deletions: 0,
            lines: [
              { id: "line", kind: "addition", text: "Review this", newLine: 1 },
            ],
          },
        ],
      },
    ],
  }));
  const addReviewComment = vi.fn(
    async (input: {
      threadId: string;
      scope: string;
      lineId: string;
      body: string;
    }) => ({
      ...input,
      id: "comment",
      path: "docs/audit.md",
      kind: "addition",
      text: "Review this",
      newLine: 1,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const followUpTurn = vi.fn(async () => {});
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
    addReviewComment,
    followUpTurn,
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
    await screen.findByRole("button", { name: "Review docs/audit.md" }),
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
  const file = await screen.findByRole("button", { name: /^audit\.md/ });
  expect(file).toHaveAttribute("title", "docs/audit.md");
  expect(file.querySelector(".review-file-path")).toHaveTextContent(
    /^audit\.md$/,
  );
  const addedLine = document.querySelector('[data-line-id="line"]')!;
  expect(addedLine.querySelector('[data-side="old"]')).toBeEmptyDOMElement();
  expect(addedLine.querySelector('[data-side="new"]')).toHaveTextContent("1");
  expect(addedLine.querySelector('[data-part="marker"]')).toHaveTextContent(
    "+",
  );

  await act(async () => {
    receiveEvents([
      {
        protocolVersion: PROTOCOL_VERSION,
        eventId: "live-start",
        threadId: "thread",
        turnId: "live-turn",
        seq: 5,
        timestamp: now,
        payload: { type: "turn.started", mode: "work" },
      },
    ]);
  });
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      receiveEvents([
        {
          protocolVersion: PROTOCOL_VERSION,
          eventId: `live-${index}`,
          threadId: "thread",
          turnId: "live-turn",
          seq: 6 + index,
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
        seq: 9,
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
  fireEvent.click(
    await screen.findByRole("button", { name: "Unstaged", exact: true }),
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
        seq: 10,
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
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Add inline comment",
      exact: true,
    }),
  );
  fireEvent.change(screen.getByPlaceholderText("Write a review comment…"), {
    target: { value: "Explain this change" },
  });
  const composer =
    document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  fireEvent.change(composer, { target: { value: "Unsent draft" } });
  expect(
    screen.getByRole("button", { name: "Send to Artemis" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save comment" })).toBeEnabled();
  fireEvent.change(composer, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to Artemis" }));
  await waitFor(() =>
    expect(followUpTurn).toHaveBeenCalledWith({
      threadId: "thread",
      text: "docs/audit.md:1\n\nExplain this change",
    }),
  );
  expect(addReviewComment).toHaveBeenCalledOnce();
  expect(composer.value).toBe("");
});
