import { ArtemisIcon } from "@artemis/ui/icons";
import { TurnChangeSummary } from "@artemis/ui/conversation";
import { ChevronIcon } from "../app/app-icons.js";
import { useId, useState } from "react";

import { type TurnViewState } from "@artemis/protocol";
import { appCopy } from "../app/app-copy.js";

import { type Locale } from "../app/app-types.js";
export function TurnChangeSetCard({
  locale,
  onReview,
  onUndo,
  turn,
  undoEnabled,
}: {
  locale: Locale;
  onReview: (turnId: string, path?: string) => void;
  onUndo: (turnId: string) => void;
  turn: TurnViewState;
  undoEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fileListId = useId();
  const t = appCopy(locale);
  const changeSet = turn.changeSet;
  if (!changeSet || changeSet.files.length === 0) return null;
  const multiple = changeSet.files.length > 1;
  const visibleFiles = expanded ? changeSet.files : changeSet.files.slice(0, 3);
  const remainingFileCount = changeSet.files.length - 3;
  const hasTextChanges = changeSet.files.some((file) => !file.binary);
  const singleBinary = !multiple && changeSet.files[0]!.binary;
  const title = multiple
    ? t.editedFiles.replace("{{count}}", String(changeSet.files.length))
    : `${t.editedFile} ${changeSet.files[0]!.path.split("/").at(-1)}`;
  const fileRow = (file: (typeof changeSet.files)[number]) => {
    const separator = file.path.lastIndexOf("/") + 1;
    return (
      <li key={file.path}>
        <button
          aria-label={`${t.reviewChanges} ${file.path}`}
          className="turn-change-file"
          onClick={() => onReview(turn.id, file.path)}
          title={file.path}
          type="button"
        >
          <span className="turn-change-file-path">
            <span className="turn-change-directory">
              {file.path.slice(0, separator)}
            </span>
            <span>{file.path.slice(separator)}</span>
          </span>
          {file.binary ? (
            <small>{t.binaryChange}</small>
          ) : (
            <span className="turn-change-file-stats">
              {file.additions > 0 && (
                <span className="addition" data-count={file.additions}>
                  +{file.additions}
                </span>
              )}
              {file.deletions > 0 && (
                <span className="deletion" data-count={file.deletions}>
                  −{file.deletions}
                </span>
              )}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <TurnChangeSummary
      aria-description={t.taskPeriodChanges}
      className={`turn-change-card ${changeSet.status}`}
      header={
        <>
          <div className="turn-change-heading">
            <span className="turn-change-icon" aria-hidden="true">
              <ArtemisIcon className="icon" name="changes" />
            </span>
            <div className="turn-change-heading-copy">
              <strong title={multiple ? title : changeSet.files[0]!.path}>
                {title}
              </strong>
              {singleBinary ? (
                <span className="turn-change-binary">{t.binaryChange}</span>
              ) : (
                hasTextChanges && (
                  <span className="turn-change-total">
                    <span className="addition" data-count={changeSet.additions}>
                      +{changeSet.additions}
                    </span>
                    <span className="deletion" data-count={changeSet.deletions}>
                      −{changeSet.deletions}
                    </span>
                  </span>
                )
              )}
            </div>
          </div>
          <div className="turn-change-actions">
            {changeSet.status === "undone" ? (
              <span className="turn-change-undone">{t.changesUndone}</span>
            ) : (
              <button
                disabled={!undoEnabled}
                onClick={() => onUndo(turn.id)}
                title={changeSet.message}
                type="button"
              >
                {t.undoChanges}
                <ArtemisIcon className="icon" name="undo" />
              </button>
            )}
            <button
              className="turn-change-review"
              onClick={() => onReview(turn.id)}
              type="button"
            >
              {t.reviewChanges}
            </button>
          </div>
        </>
      }
      label={title}
      state={changeSet.status === "unavailable" ? "failed" : changeSet.status}
    >
      <ol className="turn-change-files" id={fileListId}>
        {visibleFiles.map(fileRow)}
      </ol>
      {remainingFileCount > 0 && (
        <button
          aria-controls={fileListId}
          aria-expanded={expanded}
          className="turn-change-more"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {(expanded ? t.hideMoreFiles : t.showMoreFiles).replace(
            "{{count}}",
            String(remainingFileCount),
          )}
          <ChevronIcon />
        </button>
      )}
      {changeSet.message && (
        <p className="turn-change-message">{changeSet.message}</p>
      )}
    </TurnChangeSummary>
  );
}
