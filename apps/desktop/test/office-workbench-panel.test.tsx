// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactAnnotation,
  ArtifactSnapshot,
  ArtifactViewState,
} from "@artemis/protocol";
import { OfficeWorkbenchPanel } from "../src/renderer/OfficeWorkbenchPanel.js";
import {
  cellAddress,
  cellRange,
  cellRangeBounds,
  pageRegion,
} from "../src/renderer/office-preview-selection.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const pdf = vi.hoisted(() => ({
  numPages: 5,
  textItems: [] as Array<{
    str: string;
    transform: number[];
    width: number;
    fontName: string;
  }>,
  getPage: vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      scale,
      convertToViewportPoint: (x: number, y: number) => [
        x * scale,
        (780 - y) * scale,
      ],
      width: 600 * scale,
      height: 780 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({ items: pdf.textItems, styles: {} }),
  })),
  getOutline: vi.fn(
    async (): Promise<Array<{ title: string; dest: number[] }>> => [],
  ),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve(pdf), destroy: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  pdf.textItems = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(format: "word" | "excel" | "powerpoint" = "word") {
  pdf.getOutline.mockResolvedValue(
    format === "excel"
      ? [
          { title: "Budget", dest: [0] },
          { title: "Summary", dest: [1] },
        ]
      : [],
  );
  let snapshot: ArtifactSnapshot = {
    session: {
      protocolVersion: 1,
      documentId: "document",
      sessionId: "session",
      path:
        format === "excel"
          ? "Budget.xlsx"
          : format === "powerpoint"
            ? "Review.pptx"
            : "Brief.docx",
      format,
      engineVersion: "test",
      version: 4,
      savedVersion: 4,
      previewVersion: 4,
      sequence: 1,
      status: "saved",
    },
    sheets: format === "excel" ? ["Budget", "Summary"] : [],
    targets:
      format === "excel"
        ? [
            {
              selection: { kind: "cells", sheet: "Budget", range: "A1" },
              text: "Design",
            },
            {
              selection: { kind: "cells", sheet: "Budget", range: "B2" },
              text: "1250",
            },
            {
              selection: { kind: "cells", sheet: "Summary", range: "A1" },
              text: "Total",
            },
          ]
        : [
            {
              selection: { kind: "paragraph", index: 0, start: 0, end: 5 },
              text: "First paragraph",
            },
          ],
    preview: { version: 4, assetId: "preview" },
    warnings: [],
  };
  stubWindowArtemis({
    readOfficeSnapshot: async () => snapshot,
    openOfficePreview: async () => ({
      data: "",
      version: snapshot.session.version,
    }),
  });
  const onAnnotate = vi.fn();
  const view: ArtifactViewState = {
    session: snapshot.session,
    needsSnapshot: false,
  };
  const result = render(
    <OfficeWorkbenchPanel
      locale="en"
      threadId="thread"
      view={view}
      onAnnotate={onAnnotate}
    />,
  );
  return {
    ...result,
    onAnnotate,
    focus(annotationFocus: ArtifactAnnotation) {
      result.rerender(
        <OfficeWorkbenchPanel
          locale="en"
          threadId="thread"
          view={{ session: snapshot.session, needsSnapshot: false }}
          onAnnotate={onAnnotate}
          annotationFocus={annotationFocus}
        />,
      );
    },
    advance(selection: ArtifactViewState["selection"]) {
      snapshot = {
        ...snapshot,
        session: {
          ...snapshot.session,
          version: 5,
          savedVersion: 5,
          previewVersion: 5,
          sequence: 2,
        },
        preview: { version: 5, assetId: "next" },
      };
      result.rerender(
        <OfficeWorkbenchPanel
          locale="en"
          threadId="thread"
          view={{ session: snapshot.session, needsSnapshot: false, selection }}
          onAnnotate={onAnnotate}
        />,
      );
    },
  };
}

