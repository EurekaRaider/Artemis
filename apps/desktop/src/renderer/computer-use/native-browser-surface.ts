import type { BrowserSessionSnapshot } from "@artemis/protocol";

/** Keep a native tab aligned with its HTML slot, without a per-frame IPC loop. */
export function bindNativeBrowserSurface(
  canvas: HTMLCanvasElement,
  browser: BrowserSessionSnapshot,
  token: string,
) {
  const target = { threadId: browser.threadId, tabId: browser.tabId, token };
  let active = true;
  let subscribed = false;
  let last = "";
  let occluded = false;
  let frame = 0;
  let imageRevision = 0;
  const isVisibleOverlay = (element: Element) => {
    if (element.contains(canvas)) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility === "visible" &&
      style.opacity !== "0"
    );
  };
  const unsubscribe = () => {
    subscribed = false;
    last = "";
    void window.artemis
      .browserSession({ ...target, action: "unsubscribe" })
      .catch(() => {});
  };
  const snapshot = async (width: number, height: number) => {
    const revision = ++imageRevision;
    try {
      const result = await window.artemis.browserPreview(
        browser.threadId,
        browser.contentsId,
        { action: "screenshot" },
      );
      if (!active || !occluded || revision !== imageRevision || !result.image)
        return;
      const image = new Image();
      image.src = `data:${result.image.mimeType};base64,${result.image.data}`;
      await image.decode();
      if (!active || !occluded || revision !== imageRevision) return;
      const ratio = window.devicePixelRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      context.drawImage(
        image,
        0,
        0,
        result.viewport ? result.viewport.width * result.viewport.scale : width,
        result.viewport
          ? result.viewport.height * result.viewport.scale
          : height,
      );
    } catch {
      // Closing a tab or opening DevTools can invalidate a pending still image.
    }
  };
  const sync = () => {
    frame = 0;
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    if (document.hidden || rect.width <= 0 || rect.height <= 0) {
      if (subscribed) unsubscribe();
      return;
    }
    const width = Math.min(2560, Math.max(1, Math.round(rect.width)));
    const height = Math.min(2560, Math.max(1, Math.round(rect.height)));
    // Native views sit above host HTML. Retain one still image while host
    // menus, annotations or dialogs cover the page; never start screen capture.
    const covered =
      [...document.querySelectorAll("dialog[open]")].some(isVisibleOverlay) ||
      [
        ...document.querySelectorAll(
          '[role="menu"], [role="listbox"], [role="tooltip"], [data-artemis-component="popover"], .browser-preview-picker, .browser-preview-highlight, .computer-preview-card',
        ),
      ].some((element) => {
        if (!isVisibleOverlay(element)) return false;
        const other = element.getBoundingClientRect();
        return (
          other.width > 0 &&
          other.height > 0 &&
          other.left < rect.left + rect.width &&
          other.left + other.width > rect.left &&
          other.top < rect.top + rect.height &&
          other.top + other.height > rect.top
        );
      });
    if (covered && !occluded) {
      occluded = true;
      void snapshot(width, height);
    } else occluded = covered;
    const nativeBounds = covered
      ? null
      : {
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width,
          height,
        };
    const next = JSON.stringify([width, height, nativeBounds]);
    if (subscribed && next === last) return;
    last = next;
    subscribed = true;
    void window.artemis
      .browserSession({
        ...target,
        action: "subscribe",
        width,
        height,
        nativeBounds,
      })
      .catch(() => {
        if (active) {
          subscribed = false;
          last = "";
        }
      });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  const resize = new ResizeObserver(schedule);
  // A dock can move without changing the canvas's own dimensions.
  for (
    let element: Element | null = canvas;
    element;
    element = element.parentElement
  )
    resize.observe(element);
  const mutations = new MutationObserver(schedule);
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "hidden", "style", "class", "data-state"],
  });
  const overlayEvents = [
    "pointerover",
    "pointerout",
    "focusin",
    "focusout",
    "transitionrun",
    "transitionend",
  ];
  for (const event of overlayEvents) document.addEventListener(event, schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  document.addEventListener("visibilitychange", schedule);
  sync();
  return () => {
    active = false;
    imageRevision++;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    for (const event of overlayEvents)
      document.removeEventListener(event, schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    document.removeEventListener("visibilitychange", schedule);
    unsubscribe();
  };
}
