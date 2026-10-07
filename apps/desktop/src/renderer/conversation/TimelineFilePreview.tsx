import {
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
  const { ref, visible } = usePreviewVisible();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>();
  const t = timelinePreviewCopy(locale);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let lease: string | undefined;
    const release = (value: string) => {
      void window.artemis.releaseWorkspaceHtml(threadId, value).catch(() => {});
    };
    setUrl(undefined);
    setHeight(undefined);
    setFailed(false);
    void window.artemis
      .openWorkspaceHtml(threadId, path)
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
  }, [threadId, path, attempt, visible]);
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
        let parent = frameRef.current.parentElement;
        while (parent) {
          if (
            /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
            parent.scrollHeight > parent.clientHeight
          ) {
            const deltaY = Math.max(-2000, Math.min(2000, data.deltaY));
            // Let the timeline recognize user intent before its scroll handler
            // runs; otherwise automatic bottom-following remains enabled.
            frameRef.current.dispatchEvent(
              new WheelEvent("wheel", { bubbles: true, deltaY }),
            );
            parent.scrollTop += deltaY;
            break;
          }
          parent = parent.parentElement;
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
      setHeight(
        Math.min(WORKSPACE_HTML_MAX_HEIGHT, Math.ceil(data.height)) + 2,
      );
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [url]);
  return (
    <span ref={ref} className="timeline-html-preview">
      <TimelineDocumentCard
        path={path}
        href={href}
        locale={locale}
        onOpen={onOpen}
      />
      {url ? (
        <iframe
          ref={frameRef}
          title={path}
          src={url}
          style={height === undefined ? undefined : { height }}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span role={failed ? "alert" : "status"}>
          {failed ? t.failed : t.loading}
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
