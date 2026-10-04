import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AppLocale } from "@artemis/protocol";
import { timelinePreviewCopy } from "./timeline-preview-copy.js";
import { usePreviewVisible } from "./use-preview-visible.js";

let diagramSequence = 0;
let mermaidModule: Promise<typeof import("mermaid")> | undefined;
function loadMermaid() {
  return (mermaidModule ??= import("mermaid")
    .then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        maxTextSize: 30_000,
        maxEdges: 500,
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "htmlLabels",
        ],
        flowchart: { htmlLabels: false },
      });
      return module;
    })
    .catch((error) => {
      mermaidModule = undefined;
      throw error;
    }));
}

export default function TimelineMarkupPreview({
  source,
  kind,
  display = false,
  locale,
}: {
  source: string;
  kind: "mermaid" | "math";
  display?: boolean;
  locale: AppLocale;
}) {
  const { ref, visible } = usePreviewVisible();
  const [result, setResult] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [copied, setCopied] = useState<"yes" | "failed">();
  const t = timelinePreviewCopy(locale);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setResult(undefined);
    setFailed(false);
    setCopied(undefined);
    const render = async () => {
      if (source.length > (kind === "math" ? 10_000 : 30_000))
        throw new Error("Preview input too large.");
      if (kind === "math") {
        const [{ default: katex }] = await Promise.all([
          import("katex"),
          import("katex/dist/katex.min.css"),
        ]);
        return katex.renderToString(source, {
          displayMode: display,
          throwOnError: true,
          trust: false,
          strict: "error",
          maxExpand: 1000,
          maxSize: 20,
        });
      }
      // Diagrams cannot change renderer configuration, CSS or the security policy.
      if (/^\s*---/u.test(source) || /%%\s*\{/u.test(source))
        throw new Error("Diagram configuration is not supported.");
      const { default: mermaid } = await loadMermaid();
      if (!active) return undefined;
      const container = document.createElement("div");
      container.className = "timeline-mermaid-measure";
      document.body.append(container);
      try {
        const { svg } = await mermaid.render(
          `timeline-diagram-${++diagramSequence}`,
          source,
          container,
        );
        // SVG runs in image context, with no active links, scripts or exposed DOM.
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } finally {
        container.remove();
      }
    };
    void render()
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [source, kind, display, visible]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  if (kind === "math")
    return (
      <span
        ref={ref}
        className={display ? "timeline-math display" : "timeline-math"}
        title={source}
      >
        {result ? (
          <span dangerouslySetInnerHTML={{ __html: result }} />
        ) : (
          <code>{source}</code>
        )}
        <button
          type="button"
          className="timeline-math-copy"
          aria-label={
            copied === "yes"
              ? t.copied
              : copied === "failed"
                ? t.copyFailed
                : t.copy
          }
          onClick={() => void copy()}
        >
          ⧉
        </button>
      </span>
    );
  return (
    <span ref={ref} className="timeline-diagram-preview">
      {result ? (
        <button
          type="button"
          className="timeline-image-button"
          aria-label={`${t.enlarge}: ${t.diagram}`}
          onClick={() => setEnlarged(true)}
        >
          <img src={result} alt={t.diagram} />
        </button>
      ) : (
        <span role="status">{failed ? t.failed : t.loading}</span>
      )}
      <details open={failed}>
        <summary>{t.source}</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
      <button type="button" onClick={() => void copy()}>
        {copied === "yes"
          ? t.copied
          : copied === "failed"
            ? t.copyFailed
            : t.copy}
      </button>
      {enlarged &&
        result &&
        createPortal(
          <dialog
            className="composer-attachment-dialog"
            aria-label={t.diagram}
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
              <strong>{t.diagram}</strong>
              <button
                type="button"
                onClick={(e) => e.currentTarget.closest("dialog")?.close()}
              >
                {t.close}
              </button>
            </header>
            <img src={result} alt={t.diagram} />
          </dialog>,
          document.body,
        )}
    </span>
  );
}
