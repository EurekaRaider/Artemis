// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { WorkspaceFilesPanel } from "../src/renderer/WorkspaceFilesPanel.js";
import { WorkspaceBrowserPanel } from "../src/renderer/WorkspacePreviewPanel.js";

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
    expect(screen.getByText("Image failed")).toBeInTheDocument();
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
    stubWindowArtemis({
      openWorkspacePdf: vi
        .fn()
        .mockResolvedValue("artemis-pdf://document/preview.pdf"),
      readWorkspaceTextFile: readText,
    });
    const { container } = render(
      <WorkspaceBrowserPanel
        threadId="task"
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
      expect(container.querySelector("webview")).toHaveAttribute(
        "src",
        "artemis-pdf://document/preview.pdf#navpanes=0&view=FitH",
      ),
    );
    expect(container.querySelector("webview")).toHaveAttribute(
      "webpreferences",
      "plugins=yes",
    );
    expect(readText).not.toHaveBeenCalled();
  });
});
