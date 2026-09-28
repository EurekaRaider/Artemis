// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./renderer-test-utils.js";
import { WorkspaceCsvEditor } from "../src/renderer/WorkspaceCsvEditor.js";

describe("CSV preview and source", () => {
  it("preserves exact source through preview, edits and explicit save", () => {
    const save = vi.fn();
    const original = '\uFEFFid,备注\r\n001,"a,b"\r\n002,"line1\nline2"\r\n';
    function Fixture() {
      const [content, setContent] = useState(original);
      return (
        <WorkspaceCsvEditor
          ariaLabel="CSV source"
          locale="en"
          path="data.csv"
          content={content}
          dirty={content !== original}
          onChange={setContent}
          onSave={() => save(content)}
          saveError={undefined}
          saveState="idle"
          saveLabel="Save"
          savedLabel="Saved"
          savingLabel="Saving"
          unsavedLabel="Unsaved"
          previewLabel="Preview"
          sourceLabel="Source"
        />
      );
    }
    render(<Fixture />);
    expect(screen.getByRole("cell", { name: "001" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "a,b" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    // DOM textareas normalize CRLF; merely toggling the view must not save it.
    expect(screen.getByRole("textbox")).toHaveValue(
      original.replaceAll("\r\n", "\n"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    const edited = 'id,备注\n003,"new, value"';
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: edited },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("cell", { name: "003" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(edited);
  });
});
