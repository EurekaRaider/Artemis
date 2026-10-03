// "+" 工作区菜单的子窗口页面 HTML 构建器。
// 菜单画在独立透明 BrowserWindow 里（独立原生层，是唯一能盖住设计面板
// WebContentsView 而不隐藏面板的方式），因此这份 HTML 离开主文档运行：
// 主题令牌与字体在构建时取实时计算值内联；图标复制自
// @artemis/ui ARTEMIS_ICON_GLYPHS 的 review/terminal/browser/files 与
// App 的 DesignSparkIcon——图标改动须两处同步。

export type WorkspaceTabMenuKind =
  | "review"
  | "terminal"
  | "browser"
  | "file"
  | "design";

export interface WorkspaceTabMenuEntry {
  kind: WorkspaceTabMenuKind;
  label: string;
}

const MENU_GLYPHS: Record<WorkspaceTabMenuKind, string> = {
  review:
    '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  terminal: '<path d="M5 7.5l4.5 4.5L5 16.5M12 17h7"/>',
  browser:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.2 3.5 5 3.5 8.5s-1.2 6.3-3.5 8.5c-2.3-2.2-3.5-5-3.5-8.5S9.7 5.7 12 3.5z"/>',
  file: '<path d="M8 3.5h6l3.5 3.5v12a1.5 1.5 0 01-1.5 1.5H8A1.5 1.5 0 016.5 19V5a1.5 1.5 0 011.5-1.5z"/><path d="M14 3.5V7h3.5"/><path d="M9.5 12h5M9.5 15.5h5"/>',
  design:
    '<path d="M12 4.5l1.7 5.3 5.3 1.7-5.3 1.7L12 18.5l-1.7-5.3L5 11.5l5.3-1.7z"/>',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildWorkspaceTabMenuHtml(
  entries: readonly WorkspaceTabMenuEntry[],
): string {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const token = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  const panel = token("--panel-2", "#1c1c1c");
  const border = token("--border", "rgba(255,255,255,0.12)");
  const text = token("--text", "#f2f2f2");
  const muted = token("--muted", "rgba(242,242,242,0.55)");
  const hover = token("--hover", "rgba(255,255,255,0.08)");
  const font = body.fontFamily || "system-ui, sans-serif";
  const fontSize = body.fontSize || "13px";

  const items = entries
    .map(
      (entry) => `
      <button type="button" role="menuitem" data-kind="${entry.kind}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${MENU_GLYPHS[entry.kind]}</svg>
        <span>${escapeHtml(entry.label)}</span>
      </button>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  body { font-family: ${font}; font-size: ${fontSize}; }
  .menu {
    background: ${panel}; /* 全实色：子窗口浮层压在亮色内容上，透底会发虚 */
    border: 1px solid ${border};
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 14%);
    display: grid;
    gap: 3px;
    min-width: 190px;
    padding: 6px;
    margin: 24px; /* 主进程 SHADOW_PAD：窗口比菜单大一圈，留给投影 */
  }
  .menu button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: ${text};
    cursor: pointer;
    display: grid;
    font: inherit;
    grid-template-columns: 17px minmax(0, 1fr);
    justify-content: start;
    gap: 10px;
    min-height: 36px;
    padding: 0 10px;
    text-align: left;
  }
  .menu button:hover { background: ${hover}; }
  .menu svg { color: ${muted}; height: 17px; width: 17px; }
  /* 初始焦点落容器：新窗口聚焦时第一个按钮不得亮系统焦点环 */
  .menu:focus { outline: none; }
</style>
</head>
<body>
<div class="menu" id="menu" role="menu" tabindex="-1">${items}</div>
<script>
  var menu = document.getElementById('menu');
  menu.focus();
  // 窗口激活时 Chromium 会把焦点塞给第一个可聚焦元素（亮出系统焦点环），
  // 每次窗口聚焦都把焦点收回容器；此后 Tab 仍可在菜单项间导航。
  addEventListener('focus', function () { menu.focus(); });
  addEventListener('keydown', function (event) {
    if (event.key === 'Escape') window.artemisMenu.select('__dismiss');
  });
  menu.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-kind]');
    if (button) window.artemisMenu.select(button.dataset.kind);
  });
  requestAnimationFrame(function () {
    var rect = menu.getBoundingClientRect();
    window.artemisMenu.ready(Math.ceil(rect.width), Math.ceil(rect.height));
  });
</script>
</body>
</html>`;
}
