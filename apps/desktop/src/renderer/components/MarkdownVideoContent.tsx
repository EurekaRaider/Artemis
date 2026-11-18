import {
  createElement,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppLocale } from "@artemis/protocol";
import {
  timelineFileKind,
  remotePreviewImage,
} from "../../shared/timeline-preview.js";
import { HistoryPreviewLayout } from "../conversation/history-preview-layout.js";
import { TimelineImagePreview } from "../conversation/TimelineImagePreview.js";
import {
  TimelineDocumentCard,
  TimelineHtmlPreview,
} from "../conversation/TimelineFilePreview.js";
import "../conversation/timeline-preview.css";
import { WorkspaceVideoPlayer } from "../workspace/WorkspaceVideoPlayer.js";
const TimelineMarkupPreview = lazy(
  () => import("../conversation/TimelineMarkupPreview.js"),
);

// Only receives sanitized markup from MarkdownContent. React owns the media
// nodes so streamed text updates preserve playback, animations and frame state.
export function MarkdownVideoContent({
  html,
  threadId,
  locale,
  onFileLink,
}: {
  html: string;
  threadId: string;
  locale: AppLocale;
  onFileLink?: ((href: string) => void) | undefined;
}) {
  const parsed = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
  }, [html]);
  const layout = useContext(HistoryPreviewLayout);
  const hrefs = useMemo(
    () => [
      ...new Set(
        [
          ...parsed.querySelectorAll<HTMLElement>(
            "[data-workspace-preview],a[data-workspace-file]",
          ),
        ]
          .map(
            (node) =>
              node.dataset.workspacePreview ?? node.dataset.workspaceFile ?? "",
          )
          .filter((href) => timelineFileKind(href) || remotePreviewImage(href)),
      ),
    ],
    [parsed],
  );
  const signature = JSON.stringify(hrefs);
  const [paths, setPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const candidates = (JSON.parse(signature) as string[]).filter(
      (href) => !layout?.paths.has(href),
    );
    if (!candidates.length) return;
    void Promise.all(
      candidates.map(async (href) => {
        try {
          if (remotePreviewImage(href)) return [href, href] as const;
          const { path } = await window.artemis.inspectWorkspaceFileLink(
            threadId,
            href,
          );
          const kind = timelineFileKind(href);
          if (active && (kind === "document" || kind === "html"))
            layout?.paths.set(href, path);
          return [href, path] as const;
        } catch {
          return [href, href] as const;
        }
      }),
    ).then((entries) => {
      if (active) setPaths(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [signature, threadId, layout]);

  const pathFor = (href: string) => {
    const path = paths[href] ?? layout?.paths.get(href);
    if (path) return path;
    // Reserve document cards immediately, including the first visit while
    // main resolves aliases. Actual opens always validate the original href.
    const kind = timelineFileKind(href);
    return kind === "document" || kind === "html"
      ? href.replace(/^\.\//u, "")
      : undefined;
  };

  const embedded = new Set(
    [...parsed.querySelectorAll<HTMLElement>("[data-workspace-preview]")]
      .map((node) => pathFor(node.dataset.workspacePreview ?? ""))
      .filter(Boolean),
  );
  const rendered = new Set<string>();
  const player = (href: string, alt?: string) => {
    const path = pathFor(href);
    if (!path || rendered.has(path)) return null;
    rendered.add(path);
    const kind = remotePreviewImage(href) ? "image" : timelineFileKind(href);
    if (kind === "image")
      return (
        <TimelineImagePreview
          key={path}
          threadId={threadId}
          path={path}
          alt={alt ?? path}
          locale={locale}
          onOpen={onFileLink}
        />
      );
    if (kind === "document")
      return (
        <TimelineDocumentCard
          key={path}
          path={path}
          href={href}
          locale={locale}
          onOpen={onFileLink}
        />
      );
    if (kind === "html")
      return (
        <TimelineHtmlPreview
          key={href}
          threadId={threadId}
          path={path}
          href={href}
          locale={locale}
          onOpen={onFileLink}
        />
      );
    return (
      <WorkspaceVideoPlayer
        key={path}
        threadId={threadId}
        href={path}
        locale={locale}
        onOpen={onFileLink}
      />
    );
  };
  const renderNode = (node: Node, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    if (node.dataset.workspacePreview)
      return player(
        node.dataset.workspacePreview,
        node.getAttribute("aria-label") ?? undefined,
      );
    if (
      node.dataset.mermaidSource !== undefined ||
      node.dataset.mathSource !== undefined
    ) {
      const kind =
        node.dataset.mermaidSource !== undefined ? "mermaid" : "math";
      const source = decodeURIComponent(
        node.dataset.mermaidSource ?? node.dataset.mathSource ?? "",
      );
      return (
        <Suspense key={key} fallback={<code>{source}</code>}>
          <TimelineMarkupPreview
            source={source}
            kind={kind}
            display={node.dataset.mathDisplay === "true"}
            locale={locale}
          />
        </Suspense>
      );
    }
    const attributes: Record<string, string> = {};
    for (const attribute of node.attributes) {
      const name =
        (
          { class: "className", referrerpolicy: "referrerPolicy" } as Record<
            string,
            string
          >
        )[attribute.name] ?? attribute.name;
      attributes[name] = attribute.value;
    }
    const children = [...node.childNodes].map((child, index) =>
      renderNode(child, `${key}.${index}`),
    );
    return createElement(
      node.tagName.toLowerCase(),
      { ...attributes, key },
      ...(children.length ? children : []),
    );
  };
  return (
    <>
      {[...parsed.childNodes].map((node, index) =>
        renderNode(node, String(index)),
      )}
      {hrefs
        .filter((href) => !embedded.has(pathFor(href)))
        .map((href) => player(href))}
    </>
  );
}
