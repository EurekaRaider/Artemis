// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownContent } from "../../../src/renderer/components/MarkdownContent.js";
import { timelineFileKind } from "../../../src/shared/timeline-preview.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>',
  }),
}));
vi.mock("mermaid", () => ({ default: mermaid }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function api() {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const read = vi
    .fn()
    .mockResolvedValue({ mimeType: "image/png", data: "AA==" });
  const video = vi.fn().mockResolvedValue({
    path: "sound.mp3",
    mimeType: "audio/mpeg",
    version: "1",
    url: "artemis-media://video/test",
  });
  const release = vi.fn().mockResolvedValue(undefined);
  const html = vi
    .fn()
    .mockResolvedValue({ url: "artemis-preview://test/index.html" });
  const releaseHtml = vi.fn().mockResolvedValue(undefined);
  const office = vi.fn();
  stubWindowArtemis({
    inspectWorkspaceFileLink: async (_thread: string, href: string) => ({
      path: href.replace("/workspace/", "").replace(/^\.\//u, ""),
      viewer: "file",
    }),
    readWorkspaceImage: read,
    openWorkspaceVideo: video,
    releaseWorkspaceVideo: release,
    openWorkspaceHtml: html,
    releaseWorkspaceHtml: releaseHtml,
    openOfficeFile: office,
    officeCapabilityStatus: office,
    readWorkspaceFile: office,
  });
  return { read, video, release, html, releaseHtml, office };
}

it("deduplicates image references, keeps images mounted during streaming and handles image failure", async () => {
  const { read } = api();
  const text = "![Chart](chart.png) [Download](/workspace/chart.png)";
  const { container, rerender } = render(
    <MarkdownContent text={text} videoThreadId="task" />,
  );
  await waitFor(() =>
    expect(screen.getByAltText("Chart")).toHaveAttribute(
      "src",
      "data:image/png;base64,AA==",
    ),
  );
  const image = screen.getByAltText("Chart");
  rerender(
    <MarkdownContent
      text={text + "\n\nAdditional explanation"}
      videoThreadId="task"
    />,
  );
  expect(screen.getByAltText("Chart")).toBe(image);
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(read).toHaveBeenCalledOnce();
  fireEvent.error(image);
  expect(await screen.findByText(/image failed to load/iu)).toBeInTheDocument();
  expect(screen.getByText("Download")).toBeInTheDocument();
});

it("plays audio without resetting its position while text streams and releases its lease", async () => {
  const { video, release } = api();
  const text = "![Recording](sound.mp3) [Download](./sound.mp3)";
  const { container, rerender, unmount } = render(
    <MarkdownContent text={text} videoThreadId="task" />,
  );
  await waitFor(() =>
    expect(container.querySelector("audio")).toHaveAttribute("src"),
  );
  const audio = container.querySelector("audio")!;
  audio.currentTime = 9;
  rerender(
    <MarkdownContent text={text + "\n\nTranscript"} videoThreadId="task" />,
  );
  expect(container.querySelector("audio")).toBe(audio);
  expect(audio.currentTime).toBe(9);
  expect(video).toHaveBeenCalledOnce();
  expect(container.querySelectorAll("audio")).toHaveLength(1);
  unmount();
  expect(release).toHaveBeenCalledWith("task", "artemis-media://video/test");
});

it.each(["docx", "xlsx", "pptx", "pdf", "csv"])(
  "shows a %s file card without reading, converting or starting Office",
  async (extension) => {
    const { office } = api();
    const open = vi.fn();
    const path = `report.${extension}`;
    const { container } = render(
      <MarkdownContent
        text={`[Report](${path}) [Again](./${path})`}
        videoThreadId="task"
        onFileLink={open}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in side panel" }),
    );
    expect(open).toHaveBeenCalledWith(path);
    expect(office).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".timeline-document-card")).toHaveLength(
      1,
    );
    expect(container.querySelector("iframe,canvas")).toBeNull();
  },
);

it("embeds HTML in an opaque frame, preserves interaction state and releases the preview", async () => {
  const { html, releaseHtml } = api();
  const { container, rerender, unmount } = render(
    <MarkdownContent text="[Demo](index.html)" videoThreadId="task" />,
  );
  await waitFor(() =>
    expect(container.querySelector("iframe")).toHaveAttribute("src"),
  );
  const frame = container.querySelector("iframe")!;
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(frame).not.toHaveAttribute("srcdoc");
  expect(screen.queryByRole("button", { name: "Refresh preview" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  rerender(
    <MarkdownContent text="[Demo](index.html)\n\nMore" videoThreadId="task" />,
  );
  expect(container.querySelector("iframe")).toBe(frame);
  expect(html).toHaveBeenCalledOnce();
  unmount();
  expect(releaseHtml).toHaveBeenCalledWith(
    "task",
    "artemis-preview://test/index.html",
  );
});

it("fits HTML content, accepts size updates only from its frame and retains the height during streaming", async () => {
  api();
  const { container, rerender } = render(
    <MarkdownContent text="[Demo](index.html)" videoThreadId="task" />,
  );
  await waitFor(() =>
    expect(container.querySelector("iframe")).toHaveAttribute("src"),
  );
  const frame = container.querySelector("iframe")!;
  const report = (
    height: unknown,
    source = frame.contentWindow,
    url = frame.src,
  ) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source,
        data: { type: "artemis:html-size", version: 1, url, height },
      }),
    );
  report(960);
  expect(frame.style.height).toBe("962px");
  for (const height of [-1, NaN, Infinity, "900"]) report(height);
  report(1200, window);
  report(1200, frame.contentWindow, "artemis-preview://old/index.html");
  expect(frame.style.height).toBe("962px");
  rerender(
    <MarkdownContent text="[Demo](index.html)\n\nMore" videoThreadId="task" />,
  );
  expect(container.querySelector("iframe")).toBe(frame);
  expect(frame.style.height).toBe("962px");
  report(480);
  expect(frame.style.height).toBe("482px");
  report(100_000);
  expect(frame.style.height).toBe("30002px");
});

it.each([
  ["lesson.pptx", "slides", "PPTX"],
  ["REPORT.DOCX", "document", "DOCX"],
  ["table.xlsx", "sheet", "XLSX"],
  ["table.csv", "sheet", "CSV"],
  ["report.pdf", "pdf", "PDF"],
  ["index.html", "code", "HTML"],
])("uses colored file artwork on the %s card", async (path, family, label) => {
  api();
  const { container } = render(
    <MarkdownContent text={`[File](${path})`} videoThreadId="task" />,
  );
  await waitFor(() =>
    expect(container.querySelector(".timeline-file-avatar svg")).not.toBeNull(),
  );
  const icon = container.querySelector(".timeline-file-avatar svg")!;
  expect(icon).toHaveAttribute("data-file-type", family);
  expect(icon).toHaveAttribute("data-file-label", label);
  expect(icon.querySelector("linearGradient")).not.toBeNull();
});

it("retains file access on failed embedded media and can retry the image", async () => {
  const { read } = api();
  read.mockRejectedValueOnce(new Error("not ready"));
  const open = vi.fn();
  render(
    <MarkdownContent
      text="![Chart](chart.png)"
      videoThreadId="task"
      onFileLink={open}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Open in side panel" }),
  );
  expect(open).toHaveBeenCalledWith("chart.png");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByAltText("Chart")).toHaveAttribute("src"),
  );
});

