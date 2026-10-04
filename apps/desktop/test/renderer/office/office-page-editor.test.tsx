// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { OfficePageEditor } from "../../../src/renderer/office/OfficePageEditor.js";
import { OfficeEditorState } from "../../../src/renderer/office/office-editor-state.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fixture() {
  const editor = new OfficeEditorState("page-test", "session", "slide.pptx");
  editor.snapshot = {
    session: {
      protocolVersion: 1,
      documentId: "doc",
      sessionId: "session",
      path: "slide.pptx",
      format: "powerpoint",
      engineVersion: "test",
      version: 0,
      savedVersion: 0,
      sequence: 0,
      previewVersion: null,
      status: "saved",
    },
    targets: [
      {
        selection: { kind: "object", page: 1, index: 0 },
        text: "Slide text",
        bounds: { x: 2540, y: 2540, width: 5080, height: 2540 },
      },
    ],
    sheets: [],
    warnings: [],
  };
  const document = {
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale }),
      getTextContent: async () => ({ items: [], styles: {} }),
    }),
  } as unknown as PDFDocumentProxy;
  const canvas = {
    width: 600,
    height: 400,
    getContext: () => ({
      getImageData: () => ({
        data: new Uint8ClampedArray([255, 255, 255, 255]),
      }),
    }),
  } as unknown as HTMLCanvasElement;
  return {
    editor,
    document,
    canvas,
    page: 1,
    version: 0,
    width: 600,
    label: "Edit text",
  };
}

describe("editing on the document page", () => {
  it("keeps document focus for undo after Enter finishes an edit", async () => {
    const props = fixture();
    vi.spyOn(props.editor, "flush").mockResolvedValue();
    const view = render(
      <section className="office-workbench" tabIndex={-1}>
        <OfficePageEditor {...props} />
      </section>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit text: Slide text" }),
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(document.activeElement).toBe(
      view.container.querySelector(".office-workbench"),
    );
  });

  it("scales an active edit with the page without losing focus or the caret", async () => {
    const props = fixture();
    const view = render(<OfficePageEditor {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit text: Slide text" }),
    );
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    input.setSelectionRange(2, 4);
    expect(input.style.left).toBe("72px");
    view.rerender(<OfficePageEditor {...props} width={300} />);
    expect(screen.getByRole("textbox")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
    expect(input.style.left).toBe("36px");
    expect(input.style.top).toBe("36px");
    expect(input.style.width).toBe("72px");
    expect(input.style.fontSize).toBe("10px");
  });

  it("exits editing after a blur has finished saving", async () => {
    const props = fixture();
    let saved!: () => void;
    vi.spyOn(props.editor, "flush").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    render(<OfficePageEditor {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit text: Slide text" }),
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(screen.queryByRole("textbox")).not.toBeNull();
    saved();
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });
});
