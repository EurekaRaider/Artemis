import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  restoreArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { WorkspaceContentState } from "@artemis/ui/workspace";
import { OfficeWorkbenchPanel } from "./OfficeWorkbenchPanel.js";
import { officeCopy } from "./office-copy.js";
import { OfficePreviewGate } from "./OfficePreviewGate.js";

function OpenOfficeFilePanel({
  path,
  view,
  retryLabel,
  onOpened,
  ...props
}: Omit<ComponentProps<typeof OfficeWorkbenchPanel>, "view"> & {
  path: string;
  view?: ArtifactViewState | undefined;
  retryLabel: string;
  onOpened?(sessionId: string): void;
}) {
  const { threadId, locale } = props;
  const [opened, setOpened] = useState<{
    threadId: string;
    path: string;
    view: ArtifactViewState;
  }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const notifyOpened = useRef(onOpened);
  notifyOpened.current = onOpened;
  // A reused tab can still carry the previous document's session while its
  // requested path has already changed. Resolve that path before displaying it.
  const matchingView = view?.session.path === path ? view : undefined;
  const knownSessionId = matchingView?.session.sessionId;
  useEffect(() => {
    if (knownSessionId) return;
    let active = true;
    setError(undefined);
    setOpened(undefined);
    void window.artemis
      .openOfficeFile(threadId, path)
      .then((snapshot) => {
        if (active) {
          setOpened({
            threadId,
            path,
            view: restoreArtifactSnapshot(undefined, snapshot),
          });
          notifyOpened.current?.(snapshot.session.sessionId);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [threadId, path, knownSessionId, attempt]);
  const localView =
    opened?.threadId === threadId && opened.path === path
      ? opened.view
      : undefined;
  const current =
    matchingView &&
    (!localView ||
      matchingView.session.sessionId !== localView.session.sessionId ||
      matchingView.session.sequence >= localView.session.sequence)
      ? matchingView
      : localView;
  if (current)
    return (
      <OfficeWorkbenchPanel
        key={current.session.sessionId}
        {...props}
        view={current}
      />
    );
  const label = error ?? officeCopy(locale).loading;
  return (
    <WorkspaceContentState label={label} state={error ? "error" : "loading"}>
      <span>{label}</span>
      {error && (
        <Button onClick={() => setAttempt((value) => value + 1)}>
          {retryLabel}
        </Button>
      )}
    </WorkspaceContentState>
  );
}
export function OfficeFilePanel(
  props: ComponentProps<typeof OpenOfficeFilePanel>,
) {
  return (
    <OfficePreviewGate locale={props.locale}>
      <OpenOfficeFilePanel {...props} />
    </OfficePreviewGate>
  );
}