it("releases an HTML preview that finishes opening after unmount", async () => {
  const { html, releaseHtml } = api();
  let finish!: (value: { url: string }) => void;
  html.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = render(
    <MarkdownContent text="[Demo](index.html)" videoThreadId="task" />,
  );
  await waitFor(() => expect(html).toHaveBeenCalledOnce());
  unmount();
  await act(async () => {
    finish({ url: "artemis-preview://late/index.html" });
  });
  expect(releaseHtml).toHaveBeenCalledWith(
    "task",
    "artemis-preview://late/index.html",
  );
});

it("defers image and HTML reads until the preview approaches the viewport", async () => {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const { read, html } = api();
  const { container } = render(
    <MarkdownContent
      text="![Chart](chart.png) [Demo](index.html)"
      videoThreadId="task"
    />,
  );
  await waitFor(() =>
    expect(container.querySelector(".timeline-html-preview")).not.toBeNull(),
  );
  await waitFor(() => expect(callbacks).toHaveLength(2));
  expect(read).not.toHaveBeenCalled();
  expect(html).not.toHaveBeenCalled();
  await act(async () => {
    for (const callback of callbacks)
      callback(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
  });
  await waitFor(() => {
    expect(read).toHaveBeenCalledOnce();
    expect(html).toHaveBeenCalledOnce();
  });
});

it("renders inline and display formulas while keeping code, currency and escaped dollars literal", async () => {
  api();
  const { container } = render(
    <MarkdownContent
      videoThreadId="task"
      text={
        "Inline $x^2$ and \\(a+b\\).\n\n$$\\frac{1}{2}$$\n\n\\[c=d\\]\n\n`$code$` costs $5 and $10. Escaped \\$literal\\$.\n\n```tex\n$example$\n```"
      }
    />,
  );
  await waitFor(() =>
    expect(container.querySelectorAll(".katex")).toHaveLength(4),
  );
  expect(container.querySelectorAll(".timeline-math.display")).toHaveLength(2);
  expect(screen.getByText("$code$")).toBeInTheDocument();
  expect(screen.getByText("$example$")).toBeInTheDocument();
  expect(container.textContent).toContain("costs $5 and $10");
});

it("renders Mermaid as an image and leaves invalid diagrams and unsafe math as readable source", async () => {
  api();
  const { container, rerender } = render(
    <MarkdownContent
      videoThreadId="task"
      text={"```mermaid\ngraph LR\nA-->B\n```"}
    />,
  );
  await waitFor(() =>
    expect(screen.getByAltText("Diagram")).toHaveAttribute(
      "src",
      expect.stringContaining("data:image/svg+xml"),
    ),
  );
  expect(container.querySelector("svg,iframe,script")).toBeNull();
  rerender(
    <MarkdownContent
      videoThreadId="task"
      text={
        '```mermaid\n%%{init: {securityLevel: "loose"}}%%\ngraph LR\nA-->B\n```\n\n$\\href{javascript:alert(1)}{click}$'
      }
    />,
  );
  expect(await screen.findByText("Preview unavailable")).toBeInTheDocument();
  expect(container.querySelector("a[href^='javascript:'],script")).toBeNull();
});

it("classifies local previews without admitting external protocols", () => {
  for (const path of [
    "a.svg",
    "image.png",
    "file:///project/a.gif",
    "C:\\images\\a.webp",
  ])
    expect(timelineFileKind(path)).toBe("image");
  expect(timelineFileKind("clip.mp3")).toBe("audio");
  expect(timelineFileKind("a.html")).toBe("html");
  for (const path of [
    "https://example.com/a.html",
    "javascript:foo.svg",
    "//server/file.mp3",
    "#a.png",
    "%zz.png",
  ])
    expect(timelineFileKind(path)).toBeUndefined();
});
