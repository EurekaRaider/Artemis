// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownContent } from "../src/renderer/MarkdownContent.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function clipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}

it.each([undefined, "thread-1"])(
  "copies only the selected code block with media thread %s",
  async (videoThreadId) => {
    const writeText = clipboard();
    const { container, getAllByRole } = render(
      <StrictMode>
        <MarkdownContent
          locale="zh-CN"
          videoThreadId={videoThreadId}
          text={
            'Inline `code`.\n\n```markdown\n# 标题\n\n  <tag> & "原文"\n```\n\n```js\nconst n = 2;\n```'
          }
        />
      </StrictMode>,
    );
    const buttons = getAllByRole("button", { name: "复制代码" });
    expect(buttons).toHaveLength(2);
    expect(container.querySelector(".markdown-code-toolbar")?.textContent).toBe(
      "markdown",
    );
    fireEvent.click(buttons[0]!);
    await waitFor(() =>
      expect(buttons[0]?.getAttribute("aria-label")).toBe("已复制"),
    );
    expect(writeText).toHaveBeenLastCalledWith('# 标题\n\n  <tag> & "原文"\n');
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith("const n = 2;\n");
  },
);

it.each([undefined, "thread-1"])(
  "keeps controls current after streaming and locale changes (%s)",
  async (videoThreadId) => {
    const writeText = clipboard();
    const { getByRole, getAllByRole, rerender } = render(
      <MarkdownContent
        videoThreadId={videoThreadId}
        text={"```markdown\npartial"}
      />,
    );
    rerender(
      <MarkdownContent
        videoThreadId={videoThreadId}
        text={"```markdown\ncomplete\n```"}
      />,
    );
    rerender(
      <MarkdownContent
        videoThreadId={videoThreadId}
        text={"```markdown\ncomplete\n```"}
        onFileLink={() => {}}
      />,
    );
    expect(getAllByRole("button")).toHaveLength(1);
    fireEvent.click(getByRole("button", { name: "Copy code" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("complete\n"),
    );
    rerender(
      <MarkdownContent
        locale="zh-CN"
        videoThreadId={videoThreadId}
        text={"```\nnext\n```"}
      />,
    );
    fireEvent.click(getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("next\n"));
    rerender(
      <MarkdownContent videoThreadId={videoThreadId} text="plain text" />,
    );
    expect(document.querySelector(".markdown-code-copy")).toBeNull();
  },
);

it("reports clipboard failure and allows retry", async () => {
  const writeText = clipboard();
  writeText.mockRejectedValueOnce(new Error("denied"));
  const { getByRole } = render(<MarkdownContent text={"```\nretry\n```"} />);
  fireEvent.click(getByRole("button", { name: "Copy code" }));
  await waitFor(() =>
    expect(getByRole("button", { name: "Copy failed; retry" })).toBeTruthy(),
  );
  fireEvent.click(getByRole("button", { name: "Copy failed; retry" }));
  await waitFor(() =>
    expect(getByRole("button", { name: "Copied" })).toBeTruthy(),
  );
  expect(writeText).toHaveBeenCalledTimes(2);
});
