// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownContent } from "../src/renderer/MarkdownContent.js";

afterEach(cleanup);

it("keeps file icons when a message rerenders with new callbacks", () => {
  const text = "交接文档已完成：[AI_HANDOFF_V2.md](AI_HANDOFF_V2.md)";
  const first = vi.fn();
  const next = vi.fn();
  const { container, rerender } = render(
    <MarkdownContent fileLinkIcons onFileLink={first} text={text} />,
  );
  expect(
    container.querySelector(".workspace-file-link-icon svg path"),
  ).not.toBeNull();
  rerender(<MarkdownContent fileLinkIcons onFileLink={next} text={text} />);
  expect(
    container.querySelector(".workspace-file-link-icon svg path"),
  ).not.toBeNull();
  fireEvent.click(container.querySelector("a")!);
  expect(next).toHaveBeenCalledWith("AI_HANDOFF_V2.md");
  expect(first).not.toHaveBeenCalled();

  rerender(
    <MarkdownContent
      fileLinkIcons
      onFileLink={next}
      text="[配置](package.json)"
    />,
  );
  expect(
    container.querySelector(".workspace-file-link-icon svg path"),
  ).not.toBeNull();
  fireEvent.click(container.querySelector("a")!);
  expect(next).toHaveBeenLastCalledWith("package.json");
});
