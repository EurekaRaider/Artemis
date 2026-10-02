import { useEffect, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { WORKSPACE_HTML_SCHEME } from "../shared/timeline-preview.js";
import { timelinePreviewCopy } from "./timeline-preview-copy.js";
import { usePreviewVisible } from "./use-preview-visible.js";
import { workspaceFileLinkIcon } from "./seti-file-icon.js";

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
  const icon = workspaceFileLinkIcon(path);
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  return (
    <span className="timeline-document-card">
      <span
        className="workspace-file-link-icon"
        aria-hidden="true"
        data-seti-color={icon.color}
        dangerouslySetInnerHTML={{ __html: icon.svg }}
      />
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
  const t = timelinePreviewCopy(locale);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let lease: string | undefined;
    const release = (value: string) => {
      void window.artemis.releaseWorkspaceHtml(threadId, value).catch(() => {});
    };
    setUrl(undefined);
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
          title={path}
          src={url}
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
        <button type="button" onClick={() => setAttempt((v) => v + 1)}>
          {failed ? t.retry : t.refresh}
        </button>
      </span>
    </span>
  );
}
