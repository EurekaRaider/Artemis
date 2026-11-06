import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import {
  WorkspaceContentState,
  WorkspaceDock,
  WorkspaceDockResizer,
  WorkspaceEditorToolbar,
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
} from "@artemis/ui/workspace";
import { MatrixIcon } from "./shared.js";

export const workspaceCases = {
  "workspace-anatomy"() {
    const { container } = render(
      <WorkspaceDock label="Workspace" open>
        <WorkspaceTabBar label="Workspace tabs">
          <WorkspaceTab
            active
            closeIcon={<MatrixIcon />}
            closeLabel="Close README"
            id="workspace-anatomy-tab"
            label="README.md"
            onClose={() => undefined}
            onSelect={() => undefined}
            panelId="workspace-anatomy-panel"
            tabIndex={0}
          />
        </WorkspaceTabBar>
        <WorkspaceTabPane
          active
          id="workspace-anatomy-panel"
          labelledBy="workspace-anatomy-tab"
        >
          Content
        </WorkspaceTabPane>
      </WorkspaceDock>,
    );
    expect(
      container.querySelector('[data-artemis-component="workspace-dock"]'),
    ).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "README.md" });
    expect(tab.getAttribute("aria-controls")).toBe("workspace-anatomy-panel");
    expect(
      document
        .getElementById("workspace-anatomy-panel")
        ?.getAttribute("aria-labelledby"),
    ).toBe("workspace-anatomy-tab");
    expect(screen.getByRole("button", { name: "Close README" })).toBeTruthy();
  },
  "workspace-state-matrix"() {
    render(
      <>
        <WorkspaceDock label="Closed workspace" open={false}>
          Hidden
        </WorkspaceDock>
        <WorkspaceDockResizer
          controls="conversation dock"
          label="Resize workspace"
          maximum={760}
          minimum={420}
          open={false}
          value={620}
          valueText="620 pixels"
        />
        <WorkspaceLauncher label="Workspace launcher">
          <WorkspaceLauncherAction
            disabled
            icon={<MatrixIcon />}
            label="Review unavailable"
            onActivate={() => undefined}
          />
        </WorkspaceLauncher>
        <WorkspaceEditorToolbar
          dirty
          onSave={() => undefined}
          path="restricted.md"
          readOnly
          saveError="Save failed"
          saveErrorDetail="Permission denied"
          saveLabel="Save"
          savedLabel="Saved"
          saveState="idle"
          savingLabel="Saving"
          unsavedLabel="Unsaved"
        />
        <WorkspaceContentState label="Loading file" state="loading">
          Loading
        </WorkspaceContentState>
        <WorkspaceContentState label="File failed" state="error">
          Failed
        </WorkspaceContentState>
      </>,
    );
    expect(
      screen
        .getByLabelText("Closed workspace", { selector: "aside" })
        .getAttribute("inert"),
    ).not.toBeNull();
    expect(screen.getByRole("separator", { hidden: true }).tabIndex).toBe(-1);
    expect(
      screen.getByRole("button", { name: "Review unavailable" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert", { name: "File failed" })).toBeTruthy();
  },
  async "workspace-controlled-events"() {
    const user = userEvent.setup();
    const select = vi.fn();
    const close = vi.fn();
    const save = vi.fn();
    const filter = vi.fn();
    const refresh = vi.fn();
    const change = vi.fn();
    const keyDown = vi.fn();
    render(
      <WorkspaceFileLayout
        label="Files"
        tree={
          <WorkspaceFileTree
            filterLabel="Filter files"
            filterPlaceholder="Filter"
            filterValue=""
            label="Project files"
            onFilterChange={filter}
            onRefresh={refresh}
            refreshIcon={<MatrixIcon />}
            refreshLabel="Refresh files"
          >
            <WorkspaceFileTreeRow
              depth={0}
              label="README.md"
              onActivate={select}
              selected
            />
          </WorkspaceFileTree>
        }
        viewer={
          <WorkspaceEditorToolbar
            dirty
            onKeyDown={(event) => {
              if (event.key.toLowerCase() === "s") keyDown(event);
            }}
            onSave={save}
            path="README.md"
            readOnly={false}
            saveLabel="Save"
            savedLabel="Saved"
            saveState="idle"
            savingLabel="Saving"
            unsavedLabel="Unsaved"
          >
            <WorkspaceSourceEditor
              label="Source"
              language="markdown"
              onChange={change}
              value="# README"
              variant="markdown"
            />
          </WorkspaceEditorToolbar>
        }
      />,
    );
    await user.click(screen.getByRole("treeitem", { name: "README.md" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Filter files" }),
      "readme",
    );
    await user.click(screen.getByRole("button", { name: "Refresh files" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Source" }), {
      key: "s",
      metaKey: true,
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Source" }), {
      ctrlKey: true,
      isComposing: true,
      key: "s",
    });
    await user.type(
      screen.getByRole("textbox", { name: "Source" }),
      " updated",
    );
    expect(select).toHaveBeenCalledOnce();
    expect(filter).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(keyDown).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
  "workspace-rtl-long-content"() {
    const longLabel =
      "اسم ملف طويل جدا يظل مقروءا ويحافظ على الهندسة المنطقية من اليمين إلى اليسار.md";
    const { container } = render(
      <div dir="rtl">
        <WorkspacePreview label="معاينة مساحة العمل">
          <p>{longLabel.repeat(8)}</p>
        </WorkspacePreview>
        <WorkspaceSourceEditor
          label="مصدر مساحة العمل"
          language="markdown"
          readOnly
          value={longLabel.repeat(8)}
          variant="markdown"
        />
      </div>,
    );
    for (const root of container.querySelectorAll("[data-artemis-component]")) {
      expect(root.closest('[dir="rtl"]')).not.toBeNull();
    }
    expect(
      screen.getByRole("region", { name: "معاينة مساحة العمل" }),
    ).toBeTruthy();
    expect(container.querySelector("[data-artemis-portal]")).toBeNull();
  },
};
