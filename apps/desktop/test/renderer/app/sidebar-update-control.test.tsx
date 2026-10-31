// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SidebarUpdateControl } from "../../../src/renderer/updates/SidebarUpdateControl.js";
import type { ReleaseUpdateStatus } from "../../../src/shared/api.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

const ready: ReleaseUpdateStatus = {
  state: "downloaded",
  currentVersion: "1.7.20",
  availableVersion: "1.7.21",
  rollbackAvailable: false,
};

it("waits for all active tasks and installs exactly once", async () => {
  const installUpdate = vi.fn(async () => {});
  stubWindowArtemis({ installUpdate });
  const view = (count: number) => (
    <SidebarUpdateControl
      status={ready}
      locale="en"
      activeTaskCount={count}
      onStatus={() => {}}
      onError={() => {}}
    />
  );
  const rendered = render(view(2));
  fireEvent.click(screen.getByRole("button", { name: "Install update" }));
  expect(installUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Later" })).toBeEnabled();
  rendered.rerender(view(1));
  expect(installUpdate).not.toHaveBeenCalled();
  rendered.rerender(view(0));
  await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
  rendered.rerender(view(0));
  expect(installUpdate).toHaveBeenCalledOnce();
});

it("cancels a deferred restart when Later is selected", async () => {
  const installUpdate = vi.fn(async () => {});
  stubWindowArtemis({ installUpdate });
  const view = (count: number) => (
    <SidebarUpdateControl
      status={ready}
      locale="en"
      activeTaskCount={count}
      onStatus={() => {}}
      onError={() => {}}
    />
  );
  const rendered = render(view(1));
  fireEvent.click(screen.getByRole("button", { name: "Install update" }));
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  await act(async () => rendered.rerender(view(0)));
  expect(installUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Install update" })).toBeEnabled();
});

it("shows byte progress only when the updater supplies it", () => {
  const status: ReleaseUpdateStatus = {
    ...ready,
    state: "downloading",
    progress: 42,
  };
  const view = (value: ReleaseUpdateStatus) => (
    <SidebarUpdateControl
      status={value}
      locale="en"
      activeTaskCount={0}
      onStatus={() => {}}
      onError={() => {}}
    />
  );
  const rendered = render(view(status));
  expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
  rendered.rerender(
    view({
      ...status,
      downloadedBytes: 20 * 1048576,
      totalBytes: 50 * 1048576,
    }),
  );
  expect(screen.getByText("20 / 50 MB")).toBeVisible();
  expect(screen.getByRole("button", { name: "42%" })).toBeDisabled();
});

it("keeps installation failures visible and permits an explicit retry", async () => {
  const installUpdate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Install failed"))
    .mockResolvedValue(undefined);
  const onError = vi.fn();
  stubWindowArtemis({ installUpdate });
  render(
    <SidebarUpdateControl
      status={{ ...ready, message: "Install failed" }}
      locale="en"
      activeTaskCount={0}
      onStatus={() => {}}
      onError={onError}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Install failed");
  fireEvent.click(screen.getByRole("button", { name: "Install update" }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Install failed"));
  fireEvent.click(screen.getByRole("button", { name: "Install update" }));
  await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(2));
});
