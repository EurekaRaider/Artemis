// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArtifactAnnotation } from "@artemis/protocol";
import { OfficeAnnotationCards } from "../../../src/renderer/office/OfficeAnnotationCards.js";
import { ComposerAttachments } from "../../../src/renderer/conversation/ComposerAttachments.js";
import {
  addOfficeAnnotation,
  changeOfficeAnnotation,
} from "../../../src/renderer/office/office-annotations.js";
const annotation: ArtifactAnnotation = {
  protocolVersion: 1,
  id: "one",
  documentId: "document",
  sessionId: "session",
  sourceVersion: 4,
  selection: {
    kind: "region",
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.1,
  },
  text: "单价是多少？",
};
const locate = vi.fn();
function Harness() {
  const [attachments, setAttachments] = useState(() => {
    let items = addOfficeAnnotation([], "报价.docx", annotation)!;
    for (let i = 2; i <= 5; i++)
      items = addOfficeAnnotation(items, "报价.docx", {
        ...annotation,
        id: String(i),
        text: `批注 ${i}`,
      })!;
    return addOfficeAnnotation(items, "明细.xlsx", {
      ...annotation,
      selection: { kind: "cells", sheet: "预算", range: "D5:D8" },
      text: "核对单价",
    })!;
  });
  return (
    <>
      <ComposerAttachments
        attachments={attachments}
        locale="zh-CN"
        onRemove={() => {}}
      />
      <OfficeAnnotationCards
        attachments={attachments}
        locale="zh-CN"
        onLocate={locate}
        onChange={(index, id, text) => {
          const next = changeOfficeAnnotation(attachments, index, id, text);
          if (!next) return false;
          setAttachments(next);
          return true;
        }}
      />
    </>
  );
}
beforeEach(() => {
  locate.mockClear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);
it("groups six notes, preserves colored icons and expands only the requested group", () => {
  const { container } = render(<Harness />);
  expect(screen.getByText("6 处批注 · 2 个文件")).toBeVisible();
  expect(
    container.querySelectorAll('.attachment-file-icon[data-file-label="DOCX"]'),
  ).toHaveLength(1);
  expect(
    container.querySelectorAll('.attachment-file-icon[data-file-label="XLSX"]'),
  ).toHaveLength(1);
  expect(container.querySelectorAll(".composer-resource-chip")).toHaveLength(0);
  expect(container.textContent).not.toMatch(
    /protocolVersion|documentId|sourceVersion/,
  );
  expect(screen.queryByText("批注 5")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开其余 2 条批注" }));
  expect(screen.getByText("批注 5")).toBeVisible();
  fireEvent.click(screen.getAllByRole("button", { name: "全部折叠" })[0]!);
  expect(screen.getByText("单价是多少？")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "全部展开" }));
  expect(screen.getByText("核对单价")).toBeVisible();
});
it("locates the exact selected region, edits one note and removes the last note of a file", () => {
  render(<Harness />);
  const word = within(screen.getByRole("region", { name: "报价.docx" }));
  fireEvent.click(word.getByRole("button", { name: "查看位置: 1" }));
  expect(locate).toHaveBeenCalledWith({ path: "报价.docx", annotation });
  fireEvent.click(word.getByRole("button", { name: "编辑批注: 1" }));
  const dialog = within(screen.getByRole("dialog", { name: "编辑批注" }));
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "" } });
  expect(dialog.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(dialog.getByRole("textbox"), {
    target: { value: "含税单价是多少？" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "保存" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(word.getByText("含税单价是多少？")).toBeVisible();
  expect(word.getByText("批注 2")).toBeVisible();
  const excel = within(screen.getByRole("region", { name: "明细.xlsx" }));
  fireEvent.click(excel.getByRole("button", { name: "移除批注: 1" }));
  expect(screen.queryByText("明细.xlsx")).toBeNull();
  expect(screen.getByText("5 处批注 · 1 个文件")).toBeVisible();
});
