// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "../../../src/renderer/components/MarkdownContent.js";
import { timelineFileKind } from "../../../src/shared/timeline-preview.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

afterEach(cleanup);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes spin {to{transform:rotate(360deg)}}</style><circle r="8"><animate attributeName="r" values="8;16;8" dur="1s" repeatCount="indefinite"/></circle><script>window.evil=true</script></svg>';
function api() {
  const read = vi.fn().mockResolvedValue({
    path: "ride.svg",
    mimeType: "image/svg+xml",
    data: btoa(svg),
  });
  stubWindowArtemis({
    inspectWorkspaceFileLink: async (_thread, href) => ({
      path: href.replace("/workspace/", "").replace(/^\.\//, ""),
      viewer: "file",
    }),
    readWorkspaceImage: read,
  });
  return read;
}

describe("timeline SVG previews", () => {
  it("renders an animated SVG in place, deduplicates links and preserves it while text streams", async () => {
    const read = api();
    const open = vi.fn();
    const text =
      "Before\n\n![Ride](ride.svg)\n\nAfter [Download](/workspace/ride.svg)";
    const { container, rerender } = render(
      <MarkdownContent text={text} videoThreadId="task" onFileLink={open} />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src"),
    );
    const image = container.querySelector("img")!;
    expect(image.alt).toBe("Ride");
    expect(image.src).toBe(`data:image/svg+xml;base64,${btoa(svg)}`);
    expect(image.closest("p")?.previousElementSibling).toHaveTextContent(
      "Before",
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("svg,script,iframe,object")).toBeNull();
    rerender(
      <MarkdownContent
        text={text + "\n\nMore text"}
        videoThreadId="task"
        onFileLink={open}
      />,
    );
    expect(container.querySelector("img")).toBe(image);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("task", "", "ride.svg");
    fireEvent.click(screen.getByText("Download"));
    expect(open).toHaveBeenCalledWith("/workspace/ride.svg");
  });

  it("previews local and remote images but never parses code examples as images", async () => {
    const read = api();
    const { container } = render(
      <MarkdownContent
        videoThreadId="task"
        text={
          "[Download](ride.svg) [Again](./ride.svg)\n\n`![Code](code.svg)`\n\n```md\n![Code](block.svg)\n```\n\n![Remote](https://example.com/remote.svg)"
        }
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src"),
    );
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByAltText("Remote")).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "decode", "mime"])(
    "keeps the link and shows failure for %s errors",
    async (failure) => {
      const read = api();
      if (failure === "read")
        read.mockRejectedValue(new Error("outside workspace"));
      if (failure === "mime")
        read.mockResolvedValue({
          mimeType: "text/html",
          data: btoa("<script/>"),
        });
      const { container } = render(
        <MarkdownContent
          videoThreadId="task"
          locale="zh-CN"
          text="[Download](ride.svg)"
        />,
      );
      if (failure === "decode") {
        await waitFor(() =>
          expect(container.querySelector("img")).toHaveAttribute("src"),
        );
        fireEvent.error(container.querySelector("img")!);
      }
      expect(await screen.findByText(/图片加载失败/)).toBeInTheDocument();
      expect(screen.getByText("Download")).toBeInTheDocument();
      expect(container.querySelector("img[src]")).toBeNull();
    },
  );

  it("recognizes local SVG paths without enabling arbitrary schemes", () => {
    for (const href of [
      "ride.svg",
      "./ride.SVG?raw=1",
      "file:///tmp/ride.svg",
      "C:\\art\\ride.svg",
      "海边%20动画.svg",
    ])
      expect(timelineFileKind(href)).toBe("image");
    for (const href of [
      "https://example.com/a.svg",
      "//example.com/a.svg",
      "data:image/svg+xml,<svg/>",
      "javascript:a.svg",
      "#a.svg",
      "%zz.svg",
    ])
      expect(timelineFileKind(href)).toBeUndefined();
  });
});
