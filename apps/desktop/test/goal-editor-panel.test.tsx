// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Thread, ThreadGoal } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";

import "./renderer-test-utils.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { GoalEditorPanel } from "../src/renderer/GoalEditorPanel.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const goal = (changes: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: "thread-1",
  goalId: "goal-1",
  objective: "Ship the Goal UI",
  status: "active",
  revision: 3,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  ...changes,
});

type GoalApi = {
  getThreadGoalObjective: ReturnType<typeof vi.fn>;
  updateThreadGoalObjective: ReturnType<typeof vi.fn>;
};

function stubGoalApi(overrides: Partial<GoalApi> = {}): GoalApi {
  const api: GoalApi = {
    getThreadGoalObjective: vi.fn(async () => ({
      goalId: "goal-1",
      objective: "Loaded objective",
      revision: 3,
    })),
    updateThreadGoalObjective: vi.fn(
      async () =>
        ({
          goal: goal({ objective: "Saved objective", revision: 4 }),
        }) as unknown as Thread,
    ),
    ...overrides,
  };
  stubWindowArtemis(api as unknown as Record<string, unknown>);
  return api;
}

function renderPanel(changes: { goal?: ThreadGoal } = {}) {
  const onError = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <GoalEditorPanel
      clockMs={Date.parse("2026-08-28T00:01:00.000Z")}
      goal={changes.goal ?? goal()}
      locale="en"
      onError={onError}
      onSaved={onSaved}
    />,
  );
  return { ...utils, onError, onSaved };
}

const editorBox = () => screen.getByRole("textbox", { name: "Goal" });

