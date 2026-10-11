// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type AgentEvent,
  type AgentPayload,
} from "@artemis/protocol";
import { useComposerPrediction } from "../../../src/renderer/conversation/useComposerPrediction.js";
import "../../fixtures/renderer-test-utils.js";

let deliver: (event: AgentEvent) => void;
let seq = 0;
function event(
  payload: AgentPayload,
  threadId = "thread",
  turnId = "turn",
): AgentEvent {
  return {
    version: PROTOCOL_VERSION,
    eventId: `event-${seq}`,
    seq: seq++,
    timestamp: new Date().toISOString(),
    threadId,
    turnId,
    payload,
  };
}
function send(payload: AgentPayload, threadId?: string, turnId?: string) {
  act(() => deliver(event(payload, threadId, turnId)));
}
function start() {
  send({ type: "turn.started", mode: "work" });
}
function complete() {
  send({
    type: "turn.completed",
    reason: "completed",
    composerPrediction: "请补充测试。",
  });
}
function Harness({
  threadId = "thread",
  enabled = true,
  blocked = false,
  menu = false,
  submit = vi.fn(),
}) {
  const [draft, setDraft] = useState("");
  const prediction = useComposerPrediction(threadId, enabled, blocked, draft);
  deliver = prediction.receive;
  return (
    <form onSubmit={submit}>
      <textarea
        aria-label="Draft"
        value={draft}
        onChange={(e) => {
          prediction.changed(e.target.value);
          setDraft(e.target.value);
        }}
        onCompositionStart={prediction.compositionStart}
        onCompositionEnd={(e) =>
          prediction.compositionEnd(e.currentTarget.value)
        }
        onPaste={prediction.dismiss}
        onKeyDown={(e) => {
          if (!menu) prediction.keyDown(e, setDraft);
        }}
      />
      {prediction.text && <span role="status">{prediction.text}</span>}
    </form>
  );
}

describe("live composer predictions", () => {
  it("does not resurrect a dismissed prediction from a duplicated event batch", () => {
    render(<Harness />);
    const started = event({ type: "turn.started", mode: "work" });
    const finished = event({
      type: "turn.completed",
      reason: "completed",
      composerPrediction: "Next",
    });
    act(() => {
      deliver(started);
      deliver(finished);
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    act(() => {
      deliver(started);
      deliver(finished);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("arms when turn.started arrives before the submitted draft is cleared", () => {
    const view = renderHook(
      ({ draft }) => useComposerPrediction("thread", true, false, draft),
      { initialProps: { draft: "Submitted" } },
    );
    act(() =>
      view.result.current.receive(
        event({ type: "turn.started", mode: "work" }),
      ),
    );
    view.rerender({ draft: "" });
    act(() =>
      view.result.current.receive(
        event({
          type: "turn.completed",
          reason: "completed",
          composerPrediction: "请补充测试。",
        }),
      ),
    );
    expect(view.result.current.text).toBe("请补充测试。");
  });
  it("accepts the latest prediction after an edited draft is consumed as a mid-turn message", () => {
    const view = renderHook(
      ({ draft }) => useComposerPrediction("thread", true, false, draft),
      { initialProps: { draft: "" } },
    );
    act(() =>
      view.result.current.receive(
        event({ type: "turn.started", mode: "work" }),
      ),
    );
    view.rerender({ draft: "不是直接跑，我是想知道要怎么做" });
    act(() =>
      view.result.current.receive(
        event({
          type: "user.message",
          messageId: "supplement",
          text: "不是直接跑，我是想知道要怎么做",
        }),
      ),
    );
    view.rerender({ draft: "" });
    act(() =>
      view.result.current.receive(
        event({
          type: "turn.completed",
          reason: "completed",
          composerPrediction: "请详细解释第一步。",
        }),
      ),
    );
    expect(view.result.current.text).toBe("请详细解释第一步。");
  });
  it.each([false, true])(
    "keeps a fast completion behind the submitted draft and context block %s",
    (blocked) => {
      const view = renderHook(
        ({ draft }) => useComposerPrediction("thread", true, blocked, draft),
        { initialProps: { draft: "Submitted" } },
      );
      act(() => {
        view.result.current.receive(
          event({ type: "turn.started", mode: "work" }),
        );
        view.result.current.receive(
          event({
            type: "turn.completed",
            reason: "completed",
            composerPrediction: "Next",
          }),
        );
      });
      expect(view.result.current.text).toBeUndefined();
      view.rerender({ draft: "" });
      expect(view.result.current.text).toBe(blocked ? undefined : "Next");
    },
  );
  it("does not re-arm a settled turn from a late user message", () => {
    render(<Harness />);
    start();
    complete();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    send({ type: "user.message", messageId: "late", text: "Late message" });
    complete();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("only accepts with Tab and never sends or pre-populates a draft", () => {
    const submit = vi.fn();
    render(<Harness submit={submit} />);
    start();
    complete();
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("请补充测试。");
    expect(screen.queryByRole("status")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(["paste", "escape", "typing"])(
    "dismisses on %s, including late results",
    (action) => {
      render(<Harness />);
      start();
      complete();
      const input = screen.getByRole("textbox");
      if (action === "paste") fireEvent.paste(input);
      if (action === "escape") fireEvent.keyDown(input, { key: "Escape" });
      if (action === "typing")
        fireEvent.change(input, { target: { value: "Mine" } });
      complete();
      expect(screen.queryByRole("status")).toBeNull();
    },
  );
  it("never steals IME, modified Tab, or command-menu keys", () => {
    const view = render(<Harness />);
    start();
    complete();
    const input = screen.getByRole("textbox");
    for (const modifier of [
      { isComposing: true },
      { shiftKey: true },
      { ctrlKey: true },
    ])
      fireEvent.keyDown(input, { key: "Tab", ...modifier });
    expect(input).toHaveValue("");
    view.rerender(<Harness menu />);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("");
  });
  it("rejects history replay, switched threads, duplicate and stale completions", () => {
    const view = render(<Harness />);
    complete();
    expect(screen.queryByRole("status")).toBeNull();
    start();
    view.rerender(<Harness threadId="other" />);
    complete();
    view.rerender(<Harness />);
    complete();
    expect(screen.queryByRole("status")).toBeNull();
    start();
    complete();
    send({ type: "turn.started", mode: "work" }, "thread", "new-turn");
    complete();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("clears on disabling or blocked draft context and does not resurrect", () => {
    const view = render(<Harness />);
    start();
    complete();
    view.rerender(<Harness enabled={false} />);
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<Harness />);
    complete();
    expect(screen.queryByRole("status")).toBeNull();
    start();
    complete();
    view.rerender(<Harness blocked />);
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<Harness />);
    complete();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("preserves the suggestion through cancelled IME composition, without stealing Tab", () => {
    render(<Harness />);
    start();
    complete();
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("请补充测试。");
    fireEvent.change(input, { target: { value: "ni" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.compositionEnd(input);
    expect(screen.getByRole("status")).toHaveTextContent("请补充测试。");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("请补充测试。");
  });
  it("dismisses only when composition commits actual text", () => {
    render(<Harness />);
    start();
    complete();
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("retains a prediction arriving during uncommitted composition", () => {
    render(<Harness />);
    start();
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ni" } });
    complete();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.compositionEnd(input);
    expect(screen.getByRole("status")).toHaveTextContent("请补充测试。");
  });
});
