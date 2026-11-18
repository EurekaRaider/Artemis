import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AppLocale } from "@artemis/protocol";
import { WORKSPACE_HTML_SCHEME } from "../../shared/timeline-preview.js";
import {
  WORKSPACE_HTML_MAX_HEIGHT,
  WORKSPACE_HTML_SIZE_MESSAGE,
  WORKSPACE_HTML_WHEEL_MESSAGE,
} from "../../shared/workspace-html-size.js";
import { HistoryPreviewLayout } from "./history-preview-layout.js";
import { timelinePreviewCopy } from "./timeline-preview-copy.js";
import { usePreviewVisible } from "./use-preview-visible.js";
import {
  AttachmentFileIcon,
  attachmentFileType,
} from "../components/AttachmentFileIcon.js";

export function TimelineDocumentCard({
  path,
  href,
  locale,
  onOpen,
}: {
  path: string;
  href: string;
  locale: AppLocale;
  onOpen?: ((href: string) => void) | undefined;
}) {
  const t = timelinePreviewCopy(locale);
  const icon = attachmentFileType(path);
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  return (
    <span className="timeline-document-card">
      <span
        className="timeline-file-avatar resource-avatar"
        aria-hidden="true"
        style={{ "--timeline-file-color": icon.color } as CSSProperties}
      >
        <AttachmentFileIcon name={path} size={36} />
      </span>
      <span className="timeline-document-name">
        <strong>{name}</strong>
        <span>{path}</span>
      </span>
      <button type="button" onClick={() => onOpen?.(href)} disabled={!onOpen}>
        {t.open}
      </button>
    </span>
  );
}

export function TimelineHtmlPreview({
  threadId,
  path,
  href,
  locale,
  onOpen,
}: {
  threadId: string;
  path: string;
  href: string;
  locale: AppLocale;
  onOpen?: ((href: string) => void) | undefined;
}) {
  const { ref, visible } = usePreviewVisible(true);
  const layout = useContext(HistoryPreviewLayout);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [measurement, setMeasurement] = useState<{
    url: string;
    height: number;
  }>();
  const reservedHeight = measurement?.height ?? layout?.heights.get(href);
  const t = timelinePreviewCopy(locale);
  useEffect(() => {
    if (!visible) {
      setUrl(undefined);
      return;
    }
    let active = true;
    let lease: string | undefined;
    const release = (value: string) => {
      void window.artemis.releaseWorkspaceHtml(threadId, value).catch(() => {});
    };
    setUrl(undefined);
    setFailed(false);
    void window.artemis
      .openWorkspaceHtml(threadId, href)
      .then((result) => {
        if (!active) {
          release(result.url);
          return;
        }
        lease = result.url;
        if (!result.url.startsWith(`${WORKSPACE_HTML_SCHEME}://`)) {
          setFailed(true);
          return;
        }
        setUrl(result.url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (lease) release(lease);
    };
  }, [threadId, href, attempt, visible]);
  // Register before paint so a newly mounted frame cannot outpace the listener.
  useLayoutEffect(() => {
    if (!url) return;
    const resize = (event: MessageEvent) => {
      const data = event.data;
      if (
        !frameRef.current ||
        event.source !== frameRef.current.contentWindow ||
        !data ||
        data.version !== 1 ||
        data.url !== url
      )
        return;
      if (data.type === WORKSPACE_HTML_WHEEL_MESSAGE) {
        if (typeof data.deltaY !== "number" || !Number.isFinite(data.deltaY))
          return;
        const timeline = frameRef.current.closest(".timeline-scroll");
        if (timeline) {
          const deltaY = Math.max(-2000, Math.min(2000, data.deltaY));
          frameRef.current.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, deltaY }),
          );
          timeline.scrollBy(0, deltaY);
        }
        return;
      }
      if (
        data.type !== WORKSPACE_HTML_SIZE_MESSAGE ||
        typeof data.height !== "number" ||
        !Number.isFinite(data.height) ||
        data.height <= 0
      )
        return;
      const height =
        Math.min(WORKSPACE_HTML_MAX_HEIGHT, Math.ceil(data.height)) + 2;
      layout?.heights.set(href, height);
      setMeasurement({ url, height });
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [url, href, layout]);
  return (
    <span ref={ref} className="timeline-html-preview">
      <TimelineDocumentCard
        path={path}
        href={href}
        locale={locale}
        onOpen={onOpen}
      />
      {failed ? (
        <span role="alert">{t.failed}</span>
      ) : (
        <span
          className="timeline-html-viewport"
          style={{ height: reservedHeight }}
        >
          {visible && url ? (
            <iframe
              ref={frameRef}
              title={path}
              src={url}
              style={
                measurement?.url === url
                  ? { height: measurement.height }
                  : undefined
              }
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span role="status">{t.loading}</span>
          )}
        </span>
      )}
      <span className="timeline-preview-toolbar">
        <span>{t.htmlNote}</span>
        {failed && (
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            {t.retry}
          </button>
        )}
      </span>
    </span>
  );
}
