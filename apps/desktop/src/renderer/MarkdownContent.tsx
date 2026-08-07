import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";

const allowedTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

type ImageResolver = (href: string) => Promise<string | undefined>;

interface ImageMarkupOptions {
  height?: string;
  width?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isWorkspaceFileHref(href: string): boolean {
  const value = href.trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return false;
  if (/^(?:https?:|mailto:)/iu.test(value)) return false;
  if (/^file:/iu.test(value) || /^[a-z]:[\\/]/iu.test(value)) return true;
  if (/^(?:blob|data|javascript|tel|vscode):/iu.test(value)) return false;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) return false;
  return true;
}

function remoteImageHref(href: string): string | undefined {
  const value = href.trim();
  if (/^https?:\/\//iu.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (
    /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+/=\s]+$/iu.test(
      value,
    )
  ) {
    return value;
  }
  return undefined;
}

function imageDimension(value: string | undefined, name: "height" | "width") {
  const normalized = value?.trim();
  if (!normalized || !/^[1-9]\d{0,3}$/u.test(normalized)) return "";
  const size = Number(normalized);
  return size <= 4_096 ? ` ${name}="${size}"` : "";
}

function imageMarkup(
  href: string,
  alt: string,
  title: string | null,
  options: ImageMarkupOptions = {},
): string {
  const safeRemoteHref = remoteImageHref(href);
  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
  const dimensions = `${imageDimension(options.height, "height")}${imageDimension(options.width, "width")}`;
  if (safeRemoteHref) {
    const referrerPolicy = /^https?:/iu.test(safeRemoteHref)
      ? ' referrerpolicy="no-referrer"'
      : "";
    return `<img alt="${escapeAttribute(alt)}" loading="lazy"${titleAttribute}${dimensions}${referrerPolicy} src="${escapeAttribute(safeRemoteHref)}">`;
  }
  if (isWorkspaceFileHref(href)) {
    return `<img alt="${escapeAttribute(alt)}" loading="eager"${titleAttribute}${dimensions} data-workspace-image="${escapeAttribute(href)}">`;
  }
  return "";
}

function headingSlug(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/gu, "-") || "section"
  );
}

