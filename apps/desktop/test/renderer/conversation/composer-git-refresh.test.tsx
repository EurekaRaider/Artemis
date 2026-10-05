// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
    options: ["计划模式", "工作模式", "代码模式"],
  },
  {
    locale: "zh-TW",
    label: "任務模式",
    options: ["計畫模式", "工作模式", "程式碼模式"],
  },
  {
    locale: "en",
    label: "Task mode",
    options: ["Plan mode", "Work mode", "Code mode"],
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
    fireEvent.click(
      screen.getByRole("button", { name: `${label} ${options[1]}` }),
    );
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(options);
    expect(
      screen
        .getAllByRole("option")
        .every((option) => option.querySelector("small")?.textContent),
    ).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: options[2] }));
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
