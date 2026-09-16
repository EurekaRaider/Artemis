// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileAttachment } from "../src/renderer/FileAttachment.js";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);
it("previews a task file, paginates both ways, and closes", async () => {
  const read = vi
    .fn()
    .mockImplementation(async (_id, offset) =>
      offset === 0
        ? { name: "config.yml", text: "first", nextOffset: 5 }
        : { name: "config.yml", text: "last" },
    );
  window.artemis = {
    previewPromptFile: read,
  } as unknown as typeof window.artemis;
  render(
    <FileAttachment
      name="config.yml"
      id="file"
      threadId="task"
      locale="zh-CN"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "预览文件: config.yml" }));
  expect(await screen.findByText("first")).toBeInTheDocument();
  expect(read).toHaveBeenCalledWith("file", 0, "task");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(await screen.findByText("last")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(await screen.findByText("first")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("renders HTML as inert source text and shows a file icon for missing historical files", async () => {
  const { unmount } = render(
    <FileAttachment
      name="page.html"
      content="<script>alert(1)</script>"
      locale="zh-CN"
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(
    await screen.findByText("<script>alert(1)</script>"),
  ).toBeInTheDocument();
  expect(document.querySelector("dialog script")).toBeNull();
  unmount();
  render(<FileAttachment name="old.txt" locale="zh-CN" />);
  fireEvent.click(screen.getByRole("button"));
  expect(
    await screen.findByRole("img", { name: "文件预览: old.txt" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
