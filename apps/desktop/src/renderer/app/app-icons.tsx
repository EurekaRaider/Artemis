import { DesignIcon } from "../workspace/WorkspaceLauncherIcon.js";
import { WorkspaceFileIcon } from "../workspace/WorkspaceFilesPanel.js";
import { ChildAgentIcon } from "../components/ChildAgentIcon.js";
import { SourcesIcon } from "../conversation/SourcesPanel.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ArtemisLogo } from "@artemis/ui/icons";

import { filePresentation } from "../workspace/workspace-file-presentation.js";
import { type WorkspaceTabKind } from "../workspace/workspace-tabs.js";

export function ArtemisMark() {
  return (
    <div className="artemis-mark" aria-label="Artemis">
      <ArtemisLogo size={24} />
    </div>
  );
}

export function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <ArtemisIcon
      className="icon"
      height={18}
      name={open ? "folder-open" : "folder"}
      width={18}
    />
  );
}

export function PlusIcon() {
  return <ArtemisIcon className="icon" height={18} name="plus" width={18} />;
}

export function CloseIcon() {
  return <ArtemisIcon className="icon" height={16} name="close" width={16} />;
}

export function QueueIcon() {
  return <ArtemisIcon className="icon" height={18} name="queue" width={18} />;
}

export function MoveToFrontIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="move-front" width={18} />
  );
}

export function TrashIcon() {
  return <ArtemisIcon className="icon" height={18} name="trash" width={18} />;
}

export function EditIcon() {
  return <ArtemisIcon className="icon" height={18} name="edit" width={18} />;
}

export function CopyIcon() {
  return <ArtemisIcon className="icon" height={16} name="copy" width={16} />;
}

export function SearchIcon() {
  return <ArtemisIcon className="icon" height={16} name="search" width={16} />;
}

export function RefreshIcon() {
  return <ArtemisIcon className="icon" height={16} name="refresh" width={16} />;
}

export function ReviewEmptyIcon() {
  return (
    <ArtemisIcon className="icon" height={46} name="review-empty" width={46} />
  );
}

export function ArchiveIcon() {
  return <ArtemisIcon className="icon" height={18} name="archive" width={18} />;
}

export function ResourceIcon() {
  return <ArtemisIcon className="icon" height={18} name="grid" width={18} />;
}

export function TokenUsageIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="token-usage" width={18} />
  );
}

export function AutomationIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="automation" width={18} />
  );
}

export function SettingsIcon() {
  return <ArtemisIcon className="icon" height={17} name="gear" width={17} />;
}

export function ReviewIcon() {
  return <ArtemisIcon className="icon" height={18} name="review" width={18} />;
}

export function LeftSidebarIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="sidebar-l" width={18} />
  );
}

export function RightSidebarIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="sidebar-r" width={18} />
  );
}

export function TerminalIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="terminal" width={18} />
  );
}

export function BrowserIcon() {
  return <ArtemisIcon className="icon" height={18} name="browser" width={18} />;
}

export function MarkdownIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="markdown" width={18} />
  );
}

export function FilesIcon() {
  return <ArtemisIcon className="icon" height={18} name="files" width={18} />;
}

export function WorkspaceTabIcon({
  childAgentId,
  kind,
  path,
}: {
  childAgentId?: string | undefined;
  kind: WorkspaceTabKind;
  path?: string | undefined;
}) {
  if (kind === "review") return <ReviewIcon />;
  if (kind === "terminal") return <TerminalIcon />;
  if (kind === "browser") return <BrowserIcon />;
  if (kind === "markdown") return <MarkdownIcon />;
  if (kind === "sources") return <SourcesIcon />;
  if (kind === "goal")
    return <ArtemisIcon height={16} name="task" width={16} />;
  if (kind === "child-agent") return <ChildAgentIcon identity={childAgentId} />;
  if (kind === "agent-team") return <FolderIcon />;
  if (kind === "file") {
    return path ? (
      <WorkspaceFileIcon
        path={path}
        presentation={filePresentation(path)}
        symlink={false}
      />
    ) : (
      <FilesIcon />
    );
  }
  if (kind === "design") return <DesignIcon />;
  return <FilesIcon />;
}

export function ModeIcon() {
  return (
    <ArtemisIcon className="icon" height={18} name="automation" width={18} />
  );
}

export function ModelIcon() {
  return <ArtemisIcon className="icon" height={18} name="model" width={18} />;
}

export function ChevronIcon() {
  return <ArtemisIcon className="icon" height={14} name="chevron" width={14} />;
}

export function TabScrollIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <ArtemisIcon
      className="icon"
      height={16}
      name={direction === "left" ? "chev-left" : "chev-right"}
      width={16}
    />
  );
}
