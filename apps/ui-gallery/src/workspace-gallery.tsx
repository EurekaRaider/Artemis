import { useState, type CSSProperties } from "react";

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
  type WorkspaceEditorView,
} from "@artemis/ui/workspace";

import { GalleryActionIcon } from "./gallery-action-icon.js";

const SAMPLE_SOURCE = `# Artemis workspace

The caller owns file data, persistence, and permissions.

- Public components own stable anatomy.
- Desktop adapters own runtime effects.`;

export function WorkspaceGallery() {
  const [activeTab, setActiveTab] = useState<"readme" | "settings">("readme");
  const [source, setSource] = useState(SAMPLE_SOURCE);
  const [savedSource, setSavedSource] = useState(SAMPLE_SOURCE);
  const [view, setView] = useState<WorkspaceEditorView>("rich");
  const [filter, setFilter] = useState("");
  const [dockWidth, setDockWidth] = useState(620);
  const dirty = source !== savedSource;
  const resize = (direction: -1 | 1) =>
    setDockWidth((current) =>
      Math.min(760, Math.max(420, current + direction * 16)),
    );

  return (
    <div className="gallery-workspace-grid">
      <div className="gallery-workspace-shell">
        <section
          aria-label="Conversation minimum-width sample"
          id="gallery-workspace-conversation"
        >
          <p>Conversation remains readable while the workspace resizes.</p>
        </section>
        <WorkspaceDock
          id="gallery-workspace-dock"
          label="Workspace dock sample"
          open
          style={
            { "--workspace-dock-width": `${dockWidth}px` } as CSSProperties
          }
        >
          <WorkspaceTabBar
            add={<button type="button">Add</button>}
            label="Workspace gallery tabs"
          >
            <WorkspaceTab
              active={activeTab === "readme"}
              closeIcon={<GalleryActionIcon />}
              closeLabel="Close README"
              icon={<GalleryActionIcon />}
              id="gallery-workspace-readme-tab"
              label="README.md"
              onClose={() => setActiveTab("settings")}
              onSelect={() => setActiveTab("readme")}
              panelId="gallery-workspace-readme-panel"
              tabIndex={activeTab === "readme" ? 0 : -1}
            />
            <WorkspaceTab
              active={activeTab === "settings"}
              closeIcon={<GalleryActionIcon />}
              closeLabel="Close settings"
              icon={<GalleryActionIcon />}
              id="gallery-workspace-settings-tab"
              label="A very long localized settings filename.json"
              onClose={() => setActiveTab("readme")}
              onSelect={() => setActiveTab("settings")}
              panelId="gallery-workspace-settings-panel"
              tabIndex={activeTab === "settings" ? 0 : -1}
            />
          </WorkspaceTabBar>
          <div className="gallery-workspace-tab-content">
            <WorkspaceTabPane
              active={activeTab === "readme"}
              id="gallery-workspace-readme-panel"
              labelledBy="gallery-workspace-readme-tab"
            >
              <WorkspaceFileLayout
                label="Workspace files sample"
                tree={
                  <WorkspaceFileTree
                    filterLabel="Filter workspace files"
                    filterPlaceholder="Filter files"
                    filterValue={filter}
                    label="Project files"
                    onFilterChange={setFilter}
                    onRefresh={() => undefined}
                    refreshIcon={<GalleryActionIcon />}
                    refreshLabel="Refresh workspace files"
                  >
                    <WorkspaceFileTreeRow
                      depth={0}
                      directory
                      expanded
                      indicator={<GalleryActionIcon />}
                      label="docs"
                      onActivate={() => undefined}
                    />
                    <WorkspaceFileTreeRow
                      depth={1}
                      icon={<GalleryActionIcon />}
                      label="README.md"
                      onActivate={() => setActiveTab("readme")}
                      selected
                    />
                    <WorkspaceFileTreeRow
                      depth={0}
                      disabled
                      icon={<GalleryActionIcon />}
                      label="restricted-config.json"
                      onActivate={() => undefined}
                    />
                  </WorkspaceFileTree>
                }
                viewer={
                  <WorkspaceEditorToolbar
                    dirty={dirty}
                    modeToggle={{
                      ariaLabel: "README display mode",
                      onChange: setView,
                      richLabel: "Rich",
                      sourceLabel: "Source",
                      value: view,
                    }}
                    onSave={() => setSavedSource(source)}
                    path="docs/README.md"
                    readOnly={false}
                    saveLabel="Save"
                    savedLabel="Saved"
                    saveState={dirty ? "idle" : "saved"}
                    savingLabel="Saving"
                    unsavedLabel="Unsaved"
                  >
                    {view === "rich" ? (
                      <WorkspacePreview label="README rich preview">
                        <article>
                          <h3>Artemis workspace</h3>
                          <p>
                            Public components own presentation while caller data
                            and effects stay outside the package.
                          </p>
                        </article>
                      </WorkspacePreview>
                    ) : (
                      <WorkspaceSourceEditor
                        label="README source"
                        language="markdown"
                        onChange={(event) => setSource(event.target.value)}
                        value={source}
                        variant="markdown"
                      />
                    )}
                  </WorkspaceEditorToolbar>
                }
              />
            </WorkspaceTabPane>
            <WorkspaceTabPane
              active={activeTab === "settings"}
              id="gallery-workspace-settings-panel"
              labelledBy="gallery-workspace-settings-tab"
            >
              <WorkspaceContentState
                label="Settings file read-only"
                state="read-only"
              >
                This file is read-only.
              </WorkspaceContentState>
            </WorkspaceTabPane>
          </div>
        </WorkspaceDock>
        <WorkspaceDockResizer
          controls="gallery-workspace-conversation gallery-workspace-dock"
          id="gallery-workspace-resizer"
          label="Resize workspace gallery"
          maximum={760}
          minimum={420}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resize(-1);
            if (event.key === "ArrowRight") resize(1);
            if (event.key === "Home") setDockWidth(620);
            if (event.key === "End") setDockWidth(760);
          }}
          open
          value={dockWidth}
          valueText={`${dockWidth} pixels`}
        />
      </div>

      <div className="gallery-workspace-states">
        <WorkspaceLauncher label="Empty workspace launcher">
          <WorkspaceLauncherAction
            icon={<GalleryActionIcon />}
            label="Open Files"
            onActivate={() => undefined}
            shortcut="⌘1"
          />
          <WorkspaceLauncherAction
            disabled
            icon={<GalleryActionIcon />}
            label="Review unavailable"
            onActivate={() => undefined}
          />
        </WorkspaceLauncher>
        <WorkspaceEditorToolbar
          dirty
          onSave={() => undefined}
          path="src/protected.ts"
          readOnly
          saveError="Save failed"
          saveErrorDetail="The caller denied write permission."
          saveLabel="Save"
          savedLabel="Saved"
          saveState="idle"
          savingLabel="Saving"
          unsavedLabel="Unsaved"
        >
          <WorkspaceSourceEditor
            label="Read-only TypeScript source"
            language="typescript"
            readOnly
            value="export const immutable = true;"
          />
        </WorkspaceEditorToolbar>
      </div>
    </div>
  );
}
