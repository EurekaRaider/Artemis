import {
  WORKSPACE_HTML_SIZE_MESSAGE,
  WORKSPACE_HTML_WHEEL_MESSAGE,
} from "../../shared/workspace-html-size.js";

/** Reports layout only; the opaque frame still has no application or filesystem bridge. */
export function workspaceHtmlSizeScript(url: string): string {
  return `<script>(() => {
    const url = ${JSON.stringify(url).replaceAll("<", "\\u003c")};
    let scheduled = false;
    let contentChanged = true;
    let viewportWidth = innerWidth;
    let viewportHeight = innerHeight;
    let lastHeight = 0;
    const measure = () => {
      scheduled = false;
      const viewportOnly = innerWidth === viewportWidth &&
        innerHeight !== viewportHeight && !contentChanged;
      viewportWidth = innerWidth;
      viewportHeight = innerHeight;
      contentChanged = false;
      if (!document.body) return;
      const body = document.body;
      const root = document.documentElement;
      const bottomMargin = parseFloat(getComputedStyle(body).marginBottom) || 0;
      const height = Math.ceil(Math.max(
        body.getBoundingClientRect().bottom + scrollY + bottomMargin,
        body.scrollHeight + body.offsetTop,
        root.scrollHeight > root.clientHeight ? root.scrollHeight : 0
      ));
      if (height === lastHeight) return;
      lastHeight = height;
      // Remember the new layout even when only the host viewport changed,
      // so a later ResizeObserver delivery cannot restart a 100vh feedback loop.
      if (viewportOnly) return;
      parent.postMessage({ type: ${JSON.stringify(WORKSPACE_HTML_SIZE_MESSAGE)},
        version: 1, url, height }, "*");
    };
    const schedule = () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(measure);
      }
    };
    const changed = () => { contentChanged = true; schedule(); };
    // Chromium chains ordinary wheel input across the frame natively. A
    // gesture latched to an inner scroller can stall at its boundary. Only
    // scrollers that actually moved need a non-passive listener for that case.
    const handOffAtEdge = (event) => {
      if (parent === window || event.ctrlKey || !event.deltaY ||
          event.defaultPrevented || !event.cancelable) return;
      for (const node of event.composedPath()) {
        if (!(node instanceof Element) || node.scrollHeight <= node.clientHeight) continue;
        if (node !== document.scrollingElement && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
        if (event.deltaY < 0 ? node.scrollTop > 0 :
            node.scrollTop + node.clientHeight < node.scrollHeight - 1) return;
      }
      const deltaY = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      event.preventDefault();
      parent.postMessage({ type: ${JSON.stringify(WORKSPACE_HTML_WHEEL_MESSAGE)},
        version: 1, url, deltaY }, "*");
    };
    addEventListener("scroll", (event) => {
      if (event.target instanceof Element || event.target === document)
        event.target.addEventListener("wheel", handOffAtEdge, { passive: false });
    }, { capture: true, passive: true });
    const start = () => {
      new ResizeObserver(schedule).observe(document.body);
      new MutationObserver(changed).observe(document.body, {
        subtree: true, childList: true, attributes: true, characterData: true
      });
      document.addEventListener("load", changed, true);
      document.fonts.ready.then(changed);
      addEventListener("resize", schedule);
      changed();
    };
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  })();</script>`;
}
