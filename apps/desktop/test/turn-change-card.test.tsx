// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TurnViewState } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";
import "./renderer-test-utils.js";
import { TurnChangeSetCard } from "../src/renderer/App.js";

vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({}));

const turn: TurnViewState = {
  id: "turn-1",
  mode: "execute",
  status: "completed",
  order: [],
  changeSet: {
    status: "ready",
    undoAvailable: true,
    additions: 260,
    deletions: 0,
    files: [
      {
        path: ".artemis/MEMORY.md",
        status: "modified",
        additions: 5,
        deletions: 0,
        binary: false,
      },
      {
        path: "AI_HANDOFF_V2.md",
        status: "added",
        additions: 255,
        deletions: 0,
        binary: false,
      },
    ],
  },
};

describe("compact turn changes", () => {
  it("keeps summary totals inline and routes keyboard review and undo to this turn", async () => {
    const onReview = vi.fn(),
      onUndo = vi.fn();
    const { container } = render(
      <TurnChangeSetCard
        locale="zh-CN"
        turn={turn}
        undoEnabled
        onReview={onReview}
        onUndo={onUndo}
      />,
    );
    const card = screen.getByRole("article", { name: "已编辑 2 个文件" });
    expect(card).toHaveAttribute("aria-description", "任务期间的工作区变化");
    expect(screen.queryByText("任务期间的工作区变化")).toBeNull();
    expect(
      container.querySelector(".turn-change-heading .turn-change-total"),
    ).toHaveTextContent("+260−0");
    expect(within(card).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(".artemis/MEMORY.md")).toHaveAttribute(
      "title",
      ".artemis/MEMORY.md",
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onUndo).toHaveBeenCalledExactlyOnceWith("turn-1");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onReview).toHaveBeenCalledExactlyOnceWith("turn-1");
  });

  it("preserves disabled undo, unavailable explanations, and review access", async () => {
    const onUndo = vi.fn(),
      onReview = vi.fn();
    render(
      <TurnChangeSetCard
        locale="zh-CN"
        turn={{
          ...turn,
          changeSet: {
            ...turn.changeSet!,
            status: "unavailable",
            message: "文件已被其他操作修改。",
          },
        }}
        undoEnabled={false}
        onUndo={onUndo}
        onReview={onReview}
      />,
    );
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByText("文件已被其他操作修改。")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onUndo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "审核" }));
    expect(onReview).toHaveBeenCalledWith("turn-1");
  });

  it("shows undone state and expands additional files without losing binary status", async () => {
    const files = [
      ...turn.changeSet!.files,
      {
        path: "src/third.ts",
        status: "modified" as const,
        additions: 1,
        deletions: 2,
        binary: false,
      },
      {
        path: "assets/icon.png",
        status: "modified" as const,
        additions: 0,
        deletions: 0,
        binary: true,
      },
    ];
    const { container } = render(
      <TurnChangeSetCard
        locale="zh-CN"
        turn={{
          ...turn,
          changeSet: { ...turn.changeSet!, status: "undone", files },
        }}
        undoEnabled={false}
        onUndo={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
    expect(container.querySelector(".turn-change-undone")).toBeVisible();
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(details.querySelector("summary")!);
    expect(screen.getByText("assets/icon.png")).toBeVisible();
    expect(within(details).getByText("二进制文件")).toBeVisible();
  });

  it("keeps a single long file path discoverable and omits empty change sets", () => {
    const path = "src/very/long/directory/name/implementation.ts";
    const props = {
      locale: "zh-CN" as const,
      undoEnabled: true,
      onUndo: vi.fn(),
      onReview: vi.fn(),
    };
    const { rerender, container } = render(
      <TurnChangeSetCard
        {...props}
        turn={{
          ...turn,
          changeSet: {
            ...turn.changeSet!,
            files: [{ ...turn.changeSet!.files[0]!, path }],
          },
        }}
      />,
    );
    expect(
      container.querySelector(".turn-change-heading strong"),
    ).toHaveAttribute("title", path);
    rerender(
      <TurnChangeSetCard
        {...props}
        turn={{ ...turn, changeSet: { ...turn.changeSet!, files: [] } }}
      />,
    );
    expect(screen.queryByRole("article")).toBeNull();
  });
});
