(function () {
  "use strict";
  var $ = function (s) {
    return document.querySelector(s);
  };
  var $$ = function (s) {
    return Array.prototype.slice.call(document.querySelectorAll(s));
  };
  var body = document.body;
  body.classList.add("sidebar-initializing");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { body.classList.remove("sidebar-initializing"); });
  });
  var UI = window.ArtemisUI;
  UI.enhance(document);
  document.querySelectorAll(".ui-button,.ui-field").forEach(function (el) {
    el.dataset.size = "compact";
  });

  // Sidebar sizing matches project-sidebar-layout.ts (208–420px).
  var sidebarHandle = $(".project-sidebar-resizer");
  function sizeSidebar(value) {
    var width = Math.max(208, Math.min(420, value));
    body.style.setProperty("--sidebar-w", width + "px");
    sidebarHandle.setAttribute("aria-valuenow", String(width));
  }
  UI.splitPane(sidebarHandle, {
    initial: window.innerWidth <= 1100 ? 250 : 280,
    step: 16,
    home: function () {
      return 208;
    },
    limits: function () {
      return { min: 208, max: 420 };
    },
    onChange: sizeSidebar,
  });

  $(".sidebar-search input").addEventListener("input", function () {
    var query = this.value.trim().toLowerCase();
    $$(".thread").forEach(function (thread) {
      thread.hidden = !thread.textContent.toLowerCase().includes(query);
    });
  });
  /* v96：会话相对时间（ZCode 规则：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期） */
  function formatRelTime(ts) {
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    var d = Math.floor(h / 24);
    if (d === 1) return "昨天";
    if (d < 7) return d + " 天前";
    var dt = new Date(ts);
    return dt.getMonth() + 1 + "月" + dt.getDate() + "日";
  }
  $$(".thread[data-ts]").forEach(function (t) {
    var slot = t.querySelector(".tt-time");
    if (slot) slot.textContent = formatRelTime(+t.getAttribute("data-ts"));
  });

  /* v102：rail 展开与当前会话定位
     v128：rail 底部展开钮移除（hover 即浮出）；固定展开入口 = rail 顶部 Logo
     或 peek 浮层内同位置的品牌 Logo / 品牌行展开钮 */
  function expandSidebar() {
    body.classList.remove("sidebar-collapsed");
    var t = $("#leftToggle");
    if (t) t.classList.add("active");
  }
  $$(".rail-brand, .sidebar-brand .activity-mark").forEach(function (b) {
    b.addEventListener("click", expandSidebar);
  });
  $("#railSettings").addEventListener("click", function () {
    var sb = $("#settingsBtn");
    if (sb) sb.click();
  });
  $("#railAnchor").addEventListener("click", function () {
    expandSidebar();
    setTimeout(function () {
      var active = $(".thread.active");
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 280);
  });

  /* ---------- 视图切换 ---------- */
  $$(".activity-button[data-goto]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var view = btn.getAttribute("data-goto");
      if (
        view === "workspace" &&
        body.getAttribute("data-view") === "workspace"
      ) {
        body.classList.toggle("sidebar-collapsed");
        $("#leftToggle").classList.toggle(
          "active",
          !body.classList.contains("sidebar-collapsed"),
        );
        return;
      }
      body.classList.remove("sidebar-collapsed");
      body.setAttribute("data-view", view);
      $$(".activity-button[data-goto]").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });
  });
  $("#leftToggle").addEventListener("click", function () {
    /* v130：收起时挂 snap——立即隐藏抽屉并压制 hover 粘滞（点击后鼠标
       未动，Chromium 保留 .sidebar:hover，浮层会原地不收）。直到下一次
       鼠标移动才解除，此后 hover peek 的平滑过渡照常。 */
    var wasCollapsed = body.classList.contains("sidebar-collapsed");
    body.classList.toggle("sidebar-collapsed");
    this.classList.toggle(
      "active",
      !body.classList.contains("sidebar-collapsed"),
    );
    if (!wasCollapsed) {
      body.classList.add("sidebar-snap");
      var clearSnap = function () {
        body.classList.remove("sidebar-snap");
        window.removeEventListener("mousemove", clearSnap);
      };
      window.addEventListener("mousemove", clearSnap, { once: true });
    }
  });

  /* v123：新建会话入口（nav-row，归档会话之下）——进入工作台视图并聚焦输入框
     v124：接线修正——三个新建入口统一走 startNewThread：重置为空会话态
     （data-empty=1 空态文案 + 标题「新会话」+ 清除会话选中），不再残留旧会话面板 */
  function startNewThread(label) {
    body.classList.remove("sidebar-collapsed", "sidebar-snap");
    body.setAttribute("data-view", "workspace");
    body.dataset.empty = "1";
    $$(".activity-button").forEach(function (b) {
      b.classList.remove("active");
    });
    $$(".thread").forEach(function (t) {
      t.classList.remove("active", "running");
    });
    var title = $(".workspace-thread-title");
    if (title) title.textContent = "新会话";
    var emptyProject = $(".empty-project");
    if (emptyProject) emptyProject.textContent = label + " · 新会话";
    var composer = $(".composer textarea");
    if (composer) composer.focus();
  }
  $("#newThreadBtn").addEventListener("click", function () {
    var selected = $('#projList button.selected span');
    startNewThread(selected ? selected.textContent.trim() : "Artemis");
  });
  /* 项目行「新会话」笔形按钮：以该项目为上下文开新会话 */
  document.addEventListener("click", function (ev) {
    var act = ev.target.closest('.proj-act[title="新会话"]');
    if (!act) return;
    var head = act.closest(".project-item").querySelector(".project-head");
    startNewThread(head ? head.textContent.trim() : "项目");
  });
  /* 临时会话组的 +：新建临时会话 */
  document.addEventListener("click", function (ev) {
    var add = ev.target.closest('.group-add[title="新建临时会话"]');
    if (!add) return;
    startNewThread("临时会话");
  });


  /* Dock panels share one registry, one tab selection, and one close lifecycle. */
  var panelRegistry = {
    review: { label: "审查", icon: "review" },
    terminal: { label: "终端", icon: "terminal" },
    browser: { label: "浏览器", icon: "browser" },
    files: { label: "文件", icon: "files" },
    goal: { label: "任务目标" },
    sources: { label: "来源" },
    markdown: { label: "README.md" },
    team: { label: "UI 实现团队" },
    agent: { label: "布局检查" },
  };
  var activePanel = "review";
  var dockController = UI.tabs($("#dockTabs"), {
    selector: ".dock-tab",
    closeSelector: ".x",
    onClose: closePanel,
    onSelect: function (tab) {
      activateTab(tab.dataset.tab);
    },
  });
  function setDockOpen(open) {
    body.setAttribute("data-dock", open ? "open" : "closed");
    $("#dockToggle").classList.toggle("active", open);
    $("#dockToggle").setAttribute("aria-expanded", String(open));
    $("#workspaceDock").inert = !open;
    $("#dockResizer").tabIndex = open ? 0 : -1;
    $("#dockResizer").setAttribute("aria-disabled", String(!open));
  }
  function activateTab(name) {
    if (!Object.hasOwn(panelRegistry, name)) return;
    activePanel = name;
    var selectedTab = $('#dockTabs .dock-tab[data-tab="' + name + '"]');
    if (selectedTab) dockController.select(selectedTab, false, false);

    $$(".tab-content > .tab-panel").forEach(function (panel) {
      var active = panel.dataset.panel === name;
      panel.hidden = !active;
      panel.classList.toggle("show", active);
    });
    $("#dockEmpty").hidden = true;
  }
  function openPanel(name, focus) {
    if (!Object.hasOwn(panelRegistry, name)) return;
    body.dataset.view = "workspace";
    $$(".activity-button[data-goto]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.goto === "workspace");
    });
    setDockOpen(true);
    var tab = $('#dockTabs .dock-tab[data-tab="' + name + '"]');
    if (!tab) {
      tab = UI.tab({
        label: panelRegistry[name].label,
        className: "dock-tab",
        closeClass: "x",
      });
      tab.dataset.tab = name;
      tab.id = "dockTab" + name.charAt(0).toUpperCase() + name.slice(1);
      tab.setAttribute("role", "tab");
      tab.setAttribute(
        "aria-controls",
        "dockPanel" + name.charAt(0).toUpperCase() + name.slice(1),
      );
      var template = $(
        '.launch-btn[data-launch="' +
          (panelRegistry[name].icon || "files") +
          '"] .launch-ico',
      );
      if (template) tab.prepend(template.querySelector("svg").cloneNode(true));
      $("#dockTabs").appendChild(tab);
    }
    activateTab(name);
    panelPicker.close();
    environmentPopover.close();
    if (focus !== false) tab.focus();
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function closePanel(tab) {
    var wasActive = tab.dataset.tab === activePanel;
    tab.remove();
    var tabs = $$("#dockTabs .dock-tab");
    if (!tabs.length) {
      $$(".tab-content > .tab-panel").forEach(function (p) {
        p.hidden = true;
        p.classList.remove("show");
      });
      $("#dockEmpty").hidden = false;
      $("#tabAdd").focus();
    } else if (wasActive) {
      activateTab(tabs[tabs.length - 1].dataset.tab);
      tabs[tabs.length - 1].focus();
    }
  }
  $("#dockToggle").addEventListener("click", function () {
    setDockOpen(body.dataset.dock !== "open");
  });

  $$(".launch-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      openPanel(b.dataset.launch);
    });
    var text = Array.from(b.childNodes).find(function (n) {
      return n.nodeType === 3 && n.textContent.trim();
    });
    if (text) text.textContent = panelRegistry[b.dataset.launch].label;
  });
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-open-panel]");
    if (trigger && !trigger.closest("#panelPicker"))
      openPanel(trigger.dataset.openPanel);
  });
  var panelPicker = UI.menu($("#tabAdd"), $("#panelPicker"), {
    select: false,
    hidden: true,
    onSelect: function (item) {
      openPanel(item.dataset.openPanel);
    },
  });

  activateTab("review");
  /* ---------- 环境 popover ---------- */
  var envT = $("#envTrigger"),
    envP = $("#envPop");
  var environmentPopover = UI.floating(envT, envP, {
    onOpenChange: function (open) {
      envT.classList.toggle("active", open);
      requestAnimationFrame(syncEnvironmentSpace);
    },
  });
  // Match the desktop's 24px reading safe area; close when less than 480px remains.
  function syncEnvironmentSpace() {
    var conversation = $("#conversation");
    if (!conversation) return;
    var property = "--environment-panel-content-safe-inline-size";
    if (!environmentPopover.isOpen) {
      conversation.style.removeProperty(property);
      return;
    }
    var bounds = conversation.getBoundingClientRect();
    // Use the settled anchor geometry, not the popover's entrance scale.
    var panelStart = envT.parentElement.getBoundingClientRect().right - envP.offsetWidth;
    var inset = Math.max(0, bounds.right - panelStart + 24);
    if (bounds.width - inset < 480) {
      environmentPopover.close();
      conversation.style.removeProperty(property);
      return;
    }
    conversation.style.setProperty(property, inset + "px");
  }
  var environmentResize = new ResizeObserver(syncEnvironmentSpace);
  environmentResize.observe($("#conversation"));
  environmentResize.observe(envP);
  window.addEventListener("resize", syncEnvironmentSpace);

  /* ---------- 会话行「更多」菜单（对齐真实 thread-action/thread-menu：重命名/分叉/归档/删除对话） ---------- */
  var threadMenu = document.createElement("div");
  threadMenu.className = "thread-menu";
  threadMenu.setAttribute("role", "menu");
  threadMenu.innerHTML =
    '<button role="menuitem" data-toast="已进入重命名（演示）">重命名</button>' +
    '<button role="menuitem" data-toast="已分叉对话（演示）">分叉</button>' +
    '<button role="menuitem" data-archive-thread="">归档</button>' +
    '<button role="menuitem" class="danger" data-toast="已删除对话（演示）">删除对话</button>';
  document.body.appendChild(threadMenu);
  var threadController;
  $$(".thread-more").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var wasOpen =
        threadController &&
        threadController.isOpen &&
        threadMenu.parentElement === btn.closest(".thread-wrap");
      if (threadController) threadController.destroy();
      btn.closest(".thread-wrap").appendChild(threadMenu);
      threadController = UI.menu(btn, threadMenu, {
        select: false,
        selector: "button",
        onSelect: function (item) {
          if (item.hasAttribute("data-archive-thread")) {
            if (window.__archiveThreadFromMenu)
              window.__archiveThreadFromMenu(btn);
            return;
          }
          notice(item.dataset.toast);
        },
      });
      if (!wasOpen) threadController.open();
    });
  });

  /* ---------- 顶栏上下文菜单（对齐真实 ComposerContextBar / CodexSelect） ---------- */
  var CHECK_SVG =
    '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" viewBox="0 0 16 16" width="13"><path d="m4.1 8.2 2.5 2.5 5.4-5.6"/></svg>';
  var contextMenus = [];
  function applyProject(value) {
    $("#projName").textContent = value;
    $(".workspace-heading strong").textContent = value;
  }
  function applyBranch(value) {
    $("#branchName").textContent = value;
    $("#environmentBranch .environment-row-copy strong").textContent = value;
    notice("原型分支已切换");
  }
  function setupContext(trigger, menu, apply) {
    var search = menu.querySelector("input"),
      list = menu.querySelector(".composer-context-menu-list"),
      emptyEl = list.querySelector(".composer-context-empty"),
      state = { open: false, trigger: trigger, menu: menu };
    function filter() {
      var query = search.value.trim().toLowerCase(),
        hit = 0;
      list.querySelectorAll("[data-key]").forEach(function (item) {
        var match = item.textContent.toLowerCase().includes(query);
        item.hidden = !match;
        if (match) hit++;
      });
      if (emptyEl) emptyEl.hidden = hit > 0;
    }
    function close(focus) {
      state.open = false;
      menu.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    }
    state.close = close;
    function open() {
      contextMenus.forEach(function (other) {
        if (other !== state && other.open) other.close(false);
      });
      if (modeState.open) modeState.close(false);
      state.open = true;
      menu.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      filter();
      /* visibility 过渡首帧仍不可聚焦，推迟到样式重算后 */
      requestAnimationFrame(function () {
        if (state.open) search.focus({ preventScroll: true });
      });
    }
    trigger.addEventListener("click", function () {
      if (state.open) close(true);
      else open();
    });
    search.addEventListener("input", filter);
    menu.addEventListener("click", function (e) {
      var item = e.target.closest("[data-key]");
      if (item) {
        list.querySelectorAll("[data-key]").forEach(function (row) {
          var selected = row === item;
          row.classList.toggle("selected", selected);
          row.setAttribute("aria-checked", String(selected));
          row.querySelector("i").innerHTML = selected ? CHECK_SVG : "";
        });
        apply(item.dataset.key);
        close(true);
        return;
      }
      var action = e.target.closest("[data-apply]");
      if (action) {
        apply(action.dataset.apply);
        close(true);
      }
    });
    contextMenus.push(state);
  }
  setupContext($("#projSelect"), $("#projMenu"), applyProject);
  setupContext($("#branchSelect"), $("#branchMenu"), applyBranch);

  /* 运行模式（CodexSelect：向下弹 listbox · 箭头循环 active · Enter 选中 · Esc 回焦） */
  var modeS = $("#modeSelect"),
    modeM = $("#modeMenu");
  var modeState = { open: false };
  var modeOptions = $$("#modeMenu .codex-select-option");
  var modeActive = modeOptions.findIndex(function (option) {
    return option.getAttribute("aria-selected") === "true";
  });
  function modeSyncActive() {
    modeOptions.forEach(function (option, i) {
      option.classList.toggle("active", i === modeActive);
    });
    modeM.setAttribute("aria-activedescendant", modeOptions[modeActive].id);
  }
  modeState.close = function (focus) {
    modeState.open = false;
    modeM.classList.remove("open");
    modeS.setAttribute("aria-expanded", "false");
    if (focus) modeS.focus();
  };
  function modeOpen() {
    contextMenus.forEach(function (other) {
      if (other.open) other.close(false);
    });
    modeState.open = true;
    modeM.classList.add("open");
    modeS.setAttribute("aria-expanded", "true");
    modeActive = modeOptions.findIndex(function (option) {
      return option.getAttribute("aria-selected") === "true";
    });
    modeSyncActive();
    requestAnimationFrame(function () {
      if (modeState.open) modeM.focus({ preventScroll: true });
    });
  }
  function modeChoose(index) {
    modeOptions.forEach(function (option, i) {
      var selected = i === index;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", String(selected));
      option.querySelector(".codex-select-check").textContent = selected
        ? "✓"
        : "";
    });
    $("#modeLabel").textContent = modeOptions[index].querySelector(
      "span:last-child",
    ).textContent;
    modeState.close(true);
  }
  modeS.addEventListener("click", function () {
    if (modeState.open) modeState.close(true);
    else modeOpen();
  });
  modeS.addEventListener("keydown", function (e) {
    if (modeState.open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      modeOpen();
      if (e.key === "ArrowUp") {
        modeActive = modeOptions.length - 1;
        modeSyncActive();
      }
    }
  });
  modeM.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      modeActive =
        (modeActive + (e.key === "ArrowDown" ? 1 : -1) + modeOptions.length) %
        modeOptions.length;
      modeSyncActive();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      modeChoose(modeActive);
    }
  });
  modeOptions.forEach(function (option, i) {
    option.addEventListener("click", function () {
      modeChoose(i);
    });
    option.addEventListener("mousemove", function () {
      if (modeActive !== i) {
        modeActive = i;
        modeSyncActive();
      }
    });
  });
  document.addEventListener("pointerdown", function (e) {
    contextMenus.forEach(function (state) {
      if (
        state.open &&
        !state.trigger.contains(e.target) &&
        !state.menu.contains(e.target)
      )
        state.close(false);
    });
    if (modeState.open && !modeS.contains(e.target) && !modeM.contains(e.target))
      modeState.close(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    var openContext = contextMenus.find(function (state) {
      return state.open;
    });
    if (openContext) {
      e.preventDefault();
      openContext.close(true);
    } else if (modeState.open) {
      e.preventDefault();
      modeState.close(true);
    }
  });

  /* ---------- 审批策略菜单 ---------- */
  var polT = $("#policyTrigger"),
    polM = $("#policyMenu");
  var policyController = UI.menu(polT, polM, {
    selector: ".policy-opt",
    selectedClass: "sel",
    onSelect: function (option) {
      $("#policyName").textContent = option.querySelector(".t").textContent;
    },
  });

  /* ---------- 任务计划折叠 ---------- */
  ArtemisPatterns.taskPlan($("#taskPlan"), {
    steps: [
      "梳理现有组件与页面",
      "建立共享设计令牌",
      "封装基础与交互组件",
      "迁移工作台组合",
      "验证主题与键盘交互",
    ],
    index: 2,
    statuses: ["completed", "completed", "in_progress", "pending", "pending"],
  });

  /* ---------- 其余交互 ---------- */
  $$(".tool-card-head").forEach(function (head) {
    UI.disclosure(head, null, { classTarget: head.closest(".tool-card") });
  });
  var approval = $("#approvalCard"),
    note = $("#settledNote");
  var SETTLED = {
    allow: ["var(--success)", "已允许 · 本次会话内同类写入自动通过"],
    once: ["var(--success)", "已允许 · 仅此一次"],
    deny: ["var(--danger)", "已拒绝 · 未写入任何文件"],
  };
  $$("[data-settle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var s = SETTLED[btn.getAttribute("data-settle")];
      approval.classList.add("settled");
      note.style.color = s[0];
      note.textContent = s[1];
    });
  });
  $$(".thread").forEach(function (t) {
    t.addEventListener("click", function () {
      $$(".thread").forEach(function (x) {
        x.classList.remove("active");
      });
      t.classList.add("active");
      $$(".project-item").forEach(function (project) { project.classList.toggle("active", project.contains(t)); });
    });
  });

  $$(".project-item").forEach(function (project) { project.classList.toggle("active", !!project.querySelector(".thread.active")); });

  $$(".switch").forEach(function (sw) {
    UI.toggle(sw);
  });
  var toastEl = $("#toast"),
    toaster = UI.toast(toastEl, { duration: 2200 });
  $$("[data-toast]").forEach(function (b) {
    b.addEventListener("click", function () {
      notice(b.dataset.toast);
    });
  });

  /* ---------- 消息接入（方向 B：单列分区卡片流；derive 为单一事实源） ----------
     状态对象 → imDerive() → 各卡徽标/摘要/告警角标/胶囊聚合/自动展开；
     #im-demo=empty|progress|alert 重放（applyDemo 全量重建，幂等）。 */
  var imPanel = $("#settingsPanelIm");
  if (imPanel) {
    var IM_PLATFORMS = [
      { key: "feishu", name: "飞书" },
      { key: "wecom", name: "企业微信" },
      { key: "slack", name: "Slack" },
    ];
    var IM_CARD_ORDER = ["service", "bots", "account", "projects", "groups"];
    var IM_PAIR_CODES = ["7K2Q-XR9M", "3TD8-M52W", "9FJ4-QN7C"];
    var IM_ICON_BELL = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="M7 16.5h10c-.9-1.1-1.5-2.7-1.5-5a3.5 3.5 0 0 0-7 0c0 2.3-.6 3.9-1.5 5z"></path><path d="M10.3 19a1.8 1.8 0 0 0 3.4 0"></path><path d="M12 4.2v1.6"></path><path d="M6.8 6.3l1.1 1.1"></path><path d="M17.2 6.3l-1.1 1.1"></path></svg>';
    var IM_ICON_BELL_OFF = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="M7 16.5h10c-.9-1.1-1.5-2.7-1.5-5a3.5 3.5 0 0 0-7 0c0 2.3-.6 3.9-1.5 5z"></path><path d="M10.3 19a1.8 1.8 0 0 0 3.4 0"></path><path d="M5 5l14 14"></path></svg>';
    var IM_ICON_UNLINK = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="m9.2 14.8 5.6-5.6"></path><path d="M11 16.2 8.6 18.6a2.55 2.55 0 0 1-3.6-3.6l2.4-2.4"></path><path d="M13 7.8l2.4-2.4a2.55 2.55 0 0 1 3.6 3.6l-2.4 2.4"></path></svg>';

    /* 演示状态种子：empty=空态 / progress=进行中 / alert=告警 */
    var IM_SEEDS = {
      empty: {
        gateway: { started: false, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: false,
        connections: { feishu: [], wecom: [], slack: [] },
        pairingRequests: [],
        bindings: [],
        groups: [],
        projects: [
          { id: "Artemis", path: "~/Documents/Artemis", checked: false, expired: false },
          { id: "token-lab", path: "~/Documents/token-lab", checked: false, expired: false },
        ],
        defaultProject: "",
        pairCode: IM_PAIR_CODES[0],
      },
      progress: {
        gateway: { started: true, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: true,
        connections: {
          feishu: [
            { conn: "conn-1", app: "Artemis 机器人", state: "ok", note: "已连接 · 2 分钟前" },
          ],
          wecom: [],
          slack: [],
        },
        pairingRequests: [],
        bindings: [],
        groups: [],
        projects: [
          { id: "Artemis", path: "~/Documents/Artemis", checked: false, expired: false },
          { id: "token-lab", path: "~/Documents/token-lab", checked: false, expired: false },
        ],
        defaultProject: "",
        pairCode: IM_PAIR_CODES[0],
      },
      alert: {
        gateway: { started: true, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: true,
        connections: {
          feishu: [
            { conn: "conn-1", app: "Artemis 机器人", state: "bad", reason: "App Secret 已失效" },
            { conn: "conn-2", app: "Artemis 备用机器人", state: "ok", note: "已连接 · 2 分钟前" },
          ],
          wecom: [
            { conn: "conn-3", app: "Artemis 机器人", state: "ok", note: "已连接 · 5 分钟前" },
          ],
          slack: [
            { conn: "conn-4", app: "Artemis 机器人", state: "reconnecting", attempt: 2 },
          ],
        },
        pairingRequests: [{ name: "张伟", id: "u_33c1", platform: "feishu" }],
        bindings: [
          { name: "王小明", id: "u_9f3a", platform: "feishu", mode: "Plan", muted: true },
          { name: "李四", id: "u_2c71", platform: "feishu", mode: "Execute", muted: false },
        ],
        groups: [
          { name: "artemis-ui-评审群", members: 5, platform: "feishu" },
          { name: "packaging-standby", members: 2, platform: "wecom" },
        ],
        projects: [
          { id: "Artemis", path: "~/Documents/Artemis", checked: true, expired: false },
          { id: "token-lab", path: "~/Documents/token-lab", checked: false, expired: true },
        ],
        defaultProject: "Artemis",
        pairCode: IM_PAIR_CODES[0],
      },
    };

    var imState = null; /* 当前演示状态（可变副本） */
    var imDerived = null; /* imDerive 缓存 */
    var imManual = {}; /* 用户手动展开/折叠：cardKey → boolean */
    var imCardEls = {};
    IM_CARD_ORDER.forEach(function (key) {
      var el = imPanel.querySelector('.im-card[data-im-card="' + key + '"]');
      if (el) imCardEls[key] = el;
    });
    var imMaster = $("#imMasterSwitch"),
      imPill = $("#imStatePill"),
      imStateText = $("#imStateText");

    /* ===== derive：状态 → 徽标 / 摘要 / 告警角标 / 胶囊 / 自动展开 ===== */
    function imDerive(s) {
      var platforms = {};
      var healthyTotal = 0,
        badTotal = 0,
        reconnectTotal = 0;
      IM_PLATFORMS.forEach(function (p) {
        var conns = (s.connections && s.connections[p.key]) || [];
        var ok = 0,
          bad = 0,
          rc = 0;
        conns.forEach(function (c) {
          if (c.state === "ok") ok += 1;
          else if (c.state === "bad") bad += 1;
          else if (c.state === "reconnecting") rc += 1;
        });
        healthyTotal += ok;
        badTotal += bad;
        reconnectTotal += rc;
        var agg;
        if (!conns.length) agg = "none";
        else if (bad && ok) agg = "partial";
        else if (bad && !ok) agg = "allbad";
        else if (rc && !ok) agg = "reconnecting";
        else agg = "ok";
        platforms[p.key] = { conns: conns, ok: ok, bad: bad, rc: rc, agg: agg };
      });

      var serviceAlerts = s.gateway.linkBroken ? 1 : 0;
      var expired = s.projects.filter(function (pr) { return pr.expired; }).length;
      var checkedProjects = s.projects.filter(function (pr) { return pr.checked; }).length;
      var healthyPlatformNames = IM_PLATFORMS.filter(function (p) {
        return platforms[p.key].ok > 0;
      }).map(function (p) { return p.name; });
      var connsTotal = healthyTotal + badTotal + reconnectTotal;
      var groupMembers = s.groups.reduce(function (n, g) { return n + g.members; }, 0);

      var serviceDone = s.gateway.started && !s.gateway.linkBroken;
      var botsDone = healthyTotal > 0;
      var accountDone = s.bindings.length > 0;
      var projectsDone = checkedProjects > 0 && expired === 0;
      var anyConfigured = connsTotal > 0;
      var paused = !s.masterOn && anyConfigured;

      /* 完成链（⑤不参与、不阻塞）：第一个未完成卡即「当前步骤」 */
      var chain = [
        ["service", serviceDone],
        ["bots", botsDone],
        ["account", accountDone],
        ["projects", projectsDone],
      ];
      var firstUndone = null;
      for (var i = 0; i < chain.length; i += 1) {
        if (!chain[i][1]) { firstUndone = chain[i][0]; break; }
      }

      function cardState(key, done, warnInstead) {
        if (warnInstead) return "warn";
        if (done) return "done";
        return firstUndone === key ? "current" : "todo";
      }

      var cards = {};
      /* ① 连接服务 */
      cards.service = {
        state: s.gateway.linkBroken ? "warn" : serviceDone ? "done" : "current",
        badgeText: s.gateway.linkBroken ? "服务断连" : serviceDone ? "已就绪" : "待开启",
        alerts: serviceAlerts,
        summary: serviceDone
          ? "已就绪 · 本机运行 · " + s.gateway.deviceId
          : "先开启服务",
      };
      /* ② 添加机器人 */
      var botsBadgeText = "待办";
      if (botsDone) botsBadgeText = "已连接 · " + healthyPlatformNames[0];
      else if (anyConfigured && !healthyTotal) botsBadgeText = "连接失败";
      else if (firstUndone === "bots") botsBadgeText = "当前步骤";
      else if (!serviceDone) botsBadgeText = "待开启";
      cards.bots = {
        state: cardState("bots", botsDone, anyConfigured && !healthyTotal),
        badgeText: botsBadgeText,
        alerts: badTotal,
        summary: botsDone
          ? "已连接 · " + healthyPlatformNames.join("、") + " · " + healthyTotal + " 个机器人"
          : anyConfigured
            ? "有连接故障，点开查看"
            : "还没有机器人，先添加一个",
      };
      /* ③ 绑定我的账号 */
      cards.account = {
        state: cardState("account", accountDone, false),
        badgeText: accountDone
          ? "已绑定 " + s.bindings.length + " 人"
          : firstUndone === "account"
            ? "当前步骤"
            : serviceDone || botsDone
              ? "待绑定"
              : "待开启",
        alerts: s.pairingRequests.length,
        summary: s.pairingRequests.length
          ? s.pairingRequests.length + " 条绑定待确认"
          : accountDone
            ? "已绑定 " + s.bindings.length + " 个账号"
            : "发一条配对指令即可绑定",
      };
      /* ④ 允许手机操作的项目 */
      cards.projects = {
        state: cardState("projects", checkedProjects > 0, false),
        badgeText: checkedProjects > 0
          ? "已授权 " + checkedProjects + " 个"
          : firstUndone === "projects"
            ? "当前步骤"
            : "待选择",
        alerts: expired,
        summary: checkedProjects
          ? "已授权 " + checkedProjects + " 个项目" +
            (s.defaultProject ? " · 默认 " + s.defaultProject : "")
          : "还没有选择项目",
      };
      /* ⑤ 群协作（可选） */
      cards.groups = {
        state: s.groups.length ? "done" : "todo",
        badgeText: s.groups.length ? "已连接 " + s.groups.length + " 群" : "未设置",
        alerts: 0,
        summary: s.groups.length
          ? "已连接 " + s.groups.length + " 个群 · " + groupMembers + " 名成员"
          : "未设置",
      };

      if (!s.gateway.started) {
        /* 空态：②-⑤ 折叠为统一的「先开启服务」摘要行（点击=定位①大按钮） */
        IM_CARD_ORDER.forEach(function (key) {
          cards[key].summary = "先开启服务";
        });
      }
      if (paused) {
        /* 主开关关闭：徽标保留，摘要加「已暂停」后缀 */
        IM_CARD_ORDER.forEach(function (key) {
          cards[key].summary += " · 已暂停";
        });
      }

      /* 胶囊聚合：未接入任何平台 → 未开启；暂停优先于健康态；故障计数可点定位 */
      var pill;
      if (!connsTotal) pill = { tone: "off", html: "未开启", count: 0 };
      else if (!s.masterOn)
        pill = { tone: "paused", html: "已暂停响应 IM 指令", count: 0 };
      else if (badTotal + serviceAlerts > 0)
        pill = {
          tone: "warn",
          html: "<strong>" + (badTotal + serviceAlerts) + "</strong> 个机器人连接失败",
          count: badTotal + serviceAlerts,
        };
      else
        pill = {
          tone: "ok",
          html: "一切正常 · <strong>" + healthyTotal + "</strong> 个机器人在线",
          count: healthyTotal,
        };

      var autoExpand = [];
      if (firstUndone) autoExpand.push(firstUndone);
      IM_CARD_ORDER.forEach(function (key) {
        if (cards[key].alerts > 0 && autoExpand.indexOf(key) < 0) autoExpand.push(key);
      });

      return {
        platforms: platforms,
        healthyTotal: healthyTotal,
        badTotal: badTotal,
        reconnectTotal: reconnectTotal,
        paused: paused,
        firstUndone: firstUndone,
        cards: cards,
        pill: pill,
        autoExpand: autoExpand,
        expired: expired,
        projectsDone: projectsDone,
        ready: serviceDone && botsDone && accountDone && projectsDone &&
          badTotal + serviceAlerts + s.pairingRequests.length + expired === 0,
        groupMembers: groupMembers,
      };
    }

    /* ===== 渲染：结构（applyDemo 全量重建）+ 状态（imRefresh 原地更新） ===== */
    function imPlatformDotClass(st) {
      if (imDerived.paused) return "idle";
      if (st.agg === "ok") return "ok";
      if (st.agg === "allbad") return "bad";
      if (st.agg === "partial" || st.agg === "reconnecting") return "pending";
      return "idle";
    }

    /* M2b 凭据子卡：字段清单（接收方式条件化）+ 保存并重连三态流 + 接入指引 */
    var IM_FIELD = function (label, inputHtml, extra) {
      return (
        '<label class="im-field' + (extra || "") + '"><span class="im-field-label">' +
        label + "</span>" + inputHtml + "</label>"
      );
    };
    var IM_RECEIVE_SELECT =
      '<select class="im-field-input" data-im-receive-mode=""><option selected="" value="ws">长连接（推荐）</option><option value="https">HTTPS 回调</option></select>';
    var IM_FORWARD_URL = function (platformKey) {
      return (
        '<div class="im-field field-wide" data-im-https-only="" hidden="">' +
        '<span class="im-field-label">消息转发地址（复制到平台后台）</span>' +
        '<div class="im-callback"><code class="im-identifier">https://gw.example.com/im/' +
        platformKey + '/conn-1/callback</code>' +
        '<button class="btn btn-ghost" data-copy="" type="button">复制</button></div></div>'
      );
    };

    function imSubcardTemplate(p) {
      var fields = "";
      if (p.key === "feishu") {
        fields =
          IM_FIELD("App ID", '<input class="im-field-input" placeholder="cli_a5…" spellcheck="false"/>') +
          IM_FIELD("机器人 Open ID", '<input class="im-field-input" placeholder="ou_…（不是 App ID）" spellcheck="false"/>') +
          IM_FIELD("Tenant Key", '<input class="im-field-input" placeholder="tenant_id" spellcheck="false"/>') +
          IM_FIELD("区域", '<select class="im-field-input"><option selected="">中国</option><option>新加坡</option><option>美国</option></select>') +
          IM_FIELD("App Secret", '<input class="im-field-input" type="password"/>') +
          IM_FIELD("接收方式", IM_RECEIVE_SELECT) +
          IM_FIELD("Verification Token", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FIELD("Encrypt Key", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FORWARD_URL(p.key);
      } else if (p.key === "wecom") {
        fields =
          IM_FIELD("企业 ID", '<input class="im-field-input" placeholder="ww…" spellcheck="false"/>') +
          IM_FIELD("Agent ID", '<input class="im-field-input"/>') +
          IM_FIELD("应用 Secret", '<input class="im-field-input" type="password"/>') +
          IM_FIELD("接收方式", IM_RECEIVE_SELECT) +
          IM_FIELD("Token", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FIELD("EncodingAESKey", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FORWARD_URL(p.key);
      } else {
        fields =
          IM_FIELD("Bot Token", '<input class="im-field-input" placeholder="xoxb-…" spellcheck="false"/>') +
          IM_FIELD("App ID", '<input class="im-field-input" placeholder="A1…"/>') +
          IM_FIELD("Client ID", '<input class="im-field-input"/>') +
          IM_FIELD("接收方式", IM_RECEIVE_SELECT) +
          IM_FIELD("Client Secret", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FIELD("Signing Secret", '<input class="im-field-input" type="password"/>', '" data-im-https-only="" hidden=""') +
          IM_FORWARD_URL(p.key);
      }
      return (
        '<div class="im-subcard" data-im-subcard="' + p.key + '" hidden="">' +
        '<div class="im-subcard-saved" data-im-cred-saved="" hidden="">' +
        '<p class="im-muted">机器人信息已加密保存在本机，不会回显。</p>' +
        '<button class="btn btn-ghost" data-im-cred-swap="" type="button">已保存 · 更换</button></div>' +
        '<form class="im-credentials-form" data-im-cred-form="">' +
        '<div class="im-subcard-title">机器人信息（加密保存在本机，不回显）</div>' +
        '<div class="form-grid">' + fields + "</div>" +
        '<p class="im-fine">保存后机器人会用新密钥重新连接。</p>' +
        '<div class="btn-pair"><button class="btn btn-primary" data-im-cred-save="" type="button">保存并重连</button>' +
        '<button class="btn btn-ghost" data-im-cred-cancel="" type="button">取消</button></div></form>' +
        '<button aria-expanded="false" class="im-guide-toggle" data-im-fold="" type="button"><span>接入指引（权限与事件订阅）</span><span aria-hidden="true" class="im-guide-caret">▸</span></button>' +
        '<div class="im-fold-body" hidden="">' + imGuideTemplate(p.key) + "</div></div>"
      );
    }

    function imGuideTemplate(platformKey) {
      if (platformKey === "feishu") {
        return (
          '<ol class="im-guide"><li><p>在飞书开发者后台创建企业自建应用。</p></li>' +
          '<li><p>开通以下权限：</p><div class="im-chips">' +
          '<button class="im-chip" type="button"><code>im:message</code><span aria-hidden="true">⧉</span></button>' +
          '<button class="im-chip" type="button"><code>im:message:send_as_bot</code><span aria-hidden="true">⧉</span></button>' +
          '<button class="im-chip" type="button"><code>im:message.reaction:write</code><span aria-hidden="true">⧉</span></button>' +
          '<button class="im-chip" type="button"><code>im:resource</code><span aria-hidden="true">⧉</span></button></div></li>' +
          '<li><p>事件订阅方式选择「长连接」（选 HTTPS 回调时把上方转发地址填入平台后台）。</p></li>' +
          '<li><p>订阅事件：</p><div class="im-chips"><button class="im-chip" type="button"><code>im.message.receive_v1</code><span aria-hidden="true">⧉</span></button></div></li>' +
          '<li class="im-guide-warning"><p>在「回调配置」（不是事件订阅）添加：</p><div class="im-chips"><button class="im-chip" type="button"><code>card.action.trigger</code><span aria-hidden="true">⧉</span></button></div></li>' +
          '<li><p>创建版本并发布。</p></li></ol>'
        );
      }
      if (platformKey === "wecom") {
        return (
          '<ol class="im-guide"><li><p>在企业微信管理后台创建企业自建应用。</p></li>' +
          '<li><p>记录企业 ID、Agent ID 与应用 Secret。</p></li>' +
          '<li><p>在「接收消息」页配置回调凭证；长连接无需公网，HTTPS 回调需把上方转发地址加入白名单。</p></li>' +
          '<li><p>把可信域名加入应用白名单。</p></li></ol>'
        );
      }
      return (
        '<ol class="im-guide"><li><p>在 Slack API 创建应用，或直接导入 Manifest。</p></li>' +
        '<li><p>开启 Socket Mode（无需公网回调）。</p></li>' +
        '<li><p>订阅 <code class="im-identifier">message.im</code> 等事件并授予权限。</p></li></ol>'
      );
    }

    /* 平台行动作：按聚合态派生（全部状态推导，不写死） */
    function imPlatformActions(st) {
      if (st.agg === "none")
        return '<button class="btn btn-ghost" data-im-add="" type="button">去添加</button>';
      if (st.agg === "allbad")
        return (
          '<button class="btn btn-ghost" data-im-view-reason="" type="button">查看原因</button>' +
          '<button class="btn btn-ghost" data-im-reenter="" type="button">重新输入密钥</button>'
        );
      if (st.agg === "reconnecting")
        return (
          '<button class="btn btn-ghost" data-im-retry="" type="button">重试</button>' +
          '<button class="btn btn-ghost" data-im-manage="" type="button">管理</button>'
        );
      return '<button class="btn btn-ghost" data-im-manage="" type="button">管理</button>';
    }

    function imConnSubrows(st) {
      return st.conns
        .map(function (c) {
          var dotClass = c.state === "ok" ? "ok" : c.state === "bad" ? "bad" : "pending";
          var stateText =
            c.state === "ok" ? "已连接" : c.state === "bad" ? "连接失败" : "正在重连 · 第 " + (c.attempt || 1) + " 次";
          var note = c.state === "ok" ? c.note || "" : c.reason || "";
          return (
            '<div class="im-conn-row" title="' + c.conn + '">' +
            '<span aria-hidden="true" class="im-dot ' + dotClass + '"></span>' +
            '<span class="im-conn-app">' + (c.app || "机器人") + "</span>" +
            '<span class="im-conn-state">' + stateText + "</span>" +
            '<span class="im-conn-time">' + note + "</span></div>"
          );
        })
        .join("");
    }

    function imBuildPlatformRows() {
      var list = imPanel.querySelector("[data-im-platform-rows]");
      list.textContent = "";
      IM_PLATFORMS.forEach(function (p) {
        var st = imDerived.platforms[p.key];
        var showConns =
          st.conns.length > 1 ||
          st.agg === "partial" ||
          st.agg === "allbad" ||
          st.agg === "reconnecting";
        var li = document.createElement("li");
        li.className = "im-platform-row";
        li.setAttribute("data-im-platform", p.key);
        li.innerHTML =
          '<div class="im-platform-line">' +
          '<span aria-hidden="true" class="im-dot"></span>' +
          '<span class="im-platform-name">' + p.name + "</span>" +
          '<span class="im-platform-status"></span>' +
          '<span class="im-platform-actions">' + imPlatformActions(st) + "</span></div>" +
          '<p class="im-platform-reason" hidden=""></p>' +
          '<div class="im-conn-subrows"' + (showConns ? "" : ' hidden=""') + ">" +
          imConnSubrows(st) + "</div>" +
          imSubcardTemplate(p);
        list.appendChild(li);
      });
    }

    function imUpdatePlatformRows() {
      IM_PLATFORMS.forEach(function (p) {
        var row = imPanel.querySelector('[data-im-platform="' + p.key + '"]');
        if (!row) return;
        var st = imDerived.platforms[p.key];
        var dot = row.querySelector(".im-platform-line > .im-dot");
        var status = row.querySelector(".im-platform-status");
        dot.className = "im-dot " + imPlatformDotClass(st);
        var text;
        if (st.agg === "none") text = "未配置";
        else if (st.agg === "ok") text = "已连接 · " + st.conns.length + " 个";
        else if (st.agg === "partial") text = st.bad + "/" + st.conns.length + " 连接故障";
        else if (st.agg === "allbad") text = "连接失败";
        else if (st.agg === "reconnecting")
          text = "正在重连 · 第 " + ((st.conns[0] && st.conns[0].attempt) || 1) + " 次";
        status.textContent = text;
        var reason = row.querySelector(".im-platform-reason");
        if (st.agg === "allbad") {
          reason.hidden = false;
          reason.textContent =
            (st.conns[0] && st.conns[0].reason) || "连接失败，请检查凭据";
        } else {
          reason.hidden = true;
        }
      });
    }

    function imPairCommand(platformKey) {
      /* Slack 无斜杠（spec 规定），其余 /pair */
      return (platformKey === "slack" ? "pair " : "/pair ") + imState.pairCode;
    }

    /* 配对码时效：到期变「已过期」，[换一个] 重置倒计时并换新码 */
    var imSecondsLeft = 4 * 60 + 32;
    var imCodeExpired = false;
    function imExpiryText() {
      var m = Math.floor(imSecondsLeft / 60),
        s = imSecondsLeft % 60;
      return m + ":" + String(s).padStart(2, "0");
    }
    function imRenewCode() {
      imSecondsLeft = 4 * 60 + 32;
      imCodeExpired = false;
      var i = IM_PAIR_CODES.indexOf(imState.pairCode);
      imState.pairCode = IM_PAIR_CODES[(i + 1) % IM_PAIR_CODES.length];
      imBuildInstructions();
      imRefresh();
      notice("已换新配对码（演示）");
    }

    /* 配对请求卡：置顶③折叠体，带平台徽标；批准/拒绝后移除 */
    function imBuildPairingRequests() {
      var box = imPanel.querySelector("[data-im-pairing-requests]");
      box.textContent = "";
      imState.pairingRequests.forEach(function (req, idx) {
        var platformName = (IM_PLATFORMS.filter(function (p) {
          return p.key === req.platform;
        })[0] || {}).name || req.platform;
        var card = document.createElement("div");
        card.className = "im-pairing-request-card";
        card.setAttribute("data-im-pairing-idx", String(idx));
        card.innerHTML =
          '<div class="im-pair-head"><span aria-hidden="true" class="im-dot pending"></span>' +
          "<strong>" + req.name + " 请求绑定这台电脑</strong></div>" +
          '<div class="im-pair-who"><span class="im-pair-platform">' + platformName + "</span>" +
          '<code class="im-identifier">' + req.id + "</code></div>" +
          '<div class="im-pair-actions"><button class="btn btn-primary" data-im-approve="" type="button">批准</button>' +
          '<button class="btn btn-ghost" data-im-reject="" type="button">拒绝</button></div>';
        box.appendChild(card);
      });
    }

    function imBuildInstructions() {
      var box = imPanel.querySelector("[data-im-instructions]");
      var healthy = IM_PLATFORMS.filter(function (p) {
        return imDerived.platforms[p.key].ok > 0;
      });
      if (!healthy.length) {
        box.innerHTML = '<p class="im-muted">先在 ② 添加并连接一个机器人，这里会给出配对指令。</p>';
        return;
      }
      var html = '<p class="im-instr-title">1. 把这条消息发给机器人私聊：</p>';
      healthy.forEach(function (p) {
        var conn = imDerived.platforms[p.key].conns.filter(function (c) {
          return c.state === "ok";
        })[0];
        html +=
          '<div class="im-instr-line"><span class="im-instr-who">' +
          p.name + " · " + (conn && conn.app ? conn.app : "机器人") +
          '</span><code class="im-identifier">' + imPairCommand(p.key) +
          '</code><button class="btn btn-ghost" data-copy-pair="" type="button">复制指令</button></div>';
      });
      html +=
        '<p class="im-fine"><span data-im-expiry-note=""><span class="im-countdown" data-im-countdown="">' +
        imExpiryText() + '</span>' + (imCodeExpired ? "" : " 后过期") +
        '</span> · <button class="im-demo-link" data-im-renew-code="" type="button">换一个</button></p>' +
        '<p class="im-instr-title">2. 机器人回复确认后，账号会出现在下面。</p>';
      box.innerHTML = html;
      /* 重建后重新挂复制反馈 */
      Array.prototype.forEach.call(
        box.querySelectorAll("[data-copy-pair]"),
        function (btn) {
          btn.addEventListener("click", function () {
            var original = btn.textContent;
            btn.textContent = "已复制";
            setTimeout(function () { btn.textContent = original; }, 1400);
          });
        },
      );
    }

    function imBuildBindings() {
      var list = imPanel.querySelector("[data-im-bindings]");
      list.textContent = "";
      imState.bindings.forEach(function (b, idx) {
        var li = document.createElement("li");
        li.className = "im-binding-row";
        li.setAttribute("data-im-binding-idx", String(idx));
        li.innerHTML =
          '<div class="im-binding-main"><span class="im-binding-name">' + b.name +
          '</span><code class="im-identifier">' + b.id + "</code>" +
          '<span class="im-binding-meta">' +
          (IM_PLATFORMS.filter(function (p) { return p.key === b.platform; })[0] || {}).name +
          " · " + b.mode + ' 模式</span>' +
          (b.muted ? '<span class="im-binding-tag">已静音</span>' : "") +
          '</div><div class="im-binding-actions">' +
          '<button aria-label="' + (b.muted ? "恢复输出" : "静音") +
          '" class="im-icon-btn" data-im-mute="" title="' + (b.muted ? "恢复输出" : "静音") +
          '" type="button">' + (b.muted ? IM_ICON_BELL : IM_ICON_BELL_OFF) +
          '</button><button aria-label="解除绑定" class="im-icon-btn danger" data-im-unbind="" title="解除绑定" type="button">' +
          IM_ICON_UNLINK + "</button></div>" +
          '<div class="im-unbind-confirm" hidden=""><span>确认解除与该账号的绑定？</span>' +
          '<button class="btn btn-ghost danger" data-im-unbind-done="" type="button">确认解除</button>' +
          '<button class="btn btn-ghost" data-im-keep="" type="button">保留</button></div>';
        list.appendChild(li);
      });
      imPanel.querySelector("[data-im-binding-empty]").hidden = imState.bindings.length > 0;
    }

    function imBuildProjects() {
      var list = imPanel.querySelector("[data-im-project-rows]");
      list.textContent = "";
      imState.projects.forEach(function (pr, idx) {
        var li = document.createElement("li");
        li.className = "im-project";
        li.setAttribute("data-im-project-idx", String(idx));
        li.innerHTML =
          '<label class="settings-checkbox im-project-head"><input type="checkbox"' +
          (pr.checked ? " checked" : "") + '><span><strong>' + pr.id + "</strong><small>" + pr.path + "</small></span></label>" +
          (pr.expired
            ? '<div class="im-project-expired"><span>⚠ 授权已到期</span><button class="btn btn-ghost" data-im-reauthorize="" type="button">去授权</button></div>'
            : "") +
          '<button aria-expanded="false" class="im-guide-toggle" data-im-fold="" type="button"><span>调整权限</span><span aria-hidden="true" class="im-guide-caret">▸</span></button>' +
          '<div class="im-fold-body" hidden=""><div class="form-grid">' +
          '<label class="im-field"><span class="im-field-label">模式</span><select class="im-field-input"><option' + (pr.id === "Artemis" ? ' selected' : "") + '>Execute</option><option' + (pr.id === "token-lab" ? ' selected' : "") + '>Plan</option><option>Review</option></select></label>' +
          '<label class="im-field"><span class="im-field-label">审批</span><select class="im-field-input"><option selected="">智能审批</option><option>每步确认</option></select></label>' +
          '<label class="im-field"><span class="im-field-label">沙箱</span><select class="im-field-input"><option selected="">默认（Seatbelt / AppContainer）</option><option>完整本机访问</option></select></label>' +
          '<label class="im-field"><span class="im-field-label">网络</span><select class="im-field-input"><option selected="">按服务器</option><option>允许全部</option></select></label>' +
          '<label class="im-field"><span class="im-field-label">到期</span><input class="im-field-input" data-im-expiry-field="" type="date" value="' + (pr.expired ? "2026-09-01" : "2026-10-05") + '"/></label>' +
          '</div><div class="setting-row"><div class="label">到期自动续期</div><span class="sp"></span><button aria-checked="true" aria-label="到期自动续期" class="switch on" role="switch" type="button"></button></div></div>';
        var checkbox = li.querySelector('input[type="checkbox"]');
        checkbox.addEventListener("change", function () {
          imState.projects[idx].checked = checkbox.checked;
          imRefresh();
        });
        list.appendChild(li);
        /* 动态渲染的 switch 需单独初始化 */
        var sw = li.querySelector(".switch");
        if (sw && window.ArtemisUI) window.ArtemisUI.toggle(sw);
      });
      /* 默认项目下拉 */
      var select = imPanel.querySelector("[data-im-default-project]");
      select.innerHTML =
        '<option value="">未选择</option>' +
        imState.projects
          .map(function (pr) {
            return '<option value="' + pr.id + '"' +
              (imState.defaultProject === pr.id ? " selected" : "") + ">" + pr.id + "</option>";
          })
          .join("");
    }

    function imRenderPill() {
      var pill = imDerived.pill;
      imPill.dataset.tone = pill.tone;
      imPill.setAttribute(
        "title",
        pill.tone === "warn"
          ? "点按定位到「添加机器人」卡片"
          : "机器人接入状态；不代表聊天软件客户端在线状态。",
      );
      imStateText.innerHTML = pill.html;
      var dot = imPill.querySelector(".im-dot");
      dot.className =
        "im-dot " + (pill.tone === "ok" ? "ok" : pill.tone === "warn" ? "pending" : "idle");
      imPill.disabled = pill.tone !== "warn";
    }

    function imRenderCards() {
      IM_CARD_ORDER.forEach(function (key) {
        var card = imCardEls[key];
        if (!card) return;
        var c = imDerived.cards[key];
        var badge = card.querySelector("[data-im-badge]");
        badge.dataset.state = c.state;
        badge.textContent = c.badgeText;
        var alerts = card.querySelector("[data-im-alerts]");
        if (c.alerts > 0) {
          alerts.hidden = false;
          alerts.setAttribute("aria-label", c.alerts + " 条告警");
          alerts.textContent = "⚠" + c.alerts;
        } else {
          alerts.hidden = true;
        }
        var summary = card.querySelector("[data-im-summary]");
        summary.textContent = c.summary;
        var open = key in imManual
          ? !!imManual[key]
          : imDerived.autoExpand.indexOf(key) >= 0;
        card.querySelector(".im-card-body").hidden = !open;
        card.querySelector("[data-im-card-head]").setAttribute("aria-expanded", String(open));
        card.querySelector("[data-im-caret]").textContent = open ? "▾" : "▸";
        summary.hidden = open;
      });
    }

    function imRefresh() {
      imDerived = imDerive(imState);
      imRenderPill();
      imRenderCards();
      /* ① 空态 / 就绪态 */
      imPanel.querySelector("[data-im-service-empty]").hidden = imState.gateway.started;
      imPanel.querySelector("[data-im-service-ready]").hidden = !imState.gateway.started;
      /* ② 平台行信号灯与聚合文案（暂停时转 idle） */
      imUpdatePlatformRows();
      /* ③ 衔接行：④未完成才显示 */
      imPanel.querySelector("[data-im-goto-projects]").hidden = imDerived.projectsDone;
      /* M6 全部就绪条：①②③④ 全 ✓ 且无任何 ⚠（⑤除外） */
      var readyBar = imPanel.querySelector("[data-im-ready]");
      if (readyBar) readyBar.hidden = !imDerived.ready;
      /* 主开关：服务未开启时禁用 */
      imMaster.disabled = !imState.gateway.started;
      imMaster.classList.toggle("on", imState.masterOn);
      imMaster.setAttribute("aria-checked", String(imState.masterOn));
      imMaster.setAttribute(
        "title",
        imState.gateway.started
          ? "关闭后停止响应 IM 指令，配置保留"
          : "开启消息服务后可启用",
      );
    }

    /* ⑤ 群列表行：名称 · 成员数 · 平台 [诊断] */
    function imBuildGroups() {
      var list = imPanel.querySelector("[data-im-group-rows]");
      if (!list) return;
      list.textContent = "";
      if (!imState.groups.length) {
        var empty = document.createElement("li");
        empty.className = "im-group-empty";
        empty.textContent = "还没有连接任何群。";
        list.appendChild(empty);
        return;
      }
      imState.groups.forEach(function (g) {
        var platformName = (IM_PLATFORMS.filter(function (p) {
          return p.key === g.platform;
        })[0] || {}).name || g.platform;
        var li = document.createElement("li");
        li.className = "im-group-row";
        li.innerHTML =
          '<span class="im-group-name">' + g.name + "</span>" +
          '<span class="im-group-meta">' + g.members + " 名成员 · " + platformName + "</span>" +
          '<button class="btn btn-ghost" data-toast="诊断完成：全部正常（演示）" type="button">诊断</button>';
        list.appendChild(li);
      });
    }

    function imRenderAll() {
      imDerived = imDerive(imState);
      imBuildPlatformRows();
      imUpdatePlatformRows();
      imBuildPairingRequests();
      imBuildInstructions();
      imBuildBindings();
      imBuildProjects();
      imBuildGroups();
      imRefresh();
    }

    function imApplyDemo(key) {
      if (!Object.hasOwn(IM_SEEDS, key)) key = "progress";
      imState = JSON.parse(JSON.stringify(IM_SEEDS[key]));
      imManual = {};
      imSecondsLeft = 4 * 60 + 32;
      imCodeExpired = false;
      imRenderAll();
    }

    /* ===== 定位与脉冲（一次性背景脉冲，不用 focus ring） ===== */
    function imPulse(el) {
      if (!el) return;
      el.classList.remove("im-pulse");
      void el.offsetWidth; /* 重启动画 */
      el.classList.add("im-pulse");
      el.addEventListener("animationend", function handler(ev) {
        if (ev.animationName === "im-pulse-bg") {
          el.classList.remove("im-pulse");
          el.removeEventListener("animationend", handler);
        }
      });
    }
    /* 展开目标卡 → .settings-content 滚动到位 → 一次性脉冲 → 焦点落卡头（时序：scroll 先于 focus） */
    function imLocateCard(key, opts) {
      opts = opts || {};
      imManual[key] = true;
      imRenderCards();
      var card = imCardEls[key];
      var head = card.querySelector("[data-im-card-head]");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          head.scrollIntoView({ block: "center", behavior: "smooth" });
          imPulse(opts.pulse || card);
          if (opts.focus !== false) {
            setTimeout(function () { head.focus(); }, 400);
          }
        });
      });
    }

    /* ===== 交互 ===== */
    /* 卡头：切换折叠并记住；空态下 ②-⑤ 点击=闪烁定位①大按钮 */
    imPanel.addEventListener("click", function (ev) {
      var head = ev.target.closest("[data-im-card-head]");
      if (!head) return;
      var card = head.closest(".im-card");
      var key = card.getAttribute("data-im-card");
      if (!imState.gateway.started && key !== "service") {
        var cta = imPanel.querySelector("[data-im-service-start]");
        cta.scrollIntoView({ block: "center", behavior: "smooth" });
        imPulse(cta);
        return;
      }
      imManual[key] = card.querySelector(".im-card-body").hidden;
      imRenderCards();
    });

    /* 聚合胶囊：故障态点击=定位②卡（滚动+一次性脉冲） */
    imPill.addEventListener("click", function () {
      if (imDerived.pill.tone !== "warn") return;
      imLocateCard("bots");
    });

    /* ① 一键开启 */
    imPanel.querySelector("[data-im-service-start]").addEventListener("click", function () {
      imState.gateway.started = true;
      imState.masterOn = true;
      imRefresh();
      notice("消息服务已在本机开启（演示）");
    });

    /* ② 平台行操作与 M2b 凭据子卡（swap / cancel / save 三态流） */
    function imOpenSubcard(platformKey, focusSecret) {
      var row = imPanel.querySelector('[data-im-platform="' + platformKey + '"]');
      var sub = row.querySelector("[data-im-subcard]");
      var st = imDerived.platforms[platformKey];
      var configured = st.conns.length > 0;
      sub.hidden = false;
      sub.querySelector("[data-im-cred-saved]").hidden = !configured;
      sub.querySelector("[data-im-cred-form]").hidden = configured;
      var first = sub.querySelector(
        focusSecret ? 'input[type="password"]' : "input, select",
      );
      if (first) first.focus();
    }
    function imCloseSubcard(platformKey) {
      var row = imPanel.querySelector('[data-im-platform="' + platformKey + '"]');
      var sub = row.querySelector("[data-im-subcard]");
      sub.hidden = true;
      var form = sub.querySelector("[data-im-cred-form]");
      form.reset();
      imApplyReceiveMode(form);
    }
    /* 接收方式：长连接隐藏 HTTPS 专属字段与转发地址 */
    function imApplyReceiveMode(scope) {
      var select = scope.querySelector("[data-im-receive-mode]");
      if (!select) return;
      var https = select.value === "https";
      Array.prototype.forEach.call(
        scope.querySelectorAll("[data-im-https-only]"),
        function (el) {
          el.hidden = !https;
        },
      );
    }
    imPanel.addEventListener("change", function (ev) {
      var select = ev.target.closest("[data-im-receive-mode]");
      if (select) imApplyReceiveMode(select.closest("[data-im-cred-form]"));
    });

    imPanel.addEventListener("click", function (ev) {
      var platformRow = ev.target.closest(".im-platform-row");
      var key = platformRow && platformRow.getAttribute("data-im-platform");
      if (ev.target.closest("[data-im-manage]")) {
        var sub = platformRow.querySelector("[data-im-subcard]");
        if (sub.hidden) imOpenSubcard(key, false);
        else imCloseSubcard(key);
        return;
      }
      if (ev.target.closest("[data-im-add]")) {
        imOpenSubcard(key, false);
        return;
      }
      if (ev.target.closest("[data-im-reenter]")) {
        imOpenSubcard(key, true);
        return;
      }
      if (ev.target.closest("[data-im-view-reason]")) {
        var subs = platformRow.querySelector(".im-conn-subrows");
        subs.hidden = false;
        var badRow = subs.querySelector(".im-dot.bad");
        if (badRow) badRow.closest(".im-conn-row").scrollIntoView({ block: "nearest", behavior: "smooth" });
        var reasonEl = platformRow.querySelector(".im-platform-reason");
        if (reasonEl && !reasonEl.hidden) reasonEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        imPulse(reasonEl && !reasonEl.hidden ? reasonEl : subs);
        return;
      }
      if (ev.target.closest("[data-im-retry]")) {
        var st = imDerived.platforms[key];
        st.conns.forEach(function (c) {
          if (c.state === "reconnecting") c.attempt = (c.attempt || 1) + 1;
        });
        imRefresh();
        notice("已发起重连（演示）");
        return;
      }
      /* 凭据三态流：更换 ↔ 表单（密钥不回显） */
      var swap = ev.target.closest("[data-im-cred-swap]");
      if (swap) {
        var sub2 = swap.closest("[data-im-subcard]");
        sub2.querySelector("[data-im-cred-saved]").hidden = true;
        var form2 = sub2.querySelector("[data-im-cred-form]");
        form2.hidden = false;
        var firstInput = form2.querySelector("input, select");
        if (firstInput) firstInput.focus();
        return;
      }
      if (ev.target.closest("[data-im-cred-cancel]")) {
        var form3 = ev.target.closest("[data-im-cred-form]");
        var sub3 = form3.closest("[data-im-subcard]");
        var row3 = sub3.closest(".im-platform-row");
        var st3 = imDerived.platforms[row3.getAttribute("data-im-platform")];
        form3.reset();
        imApplyReceiveMode(form3);
        if (st3.conns.length > 0) {
          form3.hidden = true;
          sub3.querySelector("[data-im-cred-saved]").hidden = false;
        } else {
          sub3.hidden = true;
        }
        return;
      }
      var save = ev.target.closest("[data-im-cred-save]");
      if (save) {
        var form4 = ev.target.closest("[data-im-cred-form]");
        var sub4 = form4.closest("[data-im-subcard]");
        var rowKey = sub4.closest(".im-platform-row").getAttribute("data-im-platform");
        form4.reset();
        imApplyReceiveMode(form4);
        form4.hidden = true;
        sub4.querySelector("[data-im-cred-saved]").hidden = false;
        /* 演示语义：新密钥重连成功，故障连接恢复健康（角标/胶囊随 derive 收敛） */
        var conns = (imState.connections[rowKey] || []);
        var healed = conns.some(function (c) { return c.state === "bad"; });
        if (healed) {
          conns.forEach(function (c) {
            if (c.state === "bad") {
              c.state = "ok";
              c.note = "已连接 · 刚刚";
              delete c.reason;
            }
          });
          imBuildPlatformRows();
        }
        imRefresh();
        notice("已保存，机器人正在用新密钥重新连接（演示）");
        return;
      }
      /* 复制类按钮反馈（转发地址）与 chips 复制 */
      var copy = ev.target.closest("[data-copy]");
      if (copy) {
        var original = copy.textContent;
        copy.textContent = "已复制";
        setTimeout(function () {
          copy.textContent = original;
        }, 1400);
        return;
      }
      var chip = ev.target.closest(".im-chip");
      if (chip && chip.contains(ev.target)) {
        var mark = chip.querySelector("span[aria-hidden]");
        var markText = mark ? mark.textContent : "";
        chip.classList.add("copied");
        if (mark) mark.textContent = "✓";
        setTimeout(function () {
          chip.classList.remove("copied");
          if (mark) mark.textContent = markText;
        }, 1400);
      }
    });

    /* 主开关：开/关都触发全卡 derive */
    imMaster.addEventListener("click", function () {
      imState.masterOn = imMaster.classList.contains("on");
      imRefresh();
      notice(imState.masterOn ? "已开始响应 IM 指令（演示）" : "已暂停响应 IM 指令，配置保留（演示）");
    });

    /* ③ 配对请求：批准/拒绝后移除（角标与摘要随 derive 收敛） */
    imPanel.addEventListener("click", function (ev) {
      var approve = ev.target.closest("[data-im-approve]");
      var reject = ev.target.closest("[data-im-reject]");
      if (!approve && !reject) return;
      var cardEl = (approve || reject).closest("[data-im-pairing-idx]");
      var idx = Number(cardEl.getAttribute("data-im-pairing-idx"));
      if (Number.isFinite(idx)) imState.pairingRequests.splice(idx, 1);
      imBuildPairingRequests();
      imRefresh();
      notice(approve ? "已批准配对，账号已绑定（演示）" : "已拒绝配对（演示）");
    });
    /* 配对码：[换一个] 重置倒计时并换新码 */
    imPanel.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-im-renew-code]")) imRenewCode();
    });

    /* ③ 衔接行：定位④（展开+滚动+脉冲+焦点） */
    imPanel.querySelector("[data-im-goto-projects]").addEventListener("click", function () {
      imLocateCard("projects");
    });

    /* ④ 默认项目选择；保存同时处理到期（授权续期语义，角标随 derive 收敛） */
    imPanel.querySelector("[data-im-default-project]").addEventListener("change", function () {
      imState.defaultProject = this.value;
      imRefresh();
    });
    imPanel.querySelector("[data-im-projects-save]").addEventListener("click", function () {
      var hadExpired = imState.projects.some(function (pr) { return pr.expired; });
      if (hadExpired) {
        imState.projects.forEach(function (pr) { pr.expired = false; });
        imBuildProjects();
      }
      imRefresh();
    });
    /* ④ 到期行 [去授权]：展开该行授权设置 + 一次性脉冲高亮到期字段 */
    imPanel.addEventListener("click", function (ev) {
      var reauth = ev.target.closest("[data-im-reauthorize]");
      if (!reauth) return;
      var li = reauth.closest(".im-project");
      var fold = li.querySelector("[data-im-fold]");
      var body = li.querySelector(".im-fold-body");
      body.hidden = false;
      fold.setAttribute("aria-expanded", "true");
      var caret = fold.querySelector(".im-guide-caret");
      if (caret) caret.textContent = "▾";
      requestAnimationFrame(function () {
        var field = li.querySelector("[data-im-expiry-field]");
        if (field) {
          field.scrollIntoView({ block: "nearest", behavior: "smooth" });
          imPulse(field.closest(".im-field"));
        }
      });
    });

    /* 静音：行内标签切换 + 图标互换（不只 toast） */
    imPanel.addEventListener("click", function (ev) {
      var mute = ev.target.closest("[data-im-mute]");
      if (!mute) return;
      var row = mute.closest(".im-binding-row");
      var idx = Number(row.getAttribute("data-im-binding-idx"));
      var b = imState.bindings[idx];
      if (!b) return;
      b.muted = !b.muted;
      var main = row.querySelector(".im-binding-main");
      var tag = main.querySelector(".im-binding-tag");
      if (b.muted && !tag) {
        tag = document.createElement("span");
        tag.className = "im-binding-tag";
        tag.textContent = "已静音";
        main.appendChild(tag);
      } else if (!b.muted && tag) {
        tag.remove();
      }
      mute.setAttribute("aria-label", b.muted ? "恢复输出" : "静音");
      mute.title = b.muted ? "恢复输出" : "静音";
      mute.innerHTML = b.muted ? IM_ICON_BELL : IM_ICON_BELL_OFF;
      notice(b.muted ? "已静音（演示）" : "已恢复输出（演示）");
    });

    /* 解绑行内二次确认：焦点移入确认钮，Esc 视为保留（不给弹窗关闭让路）；
       确认后 200ms 淡出移除，焦点移到下一行或卡头 */
    imPanel.addEventListener("click", function (ev) {
      var unbind = ev.target.closest("[data-im-unbind]");
      if (unbind) {
        var row = unbind.closest(".im-binding-row");
        row.querySelector(".im-binding-actions").hidden = true;
        var confirmBar = row.querySelector(".im-unbind-confirm");
        confirmBar.hidden = false;
        confirmBar.querySelector("[data-im-unbind-done]").focus();
        return;
      }
      if (ev.target.closest("[data-im-keep]")) {
        var row2 = ev.target.closest(".im-binding-row");
        row2.querySelector(".im-unbind-confirm").hidden = true;
        row2.querySelector(".im-binding-actions").hidden = false;
        row2.querySelector("[data-im-unbind]").focus();
        return;
      }
      var done = ev.target.closest("[data-im-unbind-done]");
      if (done) {
        var row3 = done.closest(".im-binding-row");
        var idx = Number(row3.getAttribute("data-im-binding-idx"));
        if (!Number.isFinite(idx)) return;
        imState.bindings.splice(idx, 1);
        row3.classList.add("im-binding-removing");
        setTimeout(function () {
          imBuildBindings();
          imRefresh();
          notice("已解除绑定（演示）");
          var list = imPanel.querySelector("[data-im-bindings]");
          var next = list.querySelector(
            '[data-im-binding-idx="' + idx + '"] .im-icon-btn',
          );
          if (!next) next = imCardEls.account.querySelector("[data-im-card-head]");
          if (next) next.focus();
        }, 200);
      }
    });
    imPanel.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var confirmBar = ev.target.closest(".im-unbind-confirm");
      if (!confirmBar) return;
      ev.stopPropagation();
      ev.preventDefault();
      var row = confirmBar.closest(".im-binding-row");
      confirmBar.hidden = true;
      row.querySelector(".im-binding-actions").hidden = false;
      row.querySelector("[data-im-unbind]").focus();
    });

    /* 折叠块（高级组 / 调整权限 / 后续指引） */
    imPanel.addEventListener("click", function (ev) {
      var fold = ev.target.closest("[data-im-fold]");
      if (!fold) return;
      var body = fold.parentElement.querySelector(".im-fold-body");
      if (!body) return;
      var open = body.hidden;
      body.hidden = !open;
      fold.setAttribute("aria-expanded", String(open));
      var caret = fold.querySelector(".im-guide-caret");
      if (caret) caret.textContent = open ? "▾" : "▸";
    });

    /* 配对码倒计时（tabular-nums；元素随指令区重建，逐 tick 查询）；
       到期变「已过期 · [换一个]」，点击重置倒计时并换新码 */
    function imTick() {
      if (imSecondsLeft > 0) imSecondsLeft -= 1;
      if (imSecondsLeft === 0) imCodeExpired = true;
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-countdown]"),
        function (el) {
          el.textContent = imExpiryText();
        },
      );
      if (imCodeExpired) {
        Array.prototype.forEach.call(
          imPanel.querySelectorAll("[data-im-expiry-note]"),
          function (el) {
            el.textContent = "已过期";
          },
        );
      }
    }
    var imTimer = setInterval(imTick, 1000);

    /* hash 直达桥（#settings=1&im-demo=empty|progress|alert）、定位桥与幂等态 setter */
    window.__imApplyDemo = imApplyDemo;
    window.__imLocateCard = imLocateCard;
    imApplyDemo("progress");
  }

  /* 设置弹窗 */
  var backdrop = $("#settingsBackdrop");
  var settingsController = UI.dialog(backdrop, {
    surface: $(".settings-panel"),
    initialFocus: $("#settingsClose"),
    inert: [$(".app-shell")],
  });
  $("#settingsBtn").addEventListener("click", function () {
    settingsController.open(this);
  });
  $("#versionChip").addEventListener("click", function () {
    settingsController.open(this);
    selectSettings("maintenance");
  });
  $("#settingsClose").addEventListener("click", function () {
    settingsController.close();
  });
  var settingsTabs = UI.tabs($(".settings-tabs"), {
    selector: ".settings-tab",
    get orientation() { return window.innerWidth <= 980 ? "horizontal" : "vertical"; },
    panelFor: function (tab) {
      return $(
        '.settings-panel-content[data-panel="' +
          tab.dataset.settingsPanel +
          '"]',
      );
    },
  });
  window.addEventListener("resize", function () {
    $(".settings-tabs").setAttribute("aria-orientation", window.innerWidth <= 980 ? "horizontal" : "vertical");
  });
  function selectSettings(key) {
    var tab = $('.settings-tab[data-settings-panel="' + key + '"]');
    if (tab) settingsTabs.select(tab);
  }

  /* 定时任务卡「待授权」深链：打开设置 → 消息接入 → 展开④ → 滚动 → 一次性脉冲 → 焦点落④卡头 */
  var autoAuthBtn = $("[data-auto-auth]");
  if (autoAuthBtn) {
    autoAuthBtn.addEventListener("click", function () {
      settingsController.open(autoAuthBtn);
      selectSettings("im");
      requestAnimationFrame(function () {
        if (window.__imLocateCard) window.__imLocateCard("projects");
      });
    });
  }

  /* 主题（对齐真实设置：界面主题下拉 + #theme= hash；语言下拉即时生效语义） */
  var systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  var themePreference = "light";
  function setTheme(t) {
    if (!["light", "dark", "system"].includes(t)) return;
    themePreference = t;
    document.documentElement.setAttribute(
      "data-theme",
      t === "system" ? (systemTheme.matches ? "dark" : "light") : t,
    );
    var themeSelect = $("#themeSelect");
    if (themeSelect) themeSelect.value = t;
  }
  var themeSelectEl = $("#themeSelect");
  if (themeSelectEl) {
    themeSelectEl.addEventListener("change", function () {
      setTheme(this.value);
      notice("主题修改后立即生效");
    });
  }
  systemTheme.addEventListener("change", function () {
    if (themePreference === "system") setTheme("system");
  });
  setTheme("light");
  var localeSelectEl = $("#localeSelect");
  if (localeSelectEl) {
    localeSelectEl.addEventListener("change", function () {
      notice("语言修改后立即生效（演示）");
    });
  }

  /* 供应商二级页签（内置/自定义，seg-ctl 语义：aria-pressed 互斥） */
  $$(".provider-tabs button").forEach(function (tab) {
    tab.addEventListener("click", function () {
      $$(".provider-tabs button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === tab));
      });
      $$("[data-provider-pane]").forEach(function (pane) {
        pane.hidden =
          pane.getAttribute("data-provider-pane") !==
          tab.getAttribute("data-provider-tab");
      });
    });
  });
  var customReasoning = $("#customReasoning");
  if (customReasoning) {
    customReasoning.addEventListener("change", function () {
      $("#customTierRow").hidden = !customReasoning.checked;
    });
  }

  /* Agent 并发容量：手动上限时显示输入框 + 应用钮 */
  var capacityMode = $("#agentCapacityMode");
  if (capacityMode) {
    capacityMode.addEventListener("change", function () {
      $("#agentManualRow").hidden = capacityMode.value !== "manual";
    });
  }
  var agentScan = $("#agentScan");
  if (agentScan) {
    agentScan.addEventListener("click", function () {
      $("#agentScanResult").hidden = false;
      agentScan.textContent = "已检测到 2 个来源";
      notice("扫描完成（演示）");
    });
  }
  var updateCheck = $("#updateCheck");
  if (updateCheck) {
    updateCheck.addEventListener("click", function () {
      var status = $("#updateStatus");
      updateCheck.disabled = true;
      updateCheck.textContent = "检查中…";
      setTimeout(function () {
        updateCheck.disabled = false;
        updateCheck.textContent = "检查更新";
        if (status) status.textContent = "当前版本 v1.4.63 · 已是最新版本";
        notice("已是最新版本（演示）");
      }, 900);
    });
  }

  /* 热力图（对齐真实 TokenUsageHeatmap：53 周 × 7 行平铺格 + 月份标签行 +
     每日/每周/累计视图 + 悬停 tooltip + 每周视图整周高亮） */
  var heat = $("#heatmap");
  if (heat) {
    var seed = 42;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    var DAY = 24 * 60 * 60 * 1000;
    var now = Date.now();
    var heatData = [];
    var running = 0;
    for (var i = 0; i < 371; i++) {
      var d = new Date(now - (370 - i) * DAY);
      var v = rnd();
      var daily = v <= 0.2 ? 0 : Math.round(v * 96000);
      running += daily;
      heatData.push({
        date: d,
        daily: daily,
        weekly: 0,
        cumulative: running,
        week: Math.floor(i / 7),
      });
    }
    for (var w0 = 0; w0 < 53; w0++) {
      var sum = 0;
      for (var d0 = 0; d0 < 7; d0++) sum += heatData[w0 * 7 + d0].daily;
      for (var d1 = 0; d1 < 7; d1++) heatData[w0 * 7 + d1].weekly = sum;
    }
    var heatView = "daily";
    var fmtDate = function (d) {
      return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    };
    var heatValue = function (c) {
      return heatView === "daily" ? c.daily : heatView === "weekly" ? c.weekly : c.cumulative;
    };
    var heatCells = [];
    var fragment = document.createDocumentFragment();
    for (var k = 0; k < 371; k++) {
      var c = document.createElement("span");
      c.className = "heat-cell";
      fragment.appendChild(c);
      heatCells.push(c);
    }
    heat.appendChild(fragment);

    function heatRender() {
      var max = 0;
      for (var j = 0; j < 371; j++) max = Math.max(max, heatValue(heatData[j]));
      for (var j2 = 0; j2 < 371; j2++) {
        var value = heatValue(heatData[j2]);
        var lv = value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * 4));
        heatCells[j2].className = "heat-cell" + (lv >= 1 ? " l" + lv : "");
      }
    }
    heatRender();

    var months = $("#heatMonths");
    if (months) {
      for (var wk = 0; wk < 53; wk++) {
        var ws = heatData[wk * 7].date;
        var prev = new Date(ws.getTime() - 7 * DAY);
        if (wk === 0 || prev.getMonth() !== ws.getMonth()) {
          var lab = document.createElement("span");
          lab.textContent = (ws.getMonth() + 1) + "月";
          lab.style.gridColumnStart = wk + 1;
          months.appendChild(lab);
        }
      }
    }

    /* 视图 tab：切换即重算色阶并清掉悬停态（真实同律） */
    $$(".heat-tabs button").forEach(function (tab) {
      tab.addEventListener("click", function () {
        heatView = tab.dataset.view;
        $$(".heat-tabs button").forEach(function (t) {
          t.setAttribute("aria-selected", String(t === tab));
        });
        heatClear();
        heatRender();
      });
    });

    /* 悬停：tooltip 上弹 + 每周视图整周描边；移出即清（真实同律） */
    var tipEl = null;
    function heatClear() {
      if (tipEl) {
        tipEl.remove();
        tipEl = null;
      }
      heat.querySelectorAll(".period-hovered").forEach(function (el) {
        el.classList.remove("period-hovered");
      });
    }
    heat.addEventListener("mouseover", function (ev) {
      var cell = ev.target.closest(".heat-cell");
      if (!cell || cell === heatHovered) return;
      heatClear();
      heatHovered = cell;
      var idx = heatCells.indexOf(cell);
      if (idx < 0) return;
      tipEl = document.createElement("span");
      tipEl.className = "heat-tip";
      tipEl.setAttribute("role", "tooltip");
      var dateLine = document.createElement("span");
      dateLine.className = "tip-date";
      dateLine.textContent = fmtDate(heatData[idx].date);
      var row = document.createElement("span");
      row.className = "tip-row";
      var value = document.createElement("span");
      value.className = "tip-value";
      value.textContent = heatValue(heatData[idx]).toLocaleString("zh-CN");
      var unit = document.createElement("span");
      unit.className = "tip-unit";
      unit.textContent = "Token";
      value.appendChild(unit);
      var viewPill = document.createElement("span");
      viewPill.className = "tip-view";
      viewPill.textContent = heatView === "daily" ? "每日" : heatView === "weekly" ? "每周" : "累计";
      row.appendChild(value);
      row.appendChild(viewPill);
      tipEl.appendChild(dateLine);
      tipEl.appendChild(row);
      cell.appendChild(tipEl);
      /* 左右缘实测钳制：居中弹出若越滚动容器界则贴边，防被裁。
         阈值留 8px 缓冲——hover scale(1.08) 动画会把格子连同 tooltip 再推移几像素 */
      var scrollBox = heat.closest(".heat-scroll");
      if (scrollBox) {
        var tr = tipEl.getBoundingClientRect();
        var sr = scrollBox.getBoundingClientRect();
        if (tr.left < sr.left + 8) tipEl.classList.add("align-left");
        else if (tr.right > sr.right - 8) tipEl.classList.add("align-right");
      }
      if (heatView === "weekly") {
        var wk2 = heatData[idx].week;
        for (var q = 0; q < 7; q++) heatCells[wk2 * 7 + q].classList.add("period-hovered");
      }
    });
    var heatHovered = null;
    heat.addEventListener("mouseleave", function () {
      heatHovered = null;
      heatClear();
    });
  }

  /* 模型表：点击模型名迁移选中行（对齐真实 aria-pressed + tr.selected 过滤行为） */
  var modelsTable = document.querySelector(".usage-models table");
  if (modelsTable) {
    var selectModelRow = function (name) {
      modelsTable.querySelectorAll("tbody tr").forEach(function (tr) {
        var b = tr.querySelector("td:first-child button");
        var selected = b && b.textContent.trim() === name;
        tr.classList.toggle("selected", selected);
        if (b) b.setAttribute("aria-pressed", String(selected));
      });
    };
    modelsTable.addEventListener("click", function (ev) {
      var btn = ev.target.closest("td:first-child button");
      if (!btn) return;
      var name = btn.textContent.trim();
      selectModelRow(name);
      var filter = $("#modelFilter");
      if (filter) filter.value = name; /* 行点击反向同步模型条件 */
    });
    /* v124：按模型统计的模型条件——选择即迁移表格选中行 */
    var modelFilter = $("#modelFilter");
    if (modelFilter) {
      modelFilter.addEventListener("change", function () {
        if (modelFilter.value === "全部模型") {
          modelsTable.querySelectorAll("tbody tr").forEach(function (tr) {
            tr.classList.remove("selected");
            var b = tr.querySelector("td:first-child button");
            if (b) b.setAttribute("aria-pressed", "false");
          });
        } else {
          selectModelRow(modelFilter.value);
        }
      });
    }
  }

  /* ---------- 定时任务（结构/行为对齐真实 AutomationPage） ---------- */
  var autoDialog = $("#autoDialog");
  if (autoDialog) {
    var autoTitle = $("#autoDialogTitle");
    var autoPreset = $("#autoPreset");
    var autoMode = $("#autoMode");
    var autoTarget = $("#autoTarget");

    /* 预设 → 条件字段显隐（真实同律：once=日期；interval/windowed=每隔+单位；
       非 interval 显时间（windowed 为起止两枚）；时区随非 interval 显；weekly/windowed 显星期） */
    function autoSyncPreset() {
      var p = autoPreset.value;
      var q = function (sel) { return autoDialog.querySelector(sel); };
      q(".auto-field-once").hidden = p !== "once";
      q(".auto-field-interval").hidden = !(p === "interval" || p === "windowed-interval");
      q(".auto-field-window").hidden = p !== "windowed-interval";
      q(".auto-field-time").hidden = p === "interval" || p === "windowed-interval";
      q(".auto-field-tz").hidden = p === "interval";
      q(".auto-weekdays").hidden = !(p === "weekly" || p === "windowed-interval");
    }
    autoPreset.addEventListener("change", autoSyncPreset);
    autoSyncPreset();

    /* 模式 → execute 警示 + 工作区自动切托管（真实同律） */
    function autoSyncMode() {
      var isExecute = autoMode.value === "execute";
      autoDialog.querySelector(".auto-warning").hidden = !isExecute;
      if (isExecute) autoTarget.value = "managed-worktree";
    }
    autoMode.addEventListener("change", autoSyncMode);

    function autoOpen(editing) {
      autoTitle.textContent = editing ? "编辑定时任务" : "新建定时任务";
      $("#autoProject").disabled = Boolean(editing);
      autoSyncPreset();
      autoSyncMode();
      autoDialog.showModal();
    }
    $("#autoCreate").addEventListener("click", function () {
      $("#autoName").value = "";
      $("#autoPrompt").value = "";
      autoPreset.value = "daily";
      $("#autoMode").value = "review";
      autoOpen(false);
    });
    document.querySelectorAll("[data-auto-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest(".card");
        $("#autoName").value = card.querySelector(".card-title").textContent;
        $("#autoPrompt").value = card.querySelector(".auto-prompt").textContent;
        $("#autoProject").value = card.dataset.project || "Artemis";
        autoPreset.value = card.dataset.project === "token-lab" ? "weekly" : "daily";
        $("#autoMode").value = card.dataset.project === "token-lab" ? "plan" : "review";
        autoOpen(true);
      });
    });
    autoDialog.addEventListener("submit", function (ev) {
      if (ev.submitter && ev.submitter.value === "confirm") {
        notice("已保存定时任务（演示）");
      }
    });
    autoDialog.addEventListener("click", function (ev) {
      if (ev.target === autoDialog) autoDialog.close();
    });

    /* 启停切换：翻转状态胶囊与按钮文案（真实 setAutomationEnabled 语义） */
    document.querySelectorAll("[data-auto-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var chip = btn.closest(".card").querySelector(".auto-state");
        var enabled = chip.classList.toggle("enabled");
        chip.classList.toggle("paused", !enabled);
        chip.textContent = enabled ? "已启用" : "已暂停";
        btn.textContent = enabled ? "已暂停" : "已启用";
      });
    });

    /* 项目筛选（真实 projectFilter 语义） */
    var autoFilter = $("#autoFilter");
    if (autoFilter) {
      autoFilter.addEventListener("change", function () {
        var v = autoFilter.value;
        var empty = $("#autoList .auto-empty");
        var visible = 0;
        document.querySelectorAll("#autoList > .card").forEach(function (card) {
          var show = !v || card.dataset.project === v;
          card.hidden = !show;
          if (show) visible++;
        });
        if (empty) empty.hidden = visible !== 0;
      });
    }

    /* 时间滚轮：触发钮 + 双列 listbox（小时/分钟），上弹 material 浮层 */
    document.querySelectorAll(".time-picker").forEach(function (picker) {
      var parts = (picker.dataset.time || "09:00").split(":");
      var hour = parts[0] || "09";
      var minute = parts[1] || "00";
      var trigger = document.createElement("button");
      trigger.className = "time-trigger";
      trigger.type = "button";
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.innerHTML =
        '<svg class="time-clock" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.45" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"></circle><path d="M8 4.8v3.5l2.25 1.35"></path></svg>' +
        '<span class="time-value"><span class="time-h"></span><span class="time-colon">:</span><span class="time-m"></span></span>' +
        '<svg class="time-chev" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.45" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5"></path></svg>';
      picker.appendChild(trigger);
      var hOut = trigger.querySelector(".time-h");
      var mOut = trigger.querySelector(".time-m");

      var popover = document.createElement("div");
      popover.className = "time-popover";
      popover.hidden = true;
      function column(label, values, current, onPick) {
        var col = document.createElement("div");
        col.className = "time-col";
        var head = document.createElement("span");
        head.className = "time-heading";
        head.textContent = label;
        var list = document.createElement("div");
        list.className = "time-list";
        list.setAttribute("role", "listbox");
        values.forEach(function (v) {
          var opt = document.createElement("button");
          opt.type = "button";
          opt.className = "time-opt" + (v === current ? " selected" : "");
          opt.setAttribute("role", "option");
          opt.setAttribute("aria-selected", String(v === current));
          opt.textContent = v;
          opt.addEventListener("click", function () {
            list.querySelectorAll(".time-opt").forEach(function (o) {
              o.classList.remove("selected");
              o.setAttribute("aria-selected", "false");
            });
            opt.classList.add("selected");
            opt.setAttribute("aria-selected", "true");
            onPick(v);
            render();
            list.scrollTop = opt.offsetTop - list.clientHeight / 2 + opt.offsetHeight / 2;
          });
          list.appendChild(opt);
        });
        col.appendChild(head);
        col.appendChild(list);
        requestAnimationFrame(function () {
          var sel = list.querySelector(".selected");
          if (sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
        });
        return col;
      }
      function render() {
        hOut.textContent = hour;
        mOut.textContent = minute;
        trigger.setAttribute("aria-label", "时间 " + hour + ":" + minute);
      }
      function build() {
        popover.replaceChildren();
        popover.appendChild(column("小时", Array.from({ length: 24 }, function (_, i) { return String(i).padStart(2, "0"); }), hour, function (v) { hour = v; }));
        var divider = document.createElement("div");
        divider.className = "time-divider";
        popover.appendChild(divider);
        popover.appendChild(column("分钟", Array.from({ length: 60 }, function (_, i) { return String(i).padStart(2, "0"); }), minute, function (v) { minute = v; }));
      }
      build();
      render();
      picker.appendChild(popover);

      function setOpen(open) {
        picker.classList.toggle("open", open);
        popover.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
          build();
          render();
        }
      }
      trigger.addEventListener("click", function () {
        setOpen(popover.hidden);
      });
      document.addEventListener("pointerdown", function (ev) {
        if (popover.hidden) return;
        if (!picker.contains(ev.target)) setOpen(false);
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape" || popover.hidden) return;
        ev.preventDefault();
        setOpen(false);
        trigger.focus({ preventScroll: true });
      });
    });
  }

  /* ---------- 已归档会话（结构/行为对齐真实 ArchivePage） ---------- */
  var archList = $("#archList");
  if (archList) {
    var archSearch = $("#archSearch");
    var archCount = $("#archCount");
    var archEmpty = $("#archEmpty");
    var archEmptyTitle = $("#archEmptyTitle");
    var archEmptyDesc = $("#archEmptyDesc");
    var archClear = $("#archClear");
    var archConfirm = $("#archConfirmDialog");
    var archConfirmTitle = $("#archConfirmTitle");
    var archConfirmBody = $("#archConfirmBody");
    var archConfirmOk = $("#archConfirmOk");
    var readonlyBanner = $("#archivedReadonly");
    var bannerRestore = $("#archivedRestore");
    var archPending = null; // 待确认操作（归档行或侧栏归档载荷）
    var archFromRow = null; // 只读横幅对应的归档行

    function archRows() {
      return Array.prototype.slice.call(
        archList.querySelectorAll(".archive-row"),
      );
    }
    /* 真实检索语料：标题 + 目标 + 项目归属（临时会话兜底）；计数跟随过滤结果并切换文案 */
    function archSync() {
      var query = archSearch.value.trim().toLowerCase();
      var visible = 0;
      archRows().forEach(function (row) {
        var corpus = [
          row.querySelector(".archive-row-title").textContent,
          row.getAttribute("data-goal") || "",
          row.getAttribute("data-project") || "",
        ]
          .join(" ")
          .toLowerCase();
        var show = !query || corpus.indexOf(query) !== -1;
        row.hidden = !show;
        if (show) visible++;
      });
      archCount.textContent = query
        ? visible + " 个结果"
        : visible + " 个归档对话";
      var empty = visible === 0;
      archEmpty.hidden = !empty;
      archList.hidden = empty;
      archEmptyTitle.textContent = query
        ? "没有找到匹配的对话"
        : "还没有归档对话";
      archEmptyDesc.textContent = query
        ? "请尝试搜索其他标题、目标或项目名称。"
        : "归档后的任务会显示在这里，可随时打开、恢复或删除。";
      archClear.hidden = !query;
    }
    archSearch.addEventListener("input", archSync);
    archClear.addEventListener("click", function () {
      archSearch.value = "";
      archSync();
      archSearch.focus();
    });
    archSync();

    /* 行移除：淡出后注销，计数跟随（真实 restore/delete 语义） */
    function archRemove(row, message) {
      row.classList.add("leaving");
      setTimeout(function () {
        row.remove();
        archSync();
      }, 190);
      if (message) notice(message);
    }

    /* 危险确认（真实 archiveConfirm / deleteTaskConfirm 共用） */
    function archConfirmOpen(title, bodyText, okText, danger, pending) {
      archPending = pending;
      archConfirmTitle.textContent = title;
      archConfirmBody.textContent = bodyText;
      archConfirmOk.textContent = okText;
      archConfirmOk.className =
        "btn ui-button " + (danger ? "btn-danger" : "btn-primary");
      archConfirmOk.dataset.variant = danger ? "danger" : "primary";
      archConfirm.showModal();
    }
    archConfirm.addEventListener("close", function () {
      var pending = archPending;
      archPending = null;
      if (archConfirm.returnValue !== "confirm" || !pending) return;
      if (pending.archiveAction === "delete") {
        archRemove(pending, "已删除对话（演示）");
        return;
      }
      /* 侧栏归档入口：确认后写回归档列表并收走侧栏行（真实 setThreadArchived） */
      archAddRow(pending.archivePayload);
      if (pending.sidebarWrap) {
        var thread = pending.sidebarWrap.querySelector(".thread");
        var list = pending.sidebarWrap.closest(".thread-list");
        if (thread && thread.classList.contains("active") && list) {
          var rest = list.querySelectorAll(".thread");
          if (rest.length) rest[0].classList.add("active");
        }
        pending.sidebarWrap.remove();
      }
      notice("已归档对话（演示）");
    });
    archConfirm.addEventListener("click", function (ev) {
      if (ev.target === archConfirm) archConfirm.close();
    });

    /* 打开归档会话：跳回工作区并以只读横幅替代输入区（真实 archived-readonly） */
    function archOpen(row) {
      body.setAttribute("data-view", "workspace");
      $$(".activity-button[data-goto]").forEach(function (b) {
        b.classList.toggle(
          "active",
          b.getAttribute("data-goto") === "workspace",
        );
      });
      body.setAttribute("data-archived-demo", "1");
      readonlyBanner.hidden = false;
      archFromRow = row;
      notice("已打开归档对话（只读）");
    }
    bannerRestore.addEventListener("click", function () {
      body.removeAttribute("data-archived-demo");
      readonlyBanner.hidden = true;
      if (archFromRow) {
        archRemove(archFromRow, "已恢复到任务（演示）");
        archFromRow = null;
      }
    });

    archList.addEventListener("click", function (ev) {
      var row = ev.target.closest(".archive-row");
      if (!row) return;
      if (ev.target.closest("[data-arch-open]")) archOpen(row);
      else if (ev.target.closest("[data-arch-restore]"))
        archRemove(row, "已恢复到任务（演示）");
      else if (ev.target.closest("[data-arch-delete]")) {
        row.archiveAction = "delete";
        archConfirmOpen(
          "删除对话",
          "删除这个对话及其本地历史？此操作无法撤销。",
          "删除",
          true,
          row,
        );
      }
    });

    /* 侧栏「···」菜单归档入口的桥接（菜单代码在前，经 window 回调进入） */
    window.__archiveThreadFromMenu = function (moreBtn) {
      var wrap = moreBtn.closest(".thread-wrap");
      if (!wrap) return;
      var title = wrap.querySelector(".tt").textContent.trim();
      var projectItem = wrap.closest(".project-item");
      var project;
      if (projectItem) {
        project = projectItem
          .querySelector(".project-head")
          .textContent.replace(/\s+/g, " ")
          .trim();
      } else {
        project = wrap
          .closest(".thread-list")
          .previousElementSibling.textContent.replace(/\s+/g, " ")
          .trim();
      }
      var now = new Date();
      archConfirmOpen(
        "归档这个任务？",
        "归档后可随时在「已归档对话」中恢复。",
        "归档",
        false,
        {
          archiveAction: "archive",
          sidebarWrap: wrap,
          archivePayload: {
            title: title,
            project: project,
            goal: "",
            time:
              now.getFullYear() +
              "年" +
              (now.getMonth() + 1) +
              "月" +
              now.getDate() +
              "日",
          },
        },
      );
    };

    function archAddRow(payload) {
      var row = document.createElement("article");
      row.className = "archive-row";
      row.setAttribute("data-goal", payload.goal || "");
      row.setAttribute("data-project", payload.project);
      row.innerHTML =
        '<div class="archive-copy">' +
        '<div class="archive-row-head"><span class="archive-project"></span>' +
        '<time class="archive-time"></time></div>' +
        '<h2 class="archive-row-title"></h2>' +
        "</div>" +
        '<div class="archive-actions">' +
        '<button class="btn btn-primary" data-arch-open type="button">打开对话</button>' +
        '<button class="btn btn-ghost" data-arch-restore type="button">恢复到任务</button>' +
        '<button class="btn btn-ghost danger" data-arch-delete type="button">删除对话</button>' +
        "</div>";
      row.querySelector(".archive-project").textContent = payload.project;
      row.querySelector(".archive-time").textContent = payload.time;
      row.querySelector(".archive-row-title").textContent = payload.title;
      row.querySelectorAll("button.btn").forEach(function (b) {
        b.classList.add("ui-button");
        b.dataset.size = "compact";
        b.dataset.variant = b.classList.contains("btn-primary")
          ? "primary"
          : "ghost";
        if (b.classList.contains("danger")) b.dataset.tone = "danger";
      });
      archList.insertBefore(row, archList.firstChild);
      archSync();
    }
  }

  /* composer 自适应 */
  var input = $("#composerInput");
  UI.autosize(input, 140);

  /* ---------- 右栏宽度拖拽（对齐 workspace-dock-resizer 行为） ---------- */
  var resizer = $("#dockResizer");
  var dockEl = $(".workspace-dock");
  var contentEl = $(".workspace-content");
  function defaultDockWidth() {
    return contentEl.getBoundingClientRect().width * 0.62;
  }
  function dockLimits() {
    var cw = contentEl.getBoundingClientRect().width;
    // workspace-dock-layout.ts: 320px conversation + 7px resizer.
    var responsiveMinimum = window.innerWidth <= 820 ? 320 : window.innerWidth <= 1100 ? 380 : 440;
    var max = Math.max(320, Math.min(1080, Math.floor(cw - 327)));
    return { min: Math.min(responsiveMinimum, max), max: max };
  }
  function setDockWidth(px, announce) {
    var lim = dockLimits();
    px = Math.round(Math.min(Math.max(px, lim.min), lim.max));
    dockEl.style.flexBasis = px + "px";
    dockEl.style.maxWidth = "none"; /* 拖动后由内联值接管 */
    resizer.setAttribute("aria-valuenow", String(px));
    resizer.setAttribute("aria-valuemin", String(Math.round(lim.min)));
    resizer.setAttribute("aria-valuemax", String(Math.round(lim.max)));
    resizer.setAttribute("aria-valuetext", "右栏宽度 " + px + " 像素");
    if (announce) notice("右栏宽度 " + px + "px");
    return px;
  }
  function resetDockWidth() {
    dockEl.style.flexBasis = "";
    dockEl.style.maxWidth = "";
    setDockWidth(defaultDockWidth(), false);
    dockEl.style.flexBasis = "";
    dockEl.style.maxWidth = "";
    notice("右栏已复位为默认宽度");
  }
  UI.splitPane(resizer, {
    initial: defaultDockWidth(),
    direction: -1,
    limits: dockLimits,
    reset: defaultDockWidth,
    getValue: function () {
      return dockEl.getBoundingClientRect().width;
    },
    onChange: function (width) {
      setDockWidth(width, false);
    },
    onDrag: function (active) {
      if (active) contentEl.dataset.resizing = "true";
      else contentEl.removeAttribute("data-resizing");
    },
  });

  setDockWidth(defaultDockWidth(), false);
  window.addEventListener("resize", function () {
    if (body.getAttribute("data-dock") === "open")
      setDockWidth(dockEl.getBoundingClientRect().width, false);
  });

  /* Page-local interactions for assembled components. No network, file, or agent execution. */
  function notice(message) {
    toaster.show(message);
  }
  $("#envClose").addEventListener("click", function () {
    environmentPopover.close({ restore: true });
  });
  UI.tabs($(".res-tabs"), {
    selector: ".res-tab",
    panelFor: function (tab) {
      return $(
        '.resource-pane[data-resource-panel="' + tab.dataset.resource + '"]',
      );
    },
    onSelect: function (tab) {
      $(".pg-resources .page-toolbar").hidden =
        tab.dataset.resource !== "plugins";
    },
  });

  var sourceFiles = ArtemisWorkspaceFixtures.files;
  var currentFile = "readme";
  function showFile(key) {
    currentFile = key;
    $("#fileViewerPath").textContent = sourceFiles[key].path;
    $("#fileSource").textContent = sourceFiles[key].text;
    $("#fileEditor").hidden = true;
    $("#fileEditActions").hidden = true;
    $("#fileSource").hidden = false;
    $("#fileEdit").hidden = false;
    $$("[data-file]").forEach(function (b) {
      b.classList.toggle("selected", b.dataset.file === key);
      b.setAttribute("aria-pressed", String(b.dataset.file === key));
    });
  }
  $$("[data-file]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!$("#fileEditor").hidden) {
        notice("请先保存或取消当前编辑");
        return;
      }
      showFile(b.dataset.file);
    });
  });
  showFile("readme");
  $("#fileFilter").addEventListener("input", function () {
    var query = this.value.toLowerCase(),
      found = 0;
    $$("[data-file]").forEach(function (b) {
      b.hidden = !sourceFiles[b.dataset.file].path
        .toLowerCase()
        .includes(query);
      if (!b.hidden) found++;
    });
    $("#fileNoMatch").hidden = found > 0;
  });
  $("#fileEdit").addEventListener("click", function () {
    $("#fileEditor").value = sourceFiles[currentFile].text;
    $("#fileEditor").hidden = false;
    $("#fileSource").hidden = true;
    $("#fileEditActions").hidden = false;
    this.hidden = true;
    $("#fileEditor").focus();
  });
  $("#fileCancel").addEventListener("click", function () {
    showFile(currentFile);
    $("#fileEdit").focus();
  });
  $("#fileSave").addEventListener("click", function () {
    sourceFiles[currentFile].text = $("#fileEditor").value;
    showFile(currentFile);
    $("#fileEdit").focus();
    notice("已保存到当前原型会话");
  });
  $("#readerSource").textContent = sourceFiles.readme.text;
  $$("[data-reader]").forEach(function (b) {
    b.addEventListener("click", function () {
      var rich = b.dataset.reader === "rich";
      $("#readerRich").hidden = !rich;
      $("#readerSource").hidden = rich;
      $$("[data-reader]").forEach(function (t) {
        t.classList.toggle("active", t === b);
        t.setAttribute("aria-pressed", String(t === b));
      });
    });
  });
  ArtemisPatterns.goalEditor($("#dockPanelGoal"), {
    input: $("#goalInput"),
    save: $("#goalSave"),
    revert: $("#goalRevert"),
    status: $("#goalSaved"),
    labels: { saved: "目标已保存", dirty: "有未保存的修改" },
    onSave: function (value) {
      $(".goal-pill").title = value;
      return value;
    },
  });

  var reviewExamples = ArtemisWorkspaceFixtures.reviews;
  function selectReview(index) {
    var lines = reviewExamples[index];
    $("#reviewFilename").textContent = lines[0];
    var area = $("#dockPanelReview .diff-scroll");
    area.replaceChildren();
    lines.slice(1).forEach(function (text, i) {
      var row = document.createElement("div");
      row.className = "diff-line " + (i === 0 ? "del" : "add");
      var line = document.createElement("span");
      line.className = "ln";
      line.textContent = String(12 + i);
      var code = document.createElement("span");
      code.className = "code";
      code.textContent = (i === 0 ? "− " : "+ ") + text;
      row.append(line, code);
      area.appendChild(row);
    });
    $$("[data-review-file]").forEach(function (b) {
      var active = Number(b.dataset.reviewFile) === index;
      b.classList.toggle("selected", active);
      b.setAttribute("aria-pressed", String(active));
    });
  }
  $$("[data-review-file]").forEach(function (b) {
    b.addEventListener("click", function () {
      selectReview(Number(b.dataset.reviewFile));
    });
  });
  selectReview(0);
  $("#reviewFilter").addEventListener("input", function () {
    var q = this.value.toLowerCase(),
      found = 0;
    $$("[data-review-file]").forEach(function (b) {
      b.hidden = !b.textContent.toLowerCase().includes(q);
      if (!b.hidden) found++;
    });
    $("#reviewNoMatch").hidden = found > 0;
  });
  $("#reviewScope").addEventListener("change", function () {
    $("#reviewRange").textContent =
      this.value === "branch"
        ? "main → HEAD"
        : this.value === "staged"
          ? "HEAD → 暂存区"
          : this.value === "last-turn"
            ? "上一轮开始 → 结束"
            : "HEAD → 工作区";
    notice("已切换对比范围，展示原型示例更改");
  });
  var browserMarkup = $("#browserPreview").innerHTML,
    browserHistory = ["artemis://preview/welcome"],
    browserAt = 0;
  function renderBrowser(url) {
    $("#browserAddress").value = url;
    if (url === "artemis://preview/welcome")
      $("#browserPreview").innerHTML = browserMarkup;
    else {
      $("#browserPreview").replaceChildren();
      var h = document.createElement("h1");
      h.textContent = "此地址没有内置预览";
      var p = document.createElement("p");
      p.textContent = "当前静态原型可预览 artemis://preview/welcome。";
      $("#browserPreview").append(h, p);
    }
    $("#browserBack").disabled = browserAt === 0;
    $("#browserForward").disabled = browserAt === browserHistory.length - 1;
  }
  $("#browserForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var url = $("#browserAddress").value.trim();
    if (!url) return;
    browserHistory = browserHistory.slice(0, browserAt + 1);
    browserHistory.push(url);
    browserAt++;
    renderBrowser(url);
  });
  $("#browserBack").addEventListener("click", function () {
    if (browserAt > 0) {
      browserAt--;
      renderBrowser(browserHistory[browserAt]);
    }
  });
  $("#browserForward").addEventListener("click", function () {
    if (browserAt < browserHistory.length - 1) {
      browserAt++;
      renderBrowser(browserHistory[browserAt]);
    }
  });
  $("#browserRefresh").addEventListener("click", function () {
    renderBrowser(browserHistory[browserAt]);
    notice("本地预览已刷新");
  });
  $("#browserPreview").addEventListener("click", function (e) {
    if (e.target.closest("#previewReadme")) openPanel("markdown");
  });
  $("#teamStop").addEventListener("click", function () {
    $("#dockPanelTeam .chip.run").textContent = "已停止";
    $("#dockPanelTeam .chip.run").classList.remove("run");
    this.disabled = true;
    this.textContent = "团队已停止";
    notice("原型中的团队已停止");
  });
  var commitDialog = UI.dialog($("#prototypeDialog"));
  $$("[data-dialog]").forEach(function (b) {
    b.addEventListener("click", function () {
      commitDialog.open(this);
      $("#commitMessage").focus();
    });
  });
  var gitDemo = { branch: "main", changes: 3, ahead: 0, pendingBranch: null };
  var commitForm = $("#commitForm");
  function syncGitDemo() {
    $("#environmentBranch .environment-row-copy strong").textContent = gitDemo.branch;
    $("#gitChangeCount").textContent = gitDemo.changes + " 个文件待提交";
    $("#commitDestination option[value='main']").textContent = gitDemo.branch;
    $("#commitNewBranchRow").hidden = $("#commitDestination").value !== "new";
    var newBranch = $("#commitDestination").value === "new";
    var canCommit = gitDemo.changes > 0 && (!newBranch || !!$("#commitNewBranch").value.trim());
    $("[data-commit-action='commit']").disabled = !canCommit;
    $("[data-commit-action='commit-push']").disabled = !canCommit || !!gitDemo.pendingBranch || (!$("#commitIncludeUnstaged").checked && gitDemo.changes > 1);
    var push = $("[data-commit-action='push']");
    push.disabled = newBranch || gitDemo.changes > 0 || !gitDemo.ahead || !!gitDemo.pendingBranch;
    push.title = gitDemo.changes ? "请先提交更改" : !gitDemo.ahead ? "已同步" : "推送";
    var additions = gitDemo.changes === 3 ? 42 : gitDemo.changes ? 28 : 0;
    var deletions = gitDemo.changes === 3 ? 12 : gitDemo.changes ? 8 : 0;
    $("#environmentDiffTotal").innerHTML = "<i>+" + additions + "</i> <b>−" + deletions + "</b>";
    $("#prototypeDialog .environment-diff-total").innerHTML = $("#commitIncludeUnstaged").checked
      ? $("#environmentDiffTotal").innerHTML : "<i>+" + (gitDemo.changes === 3 ? 14 : 0) + "</i> <b>−" + (gitDemo.changes === 3 ? 4 : 0) + "</b>";
  }
  $("#commitDestination").addEventListener("change", function () { syncGitDemo(); if (!$("#commitNewBranchRow").hidden) $("#commitNewBranch").focus(); });
  $("#commitNewBranch").addEventListener("input", syncGitDemo);
  $("#commitIncludeUnstaged").addEventListener("change", syncGitDemo);
  function commitDemo(action) {
    var button = $("[data-commit-action='" + action + "']");
    if (button.disabled || commitForm.getAttribute("aria-busy") === "true") return;
    var newBranch = $("#commitDestination").value === "new" ? $("#commitNewBranch").value.trim() : null;
    if (newBranch && (/\s|\.\.|[~^:?*\[\\]/.test(newBranch) || /[/.]$/.test(newBranch))) {
      $("#commitFeedback").textContent = "请输入有效的分支名称"; return;
    }
    var auto = action !== "push" && !$("#commitMessage").value.trim();
    var label = button.querySelector("strong");
    var original = label.textContent;
    label.textContent = auto ? (action === "commit" ? "AI 总结并提交中…" : "AI 总结并提交、推送中…") : (action === "push" ? "推送中…" : "提交中…");
    commitForm.setAttribute("aria-busy", "true");
    Array.from(commitForm.elements).forEach(function (control) { control.disabled = true; });
    setTimeout(function () {
      if (newBranch) { gitDemo.branch = newBranch; applyBranch(newBranch); }
      if (action !== "push") { gitDemo.changes = $("#commitIncludeUnstaged").checked ? 0 : Math.max(0, gitDemo.changes - 1); gitDemo.ahead++; }
      if (action !== "commit") gitDemo.ahead = 0;
      if (gitDemo.pendingBranch && !gitDemo.changes) { gitDemo.branch = gitDemo.pendingBranch; applyBranch(gitDemo.branch); gitDemo.pendingBranch = null; }
      commitForm.setAttribute("aria-busy", "false");
      Array.from(commitForm.elements).forEach(function (control) { control.disabled = false; });
      label.textContent = original;
      $("#commitFeedback").textContent = (auto ? "AI 总结与" : "") + original + "已完成（演示），仓库未发生变化。";
      $("#commitMessage").value = "";
      $("#commitDestination").value = "main";
      syncGitDemo();
    }, 900);
  }
  $$("[data-commit-action]").forEach(function (button) { button.addEventListener("click", function () { commitDemo(button.dataset.commitAction); }); });
  commitForm.addEventListener("keydown", function (event) { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); commitDemo("commit"); } });
  $("#prototypeDialog").addEventListener("cancel", function (event) { if (commitForm.getAttribute("aria-busy") === "true") event.preventDefault(); });
  $("#prototypeDialog").addEventListener("close", function () { gitDemo.pendingBranch = null; $("#commitMessage").value = ""; $("#commitDestination").value = "main"; syncGitDemo(); });
  syncGitDemo();
  // Reuse context menus for project, branch and model choices.
  var choiceMenu = document.createElement("div");
  choiceMenu.className = "panel-picker context-choice";
  choiceMenu.hidden = true;
  choiceMenu.setAttribute("role", "menu");
  document.body.appendChild(choiceMenu);
  var choiceController;
  function choose(trigger, items, select) {
    if (choiceController) choiceController.destroy();
    choiceMenu.replaceChildren();
    items.forEach(function (label) {
      var b = UI.button({ label: label, variant: "ghost", size: "compact" });
      choiceMenu.appendChild(b);
    });
    var r = trigger.getBoundingClientRect();
    choiceMenu.style.position = "fixed";
    choiceMenu.style.left =
      Math.max(8, Math.min(r.left, innerWidth - 196)) + "px";
    choiceMenu.style.top = Math.max(8, r.top - items.length * 37 - 14) + "px";
    choiceMenu.style.right = "auto";
    choiceController = UI.menu(trigger, choiceMenu, {
      hidden: true,
      selector: "button",
      onSelect: function (item) {
        select(item.textContent);
      },
    });
    choiceController.open();
  }

  function labelButton(button, value) {
    var text = Array.from(button.childNodes).find(function (n) {
      return n.nodeType === 3 && n.textContent.trim();
    });
    if (text) text.textContent = " " + value + " ";
  }
  $("#environmentBranch").addEventListener("click", function () {
    var trigger = this;
    choose(trigger, ["main", "feat/im-feishu", "＋ 新建分支", "比较分支"], function (value) {
      if (value === "比较分支") { openPanel("review"); return; }
      if (value === "＋ 新建分支") {
        commitDialog.open(trigger); $("#commitDestination").value = "new"; syncGitDemo(); $("#commitNewBranch").focus(); return;
      }
      if (value === gitDemo.branch) return;
      if (gitDemo.changes) {
        gitDemo.pendingBranch = value;
        commitDialog.open(trigger);
        $("#commitFeedback").textContent = "先提交当前更改，再切换到 " + value + "（演示）";
        syncGitDemo();
      } else { gitDemo.branch = value; applyBranch(value); syncGitDemo(); }
    });
    var search = document.createElement("input");
    search.type = "search"; search.className = "im-field-input"; search.placeholder = "搜索分支…"; search.setAttribute("aria-label", "搜索分支");
    choiceMenu.prepend(search);
    search.addEventListener("input", function () { choiceMenu.querySelectorAll("button").forEach(function (button, index) { button.hidden = index < 2 && !button.textContent.toLowerCase().includes(search.value.toLowerCase()); }); });
    search.focus();
  });

  /* ---------- 模型与推理强度（Zcode 式两组联动，选中即回写单行触发条） ---------- */
  var modelPicker = $("#modelPicker");
  if (modelPicker) {
    var modelTrigger = $("#modelBtn");

    var composerModelFilter = $("#composerModelFilter");
    composerModelFilter.addEventListener("input", function () {
      var query = this.value.trim().toLocaleLowerCase();
      var matches = 0;
      modelPicker.querySelectorAll("[data-model]").forEach(function (option) {
        option.hidden = !(option.textContent + " " + (option.dataset.provider || "")).toLocaleLowerCase().includes(query);
        if (!option.hidden) matches++;
      });
      $("#composerModelEmpty").hidden = matches > 0;
    });
    function modelClose(focus) {
      modelPicker.classList.remove("open");
      modelTrigger.setAttribute("aria-expanded", "false");
      if (focus) modelTrigger.focus({ preventScroll: true });
    }
    modelTrigger.addEventListener("click", function () {
      var opening = !modelPicker.classList.contains("open");
      if (opening) {
        composerModelFilter.value = "";
        composerModelFilter.dispatchEvent(new Event("input"));
        modelPicker.classList.add("open");
        modelTrigger.setAttribute("aria-expanded", "true");
      } else {
        modelClose(false);
      }
    });

    function pick(groupSel, write) {
      modelPicker.querySelectorAll(groupSel + " .mg-opt").forEach(function (opt) {
        opt.addEventListener("click", function () {
          modelPicker.querySelectorAll(groupSel + " .mg-opt").forEach(function (b) {
            b.classList.toggle("sel", b === opt);
            b.setAttribute("aria-checked", String(b === opt));
            b.querySelector("b").textContent = b === opt ? "✓" : "";
          });
          /* 选后不关浮框：便于连续设置模型 + 推理强度（触发条即时回写反馈） */
          write(opt);
        });
      });
    }
    pick('.model-group:first-child', function (opt) {
      $("#modelName").textContent = opt.dataset.model;
    });
    pick('.model-group:last-child', function (opt) {
      $("#modelThinking").textContent = opt.dataset.thinking;
      modelTrigger.classList.toggle("ultra", opt.dataset.thinking === "极致");
    });

    document.addEventListener("pointerdown", function (ev) {
      if (!modelPicker.classList.contains("open")) return;
      if (!modelPicker.contains(ev.target)) modelClose(false);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !modelPicker.classList.contains("open")) return;
      ev.preventDefault();
      modelClose(true);
    });
  }

  /* 上下文环：点击固定开关浮窗（悬停/聚焦仍可预览） */
  var ctxUsage = $("#ctxUsage");
  if (ctxUsage) {
    ctxUsage.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ctxUsage.classList.toggle("open");
    });
    document.addEventListener("pointerdown", function (ev) {
      if (!ctxUsage.classList.contains("open")) return;
      if (!ctxUsage.contains(ev.target)) ctxUsage.classList.remove("open");
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !ctxUsage.classList.contains("open")) return;
      ctxUsage.classList.remove("open");
    });
  }

  $$(".thread").forEach(function (t) {
    t.addEventListener("click", function () {
      var title = t.querySelector(".tt");
      if (title) $(".workspace-thread-title").textContent = title.textContent;
      body.dataset.empty = "0";
    });
  });
  $$(".attach .x").forEach(function (b) {
    b.addEventListener("click", function () {
      b.closest(".attach").remove();
      var atts = document.querySelector(".attachments");
      if (atts) atts.hidden = atts.children.length === 0;
      $("#sendBtn").disabled = !input.value.trim() && !atts.children.length;
    });
  });
  $("#sendBtn").disabled = !$$(".attachments .attach").length;
  input.addEventListener("input", function () {
    $("#sendBtn").disabled = !this.value.trim() && !$$(".attachments .attach").length;
  });
  function sendDemo() {
    var value = input.value.trim();
    var attachments = $$(".attachments .attach");
    if (!value && !attachments.length) return;
    body.dataset.empty = "0"; /* v124：空会话态发首条消息即回时间线（原空态隐藏滚动区导致消息不可见） */
    var message = document.createElement("article");
    message.className = "user-message";
    if (attachments.length) {
      var caps = document.createElement("div");
      caps.className = "message-attachments";
      attachments.forEach(function (attachment) {
        var chip = attachment.cloneNode(true);
        chip.className = "user-message-attachment";
        chip.querySelector("button").remove();
        caps.appendChild(chip);
        attachment.remove();
      });
      message.appendChild(caps);
      $(".attachments").hidden = true;
    }
    message.appendChild(document.createTextNode(value));
    $(".timeline").appendChild(message);
    input.value = "";
    input.style.height = "";
    $("#sendBtn").disabled = true;
    var scroller = $(".timeline-scroll");
    scroller.scrollTop = scroller.scrollHeight;
    notice("消息已加入原型会话");
  }
  $("#sendBtn").addEventListener("click", sendDemo);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendDemo();
    }
  });

  /* v86：会话列表展开/折叠——无 rAF、可打断、事件保底的高度+透明度过渡 */
  var listEase = "cubic-bezier(0.32, 0.72, 0, 1)";
  var listReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function clearListAnim(el) {
    ["height", "overflow", "opacity", "transition"].forEach(function (prop) {
      el.style.removeProperty(prop);
    });
  }
  function cancelListAnim(el) {
    var t = el.__listAnim;
    if (!t) return;
    clearTimeout(t.timer);
    el.removeEventListener("transitionend", t.onEnd);
    el.__listAnim = null;
  }
  function settleListAnim(el, done) {
    cancelListAnim(el);
    function finish() {
      el.__listAnim = null;
      clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      done();
    }
    function onEnd(e) {
      if (e.target !== el || e.propertyName !== "height") return;
      finish();
    }
    var timer = setTimeout(finish, 480);
    el.addEventListener("transitionend", onEnd);
    el.__listAnim = { timer: timer, onEnd: onEnd };
  }
  function animateList(el, open) {
    cancelListAnim(el);
    if (listReduceMotion) {
      clearListAnim(el);
      el.hidden = !open;
      return;
    }
    var from = el.getBoundingClientRect().height;
    var fromOp = el.hidden ? "0" : getComputedStyle(el).opacity;
    clearListAnim(el);
    el.hidden = false;
    var full = el.scrollHeight;
    if (!open && full === 0 && from === 0) {
      el.hidden = true;
      return;
    }
    /* 同帧设起点 → 强制回流 → 设终点，无 rAF 依赖 */
    el.style.transition = "none";
    el.style.height = from + "px";
    el.style.opacity = fromOp;
    el.style.overflow = "hidden";
    el.offsetHeight; /* 回流 */
    el.style.transition =
      "height 260ms " + listEase + ", opacity 200ms " + listEase + (open ? " 40ms" : "");
    el.style.height = (open ? full : 0) + "px";
    el.style.opacity = open ? "1" : "0";
    settleListAnim(el, function () {
      clearListAnim(el);
      if (!open) el.hidden = true;
    });
  }
  /* v91：分组箭头/全部切换的悬浮提示随实际功能切换 */
  function syncEyeTitle(group) {
    var eye = group.querySelector(".grp-eye");
    if (!eye) return;
    eye.setAttribute(
      "title",
      group.getAttribute("aria-expanded") === "true"
        ? "隐藏所有项目"
        : "显示所有项目",
    );
  }
  $$(".project-head").forEach(function (button) {
    button.addEventListener("click", function (e) {
      if (e.target.closest(".acts")) return;
      var open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      animateList(button.nextElementSibling, open);
    });
  });
  $$(".group-row").forEach(function (button) {
    button.addEventListener("click", function (e) {
      if (e.target.closest(".group-add") || e.target.closest(".group-toggle")) return;
      var open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      syncEyeTitle(button);
      var sibling = button.nextElementSibling;
      while (sibling && !sibling.classList.contains("group-row")) {
        animateList(sibling, open);
        sibling = sibling.nextElementSibling;
      }
    });
  });
  /* v86：展开/收起全部——切换本组所有项目（含分组自身折叠态的展开） */
  $$(".group-toggle").forEach(function (toggle) {
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var group = toggle.closest(".group-row");
      /* v89：方向语义由真实状态驱动——有任一会话收起（或分组收起）→ 展开全部；否则收起全部 */
      var heads = [];
      var scan = group.nextElementSibling;
      while (scan && !scan.classList.contains("group-row")) {
        var h = scan.querySelector(".project-head");
        if (h) heads.push(h);
        scan = scan.nextElementSibling;
      }
      var expand =
        group.getAttribute("aria-expanded") !== "true" ||
        heads.some(function (h) {
          return h.getAttribute("aria-expanded") !== "true";
        });
      toggle.setAttribute("data-state", expand ? "open" : "closed");
      toggle.setAttribute("aria-label", expand ? "收起全部" : "展开全部");
      toggle.setAttribute("title", expand ? "收起全部会话" : "展开全部会话");
      if (expand && group.getAttribute("aria-expanded") !== "true") {
        group.setAttribute("aria-expanded", "true");
        syncEyeTitle(group);
        var sib0 = group.nextElementSibling;
        while (sib0 && !sib0.classList.contains("group-row")) {
          animateList(sib0, true);
          sib0 = sib0.nextElementSibling;
        }
      }
      var sibling = group.nextElementSibling;
      while (sibling && !sibling.classList.contains("group-row")) {
        var head = sibling.querySelector(".project-head");
        if (head) {
          head.setAttribute("aria-expanded", String(expand));
          animateList(head.nextElementSibling, expand);
        } else if (!expand) {
          animateList(sibling, false);
        }
        sibling = sibling.nextElementSibling;
      }
    });
  });
  /* 折叠态 rail 必须可交互：inert 只允许挂在 peek 面板上，
     且仅在「已折叠且未悬停」时生效（把隐藏控件挡在 tab 序列外）。
     直接 inert 整个 #projectSidebar 会连 rail 一起禁用（旧版折叠=整栏归零时代的遗留）。 */
  var sidebarEl = $("#projectSidebar");
  var sidebarMain =
    sidebarEl && sidebarEl.querySelector(".sidebar-main");
  var sidebarRail =
    sidebarEl && sidebarEl.querySelector(".sidebar-rail");
  var sidebarPeeked = false;
  var sidebarPeekTimer = 0;
  function cancelSidebarPeek() {
    clearTimeout(sidebarPeekTimer);
    sidebarPeekTimer = 0;
  }
  function requestSidebarPeek() {
    if (!body.classList.contains("sidebar-collapsed") || body.classList.contains("sidebar-snap") || sidebarPeeked || sidebarPeekTimer) return;
    sidebarPeekTimer = setTimeout(function () {
      sidebarPeekTimer = 0;
      sidebarPeeked = true;
      syncSidebarInert();
    }, 200);
  }
  /* v121：折叠/展开切换动画门控（见 syncNavigation） */
  var sidebarAnimPrev = body.classList.contains("sidebar-collapsed");
  var sidebarAnimTimer = 0;
  var sidebarWasPeeked = false;
  function syncSidebarInert() {
    if (!sidebarEl || !sidebarMain) return;
    var collapsed = body.classList.contains("sidebar-collapsed");
    sidebarEl.inert = false;
    var peek = collapsed && sidebarPeeked && !body.classList.contains("sidebar-snap");
    body.dataset.sidebarPeek = String(peek);
    if (collapsed) sidebarWasPeeked = peek;
    sidebarMain.inert = collapsed && !peek;
    /* 抽屉打开时 rail 已被覆盖隐藏（v110 互斥），一并移出 tab 序列 */
    if (sidebarRail) sidebarRail.inert = !collapsed || peek;
  }
  if (sidebarEl) {
    sidebarEl.addEventListener("mouseenter", function () {
      requestSidebarPeek();
    });
    sidebarEl.addEventListener("mouseleave", function () {
      cancelSidebarPeek();
      sidebarPeeked = sidebarMain.contains(document.activeElement);
      syncSidebarInert();
    });
  }
  if (sidebarEl) {
    sidebarEl.addEventListener("mousemove", function () {
      requestSidebarPeek();
    });
    sidebarEl.addEventListener("focusout", function (event) {
      if (!sidebarEl.contains(event.relatedTarget) && !sidebarEl.matches(":hover")) { sidebarPeeked = false; syncSidebarInert(); }
    });
    sidebarEl.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && body.classList.contains("sidebar-collapsed")) {
        cancelSidebarPeek();
        sidebarPeeked = false; body.classList.add("sidebar-snap"); syncSidebarInert(); $(".rail-brand").focus();
      }
    });
    $("#leftToggle").addEventListener("click", function () {
      cancelSidebarPeek();
      sidebarPeeked = false; syncSidebarInert();
      if (body.classList.contains("sidebar-collapsed")) $(".rail-brand").focus({preventScroll:true});
    });
  }
  var compactSidebar = window.innerWidth <= 1060;
  if (compactSidebar) body.classList.add("sidebar-collapsed");
  sidebarAnimPrev = body.classList.contains("sidebar-collapsed");
  window.addEventListener("resize", function () {
    var nextCompact = window.innerWidth <= 1060;
    if (nextCompact && !compactSidebar) { body.classList.add("sidebar-collapsed"); sidebarPeeked = false; syncSidebarInert(); }
    compactSidebar = nextCompact;
  });
  function syncNavigation() {
    $$(".activity-button[data-goto]").forEach(function (button) {
      if (button.dataset.goto === body.dataset.view)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    var wasPeeked = sidebarWasPeeked;
    syncSidebarInert();
    var collapsed = body.classList.contains("sidebar-collapsed");
    /* v121/v129：折叠/展开切换瞬间挂 sidebar-anim 类 720ms，
       CSS 仅在该类存在时对车道宽度（grid）与顶栏避让做 640ms 过渡
       （v121 是 360ms/440ms，v129 应要求再放缓）；
       窗口缩放、拖宽侧栏不经过此路径，不受过渡拖慢。
       点击路径里 focus() 等会在微任务前强制重排，目标值已瞬时落定，
       因此先钉回旧值强制回流、再挂类清钉，保证过渡必定起播。 */
    if (collapsed !== sidebarAnimPrev) {
      sidebarAnimPrev = collapsed;
      var shell = document.querySelector(".app-shell");
      var header = document.querySelector(".workspace-header");
      var prevTrack =
        (getComputedStyle(body).getPropertyValue("--sidebar-w") || "").trim() ||
        "280px";
      if (shell) {
        shell.style.gridTemplateColumns = (collapsed || wasPeeked ? prevTrack : "48px") + " minmax(0, 1fr)";
      }
      if (header) {
        header.style.marginLeft = collapsed ? "0px" : wasPeeked ? "-" + prevTrack : "-48px";
        header.style.paddingLeft = collapsed ? "18px" : "104px";
      }
      void (shell && shell.offsetWidth);
      body.classList.add("sidebar-anim");
      if (shell) shell.style.gridTemplateColumns = "";
      if (header) {
        header.style.marginLeft = "";
        header.style.paddingLeft = "";
      }
      clearTimeout(sidebarAnimTimer);
      sidebarAnimTimer = setTimeout(function () {
        body.classList.remove("sidebar-anim");
      }, 720);
    }
    $("#leftToggle").setAttribute("aria-expanded", String(!collapsed));
    sidebarHandle.tabIndex = collapsed ? -1 : 0;
    sidebarWasPeeked = body.dataset.sidebarPeek === "true";
  }
  new MutationObserver(syncNavigation).observe(body, {
    attributes: true,
    attributeFilter: ["data-view", "class"],
  });
  syncNavigation();
  $$(".run-btn").forEach(function (button) {
    button.addEventListener("click", function () {
      button.disabled = true;
      button.setAttribute("aria-label", "已停止");
      $(".status-dot").classList.remove("running");
      $(".status-label").textContent = "已停止";
      $(".turn-status").dataset.state = "completed";
      $(".turn-status-label").textContent = "已停止";
      $(".environment-task-state").textContent = "已停止";
      notice("原型任务已停止");
    });
  });
  document.addEventListener("animationstart", function (event) {
    if (event.animationName !== "turn-indicator-breathe") return;
    event.target.getAnimations().forEach(function (animation) {
      if (animation.animationName === "turn-indicator-breathe") animation.startTime = 0;
    });
  });
  /* ---------- hash 状态（DOMContentLoaded 后执行） ---------- */
  var params;
  function applyHash() {
    params = new URLSearchParams(location.hash.slice(1) || "");
    if (params.toString()) {
      var view = params.get("view");
      if (
        [
          "workspace",
          "resources",
          "token-usage",
          "automations",
          "archive",
        ].includes(view)
      ) {
        body.setAttribute("data-view", view);
        $$(".activity-button[data-goto]").forEach(function (b) {
          b.classList.toggle("active", b.getAttribute("data-goto") === view);
        });
      }
      var theme = params.get("theme");
      if (theme) setTheme(theme);
      if (params.get("dock") === "closed") setDockOpen(false);
      var tab = params.get("tab");
      if (tab && Object.hasOwn(panelRegistry, tab)) openPanel(tab, false);
      if (params.get("empty") === "1") body.setAttribute("data-empty", "1");
      if (params.get("settings") === "1") {
        settingsController.open($("#settingsBtn"));
        var imDemo = params.get("im-demo");
        if (
          ["empty", "progress", "alert"].includes(imDemo) &&
          window.__imApplyDemo
        ) {
          selectSettings("im");
          /* hash 重放幂等：applyDemo 从种子全量重建（derive 重跑） */
          window.__imApplyDemo(imDemo);
        }
      }
      if (params.get("collapsed") === "1") {
        body.classList.add("sidebar-collapsed");
        $("#leftToggle").classList.remove("active");
      }
      var dockw = parseInt(params.get("dockw") || "", 10);
      if (dockw > 0) setDockWidth(dockw, false);
    }
  }
  applyHash();
  window.addEventListener("hashchange", applyHash);

  /* ---------- 可机读页面级布局门禁（仅 #audit=1） ---------- */
  if (params.get("audit") === "1") {
    setTimeout(function () {
      var checks = [],
        failures = [];
      function check(name, ok, detail) {
        checks.push({ name: name, ok: !!ok, detail: detail });
        if (!ok) failures.push(name + ": " + detail);
      }
      function inside(child, parent, tolerance) {
        var c = child.getBoundingClientRect(),
          p = parent.getBoundingClientRect(),
          t = tolerance || 1;
        return (
          c.left >= p.left - t &&
          c.right <= p.right + t &&
          c.top >= p.top - t &&
          c.bottom <= p.bottom + t
        );
      }
      var composer = $(".composer"),
        conv = $("#conversation"),
        toolbar = $(".composer-toolbar");
      check(
        "no-horizontal-overflow",
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        document.documentElement.scrollWidth + " <= " + window.innerWidth,
      );
      check(
        "composer-inside-conversation",
        inside(composer, conv, 1),
        "composer=" + JSON.stringify(composer.getBoundingClientRect().toJSON()),
      );
      check(
        "toolbar-inside-composer",
        inside(toolbar, composer, 1),
        "toolbar=" + JSON.stringify(toolbar.getBoundingClientRect().toJSON()),
      );
      Array.prototype.forEach.call(
        toolbar.querySelectorAll("button,[tabindex]"),
        function (el, i) {
          var collapsed =
            el.getClientRects().length === 0 ||
            getComputedStyle(el).visibility === "hidden";
          check(
            "toolbar-control-" + (i + 1),
            collapsed || inside(el, composer, 1),
            (collapsed ? "（收起浮层，跳过边界）" : "") +
              (el.getAttribute("aria-label") || el.textContent.trim()),
          );
        },
      );
      var min = Number(resizer.getAttribute("aria-valuemin")),
        now = Number(resizer.getAttribute("aria-valuenow")),
        max = Number(resizer.getAttribute("aria-valuemax"));
      check(
        "resizer-pixel-range",
        Number.isFinite(min) && min <= now && now <= max,
        min + " <= " + now + " <= " + max,
      );
      check(
        "resizer-controls",
        resizer.getAttribute("aria-controls") === "conversation workspaceDock",
        resizer.getAttribute("aria-controls"),
      );
      var open = body.getAttribute("data-dock") === "open";
      check(
        "closed-resizer-not-tabbable",
        open ||
          (resizer.tabIndex === -1 &&
            resizer.getAttribute("aria-disabled") === "true"),
        "open=" + open + ", tabindex=" + resizer.tabIndex,
      );
      check(
        "launcher-has-four-tools",
        $$(".launch-btn").length === 4,
        String($$(".launch-btn").length),
      );
      var out = document.createElement("output");
      out.id = "LAYOUT_OUT";
      out.hidden = true;
      out.setAttribute("data-ok", String(failures.length === 0));
      out.textContent = JSON.stringify({
        ok: failures.length === 0,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio,
        },
        checks: checks,
        failures: failures,
      });
      document.body.appendChild(out);
    }, 120);
  }
})();

