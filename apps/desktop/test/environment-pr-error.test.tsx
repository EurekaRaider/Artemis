// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentPullRequestError } from "../src/renderer/EnvironmentPullRequestError.js";

afterEach(cleanup);
const error =
  'Error invoking remote method: gh pr view main\nPost "https://api.github.com/graphql": EOF';

it("keeps raw errors in details, copies them, and supports keyboard dismissal", async () => {
  const user = userEvent.setup();
  render(
    <EnvironmentPullRequestError
      error={error}
      loading={false}
      locale="zh-CN"
      onRetry={() => {}}
    />,
  );
  expect(screen.queryByText(error)).toBeNull();
  expect(screen.getByText("GitHub 连接中断，请稍后重试。")).toBeTruthy();
  const trigger = screen.getByRole("button", { name: "查看详情" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "错误详情" });
  expect(dialog.querySelector("pre")?.textContent).toBe(error);
  await user.click(within(dialog).getByRole("button", { name: "复制详情" }));
  expect(await navigator.clipboard.readText()).toBe(error);
  expect(within(dialog).getByRole("status").textContent).toBe("已复制");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(trigger);
  await user.click(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("disables repeat retries while loading and does not mislabel unknown errors", async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  const props = {
    error: "permission denied",
    loading: false,
    locale: "en" as const,
    onRetry: retry,
  };
  const view = render(<EnvironmentPullRequestError {...props} />);
  expect(
    screen.getByText("Could not refresh GitHub status. Retry or view details."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  view.rerender(<EnvironmentPullRequestError {...props} loading />);
  const button = screen.getByRole("button", { name: "Retrying…" });
  expect(button.hasAttribute("disabled")).toBe(true);
  await user.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

it("keeps details selectable when copying fails", async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    new Error("denied"),
  );
  render(
    <EnvironmentPullRequestError
      error={error}
      loading={false}
      locale="zh-CN"
      onRetry={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  await user.click(screen.getByRole("button", { name: "复制详情" }));
  expect(screen.getByText("复制失败，请选择下方详情手动复制。")).toBeTruthy();
  expect(screen.getByRole("dialog").querySelector("pre")?.textContent).toBe(
    error,
  );
});
