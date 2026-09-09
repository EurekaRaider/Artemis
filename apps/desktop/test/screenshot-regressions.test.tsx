// @vitest-environment jsdom
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolActivityGroupCard } from "../src/renderer/App.js";
import { TokenUsagePage } from "../src/renderer/TokenUsagePage.js";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { TaskPlanProgress } from "../src/renderer/TaskPlanProgress.js";
import { InlineNotice } from "@artemis/ui/feedback";
import type { SettingsSnapshot, McpServerStatus } from "../src/shared/api.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("reported screenshot regressions", () => {
  it("opens the compact plan capsule from the keyboard and preserves each step's accessible status", async () => {
    const { container } = render(
      <TaskPlanProgress
        locale="zh-CN"
        plan={{
          currentIndex: 2,
          steps: [
            { step: "梳理现有组件与页面", status: "completed" },
            { step: "建立共享设计令牌", status: "completed" },
            { step: "封装基础与交互组件", status: "in_progress" },
            { step: "迁移工作台组合", status: "pending" },
            { step: "验证主题与键盘交互", status: "pending" },
          ],
        }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "展开: 第 3 / 5 步" });
    expect(trigger).toHaveTextContent("第 3 / 5 步");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.tab();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const current = container.querySelector('[aria-current="step"]')!;
    expect(current).toHaveTextContent("封装基础与交互组件");
    expect(current.querySelector('[data-part="marker"]')).toHaveAttribute(
      "data-status",
      "in_progress",
    );
    expect(
      current.querySelector('[data-part="step-status"]'),
    ).toHaveTextContent("正在进行");
    expect(
      container.querySelectorAll('[data-part="step"][data-status="completed"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-part="step"][data-status="pending"]'),
    ).toHaveLength(2);
    expect(trigger.querySelector('[data-part="status"]')).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a failed plan visible and removes a completed capsule after its completion delay", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <TaskPlanProgress
          locale="zh-CN"
          plan={{
            currentIndex: 0,
            steps: [{ step: "验证", status: "failed" }],
          }}
        />,
      );
      expect(
        container.querySelector('[data-part="trigger"] [data-part="marker"]'),
      ).toHaveAttribute("data-status", "failed");
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByRole("button")).toBeVisible();
      rerender(
        <TaskPlanProgress
          locale="zh-CN"
          plan={{
            currentIndex: 0,
            steps: [{ step: "验证", status: "completed" }],
          }}
        />,
      );
      expect(
        container.querySelector('[data-part="trigger"] [data-part="marker"]'),
      ).toHaveAttribute("data-status", "completed");
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.queryByRole("button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows a grouped tool count, per-call results, and preserves the user's disclosure choice", async () => {
    const onFileLink = vi.fn();
    const tools = [
      {
        id: "one",
        name: "read",
        input: { path: "App.tsx" },
        output: "file content",
        status: "completed" as const,
      },
      {
        id: "two",
        name: "shell",
        input: { command: "npm test" },
        output: "test failed",
        status: "failed" as const,
      },
    ];
    const props = {
      active: false,
      locale: "zh-CN" as const,
      onFileLink,
      tools,
    };
    const { container, rerender } = render(
      <ToolActivityGroupCard {...props} />,
    );
    expect(
      container.querySelectorAll('[data-artemis-component="tool-activity"]'),
    ).toHaveLength(1);
    expect(container.querySelector(".tool-group-count")).toHaveTextContent("2");
    expect(container.querySelector(".tool-summary-label")).toHaveTextContent(
      "工具调用",
    );
    expect(container.querySelectorAll(".tool-activity-list > li")).toHaveLength(
      2,
    );
    expect(
      container.querySelectorAll('.tool-item-status[data-state="failed"]'),
    ).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "App.tsx" }));
    expect(onFileLink).toHaveBeenCalledWith("App.tsx");
    const disclosure = container.querySelector<HTMLButtonElement>(
      '[data-part="disclosure"]',
    )!;
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(disclosure);
    rerender(
      <ToolActivityGroupCard
        {...props}
        tools={[...tools, { ...tools[0]!, id: "three" }]}
      />,
    );
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(disclosure);
    const details = container.querySelectorAll(".tool-item-details > summary");
    expect(details).toHaveLength(3);
    expect(screen.queryByText("详情")).toBeNull();
    await userEvent.click(details[1]!);
    expect(screen.getByText(/test failed/)).toBeVisible();
  });

  it("uses a compact file group title and describes running tool work accurately", () => {
    const { container } = render(
      <ToolActivityGroupCard
        active={true}
        locale="zh-CN"
        onFileLink={() => {}}
        tools={[
          {
            id: "read",
            name: "read",
            input: { path: "App.tsx" },
            status: "completed",
          },
          {
            id: "search",
            name: "shell",
            input: { command: 'rg -n "layout" styles.css' },
            status: "running",
          },
        ]}
      />,
    );
    expect(container.querySelector(".tool-summary-label")).toHaveTextContent(
      "读取文件",
    );
    expect(
      container.querySelector('.tool-item-status[data-state="running"]'),
    ).toHaveTextContent("正在运行");
  });

  it.each(["warning", "danger"] as const)(
    "keeps %s guidance readable and semantically announced",
    (tone) => {
      render(
        <InlineNotice tone={tone}>A long configuration message</InlineNotice>,
      );
      const notice = screen.getByRole(tone === "danger" ? "alert" : "status");
      expect(notice).toHaveTextContent("A long configuration message");
      expect(notice.querySelector('[data-part="icon"]')).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(notice).toHaveAttribute("data-tone", tone);
    },
  );

  it("lets a plain model name filter usage while highlighting its complete row", async () => {
    stubWindowArtemis({
      onAgentEvent: () => () => {},
      getTokenUsageEvents: async () => [
        {
          eventId: "usage-one",
          timestamp: new Date().toISOString(),
          payload: {
            type: "assistant.usage",
            providerId: "zai",
            modelId: "glm-5.3",
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 80,
            cacheWriteTokens: 0,
            totalTokens: 200,
          },
        },
      ],
    });
    render(<TokenUsagePage locale="zh-CN" username="Artemis" />);
    const button = await screen.findByRole("button", { name: "zai · glm-5.3" });
    expect(button).toHaveClass("token-usage-model-action");
    await userEvent.click(button);
    expect(button.closest("tr")).toHaveClass("selected");
    expect(button.closest("tr")!.querySelectorAll("td")).toHaveLength(6);
    expect(
      screen.getByRole("columnheader", { name: "总 Token" }),
    ).toBeVisible();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("lists every installed capability with a name, status, configuration action and working toggle", async () => {
    const servers: McpServerStatus[] = Array.from(
      { length: 26 },
      (_, index) => ({
        config: {
          id: `server-${index}`,
          name: `Server ${index}`,
          transport: "stdio",
          enabled: true,
          command: "synthetic-server",
          args: [],
          env: {},
          envVars: [],
          workspacePath: "/synthetic",
          allowNetwork: false,
        },
        state: "connected",
        tools: [],
      }),
    );
    const settings = {
      mcpServers: servers,
      trustedExtensions: [
        {
          config: { id: "extension", name: "Shell Executor", enabled: false },
          state: "changed",
          tools: [],
        },
      ],
    } as unknown as SettingsSnapshot;
    const toggle = vi.fn(async (id: string, enabled: boolean) => ({
      ...settings,
      mcpServers: servers.map((s) =>
        s.config.id === id
          ? { ...s, config: { ...s.config, enabled }, state: "disconnected" }
          : s,
      ),
    }));
    stubWindowArtemis({
      listMcpServers: async () => servers,
      listInstalledSkills: async () => [],
      listCodexPlugins: async () => [],
      onResourceInstallProgress: () => () => {},
      getCodexPluginMarketplaces: async () => ({
        selectedView: "local",
        sources: [],
        marketplaces: [],
        errors: [],
      }),
      loadCodexRuntimeMarketplace: async () => undefined,
      setMcpServerEnabled: toggle,
    });
    const { container } = render(
      <ResourceCenter
        locale="zh-CN"
        settings={settings}
        onConfirm={async () => true}
        onSettingsChange={() => {}}
      />,
    );
    await act(async () => {});
    const list = container.querySelector(".resource-installed-list")!;
    expect(list.querySelectorAll(".resource-installed-row")).toHaveLength(27);
    expect(
      within(list as HTMLElement).getByRole("button", {
        name: "信任 Shell Executor",
      }),
    ).toBeVisible();
    expect(
      within(list as HTMLElement).getByRole("switch", {
        name: "已启用: Shell Executor",
      }),
    ).toBeDisabled();
    expect(list).toHaveTextContent("Server 25");
    expect(list).toHaveTextContent("沙盒运行");
    expect(
      within(list as HTMLElement).getByRole("button", {
        name: "配置 Server 0",
      }),
    ).toBeVisible();
    const enabled = within(list as HTMLElement).getByRole("switch", {
      name: "已启用: Server 0",
    });
    await userEvent.click(enabled);
    expect(toggle).toHaveBeenCalledWith("server-0", false);
    expect(enabled).not.toBeChecked();
    expect(container.querySelector(".resource-installed-icons")).toBeNull();
  });
});
