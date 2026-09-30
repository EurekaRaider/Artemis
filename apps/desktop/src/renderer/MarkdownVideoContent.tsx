import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppLocale } from "@artemis/protocol";
import { workspaceVideoMimeType } from "../shared/workspace-video.js";
import { isLocalSvgHref, WorkspaceSvgPreview } from "./WorkspaceSvgPreview.js";
import { WorkspaceVideoPlayer } from "./WorkspaceVideoPlayer.js";

export function isLocalVideoHref(href: string): boolean {
  if (
    /^(?!file:)[a-z][a-z\d+.-]*:/iu.test(href) &&
    !/^[a-z]:[\\/]/iu.test(href)
  )
    return false;
  if (href.startsWith("//")) return false;
  try {
    return Boolean(workspaceVideoMimeType(decodeURI(href)));
  } catch {
    return false;
  }
}

// Only receives sanitized markup from MarkdownContent. React owns the media
// nodes so later streamed text updates preserve the existing video and SVG image elements.
export function MarkdownVideoContent({
  html,
  threadId,
  locale,
}: {
  html: string;
  threadId: string;
  locale: AppLocale;
}) {
  const parsed = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
  }, [html]);
  const hrefs = [
    ...new Set(
      [
        ...parsed.querySelectorAll<HTMLElement>(
          "[data-workspace-video],[data-workspace-svg],a[data-workspace-file]",
        ),
      ]
        .map(
          (node) =>
            node.dataset.workspaceVideo ??
            node.dataset.workspaceSvg ??
            node.dataset.workspaceFile ??
            "",
        )
        .filter((href) => isLocalVideoHref(href) || isLocalSvgHref(href)),
    ),
  ];
  const signature = JSON.stringify(hrefs);
  const [paths, setPaths] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const candidates = JSON.parse(signature) as string[];
    void Promise.all(
      candidates.map(async (href) => {
        try {
          return [
            href,
            (await window.artemis.inspectWorkspaceFileLink(threadId, href))
              .path,
          ] as const;
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
  }, [signature, threadId]);

  const embedded = new Set(
    [
      ...parsed.querySelectorAll<HTMLElement>(
        "[data-workspace-video],[data-workspace-svg]",
      ),
    ]
      .map(
        (node) =>
          paths[node.dataset.workspaceVideo ?? node.dataset.workspaceSvg ?? ""],
      )
      .filter(Boolean),
  );
  const rendered = new Set<string>();
  const player = (href: string, alt?: string) => {
    const path = paths[href];
    if (!path || rendered.has(path)) return null;
    rendered.add(path);
    if (isLocalSvgHref(href)) {
      return (
        <WorkspaceSvgPreview
          key={path}
          threadId={threadId}
          path={path}
          alt={alt ?? path}
          locale={locale}
        />
      );
    }
    return (
      <WorkspaceVideoPlayer
        key={path}
        threadId={threadId}
        href={href}
        locale={locale}
      />
    );
  };
  const renderNode = (node: Node, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    if (node.dataset.workspaceVideo) return player(node.dataset.workspaceVideo);
    if (node.dataset.workspaceSvg)
      return player(
        node.dataset.workspaceSvg,
        node.getAttribute("aria-label") ?? undefined,
      );
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
        .filter((href) => !embedded.has(paths[href]))
        .map((href) => player(href))}
    </>
  );
}
