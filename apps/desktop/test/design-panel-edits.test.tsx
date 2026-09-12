// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DesignPanelState, DesignRevision } from "@artemis/protocol";
import { DesignPanel } from "../src/renderer/DesignPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

afterEach(() => vi.unstubAllGlobals());
async function editor() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  const revision: DesignRevision = {
    documentId: "d",
    revisionId: "r",
    parentRevision: null,
    conflict: false,
    digest: "digest",
    createdAt: "2026-09-12T00:00:00Z",
    content: {
      schemaVersion: 1,
      title: "Test",
      brief: "",
      basis: [],
      interactionNotes: "",
      variants: [
        {
          id: "v",
          name: "V",
          description: "",
          pages: [
            {
              id: "p",
              name: "P",
              html: "<p>Hello</p>",
              parameters: [],
              data: {},
            },
          ],
        },
      ],
    },
  };
  const state: DesignPanelState = {
    workflow: "design",
    requests: [],
    documents: [
      {
        documentId: "d",
        revisionId: "r",
        title: "Test",
        updatedAt: revision.createdAt,
      },
    ],
    revision,
    history: [revision],
    sources: {
      v: {
        p: [
          {
            id: "el",
            tag: "p",
            line: 1,
            text: "Hello",
            editable: true,
            container: false,
          },
        ],
      },
    },
  };
  stubWindowArtemis({
    getDesignState: vi.fn(async () => state),
    designAction: vi.fn(async () => state),
    setDesignDraft: vi.fn(async () => {}),
  });
  render(
    <DesignPanel
      threadId="t"
      locale="en"
      mode="execute"
      active={false}
      onConversation={() => {}}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Selected element"), {
    target: { value: "el" },
  });
  return values;
}

it("keeps independent corner-radius edits as separate undo steps", async () => {
  await editor();
  const radius = screen.getByLabelText("Corner radius");
  fireEvent.blur(radius, { target: { value: "4" } });
  fireEvent.blur(radius, { target: { value: "8" } });
  expect(screen.getByText(/2 unsaved edit/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText(/1 unsaved edit/)).toBeInTheDocument();
});

it("coalesces one color interaction and starts a new undo step after blur", async () => {
  await editor();
  const color = screen.getByLabelText("Text color");
  fireEvent.focus(color);
  for (let i = 1; i <= 130; i++)
    fireEvent.change(color, {
      target: { value: `#${i.toString(16).padStart(6, "0")}` },
    });
  expect(screen.getByText(/1 unsaved edit/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.blur(color);
  fireEvent.focus(color);
  fireEvent.change(color, { target: { value: "#ff0000" } });
  expect(screen.getByText(/2 unsaved edit/)).toBeInTheDocument();
});

it("cannot redo a discarded draft", async () => {
  const values = await editor();
  fireEvent.blur(screen.getByLabelText("Corner radius"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Redo" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(screen.queryByRole("button", { name: "Redo" })).toBeNull();
  expect(values.size).toBe(0);
});
