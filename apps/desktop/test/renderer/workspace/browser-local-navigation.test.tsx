// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { WorkspaceBrowserPanel } from "../../../src/renderer/workspace/WorkspacePreviewPanel.js";

it("opens the displayed local HTML label using its preview URL and still accepts websites", async () => {
  const path = "seaside-pelican-bicycle.html";
  const url = "http://127.0.0.1:43123/preview/document";
  stubWindowArtemis({
    readWorkspaceTextFile: vi
      .fn()
      .mockResolvedValue({ path, kind: "html", content: "<h1>Local</h1>" }),
    openWorkspaceHtml: vi.fn().mockResolvedValue({ url }),
    releaseWorkspaceHtml: vi.fn().mockResolvedValue(undefined),
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
  const webview = container.querySelector("webview")!;
  const loadURL = vi.fn().mockResolvedValue(undefined);
  Object.assign(webview, {
    loadURL,
    getURL: () => url,
    canGoBack: () => false,
    canGoForward: () => false,
    getWebContentsId: () => 1,
  });
  fireEvent(webview, new Event("dom-ready"));
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(loadURL).toHaveBeenLastCalledWith(url);
  fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
    target: { value: "example.com" },
  });
  fireEvent.submit(container.querySelector("form")!);
  expect(loadURL).toHaveBeenLastCalledWith("https://example.com/");
});