describe("GoalEditorPanel interactions", () => {
  it("loads the objective into the editor", async () => {
    stubGoalApi();
    renderPanel();
    expect(await screen.findByRole("textbox", { name: "Goal" })).toHaveValue(
      "Loaded objective",
    );
  });

  it("shows an inline load error with retry and recovers", async () => {
    let attempts = 0;
    const api = stubGoalApi({
      getThreadGoalObjective: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk offline");
        return { goalId: "goal-1", objective: "Loaded objective", revision: 3 };
      }),
    });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load goal objective/i);
    expect(api.getThreadGoalObjective).toHaveBeenCalledTimes(1);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /retry loading/i }));
    expect(await screen.findByRole("textbox", { name: "Goal" })).toHaveValue(
      "Loaded objective",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns focus to the editor after a load retry succeeds", async () => {
    let attempts = 0;
    stubGoalApi({
      getThreadGoalObjective: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk offline");
        return { goalId: "goal-1", objective: "Loaded objective", revision: 3 };
      }),
    });
    renderPanel();
    await screen.findByRole("alert");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /retry loading/i }));
    await waitFor(() => expect(editorBox()).toHaveFocus());
  });

  it("goes dirty on edit and saves through the primary button", async () => {
    const api = stubGoalApi();
    const { onSaved } = renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();

    await userEvent.setup().type(box, " more");
    expect(save).toBeEnabled();

    await userEvent.setup().click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateThreadGoalObjective).toHaveBeenCalledWith(
      "thread-1",
      "Loaded objective more",
      "goal-1",
      3,
    );
    expect(await screen.findByText(/^saved$/i)).toBeInTheDocument();
  });

  it("clears the saved acknowledgement once the draft changes again", async () => {
    stubGoalApi();
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/^saved$/i)).toBeInTheDocument();
    await userEvent.setup().type(box, "!");
    expect(screen.queryByText(/^saved$/i)).not.toBeInTheDocument();
  });

  it("keeps the draft on save error and recovers via inline retry", async () => {
    let attempts = 0;
    stubGoalApi({
      updateThreadGoalObjective: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
        return {
          goal: goal({ objective: "Saved objective", revision: 4 }),
        } as unknown as Thread;
      }),
    });
    const { onSaved } = renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^save$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to save goal objective/i);
    expect(box).toHaveValue("Loaded objective more");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /retry saving/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).toHaveValue("Saved objective");
  });

  it("flags stale on a revision conflict and offers an in-panel reload", async () => {
    stubGoalApi({
      updateThreadGoalObjective: vi.fn(async () => {
        throw new Error("Goal changed while the editor was open");
      }),
    });
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^save$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/changed elsewhere/i);
    expect(
      screen.getByRole("button", { name: /^reload$/i }),
    ).toBeInTheDocument();
    expect(box).toHaveValue("Loaded objective more");
  });

  it("does not discard a dirty draft on stale reload without a second confirming click", async () => {
    stubGoalApi({
      getThreadGoalObjective: vi.fn(async () => ({
        goalId: "goal-1",
        objective: "Fresh objective",
        revision: 9,
      })),
      updateThreadGoalObjective: vi.fn(async () => {
        throw new Error("Goal changed while the editor was open");
      }),
    });
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByRole("alert");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^reload$/i }));
    expect(box).toHaveValue("Fresh objective more");

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: /discard changes and reload/i }),
      );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Goal" })).toHaveValue(
        "Fresh objective",
      ),
    );
  });

  it("reloads immediately from a clean stale state", async () => {
    const api = stubGoalApi({
      getThreadGoalObjective: vi.fn(async () => ({
        goalId: "goal-2",
        objective: "Other objective",
        revision: 1,
      })),
    });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/changed elsewhere/i);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^reload$/i }));
    expect(api.getThreadGoalObjective).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("saves with Meta+Enter and Ctrl+Enter", async () => {
    const api = stubGoalApi();
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(api.updateThreadGoalObjective).toHaveBeenCalledTimes(1),
    );

    await userEvent.setup().clear(box);
    await userEvent.setup().type(box, "Fresh objective again");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(api.updateThreadGoalObjective).toHaveBeenCalledTimes(2),
    );
  });

  it("does not trigger save during IME composition", async () => {
    const api = stubGoalApi();
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    await userEvent.setup().type(box, " more");

    fireEvent.keyDown(box, { key: "Enter", metaKey: true, isComposing: true });
    await userEvent.setup().type(box, "x");
    expect(api.updateThreadGoalObjective).not.toHaveBeenCalled();
  });

  it("does not trigger the shortcut when there is nothing to save", async () => {
    const api = stubGoalApi();
    renderPanel();
    const box = await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await userEvent.setup().type(box, "x");
    expect(api.updateThreadGoalObjective).not.toHaveBeenCalled();
  });

  it("sets aria-busy while loading and saving", async () => {
    let releaseSave!: (value: Thread) => void;
    const gate = new Promise<Thread>((resolvePromise) => {
      releaseSave = resolvePromise;
    });
    const loadGate = deferred<{
      goalId: string;
      objective: string;
      revision: number;
    }>();
    stubGoalApi({
      getThreadGoalObjective: vi.fn(() => loadGate.promise),
      updateThreadGoalObjective: vi.fn(() => gate),
    });
    const { container } = renderPanel();
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveAttribute("aria-busy", "true");

    loadGate.resolve({
      goalId: "goal-1",
      objective: "Loaded objective",
      revision: 3,
    });
    await screen.findByRole("textbox", { name: "Goal" });
    expect(panel).not.toHaveAttribute("aria-busy");

    await userEvent.setup().type(editorBox(), " more");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "true"));
    releaseSave({
      goal: goal({ objective: "Saved objective", revision: 4 }),
    } as unknown as Thread);
    await waitFor(() => expect(panel).not.toHaveAttribute("aria-busy"));
  });

  it("ignores a late-resolving load that a newer load already replaced", async () => {
    const first = deferred<{
      goalId: string;
      objective: string;
      revision: number;
    }>();
    const second = deferred<{
      goalId: string;
      objective: string;
      revision: number;
    }>();
    let attempts = 0;
    stubGoalApi({
      getThreadGoalObjective: vi.fn(() => {
        attempts += 1;
        return attempts === 1 ? first.promise : second.promise;
      }),
    });
    const { rerender } = renderPanel();

    second.resolve({
      goalId: "goal-1",
      objective: "Newest objective",
      revision: 5,
    });
    rerender(
      <GoalEditorPanel
        clockMs={Date.parse("2026-08-28T00:01:00.000Z")}
        goal={goal({ objective: "External objective" })}
        locale="en"
        onError={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(await screen.findByRole("textbox", { name: "Goal" })).toHaveValue(
      "Newest objective",
    );

    first.resolve({
      goalId: "goal-1",
      objective: "Stale objective",
      revision: 2,
    });
    await userEvent.setup().type(editorBox(), "!");
    expect(editorBox()).toHaveValue("Newest objective!");
  });
});

describe("stubWindowArtemis isolation (PR #103 review contract)", () => {
  it("removes the artemis own property when it did not exist before", () => {
    const target = window as unknown as Record<string, unknown>;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, "artemis");
    if (hadOwn) delete target.artemis;
    const restore = stubWindowArtemis({ getThreadGoalObjective: vi.fn() });
    expect(Object.prototype.hasOwnProperty.call(target, "artemis")).toBe(true);
    restore();
    expect("artemis" in window).toBe(hadOwn);
    expect(Object.prototype.hasOwnProperty.call(target, "artemis")).toBe(false);
  });

  it("nests and unwinds multiple installs without leaking", () => {
    stubWindowArtemis({ getThreadGoalObjective: vi.fn() });
    expect((window as unknown as { artemis?: unknown }).artemis).toEqual({
      getThreadGoalObjective: expect.any(Function),
    });
    const restoreSecond = stubWindowArtemis({
      updateThreadGoalObjective: vi.fn(),
    });
    expect((window as unknown as { artemis?: unknown }).artemis).toEqual({
      updateThreadGoalObjective: expect.any(Function),
    });
    restoreSecond();
    expect((window as unknown as { artemis?: unknown }).artemis).toEqual({
      getThreadGoalObjective: expect.any(Function),
    });
    // The first stub is reclaimed by the shared afterEach even though this
    // test never calls its restore function.
  });
});
