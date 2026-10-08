import { ipcRenderer } from "electron";
import { IPC } from "../shared/api.js";
import { bindPreviewCanvas, unbindPreviewCanvas } from "./preview-textures.js";
import { COMPUTER_PREVIEW_RESOURCES } from "../shared/i18n/computer-preview-resources.js";
import { COMPUTER_USE_RESOURCES } from "../shared/i18n/computer-use-resources.js";
import type { AppLocale, ComputerPreviewState } from "@artemis/protocol";
let state: ComputerPreviewState | undefined;
let activeToken: string | undefined;
ipcRenderer.on(
  IPC.computerPreviewFloating,
  (
    _event,
    value: { state?: ComputerPreviewState; token?: string; locale: AppLocale },
  ) => {
    if (state?.sessionId !== value.state?.sessionId) {
      const canvas = document.getElementById(
        "computer-preview-floating-canvas",
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.width = canvas.width;
    }
    state = value.state;
    if (activeToken && activeToken !== value.token)
      unbindPreviewCanvas(activeToken);
    if (activeToken !== value.token) {
      activeToken = value.token;
      if (activeToken)
        bindPreviewCanvas(activeToken, "computer-preview-floating-canvas");
    }
    const copy = COMPUTER_PREVIEW_RESOURCES[value.locale],
      controls = COMPUTER_USE_RESOURCES[value.locale];
    document.documentElement.dir = value.locale === "ar" ? "rtl" : "ltr";
    document.getElementById("name")!.textContent =
      state?.target.name ?? copy.title;
    document.getElementById("expand")!.textContent = copy.expand;
    document.getElementById("hide")!.textContent = copy.hide;
    document.getElementById("control")!.textContent =
      state?.state === "paused" ? controls.resume : controls.stop;
    document.getElementById("status")!.textContent =
      state?.state === "paused"
        ? copy.paused
        : state?.state === "unavailable"
          ? copy.unavailable
          : `${state?.actualFps.toFixed(1) ?? "0.0"} ${copy.fps} · ${copy.readOnly}`;
  },
);
window.addEventListener("DOMContentLoaded", () => {
  for (const action of ["expand", "hide", "control"] as const)
    document.getElementById(action)!.addEventListener("click", () => {
      if (state)
        ipcRenderer.send(IPC.computerPreviewFloating, {
          action:
            action === "control"
              ? state.state === "paused"
                ? "resume"
                : "stop"
              : action,
          sessionId: state.sessionId,
        });
    });
  ipcRenderer.send(IPC.computerPreviewFloating, { action: "ready" });
});
