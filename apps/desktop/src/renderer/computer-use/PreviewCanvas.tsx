import { useEffect, useRef } from "react";
import "./computer-preview.css";
import type {
  BrowserHumanInput,
  BrowserSessionSnapshot,
} from "@artemis/protocol";

export function PreviewCanvas({
  sessionId,
  browser,
  label,
  expanded = false,
}: {
  sessionId: string;
  browser?: BrowserSessionSnapshot | undefined;
  label: string;
  expanded?: boolean;
}) {
  const token = useRef(crypto.randomUUID());
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const committed = useRef<string | undefined>(undefined);
  const currentBrowser = useRef(browser);
  currentBrowser.current = browser;
  const pendingMove = useRef<BrowserHumanInput | undefined>(undefined);
  const moveFrame = useRef<number | undefined>(undefined);
  const moveBusy = useRef(false);
  const canvasId = `computer-preview-${token.current}`;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let active = true,
      subscribed = false,
      width = 0,
      height = 0;
    const sync = () => {
      const bounds = element.getBoundingClientRect();
      const visible = bounds.width > 0 && bounds.height > 0 && !document.hidden;
      if (!visible) {
        if (subscribed) {
          subscribed = false;
          window.artemis.unbindPreviewCanvas(token.current);
          const current = currentBrowser.current;
          void (
            current
              ? window.artemis.browserSession({
                  action: "unsubscribe",
                  threadId: current.threadId,
                  tabId: current.tabId,
                  token: token.current,
                })
              : window.artemis.computerPreview({
                  action: "unsubscribe",
                  token: token.current,
                })
          ).catch(() => {});
        }
        return;
      }
      const nextWidth = Math.min(2560, Math.max(1, Math.round(bounds.width))),
        nextHeight = Math.min(2560, Math.max(1, Math.round(bounds.height)));
      if (
        subscribed &&
        (!browser || (width === nextWidth && height === nextHeight))
      )
        return;
      width = nextWidth;
      height = nextHeight;
      if (!subscribed) {
        window.artemis.bindPreviewCanvas(token.current, canvasId);
        subscribed = true;
      }
      const current = currentBrowser.current;
      void (
        current
          ? window.artemis.browserSession({
              action: "subscribe",
              threadId: current.threadId,
              tabId: current.tabId,
              token: token.current,
              width,
              height,
            })
          : window.artemis.computerPreview({
              action: "subscribe",
              sessionId,
              token: token.current,
              expanded,
            })
      ).catch(() => {
        if (active) {
          subscribed = false;
          window.artemis.unbindPreviewCanvas(token.current);
        }
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      if (moveFrame.current !== undefined)
        cancelAnimationFrame(moveFrame.current);
      pendingMove.current = undefined;
      active = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.artemis.unbindPreviewCanvas(token.current);
      void (
        browser
          ? window.artemis.browserSession({
              action: "unsubscribe",
              threadId: browser.threadId,
              tabId: browser.tabId,
              token: token.current,
            })
          : window.artemis.computerPreview({
              action: "unsubscribe",
              token: token.current,
            })
      ).catch(() => {});
    };
  }, [sessionId, canvasId, Boolean(browser), expanded]);
  const send = (event: BrowserHumanInput) => {
    const current = currentBrowser.current;
    if (current)
      void window.artemis
        .browserSession({
          action: "input",
          threadId: current.threadId,
          tabId: current.tabId,
          token: token.current,
          input: event,
        })
        .catch(() => {});
  };
  const move = (event: BrowserHumanInput) => {
    pendingMove.current = event;
    if (moveFrame.current !== undefined || moveBusy.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = undefined;
      const current = currentBrowser.current,
        latest = pendingMove.current;
      pendingMove.current = undefined;
      if (!current || !latest) return;
      moveBusy.current = true;
      void window.artemis
        .browserSession({
          action: "input",
          threadId: current.threadId,
          tabId: current.tabId,
          token: token.current,
          input: latest,
        })
        .catch(() => {})
        .finally(() => {
          moveBusy.current = false;
          if (pendingMove.current) move(pendingMove.current);
        });
    });
  };
  const modifiers = (event: {
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  }) =>
    (
      [
        event.shiftKey ? "shift" : null,
        event.ctrlKey ? "control" : null,
        event.altKey ? "alt" : null,
        event.metaKey ? "meta" : null,
      ] as const
    ).filter(
      (value): value is "shift" | "control" | "alt" | "meta" => value !== null,
    );
  const point = (event: { clientX: number; clientY: number }) => {
    const bounds = canvas.current!.getBoundingClientRect(),
      current = currentBrowser.current!;
    return {
      x: Math.min(
        current.width - 1,
        Math.max(
          0,
          ((event.clientX - bounds.left) * current.width) / bounds.width,
        ),
      ),
      y: Math.min(
        current.height - 1,
        Math.max(
          0,
          ((event.clientY - bounds.top) * current.height) / bounds.height,
        ),
      ),
    };
  };
  return (
    <div
      className={`computer-preview-surface${browser ? " browser-frame browser-input-surface" : ""}`}
      data-browser-thread={browser?.threadId}
      data-browser-tab={browser?.tabId}
      data-browser-url={browser?.url}
    >
      <canvas
        id={canvasId}
        ref={canvas}
        aria-label={label}
        role="img"
        onPointerDown={
          browser
            ? (event) => {
                canvas.current!.setPointerCapture(event.pointerId);
                input.current?.focus({ preventScroll: true });
                const position = point(event);
                if (input.current) {
                  input.current.style.left = `${event.clientX}px`;
                  input.current.style.top = `${event.clientY}px`;
                }
                send({
                  type: "mouseDown",
                  ...position,
                  button:
                    event.button === 2
                      ? "right"
                      : event.button === 1
                        ? "middle"
                        : "left",
                  clickCount: Math.max(1, Math.min(3, event.detail)),
                  modifiers: modifiers(event),
                });
              }
            : undefined
        }
        onPointerUp={
          browser
            ? (event) => {
                if (canvas.current!.hasPointerCapture(event.pointerId))
                  canvas.current!.releasePointerCapture(event.pointerId);
                send({
                  type: "mouseUp",
                  ...point(event),
                  button:
                    event.button === 2
                      ? "right"
                      : event.button === 1
                        ? "middle"
                        : "left",
                  clickCount: Math.max(1, Math.min(3, event.detail)),
                  modifiers: modifiers(event),
                });
              }
            : undefined
        }
        onPointerMove={
          browser
            ? (event) =>
                move({
                  type: "mouseMove",
                  ...point(event),
                  button: event.buttons & 2 ? "right" : "left",
                  clickCount: 0,
                  modifiers: modifiers(event),
                  buttons: event.buttons & 7,
                })
            : undefined
        }
        onWheel={
          browser
            ? (event) => {
                event.preventDefault();
                send({
                  type: "mouseWheel",
                  ...point(event),
                  deltaX: Math.max(-10000, Math.min(10000, -event.deltaX)),
                  deltaY: Math.max(-10000, Math.min(10000, -event.deltaY)),
                  modifiers: modifiers(event),
                });
              }
            : undefined
        }
        onContextMenu={(event) => {
          if (browser) event.preventDefault();
        }}
      />
      {browser && (
        <textarea
          className="browser-ime-input"
          ref={input}
          aria-label={label}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing) return;
            if (event.key === "v" && (event.metaKey || event.ctrlKey)) return;
            send({
              type: "keyDown",
              keyCode: event.key === " " ? "Space" : event.key,
              modifiers: modifiers(event),
            });
            if (event.key.length > 1 || event.metaKey || event.ctrlKey)
              event.preventDefault();
          }}
          onKeyUp={(event) => {
            if (!composing.current)
              send({
                type: "keyUp",
                keyCode: event.key === " " ? "Space" : event.key,
                modifiers: modifiers(event),
              });
          }}
          onCompositionStart={() => {
            composing.current = true;
            committed.current = undefined;
          }}
          onCompositionUpdate={(event) =>
            send({
              type: "composition",
              text: event.data,
              selectionStart: event.data.length,
              selectionEnd: event.data.length,
            })
          }
          onCompositionEnd={(event) => {
            composing.current = false;
            committed.current = event.data;
            send({
              type: "composition",
              text: "",
              selectionStart: 0,
              selectionEnd: 0,
            });
            if (event.data) send({ type: "text", text: event.data });
            event.currentTarget.value = "";
          }}
          onInput={(event) => {
            if (
              composing.current ||
              (event.nativeEvent as InputEvent).isComposing
            )
              return;
            const text = event.currentTarget.value;
            if (text && text !== committed.current)
              send({ type: "text", text: text.slice(0, 16000) });
            committed.current = undefined;
            event.currentTarget.value = "";
          }}
          onPaste={(event) => {
            event.preventDefault();
            send({
              type: "text",
              text: event.clipboardData.getData("text/plain").slice(0, 16000),
            });
          }}
        />
      )}
    </div>
  );
}