describe("Office workbench review flow", () => {
  it("keeps the document visible until a comment is requested", async () => {
    const { container } = fixture();
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    await waitFor(() =>
      expect(
        container.querySelector("canvas")?.getAttribute("data-preview-version"),
      ).toBe("4"),
    );
    expect(screen.getByText("Brief.docx")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Zoom Fit width" }),
    ).toHaveTextContent("Fit width");
    fireEvent.click(
      screen.getByRole("button", { name: "Comment", exact: true }),
    );
    expect(screen.getByRole("textbox", { name: "Comment" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
  });

  it("keeps a draft tied to its original selection and version during automatic updates", async () => {
    const result = fixture();
    await waitFor(() =>
      expect(
        result.container
          .querySelector("canvas")
          ?.getAttribute("data-preview-version"),
      ).toBe("4"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Comment", exact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Selection /u }));
    fireEvent.click(
      screen.getByRole("option", { name: "Paragraph 1 · First paragraph" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Shorten this paragraph." },
    });
    result.advance({ kind: "paragraph", index: 1, start: 0, end: 8 });
    await waitFor(() =>
      expect(
        result.container
          .querySelector("canvas")
          ?.getAttribute("data-preview-version"),
      ).toBe("5"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
    expect(result.onAnnotate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: 4,
        selection: { kind: "paragraph", index: 0, start: 0, end: 5 },
        text: "Shorten this paragraph.",
      }),
    );
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
  });

  it("opens a contextual comment for a visible page region", async () => {
    const result = fixture();
    await waitFor(() =>
      expect(
        result.container
          .querySelector("canvas")
          ?.getAttribute("data-preview-version"),
      ).toBe("4"),
    );
    const canvas = result.container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 780,
    } as DOMRect);
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 60,
      clientY: 78,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 390 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 300, clientY: 390 });
    expect(
      result.container.querySelector(".office-region-selection"),
    ).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Use more spacing." },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(result.onAnnotate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: 4,
        selection: {
          kind: "region",
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.4,
        },
      }),
    );
  });

  it("supports cell ranges by keyboard and rejects invalid manual ranges", async () => {
    const result = fixture("excel");
    const grid = await screen.findByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(
      within(grid).getAllByRole("gridcell", { selected: true }),
    ).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Check these values." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Cell range" }), {
      target: { value: "invalid" },
    });
    expect(
      screen.getByRole("button", { name: "Add to message" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Cell range" }), {
      target: { value: "$A$1:$B$2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
    expect(result.onAnnotate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersion: 4,
        selection: { kind: "cells", sheet: "Budget", range: "$A$1:$B$2" },
      }),
    );
  });

  it("switches sheets and retains access to the original print rendering", async () => {
    const { container } = fixture("excel");
    await screen.findByRole("grid");
    expect(screen.getByRole("gridcell", { name: "A1 · Design" })).toBeVisible();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Sheet" })).getByRole(
        "button",
        { name: "Summary" },
      ),
    );
    expect(screen.getByRole("gridcell", { name: "A1 · Total" })).toBeVisible();
    expect(screen.queryByRole("gridcell", { name: "A1 · Design" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print preview" }));
    await waitFor(() =>
      expect(
        container
          .querySelector(".office-page-scroll canvas")
          ?.getAttribute("data-preview-version"),
      ).toBe("4"),
    );
    expect(screen.queryByRole("grid")).toBeNull();
    await waitFor(() =>
      expect(
        container
          .querySelector('.office-page-scroll [data-preview-page="2"]')
          ?.getAttribute("data-preview-page"),
      ).toBe("2"),
    );
  });

  it("navigates presentations from the bottom filmstrip and page controls", async () => {
    const { container } = fixture("powerpoint");
    const strip = await screen.findByRole("navigation", { name: "Slides" });
    fireEvent.click(within(strip).getByRole("button", { name: "Page 3" }));
    await waitFor(() =>
      expect(
        container
          .querySelector('.office-page-scroll [data-preview-page="3"]')
          ?.getAttribute("data-preview-page"),
      ).toBe("3"),
    );
    expect(
      within(strip).getByRole("button", { name: "Page 3" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Page 3 / 5" }));
    fireEvent.click(screen.getByRole("option", { name: "4 / 5" }));
    await waitFor(() =>
      expect(
        container
          .querySelector('.office-page-scroll [data-preview-page="4"]')
          ?.getAttribute("data-preview-page"),
      ).toBe("4"),
    );
  });
});

it("normalizes reversed cell ranges and page regions at the page edge", () => {
  expect(cellAddress({ row: 12, column: 28 })).toBe("AB12");
  expect(cellRange({ row: 6, column: 4 }, { row: 4, column: 2 })).toBe("B4:D6");
  expect(cellRangeBounds("$D$6:$B$4")).toEqual({
    top: 4,
    bottom: 6,
    left: 2,
    right: 4,
  });
  expect(cellRangeBounds("A0")).toBeUndefined();
  expect(pageRegion(2, { x: 1, y: 1 }, { x: 0.2, y: 0.3 })).toEqual({
    kind: "region",
    page: 2,
    x: 0.2,
    y: 0.3,
    width: 0.8,
    height: 0.7,
  });
  expect(pageRegion(1, { x: 0, y: 0 }, { x: 0.001, y: 0.002 })).toBeUndefined();
});

it("reveals a saved region and refuses stale coordinates", async () => {
  const result = fixture();
  await waitFor(() =>
    expect(
      result.container
        .querySelector("canvas")
        ?.getAttribute("data-preview-version"),
    ).toBe("4"),
  );
  const annotation: ArtifactAnnotation = {
    protocolVersion: 1,
    id: "focus",
    documentId: "document",
    sessionId: "session",
    sourceVersion: 4,
    selection: {
      kind: "region",
      page: 3,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.1,
    },
    text: "Check this area",
  };
  result.focus(annotation);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Page / })).toHaveTextContent(
      "3 / 5",
    ),
  );
  expect(
    result.container.querySelector(".office-region-selection"),
  ).not.toBeNull();
  result.focus({ ...annotation, id: "stale", sourceVersion: 3 });
  await waitFor(() =>
    expect(screen.getByText(/earlier document version/)).toBeVisible(),
  );
  expect(result.container.querySelector(".office-region-selection")).toBeNull();
});

