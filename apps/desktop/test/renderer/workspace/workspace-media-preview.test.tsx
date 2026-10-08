// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { WorkspaceFilesPanel } from "../../../src/renderer/workspace/WorkspaceFilesPanel.js";
import { WorkspaceBrowserPanel } from "../../../src/renderer/workspace/WorkspacePreviewPanel.js";
vi.mock("../../../src/renderer/computer-use/PreviewCanvas.js", () => ({
  PreviewCanvas: () => <canvas />,
}));

const labels = {
  title: "Files",
  filterPlaceholder: "Filter files",
  openFileMessage: "Open file",
  binaryMessage: "Binary file",
  imageFailureMessage: "Image failed",
  editFileLabel: "Edit",
  refreshLabel: "Refresh",
  richLabel: "Rich text",
  previewLabel: "Preview",
  saveLabel: "Save",
  savedLabel: "Saved",
  savingLabel: "Saving",
  sourceLabel: "Source",
  unsavedLabel: "Unsaved",
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';

describe("workspace media preview", () => {
  it.each(["data.csv", "slides.ppt", "budget.xls"])(
    "shows installation guidance for %s when Office is missing",
    async (path) => {
      stubWindowArtemis({
        listWorkspaceDirectory: async () => [],
        readWorkspaceFile: async () => ({
          path,
          binary: !path.endsWith("csv"),
          content: "a,b",
        }),
        officeCapabilityStatus: async () => ({ phase: "idle", versions: [] }),
      });
      render(
        <WorkspaceFilesPanel
          {...labels}
          locale="zh-CN"
          threadId="task"
          selectedPath={path}
          onOpenHtml={vi.fn()}
          onFileSelected={vi.fn()}
        />,
      );
      expect(
        await screen.findByText("安装 Office 套件后即可预览此文件"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "安装 Office 套件" }),
      ).toBeVisible();
      expect(screen.queryByText("Binary file")).toBeNull();
    },
  );
  it.each(["report.docx", "Slides.PPTX", "预算.xlsx"])(
    "routes %s from the file tree and restored selection without binary reading",
    async (path) => {
      const open = vi.fn(),
        read = vi.fn();
      stubWindowArtemis({
        listWorkspaceDirectory: vi
          .fn()
          .mockResolvedValue([{ name: path, path, kind: "file" }]),
        readWorkspaceFile: read,
      });
      const { rerender } = render(
        <WorkspaceFilesPanel
          {...labels}
          threadId="task"
          selectedPath={undefined}
          onOpenHtml={vi.fn()}
          onOpenOffice={open}
          onFileSelected={vi.fn()}
        />,
      );
      fireEvent.click(await screen.findByText(path));
      expect(open).toHaveBeenCalledWith(path);
      open.mockClear();
      rerender(
        <WorkspaceFilesPanel
          {...labels}
          threadId="task"
          selectedPath={path}
          onOpenHtml={vi.fn()}
          onOpenOffice={open}
          onFileSelected={vi.fn()}
        />,
      );
      await waitFor(() => expect(open).toHaveBeenCalledWith(path));
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("previews SVG without a source toggle or empty toolbar", async () => {
    stubWindowArtemis({
      listWorkspaceDirectory: vi.fn().mockResolvedValue([]),
      readWorkspaceFile: vi.fn().mockResolvedValue({
        path: "image.svg",
        binary: false,
        content: svg,
        preview: { mimeType: "image/svg+xml", data: btoa(svg) },
      }),
    });
    render(
      <WorkspaceFilesPanel
        {...labels}
        threadId="task"
        selectedPath="image.svg"
        onOpenHtml={vi.fn()}
        onFileSelected={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("img", { name: "image.svg" }),
    ).toHaveAttribute("src", `data:image/svg+xml;base64,${btoa(svg)}`);
    expect(
      screen.queryByRole("textbox", { name: "Edit: image.svg" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Source" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-panel-toolbar")).toBeNull();
    fireEvent.error(screen.getByRole("img", { name: "image.svg" }));
    expect(await screen.findByText("Image failed")).toBeInTheDocument();
  });

  it("routes a PDF selected in the file tree to the browser without text reading", async () => {
    const open = vi.fn(),
      read = vi.fn();
    stubWindowArtemis({
      listWorkspaceDirectory: vi
        .fn()
        .mockResolvedValue([
          { name: "report.PDF", path: "report.PDF", kind: "file" },
        ]),
      readWorkspaceFile: read,
    });
    render(
      <WorkspaceFilesPanel
        {...labels}
        threadId="task"
        selectedPath={undefined}
        onOpenHtml={open}
        onFileSelected={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText("report.PDF"));
    expect(open).toHaveBeenCalledWith("report.PDF");
    expect(read).not.toHaveBeenCalled();
  });

  it("loads PDF bytes into the native browser with PDF support enabled", async () => {
    const readText = vi.fn();
    const browserSession = vi.fn().mockResolvedValue({
      threadId: "task",
      tabId: "preview",
      sessionId: crypto.randomUUID(),
      contentsId: 1,
      url: "artemis-pdf://document/preview.pdf#navpanes=0&view=FitH",
      title: "report.pdf",
      canGoBack: false,
      canGoForward: false,
      loading: false,
      width: 1280,
      height: 720,
    });
    stubWindowArtemis({
      browserSession,
      onBrowserSession: () => () => {},
      readWorkspaceTextFile: readText,
    });
    const { container } = render(
      <WorkspaceBrowserPanel
        threadId="task"
        tabId="preview"
        path="report.pdf"
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
      expect(browserSession).toHaveBeenCalledWith({
        action: "open",
        threadId: "task",
        tabId: "preview",
        path: "report.pdf",
      }),
    );
    await waitFor(() =>
      expect(container.querySelector("canvas")).toBeInTheDocument(),
    );
    expect(readText).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  "explains oversized files for tree/restored selection: %s",
  async (restored) => {
    stubWindowArtemis({
      listWorkspaceDirectory: async () => [
        { name: "large.txt", path: "large.txt", kind: "file" },
      ],
      readWorkspaceFile: async () => {
        throw new Error(
          "Error invoking remote method 'artemis:workspace-file-read': Error: Workspace file exceeds 4 MiB.",
        );
      },
    });
    render(
      <WorkspaceFilesPanel
        {...labels}
        locale="zh-CN"
        threadId="task"
        selectedPath={restored ? "large.txt" : undefined}
        onOpenHtml={vi.fn()}
        onFileSelected={vi.fn()}
      />,
    );
    if (!restored) fireEvent.click(await screen.findByText("large.txt"));
    expect(
      await screen.findByText(
        "文件超过 4 MiB 的预览限制。请拆分文件、减小文件大小，或使用其他应用打开。",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/artemis:workspace-file-read/)).toBeNull();
  },
);
