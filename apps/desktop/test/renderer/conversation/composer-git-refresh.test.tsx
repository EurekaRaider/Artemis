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
import { ComposerContextBar } from "../../../src/renderer/conversation/ComposerContextBar.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
const project = {
  id: "p",
  name: "Demo",
  path: "/local",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
afterEach(cleanup);
it.each([
  {
    locale: "zh-CN",
    label: "任务模式",
    options: ["计划", "执行", "代码"],
  },
  {
    locale: "zh-TW",
    label: "任務模式",
    options: ["計畫", "執行", "程式碼"],
  },
  {
    locale: "en",
    label: "Task mode",
    options: ["Plan", "Work", "Code"],
  },
] as const)(
  "localizes and selects every mode in $locale",
  async ({ locale, label, options }) => {
    stubWindowArtemis({ onProjectGitChanged: () => () => {} });
    const onModeChange = vi.fn();
    render(
      <ComposerContextBar
        branchActionsDisabled={false}
        locale={locale}
        mode="work"
        modeActionsDisabled={false}
        onClearProject={vi.fn()}
        onError={vi.fn()}
        onModeChange={onModeChange}
        onOpenProject={async () => {}}
        onSelectProject={vi.fn()}
        projects={[]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: label })).toBeVisible();
    expect(
      screen.getAllByRole("radio").map((option) => option.textContent),
    ).toEqual(options);
    screen
      .getAllByRole("radio")
      .forEach((option) => expect(option).toBeVisible());
    fireEvent.click(screen.getByRole("radio", { name: options[2] }));
    expect(onModeChange).toHaveBeenCalledExactlyOnceWith("codemode");
  },
);

it("reads and refreshes the active task checkout instead of the project checkout", async () => {
  let changed!: (context: { projectId: string; threadId?: string }) => void;
  const read = vi
    .fn()
    .mockResolvedValue({ managed: true, currentBranch: "old", branches: [] });
  stubWindowArtemis({
    getProjectGitInfo: read,
    onProjectGitChanged: (listener) => {
      changed = listener;
      return () => {};
    },
  });
  render(
    <ComposerContextBar
      activeProject={project}
      threadId="task"
      branchActionsDisabled={false}
      locale="zh-CN"
      mode="work"
      modeActionsDisabled={false}
      onClearProject={vi.fn()}
      onError={vi.fn()}
      onModeChange={vi.fn()}
      onOpenProject={async () => {}}
      onSelectProject={vi.fn()}
      projects={[project]}
    />,
  );
  await screen.findByRole("button", { name: "old" });
  expect(read).toHaveBeenLastCalledWith("p", "task");
  const count = read.mock.calls.length;
  await act(async () => changed({ projectId: "p", threadId: "other" }));
  expect(read).toHaveBeenCalledTimes(count);
  read.mockResolvedValue({ managed: true, currentBranch: "new", branches: [] });
  await act(async () => changed({ projectId: "p", threadId: "task" }));
  await screen.findByRole("button", { name: "new" });
});

it("closes the project picker when conversation context becomes locked", async () => {
  stubWindowArtemis({
    getProjectGitInfo: async () => ({ managed: false, branches: [] }),
    onProjectGitChanged: () => () => {},
  });
  const select = vi.fn();
  const props = {
    activeProject: project,
    branchActionsDisabled: false,
    locale: "en" as const,
    mode: "work" as const,
    modeActionsDisabled: false,
    onClearProject: vi.fn(),
    onError: vi.fn(),
    onModeChange: vi.fn(),
    onOpenProject: async () => {},
    onSelectProject: select,
    projects: [project, { ...project, id: "other", name: "Other" }],
  };
  const { rerender } = render(
    <ComposerContextBar {...props} projectActionsDisabled={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Demo" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Other" }));
  expect(select).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Demo" }));
  rerender(<ComposerContextBar {...props} projectActionsDisabled />);
  expect(screen.getByRole("button", { name: "Demo" })).toBeDisabled();
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Demo" }));
  expect(select).toHaveBeenCalledOnce();
  rerender(<ComposerContextBar {...props} projectActionsDisabled={false} />);
  expect(screen.getByRole("button", { name: "Demo" })).toBeEnabled();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("groups local and remote branches and preserves complete branch names and switching", async () => {
  const longName = "codex/fix-issue-with-a-very-long-model-stream-layout";
  const branches = [
    { name: "origin/z", current: false, remote: true },
    { name: longName, current: false },
    { name: "main", current: true },
    { name: "origin/a", current: false, remote: true },
  ];
  const info = {
    managed: true,
    currentBranch: "main",
    branches,
    changeCount: 0,
  };
  const switchBranch = vi.fn().mockResolvedValue(info);
  stubWindowArtemis({
    getProjectGitInfo: vi.fn().mockResolvedValue(info),
    onProjectGitChanged: () => () => {},
    switchProjectBranch: switchBranch,
  });
  render(
    <ComposerContextBar
      activeProject={project}
      threadId="task"
      branchActionsDisabled={false}
      locale="zh-CN"
      mode="work"
      modeActionsDisabled={false}
      onClearProject={vi.fn()}
      onError={vi.fn()}
      onModeChange={vi.fn()}
      onOpenProject={async () => {}}
      onSelectProject={vi.fn()}
      projects={[project]}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "main" }));
  const menu = screen.getByRole("menu");
  const rows = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ];
  expect(rows.map((row) => row.querySelector("strong")?.title)).toEqual([
    "main",
    longName,
    "origin/a",
    "origin/z",
  ]);
  expect(
    [
      ...menu.querySelectorAll(".branch-list .composer-context-menu-heading"),
    ].map((heading) => heading.textContent),
  ).toEqual(["本地", "远程"]);
  expect(menu).toHaveTextContent("有未提交改动时，切换前会先询问是否暂存。");
  const name = rows[1]!.querySelector("strong")!;
  expect(name.textContent).toBe(longName);
  expect(name.childElementCount).toBe(0);
  expect(name.title).toBe(longName);
  expect(branches.map((branch) => branch.name)).toEqual([
    "origin/z",
    longName,
    "main",
    "origin/a",
  ]);
  fireEvent.click(rows[3]!);
  expect(switchBranch).toHaveBeenCalledExactlyOnceWith("p", "origin/z", "task");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "main" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索分支" }), {
    target: { value: "codex/from-search" },
  });
  const create = screen.getByRole("menuitem", {
    name: "新建分支 codex/from-search · 基于当前",
  });
  expect(
    create
      .closest(".branch-menu-actions")
      ?.nextElementSibling?.classList.contains("branch-list"),
  ).toBe(true);
  fireEvent.click(create);
  expect(document.querySelector(".branch-create-form input")).toHaveValue(
    "codex/from-search",
  );
});