it("reveals a saved range on the requested worksheet", async () => {
  const result = fixture("excel");
  await screen.findByRole("grid", { name: /Budget/ });
  result.focus({
    protocolVersion: 1,
    id: "cells",
    documentId: "document",
    sessionId: "session",
    sourceVersion: 4,
    selection: { kind: "cells", sheet: "Summary", range: "D5:D8" },
    text: "Check prices",
  });
  const grid = await screen.findByRole("grid", { name: /Summary/ });
  await waitFor(() =>
    expect(grid.querySelector('[data-cell="D5"]')).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
});

it("keeps the entered note when adding it to the composer is rejected", async () => {
  const result = fixture();
  result.onAnnotate.mockReturnValue(false);
  await waitFor(() =>
    expect(result.container.querySelector("canvas")).not.toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: /^Selection / }));
  fireEvent.click(
    screen.getByRole("option", { name: "Paragraph 1 · First paragraph" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(
    "Keep this draft",
  );
});

it("clears a selected region with Escape and with an explicit control", async () => {
  const result = fixture();
  await waitFor(() =>
    expect(
      result.container.querySelector("canvas")?.dataset.previewVersion,
    ).toBe("4"),
  );
  const canvas = result.container.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 80,
    width: 300,
    height: 390,
  } as DOMRect);
  const select = () => {
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 70,
      clientY: 119,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 190, clientY: 275 });
  };
  select();
  fireEvent.keyDown(canvas, { key: "Escape" });
  expect(result.container.querySelector(".office-region-selection")).toBeNull();
  select();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(result.container.querySelector(".office-region-selection")).toBeNull();
  expect(screen.getByRole("button", { name: "Add to message" })).toBeDisabled();
});

it("restores the comment draft after leaving and returning to a document", async () => {
  const first = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
    target: { value: "Keep my review" },
  });
  first.unmount();
  const second = fixture();
  expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(
    "Keep my review",
  );
  fireEvent.click(
    within(second.container.querySelector(".office-annotation")!).getByRole(
      "button",
      { name: "Close" },
    ),
  );
  second.unmount();
  fixture();
  expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
});

it("renders Word pages in one scroll area with a single page picker", async () => {
  const { container } = fixture();
  await waitFor(() =>
    expect(
      container.querySelectorAll(".office-page-scroll canvas"),
    ).toHaveLength(5),
  );
  expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
});

