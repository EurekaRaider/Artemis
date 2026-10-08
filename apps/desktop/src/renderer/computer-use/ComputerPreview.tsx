import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { AppLocale, ComputerPreviewState } from "@artemis/protocol";
import { COMPUTER_PREVIEW_RESOURCES } from "../../shared/i18n/computer-preview-resources.js";
import { PreviewCanvas } from "./PreviewCanvas.js";
import "./computer-preview.css";

export function ComputerPreview({
  locale,
  threadId,
}: {
  locale: AppLocale;
  threadId?: string | undefined;
}) {
  const copy = COMPUTER_PREVIEW_RESOURCES[locale];
  const [states, setStates] = useState<ComputerPreviewState[]>([]);
  const [expanded, setExpanded] = useState<string>();
  const card = useRef<HTMLElement>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const dragging = useRef(false);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    let active = true,
      received = false;
    const unsubscribe = window.artemis.onComputerPreviews((values) => {
      received = true;
      setStates(values);
    });
    void window.artemis
      .getComputerPreviews()
      .then((values) => {
        if (active && !received) setStates(values);
      })
      .catch(() => {});
    const expand = window.artemis.onComputerPreviewExpand((state) => {
      if (state.target.kind === "desktop") setExpanded(state.sessionId);
    });
    return () => {
      active = false;
      unsubscribe();
      expand();
    };
  }, []);
  const state = states.find((value) => value.threadId === threadId);
  if (!state || state.state === "ended") return null;
  const command = (action: "hide" | "show" | "expand") =>
    void window.artemis
      .computerPreview({ action, sessionId: state.sessionId })
      .catch(() => {});
  if (state.state === "hidden")
    return (
      <Button
        className="computer-preview-show"
        variant="quiet"
        onClick={() => command("show")}
      >
        {copy.show}
      </Button>
    );
  const status =
    state.state === "paused"
      ? copy.paused
      : state.state === "unavailable"
        ? copy.unavailable
        : state.state === "starting"
          ? copy.starting
          : copy.readOnly;
  const fullscreen = expanded === state.sessionId;
  const toggleExpanded = () => {
    if (fullscreen) setExpanded(undefined);
    else {
      if (state.target.kind === "desktop") setExpanded(state.sessionId);
      command("expand");
    }
  };
  return (
    <aside
      ref={card}
      className={`computer-preview-card${fullscreen ? " computer-preview-expanded" : ""}`}
      aria-label={copy.title}
    >
      <IconButton
        className="computer-preview-close"
        label={copy.hide}
        icon={
          <ArtemisIcon
            name="close"
            strokeWidth={3}
            fallback={<path d="m4 4 16 16M20 4 4 20" />}
          />
        }
        onClick={() => {
          setExpanded(undefined);
          command("hide");
        }}
      />
      <div
        className="computer-preview-open"
        role="button"
        tabIndex={0}
        aria-label={fullscreen ? copy.close : copy.expand}
        title={`${state.target.name} · ${copy.readOnly}`}
        onPointerDown={(event) => {
          dragging.current = false;
          if (fullscreen || event.button !== 0) return;
          const element = card.current!,
            start = element.getBoundingClientRect(),
            x = event.clientX,
            y = event.clientY;
          dragCleanup.current?.();
          event.currentTarget.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => {
            if (
              !dragging.current &&
              Math.hypot(next.clientX - x, next.clientY - y) < 4
            )
              return;
            dragging.current = true;
            element.style.left = `${Math.max(0, Math.min(window.innerWidth - start.width, start.left + next.clientX - x))}px`;
            element.style.top = `${Math.max(0, Math.min(window.innerHeight - start.height, start.top + next.clientY - y))}px`;
            element.style.right = "auto";
            element.style.bottom = "auto";
          };
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            dragCleanup.current = undefined;
          };
          dragCleanup.current = stop;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop, { once: true });
          window.addEventListener("pointercancel", stop, { once: true });
        }}
        onClick={() => {
          if (dragging.current) {
            dragging.current = false;
            return;
          }
          toggleExpanded();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleExpanded();
          }
          if (fullscreen && event.key === "Escape") setExpanded(undefined);
        }}
      >
        <PreviewCanvas
          key={state.sessionId}
          sessionId={state.sessionId}
          expanded={fullscreen}
          label={`${copy.readOnly}: ${state.target.name}`}
        />
      </div>
      <span
        className={`computer-preview-status${state.state === "starting" || state.state === "unavailable" ? " computer-preview-status-visible" : ""}`}
        role={state.state === "unavailable" ? "alert" : "status"}
        title={state.reason}
      >
        {status}
      </span>
    </aside>
  );
}
