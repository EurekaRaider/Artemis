import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import type { AppLocale, ComputerPreviewState } from "@artemis/protocol";
import { COMPUTER_PREVIEW_RESOURCES } from "../../shared/i18n/computer-preview-resources.js";
import { COMPUTER_USE_RESOURCES } from "../../shared/i18n/computer-use-resources.js";
import { PreviewCanvas } from "./PreviewCanvas.js";
import "./computer-preview.css";

export function ComputerPreview({
  locale,
  threadId,
}: {
  locale: AppLocale;
  threadId?: string | undefined;
}) {
  const copy = COMPUTER_PREVIEW_RESOURCES[locale],
    controls = COMPUTER_USE_RESOURCES[locale];
  const [states, setStates] = useState<ComputerPreviewState[]>([]);
  const [expanded, setExpanded] = useState<string>();
  const card = useRef<HTMLElement>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
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
  const label =
    state.state === "paused"
      ? copy.paused
      : state.state === "unavailable"
        ? copy.unavailable
        : state.state === "starting"
          ? copy.starting
          : copy.readOnly;
  const fullscreen = expanded === state.sessionId;
  return (
    <aside
      ref={card}
      className={`computer-preview-card${fullscreen ? " computer-preview-expanded" : ""}`}
      aria-label={copy.title}
    >
      <div
        className="computer-preview-header"
        onPointerDown={(event) => {
          if (fullscreen || (event.target as HTMLElement).closest("button"))
            return;
          const element = card.current!,
            start = element.getBoundingClientRect(),
            x = event.clientX,
            y = event.clientY;
          dragCleanup.current?.();
          event.currentTarget.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => {
            element.style.left = `${Math.max(0, Math.min(window.innerWidth - start.width, start.left + next.clientX - x))}px`;
            element.style.top = `${Math.max(0, Math.min(window.innerHeight - start.height, start.top + next.clientY - y))}px`;
            element.style.right = "auto";
            element.style.bottom = "auto";
          };
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            dragCleanup.current = undefined;
          };
          dragCleanup.current = stop;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop, { once: true });
        }}
      >
        <span title={state.target.name}>{state.target.name}</span>
        <IconButton
          label={fullscreen ? copy.close : copy.expand}
          icon={<ArtemisIcon name={fullscreen ? "close" : "expand"} />}
          onClick={() => {
            if (fullscreen) setExpanded(undefined);
            else {
              if (state.target.kind === "desktop") setExpanded(state.sessionId);
              command("expand");
            }
          }}
        />
        <IconButton
          label={copy.hide}
          icon={<ArtemisIcon name="close" />}
          onClick={() => command("hide")}
        />
      </div>
      <PreviewCanvas
        key={state.sessionId}
        sessionId={state.sessionId}
        expanded={fullscreen}
        label={`${copy.readOnly}: ${state.target.name}`}
      />
      <div className="computer-preview-footer">
        <span role="status" title={state.reason}>
          {label} · {state.actualFps.toFixed(1)} {copy.fps}
          {state.p95LatencyMs !== undefined
            ? ` · ${copy.latency} ${Math.round(state.p95LatencyMs)} ms`
            : ""}
        </span>
        <Button
          variant="quiet"
          onClick={() =>
            void window.artemis.controlComputer(
              state.state === "paused" ? "resume" : "stop",
              state.threadId,
            )
          }
        >
          {state.state === "paused" ? controls.resume : controls.stop}
        </Button>
      </div>
      {state.state === "unavailable" && state.reason && (
        <p role="alert">{state.reason}</p>
      )}
    </aside>
  );
}
