// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "../src/renderer/MarkdownContent.js";
import { WorkspaceVideoPlayer } from "../src/renderer/WorkspaceVideoPlayer.js";
import { WorkspaceFilesPanel } from "../src/renderer/WorkspaceFilesPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const labels = {
  title: "Files",
  filterPlaceholder: "Filter files",
  openFileMessage: "Open file",
  binaryMessage: "Binary file",
  imageFailureMessage: "Image failed",
  editFileLabel: "Edit",
  refreshLabel: "Refresh",
  richLabel: "Rich",
  previewLabel: "Preview",
  saveLabel: "Save",
  savedLabel: "Saved",
  savingLabel: "Saving",
  sourceLabel: "Source",
  unsavedLabel: "Unsaved",
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function api() {
  const release = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockImplementation(async (_thread, href) => ({
    path: href,
    mimeType: "video/mp4",
    version: "1",
    url: "artemis-media://video/test",
  }));
  const inspect = vi.fn().mockImplementation(async (_thread, href: string) => ({
    path: href.replace("/workspace/", "").replace(/^\.\//, ""),
    viewer: "file",
  }));
  const read = vi.fn();
  stubWindowArtemis({
    openWorkspaceVideo: open,
    releaseWorkspaceVideo: release,
    inspectWorkspaceFileLink: inspect,
    readWorkspaceFile: read,
    listWorkspaceDirectory: async () => [
      { name: "film.mp4", path: "film.mp4", kind: "file" },
    ],
  });
  return { open, release, inspect, read };
}
describe("workspace video player", () => {
  it("uses video links as the only panel entry without resetting playback", async () => {
    const { open } = api();
    const onFileLink = vi.fn();
    const text = "![Film](film.mp4)\n\n![Other](other.mp4)";
    const { container, rerender } = render(
      <MarkdownContent
        text={text}
        videoThreadId="task"
        onFileLink={onFileLink}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll("video[src]")).toHaveLength(2),
    );
    const player = container.querySelector("video")!;
    player.currentTime = 12;
    expect(container.querySelector("button")).toBeNull();
    rerender(
      <MarkdownContent
        text={text + "\n\n[Watch video](/workspace/film.mp4)"}
        videoThreadId="task"
        onFileLink={onFileLink}
      />,
    );
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
    expect(container.querySelector("video")).toBe(player);
    expect(player.currentTime).toBe(12);
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("Watch video"));
    expect(onFileLink).toHaveBeenLastCalledWith("/workspace/film.mp4");
  });
  it("does not replace a selected video with a stale text-file response", async () => {
    const { read } = api();
    let finish!: (value: unknown) => void;
    read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = {
      ...labels,
      threadId: "task",
      onOpenHtml: vi.fn(),
      onFileSelected: vi.fn(),
    };
    const { container, rerender } = render(
      <WorkspaceFilesPanel {...props} selectedPath="old.txt" />,
    );
    rerender(<WorkspaceFilesPanel {...props} selectedPath="film.mp4" />);
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src"),
    );
    await act(async () =>
      finish({ path: "old.txt", binary: false, content: "outdated" }),
    );
    expect(container.querySelector("video")).toHaveAttribute(
      "aria-label",
      "film.mp4",
    );
    expect(screen.queryByText("outdated")).not.toBeInTheDocument();
  });
  it("adds one player for aliases, preserves links, and keeps the same video during streamed text", async () => {
    const { open, release } = api();
    const onFileLink = vi.fn();
    const text = "[Download](film.mp4) [Again](/workspace/film.mp4)";
    const { container, rerender, unmount } = render(
      <MarkdownContent
        text={text}
        videoThreadId="task"
        onFileLink={onFileLink}
        fileLinkIcons
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src"),
    );
    const player = container.querySelector("video")!;
    player.currentTime = 12;
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
    fireEvent.click(screen.getByText("Download"));
    expect(onFileLink).toHaveBeenCalledWith("film.mp4");
    rerender(
      <MarkdownContent
        text={text + "\n\nMore streamed text."}
        videoThreadId="task"
        onFileLink={onFileLink}
        fileLinkIcons
      />,
    );
    expect(container.querySelector("video")).toBe(player);
    expect(player.currentTime).toBe(12);
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".workspace-file-link-icon svg"),
    ).not.toBeNull();
    unmount();
    expect(release).toHaveBeenCalledWith("task", "artemis-media://video/test");
  });
  it("renders explicit video at its position, deduplicates links and ignores code and remote videos", async () => {
    const { open } = api();
    const text =
      "Before\n\n![Film](film.mp4)\n\nAfter [Download](./film.mp4)\n\n`[Code](code.mp4)`\n\n```md\n![Code](block.mp4)\n```\n\n[Remote](https://example.com/video.mp4)";
    const { container, rerender } = render(
      <MarkdownContent text={text} videoThreadId="task" />,
    );
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src"),
    );
    const player = container.querySelector("video")!;
    expect(player.closest("p")?.previousElementSibling).toHaveTextContent(
      "Before",
    );
    expect(player.closest("p")?.nextElementSibling).toHaveTextContent("After");
    expect(container.querySelectorAll("video")).toHaveLength(1);
    rerender(<MarkdownContent text={text + "\n\nEnd"} videoThreadId="task" />);
    expect(container.querySelector("video")).toBe(player);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("retries missing and unsupported video without removing the link", async () => {
    const { open, release } = api();
    open.mockRejectedValueOnce(new Error("missing"));
    const { container } = render(
      <MarkdownContent text="[Download](film.mp4)" videoThreadId="task" />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src"),
    );
    const player = container.querySelector("video")!;
    Object.defineProperty(player, "error", {
      configurable: true,
      value: { code: 4 },
    });
    fireEvent.error(player);
    expect(screen.getByRole("alert")).toHaveTextContent("unsupported codec");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(release).toHaveBeenCalled();
    expect(screen.getByText("Download")).toBeInTheDocument();
  });
  it("pauses other players and releases a pending request after unmount", async () => {
    const { open, release } = api();
    const { container, unmount } = render(
      <>
        <WorkspaceVideoPlayer threadId="task" href="a.mp4" />
        <WorkspaceVideoPlayer threadId="task" href="b.mp4" />
      </>,
    );
    await waitFor(() =>
      expect(container.querySelectorAll("video[src]")).toHaveLength(2),
    );
    const [first, second] = container.querySelectorAll("video");
    Object.defineProperty(first, "paused", {
      configurable: true,
      value: false,
    });
    fireEvent.play(second!);
    expect(first!.pause).toHaveBeenCalled();
    unmount();
    let finish!: (value: unknown) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = render(
      <WorkspaceVideoPlayer threadId="task" href="late.mp4" />,
    );
    pending.unmount();
    await act(async () =>
      finish({
        path: "late.mp4",
        mimeType: "video/mp4",
        version: "1",
        url: "artemis-media://video/late",
      }),
    );
    expect(release).toHaveBeenCalledWith("task", "artemis-media://video/late");
  });
  it("opens file-tree and restored videos without the whole-file reader", async () => {
    const { read, open } = api();
    const selected = vi.fn();
    const { container, rerender } = render(
      <WorkspaceFilesPanel
        {...labels}
        threadId="task"
        selectedPath={undefined}
        onOpenHtml={vi.fn()}
        onFileSelected={selected}
      />,
    );
    fireEvent.click(await screen.findByText("film.mp4"));
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src"),
    );
    expect(selected).toHaveBeenCalledWith("film.mp4");
    rerender(
      <WorkspaceFilesPanel
        {...labels}
        threadId="task"
        selectedPath="other.webm"
        onOpenHtml={vi.fn()}
        onFileSelected={selected}
      />,
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("task", "other.webm"),
    );
    expect(read).not.toHaveBeenCalled();
  });
});
