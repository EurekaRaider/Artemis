// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  fireEvent.click(screen.getByRole("button", { name: "Restart and install" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Restart and install" }));
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  await act(async () => rendered.rerender(view(0)));
  expect(installUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Restart and install" })).toBeEnabled();
});

it("places the ready notice under the header and lets Later dismiss it before scheduling", () => {
  const installUpdate = vi.fn(async () => {});
  stubWindowArtemis({ installUpdate });
  const target = document.createElement("div");
  document.body.append(target);
  const rendered = render(
    <SidebarUpdateControl
      status={ready}
      locale="en"
      activeTaskCount={1}
      noticeTarget={target}
      onStatus={() => {}}
      onError={() => {}}
    />,
  );
  expect(within(target).getByRole("status")).toHaveTextContent("1.7.21");
  expect(within(rendered.container).queryByRole("button")).toBeNull();
  fireEvent.click(within(target).getByRole("button", { name: "Later" }));
  expect(target).toBeEmptyDOMElement();
  expect(
    within(rendered.container).getByRole("button", { name: "Restart and install" }),
  ).toBeEnabled();
  expect(installUpdate).not.toHaveBeenCalled();
  rendered.unmount();
  target.remove();
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
  expect(screen.getByRole("progressbar")).toHaveValue(42);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Install failed");
  expect(within(alert).getByRole("button", { name: "Retry" })).toBeVisible();
  expect(document.querySelector(".sidebar-update > button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Install failed"));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(2));
});
