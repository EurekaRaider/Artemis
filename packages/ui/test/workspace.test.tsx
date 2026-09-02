// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_ACCESSIBLE_NAME_ERROR,
  WORKSPACE_COMPONENT_CONTRACTS,
  WORKSPACE_GEOMETRY_ERROR,
  WORKSPACE_TREE_DEPTH_ERROR,
  WorkspaceContentState,
  WorkspaceDock,
  WorkspaceDockResizer,
  WorkspaceEditorToolbar,
  WorkspaceFileHeader,
  WorkspaceFileLayout,
  WorkspaceFileTree,
  WorkspaceFileTreeRow,
  WorkspaceLauncher,
  WorkspaceLauncherAction,
  WorkspacePreview,
  WorkspaceSourceEditor,
  WorkspaceTab,
  WorkspaceTabBar,
  WorkspaceTabPane,
  validateWorkspaceComponentContracts,
} from "../src/workspace.js";

function icon() {
  return <svg aria-hidden="true" viewBox="0 0 8 8" />;
}

afterEach(() => cleanup());

describe("workspace public contract", () => {
  it("is deeply frozen and rejects contract drift", () => {
    expect(Object.isFrozen(WORKSPACE_COMPONENT_CONTRACTS)).toBe(true);
    expect(Object.isFrozen(WORKSPACE_COMPONENT_CONTRACTS.editorToolbar)).toBe(
      true,
    );
    expect(
      validateWorkspaceComponentContracts(WORKSPACE_COMPONENT_CONTRACTS),
    ).toEqual({ valid: true, errors: [] });
    expect(
      validateWorkspaceComponentContracts({
        ...WORKSPACE_COMPONENT_CONTRACTS,
        dock: { ...WORKSPACE_COMPONENT_CONTRACTS.dock, states: ["open"] },
      }).valid,
    ).toBe(false);
  });

  it("requires perceptible labels and finite dock geometry", () => {
    expect(() =>
      render(
        <WorkspaceDock label={"\u200b"} open>
          Content
        </WorkspaceDock>,
      ),
    ).toThrow(WORKSPACE_ACCESSIBLE_NAME_ERROR);
    expect(() =>
      render(
        <WorkspaceDockResizer
          controls="conversation workspace"
          label="Resize"
          maximum={320}
          minimum={440}
          open
          value={380}
          valueText="380 pixels"
        />,
      ),
    ).toThrow(WORKSPACE_GEOMETRY_ERROR);
  });

  it("hides a closed dock and removes its separator from the tab order", () => {
    render(
      <>
        <WorkspaceDock label="Workspace" open={false}>
          Content
        </WorkspaceDock>
        <WorkspaceDockResizer
          controls="conversation workspace"
          label="Resize workspace"
          maximum={720}
          minimum={320}
          open={false}
          value={440}
          valueText="440 pixels"
        />
      </>,
    );
    const dock = screen.getByLabelText("Workspace", { selector: "aside" });
    const separator = screen.getByRole("separator", { hidden: true });
    expect(dock).toHaveAttribute("aria-hidden", "true");
    expect(dock).toHaveAttribute("inert");
    expect(separator).toHaveAttribute(
      "aria-controls",
      "conversation workspace",
    );
    expect(separator).toHaveAttribute("aria-valuenow", "440");
    expect(separator).toHaveAttribute("tabindex", "-1");
  });

  it("exposes caller-owned live resizing without changing dock ownership", () => {
    render(
      <WorkspaceDock label="Workspace" open resizing>
        Content
      </WorkspaceDock>,
    );
    expect(
      screen.getByLabelText("Workspace", { selector: "aside" }),
    ).toHaveAttribute("data-state", "resizing");
  });

  it("keeps tab selection and close as sibling controls with exact relations", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceTab
        active
        closeIcon={icon()}
        closeLabel="Close README"
        icon={icon()}
        id="readme-tab"
        label="README.md"
        onClose={onClose}
        onSelect={onSelect}
        panelId="readme-panel"
        tabIndex={0}
      />,
    );
    const tab = screen.getByRole("tab", { name: "README.md" });
    const close = screen.getByRole("button", { name: "Close README" });
    expect(tab).toHaveAttribute("aria-controls", "readme-panel");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab.parentElement).toBe(close.parentElement);
    await userEvent.setup().click(tab);
    await userEvent.setup().click(close);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a named tablist with caller-owned scrolling and panel state", () => {
    const onScroll = vi.fn();
    render(
      <>
        <WorkspaceTabBar
          add={<button>Add</button>}
          label="Workspace tabs"
          overflow
          scrollProps={{ onScroll }}
        >
          Tabs
        </WorkspaceTabBar>
        <WorkspaceTabPane active id="active-pane" labelledBy="active-tab">
          Active
        </WorkspaceTabPane>
        <WorkspaceTabPane
          active={false}
          id="inactive-pane"
          labelledBy="inactive-tab"
        >
          Inactive
        </WorkspaceTabPane>
      </>,
    );
    expect(screen.getByRole("tablist", { name: "Workspace tabs" })).toBe(
      document.querySelector('[data-artemis-component="workspace-tab-bar"]'),
    );
    fireEvent.scroll(document.querySelector('[data-part="scroll"]')!);
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tabpanel", { name: "" })).not.toHaveAttribute(
      "hidden",
    );
    expect(document.getElementById("inactive-pane")).toHaveAttribute("hidden");
  });

  it("uses native disabled semantics for unavailable launcher actions", async () => {
    const onActivate = vi.fn();
    render(
      <WorkspaceLauncher label="Open a workspace tool">
        <WorkspaceLauncherAction
          disabled
          icon={icon()}
          label="Unavailable review"
          onActivate={onActivate}
        />
      </WorkspaceLauncher>,
    );
    const action = screen.getByRole("button", { name: "Unavailable review" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("data-state", "disabled");
    await userEvent.setup().click(action);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("workspace editor toolbar", () => {
  const props = {
    dirty: true,
    path: "docs/notes.md",
    readOnly: false,
    saveLabel: "Save",
    savedLabel: "Saved",
    saveState: "idle" as const,
    savingLabel: "Saving",
    unsavedLabel: "Unsaved",
  };

  it("renders dirty, saving, saved, and error states with visible text", () => {
    const { rerender } = render(
      <WorkspaceEditorToolbar {...props} onSave={() => undefined} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved");
    expect(
      document.querySelector(
        '[data-artemis-component="workspace-editor-toolbar"]',
      ),
    ).toHaveAttribute("data-state", "dirty");
    rerender(
      <WorkspaceEditorToolbar
        {...props}
        saveState="saving"
        onSave={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    rerender(
      <WorkspaceEditorToolbar
        {...props}
        dirty={false}
        saveState="saved"
        onSave={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    rerender(
      <WorkspaceEditorToolbar
        {...props}
        saveError="Write failed"
        saveErrorDetail="Permission denied"
        onSave={() => undefined}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write failedPermission denied",
    );
  });

  it("saves on click and forwards caller-owned keyboard handling", async () => {
    const onSave = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <WorkspaceEditorToolbar {...props} onKeyDown={onKeyDown} onSave={onSave}>
        <textarea aria-label="Editor" />
      </WorkspaceEditorToolbar>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editor" }), {
      key: "s",
      metaKey: true,
    });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables mode and save controls in read-only state", () => {
    render(
      <WorkspaceEditorToolbar
        {...props}
        modeToggle={{
          ariaLabel: "Editor mode",
          onChange: () => undefined,
          richLabel: "Rich",
          sourceLabel: "Source",
          value: "rich",
        }}
        onSave={() => undefined}
        readOnly
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rich" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Source" })).toBeDisabled();
  });
});

describe("workspace file presentation", () => {
  it("shows the full file path without owning caller actions", () => {
    render(<WorkspaceFileHeader path="dist/archive.bin" readOnly />);
    const path = screen.getByText("dist/archive.bin");
    expect(path).toHaveAttribute("title", "dist/archive.bin");
    expect(
      document.querySelector(
        '[data-artemis-component="workspace-file-header"]',
      ),
    ).toHaveAttribute("data-state", "read-only");
  });

  it("renders the viewer and a named file tree with filter and refresh", async () => {
    const onFilterChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <WorkspaceFileLayout
        label="Files"
        viewer={
          <WorkspaceContentState label="Open a file" state="empty">
            Open a file
          </WorkspaceContentState>
        }
        tree={
          <WorkspaceFileTree
            filterLabel="Filter files"
            filterPlaceholder="Filter"
            filterValue=""
            label="Project files"
            onFilterChange={onFilterChange}
            onRefresh={onRefresh}
            refreshIcon={icon()}
            refreshLabel="Refresh files"
          >
            <WorkspaceFileTreeRow
              depth={0}
              label="README.md"
              onActivate={() => undefined}
              selected
            />
          </WorkspaceFileTree>
        }
      />,
    );
    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Filter files" }), "readme");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh files" }));
    expect(onFilterChange).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("treeitem", { name: "README.md" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("marks the file tree busy while caller-owned loading is active", () => {
    render(
      <WorkspaceFileTree
        filterLabel="Filter files"
        filterPlaceholder="Filter"
        filterValue=""
        label="Project files"
        loading
        onFilterChange={() => undefined}
        onRefresh={() => undefined}
        refreshIcon={icon()}
        refreshLabel="Refresh files"
      >
        <WorkspaceFileTreeRow
          depth={0}
          label="README.md"
          onActivate={() => undefined}
        />
      </WorkspaceFileTree>,
    );
    expect(
      screen.getByRole("navigation", { name: "Project files" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("exposes directory depth and expansion and rejects invalid depth", () => {
    render(
      <WorkspaceFileTreeRow
        depth={2}
        directory
        expanded
        label="src"
        onActivate={() => undefined}
      />,
    );
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
      "aria-level",
      "3",
    );
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(() =>
      render(
        <WorkspaceFileTreeRow
          depth={-1}
          label="bad"
          onActivate={() => undefined}
        />,
      ),
    ).toThrow(WORKSPACE_TREE_DEPTH_ERROR);
  });

  it("marks loading tree rows as busy without substituting a text glyph", () => {
    render(
      <WorkspaceFileTreeRow
        depth={0}
        directory
        indicator={icon()}
        label="src"
        loading
        onActivate={() => undefined}
      />,
    );
    const row = screen.getByRole("treeitem", { name: "src" });
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(row.querySelector('[data-part="indicator"]')).toContainHTML("<svg");
    expect(row).not.toHaveTextContent("…");
  });

  it("keeps source editing native and highlight content decorative", async () => {
    const onChange = vi.fn();
    render(
      <WorkspaceSourceEditor
        highlight={<span>const answer = 42;</span>}
        label="Source editor"
        language="typescript"
        onChange={onChange}
        value="const answer = 42;"
      />,
    );
    const source = screen.getByRole("textbox", { name: "Source editor" });
    expect(document.querySelector('[data-part="highlight"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await userEvent.setup().type(source, "\n");
    expect(onChange).toHaveBeenCalled();
  });

  it("reflects native disabled source state on the public root", () => {
    render(
      <WorkspaceSourceEditor
        disabled
        label="Disabled source"
        language="text"
        value="Locked"
      />,
    );
    expect(
      document.querySelector(
        '[data-artemis-component="workspace-source-editor"]',
      ),
    ).toHaveAttribute("data-state", "disabled");
    expect(
      screen.getByRole("textbox", { name: "Disabled source" }),
    ).toBeDisabled();
  });

  it("names rich previews and differentiates empty/loading/error states", () => {
    const { rerender } = render(
      <WorkspacePreview label="README preview">
        <h1>README</h1>
      </WorkspacePreview>,
    );
    expect(
      screen.getByRole("region", { name: "README preview" }),
    ).toBeVisible();
    rerender(
      <WorkspaceContentState label="Loading preview" state="loading">
        Loading
      </WorkspaceContentState>,
    );
    const loading = screen.getByRole("status", { name: "Loading preview" });
    expect(loading).toBeVisible();
    expect(loading).toHaveAttribute("aria-busy", "true");
    rerender(
      <WorkspaceContentState label="Preview failed" state="error">
        Preview failed
      </WorkspaceContentState>,
    );
    expect(screen.getByRole("alert", { name: "Preview failed" })).toBeVisible();
  });
});