function rawHtmlAttribute(value: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = value.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu"),
  );
  const attribute = match?.[1] ?? match?.[2];
  return attribute
    ?.replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function linkMarkup(href: string, title: string | null, label: string): string {
  const externalHref = href.startsWith("//") ? `https:${href}` : href;
  if (
    !isWorkspaceFileHref(href) &&
    !/^(?:https?:|mailto:|#)/iu.test(externalHref)
  ) {
    return label;
  }

  const escapedHref = escapeAttribute(externalHref);
  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
  if (isWorkspaceFileHref(href)) {
    return `<a class="workspace-file-link" data-workspace-file="${escapedHref}" href="#"${titleAttribute}>${label}</a>`;
  }
  if (/^https?:/iu.test(externalHref)) {
    return `<a href="${escapedHref}" rel="noopener noreferrer" target="_blank"${titleAttribute}>${label}</a>`;
  }
  return `<a href="${escapedHref}"${titleAttribute}>${label}</a>`;
}

function readerHtmlMarkup(text: string): string {
  const value = text.trim();
  const centered = value.match(
    /^<(div|p)\s+align\s*=\s*(?:"center"|'center'|center)\s*>$/iu,
  );
  if (centered?.[1]) {
    return `<${centered[1].toLowerCase()} class="markdown-align-center">`;
  }
  const centeredClose = value.match(/^<\/(div|p)\s*>$/iu);
  if (centeredClose?.[1]) return `</${centeredClose[1].toLowerCase()}>`;

  const images = [
    ...value.matchAll(
      /(?:<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>\s*)?(<img\b(?:[^>"']|"[^"]*"|'[^']*')*\/?\s*>)(?:\s*<\/a>)?/giu,
    ),
  ].flatMap((match) => {
    const imageTag = match[2];
    if (!imageTag) return [];
    const href = rawHtmlAttribute(imageTag, "src");
    if (!href) return [];
    const height = rawHtmlAttribute(imageTag, "height");
    const width = rawHtmlAttribute(imageTag, "width");
    const image = imageMarkup(
      href,
      rawHtmlAttribute(imageTag, "alt") ?? "",
      rawHtmlAttribute(imageTag, "title") ?? null,
      {
        ...(height ? { height } : {}),
        ...(width ? { width } : {}),
      },
    );
    if (!image) return [];
    const anchor = match[1];
    const anchorHref = anchor ? rawHtmlAttribute(anchor, "href") : undefined;
    return [
      anchorHref
        ? linkMarkup(
            anchorHref,
            rawHtmlAttribute(anchor ?? "", "title") ?? null,
            image,
          )
        : image,
    ];
  });
  if (images.length === 0) return "";
  const centeredBlock = /\balign\s*=\s*(?:"center"|'center'|center)/iu.test(
    value,
  );
  return `<p${centeredBlock ? ' class="markdown-align-center"' : ""}>${images.join("\n")}</p>`;
}

function markdownRenderer(imagesEnabled: boolean) {
  const renderer = new marked.Renderer();
  const headingCounts = new Map<string, number>();
  renderer.html = ({ text }) => (imagesEnabled ? readerHtmlMarkup(text) : "");
  renderer.image = ({ href, title, text }) =>
    imagesEnabled ? imageMarkup(href, text, title) : "";
  renderer.heading = function ({ tokens, depth }) {
    const label = this.parser.parseInline(tokens);
    const baseSlug = headingSlug(
      this.parser.parseInline(tokens, this.parser.textRenderer),
    );
    const duplicateCount = headingCounts.get(baseSlug) ?? 0;
    headingCounts.set(baseSlug, duplicateCount + 1);
    const slug = duplicateCount ? `${baseSlug}-${duplicateCount}` : baseSlug;
    return `<h${depth} id="${escapeAttribute(slug)}">${label}</h${depth}>`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    return linkMarkup(href, title ?? null, label);
  };
  return renderer;
}

function workspaceFileAnchor(
  target: EventTarget | null,
  container: HTMLElement,
): HTMLAnchorElement | undefined {
  const element = target instanceof Element ? target : undefined;
  const anchor = element?.closest<HTMLAnchorElement>("a[data-workspace-file]");
  return anchor && container.contains(anchor) ? anchor : undefined;
}

export function MarkdownContent({
  className,
  onFileLink,
  onFileLinkContextMenu,
  resolveImage,
  text,
}: {
  className?: string;
  onFileLink?: (href: string) => void;
  onFileLinkContextMenu?: (
    href: string,
    position: { x: number; y: number },
  ) => void;
  resolveImage?: ImageResolver;
  text: string;
}) {
  const contentRoot = useRef<HTMLElement>(null);
  const imagesEnabled = Boolean(resolveImage);
  const html = useMemo(() => {
    const renderer = markdownRenderer(imagesEnabled);
    const parsed = marked.parse(text, { async: false, renderer });
    return typeof DOMPurify.sanitize === "function"
      ? DOMPurify.sanitize(parsed, {
          ALLOWED_ATTR: [
            "alt",
            "class",
            "data-workspace-file",
            "data-workspace-image",
            "href",
            "height",
            "id",
            "loading",
            "rel",
            "referrerpolicy",
            "src",
            "target",
            "title",
            "width",
          ],
          ALLOWED_TAGS: allowedTags,
        })
      : parsed;
  }, [imagesEnabled, text]);

  useEffect(() => {
    const root = contentRoot.current;
    if (!root || !resolveImage) return;
    let active = true;
    for (const image of root.querySelectorAll<HTMLImageElement>(
      "img[data-workspace-image]",
    )) {
      const href = image.dataset.workspaceImage;
      if (!href) continue;
      void resolveImage(href)
        .then((source) => {
          if (
            !active ||
            !source ||
            !/^data:image\/(?:avif|gif|jpeg|png|svg\+xml|webp);base64,/iu.test(
              source,
            )
          ) {
            return;
          }
          image.src = source;
          delete image.dataset.workspaceImage;
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [html, resolveImage]);

  const openFileLink = (event: MouseEvent<HTMLElement>) => {
    const anchor = workspaceFileAnchor(event.target, event.currentTarget);
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.dataset.workspaceFile;
    if (href) onFileLink?.(href);
  };

  const openFileLinkMenu = (event: MouseEvent<HTMLElement>) => {
    const anchor = workspaceFileAnchor(event.target, event.currentTarget);
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.dataset.workspaceFile;
    if (href) {
      onFileLinkContextMenu?.(href, {
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  return (
    <article
      className={className ? `${className} markdown-body` : "markdown-body"}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={openFileLink}
      onContextMenu={openFileLinkMenu}
      ref={contentRoot}
    />
  );
}
