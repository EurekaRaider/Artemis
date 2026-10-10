// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { APP_LOCALES, type ComputerControlState } from "@artemis/protocol";
import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { ComputerUseControls } from "../../../src/renderer/computer-use/ComputerUseControls.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

it.each(APP_LOCALES)(
  "localizes control reasons in %s and preserves external details",
  async (locale) => {
    let notify!: (state: ComputerControlState) => void;
    const state: ComputerControlState = {
      version: 1,
      state: "paused",
      threadId: "task",
      reason: "User took control",
    };
    stubWindowArtemis({
      getComputerState: async () => state,
      onComputerState: (callback: typeof notify) => {
        notify = callback;
        return () => {};
      },
    });
    render(<ComputerUseControls locale={locale} />);
    expect(
      await screen.findByText(uiText(locale, "ComputerUse.reasonTakeover")),
    ).toBeVisible();
    act(() => notify({ ...state, reason: "toString" }));
    expect(screen.getByText("toString")).toBeVisible();
  },
);

it("stops, resumes and revokes the actual target's grant", async () => {
  const user = userEvent.setup();
  let state: ComputerControlState = {
    version: 1,
    state: "acting",
    threadId: "task",
    target: { id: "browser:1", kind: "browser", name: "Test Browser" },
  };
  let notify!: (value: ComputerControlState) => void;
  const unsubscribe = vi.fn();
  const permissions = vi.fn(async () => [
    {
      id: "browser",
      name: "Test Browser",
      scope: "task" as const,
      foreground: false,
      threadTitle: "填写表单",
    },
  ]);
  const revoke = vi.fn(async () => {
    permissions.mockResolvedValue([]);
  });
  const control = vi.fn(async (action: "stop" | "resume") => {
    state = { ...state, state: action === "stop" ? "paused" : "idle" };
    notify(state);
  });
  stubWindowArtemis({
    getComputerState: async () => state,
    onComputerState: (callback: typeof notify) => {
      notify = callback;
      return unsubscribe;
    },
    getComputerPermissions: permissions,
    revokeComputerPermission: revoke,
    controlComputer: control,
  });
  const rendered = render(<ComputerUseControls locale="zh-CN" />);
  await user.click(
    await screen.findByRole("button", { name: "停止", exact: true }),
  );
  expect(control).toHaveBeenCalledWith("stop", "task");
  await user.click(screen.getByRole("button", { name: "恢复", exact: true }));
  expect(control).toHaveBeenCalledWith("resume", "task");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  rendered.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();

  render(<ComputerUseControls locale="zh-CN" permissionsOnly />);
  expect(await screen.findByRole("list", { name: "应用授权" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "应用授权" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByText("本任务自主操作 · 仅后台操作 · 填写表单"),
  ).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "撤销" }));
  expect(revoke).toHaveBeenCalledWith("browser");
  expect(await screen.findByText("没有应用授权")).toBeVisible();
});

it("removes the Windows native cutout when Acrylic falls back to an opaque surface", async () => {
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  stubWindowArtemis({
    getComputerState: async () => ({
      version: 1,
      state: "paused",
      threadId: "task",
    }),
    onComputerState: () => () => {},
  });
  const view = (nativeGlass: boolean) => (
    <div className="app-shell" data-platform="win32">
      <div className="conversation">
        <ComputerUseControls locale="zh-CN" nativeGlass={nativeGlass} />
      </div>
    </div>
  );
  const rendered = render(view(true));
  try {
    const control = await screen.findByRole("complementary");
    const conversation = control.closest<HTMLElement>(".conversation")!;
    expect(control.dataset.nativeGlass).toBe("true");
    expect(
      conversation.style.getPropertyValue("--computer-glass-mask"),
    ).toContain("data:image/svg+xml");
    rendered.rerender(view(false));
    expect(control.dataset.nativeGlass).toBeUndefined();
    expect(conversation.dataset.computerGlass).toBeUndefined();
    expect(conversation.style.getPropertyValue("--computer-glass-mask")).toBe(
      "",
    );
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    rendered.unmount();
    vi.unstubAllGlobals();
  }
});
