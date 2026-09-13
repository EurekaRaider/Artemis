// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerAttachments } from "../src/renderer/ComposerAttachments.js";

afterEach(cleanup);
it("shows attachment cards without a summary row and preserves removal", () => {
  const onRemove = vi.fn();
  const attachments = Array.from({ length: 20 }, (_, index) => ({
    name: `image-${index + 1}.png`,
    mimeType: "image/png" as const,
    data: "AA==",
  }));
  const { container } = render(
    <ComposerAttachments attachments={attachments} zh onRemove={onRemove} />,
  );
  expect(container.querySelector("details, summary")).toBeNull();
  expect(screen.queryByText("20 个附件")).toBeNull();
  expect(container.querySelectorAll(".composer-image-strip img")).toHaveLength(
    20,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "移除图片: image-20.png" }),
  );
  expect(onRemove).toHaveBeenCalledWith(19);
});
