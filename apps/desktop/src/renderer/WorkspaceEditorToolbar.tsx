import type { ReactNode } from "react";

export type WorkspaceEditorSaveState = "idle" | "saving" | "saved";

export type WorkspaceEditorView = "rich" | "source";

export interface WorkspaceEditorModeToggle {
  ariaLabel: string;
  onChange(view: WorkspaceEditorView): void;
  richLabel: string;
  sourceLabel: string;
  value: WorkspaceEditorView;
}

export interface WorkspaceEditorToolbarProps {
  children?: ReactNode;
  dirty: boolean;
  modeToggle?: WorkspaceEditorModeToggle;
  path: string;
  readOnly: boolean;
  saveError?: string;
  saveErrorDetail?: string;
  saveLabel: string;
  savedLabel: string;
  saveState: WorkspaceEditorSaveState;
  savingLabel: string;
  unsavedLabel: string;
  onSave(): void;
}

// D#76 PR7 render-only stub: the contract tests in
// test/workspace-editor-toolbar.test.tsx drive the real implementation
// (view-state live region, guarded Meta/Ctrl+S, save/mode controls, alert).
export function WorkspaceEditorToolbar(
  _props: WorkspaceEditorToolbarProps,
): ReactNode {
  return <div className="workspace-editor-toolbar" />;
}