/* 版本更新按钮演示（生产语义：仅当检测到新版本时渲染）：
   has-update 点击 → updating（下载中自旋）→ 2.4s 后 updated（成功色）并回填版本号，
   再 2.2s 后回到 has-update 初始态供继续评审。 */
(function () {
  var btn = document.getElementById("updateBtn");
  var chip = document.getElementById("versionChip");
  if (!btn || !chip) return;
  var baseLabel = "发现新版本 v1.4.64，点击立即更新";
  btn.addEventListener("click", function () {
    if (!btn.classList.contains("has-update")) return;
    btn.classList.replace("has-update", "updating");
    btn.setAttribute("aria-label", "正在下载 v1.4.64");
    btn.title = "正在下载 v1.4.64…";
    setTimeout(function () {
      btn.classList.replace("updating", "updated");
      btn.setAttribute("aria-label", "已更新到 v1.4.64，重启后生效");
      btn.title = "已更新到 v1.4.64，重启后生效";
      chip.textContent = "v1.4.64";
      chip.setAttribute("aria-label", "当前版本 v1.4.64");
      chip.title = "当前版本 v1.4.64";
      setTimeout(function () {
        btn.classList.replace("updated", "has-update");
        btn.setAttribute("aria-label", baseLabel);
        btn.title = baseLabel;
      }, 2200);
    }, 2400);
  });
})();

