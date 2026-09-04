import { useCallback, useEffect, useRef, useState } from "react";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  WorkspaceContentState,
  WorkspaceFileHeader,
  WorkspaceFileLayout,
  WorkspaceFileTree,
  WorkspaceFileTreeRow,
} from "@artemis/ui/workspace";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileContent,
} from "../shared/api.js";
import { WorkspaceFileEditor } from "./WorkspaceFileEditor.js";
import { WorkspaceMarkdownEditor } from "./WorkspaceMarkdownEditor.js";
import {
  filePresentation,
  type WorkspaceFilePresentation,
} from "./workspace-file-presentation.js";
import { setiFileIcon } from "./seti-file-icon.js";

export { setiFileIcon } from "./seti-file-icon.js";

interface WorkspaceFilesPanelProps {
  threadId: string | undefined;
  selectedPath: string | undefined;
  title: string;
  filterPlaceholder: string;
  openFileMessage: string;
  binaryMessage: string;
  imageFailureMessage: string;
  editFileLabel: string;
  refreshLabel: string;
  richLabel: string;
  saveLabel: string;
  savedLabel: string;
  savingLabel: string;
  sourceLabel: string;
  unsavedLabel: string;
  onOpenHtml(path: string): void;
  onFileSelected(path: string): void;
}

interface DirectoryTreeProps {
  childrenByDirectory: Record<string, WorkspaceDirectoryEntry[] | undefined>;
  depth: number;
  entries: WorkspaceDirectoryEntry[];
  expanded: ReadonlySet<string>;
  filter: string;
  loadingDirectories: ReadonlySet<string>;
  selectedPath: string | undefined;
  onOpen(entry: WorkspaceDirectoryEntry): void;
  onToggle(entry: WorkspaceDirectoryEntry): void;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ArtemisIcon
      height={16}
      name={open ? "chevron" : "chev-right"}
      width={16}
    />
  );
}

export function WorkspaceFileIcon({
  path,
  presentation,
  symlink,
}: {
  path: string;
  presentation: WorkspaceFilePresentation;
  symlink: boolean;
}) {
  const icon = setiFileIcon(path, presentation);

  return (
    <span
      aria-hidden="true"
      className="workspace-file-kind"
      data-file-type={presentation.type}
      data-icon-source="seti"
      data-seti-color={icon.color}
    >
      <span
        className="seti-file-icon"
        dangerouslySetInnerHTML={{ __html: icon.svg }}
      />
      {symlink && (
        <svg className="file-icon-link" focusable="false" viewBox="0 0 20 20">
          <path d="M11.5 4.5h4v4M15.5 4.5l-6 6" />
        </svg>
      )}
    </span>
  );
}