it("dismisses session errors without hiding the session status", async () => {
  const result = fixture();
  result.rerender(
    <OfficeWorkbenchPanel
      locale="en"
      threadId="thread"
      onAnnotate={result.onAnnotate}
      view={{
        needsSnapshot: false,
        session: {
          protocolVersion: 1,
          documentId: "document",
          sessionId: "failed-session",
          path: "Brief.docx",
          format: "word",
          engineVersion: "test",
          version: 4,
          savedVersion: 4,
          sequence: 1,
          status: "failed",
          error: "Office session was closed",
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
  expect(screen.queryByText("Office session was closed")).toBeNull();
});

it.each(["word", "powerpoint", "excel"] as const)(
  "retains and clears comments in %s",
  async (format) => {
    const first = fixture(format);
    await waitFor(() =>
      expect(
        first.container.querySelector('canvas, [role="grid"]'),
      ).not.toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Comment", exact: true }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Retain draft" },
    });
    first.unmount();
    const second = fixture(format);
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(
      "Retain draft",
    );
    if (format === "excel") {
      const grid = await screen.findByRole("grid");
      fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
      fireEvent.keyDown(grid, { key: "Escape" });
      expect(
        within(grid).queryAllByRole("gridcell", { selected: true }),
      ).toHaveLength(0);
    } else {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), {
        key: "Escape",
      });
      expect(
        second.container.querySelector(".office-region-selection"),
      ).toBeNull();
    }
  },
);

it("drags the comment panel within the document stage", async () => {
  const { container } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
  const stage = container.querySelector(".office-stage")!;
  const panel = container.querySelector<HTMLElement>(".office-annotation")!;
  const heading = panel.querySelector<HTMLElement>(
    ".office-annotation-heading",
  )!;
  Object.defineProperties(stage, {
    clientWidth: { value: 900 },
    clientHeight: { value: 700 },
  });
  Object.defineProperties(panel, {
    offsetWidth: { value: 360 },
    offsetHeight: { value: 220 },
  });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
  } as DOMRect);
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    left: 500,
    top: 400,
  } as DOMRect);
  fireEvent.pointerDown(heading, {
    button: 0,
    pointerId: 2,
    clientX: 520,
    clientY: 410,
  });
  fireEvent.pointerMove(heading, { pointerId: 2, clientX: 120, clientY: 110 });
  expect(panel.style.left).toBe("100px");
  expect(panel.style.top).toBe("100px");
  fireEvent.pointerMove(heading, {
    pointerId: 2,
    clientX: -500,
    clientY: -500,
  });
  expect(panel.style.left).toBe("0px");
  expect(panel.style.top).toBe("0px");
});

it("sends the selected PDF text with scaled page coordinates, excluding other text", async () => {
  pdf.textItems = [
    {
      str: "Selected text",
      transform: [12, 0, 0, 12, 100, 650],
      width: 90,
      fontName: "test",
    },
    {
      str: "Other text",
      transform: [12, 0, 0, 12, 100, 100],
      width: 90,
      fontName: "test",
    },
  ];
  const result = fixture();
  await waitFor(() =>
    expect(
      result.container.querySelector("canvas")?.dataset.previewVersion,
    ).toBe("4"),
  );
  const canvas = result.container.querySelector("canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 40,
    top: 80,
    width: 300,
    height: 390,
  } as DOMRect);
  fireEvent.pointerDown(canvas, {
    button: 0,
    pointerId: 1,
    clientX: 70,
    clientY: 119,
  });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 190, clientY: 275 });
  fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
    target: { value: "Review selection" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(result.onAnnotate).toHaveBeenCalledWith(
    expect.objectContaining({
      quote: "Selected text",
      sourceVersion: 4,
      selection: {
        kind: "region",
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.4,
      },
    }),
  );
});

it("ignores invalid persisted review data", () => {
  localStorage.setItem(
    "artemis-office-review:thread:session",
    JSON.stringify({
      protocolVersion: 1,
      open: true,
      note: "old",
      selection: { version: 4 },
    }),
  );
  fixture();
  expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
});