/* v129：会话标题跑马灯——悬停且标题溢出时，双拷贝无缝单向慢速滚动（~30px/s）。
   结构对齐 ZCode task-title-marquee：外层 .tt 固定窗口裁剪，.tt-in 为轨道，
   溢出才克隆副本（aria-hidden），移出即还原省略号静态态。 */
(function () {
  "use strict";
  var GAP = 24;
  var SPEED = 30; /* px/s */
  Array.prototype.forEach.call(document.querySelectorAll(".tt"), function (tt) {
    if (tt.querySelector(".tt-in")) return;
    var text = tt.textContent;
    tt.textContent = "";
    var inner = document.createElement("span");
    inner.className = "tt-in";
    var copy = document.createElement("span");
    copy.className = "tt-copy";
    copy.textContent = text;
    inner.appendChild(copy);
    tt.appendChild(inner);
  });
  function arm(tt) {
    if (tt.classList.contains("marquee") || tt.dataset.armed) return;
    tt.dataset.armed = "1";
    var inner = tt.querySelector(".tt-in");
    var copy = inner && inner.firstElementChild;
    if (!copy) return;
    /* 静止态 .tt-in 为 inline（保 ellipsis），其 scrollWidth 恒 0，
       溢出检测改用外层块容器 .tt 的 scrollWidth */
    if (tt.scrollWidth - tt.clientWidth <= 4) return; /* 未溢出保持省略号 */
    var dup = copy.cloneNode(true);
    dup.classList.add("tt-dup");
    dup.setAttribute("aria-hidden", "true");
    inner.appendChild(dup);
    tt.classList.add("marquee"); /* .tt-in 切 inline-flex 后 copy 才有可测宽度 */
    var shift = copy.offsetWidth + GAP;
    tt.style.setProperty("--tt-shift", -shift + "px");
    tt.style.setProperty("--tt-dur", (shift / SPEED).toFixed(2) + "s");
  }
  function disarm(tt) {
    delete tt.dataset.armed;
    var dup = tt.querySelector(".tt-dup");
    if (dup) dup.remove();
    tt.classList.remove("marquee");
  }
  document.addEventListener(
    "mouseover",
    function (e) {
      var wrap = e.target.closest && e.target.closest(".thread-wrap");
      if (!wrap) return;
      var tt = wrap.querySelector(".tt");
      if (tt) arm(tt);
    },
  );
  document.addEventListener(
    "mouseout",
    function (e) {
      var wrap = e.target.closest && e.target.closest(".thread-wrap");
      if (!wrap) return;
      var next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".thread-wrap");
      if (next === wrap) return;
      var tt = wrap.querySelector(".tt");
      if (tt) disarm(tt);
    },
  );
})();

/* v149：目标操作——暂停/继续切换（图标与语义同步；编辑/删除走既有委托） */
(function () {
  "use strict";
  var btn = document.getElementById("goalPause");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var paused = btn.classList.toggle("paused");
    var label = paused ? "继续目标" : "暂停目标";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    var pill = document.getElementById("goalPill");
    pill.dataset.goalState = paused ? "paused" : "active";
    pill.title = paused ? "目标已暂停" : "目标进行中";
  });
})();