function DirectoryTree({
  childrenByDirectory,
  depth,
  entries,
  expanded,
  filter,
  loadingDirectories,
  selectedPath,
  onOpen,
  onToggle,
}: DirectoryTreeProps) {
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleEntries = normalizedFilter
    ? entries.filter(
        (entry) =>
          entry.kind === "directory" ||
          entry.name.toLowerCase().includes(normalizedFilter),
      )
    : entries;

  return (
    <>
      {visibleEntries.map((entry) => {
        const directory = entry.kind === "directory";
        const open = directory && expanded.has(entry.path);
        const presentation = filePresentation(entry.path);
        return (
          <div key={entry.path} role="none">
            <WorkspaceFileTreeRow
              depth={depth}
              directory={directory}
              expanded={open}
              icon={
                directory ? (
                  <span className="workspace-file-kind" />
                ) : (
                  <WorkspaceFileIcon
                    path={entry.path}
                    presentation={presentation}
                    symlink={entry.kind === "symlink"}
                  />
                )
              }
              indicator={directory ? <ChevronIcon open={open} /> : undefined}
              label={entry.name}
              loading={loadingDirectories.has(entry.path)}
              onActivate={() => (directory ? onToggle(entry) : onOpen(entry))}
              selected={selectedPath === entry.path}
              title={entry.path}
            />
            {open && childrenByDirectory[entry.path] && (
              <div role="group">
                <DirectoryTree
                  childrenByDirectory={childrenByDirectory}
                  depth={depth + 1}
                  entries={childrenByDirectory[entry.path] ?? []}
                  expanded={expanded}
                  filter={filter}
                  loadingDirectories={loadingDirectories}
                  selectedPath={selectedPath}
                  onOpen={onOpen}
                  onToggle={onToggle}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function isHtmlPath(path: string): boolean {
  return /\.html?$/iu.test(path);
}

export function WorkspaceFilesPanel({
  threadId,
  selectedPath,
  title,
  filterPlaceholder,
  openFileMessage,
  binaryMessage,
  imageFailureMessage,
  editFileLabel,
  refreshLabel,
  richLabel,
  saveLabel,
  savedLabel,
  savingLabel,
  sourceLabel,
  unsavedLabel,
  onOpenHtml,
  onFileSelected,
}: WorkspaceFilesPanelProps) {
  const activeThreadId = useRef(threadId);
  const [childrenByDirectory, setChildrenByDirectory] = useState<
    Record<string, WorkspaceDirectoryEntry[] | undefined>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [filter, setFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileContent>();
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [saveError, setSaveError] = useState<string>();
  const [error, setError] = useState<string>();
  activeThreadId.current = threadId;

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!threadId) return;
      const requestedThreadId = threadId;
      setLoadingDirectories((current) => new Set(current).add(path));
      setError(undefined);
      try {
        const entries = await window.artemis.listWorkspaceDirectory(
          requestedThreadId,
          path,
        );
        if (activeThreadId.current !== requestedThreadId) return;
        setChildrenByDirectory((current) => ({
          ...current,
          [path]: entries,
        }));
      } catch (reason) {
        if (activeThreadId.current !== requestedThreadId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (activeThreadId.current === requestedThreadId) {
          setLoadingDirectories((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        }
      }
    },
    [threadId],
  );

  useEffect(() => {
    setChildrenByDirectory({});
    setExpanded(new Set());
    setSelectedFile(undefined);
    setDraft("");
    setSaveState("idle");
    setSaveError(undefined);
    setError(undefined);
    if (threadId) void loadDirectory("");
  }, [loadDirectory, threadId]);

  useEffect(() => {
    if (!threadId || !selectedPath || selectedFile?.path === selectedPath) {
      return;
    }
    const requestedThreadId = threadId;
    setError(undefined);
    void window.artemis
      .readWorkspaceFile(threadId, selectedPath)
      .then((file) => {
        if (activeThreadId.current !== requestedThreadId) return;
        setSelectedFile(file);
        setDraft(file.content ?? "");
        setSaveState("idle");
        setSaveError(undefined);
      })
      .catch((reason) => {
        if (activeThreadId.current !== requestedThreadId) return;
        setSelectedFile(undefined);
        setDraft("");
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [selectedFile?.path, selectedPath, threadId]);

  const toggleDirectory = (entry: WorkspaceDirectoryEntry) => {
    const open = expanded.has(entry.path);
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!open && !childrenByDirectory[entry.path]) {
      void loadDirectory(entry.path);
    }
  };

  const openFile = (entry: WorkspaceDirectoryEntry) => {
    if (!threadId) return;
    if (isHtmlPath(entry.path)) {
      onOpenHtml(entry.path);
      return;
    }

    setError(undefined);
    void window.artemis
      .readWorkspaceFile(threadId, entry.path)
      .then((file) => {
        setSelectedFile(file);
        setDraft(file.content ?? "");
        setSaveState("idle");
        setSaveError(undefined);
        onFileSelected(entry.path);
      })
      .catch((reason) => {
        setSelectedFile(undefined);
        setDraft("");
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const saveFile = () => {
    if (
      !threadId ||
      !selectedFile ||
      selectedFile.binary ||
      saveState === "saving" ||
      draft === selectedFile.content
    ) {
      return;
    }
    setSaveState("saving");
    setSaveError(undefined);
    void window.artemis
      .writeWorkspaceFile(threadId, selectedFile.path, draft)
      .then((file) => {
        setSelectedFile(file);
        setDraft(file.content ?? "");
        setSaveState("saved");
      })
      .catch((reason) => {
        setSaveState("idle");
        setSaveError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const refresh = () => {
    setChildrenByDirectory({});
    setExpanded(new Set());
    void loadDirectory("");
  };
  const markdownSelected =
    selectedFile !== undefined &&
    /\.(?:md|markdown)$/iu.test(selectedFile.path);

  return (
    <WorkspaceFileLayout
      label={title}
      viewer={
        selectedFile ? (
          markdownSelected && !selectedFile.binary ? (
            <WorkspaceMarkdownEditor
              ariaLabel={`${editFileLabel}: ${selectedFile.path}`}
              content={draft}
              dirty={draft !== selectedFile.content}
              imageFailureText={imageFailureMessage}
              onChange={(content) => {
                setDraft(content);
                setSaveState("idle");
              }}
              onSave={saveFile}
              path={selectedFile.path}
              // The branch guard above already excludes binary files (they
              // render the preview-empty notice); readOnly is kept as an
              // explicit contract for future call sites.
              readOnly={selectedFile.binary}
              richLabel={richLabel}
              saveError={saveError}
              saveLabel={saveLabel}
              savedLabel={savedLabel}
              saveState={saveState}
              savingLabel={savingLabel}
              sourceLabel={sourceLabel}
              threadId={threadId}
              unsavedLabel={unsavedLabel}
            />
          ) : selectedFile.binary ? (
            <>
              <WorkspaceFileHeader path={selectedFile.path} readOnly />
              <WorkspaceContentState label={binaryMessage} state="read-only">
                {binaryMessage}
              </WorkspaceContentState>
            </>
          ) : (
            <WorkspaceFileEditor
              ariaLabel={`${editFileLabel}: ${selectedFile.path}`}
              content={draft}
              dirty={draft !== selectedFile.content}
              onChange={(content) => {
                setDraft(content);
                setSaveState("idle");
              }}
              onSave={saveFile}
              path={selectedFile.path}
              // Binary files render the preview-empty branch above; readOnly
              // is kept as an explicit contract for future call sites.
              readOnly={selectedFile.binary}
              saveError={saveError}
              saveLabel={saveLabel}
              savedLabel={savedLabel}
              saveState={saveState}
              savingLabel={savingLabel}
              unsavedLabel={unsavedLabel}
            />
          )
        ) : (
          <WorkspaceContentState
            label={error ?? openFileMessage}
            state={error ? "error" : "empty"}
          >
            {error ?? openFileMessage}
          </WorkspaceContentState>
        )
      }
      tree={
        <WorkspaceFileTree
          filterLabel={filterPlaceholder}
          filterPlaceholder={filterPlaceholder}
          filterValue={filter}
          label={title}
          loading={loadingDirectories.has("")}
          onFilterChange={setFilter}
          onRefresh={refresh}
          refreshIcon={<ArtemisIcon height={20} name="refresh" width={20} />}
          refreshLabel={refreshLabel}
        >
          <DirectoryTree
            childrenByDirectory={childrenByDirectory}
            depth={0}
            entries={childrenByDirectory[""] ?? []}
            expanded={expanded}
            filter={filter}
            loadingDirectories={loadingDirectories}
            selectedPath={selectedFile?.path}
            onOpen={openFile}
            onToggle={toggleDirectory}
          />
        </WorkspaceFileTree>
      }
    />
  );
}
