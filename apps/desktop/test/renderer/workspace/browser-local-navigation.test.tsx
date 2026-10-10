// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BrowserSessionSnapshot } from "@artemis/protocol";
import { expect, it, vi } from "vitest";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { WorkspaceBrowserPanel } from "../../../src/renderer/workspace/WorkspacePreviewPanel.js";

vi.mock("../../../src/renderer/computer-use/PreviewCanvas.js", () => ({
  PreviewCanvas: () => <canvas />,
}));

it("opens the displayed local HTML label using its preview URL and still accepts websites", async () => {
  const path = "seaside-pelican-bicycle.html";
  const url = "http://127.0.0.1:43123/preview/document";
  const browserSession = vi.fn().mockResolvedValue({
    threadId: "task",
    tabId: "preview",
    sessionId: crypto.randomUUID(),
    contentsId: 1,
    url,
    title: "Local",
    canGoBack: false,
    canGoForward: false,
    loading: false,
    width: 1280,
    height: 720,
  });
  stubWindowArtemis({
    browserSession,
    onBrowserSession: () => () => {},
    browserPreview: vi.fn().mockResolvedValue({ entries: [] }),
  });
  const { container } = render(
    <WorkspaceBrowserPanel
      threadId="task"
      tabId="preview"
      path={path}
      revision={undefined}
      title="Browser"
      emptyMessage="Empty"
      refreshLabel="Refresh"
      addressPlaceholder="Address"
      backLabel="Back"
      forwardLabel="Forward"
      goLabel="Go"
      locale="en"
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(path),
  );
  expect(browserSession).toHaveBeenCalledWith({
    action: "open",
    threadId: "task",
    tabId: "preview",
    path,
  });
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(browserSession).toHaveBeenLastCalledWith({
    action: "navigate",
    threadId: "task",
    tabId: "preview",
    url,
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
    target: { value: "example.com" },
  });
  fireEvent.submit(container.querySelector("form")!);
  expect(browserSession).toHaveBeenLastCalledWith({
    action: "navigate",
    threadId: "task",
    tabId: "preview",
    url: "https://example.com/",
  });
});

it("keeps a newer ready event when the initial open response arrives late", async () => {
  const ready: BrowserSessionSnapshot = {
    threadId: "task",
    tabId: "browser",
    sessionId: crypto.randomUUID(),
    contentsId: 1,
    url: "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
    width: 1280,
    height: 720,
  };
  let publish: (value: BrowserSessionSnapshot) => void;
  let finishOpen: (value: BrowserSessionSnapshot) => void;
  stubWindowArtemis({
    browserSession: vi.fn(
      () => new Promise((resolve) => (finishOpen = resolve)),
    ),
    onBrowserSession: (listener) => {
      publish = listener;
      return () => {};
    },
    browserPreview: vi.fn().mockResolvedValue({ entries: [] }),
  });
  const { container } = render(
    <WorkspaceBrowserPanel
      threadId="task"
      tabId="browser"
      title="Browser"
      emptyMessage="Empty"
      refreshLabel="Refresh"
      addressPlaceholder="Address"
      backLabel="Back"
      forwardLabel="Forward"
      goLabel="Go"
      locale="en"
    />,
  );
  await act(async () => {
    publish!(ready);
  });
  expect(container.querySelector(".browser-panel")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await act(async () => {
    finishOpen!({ ...ready, loading: true });
  });
  expect(container.querySelector(".browser-panel")).toHaveAttribute(
    "data-state",
    "ready",
  );
});

it.each([false, true])(
  "handles a navigation rejection after a newer browser event: %s",
  async (newerEvent) => {
    const ready: BrowserSessionSnapshot = {
      threadId: "task",
      tabId: "browser",
      sessionId: crypto.randomUUID(),
      contentsId: 1,
      url: "about:blank",
      title: "",
      canGoBack: false,
      canGoForward: false,
      loading: false,
      width: 1280,
      height: 720,
    };
    let publish!: (value: BrowserSessionSnapshot) => void;
    let rejectNavigation!: (error: Error) => void;
    stubWindowArtemis({
      browserSession: vi.fn((input) =>
        input.action === "navigate"
          ? new Promise((_resolve, reject) => (rejectNavigation = reject))
          : Promise.resolve(ready),
      ),
      onBrowserSession: (listener) => {
        publish = listener;
        return () => {};
      },
      browserPreview: vi.fn().mockResolvedValue({ entries: [] }),
    });
    const { container } = render(
      <WorkspaceBrowserPanel
        threadId="task"
        tabId="browser"
        title="Browser"
        emptyMessage="Empty"
        refreshLabel="Refresh"
        addressPlaceholder="Address"
        backLabel="Back"
        forwardLabel="Forward"
        goLabel="Go"
        locale="en"
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Go" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
      target: { value: "https://failure.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      if (newerEvent) publish({ ...ready, url: "https://current.test" });
      rejectNavigation(new Error("Previous navigation failed"));
    });
    expect(container.querySelector(".browser-panel")).toHaveAttribute(
      "data-state",
      newerEvent ? "ready" : "error",
    );
    expect(container.querySelector(".browser-error")?.textContent).toBe(
      newerEvent ? undefined : "Previous navigation failed",
    );
  },
);
