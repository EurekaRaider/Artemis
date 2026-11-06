import type { ArtemisApi } from "../../../src/shared/api.js";

/** Dedicated verifier instrumentation; never imported by the production preload. */
export function instrumentDesktopSkinPreload(
  api: Pick<
    ArtemisApi,
    | "openTerminal"
    | "writeTerminal"
    | "resizeTerminal"
    | "closeTerminal"
    | "onTerminalData"
    | "rendererReady"
  >,
  webFrame: Pick<Electron.WebFrame, "setZoomFactor" | "getZoomFactor">,
) {
  let openCount = 0,
    writeCount = 0,
    resizeCount = 0,
    closeCount = 0,
    readyCount = 0;
  let lastResize: { cols: number; rows: number } | null = null;
  let data = "";
  const original = { ...api };
  api.openTerminal = (...args) => {
    openCount += 1;
    return original.openTerminal(...args);
  };
  api.writeTerminal = (...args) => {
    writeCount += 1;
    return original.writeTerminal(...args);
  };
  api.resizeTerminal = (...args) => {
    resizeCount += 1;
    lastResize = { cols: args[1], rows: args[2] };
    return original.resizeTerminal(...args);
  };
  api.closeTerminal = (...args) => {
    closeCount += 1;
    return original.closeTerminal(...args);
  };
  api.rendererReady = (...args) => {
    readyCount += 1;
    return original.rendererReady(...args);
  };
  api.onTerminalData = (listener) =>
    original.onTerminalData((value) => {
      data = (data + value.data).slice(-16_384);
      listener(value);
    });
  return {
    terminalData: () => data,
    terminalOpenCount: () => openCount,
    terminalWriteCount: () => writeCount,
    terminalResizeCount: () => resizeCount,
    terminalLastResize: () => lastResize,
    terminalCloseCount: () => closeCount,
    rendererReadyCount: () => readyCount,
    setZoomFactor: (value: number) => webFrame.setZoomFactor(value),
    zoomFactor: () => webFrame.getZoomFactor(),
  };
}
