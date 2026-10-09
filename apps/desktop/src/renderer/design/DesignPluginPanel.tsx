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
  occluded: occludedProp,
  onCandidate,
  onBinding,
  failureMessage,
}: {
  threadId: string;
  panelId: string;
  active: boolean;
  /** Host-rendered overlays that overlap the panel (workspace + menu etc.):
   *  the native view always paints above HTML, so hide while they show. */
  occluded?: boolean;
  onCandidate?: (
    text: string,
    annotations?:
      | Array<{
          id?: string;
          kind?: string;
          markKind?: string;
          label?: string;
          text?: string;
          documentId?: string | null;
          documentName?: string | null;
          currentText?: string;
          selector?: string;
          x?: number | null;
          y?: number | null;
          w?: number | null;
          h?: number | null;
          htmlHint?: string;
          style?: string;
        }>
      | undefined,
    document?:
      | {
          documentId: string;
          documentName: string;
          html: string;
        }
      | undefined,
    autoSend?: boolean,
    images?: string[],
  ) => void;
  /** Active document tab binding (OD activeProjectFileName); null = grid. */
  onBinding?: (
    binding: {
      documentId: string;
      name: string;
      html: string;
    } | null,
  ) => void;
  failureMessage: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string>();
  // 原生 <dialog>（showModal 的 top layer）仍渲染在原生 WebContentsView
  // 之下——任何弹窗打开期间必须隐藏面板，否则设置/确认框被浮层挡住。
  const [occluded, setOccluded] = useState(false);
  const candidateRef = useRef(onCandidate);
  candidateRef.current = onCandidate;
  const bindingRef = useRef(onBinding);
  bindingRef.current = onBinding;

  useEffect(() => {
    let frame = 0;
    const check = () => {
      setOccluded(!!document.querySelector("dialog[open]"));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check();
      });
    };
    check();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setError(undefined);
    const report = () => {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      void window.artemis.setDesignPanelBounds(threadId, panelId, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    void window.artemis
      .ensureDesignPanel(threadId, panelId)
      .then(() => {
        if (!mounted) return;
        // First-open geometry: re-report bounds a couple of frames after
        // ensure resolves. A synchronous read can still observe the mount
        // at 0x0 (pane not laid out yet), and the ResizeObserver below
        // never fires when the element already has its final size at
        // observe() — the delayed reports are what heal that ordering.
        requestAnimationFrame(() => {
          if (!mounted) return;
          requestAnimationFrame(() => {
            if (mounted) report();
          });
        });
        void window.artemis.setDesignPanelVisible(threadId, panelId, active);
      })
      .catch((reason: unknown) => {
        if (mounted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      mounted = false;
      void window.artemis.releaseDesignPanel(threadId, panelId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, panelId]);

  // Candidate listener: host -> renderer only; the panel has no channel.
  useEffect(() => {
    const dispose = window.artemis.onDesignPanelCandidate((event) => {
      if (event.threadId === threadId && event.panelId === panelId) {
        candidateRef.current?.(
          event.text,
          event.annotations,
          event.document,
          event.autoSend,
          event.images,
        );
      }
    });
    return dispose;
  }, [threadId, panelId]);

  // Active-document binding listener: drives the composer chip + page
  // attachment on send (OD activeProjectFileName).
  useEffect(() => {
    const dispose = window.artemis.onDesignPanelBinding((event) => {
      if (event.threadId !== threadId || event.panelId !== panelId) return;
      bindingRef.current?.(
        event.documentId && event.name
          ? {
              documentId: event.documentId,
              name: event.name,
              html: event.html ?? "",
            }
          : null,
      );
    });
    return () => {
      dispose();
      // Tab closed: the binding dies with the panel.
      bindingRef.current?.(null);
    };
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
    // Layout can settle between the synchronous report and observe() —
    // one delayed re-report closes that gap (no observer fire to rely on).
    const frame = requestAnimationFrame(report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [threadId, panelId, error]);

  // Tab activation: keep the view alive but collapsed when inactive.
  // Dock drags keep the view VISIBLE on purpose: bounds flow live through
  // the ResizeObserver below, so the native view follows the splitter.
  // Hiding it here read as the whole pane flashing black mid-drag.
  // A modal dialog (dialogOccluded) or a host overlay (workspace + menu)
  // hides the view for its lifetime.
  useEffect(() => {
    if (error) return;
    void window.artemis.setDesignPanelVisible(
      threadId,
      panelId,
      active && !occluded && !occludedProp,
    );
  }, [threadId, panelId, active, occluded, occludedProp, error]);

  if (error) {
    return (
      <div className="design-plugin-panel-error" role="alert">
        {failureMessage}（{error}）
      </div>
    );
  }
  return (
    <div className="design-plugin-panel-host">
      <div
        ref={containerRef}
        className="design-plugin-panel-mount"
        data-artemis-component="design-plugin-panel"
        data-panel-id={panelId}
      />
    </div>
  );
}
