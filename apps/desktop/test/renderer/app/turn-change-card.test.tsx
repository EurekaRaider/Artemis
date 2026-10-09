// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TurnViewState } from "@artemis/protocol";
import { describe, expect, it, vi } from "vitest";
import "../../fixtures/renderer-test-utils.js";
import { TurnChangeSetCard } from "../../../src/renderer/app/App.js";

vi.mock(
  "../../../src/renderer/appearance/desktop-skin-bootstrap.js",
  () => ({}),
);

const turn: TurnViewState = {
  id: "turn-1",
  mode: "work",
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
  it("shows summary totals and routes keyboard review and undo to this turn", async () => {
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
    expect(container.querySelector(".turn-change-more")).toBeNull();
    expect(
      screen.getByRole("button", { name: "审核 .artemis/MEMORY.md" }),
    ).toHaveAttribute("title", ".artemis/MEMORY.md");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onUndo).toHaveBeenCalledExactlyOnceWith("turn-1");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onReview).toHaveBeenCalledExactlyOnceWith("turn-1");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onReview).toHaveBeenLastCalledWith("turn-1", ".artemis/MEMORY.md");
    await userEvent.click(
      screen.getByRole("button", { name: "审核 AI_HANDOFF_V2.md" }),
    );
    expect(onReview).toHaveBeenLastCalledWith("turn-1", "AI_HANDOFF_V2.md");
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
      ...["Launch-brief.docx", "Launch-budget.xlsx", "index.html"].map(
        (path) => ({ ...turn.changeSet!.files[0]!, path }),
      ),
    ];
    const onReview = vi.fn();
    const { container } = render(
      <TurnChangeSetCard
        locale="zh-CN"
        turn={{
          ...turn,
          changeSet: { ...turn.changeSet!, status: "undone", files },
        }}
        undoEnabled={false}
        onUndo={vi.fn()}
        onReview={onReview}
      />,
    );
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
    expect(container.querySelector(".turn-change-undone")).toBeVisible();
    const list = screen.getByRole("list");
    const toggle = screen.getByRole("button", { name: "再显示 4 个文件" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", list.id);
    expect(list.nextElementSibling).toBe(toggle);
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "审核 assets/icon.png" }),
    ).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAccessibleName("收起 4 个文件");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(list.nextElementSibling).toBe(toggle);
    expect(toggle).toHaveFocus();
    const binaryFile = screen.getByRole("button", {
      name: "审核 assets/icon.png",
    });
    expect(binaryFile).toBeVisible();
    await userEvent.click(binaryFile);
    expect(onReview).toHaveBeenCalledWith("turn-1", "assets/icon.png");
    expect(within(list).getByText("二进制文件")).toBeVisible();
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAccessibleName("再显示 4 个文件");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAccessibleName("收起 4 个文件");
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
  });

  it("opens a single long file path and omits empty change sets", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: `审核 ${path}` }));
    expect(props.onReview).toHaveBeenCalledWith("turn-1", path);
    rerender(
      <TurnChangeSetCard
        {...props}
        turn={{ ...turn, changeSet: { ...turn.changeSet!, files: [] } }}
      />,
    );
    expect(screen.queryByRole("article")).toBeNull();
  });
});
