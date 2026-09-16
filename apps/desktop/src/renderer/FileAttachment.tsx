import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { AttachmentFilePreview } from "../shared/api.js";

export function FileAttachment({
  name,
  id,
  content,
  threadId,
  locale,
  compact = false,
}: {
  name: string;
  id?: string | undefined;
  content?: string | undefined;
  threadId?: string | undefined;
  locale: AppLocale;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [offsets, setOffsets] = useState([0]);
  const [page, setPage] = useState<AttachmentFilePreview>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function read(offset = 0) {
    const current = ++request.current;
    setPage(undefined);
    setLoading(true);
    setError(false);
    try {
      const result = id
        ? await window.artemis.previewPromptFile(id, offset, threadId)
        : content !== undefined
          ? { name, text: content }
          : undefined;
      if (!result) throw new Error("Unavailable");
      if (current === request.current) setPage(result);
    } catch {
      if (current === request.current) setError(true);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={
          compact
            ? "user-message-attachment"
            : "attachment-image-button attachment-file-card"
        }
        aria-label={`${uiText(locale, "FileAttachment.inline1")}: ${name}`}
        title={name}
        onClick={() => {
          setOffsets([0]);
          setOpen(true);
          setPage(undefined);
          void read();
        }}
      >
        <ArtemisIcon
          name="file"
          width={compact ? 14 : 32}
          height={compact ? 14 : 32}
        />
        <span>{name}</span>
      </button>
      {open &&
        createPortal(
          <dialog
            className="composer-attachment-dialog"
            aria-label={name}
            ref={(element) => {
              if (element && !element.open) element.showModal();
            }}
            onClose={() => {
              request.current++;
              setOpen(false);
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget)
                event.currentTarget.close();
            }}
          >
            <header>
              <strong>{name}</strong>
              <button
                type="button"
                aria-label={uiText(locale, "AttachmentImagePreview.inline1")}
                onClick={(event) =>
                  event.currentTarget.closest("dialog")?.close()
                }
              >
                ×
              </button>
            </header>
            {loading && (
              <p role="status">{uiText(locale, "FileAttachment.inline2")}</p>
            )}
            {error && (
              <div
                className="attachment-file-fallback"
                role="img"
                aria-label={`${uiText(locale, "FileAttachment.inline3")}: ${name}`}
              >
                <ArtemisIcon name="file" width={64} height={64} />
                <span>{name}</span>
              </div>
            )}
            {page && (
              <pre className="attachment-file-content">
                {page.text || uiText(locale, "FileAttachment.inline4")}
              </pre>
            )}
            {offsets.length > 1 && (
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  const previous = offsets.slice(0, -1);
                  setOffsets(previous);
                  void read(previous.at(-1));
                }}
              >
                {uiText(locale, "FileAttachment.inline5")}
              </button>
            )}
            {page?.nextOffset !== undefined && (
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setOffsets([...offsets, page.nextOffset!]);
                  void read(page.nextOffset);
                }}
              >
                {uiText(locale, "FileAttachment.inline6")}
              </button>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
