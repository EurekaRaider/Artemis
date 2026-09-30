import { useEffect, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";

export function isLocalSvgHref(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("//") || value.startsWith("#")) return false;
  if (
    /^(?!file:)[a-z][a-z\d+.-]*:/iu.test(value) &&
    !/^[a-z]:[\\/]/iu.test(value)
  )
    return false;
  try {
    return /\.svg$/iu.test(
      decodeURIComponent(value.split(/[?#]/u, 1)[0] ?? ""),
    );
  } catch {
    return false;
  }
}

export function WorkspaceSvgPreview({
  threadId,
  path,
  alt,
  locale,
}: {
  threadId: string;
  path: string;
  alt: string;
  locale: AppLocale;
}) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setFailed(false);
    void window.artemis
      .readWorkspaceImage(threadId, "", path)
      .then((image) => {
        if (!active) return;
        if (image.mimeType !== "image/svg+xml") {
          setFailed(true);
          return;
        }
        setSource(`data:image/svg+xml;base64,${image.data}`);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [threadId, path]);

  if (failed)
    return (
      <span role="img" aria-label={alt}>
        {alt} ({uiText(locale, "App_copy.imageFailedToLoad")})
      </span>
    );
  // Image context preserves CSS/SMIL animation without executing SVG scripts
  // or exposing its DOM to the application. Never inline untrusted SVG markup.
  return <img alt={alt} src={source} onError={() => setFailed(true)} />;
}
