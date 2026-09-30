import { useEffect, useRef, useState } from "react";
import "./design-plugin-panel.css";

/**
 * S1 design-plugin panel mount.
 *
 * Ensures the main-process PanelHost has a sandboxed WebContentsView for
 * (threadId, panelId), mirrors the container element's bounds to it on
 * layout changes, and reports visibility when the dock tab activates or
 * deactivates. The panel itself is an isolated webContents: this element
 * only reserves the geometry; nothing renders inside it.
 *
 * Candidates arriving from the panel surface through onCandidate; the
 * composer draft integration (host send entry with one-time credentials)
 * is the S1 stub boundary.
 */
export function DesignPluginPanel({
  threadId,
  panelId,
  active,
  resizing,
  onCandidate,
  failureMessage,
}: {
  threadId: string;
  panelId: string;
  active: boolean;
  resizing?: boolean;
  onCandidate?: (text: string) => void;
  failureMessage: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string>();
  const candidateRef = useRef(onCandidate);
  candidateRef.current = onCandidate;

  useEffect(() => {
    let mounted = true;
    setError(undefined);
    void window.artemis
      .ensureDesignPanel(threadId, panelId)
      .then(() => {
        if (!mounted) return;
        // First-open geometry: the bounds/visible reports fired while the
        // panel was still being created were dropped by the host (no
        // registry entry yet). The view starts at 0x0 — re-report both
        // now that ensure has resolved, or the panel stays blank until
        // an unrelated resize.
        const element = containerRef.current;
        if (element) {
          const rect = element.getBoundingClientRect();
          void window.artemis.setDesignPanelBounds(threadId, panelId, {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
        void window.artemis.setDesignPanelVisible(
          threadId,
          panelId,
          resizing ? false : active,
        );
      })
      .catch((reason: unknown) => {
        if (mounted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      mounted = false;
      void window.artemis.releaseDesignPanel(threadId, panelId);
    };
  }, [threadId, panelId]);

  // Candidate listener: host -> renderer only; the panel has no channel.
  useEffect(() => {
    const dispose = window.artemis.onDesignPanelCandidate((event) => {
      if (event.threadId === threadId && event.panelId === panelId) {
        candidateRef.current?.(event.text);
      }
    });
    return dispose;
  }, [threadId, panelId]);

  // Mirror layout: container bounds -> WebContentsView bounds.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || error) return;
    const report = () => {
      const rect = element.getBoundingClientRect();
      void window.artemis.setDesignPanelBounds(threadId, panelId, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [threadId, panelId, error]);

  // Tab activation: keep the view alive but collapsed when inactive.
  // During dock resize the native view lags the DOM layout — hide it for
  // the drag and restore on release so the panel never shows stale
  // geometry mid-drag.
  useEffect(() => {
    if (error) return;
    void window.artemis.setDesignPanelVisible(
      threadId,
      panelId,
      resizing ? false : active,
    );
  }, [threadId, panelId, active, resizing, error]);

  if (error) {
    return (
      <div className="design-plugin-panel-error" role="alert">
        {failureMessage}（{error}）
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="design-plugin-panel-mount"
      data-artemis-component="design-plugin-panel"
      data-panel-id={panelId}
    />
  );
}
