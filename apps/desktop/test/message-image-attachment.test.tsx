// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageImageAttachment } from "../src/renderer/MessageImageAttachment.js";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const image = {
  name: "photo.png",
  mimeType: "image/png" as const,
  data: "AA==",
};
const props = {
  threadId: "task",
  sourceId: "source",
  name: image.name,
  zh: true,
};
it("renders a persisted thumbnail without reading originals and opens and closes the task-scoped image", async () => {
  const read = vi.fn().mockResolvedValue(image);
  window.artemis = {
    readTaskSourceImage: read,
  } as unknown as typeof window.artemis;
  render(
    <MessageImageAttachment
      {...props}
      thumbnail="data:image/png;base64,AA=="
    />,
  );
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    "data:image/png;base64,AA==",
  );
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看图片: photo.png" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(read).toHaveBeenCalledWith("task", "source");
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("loads old images only on intersection and lets failed reads retry", async () => {
  let intersect: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("missing"))
    .mockResolvedValue(image);
  window.artemis = {
    readTaskSourceImage: read,
  } as unknown as typeof window.artemis;
  render(<MessageImageAttachment {...props} />);
  expect(read).not.toHaveBeenCalled();
  intersect!(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
  expect(await screen.findByText("图片不可用，点击重试")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看图片: photo.png" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  expect(read).toHaveBeenCalledTimes(2);
});
