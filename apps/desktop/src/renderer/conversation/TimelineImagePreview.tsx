import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AppLocale } from "@artemis/protocol";
import { remotePreviewImage } from "../../shared/timeline-preview.js";
import { HistoryPreviewLayout } from "./history-preview-layout.js";
import { timelinePreviewCopy } from "./timeline-preview-copy.js";
import { usePreviewVisible } from "./use-preview-visible.js";
import { uiText } from "../../shared/i18n/ui-text.js";

export function TimelineImagePreview({
  threadId,
  path,
  alt,
  locale,
  onOpen,
}: {
  threadId: string;
  path: string;
  alt: string;
  locale: AppLocale;
  onOpen?: ((path: string) => void) | undefined;
}) {
  const { ref, visible } = usePreviewVisible();
  const layout = useContext(HistoryPreviewLayout);
  const cachedSource = layout?.images.get(path);
  const [source, setSource] = useState<string | undefined>(cachedSource);
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const t = timelinePreviewCopy(locale);
  useEffect(() => {
    if (!visible) return;
    const cached = attempt === 0 ? layout?.images.get(path) : undefined;
    if (cached) {
      setSource(cached);
      setFailed(false);
      return;
    }
    let active = true;
    setSource(undefined);
    setFailed(false);
    if (remotePreviewImage(path)) {
      layout?.images.set(path, path);
      setSource(path);
      return;
    }
    void window.artemis
      .readWorkspaceImage(threadId, "", path)
      .then((image) => {
        if (!active) return;
        if (
          !/^image\/(?:avif|png|jpeg|gif|webp|svg\+xml|bmp|x-icon)$/u.test(
            image.mimeType,
          )
        ) {
          setFailed(true);
          return;
        }
        const dataUrl = `data:${image.mimeType};base64,${image.data}`;
        layout?.images.set(path, dataUrl);
        setSource(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [threadId, path, visible, attempt, layout]);
  const resolvedSource = source ?? cachedSource;
  return (
    <span ref={ref} className="timeline-image-preview">
      {failed ? (
        <span role="img" aria-label={alt}>
          {alt} ({uiText(locale, "App_copy.imageFailedToLoad")})
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            {t.retry}
          </button>
          {onOpen && !remotePreviewImage(path) && (
            <button type="button" onClick={() => onOpen(path)}>
              {t.open}
            </button>
          )}
        </span>
      ) : (
        <button
          className="timeline-image-button"
          type="button"
          aria-label={`${t.enlarge}: ${alt}`}
          disabled={!resolvedSource}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEnlarged(true);
          }}
        >
          <img
            alt={alt}
            src={resolvedSource}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              layout?.images.delete(path);
              setFailed(true);
            }}
          />
        </button>
      )}
      {enlarged &&
        resolvedSource &&
        createPortal(
          <dialog
            className="composer-attachment-dialog"
            aria-label={alt}
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            onClose={() => setEnlarged(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget)
                event.currentTarget.close();
            }}
          >
            <header>
              <strong>{alt}</strong>
              <button
                type="button"
                onClick={(e) => e.currentTarget.closest("dialog")?.close()}
              >
                {t.close}
              </button>
            </header>
            <img alt={alt} src={resolvedSource} referrerPolicy="no-referrer" />
          </dialog>,
          document.body,
        )}
    </span>
  );
}
