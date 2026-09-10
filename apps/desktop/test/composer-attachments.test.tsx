// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerAttachments } from "../src/renderer/ComposerAttachments.js";

afterEach(cleanup);
it("collapses twenty attachments, preserves order, and supports removal and clearing", () => {
  const onRemove = vi.fn();
  const onClear = vi.fn();
  const attachments = Array.from({ length: 20 }, (_, index) => ({
    name: `image-${index + 1}.png`,
    mimeType: "image/png" as const,
    data: "AA==",
  }));
  const { container } = render(
    <ComposerAttachments
      attachments={attachments}
      zh
      onRemove={onRemove}
      onClear={onClear}
    />,
  );
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(screen.getByText("20 个附件")).toBeInTheDocument();
  expect(
    container.querySelectorAll(".composer-attachments-thumbnails img"),
  ).toHaveLength(3);
  details.open = true;
  expect(
    screen.getByRole("button", { name: "预览: image-20.png" }),
  ).toHaveTextContent("20. image-20.png");
  fireEvent.click(
    screen.getByRole("button", { name: "移除附件: image-20.png" }),
  );
  expect(onRemove).toHaveBeenCalledWith(19);
  fireEvent.click(screen.getByRole("button", { name: "全部清空" }));
  expect(onClear).toHaveBeenCalledOnce();
  fireEvent.keyDown(details, { key: "Escape" });
  expect(details.open).toBe(false);
  expect(container.querySelector("summary")).toHaveFocus();
});
