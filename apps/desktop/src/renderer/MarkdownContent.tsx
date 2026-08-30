import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";

import { workspaceFileLinkIcon } from "./seti-file-icon.js";

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
  "span",
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

export function externalLinkFaviconUrl(href: string): string | undefined {
  const value = href.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return `${url.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
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

function linkMarkup(
  href: string,
  title: string | null,
  label: string,
  fileLinkIcons = false,
  delegateExternalLinks = false,
  externalLinkIcons = false,
): string {
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
    const icon = fileLinkIcons
      ? '<span aria-hidden="true" class="workspace-file-link-icon"></span>'
      : "";
    const className = fileLinkIcons
      ? "workspace-file-link with-icon"
      : "workspace-file-link";
    return `<a class="${className}" data-workspace-file="${escapedHref}" href="#"${titleAttribute}>${icon}${label}</a>`;
  }
  if (/^https?:/iu.test(externalHref)) {
    if (delegateExternalLinks) {
      const icon = externalLinkIcons
        ? '<span aria-hidden="true" class="external-link-icon" data-external-link-icon></span>'
        : "";
      const classAttribute = externalLinkIcons
        ? ' class="external-http-link with-icon"'
        : "";
      const externalTitleAttribute = titleAttribute
        ? titleAttribute
        : ` title="${escapedHref}"`;
      return `<a${classAttribute} data-external-http="${escapedHref}" href="${escapedHref}" rel="noopener noreferrer"${externalTitleAttribute}>${icon}${label}</a>`;
    }
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

function markdownRenderer(
  imagesEnabled: boolean,
  fileLinkIcons: boolean,
  delegateExternalLinks: boolean,
  externalLinkIcons: boolean,
) {
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
    return linkMarkup(
      href,
      title ?? null,
      label,
      fileLinkIcons,
      delegateExternalLinks,
      externalLinkIcons,
    );
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

function externalHttpAnchor(
  target: EventTarget | null,
  container: HTMLElement,
): HTMLAnchorElement | undefined {
  const element = target instanceof Element ? target : undefined;
  const anchor = element?.closest<HTMLAnchorElement>("a[data-external-http]");
  return anchor && container.contains(anchor) ? anchor : undefined;
}

// Default English copy; workspace readers pass a localized failure message
// through the imageFailureText prop while timeline Markdown keeps the default.
const WORKSPACE_IMAGE_FAILURE_TEXT = "image failed to load";

// A workspace image whose resolver rejects or yields a non-image payload is
// swapped for an accessible, text-bearing placeholder so its slot never
// collapses into a bare broken <img>. A resolver that returns no source yet
// leaves the image pending instead: the preview panel resolves images only
// after its file finishes loading, and a placeholder could never be retried.
function replaceWorkspaceImageWithPlaceholder(
  image: HTMLImageElement,
  href: string,
  failureText: string,
): void {
  const alt = image.getAttribute("alt")?.trim() ?? "";
  const label = alt ? `${alt} (${failureText})` : `${failureText}: ${href}`;
  const placeholder = document.createElement("span");
  placeholder.setAttribute("aria-label", label);
  placeholder.dataset.workspaceImageFailed = href;
  placeholder.setAttribute("role", "img");
  placeholder.textContent = label;
  image.replaceWith(placeholder);
}

export const MarkdownContent = memo(function MarkdownContent({
  className,
  externalLinkIcons = false,
  fileLinkIcons = false,
  imageFailureText = WORKSPACE_IMAGE_FAILURE_TEXT,
  onExternalLink,
  onFileLink,
  onFileLinkContextMenu,
  resolveImage,
  text,
}: {
  className?: string;
  externalLinkIcons?: boolean;
  fileLinkIcons?: boolean;
  imageFailureText?: string;
  onExternalLink?: (href: string) => void;
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
  const delegateExternalLinks = Boolean(onExternalLink);
  const html = useMemo(() => {
    const renderer = markdownRenderer(
      imagesEnabled,
      fileLinkIcons,
      delegateExternalLinks,
      externalLinkIcons,
    );
    const parsed = marked.parse(text, { async: false, renderer });
    return typeof DOMPurify.sanitize === "function"
      ? DOMPurify.sanitize(parsed, {
          ALLOWED_ATTR: [
            "alt",
            "aria-hidden",
            "class",
            "data-external-link-icon",
            "data-external-http",
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
  }, [
    delegateExternalLinks,
    externalLinkIcons,
    fileLinkIcons,
    imagesEnabled,
    text,
  ]);

  useLayoutEffect(() => {
    const root = contentRoot.current;
    if (!root || !fileLinkIcons) return;
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
      "a.workspace-file-link.with-icon[data-workspace-file]",
    )) {
      const href = anchor.dataset.workspaceFile;
      const iconRoot = anchor.querySelector<HTMLElement>(
        ".workspace-file-link-icon",
      );
      if (!href || !iconRoot) continue;
      const icon = workspaceFileLinkIcon(href);
      iconRoot.dataset.setiColor = icon.color;
      // The SVG is bundled with seti-file-icons; no Markdown input is parsed here.
      iconRoot.innerHTML = icon.svg;
    }
  }, [fileLinkIcons, html]);

  useEffect(() => {
    const root = contentRoot.current;
    if (!root || !externalLinkIcons) return;
    const faviconImages: HTMLImageElement[] = [];
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
      "a.external-http-link.with-icon[data-external-http]",
    )) {
      const faviconUrl = externalLinkFaviconUrl(
        anchor.dataset.externalHttp ?? "",
      );
      const iconRoot = anchor.querySelector<HTMLElement>(
        "[data-external-link-icon]",
      );
      if (!faviconUrl || !iconRoot) continue;

      const image = document.createElement("img");
      image.alt = "";
      image.className = "external-link-favicon";
      image.decoding = "async";
      image.draggable = false;
      image.referrerPolicy = "no-referrer";
      image.onload = () => iconRoot.classList.add("favicon-loaded");
      image.onerror = () => image.remove();
      image.src = faviconUrl;
      iconRoot.append(image);
      faviconImages.push(image);
    }
    return () => {
      for (const image of faviconImages) {
        image.onload = null;
        image.onerror = null;
        image.parentElement?.classList.remove("favicon-loaded");
        image.remove();
      }
    };
  }, [externalLinkIcons, html]);

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
          if (!active || !source) {
            return;
          }
          if (
            !/^data:image\/(?:avif|gif|jpeg|png|svg\+xml|webp);base64,/iu.test(
              source,
            )
          ) {
            replaceWorkspaceImageWithPlaceholder(image, href, imageFailureText);
            return;
          }
          image.src = source;
          delete image.dataset.workspaceImage;
        })
        .catch(() => {
          if (active) {
            replaceWorkspaceImageWithPlaceholder(image, href, imageFailureText);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [html, imageFailureText, resolveImage]);

  const openDelegatedLink = (event: MouseEvent<HTMLElement>) => {
    const fileAnchor = workspaceFileAnchor(event.target, event.currentTarget);
    if (fileAnchor) {
      event.preventDefault();
      const href = fileAnchor.dataset.workspaceFile;
      if (href) onFileLink?.(href);
      return;
    }

    const externalAnchor = externalHttpAnchor(
      event.target,
      event.currentTarget,
    );
    if (!externalAnchor) return;
    event.preventDefault();
    const href = externalAnchor.dataset.externalHttp;
    if (href) onExternalLink?.(href);
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
      onClick={openDelegatedLink}
      onContextMenu={openFileLinkMenu}
      ref={contentRoot}
    />
  );
});
