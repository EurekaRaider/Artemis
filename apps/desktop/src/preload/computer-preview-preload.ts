import { ipcRenderer } from "electron";
import { IPC } from "../shared/api.js";
import { bindPreviewCanvas, unbindPreviewCanvas } from "./preview-textures.js";
import { COMPUTER_PREVIEW_RESOURCES } from "../shared/i18n/computer-preview-resources.js";
import type { AppLocale, ComputerPreviewState } from "@artemis/protocol";
let state: ComputerPreviewState | undefined;
let activeToken: string | undefined;
let position: [number, number] = [0, 0];
let dragging = false;
ipcRenderer.on(
  IPC.computerPreviewFloating,
  (
    _event,
    value: {
      state?: ComputerPreviewState;
      token?: string;
      locale: AppLocale;
      position?: [number, number];
    },
  ) => {
    if (state?.sessionId !== value.state?.sessionId) {
      const canvas = document.getElementById(
        "computer-preview-floating-canvas",
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.width = canvas.width;
    }
    state = value.state;
    if (value.position) position = value.position;
    if (activeToken && activeToken !== value.token)
      unbindPreviewCanvas(activeToken);
    if (activeToken !== value.token) {
      activeToken = value.token;
      if (activeToken)
        bindPreviewCanvas(activeToken, "computer-preview-floating-canvas");
    }
    const copy = COMPUTER_PREVIEW_RESOURCES[value.locale];
    document.documentElement.dir = value.locale === "ar" ? "rtl" : "ltr";
    document.getElementById("hide")!.setAttribute("aria-label", copy.hide);
    document.getElementById("hide")!.setAttribute("title", copy.hide);
    const canvas = document.getElementById("computer-preview-floating-canvas")!;
    canvas.setAttribute("aria-label", copy.expand);
    canvas.setAttribute(
      "title",
      `${state?.target.name ?? copy.title} · ${copy.readOnly}`,
    );
    const status = document.getElementById("status")!;
    status.classList.toggle(
      "visible",
      state?.state === "starting" || state?.state === "unavailable",
    );
    status.textContent =
      state?.state === "paused"
        ? copy.paused
        : state?.state === "unavailable"
          ? copy.unavailable
          : state?.state === "starting"
            ? copy.starting
            : copy.readOnly;
  },
);
window.addEventListener("DOMContentLoaded", () => {
  const expand = () => {
    if (state)
      ipcRenderer.send(IPC.computerPreviewFloating, {
        action: "expand",
        sessionId: state.sessionId,
      });
  };
  const canvas = document.getElementById("computer-preview-floating-canvas")!;
  canvas.addEventListener("click", () => {
    if (dragging) {
      dragging = false;
      return;
    }
    expand();
  });
  canvas.addEventListener("pointerdown", (event) => {
    dragging = false;
    if (!state || event.button !== 0) return;
    const sessionId = state.sessionId,
      x = event.screenX,
      y = event.screenY;
    const start = [...position];
    canvas.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (state?.sessionId !== sessionId) return;
      if (!dragging && Math.hypot(next.screenX - x, next.screenY - y) < 4)
        return;
      dragging = true;
      position = [
        Math.round(start[0]! + next.screenX - x),
        Math.round(start[1]! + next.screenY - y),
      ];
      ipcRenderer.send(IPC.computerPreviewFloating, {
        action: "move",
        sessionId,
        x: position[0],
        y: position[1],
      });
    };
    const stop = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("lostpointercapture", stop);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("lostpointercapture", stop);
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      expand();
    }
  });
  document.getElementById("hide")!.addEventListener("click", () => {
    if (state)
      ipcRenderer.send(IPC.computerPreviewFloating, {
        action: "hide",
        sessionId: state.sessionId,
      });
  });
  const resize = document.getElementById("resize")!;
  resize.addEventListener("pointerdown", (event) => {
    if (!state || event.button !== 0) return;
    const sessionId = state.sessionId,
      x = event.screenX,
      y = event.screenY;
    const width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight;
    resize.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (state?.sessionId !== sessionId) return;
      ipcRenderer.send(IPC.computerPreviewFloating, {
        action: "resize",
        sessionId,
        width: Math.round(width + next.screenX - x),
        height: Math.round(height + next.screenY - y),
      });
    };
    const stop = () => {
      resize.removeEventListener("pointermove", move);
      resize.removeEventListener("pointerup", stop);
      resize.removeEventListener("pointercancel", stop);
      resize.removeEventListener("lostpointercapture", stop);
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", stop);
    resize.addEventListener("pointercancel", stop);
    resize.addEventListener("lostpointercapture", stop);
  });
  ipcRenderer.send(IPC.computerPreviewFloating, { action: "ready" });
});
