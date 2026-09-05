// 通过 URL hash 驱动视图状态，供 headless 截图与人工分享
// 用法: apple-inspired-ui.html#view=archive&theme=dark&dock=terminal&settings=1
(function () {
  var params = new URLSearchParams(location.hash.slice(1) || "");
  if (!params.toString()) return;
  var view = params.get("view");
  if (view) {
    document.body.setAttribute("data-view", view);
    document.querySelectorAll(".activity-button[data-goto]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-goto") === view);
    });
  }
  var theme = params.get("theme");
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  var dock = params.get("dock");
  if (dock) {
    document.body.setAttribute("data-dock", dock);
    document.querySelectorAll(".dock-tab[data-dock-tab]").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-dock-tab") === dock);
    });
  }
  if (params.get("settings") === "1") {
    document.getElementById("settingsBackdrop").classList.add("open");
  }
})();
