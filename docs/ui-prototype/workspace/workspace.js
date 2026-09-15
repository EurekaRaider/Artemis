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
     #im-demo=empty|progress|alert 重放（applyDemo 全量重建，幂等）。
     第三轮升级：从头完全模拟——瞬态 starting/connecting、配对 10s 双轨到达、
     群发现/确认两拍支线、会话内模拟（sim）与「从头再来」重置。
     第四轮（2026-09-14）：原②添加机器人+③绑定账号合并为②「接入渠道并绑定账号」
     ——按渠道 tab 线性推进（凭据 → 平台接收 → 绑定账号），完成链五步改四步；
     ②完成谓词改为配对谓词（∃渠道：连接 connected ∧ 该渠道有绑定账号），
     消除「两个 any-of 拼出全绿但无渠道端到端可用」的漏洞；
     ④允许手机操作的项目改行内即时生效+授权配置弹窗（生产对齐）。
     第五轮（2026-09-14）：完成链三步化——①连接服务 → ②接入渠道并绑定账号
     → ③允许手机操作的项目。原④测试卡降级为②尾部「顺手验证（可选）」折叠段，
     不计入完成链；三步全✓的完成仪式移到③卡尾（开始使用/验证引导/群协作/概览）。
     面板内全部演示条件入口集中隔离到 #imDemoConsole（迁移生产代码时整块删除）。 */
  var imPanel = $("#settingsPanelIm");
  if (imPanel) {
    var IM_PLATFORMS = [
      { key: "feishu", name: "飞书" },
      { key: "wecom", name: "企业微信" },
      { key: "slack", name: "Slack" },
    ];
    var IM_CHANNEL_CONSTRAINT = {
      feishu: "长连接，无需公网",
      wecom: "智能机器人 · API 模式",
      slack: "Socket Mode",
    };
    var IM_CARD_ORDER = ["service", "channel", "projects"];
    var IM_STEP_TOTAL = 3; /* 设置进度总数：完成链三步（②=接入渠道并绑定账号合并卡；测试=②尾可选验证不计入；群协作=可选独立流程不计入） */
    var IM_PAIR_CODES = ["7K2Q-XR9M", "3TD8-M52W", "9FJ4-QN7C"];
    /* 时序常量：启动/连接过渡、配对等待、群确认；淡入淡出 200ms；脉冲 0.9s 仅
       用于深链/胶囊定位/配对请求到达；④[保存]本地瞬时，不设假延迟 */
    var IM_T_START = 1000,
      IM_T_CONNECT = 900,
      IM_T_PAIR_WAIT = 10000,
      IM_T_FADE = 200;
    var IM_ICON_BELL = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="M7 16.5h10c-.9-1.1-1.5-2.7-1.5-5a3.5 3.5 0 0 0-7 0c0 2.3-.6 3.9-1.5 5z"></path><path d="M10.3 19a1.8 1.8 0 0 0 3.4 0"></path><path d="M12 4.2v1.6"></path><path d="M6.8 6.3l1.1 1.1"></path><path d="M17.2 6.3l-1.1 1.1"></path></svg>';
    var IM_ICON_BELL_OFF = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="M7 16.5h10c-.9-1.1-1.5-2.7-1.5-5a3.5 3.5 0 0 0-7 0c0 2.3-.6 3.9-1.5 5z"></path><path d="M10.3 19a1.8 1.8 0 0 0 3.4 0"></path><path d="M5 5l14 14"></path></svg>';
    var IM_ICON_UNLINK = '<svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" viewBox="0 0 24 24" width="14"><path d="m9.2 14.8 5.6-5.6"></path><path d="M11 16.2 8.6 18.6a2.55 2.55 0 0 1-3.6-3.6l2.4-2.4"></path><path d="M13 7.8l2.4-2.4a2.55 2.55 0 0 1 3.6 3.6l-2.4 2.4"></path></svg>';

    /* 演示状态种子：empty=空态 / progress=进行中 / alert=告警；
       sim=会话内模拟（仅内存，不写 hash；任何用户操作即开启，applyDemo 回到快照） */
    function imSimSeed() {
      return {
        session: false,
        /* 凭据保存的确定性演示结果（选择器在凭据子卡内，不用随机） */
        credOutcome: { feishu: "ok", wecom: "ok", slack: "ok" },
        /* ① 一键开启的确定性演示结果（成功 / 端口被占用 / 注册失败） */
        serviceOutcome: "ok",
        /* ③ 双轨：10s 倒计时自动到达 + 演示直达弱链接 */
        pairWait: null /* { platform, leftMs } */,
        projectsDirty: false,
        /* 保存/启用两阶段演示开关（确定性失败分支） */
        saveFailure: false,
        enableFailure: false,
        hints: {}, /* 会话内「首次」引导旗标 */
        /* ②尾「顺手验证」折叠段展开态：首绑自动展开一次，用户动过后本次会话记住 */
        verifyOpened: false,
        verifyTouched: false,
      };
    }
    var IM_SEEDS = {
      empty: {
        sim: imSimSeed(),
        gateway: { started: false, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: false,
        grantEnabled: false,
        grantEnableFailed: false,
        connections: { feishu: [], wecom: [], slack: [] },
        platformReady: { feishu: false, wecom: false, slack: false },
        test: { stage: 0, failed: false, confirmed: false, channel: "" },
        groupFlow: { open: false, phase: "discover", spaceSaved: false, groups: [] },
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
        sim: imSimSeed(),
        gateway: { started: true, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: true,
        grantEnabled: true,
        grantEnableFailed: false,
        connections: {
          feishu: [
            { conn: "conn-1", app: "Artemis 机器人", state: "ok", note: "已连接 · 2 分钟前" },
          ],
          wecom: [],
          slack: [],
        },
        platformReady: { feishu: false, wecom: false, slack: false },
        test: { stage: 0, failed: false, confirmed: false, channel: "" },
        groupFlow: { open: false, phase: "discover", spaceSaved: false, groups: [] },
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
        sim: imSimSeed(),
        gateway: { started: true, linkBroken: false, deviceId: "dev-3f9a" },
        masterOn: true,
        grantEnabled: true,
        grantEnableFailed: false,
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
        platformReady: { feishu: true, wecom: true, slack: false },
        test: { stage: 0, failed: false, confirmed: false, channel: "" },
        groupFlow: { open: false, phase: "done", spaceSaved: true, groups: [
          { name: "artemis-ui-评审群", platform: "feishu", members: 5, confirmed: true },
          { name: "packaging-standby", platform: "wecom", members: 2, confirmed: true },
        ] },
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
    var imManual = {}; /* 用户显式切换概览/设置步骤；applyDemo 按完成态自动定向 */ /* 用户手动展开/折叠：cardKey → boolean */
    var imShowOverview = false;
    var imEpoch = 0; /* applyDemo 递增：作废在途过渡定时器 */
    var imCardEls = {};
    IM_CARD_ORDER.forEach(function (key) {
      var el = imPanel.querySelector('.im-card[data-im-card="' + key + '"]');
      if (el) imCardEls[key] = el;
    });
    var imPill = $("#imStatePill"),
      imStateText = $("#imStateText");
    /* D1：首次流程无总开关——启用语义归④「保存并启用」；暂停/恢复在完成后概览（C5） */

    /* ===== derive：状态 → 徽标 / 摘要 / 告警角标 / 胶囊 / 自动展开 ===== */
    function imDerive(s) {
      var sim = s.sim || {};
      var platforms = {};
      var healthyTotal = 0,
        badTotal = 0,
        reconnectTotal = 0,
        connectingTotal = 0;
      IM_PLATFORMS.forEach(function (p) {
        var conns = (s.connections && s.connections[p.key]) || [];
        var ok = 0,
          bad = 0,
          rc = 0,
          cg = 0;
        conns.forEach(function (c) {
          if (c.state === "ok") ok += 1;
          else if (c.state === "bad") bad += 1;
          else if (c.state === "reconnecting") rc += 1;
          else if (c.state === "connecting") cg += 1;
        });
        healthyTotal += ok;
        badTotal += bad;
        reconnectTotal += rc;
        connectingTotal += cg;
        /* connecting 计入 pending 类聚合分支，不计入 healthyTotal（完成链不前进） */
        var agg;
        if (!conns.length) agg = "none";
        else if (bad && ok) agg = "partial";
        else if (bad && !ok) agg = "allbad";
        else if ((rc || cg) && !ok) agg = cg && !rc ? "connecting" : "reconnecting";
        else agg = "ok";
        platforms[p.key] = { conns: conns, ok: ok, bad: bad, rc: rc, cg: cg, agg: agg };
      });

      var serviceAlerts = s.gateway.linkBroken ? 1 : 0;
      var expired = s.projects.filter(function (pr) { return pr.expired; }).length;
      var checkedProjects = s.projects.filter(function (pr) { return pr.checked; }).length;
      /* 顺手验证（②尾可选）：已验证渠道=测试确认时所在渠道（测试为全局单实例） */
      var verifiedChannels = s.test && s.test.confirmed && s.test.channel
        ? [s.test.channel] : [];
      /* 渠道就绪 = 配对谓词：该渠道有 connected 连接 ∧ 该渠道有绑定账号 */
      IM_PLATFORMS.forEach(function (p) {
        platforms[p.key].paired =
          platforms[p.key].ok > 0 &&
          s.bindings.some(function (b) { return b.platform === p.key; });
      });
      var readyPlatformNames = IM_PLATFORMS.filter(function (p) {
        return platforms[p.key].paired;
      }).map(function (p) { return p.name; });
      var healthyPlatformNames = IM_PLATFORMS.filter(function (p) {
        return platforms[p.key].ok > 0;
      }).map(function (p) { return p.name; });
      var connsTotal = healthyTotal + badTotal + reconnectTotal + connectingTotal;

      var starting = !!s.gateway.starting;
      var serviceDone = s.gateway.started && !s.gateway.linkBroken;
      var channelDone = readyPlatformNames.length > 0;
      var connectedUnpaired = IM_PLATFORMS.filter(function (p) {
        return platforms[p.key].ok > 0 && !platforms[p.key].paired;
      }).map(function (p) { return p.name; });
      var projectsDone = checkedProjects > 0 && expired === 0 && !sim.projectsDirty;
      /* 顺手验证是②尾可选段（D4 诚实版保留）：不入门禁，只作状态/徽标信号 */
      var anyConfigured = connsTotal > 0;
      var paused = !s.masterOn && anyConfigured;
      var pairWaiting = !!sim.pairWait;

      /* 完成链三步（②=接入渠道并绑定账号合并卡；测试=②尾可选验证不入链）：
         第一个未完成卡即「当前步骤」；群协作独立流程不入链 */
      var chain = [
        ["service", serviceDone],
        ["channel", channelDone],
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
      /* ① 连接服务（starting 为瞬态：徽标 busy「正在启动…」） */
      cards.service = {
        state: starting ? "busy" : s.gateway.linkBroken ? "warn" : serviceDone ? "done" : "current",
        badgeText: starting
          ? "正在启动…"
          : s.gateway.linkBroken
            ? "服务断连"
            : serviceDone
              ? "已就绪"
              : "待开启",
        alerts: serviceAlerts,
        summary: serviceDone
          ? "已就绪 · " + (s.gateway.team ? "团队服务" : "本机运行") + " · " + s.gateway.deviceId
          : "先开启服务",
      };
      /* ② 接入渠道并绑定账号（合并原②③：连接+配对两个事实合成一个配对谓词卡） */
      var channelBadgeText = "待办";
      if (channelDone) channelBadgeText = "已就绪 · " + readyPlatformNames[0];
      else if (s.pairingRequests.length) channelBadgeText = "待确认";
      else if (pairWaiting) channelBadgeText = "等待确认";
      else if (connectingTotal) channelBadgeText = "连接中";
      else if (anyConfigured && !healthyTotal) channelBadgeText = "连接失败";
      else if (healthyTotal) channelBadgeText = "待绑定账号";
      else if (firstUndone === "channel") channelBadgeText = "当前步骤";
      else if (!serviceDone) channelBadgeText = "待开启";
      cards.channel = {
        state: (connectingTotal || pairWaiting) && !channelDone
          ? "busy"
          : cardState("channel", channelDone, anyConfigured && !healthyTotal),
        badgeText: channelBadgeText,
        alerts: badTotal + s.pairingRequests.length,
        summary: s.pairingRequests.length
          ? s.pairingRequests.length + " 条绑定待确认"
          : channelDone
            ? "已连接 · " + readyPlatformNames.join("、") + " · " + s.bindings.filter(function (b) { return readyPlatformNames.indexOf((IM_PLATFORMS.filter(function (p) { return p.key === b.platform; })[0] || {}).name) >= 0; }).length + " 个账号"
            : connectedUnpaired.length
              ? "已连接 · " + connectedUnpaired.join("、") + " · 待绑定账号"
              : connectingTotal
                ? "正在连接机器人"
                : anyConfigured
                  ? "有连接故障，点开查看"
                  : "还没有机器人，先添加一个",
      };
      /* ③ 允许手机操作的项目（行内即时生效：无待保存态；启用失败入⚠；临时会话计作 1 个项目） */
      var projectsBusy = !!sim.projectsDirty;
      cards.projects = {
        state: projectsBusy ? "busy" : cardState("projects", projectsDone, expired > 0 || !!s.grantEnableFailed),
        badgeText: projectsBusy
          ? "已选 " + checkedProjects + " · 待生效"
          : checkedProjects > 0
            ? "已授权 " + (checkedProjects + 1) + " 个"
            : firstUndone === "projects"
              ? "当前步骤"
              : "待选择",
        alerts: expired + (s.grantEnableFailed ? 1 : 0),
        summary: s.grantEnableFailed
          ? "授权已保存 · 连接未启用"
          : checkedProjects
            ? (checkedProjects + 1) + " 个项目" +
              (s.defaultProject ? " · 默认 " + s.defaultProject : "")
            : "还没有选择项目",
      };
      /* 顺手验证归属渠道徽标：已确认时所在渠道标「已验证」 */
      verifiedChannels.forEach(function (pk) {
        if (platforms[pk]) platforms[pk].verified = true;
      });

      if (!s.gateway.started) {
        /* 空态：②-④ 折叠为统一的「先开启服务」摘要行（点击=定位①大按钮） */
        IM_CARD_ORDER.forEach(function (key) {
          cards[key].summary = "先开启服务";
        });
      } else if (firstUndone) {
        /* 未来步骤：显示前置提示（完成链线性，先完成当前步骤） */
        var undoneIdx = IM_CARD_ORDER.indexOf(firstUndone);
        var undoneTitles = { service: "连接服务", channel: "接入渠道并绑定账号", projects: "选择项目" };
        IM_CARD_ORDER.forEach(function (key, i) {
          if (i > undoneIdx && key !== "groups" && cards[key].state === "todo") {
            cards[key].summary = "先完成第 " + (undoneIdx + 1) + " 步「" + undoneTitles[firstUndone] + "」";
          }
        });
      }
      if (paused) {
        /* 主开关关闭：徽标保留，摘要加「已暂停」后缀 */
        IM_CARD_ORDER.forEach(function (key) {
          cards[key].summary += " · 已暂停";
        });
      }

      /* 胶囊聚合：启动瞬态 busy；服务就绪但无连接 → 中间态（仍灰）；
         暂停优先于健康态；故障计数可点定位 */
      var pill;
      if (starting)
        pill = { tone: "busy", html: "正在启动消息服务", count: 0 };
      else if (!connsTotal)
        pill = {
          tone: "off",
          html: serviceDone ? "服务已就绪，还没有机器人" : "未开启",
          count: 0,
        };
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
        connectingTotal: connectingTotal,
        paused: paused,
        firstUndone: firstUndone,
        allDone: !firstUndone,
        cards: cards,
        pill: pill,
        autoExpand: autoExpand,
        expired: expired,
        projectsDone: projectsDone,
        /* 设置进度：完成链四步计数（②合并卡；群协作可选不计入） */
        progressDone: chain.filter(function (c) { return c[1]; }).length,
        ready: s.masterOn && s.grantEnabled !== false && serviceDone && channelDone && projectsDone &&
          badTotal + serviceAlerts + s.pairingRequests.length + expired === 0,
      };
    }

    /* ===== 渲染：结构（applyDemo 全量重建）+ 状态（imRefresh 原地更新） ===== */
    function imPlatformDotClass(st) {
      if (imDerived.paused) return "idle";
      if (st.agg === "ok") return "ok";
      if (st.agg === "allbad") return "bad";
      if (st.agg === "partial" || st.agg === "reconnecting" || st.agg === "connecting")
        return "pending";
      return "idle";
    }

    /* M2b 凭据子卡：字段清单（接收方式条件化）+ 保存并重连三态流 + 接入指引 */
    var imFieldSequence = 0;
    var IM_FIELD = function (label, inputHtml, extra) {
      return (
        '<label class="im-field' + (extra || "") + '" data-im-field-label="' + label + '">' +
        '<span class="im-field-label">' + label + "</span>" + inputHtml +
        '<p class="im-fine im-field-help" data-im-field-help="" hidden=""></p></label>'
      );
    };
    /* 字段级帮助（聚焦显示）与校验（blur 非空/提交必填）：大白话，逐平台同构 */
    var IM_FIELD_RULES = {
      feishu: {
        "App ID": { required: true, requiredError: "请输入 App ID。", prefix: "cli_", prefixError: "App ID 应以 cli_ 开头。", help: "开发者后台 → 凭证与基础信息。" },
        "App Secret": { required: true, requiredError: "请输入 App Secret。", help: "与 App ID 来自同一应用；原型仅在本次页面中使用。" },
        "机器人 Open ID": { prefix: "ou_", prefixError: "请输入 ou_ 开头的机器人 Open ID。", help: "可留空，连接时自动识别。" },
        "Tenant Key": { help: "可留空，连接时自动识别团队。" },
        "Verification Token": { httpsHelp: "从事件与回调页复制 Verification Token。" },
        "Encrypt Key": { httpsHelp: "从事件与回调页复制 Encrypt Key。" }
      },
      wecom: {
        "企业 ID": { required: true, requiredError: "请输入企业 ID。", prefix: "ww", prefixError: "企业 ID 应以 ww 开头。", help: "管理后台 → 我的企业 → 企业信息。" },
        "Bot ID": { required: true, requiredError: "请输入智能机器人的 Bot ID。" },
        "Secret": { required: true, requiredError: "请输入与 Bot ID 对应的 Secret。", help: "智能机器人 → API 模式 → 长连接；不是群 Webhook。" }
      },
      slack: {
        "Bot Token": { required: true, requiredError: "请输入 Bot User OAuth Token。", prefix: "xoxb-", prefixError: "Bot Token 应以 xoxb- 开头。" },
        "App-Level Token": { required: true, requiredError: "请输入 App-Level Token。", prefix: "xapp-", prefixError: "App-Level Token 应以 xapp- 开头。", help: "需包含 connections:write，两个令牌来自同一应用。" }
      }
    };
    var IM_HTTPS_REQUIRED_ERROR = "选了 HTTPS 回调，这两项就必填。";
    function imFieldRule(platformKey, label) {
      return (IM_FIELD_RULES[platformKey] || {})[label] || null;
    }
    function imFieldHelpEl(labelEl) {
      return labelEl.querySelector("[data-im-field-help]");
    }
    function imShowFieldMessage(labelEl, text, isError) {
      var help = imFieldHelpEl(labelEl);
      if (!help) return;
      help.textContent = text || "";
      help.classList.toggle("im-field-error", !!isError);
      help.hidden = !text;
      var input = labelEl.querySelector("input, select");
      if (input) {
        if (!help.id) help.id = "im-help-" + (++imFieldSequence);
        input.setAttribute("aria-describedby", help.id);
        input.setAttribute("aria-invalid", String(!!isError));
      }
    }
    function imHideFieldMessage(labelEl) {
      var help = imFieldHelpEl(labelEl);
      if (help) help.hidden = true;
      var input = labelEl.querySelector("input, select");
      if (input) input.removeAttribute("aria-invalid");
    }
    /* 单字段校验：返回错误文案或 null（httpsOnly 字段仅在可见时参与） */
    function imValidateField(platformKey, labelEl) {
      var input = labelEl.querySelector("input, select");
      if (!input) return null;
      var label = labelEl.getAttribute("data-im-field-label");
      var rule = imFieldRule(platformKey, label);
      if (!rule) return null;
      var value = (input.value || "").trim();
      var httpsVisible = !labelEl.hasAttribute("data-im-https-only") || !labelEl.hidden;
      if (rule.prefix && value && !value.toLowerCase().startsWith(rule.prefix))
        return rule.prefixError;
      if (!value && rule.required) return rule.requiredError;
      if (!value && rule.httpsHelp && httpsVisible) return IM_HTTPS_REQUIRED_ERROR;
      return null;
    }
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
      var secret = '<input class="im-field-input" type="password" autocomplete="off"/>';
      if (p.key === "feishu") {
        fields = IM_FIELD("App ID", '<input class="im-field-input" placeholder="cli_…" spellcheck="false"/>') +
          IM_FIELD("App Secret", secret) +
          '<details class="im-credential-advanced field-wide"><summary>高级设置 · 通常无需修改</summary><div class="form-grid">' +
          IM_FIELD("区域", '<select class="im-field-input"><option value="feishu">飞书 · 中国</option><option value="lark">Lark · 国际</option></select>') +
          IM_FIELD("接收方式", IM_RECEIVE_SELECT) +
          IM_FIELD("Tenant Key", '<input class="im-field-input" placeholder="自动获取"/>') +
          IM_FIELD("机器人 Open ID", '<input class="im-field-input" placeholder="自动获取"/>') +
          IM_FIELD("Verification Token", secret, '\" data-im-https-only="" hidden=""') +
          IM_FIELD("Encrypt Key", secret, '\" data-im-https-only="" hidden=""') +
          IM_FORWARD_URL(p.key) + '</div></details>';
      } else if (p.key === "wecom") {
        fields = IM_FIELD("企业 ID", '<input class="im-field-input" placeholder="ww…"/>') +
          IM_FIELD("Bot ID", '<input class="im-field-input" placeholder="智能机器人 Bot ID"/>') + IM_FIELD("Secret", secret);
      } else {
        fields = IM_FIELD("Bot Token", secret.replace('/>', ' placeholder="xoxb-…"/>')) +
          IM_FIELD("App-Level Token", secret.replace('/>', ' placeholder="xapp-…"/>'));
      }
      return (
        '<div class="im-subcard" data-im-subcard="' + p.key + '" hidden="">' +
        /* 四子阶段（合并卡）：准备机器人 → 填写凭据并连接 → 完成平台接收设置 → 绑定我的账号 */
        '<ol class="im-substages" data-im-substages="">' +
        '<li data-substage="1">准备机器人</li>' +
        '<li data-substage="2">填写凭据并连接</li>' +
        '<li data-substage="3">完成平台接收设置</li>' +
        '<li data-substage="4">绑定我的账号</li></ol>' +
        '<div class="im-stage1"><button aria-expanded="false" class="im-guide-toggle" data-im-fold="" type="button"><span>查看接入指引（权限与事件订阅）</span><span aria-hidden="true" class="im-guide-caret">▸</span></button>' +
        '<div class="im-fold-body" hidden="">' + imGuideTemplate(p.key) + "</div></div>" +
        /* 团队态：Gateway 上已有机器人，选用即连，无需凭据 */
        '<div class="im-team-bots" data-im-team-bots="" hidden="">' +
        '<p class="im-fine">团队 Gateway 上已有可用机器人，选用即可，无需填写凭据。</p>' +
        '<button class="im-team-bot" data-im-team-pick="" type="button"><strong>Artemis 团队机器人 · ' + p.name + '</strong><small>已连接到团队 Gateway · 选用后即可配对</small></button>' +
        '<button class="im-demo-link" data-im-team-custom="" type="button">改用自己的凭据 →</button></div>' +
        '<div class="im-subcard-saved" data-im-cred-saved="" hidden="">' +
        '<p class="im-muted">演示配置已保存，密钥已清空。实际产品在 Gateway 加密保存。</p>' +
        '<div class="btn-pair"><button class="btn btn-ghost" data-im-cred-swap="" type="button">已保存 · 更换</button>' +
        '<button class="btn btn-ghost danger" data-im-conn-delete="" type="button">删除连接</button></div></div>' +
        '<form novalidate class="im-credentials-form" data-im-cred-form="">' +
        '<div class="im-subcard-title">应用凭据</div>' +
        '<p class="im-fine">填写必需凭据即可连接；请使用演示值，不要输入真实密钥。</p>' +
        '<div class="form-grid">' + fields + "</div>" +
        '<p class="im-fine">保存后机器人会用新密钥重新连接。</p>' +
        '<p class="im-fine" data-im-connect-help="" hidden="">正在用新密钥连接机器人，通常几秒。</p>' +
        '<div class="btn-pair"><button class="btn btn-ghost" data-im-fill-demo="" type="button">填入演示值</button><button class="btn btn-primary" data-im-cred-save="" type="button">保存并重连</button>' +
        '<button class="btn btn-ghost" data-im-cred-cancel="" type="button">取消</button></div></form>' +
        /* 阶段3：平台侧步骤由用户确认，不伪装系统检测 */
        '<div class="im-stage3" data-im-stage3="" hidden="">' +
        '<p class="im-fine">' + imStage3Copy(p.key) + "</p>" +
        '<label class="settings-checkbox"><input type="checkbox" data-im-receive-ready=""/><span>我已在平台完成接收设置</span></label>' +
        '<p class="im-fine" data-im-receive-note="" hidden="">收发将在配对时验证。</p>' +
        '<div class="btn-pair"><button class="btn btn-primary" data-im-receive-done="" disabled="" type="button">已完成平台设置，继续</button></div>' +
        '<p class="im-fine" data-im-receive-done-note="" hidden="">已确认 · 收发将在配对时验证。</p>' +
        "</div>" +
        /* 阶段4（原③卡整体迁入）：只允许你的账号使用这台电脑——同渠道线性推进 */
        '<div class="im-stage4" data-im-stage4="" hidden="">' +
        '<p class="im-muted">机器人连上了。现在把它认成你：在 ' + p.name + " 里找到刚配置的机器人，打开本人单聊发一条配对指令。不要把配对码发到群里。</p>" +
        '<div data-im-pairing-requests=""></div>' +
        '<p class="im-fine im-pair-phase" data-im-pair-phase="" hidden=""></p>' +
        '<div class="im-code-card" data-im-instructions=""></div>' +
        '<div class="im-code-card im-wait-card" data-im-wait-card="" hidden="">' +
        '<span aria-hidden="true" class="im-dot pending"></span>' +
        '<div class="im-wait-copy">' +
        '<p class="im-wait-title">已复制。发给机器人私聊，等它回复确认——通常几秒内。</p>' +
        '<p class="im-fine"><span class="im-countdown" data-im-wait-countdown="">0:10</span> · <button class="im-demo-link" data-im-pair-arrive="" type="button">演示：让确认现在到达</button></p>' +
        "</div></div>" +
        '<button class="im-demo-link" data-im-goto-projects="" hidden="" type="button">先去 ③ 选择项目 →</button>' +
        '<div class="im-block">' +
        '<h4>已绑定账号 · ' + p.name + "</h4>" +
        '<ul class="im-binding-list" data-im-bindings=""></ul>' +
        '<p class="im-muted" data-im-binding-empty="" hidden="">这个渠道还没有绑定账号。</p>' +
        "</div></div></div>"
      );
    }

    /* 阶段3 说明按平台生成（对齐生产平台侧步骤） */
    function imStage3Copy(platformKey) {
      if (platformKey === "feishu")
        return "回飞书后台：事件订阅选择「长连接」、订阅消息事件，然后创建版本并发布。做完再来勾选。";
      if (platformKey === "wecom")
        return "回企业微信确认机器人已发布，且自己已在「可使用成员」范围。做完再来勾选。";
      return "回 Slack 确认应用已安装到工作区、Socket Mode 已开启。做完再来勾选。";
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
          '<li><p>先在 Artemis 保存凭据建立连接，再回平台选择长连接、订阅事件并发布。HTTPS 回调只用于公网团队服务。</p></li>' +
          '<li><p>订阅事件：</p><div class="im-chips"><button class="im-chip" type="button"><code>im.message.receive_v1</code><span aria-hidden="true">⧉</span></button></div></li>' +
          '<li class="im-guide-warning"><p>在「回调配置」（不是事件订阅）添加：</p><div class="im-chips"><button class="im-chip" type="button"><code>card.action.trigger</code><span aria-hidden="true">⧉</span></button></div></li>' +
          '<li><p>创建版本并发布。</p></li></ol>'
        );
      }
      if (platformKey === "wecom") {
        return (
          '<ol class="im-guide"><li><p>企业微信客户端 → 工作台 → 智能机器人 → API 模式创建。</p></li>' +
          '<li><p>选择长连接，复制 Bot ID、Secret；从管理后台复制企业 ID。</p></li>' +
          '<li><p>同一个 Bot ID 仅连接一份 Gateway，避免被其他客户端抢占。</p></li>' +
          '<li><p>将自己加入机器人可使用成员范围并保存。</p></li></ol>'
        );
      }
      return (
        '<ol class="im-guide"><li><p>在 Slack API 创建应用，或直接导入 Manifest。</p></li>' +
        '<li><p>开启 Socket Mode（无需公网回调）。</p></li>' +
        '<li><p>订阅 message.im、app_mention；授予 chat:write、im:history、app_mentions:read、files:read、users:read。安装应用到工作区，创建带 connections:write 的 App-Level Token。</p></li></ol>'
      );
    }

    /* 平台行动作：按聚合态派生（全部状态推导，不写死）；connecting 过渡期无行操作 */
    function imPlatformActions(st) {
      if (st.agg === "none")
        return '<button class="btn btn-ghost" data-im-add="" type="button">去添加</button>';
      if (st.agg === "connecting") return "";
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
            c.state === "ok"
              ? "已连接"
              : c.state === "bad"
                ? "连接失败"
                : c.state === "connecting"
                  ? "连接中"
                  : "正在重连 · 第 " + (c.attempt || 1) + " 次";
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

    /* ===== 渠道 tab（合并卡）：单一事实源=imChannelSel；面板互斥显示 ===== */
    var imChannelSel = "";
    function imBuildChannelTabs() {
      var strip = imPanel.querySelector("[data-im-channel-tabs]");
      if (!strip) return;
      if (!imChannelSel) {
        var withConns = IM_PLATFORMS.filter(function (p) {
          return ((imState.connections || {})[p.key] || []).length > 0;
        });
        imChannelSel = (withConns[0] || IM_PLATFORMS[0]).key;
      }
      strip.textContent = "";
      IM_PLATFORMS.forEach(function (p) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "im-channel-tab";
        b.setAttribute("role", "tab");
        b.setAttribute("data-im-channel-tab", p.key);
        b.setAttribute("aria-selected", String(p.key === imChannelSel));
        b.innerHTML =
          "<strong>" + p.name + "</strong><span>" +
          (IM_CHANNEL_CONSTRAINT[p.key] || "") + "</span>";
        strip.appendChild(b);
      });
    }
    function imSyncChannelPanels() {
      IM_PLATFORMS.forEach(function (p) {
        var row = imPanel.querySelector('[data-im-platform="' + p.key + '"]');
        if (row) row.hidden = p.key !== imChannelSel;
      });
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-channel-tab]"),
        function (t) {
          t.setAttribute(
            "aria-selected",
            String(t.getAttribute("data-im-channel-tab") === imChannelSel),
          );
        },
      );
    }
    imPanel.addEventListener("click", function (ev) {
      var tab = ev.target.closest("[data-im-channel-tab]");
      if (!tab) return;
      imChannelSel = tab.getAttribute("data-im-channel-tab");
      imSyncChannelPanels();
    });

    function imBuildPlatformRows() {
      var list = imPanel.querySelector("[data-im-platform-rows]");
      list.textContent = "";
      imBuildChannelTabs();
      IM_PLATFORMS.forEach(function (p) {
        var st = imDerived.platforms[p.key];
        var showConns =
          st.conns.length > 1 ||
          st.agg === "partial" ||
          st.agg === "allbad" ||
          st.agg === "reconnecting" ||
          st.agg === "connecting";
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
      imSyncChannelPanels();
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
        else if (st.agg === "connecting") text = "连接中";
        else if (st.agg === "reconnecting")
          text = "正在重连 · 第 " + ((st.conns[0] && st.conns[0].attempt) || 1) + " 次";
        status.textContent = text;
        /* 行操作随聚合态原地刷新（不动子卡展开状态） */
        row.querySelector(".im-platform-actions").innerHTML = imPlatformActions(st);
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
      imSecondsLeft = 5 * 60;
      imCodeExpired = false;
      /* [换一个] 终止等待（配对码作废，确认自然不会到达） */
      if (imState.sim && imState.sim.pairWait) {
        imState.sim.pairWait = null;
        imRenderWaitCard();
      }
      var i = IM_PAIR_CODES.indexOf(imState.pairCode);
      imState.pairCode = IM_PAIR_CODES[(i + 1) % IM_PAIR_CODES.length];
      imBuildInstructions();
      imRefresh();
      notice("已换新配对码（演示）");
    }

    /* 配对请求卡：按渠道渲染到各自 stage4；批准/拒绝后移除 */
    function imBuildPairingRequests() {
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-pairing-requests]"),
        function (box) {
          var sub = box.closest("[data-im-subcard]");
          var pk = sub ? sub.getAttribute("data-im-subcard") : "";
          box.textContent = "";
          imState.pairingRequests.forEach(function (req, idx) {
            if (req.platform !== pk) return;
            var platformName = (IM_PLATFORMS.filter(function (p) {
              return p.key === req.platform;
            })[0] || {}).name || req.platform;
            var card = document.createElement("div");
            card.className = "im-pairing-request-card";
            card.setAttribute("data-im-pairing-idx", String(idx));
            card.innerHTML =
              '<div class="im-pair-head"><span aria-hidden="true" class="im-dot pending"></span>' +
              "<strong>" + req.name + " 请求绑定这台电脑</strong><span class=\"im-demo-tag\">演示</span></div>" +
              '<div class="im-pair-who"><span class="im-pair-platform">' + platformName + "</span>" +
              '<code class="im-identifier">' + req.id + "</code></div>" +
              '<div class="im-pair-actions"><button class="btn btn-primary" data-im-approve="" type="button">批准</button>' +
              '<button class="btn btn-ghost" data-im-reject="" type="button">拒绝</button></div>';
            box.appendChild(card);
          });
        },
      );
    }

    function imBuildInstructions() {
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-instructions]"),
        function (box) {
          var sub = box.closest("[data-im-subcard]");
          var pk = sub ? sub.getAttribute("data-im-subcard") : "";
          var st = imDerived.platforms[pk] || { ok: 0, conns: [] };
          if (!st.ok) {
            box.innerHTML = '<p class="im-muted">先把上方的机器人连起来，这里会给出配对指令。</p>';
            return;
          }
          var p = IM_PLATFORMS.filter(function (x) { return x.key === pk; })[0];
          var conn = st.conns.filter(function (c) { return c.state === "ok"; })[0];
          var html = "";
          /* 会话内首次：机器人连上后的衔接首行 */
          if (!(imState.sim.hints && imState.sim.hints.accountIntro)) {
            if (imState.sim.hints) imState.sim.hints.accountIntro = true;
            html += '<p class="im-instr-title">机器人连上了。现在把它认成你：</p>';
          }
          html += '<p class="im-instr-title">1. 把这条消息发给机器人私聊：</p>';
          html +=
            '<div class="im-instr-line" data-im-instr-platform="' + pk + '"><span class="im-instr-who">' +
            p.name + " · " + (conn && conn.app ? conn.app : "机器人") +
            '</span><code class="im-identifier">' + imPairCommand(pk) +
            '</code><button class="btn btn-ghost" data-copy-pair="" type="button"' +
            (imCodeExpired ? ' disabled="" title="配对码已过期"' : "") + ">复制指令</button></div>";
          html +=
            '<p class="im-fine"><span data-im-expiry-note=""><span class="im-countdown" data-im-countdown="">' +
            imExpiryText() + '</span>' + (imCodeExpired ? "" : " 后过期") +
            '</span> · <button class="im-demo-link" data-im-renew-code="" type="button">' +
            (imCodeExpired ? "生成新指令" : "换一个") + "</button></p>" +
            '<p class="im-instr-title">2. 机器人回复确认后，账号会出现在下面。</p>';
          box.innerHTML = html;
          /* 重建后重新挂复制反馈；复制指令开启 10s 双轨等待（幂等） */
          var btn = box.querySelector("[data-copy-pair]");
          if (btn)
            btn.addEventListener("click", function () {
              if (imCodeExpired || imState.gateway.linkBroken) { notice("请先更新配对码或恢复服务。", true); return; }
              imCopy(btn.closest("[data-im-instr-platform]").querySelector("code").textContent);
              var original = btn.textContent;
              btn.textContent = "已复制";
              setTimeout(function () { btn.textContent = original; }, 1400);
              imStartPairWait(pk);
            });
        },
      );
    }

    /* ③ 双轨：10s 倒计时自动到达 + 「演示：让确认现在到达」弱链接（幂等） */
    function imStartPairWait(platformKey) {
      if (!imState.sim || imState.sim.pairWait) return;
      if (imCodeExpired || imState.gateway.linkBroken) { notice("配对码已过期或服务断连，请更新配对码并恢复服务。", true); return; }
      imState.sim.session = true;
      imState.sim.pairWait = { platform: platformKey, leftMs: IM_T_PAIR_WAIT };
      imRenderWaitCard();
      imRefresh();
    }
    function imPairWaitText() {
      var w = imState.sim && imState.sim.pairWait;
      var left = Math.max(0, Math.ceil(((w && w.leftMs) || 0) / 1000));
      return "0:" + String(left).padStart(2, "0");
    }
    function imRenderWaitCard() {
      var w = imState.sim && imState.sim.pairWait;
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-wait-card]"),
        function (card) {
          var sub = card.closest("[data-im-subcard]");
          var pk = sub ? sub.getAttribute("data-im-subcard") : "";
          card.hidden = !w || w.platform !== pk;
          if (w && w.platform === pk) {
            var el = card.querySelector("[data-im-wait-countdown]");
            if (el) el.textContent = imPairWaitText();
          }
        },
      );
    }
    /* 到达：转入配对请求卡（到达脉冲是允许的三个脉冲场景之一）；
       requestFresh 2.5s 内显示「收到账号请求」，随后转「待本人确认」（配对五态）；
       自动切到该渠道 tab，让到达可见 */
    function imArrivePairing() {
      var w = imState.sim && imState.sim.pairWait;
      if (!w) return; /* 幂等：已到达/已取消 */
      imState.sim.pairWait = null;
      imRenderWaitCard();
      imState.sim.requestFresh = true;
      imChannelSel = w.platform;
      imSyncChannelPanels();
      imState.pairingRequests.push({
        name: "我（演示账号）",
        id: "u_me01",
        platform: w.platform,
      });
      imBuildPairingRequests();
      imRefresh();
      var fe = imEpoch;
      setTimeout(function () {
        if (fe !== imEpoch || !imState.sim) return;
        imState.sim.requestFresh = false;
        imRenderPairPhase();
      }, 2500);
      var reqCard = imPanel.querySelector("[data-im-pairing-idx]");
      if (reqCard) {
        reqCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
        imPulse(reqCard);
      }
    }

    function imBuildBindings() {
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-bindings]"),
        function (list) {
          var sub = list.closest("[data-im-subcard]");
          var pk = sub ? sub.getAttribute("data-im-subcard") : "";
          list.textContent = "";
          imState.bindings.forEach(function (b, idx) {
            if (b.platform !== pk) return;
            var li = document.createElement("li");
            li.className = "im-binding-row";
            li.setAttribute("data-im-binding-idx", String(idx));
            li.innerHTML =
              '<div class="im-binding-main"><span class="im-binding-name">' + b.name +
              '<span class="im-demo-tag">演示</span></span><code class="im-identifier">' + b.id + "</code>" +
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
          var empty = sub.querySelector("[data-im-binding-empty]");
          if (empty)
            empty.hidden = imState.bindings.some(function (b) { return b.platform === pk; });
        },
      );
    }

    /* ④ 范围树（演示数据）：depth 由路径推导；locked=受保护文件不可选 */
    var IM_SCOPE_TREE = [
      { path: "src/" },
      { path: "src/renderer/" },
      { path: "src/main/" },
      { path: "docs/" },
      { path: "package.json" },
      { path: ".env.local", locked: true },
    ];
    function imScopeDepth(path) {
      return (path.match(/\//g) || []).length - 1;
    }
    function imScopeAncestors(path) {
      var out = [];
      var parts = path.split("/");
      parts.pop(); /* 末段（文件或目录名）不入祖先 */
      var acc = "";
      parts.forEach(function (seg) {
        if (!seg) return;
        acc += seg + "/";
        out.push(acc);
      });
      return out;
    }
    var IM_MODE_META = {
      plan: { label: "只读分析", desc: "可以看和总结，不改文件" },
      review: { label: "只读审查", desc: "可以评审代码，不改文件" },
      execute: { label: "允许修改", desc: "可以改文件，需要选择范围" },
    };
    function imScopeText(pr) {
      if (pr.mode === "execute") {
        var reads = pr.reads && pr.reads.length ? "可读 " + pr.reads.length + " 项" : "未选范围";
        var writes = pr.writes && pr.writes.length ? " · 可写 " + pr.writes.length + " 项" : "";
        return reads + writes;
      }
      return pr.reads && pr.reads.length ? "自定义可读 " + pr.reads.length + " 项" : "可读整个项目，不可写任何文件";
    }

    /* ③ 行内摘要（生产对齐）：范围 + 期限；到期/未生效加注 */
    function imRowSummary(pr) {
      var text = imScopeText(pr);
      if (pr.expired) text += " · 已过期";
      else text += " · 30 天有效";
      return text;
    }
    var IM_MODE_SUFFIX = { plan: "Plan", review: "Review", execute: "Execute" };

    /* 授权配置弹窗体：三档模式 + 范围树 + 审批/命令/网络 + 有效期（与行内草稿联动） */
    function imGrantBodyTemplate(pr, idx) {
      var modes = ["plan", "review", "execute"]
        .map(function (m) {
          return (
            '<label class="im-mode-tier' + (pr.mode === m ? " on" : "") + '"><input type="radio" name="imMode' + idx + '" value="' + m + '"' + (pr.mode === m ? " checked" : "") + ' data-im-mode=""/><strong>' + IM_MODE_META[m].label + "</strong><small>" + IM_MODE_META[m].desc + "</small></label>"
          );
        })
        .join("");
      var tree =
        '<div class="im-scope-head"><span></span><span>可读</span><span>可写</span></div>' +
        IM_SCOPE_TREE.map(function (node) {
          var locked = !!node.locked;
          return (
            '<div class="im-scope-row' + (locked ? " locked" : "") + '" data-scope-path="' + node.path + '" style="--depth:' + imScopeDepth(node.path) + '">' +
            '<input type="checkbox" aria-label="可读 ' + node.path + '" data-im-scope-read="" data-scope-path="' + node.path + '"' + (locked ? " disabled" : "") + "/>" +
            '<input type="checkbox" aria-label="可写 ' + node.path + '" data-im-scope-write="" data-scope-path="' + node.path + '"' + (locked ? " disabled" : "") + "/>" +
            '<span class="im-scope-label">' + node.path + (locked ? " · 受保护" : "") + "</span></div>"
          );
        }).join("");
      return (
        '<div class="im-mode-tiers" data-im-mode-tiers="">' + modes + "</div>" +
        '<p class="im-fine" data-im-scope-declare=""></p>' +
        '<div class="im-scope-tree" data-im-scope-tree="" hidden="">' + tree + "</div>" +
        '<button class="im-demo-link" data-im-scope-custom="" type="button">自定义范围 ▸</button>' +
        '<label class="im-field"><span class="im-field-label">执行审批</span><select class="im-field-input" data-im-permission="approval"><option value="ask">每次确认</option><option value="automatic">授权范围内自动执行</option></select></label>' +
        '<div data-im-exec-only="" hidden=""><label class="settings-checkbox"><input type="checkbox" data-im-permission="commands"/><span>允许沙箱命令</span></label>' +
        '<label class="settings-checkbox"><input type="checkbox" data-im-permission="network"/><span>允许命令访问网络</span></label></div>' +
        '<p class="im-fine">远程任务仅在授权项目的沙箱内运行；不开放完整本机访问、MCP 或扩展。</p>' +
        '<p class="im-fine" data-im-expiry-field="">' + (pr.expired ? "授权已到期，重新确认可续期 30 天。" : "确认后授权有效期为 30 天。") + "</p>"
      );
    }

    /* 行内即时生效（生产对齐）：勾选/确认配置即保存+启用；两阶段失败分支保留 */
    function imApplyGrant(action, name) {
      var errEl = imPanel.querySelector("[data-im-grant-error]");
      if (imState.sim.saveFailure) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = "保存失败：服务暂不可用。授权未保存，连接未启用；已保留你的选择，恢复后重试。";
        }
        return false;
      }
      if (action) action();
      /* 续期规则：勾选保存即续期；到期项目「去授权→确认设置」即使未勾选也清到期标记（UI 承诺「重新确认可续期 30 天」） */
      imState.projects.forEach(function (pr) { if (pr.checked || pr.id === name) pr.expired = false; });
      imState.sim.projectsDirty = false;
      if (errEl) errEl.hidden = true;
      if (imState.sim.enableFailure) {
        imState.grantEnabled = false;
        imState.grantEnableFailed = true;
        imBuildProjects();
        imRefresh();
        notice("授权已保存，连接未启用（演示）", true);
      } else {
        imState.grantEnabled = true;
        imState.grantEnableFailed = false;
        imBuildProjects();
        imRefresh();
        if (name) notice(name + " 的授权已生效（演示）");
      }
      return true;
    }

    function imBuildProjects() {
      var list = imPanel.querySelector("[data-im-project-rows]");
      list.textContent = "";
      /* 临时会话：内置授权目标，默认开启且不可取消（2026-09-13 拍板）；
         默认项目为空时它就是默认（普通消息落临时任务） */
      var adhocDefault = !imState.defaultProject;
      var builtin = document.createElement("li");
      builtin.className = "im-project im-project-builtin";
      builtin.innerHTML =
        '<div class="im-project-line"><label class="settings-checkbox im-project-head"><input type="checkbox" checked disabled="" aria-label="临时会话（内置，始终可用）"/><span><strong>临时会话</strong><small>不绑定项目的会话；手机上始终可用</small></span></label>' +
        '<span class="im-row-summary">内置授权 · 始终有效</span>' +
        (adhocDefault ? '<span class="im-default-badge">默认</span>' : "") + "</div>";
      list.appendChild(builtin);
      imState.projects.forEach(function (pr, idx) {
        pr.reads = pr.reads || [];
        pr.writes = pr.writes || [];
        pr.mode = pr.mode || "plan";
        pr.approval = pr.approval || "ask";
        var isDefault = imState.defaultProject === pr.id;
        var li = document.createElement("li");
        li.className = "im-project";
        li.setAttribute("data-im-project-idx", String(idx));
        li.innerHTML =
          '<div class="im-project-line">' +
          '<label class="settings-checkbox im-project-head"><input type="checkbox"' +
          (pr.checked ? " checked" : "") + '><span><strong>' + pr.id + '</strong><em class="im-mode-suffix">.' + IM_MODE_SUFFIX[pr.mode] + "</em></span></label>" +
          '<span class="im-row-summary">' + imRowSummary(pr) + "</span>" +
          (isDefault ? '<span class="im-default-badge">默认</span>' : "") +
          (pr.checked && !isDefault ? '<button class="im-set-default" data-im-set-default="" type="button">设为默认</button>' : "") +
          '<button class="btn btn-ghost im-grant-btn" data-im-grant-config="" type="button">授权配置</button>' +
          "</div>" +
          (pr.expired
            ? '<div class="im-project-expired"><span>⚠ 授权已到期</span><button class="btn btn-ghost" data-im-reauthorize="" type="button">去授权</button></div>'
            : "");
        var checkbox = li.querySelector(".im-project-head input");
        checkbox.addEventListener("change", function () {
          imState.sim.session = true;
          var ok = imApplyGrant(function () {
            imState.projects[idx].checked = checkbox.checked;
            if (checkbox.checked && !imState.defaultProject)
              imState.defaultProject = imState.projects[idx].id;
            if (
              !imState.projects.some(function (p2) { return p2.checked && p2.id === imState.defaultProject; })
            ) {
              imState.defaultProject =
                (imState.projects.find(function (p2) { return p2.checked; }) || {}).id || "";
            }
          });
          if (!ok) checkbox.checked = imState.projects[idx].checked;
        });
        list.appendChild(li);
      });
    }

    /* ④ 行内状态渲染：档位高亮 / 范围声明 / 树显隐与勾选态 / 命令网络可用性 */
    function imUpdateProjectRow(li, pr) {
      Array.prototype.forEach.call(
        li.querySelectorAll("[data-im-mode-tiers] .im-mode-tier"),
        function (tier) {
          var radio = tier.querySelector("input");
          tier.classList.toggle("on", radio && radio.checked);
        },
      );
      var declare = li.querySelector("[data-im-scope-declare]");
      if (declare)
        declare.textContent =
          pr.mode === "execute"
            ? "选择可读与可写范围；可写必须是可读的子集，受保护文件不能选。"
            : "默认可读整个项目，不可写任何文件；需要更细可改用「自定义范围」。";
      var tree = li.querySelector("[data-im-scope-tree]");
      var customBtn = li.querySelector("[data-im-scope-custom]");
      var customOpen = !!li.dataset.scopeCustom;
      var treeOpen = pr.mode === "execute" || customOpen;
      if (tree) tree.hidden = !treeOpen;
      if (customBtn) customBtn.hidden = pr.mode === "execute";
      Array.prototype.forEach.call(
        li.querySelectorAll(".im-scope-row"),
        function (row) {
          var path = row.getAttribute("data-scope-path");
          var locked = row.classList.contains("locked");
          var r = row.querySelector("[data-im-scope-read]");
          var w = row.querySelector("[data-im-scope-write]");
          r.checked = pr.reads.indexOf(path) >= 0;
          w.checked = pr.writes.indexOf(path) >= 0;
          /* 受保护文件不可选；可写依赖可读——自身或子路径有可写时禁取消可读 */
          r.disabled =
            locked ||
            w.checked ||
            pr.writes.some(function (wPath) {
              return wPath === path || wPath.indexOf(path) === 0;
            });
          w.disabled = locked || pr.mode !== "execute";
        },
      );
      var execOnly = li.querySelector("[data-im-exec-only]");
      if (execOnly) {
        execOnly.hidden = pr.mode !== "execute";
        var cmd = li.querySelector('[data-im-permission="commands"]');
        var net = li.querySelector('[data-im-permission="network"]');
        if (cmd) cmd.disabled = pr.mode !== "execute";
        if (net) net.disabled = pr.mode !== "execute" || !pr.commands;
      }
    }
    function imSyncDefaultProject() {
      /* 默认项目已改徽章打标 + 悬停切换（生产对齐）：无下拉可同步 */
    }

    function imRenderPill() {
      var pill = imDerived.pill;
      imPill.dataset.tone = pill.tone;
      imPill.setAttribute(
        "title",
        pill.tone === "warn"
          ? "点按定位到「接入渠道」卡片"
          : "机器人接入状态；不代表聊天软件客户端在线状态。",
      );
      imStateText.innerHTML = pill.html;
      var dot = imPill.querySelector(".im-dot");
      dot.className =
        "im-dot " +
        (pill.tone === "ok"
          ? "ok"
          : pill.tone === "warn" || pill.tone === "busy"
            ? "pending"
            : "idle");
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
        var open = key in imManual
          ? !!imManual[key]
          : imDerived.autoExpand.indexOf(key) >= 0;
        card.querySelector(".im-card-body").hidden = !open;
        card.querySelector("[data-im-card-head]").setAttribute("aria-expanded", String(open));
        card.querySelector("[data-im-caret]").textContent = open ? "▾" : "▸";
        /* 已完成且折叠的卡：摘要行尾给「编辑」入口提示（卡头整行即编辑入口）；
           三步版：②已验证渠道在摘要附「已验证」信号（验证可选、入门禁信号） */
        var base = c.summary;
        if (key === "channel" && c.state === "done") {
          var verified = IM_PLATFORMS.filter(function (p) {
            return imDerived.platforms[p.key].verified;
          });
          if (verified.length)
            base += " · " + verified.map(function (p) { return p.name; }).join("、") + " 已验证";
        }
        summary.textContent = c.state === "done" && !open ? base + " · 编辑" : base;
        summary.hidden = open;
      });
    }

    /* ① 空态按钮/帮助行随 starting 瞬态（G1：1000ms 启动过渡）与失败分支（端口占用/注册失败） */
    function imRenderService() {
      var cta = imPanel.querySelector("[data-im-service-start]");
      var help = imPanel.querySelector("[data-im-service-help]");
      var err = imPanel.querySelector("[data-im-service-error]");
      var starting = !!imState.gateway.starting;
      var failed = imState.gateway.startError;
      if (cta) {
        cta.disabled = starting;
        cta.textContent = starting ? "正在启动…" : failed ? "重试开启" : "一键开启（推荐）";
      }
      if (help) help.hidden = !starting;
      if (err) {
        err.hidden = !failed;
        if (failed) err.textContent = failed;
      }
    }

    /* ===== ②尾「顺手验证」折叠段（三步版）：不计入完成链，验证归属渠道 ===== */
    var IM_TEST_STEPS = ["消息已发出", "桌面出现任务", "任务完成", "IM 回复已送达"];
    function imTestCommand(platformKey) {
      /* 飞书/企微指令带 /，Slack 不带（与配对指令同一斜杠规则） */
      return (platformKey === "slack" ? "" : "/") +
        "new 请查看当前项目，告诉我它是做什么的，先不要修改文件。";
    }
    /* 验证归属渠道：已开测的渠道粘住不放（除非解绑）；否则取当前 tab；再回退首个可用 */
    function imTestChannel() {
      var t = imState.test;
      var paired = function (k) {
        var st = imDerived.platforms[k];
        return !!(st && st.paired);
      };
      if (t && t.channel && paired(t.channel)) return t.channel;
      if (paired(imChannelSel)) return imChannelSel;
      var p = IM_PLATFORMS.filter(function (x) { return paired(x.key); })[0];
      return p ? p.key : "";
    }
    function imRenderTest() {
      var verify = imPanel.querySelector("[data-im-verify]");
      if (!verify) return;
      var toggle = verify.querySelector("[data-im-verify-toggle]");
      var body = verify.querySelector("#imVerifyBody");
      var box = verify.querySelector("[data-im-test-commands]");
      var track = verify.querySelector("[data-im-track]");
      var actions = verify.querySelector("[data-im-test-actions]");
      var errEl = verify.querySelector("[data-im-test-error]");
      var confirmBox = verify.querySelector("[data-im-test-confirm]");
      var doneBox = verify.querySelector("[data-im-test-done]");
      var t = imState.test || (imState.test = { stage: 0, failed: false, confirmed: false, channel: "" });
      /* 折叠段开合：用户动过后记住；未动过则跟随自动规则（首绑自动展开一次） */
      var open = !!imState.sim.verifyOpened;
      if (toggle && body) {
        body.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        var caret = toggle.querySelector(".im-guide-caret");
        if (caret) caret.textContent = open ? "▾" : "▸";
      }
      /* 折叠标签带验证状态信号：未验证 / 验证进行中 / 已验证·渠道名 */
      var pk = imTestChannel();
      var pkName = pk ? (IM_PLATFORMS.filter(function (p) { return p.key === pk; })[0] || {}).name : "";
      if (toggle) {
        var label = toggle.querySelector("span");
        if (label)
          label.textContent = t.confirmed
            ? "顺手验证：已验证 · " + pkName
            : t.stage > 0
              ? "顺手验证：验证进行中 · " + pkName
              : "顺手验证（可选）：发一条真实消息走通全链路";
      }
      /* 指令只列端到端可用（已连接且已绑定）的渠道 */
      var readyPlatforms = IM_PLATFORMS.filter(function (p) {
        return imDerived.platforms[p.key].paired;
      });
      if (box) {
        box.textContent = "";
        if (!readyPlatforms.length) {
          box.innerHTML = '<p class="im-muted">完成绑定后，这里会给出测试指令。</p>';
        } else {
          readyPlatforms.forEach(function (p) {
            var line = document.createElement("div");
            line.className = "im-instr-line";
            line.innerHTML =
              '<span class="im-instr-who">' + p.name + " · Artemis 机器人</span>" +
              '<code class="im-identifier">' + imTestCommand(p.key) + "</code>" +
              '<button class="btn btn-ghost" data-im-copy-new="" type="button">复制指令</button>';
            box.appendChild(line);
          });
        }
      }
      if (track) {
        track.hidden = !pk || t.confirmed;
        if (!track.hidden)
          track.innerHTML = IM_TEST_STEPS.map(function (label, i) {
            var n = i + 1;
            var cls = t.stage >= n ? "done" : t.stage + 1 === n ? "cur" : "";
            return '<li class="' + cls + '" data-track="' + n + '">' + (t.stage >= n ? "✓ " : n + " · ") + label + "</li>";
          }).join("");
      }
      if (actions) {
        var html = "";
        if (pk && !t.confirmed) {
          if (t.failed) {
            html = '<button class="btn btn-ghost" data-im-test-retry="" type="button">重试任务（演示）</button>';
          } else if (t.stage === 0) {
            html = '<span class="im-fine">复制后发到 ' + pkName + ' 单聊，然后：</span><button class="im-demo-link" data-im-test-advance="" type="button">演示：消息已发出</button>';
          } else if (t.stage === 1) {
            html = '<button class="im-demo-link" data-im-test-advance="" type="button">演示：桌面已出现任务</button>';
          } else if (t.stage === 2) {
            html =
              '<button class="im-demo-link" data-im-test-advance="" type="button">演示：任务已完成</button>' +
              '<button class="im-demo-link" data-im-test-fail="" type="button">演示：模型不可用</button>';
          } else if (t.stage === 3) {
            html = '<button class="im-demo-link" data-im-test-advance="" type="button">演示：回复已送达</button>';
          }
        }
        actions.innerHTML = html;
      }
      if (errEl) {
        errEl.hidden = !t.failed;
        if (t.failed)
          errEl.textContent = "任务失败：模型不可用——这是任务的问题，不是机器人连接问题；连接状态不受影响。";
      }
      if (confirmBox) confirmBox.hidden = !(t.stage >= 4 && !t.confirmed);
      if (doneBox) {
        doneBox.hidden = !t.confirmed;
        var title = doneBox.querySelector(".im-ready-title");
        if (title) title.textContent = "✓ 全链路走通（你已确认）· " + pkName;
        var undo = doneBox.querySelector("[data-im-test-undo]");
        if (undo) undo.remove();
        if (t.confirmed) {
          var undoBtn = document.createElement("button");
          undoBtn.className = "im-demo-link";
          undoBtn.setAttribute("data-im-test-undo", "");
          undoBtn.type = "button";
          undoBtn.textContent = "撤销确认";
          doneBox.appendChild(undoBtn);
        }
      }
    }

    /* ③尾完成仪式：三步完成链全✓后出现（验证不计入门禁，只在此引导补做） */
    function imRenderCeremony() {
      var el = imPanel.querySelector("[data-im-ceremony]");
      if (el) el.hidden = !imDerived.allDone;
    }

    /* ===== 群协作独立第二流程（D2/PT-7）：发现群 → 选择群与成员 → 各群确认 → 授权我的项目 ===== */
    function imGroupStateText() {
      var gf = imState.groupFlow;
      if (gf.phase === "confirm") {
        var pending = gf.groups.filter(function (g) { return !g.confirmed; }).length;
        return pending ? "已保存，等待 " + pending + " 个群确认" : "全部群已确认";
      }
      if (gf.phase === "grant") return "群已确认，尚未授权项目";
      if (gf.phase === "done") return "你的项目已就绪";
      return "";
    }
    function imRenderGroupFlow() {
      var flowEl = imPanel.querySelector("[data-im-group-flow]");
      var mainFlow = imPanel.querySelector("#imFlow");
      if (!flowEl) return;
      var gf = imState.groupFlow;
      flowEl.hidden = !gf.open;
      if (mainFlow) mainFlow.hidden = !!gf.open;
      if (!gf.open) return;
      var body = imPanel.querySelector("[data-im-group-body]");
      var stateEl = imPanel.querySelector("[data-im-group-state]");
      var steps = imPanel.querySelectorAll("[data-gstep]");
      var phaseIdx = { discover: 1, select: 2, confirm: 3, grant: 4, done: 5 }[gf.phase] || 1;
      Array.prototype.forEach.call(steps, function (li) {
        var n = Number(li.getAttribute("data-gstep"));
        li.classList.toggle("done", gf.phase === "done" || n < phaseIdx);
        li.classList.toggle("cur", gf.phase !== "done" && n === phaseIdx);
      });
      if (stateEl) stateEl.textContent = imGroupStateText();
      if (!body) return;
      var html = "";
      if (imState.bindings.length === 0) {
        html =
          '<p class="im-muted">群协作需要每位成员先完成配对。</p>' +
          '<button class="im-demo-link" data-im-group-back="" type="button">先回 ② 绑定账号 →</button>';
      } else if (gf.phase === "discover") {
        html =
          '<p class="im-fine">在群里 @机器人 发 <code class="im-identifier">/help</code> 发现群——发现不等于共享，还需保存空间并确认。</p>' +
          '<div class="im-chips"><button class="im-chip" type="button"><code>/help</code><span aria-hidden="true">⧉</span></button></div>' +
          '<button class="im-demo-link" data-im-gf-find="" type="button">演示：机器人发现了群</button>';
      } else if (gf.phase === "select") {
        html =
          gf.groups.map(function (g) {
            return '<div class="im-group-row"><span class="im-group-name">' + g.name + "</span>" +
              '<span class="im-group-meta">' + g.members + " 名成员 · 已发现</span></div>";
          }).join("") +
          '<p class="im-fine">参与成员：' + imState.bindings.map(function (b) { return b.name; }).join("、") + "（各成员需已配对）</p>" +
          '<div class="btn-pair"><button class="btn btn-primary" data-im-gf-save="" type="button">保存空间</button></div>' +
          '<p class="im-fine">每次保存空间都会重置全部群确认（对齐生产行为）。</p>';
      } else if (gf.phase === "confirm") {
        html =
          gf.groups.map(function (g, i) {
            return '<div class="im-group-row">' +
              '<span class="im-group-name">' + g.name + "</span>" +
              '<span class="im-group-state">' + (g.confirmed ? "已确认" : "待确认") + "</span>" +
              (g.confirmed ? "" :
                '<button class="im-chip" type="button"><code>' + (g.platform === "slack" ? "" : "/") + 'space-confirm</code><span aria-hidden="true">⧉</span></button>' +
                '<button class="im-demo-link" data-im-gf-confirm="' + i + '" type="button">演示：本群已确认</button>') +
              "</div>";
          }).join("") +
          '<button class="im-demo-link" data-im-gf-resave="" type="button">修改群或成员？重新保存空间（会重置全部确认）</button>';
      } else if (gf.phase === "grant") {
        html =
          '<p class="im-fine">每位成员在自己的电脑上授权项目和数据范围，空间管理员不能代开。</p>' +
          '<button class="im-demo-link" data-im-gf-grant="" type="button">演示：我的授权已就绪</button>';
      } else {
        html =
          '<p class="im-fine">已连接 ' + gf.groups.length + " 个群。群任务、公开进度与成果在空间内共享。</p>" +
          '<div class="btn-pair"><button class="btn btn-primary" data-im-group-back="" type="button">返回单聊设置</button></div>';
      }
      body.innerHTML = html;
    }

    /* ② 三子阶段渲染：阶段条高亮（未连接=② / 已连接未确认=③）+ 阶段3 显隐与确认态 */
    function imRenderSubstages() {
      IM_PLATFORMS.forEach(function (p) {
        var row = imPanel.querySelector('[data-im-platform="' + p.key + '"]');
        if (!row) return;
        var sub = row.querySelector("[data-im-subcard]");
        if (!sub) return;
        var st = imDerived.platforms[p.key];
        var connected = st.ok > 0;
        var ready = !!(imState.platformReady && imState.platformReady[p.key]);
        var paired = !!(st && st.paired);
        Array.prototype.forEach.call(
          sub.querySelectorAll("[data-substage]"),
          function (li) {
            var n = li.getAttribute("data-substage");
            li.classList.toggle(
              "done",
              n === "2" ? connected : n === "3" ? ready : n === "4" ? paired : false,
            );
            var cur = !connected ? "2" : !ready ? "3" : !paired ? "4" : "";
            li.classList.toggle("cur", !!cur && n === cur);
          },
        );
        var stage3 = sub.querySelector("[data-im-stage3]");
        if (stage3) {
          stage3.hidden = !connected;
          var doneNote = stage3.querySelector("[data-im-receive-done-note]");
          if (doneNote) doneNote.hidden = !ready;
          var box = stage3.querySelector(".settings-checkbox");
          if (box) box.hidden = ready;
          var btnRow = stage3.querySelector(".btn-pair");
          if (btnRow) btnRow.hidden = ready;
          if (ready) {
            var note = stage3.querySelector("[data-im-receive-note]");
            if (note) note.hidden = true;
          }
        }
        var stage4 = sub.querySelector("[data-im-stage4]");
        if (stage4) stage4.hidden = !connected;
      });
    }

    /* ===== 完成后连接概览（D1/PT-8）：三态分开表达 + 五分区 + 总开关新家 ===== */
    function imRenderOverview() {
      var ov = imPanel.querySelector("[data-im-overview]");
      if (!ov) return;
      var gf = imState.groupFlow;
      ov.hidden = !!gf.open || !imShowOverview;
      var mainFlow = imPanel.querySelector("#imFlow");
      if (mainFlow) mainFlow.hidden = !!gf.open || imShowOverview;
      if (!imShowOverview || gf.open) return;
      var d = imDerived;
      var s = imState;
      var badN = d.badTotal + (s.gateway.linkBroken ? 1 : 0);
      var trio = imPanel.querySelector("[data-im-ov-trio]");
      if (trio) {
        var conn =
          s.gateway.linkBroken
            ? { t: "服务断连", c: "bad" }
            : badN
              ? d.healthyTotal
                ? { t: "部分连接异常", c: "warn" }
                : { t: "连接异常", c: "bad" }
              : d.healthyTotal
                ? { t: "全部正常", c: "ok" }
                : { t: "还没有机器人", c: "idle" };
        trio.innerHTML =
          '<span class="' + (d.allDone ? "ok" : "") + '">配置完整 <b>' + (d.allDone ? "✓" : "未完成") + "</b></span>" +
          '<span class="' + conn.c + '">连接 <b>' + conn.t + "</b></span>" +
          '<span class="' + (s.test.confirmed ? "ok" : "") + '">测试 <b>' + (s.test.confirmed
            ? "已通过" + (s.test.channel ? " · " + ((IM_PLATFORMS.filter(function (p) { return p.key === s.test.channel; })[0] || {}).name || s.test.channel) : "") + "（你已确认）"
            : "未做") + "</b></span>";
      }
      var contBtn = imPanel.querySelector("[data-im-continue-setup]");
      if (contBtn) contBtn.hidden = d.allDone && !badN && !d.expired;
      var secs = imPanel.querySelector("[data-im-ov-sections]");
      if (!secs) return;
      var paused = d.paused;
      var pausedTag = paused ? " · 已暂停" : "";
      var connDot = function (state) {
        return paused ? "idle" : state === "ok" ? "ok" : state === "bad" ? "bad" : "pending";
      };
      var connText = function (c) {
        return c.state === "ok" ? "已连接" : c.state === "bad" ? "连接失败" : c.state === "connecting" ? "连接中" : "正在重连 · 第 " + (c.attempt || 1) + " 次";
      };
      var botRows = "";
      IM_PLATFORMS.forEach(function (p) {
        (s.connections[p.key] || []).forEach(function (c) {
          botRows +=
            '<div class="im-ov-row"><span aria-hidden="true" class="im-dot ' + connDot(c.state) + '"></span>' +
            '<span>' + c.app + " · " + p.name + "</span>" +
            '<span class="im-ov-note">' + connText(c) + (c.state === "ok" && c.note ? " · " + c.note : c.reason ? " · " + c.reason : "") + "</span></div>";
        });
      });
      var partialNote =
        d.badTotal && d.healthyTotal
          ? '<p class="im-fine">部分连接异常——故障连接可单独修复，其余不受影响。</p>'
          : "";
      var accountRows = s.bindings
        .map(function (b) {
          return '<div class="im-ov-row"><span aria-hidden="true" class="im-dot ok"></span><span>' + b.name + " · " + b.id +
            '</span><span class="im-ov-note">' + b.mode + " 模式" + (b.muted ? " · 已静音" : "") + "</span></div>";
        })
        .join("");
      var projectRows = s.projects
        .filter(function (pr) { return pr.checked; })
        .map(function (pr) {
          return '<div class="im-ov-row"><span aria-hidden="true" class="im-dot ' + (pr.expired ? "pending" : "ok") + '"></span><span>' + pr.id +
            '</span><span class="im-ov-note">' + IM_MODE_META[pr.mode].label + " · " + imScopeText(pr) +
            (pr.expired ? " · 已到期" : " · 有效期 30 天") + "</span></div>";
        })
        .join("") || '<div class="im-ov-row"><span class="im-ov-note">还没有授权项目</span></div>';
      var groupLine =
        gf.phase === "done"
          ? "已连接 " + gf.groups.length + " 个群"
          : gf.phase === "discover"
            ? "未设置"
            : "进行中";
      secs.innerHTML =
        '<div class="im-ov-section"><div class="im-ov-sec-title">消息服务' + pausedTag + "</div>" +
        '<div class="im-ov-row"><span aria-hidden="true" class="im-dot ' + (s.gateway.linkBroken ? "bad" : "ok") + '"></span>' +
        "<span>" + (s.gateway.team ? "团队服务 · " + s.gateway.team : "本机运行") + " · " + s.gateway.deviceId + "</span>" +
        '<label class="im-master"><span class="im-master-label">' + (s.masterOn ? "运行中" : "已暂停") + '</span>' +
        '<button aria-checked="' + s.masterOn + '" aria-label="暂停或恢复响应 IM 指令" class="switch' + (s.masterOn ? " on" : "") + '" data-im-ov-master="" role="switch" type="button"></button></label></div>' +
        '<p class="im-fine">团队配置与诊断在第 ① 步的高级区。</p></div>' +
        '<div class="im-ov-section"><div class="im-ov-sec-title">机器人' + pausedTag + "</div>" + partialNote +
        (botRows || '<div class="im-ov-row"><span class="im-ov-note">还没有机器人</span></div>') +
        '<div class="im-ov-row"><span class="sp"></span><button class="btn btn-ghost" data-im-ov-goto="channel" type="button">去管理</button></div></div>' +
        '<div class="im-ov-section"><div class="im-ov-sec-title">我的账号</div>' +
        (accountRows || '<div class="im-ov-row"><span class="im-ov-note">还没有绑定账号</span></div>') +
        (s.pairingRequests.length ? '<div class="im-ov-row"><span aria-hidden="true" class="im-dot pending"></span><span>' + s.pairingRequests.length + " 条绑定待确认</span></div>" : "") +
        '<div class="im-ov-row"><span class="sp"></span><button class="btn btn-ghost" data-im-ov-goto="channel" type="button">去处理</button></div></div>' +
        '<div class="im-ov-section"><div class="im-ov-sec-title">项目访问</div>' + projectRows +
        '<div class="im-ov-row"><span class="sp"></span><button class="btn btn-ghost" data-im-ov-goto="projects" type="button">编辑</button></div></div>' +
        '<div class="im-ov-section"><div class="im-ov-sec-title">群协作</div>' +
        '<div class="im-ov-row"><span class="im-ov-note">' + groupLine + "</span></div>" +
        '<div class="im-ov-row"><span class="sp"></span><button class="btn btn-ghost" data-im-open-group-flow="" type="button">设置群协作</button></div></div>';
      /* 动态渲染的 switch 需单独初始化（对齐 UI.toggle 运行时增强） */
      Array.prototype.forEach.call(secs.querySelectorAll(".switch"), function (sw) {
        if (window.ArtemisUI) window.ArtemisUI.toggle(sw);
      });
    }

    function imRefresh() {
      var recovery = imPanel.querySelector("[data-im-recovery]");
      if (recovery) recovery.hidden = !imState.gateway.linkBroken;
      var runtime = imPanel.querySelector("[data-im-runtime]");
      if (runtime) runtime.textContent = imState.gateway.team ? "团队服务 · " + imState.gateway.team : "本机自动运行（推荐）";
      imDerived = imDerive(imState);
      imRenderPill();
      imRenderCards();
      /* ① 空态 / 就绪态 + 启动瞬态 */
      imPanel.querySelector("[data-im-service-empty]").hidden = imState.gateway.started;
      imPanel.querySelector("[data-im-service-ready]").hidden = !imState.gateway.started;
      imRenderService();
      /* ② 渠道 tab + 平台面板信号灯与聚合文案（暂停时转 idle）+ 四子阶段 */
      imUpdatePlatformRows();
      imRenderSubstages();
      /* 等待卡与衔接行（按渠道） */
      imRenderWaitCard();
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-goto-projects]"),
        function (link) {
          link.hidden = imDerived.projectsDone;
        },
      );
      /* ③ 引导（勾选前显示，勾过即让位） */
      var projGuide = imPanel.querySelector("[data-im-projects-guide]");
      if (projGuide) {
        projGuide.hidden = imState.projects.some(function (pr) { return pr.checked; });
      }
      /* ③ 行内即时生效：无保存按钮；仅保留部分成功条（启用失败） */
      var partialBar = imPanel.querySelector("[data-im-grant-partial]");
      if (partialBar) partialBar.hidden = !imState.grantEnableFailed;
      /* ②尾顺手验证 + ③尾完成仪式 + 群协作第二流程 + 完成后概览 */
      imRenderTest();
      imRenderCeremony();
      imRenderGroupFlow();
      imRenderOverview();
      /* D1：首次流程无总开关。设置进度 N/3 + 配对五态行（按渠道）+ ②尾验证/③尾完成仪式 */
      var progEl = imPanel.querySelector("[data-im-progress]");
      if (progEl)
        progEl.innerHTML = "设置进度 <b>" + imDerived.progressDone + "</b>/" + IM_STEP_TOTAL;
      imRenderPairPhase();
    }

    /* 配对五态（按渠道）：未生成 → 等待你发送 → 收到账号请求 → 待本人确认 → 已绑定 */
    function imPairPhase(pk) {
      var reqs = imState.pairingRequests.filter(function (r) { return r.platform === pk; });
      if (reqs.length)
        return imState.sim.requestFresh ? "收到账号请求" : "待本人确认";
      var st = imDerived.platforms[pk];
      if (!st || st.ok === 0) return "未生成";
      if (imState.bindings.some(function (b) { return b.platform === pk; })) return "已绑定";
      return "等待你发送";
    }
    function imRenderPairPhase() {
      Array.prototype.forEach.call(
        imPanel.querySelectorAll("[data-im-pair-phase]"),
        function (el) {
          var sub = el.closest("[data-im-subcard]");
          var pk = sub ? sub.getAttribute("data-im-subcard") : "";
          var st = imDerived.platforms[pk];
          var hasBot = st && st.ok > 0;
          el.hidden = !hasBot;
          if (hasBot) el.innerHTML = "当前状态：<b>" + imPairPhase(pk) + "</b>";
        },
      );
    }

    /* 通用 200ms 淡入（绑定行/请求卡共用） */
    function imFadeIn(el) {
      el.classList.add("im-enter");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.classList.add("im-enter-on"); });
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
      imRefresh();
    }

    function imApplyDemo(key) {
      if (!Object.hasOwn(IM_SEEDS, key)) key = "empty";
      imEpoch += 1; /* 作废在途的启动/连接/群确认定时器（防串态） */
      imState = JSON.parse(JSON.stringify(IM_SEEDS[key]));
      imManual = {};
      imPanel.querySelectorAll("#imTeamForm input").forEach(function (input) { input.value = ""; });
      imPanel.querySelectorAll("[data-im-team-result], [data-im-diagnostic-result]").forEach(function (el) { el.hidden = true; });
      var failureToggle = imPanel.querySelector("[data-im-save-failure]"); if (failureToggle) failureToggle.setAttribute("aria-pressed", "false");
      var enableToggle = imPanel.querySelector("[data-im-enable-failure]"); if (enableToggle) enableToggle.setAttribute("aria-pressed", "false");
      /* IM DEMO CONSOLE —— 结果选择器回到成功默认，与快照状态一致（迁移生产代码时删除本段） */
      imPanel.querySelectorAll("[data-im-service-outcome], [data-im-cred-outcome]").forEach(function (sel) { sel.value = "ok"; });
      imSecondsLeft = 5 * 60;
      imCodeExpired = false;
      imRenderAll();
      /* 三步全✓时自动进入概览：再次打开不重跑流程 */
      imShowOverview = !!(imDerived && imDerived.allDone);
      imRefresh();
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
      imShowOverview = false; /* 定位目标在设置步骤内：先退出概览 */
      imRefresh();
      imManual[key] = true;
      imRenderCards();
      var card = imCardEls[key];
      var head = card.querySelector("[data-im-card-head]");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          head.scrollIntoView({ block: "center", behavior: "smooth" });
          if (opts.pulse !== false) imPulse(opts.pulse || card);
          if (opts.focus !== false) {
            setTimeout(function () { head.focus(); }, 400);
          }
        });
      });
    }
    /* 自动推进：只做展开+smooth 滚动到视口中央；仅当触发动作前焦点在刚完成的卡体内，
       滚动后 +400ms 把焦点移到新卡卡头（鼠标用户不被抢焦点；不脉冲） */
    function imAdvanceTo(key) {
      var active = document.activeElement;
      var prevCard =
        active && active.closest ? active.closest(".im-card") : null;
      imLocateCard(key, { focus: false, pulse: false });
      if (prevCard && prevCard !== imCardEls[key]) {
        setTimeout(function () {
          var head = imCardEls[key].querySelector("[data-im-card-head]");
          if (head) head.focus();
        }, 400);
      }
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
      imLocateCard("channel");
    });

    /* ① 一键开启（G1：1000ms 启动过渡；失败分支=确定性演示结果，失败留在本步可重试） */
    imPanel.querySelector("[data-im-service-start]").addEventListener("click", function () {
      if (imState.gateway.starting || imState.gateway.started) return;
      imState.sim.session = true;
      delete imState.gateway.startError;
      imState.gateway.starting = true;
      imRefresh();
      var epoch = imEpoch;
      setTimeout(function () {
        if (epoch !== imEpoch) return;
        imState.gateway.starting = false;
        var outcome = (imState.sim && imState.sim.serviceOutcome) || "ok";
        if (outcome === "ok") {
          imState.gateway.started = true;
          imState.masterOn = true;
          imRefresh();
          notice("消息服务已在本机开启（演示）");
          imAdvanceTo("channel"); /* ②自动展开●（不抢鼠标用户焦点） */
        } else {
          imState.gateway.startError =
            outcome === "port"
              ? "启动失败：端口被其他程序占用。关闭占用程序后重试，或改用团队服务器。"
              : "注册失败：无法生成设备编号。请重试；多次失败可改用团队服务器。";
          imRefresh();
          notice("启动失败（演示）", true);
        }
      }, IM_T_START);
    });

    /* ② 平台行操作与 M2b 凭据子卡（swap / cancel / save 三态流）；
       重新输入密钥 = 已配置平台也直接进表单并聚焦密钥格 */
    function imOpenSubcard(platformKey, focusSecret) {
      var row = imPanel.querySelector('[data-im-platform="' + platformKey + '"]');
      var sub = row.querySelector("[data-im-subcard]");
      var st = imDerived.platforms[platformKey];
      var configured = st.conns.length > 0;
      /* 团队态：未配置平台优先呈现团队机器人列表（选用即连），跳过凭据表单 */
      var team = !!imState.gateway.team && !configured && !focusSecret;
      var showForm = (!configured || focusSecret) && !team;
      sub.hidden = false;
      var teamBox = sub.querySelector("[data-im-team-bots]");
      if (teamBox) teamBox.hidden = !team;
      sub.querySelector("[data-im-cred-saved]").hidden = !(configured && !focusSecret && !team);
      sub.querySelector("[data-im-cred-form]").hidden = !showForm;
      if (showForm) {
        var first = sub.querySelector(
          focusSecret ? 'input[type="password"]' : "input, select",
        );
        if (first) first.focus();
      }
    }
    function imCloseSubcard(platformKey) {
      var row = imPanel.querySelector('[data-im-platform="' + platformKey + '"]');
      var sub = row.querySelector("[data-im-subcard]");
      sub.hidden = true;
      var form = sub.querySelector("[data-im-cred-form]");
      /* 折叠保留本次页面中的草稿。 */
    }
    /* 接收方式：长连接隐藏 HTTPS 专属字段与转发地址；
       HTTPS 专属字段的帮助小字在该模式下常驻显示 */
    function imApplyReceiveMode(scope) {
      var select = scope.querySelector("[data-im-receive-mode]");
      if (!select) return;
      var sub = scope.closest(".im-platform-row");
      var platformKey = sub ? sub.getAttribute("data-im-platform") : "";
      var https = select.value === "https";
      Array.prototype.forEach.call(
        scope.querySelectorAll("[data-im-https-only]"),
        function (el) {
          el.hidden = !https;
          if (!el.hasAttribute("data-im-field-label")) return;
          var rule = imFieldRule(platformKey, el.getAttribute("data-im-field-label"));
          if (rule && rule.httpsHelp && https) {
            imShowFieldMessage(el, rule.httpsHelp, false);
          } else {
            imHideFieldMessage(el);
          }
        },
      );
    }
    imPanel.addEventListener("change", function (ev) {
      var select = ev.target.closest("[data-im-receive-mode]");
      if (select) imApplyReceiveMode(select.closest("[data-im-cred-form]"));
      /* 演示结果选择器（确定性，不随机） */
      /* IM DEMO CONSOLE —— 原型模拟接线（迁移生产代码时删除本段） */
      var credOutcome = ev.target.closest("[data-im-cred-outcome]");
      if (credOutcome && imState.sim)
        imState.sim.credOutcome[credOutcome.getAttribute("data-im-cred-outcome")] = credOutcome.value;
      /* ① 启动演示结果（成功 / 端口被占用 / 注册失败） */
      var svcOutcome = ev.target.closest("[data-im-service-outcome]");
      if (svcOutcome && imState.sim) imState.sim.serviceOutcome = svcOutcome.value;
      /* ② 阶段3：勾选「我已在平台完成接收设置」→ 解锁继续按钮 + 显示验证说明 */
      var ready3 = ev.target.closest("[data-im-receive-ready]");
      if (ready3) {
        var sub3 = ready3.closest("[data-im-subcard]");
        var btn3 = sub3.querySelector("[data-im-receive-done]");
        if (btn3) btn3.disabled = !ready3.checked;
        var note3 = sub3.querySelector("[data-im-receive-note]");
        if (note3) note3.hidden = !ready3.checked;
      }
    });
    /* 字段帮助：聚焦显示帮助小字；blur 非空校验前缀；输入即清错；
       已显示的错误优先于帮助（不被聚焦覆盖） */
    imPanel.addEventListener("focusin", function (ev) {
      var labelEl = ev.target.closest("[data-im-field-label]");
      if (!labelEl || !labelEl.closest("[data-im-cred-form]")) return;
      var helpEl = imFieldHelpEl(labelEl);
      if (helpEl && helpEl.classList.contains("im-field-error")) return;
      var sub = labelEl.closest(".im-platform-row");
      var rule = imFieldRule(
        sub ? sub.getAttribute("data-im-platform") : "",
        labelEl.getAttribute("data-im-field-label"),
      );
      var isHttpsOnly = labelEl.hasAttribute("data-im-https-only");
      var httpsOn =
        !isHttpsOnly ||
        (labelEl.closest("[data-im-cred-form]").querySelector("[data-im-receive-mode]") || {}).value === "https";
      if (rule && rule.help && !isHttpsOnly) imShowFieldMessage(labelEl, rule.help, false);
      else if (rule && rule.httpsHelp && isHttpsOnly && httpsOn)
        imShowFieldMessage(labelEl, rule.httpsHelp, false);
      else if (rule && rule.help && isHttpsOnly && !httpsOn)
        imShowFieldMessage(labelEl, rule.help, false);
    });
    imPanel.addEventListener("focusout", function (ev) {
      var labelEl = ev.target.closest("[data-im-field-label]");
      if (!labelEl || !labelEl.closest("[data-im-cred-form]")) return;
      var sub = labelEl.closest(".im-platform-row");
      var value = (ev.target.value || "").trim();
      if (!value) {
        /* 空值不催错（必填错误只在提交时统一校验）；https 常驻帮助保留 */
        var rule0 = imFieldRule(
          sub ? sub.getAttribute("data-im-platform") : "",
          labelEl.getAttribute("data-im-field-label"),
        );
        if (!(rule0 && rule0.httpsHelp && !labelEl.hidden)) imHideFieldMessage(labelEl);
        return;
      }
      var error = imValidateField(sub ? sub.getAttribute("data-im-platform") : "", labelEl);
      if (error) imShowFieldMessage(labelEl, error, true);
    });
    imPanel.addEventListener("input", function (ev) {
      var labelEl = ev.target.closest("[data-im-field-label]");
      if (!labelEl || !labelEl.closest("[data-im-cred-form]")) return;
      var help = imFieldHelpEl(labelEl);
      if (help && help.classList.contains("im-field-error")) imHideFieldMessage(labelEl);
    });
    /* 提交前整表校验：错误大白话 + 聚焦第一个错误格；全过才进连接过渡 */
    function imValidateForm(form) {
      var sub = form.closest(".im-platform-row");
      var platformKey = sub ? sub.getAttribute("data-im-platform") : "";
      var firstBad = null;
      Array.prototype.forEach.call(
        form.querySelectorAll("[data-im-field-label]"),
        function (labelEl) {
          if (labelEl.hidden) return; /* HTTPS 专属字段长连接下不参与 */
          var error = imValidateField(platformKey, labelEl);
          if (error) {
            imShowFieldMessage(labelEl, error, true);
            if (!firstBad) firstBad = labelEl.querySelector("input, select");
          } else {
            imHideFieldMessage(labelEl);
          }
        },
      );
      if (firstBad) {
        var advanced = firstBad.closest("details"); if (advanced) advanced.open = true;
        firstBad.focus();
        return false;
      }
      return true;
    }

    imPanel.addEventListener("click", function (ev) {
      var platformRow = ev.target.closest(".im-platform-row");
      var key = platformRow && platformRow.getAttribute("data-im-platform");
      /* 删除连接：级联回退（该平台绑定与待确认请求一并移除，完成链重算）+ 一次性提示 */
      var del = ev.target.closest("[data-im-conn-delete]");
      if (del && key) {
        var delName = (IM_PLATFORMS.filter(function (p) { return p.key === key; })[0] || {}).name || key;
        imConfirm("删除连接", "将删除「" + delName + "」的机器人连接，并解除该平台已绑定账号与待确认请求。", function () {
          imState.connections[key] = [];
          imState.pairingRequests = imState.pairingRequests.filter(function (r) { return r.platform !== key; });
          var removed = imState.bindings.filter(function (b) { return b.platform === key; }).length;
          imState.bindings = imState.bindings.filter(function (b) { return b.platform !== key; });
          imState.sim.session = true;
          imBuildPlatformRows();
          imUpdatePlatformRows();
          imBuildPairingRequests();
          imBuildBindings();
          imBuildInstructions();
          imRefresh();
          notice(removed ? "已删除连接；相关绑定与后续步骤状态已回退（演示）" : "已删除连接（演示）");
        }, { danger: true });
        return;
      }
      if (ev.target.closest("[data-im-manage]")) {
        var sub = platformRow.querySelector("[data-im-subcard]");
        imOpenSubcard(key, false);
        return;
      }
      if (ev.target.closest("[data-im-add]")) {
        imOpenSubcard(key, false);
        return;
      }
      /* 团队态：选用团队机器人（直接建立连接，接收设置由团队管理员维护） */
      if (ev.target.closest("[data-im-team-pick]")) {
        imState.sim.session = true;
        var pickId =
          "conn-" +
          (IM_PLATFORMS.reduce(function (n, p) {
            return n + ((imState.connections[p.key] || []).length);
          }, 0) + 1);
        imState.connections[key] = [
          { conn: pickId, app: "Artemis 团队机器人", state: "ok", note: "已连接 · 刚刚" },
        ];
        imState.platformReady[key] = true;
        imBuildPlatformRows();
        imUpdatePlatformRows();
        imBuildInstructions();
        imRefresh();
        notice("已选用团队机器人。收发将在配对时验证。");
        return;
      }
      /* 团队态次级路径：改用自己的凭据 */
      if (ev.target.closest("[data-im-team-custom]")) {
        var subC = platformRow.querySelector("[data-im-subcard]");
        subC.querySelector("[data-im-team-bots]").hidden = true;
        var formC = subC.querySelector("[data-im-cred-form]");
        formC.hidden = false;
        var firstC = formC.querySelector("input, select");
        if (firstC) firstC.focus();
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
        /* 取消收起表单，草稿保留；重置演示时统一清空。 */
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
        if (save.disabled) return;
        var form4 = ev.target.closest("[data-im-cred-form]");
        var sub4 = form4.closest("[data-im-subcard]");
        var rowKey = sub4.closest(".im-platform-row").getAttribute("data-im-platform");
        if (!imValidateForm(form4)) return; /* 错误大白话，聚焦首错 */
        if (!imState.gateway.started || imState.gateway.linkBroken) { notice("消息服务未连接，请先恢复服务。", true); return; }
        var receive = form4.querySelector("[data-im-receive-mode]");
        if (receive && receive.value === "https" && !imState.gateway.team) { notice("HTTPS 回调需要公网团队服务，请先在高级设置注册。", true); return; }
        var selectedOutcome = imState.sim.credOutcome[rowKey];
        var isNew = (imState.connections[rowKey] || []).length === 0;
        imState.sim.session = true;
        /* 900ms 连接过渡：保存钮禁用「正在连接…」+帮助行；平台行 ◐ 连接中 */
        save.disabled = true;
        save.textContent = "正在连接…";
        form4.setAttribute("aria-busy", "true");
        form4.querySelectorAll("input, select, button").forEach(function (el) { el.disabled = true; });
        var help4 = form4.querySelector("[data-im-connect-help]");
        if (help4) help4.hidden = false;
        var connId =
          "conn-" +
          (IM_PLATFORMS.reduce(function (n, p) {
            return n + ((imState.connections[p.key] || []).length);
          }, 0) + 1);
        if (isNew) {
          imState.connections[rowKey] = [
            { conn: connId, app: "Artemis 机器人", state: "connecting" },
          ];
        } else {
          imState.connections[rowKey].forEach(function (c) {
            c.state = "connecting";
          });
        }
        imRefresh();
        var epoch = imEpoch;
        setTimeout(function () {
          if (epoch !== imEpoch) return;
          var outcome = selectedOutcome;
          form4.removeAttribute("aria-busy");
          form4.querySelectorAll("input, select, button").forEach(function (el) { el.disabled = false; });
          var conns = imState.connections[rowKey] || [];
          if (outcome === "ok") {
            conns.forEach(function (c) {
              c.state = "ok";
              c.note = "已连接 · 刚刚";
              delete c.reason;
            });
            form4.reset();
            imApplyReceiveMode(form4);
            form4.hidden = true;
            sub4.querySelector("[data-im-cred-saved]").hidden = false;
            imRefresh();
            imBuildInstructions(); /* ③ 指令区随首个健康连接重建 */
            notice(
              isNew
                ? "机器人连上了。继续绑定你的账号。"
                : "已保存，机器人正在用新密钥重新连接（演示）",
            );
            if (isNew) { /* 同卡衔接：切到该渠道并脉冲「绑定我的账号」子阶段 */ imChannelSel = rowKey; imSyncChannelPanels(); var s4 = imPanel.querySelector('[data-im-subcard="' + rowKey + '"] [data-im-stage4]'); if (s4) { s4.scrollIntoView({ block: "nearest", behavior: "smooth" }); imPulse(s4); } }
          } else {
            /* 失败（确定性演示结果）：行内原因 + 现有失败 UI；表单保留可直接重试 */
            var secretName =
              rowKey === "wecom" ? "Secret" : rowKey === "slack" ? "Bot Token" : "App Secret";
            conns.forEach(function (c) {
              if (c.state !== "ok") {
                c.state = "bad";
                c.reason =
                  outcome === "offline" ? "网络中断。检查网络后重试，已保留输入。" : outcome === "permission" ? "平台权限不足。补齐权限、发布并安装应用后重试。" : outcome === "mismatch" ? "连接握手失败：Bot Token 与 App-Level Token 属于不同应用。两个令牌必须来自同一应用（保存时不校验，连接时才发现）。" : secretName + " 已失效或不匹配。重新复制后重试，已保留输入。";
              }
            });
            save.disabled = false;
            save.textContent = "保存并重连";
            if (help4) help4.hidden = true;
            imRefresh();
          }
        }, IM_T_CONNECT);
        return;
      }
      /* 复制类按钮反馈（转发地址）与 chips 复制 */
      var copy = ev.target.closest("[data-copy]");
      if (copy) {
        imCopy(copy.parentElement.querySelector("code").textContent);
        var original = copy.textContent;
        copy.textContent = "已复制";
        setTimeout(function () {
          copy.textContent = original;
        }, 1400);
        return;
      }
      var chip = ev.target.closest(".im-chip");
      if (chip && chip.contains(ev.target)) {
        imCopy(chip.querySelector("code").textContent);
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

    /* ③ 配对请求：批准=落绑定（G3）+绑定行淡入+④自动展开；拒绝=淡出+焦点回复制钮 */
    imPanel.addEventListener("click", function (ev) {
      var approve = ev.target.closest("[data-im-approve]");
      var reject = ev.target.closest("[data-im-reject]");
      if (!approve && !reject) return;
      var cardEl = (approve || reject).closest("[data-im-pairing-idx]");
      var idx = Number(cardEl.getAttribute("data-im-pairing-idx"));
      var req = imState.pairingRequests[idx];
      if (!req) return;
      imState.sim.session = true;
      if (approve) {
        imState.pairingRequests.splice(idx, 1);
        imState.bindings.push({
          name: req.id === "u_me01" ? "我（nicky）" : req.name,
          id: req.id,
          platform: req.platform,
          mode: "Plan",
          muted: false,
        });
        imBuildPairingRequests();
        imBuildBindings();
        imRefresh();
        var newRow = imPanel.querySelector(
          '[data-im-bindings] [data-im-binding-idx="' + (imState.bindings.length - 1) + '"]',
        );
        if (newRow) imFadeIn(newRow);
        /* 首绑自动展开②尾「顺手验证」段（用户动过折叠后不再抢开）；否则按链推进③ */
        if (!imState.sim.verifyTouched) {
          imState.sim.verifyOpened = true;
          imRefresh();
          var vBody = imPanel.querySelector("[data-im-verify]");
          if (vBody) {
            vBody.scrollIntoView({ block: "center", behavior: "smooth" });
            imPulse(vBody);
          }
          notice("已绑定。可以顺手发条测试消息，也可以去 ③ 选项目。");
        } else {
          imRefresh();
          imAdvanceTo("projects"); /* ③自动展开 */
          notice("已绑定。机器人以后只认这个账号。");
        }
      } else {
        var platformKey2 = req.platform;
        imState.pairingRequests.splice(idx, 1);
        cardEl.classList.add("im-card-leaving");
        var epoch = imEpoch;
        setTimeout(function () {
          if (epoch !== imEpoch) return;
          imBuildPairingRequests();
          imRefresh();
          notice("已拒绝。配对码还在有效期，重新发送即可。");
          /* 焦点回到该平台的复制指令按钮 */
          var copyBtn = imPanel.querySelector(
            '[data-im-instr-platform="' + platformKey2 + '"] [data-copy-pair]',
          ) || imPanel.querySelector("[data-copy-pair]");
          if (copyBtn) copyBtn.focus();
        }, IM_T_FADE);
      }
    });
    /* ② 阶段3「已完成平台设置，继续」：用户确认落 platformReady（不伪装系统检测） */
    imPanel.addEventListener("click", function (ev) {
      var done3 = ev.target.closest("[data-im-receive-done]");
      if (!done3 || done3.disabled) return;
      var pk = done3.closest("[data-im-subcard]").getAttribute("data-im-subcard");
      imState.platformReady[pk] = true;
      imState.sim.session = true;
      imRefresh();
      notice("已确认。收发将在配对时验证。");
    });

    /* ③ 双轨：演示直达（幂等，pairWait 判空） */
    imPanel.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-im-pair-arrive]")) imArrivePairing();
    });
    /* 配对码：[换一个] 重置倒计时并换新码 */
    imPanel.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-im-renew-code]")) imRenewCode();
    });

    /* 衔接行（按渠道实例化，委托处理）：定位③（展开+滚动+脉冲+焦点） */
    imPanel.addEventListener("click", function (ev) {
      if (!ev.target.closest("[data-im-goto-projects]")) return;
      imLocateCard("projects");
    });

    /* ③ 悬停「设为默认」：徽章切换走行内即时生效（生产对齐） */
    imPanel.addEventListener("click", function (ev) {
      var setDef = ev.target.closest("[data-im-set-default]");
      if (!setDef) return;
      var li = setDef.closest("[data-im-project-idx]");
      var pr = imState.projects[Number(li.getAttribute("data-im-project-idx"))];
      imState.sim.session = true;
      imApplyGrant(
        function () { imState.defaultProject = pr.id; },
        pr.id,
      );
    });
    /* 部分成功：仅重试启用（不重复保存） */
    imPanel.querySelector("[data-im-retry-enable]").addEventListener("click", function () {
      if (imState.sim.enableFailure) {
        notice("启用仍失败：服务暂不可用（演示）。", true);
        return;
      }
      imState.grantEnabled = true;
      imState.grantEnableFailed = false;
      imRefresh();
      notice("连接已启用（演示）");
    });
    /* ③ 到期行 [去授权] / 行内 [授权配置]：打开授权配置弹窗（草稿=当前授权快照） */
    imPanel.addEventListener("click", function (ev) {
      var reauth = ev.target.closest("[data-im-reauthorize]");
      var configBtn = ev.target.closest("[data-im-grant-config]");
      if (!reauth && !configBtn) return;
      var li = (reauth || configBtn).closest("[data-im-project-idx]");
      imOpenGrantDialog(Number(li.getAttribute("data-im-project-idx")));
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
        confirmBar.querySelector("[data-im-keep]").focus();
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
          if (!next) next = imCardEls.channel.querySelector("[data-im-card-head]");
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
      /* 顺手验证段被用户手动开合 → 本次会话记住，不再自动展开/收起 */
      if (fold.hasAttribute("data-im-verify-toggle")) {
        imState.sim.verifyTouched = true;
        imState.sim.verifyOpened = open;
      }
    });

    /* ⑤ 测试任务轨道：复制 / 推进 / 模型失败支线 / 确认与撤销（D4 诚实版：只标记用户确认） */
    imPanel.addEventListener("click", function (ev) {
      var t = imState.test;
      if (!t) return;
      var copyNew = ev.target.closest("[data-im-copy-new]");
      if (copyNew) {
        imCopy(copyNew.closest(".im-instr-line").querySelector("code").textContent);
        var original = copyNew.textContent;
        copyNew.textContent = "已复制";
        setTimeout(function () { copyNew.textContent = original; }, 1400);
        return;
      }
      if (ev.target.closest("[data-im-test-advance]")) {
        imState.sim.session = true;
        if (!t.channel) t.channel = imTestChannel(); /* 开测即归属渠道 */
        if (t.stage < 4) t.stage += 1;
        imRefresh();
        return;
      }
      if (ev.target.closest("[data-im-test-fail]")) {
        t.failed = true;
        imRefresh();
        return;
      }
      if (ev.target.closest("[data-im-test-retry]")) {
        t.failed = false;
        t.stage = 3;
        imRefresh();
        notice("任务重试成功（演示）");
        return;
      }
      if (ev.target.closest("[data-im-test-confirm-btn]")) {
        imState.sim.session = true;
        if (!t.channel) t.channel = imTestChannel();
        t.confirmed = true;
        imRefresh();
        notice("你已确认收到回复，该渠道全链路走通。");
        return;
      }
      if (ev.target.closest("[data-im-verify-now]")) {
        /* 完成仪式「发测试消息验证」：定位②并展开验证段 */
        imLocateCard("channel", { focus: false });
        imState.sim.verifyTouched = true;
        imState.sim.verifyOpened = true;
        imRefresh();
        var vSec = imPanel.querySelector("[data-im-verify]");
        if (vSec) setTimeout(function () { vSec.scrollIntoView({ block: "center", behavior: "smooth" }); }, 300);
        return;
      }
      if (ev.target.closest("[data-im-test-undo]")) {
        t.confirmed = false;
        t.channel = "";
        imRefresh();
        return;
      }
      if (ev.target.closest("[data-im-finish]")) {
        var closeBtn = $("#settingsClose");
        if (closeBtn) closeBtn.click();
        notice("开始使用！随时回到这里调整。");
        return;
      }
      if (ev.target.closest("[data-im-open-group-flow]")) {
        imState.groupFlow.open = true;
        imRefresh();
        var scroller2 = $(".settings-content");
        if (scroller2) scroller2.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    /* 群协作第二流程（PT-7）：发现 → 保存空间（重置确认）→ 按群确认 → 各自授权 */
    imPanel.addEventListener("click", function (ev) {
      var gf = imState.groupFlow;
      if (!gf) return;
      if (ev.target.closest("[data-im-group-back]") && gf.open) {
        gf.open = false;
        imRefresh(); /* 统一经 refresh：正确衔接概览与设置步骤的显隐 */
        return;
      }
      if (ev.target.closest("[data-im-gf-find]")) {
        if (gf.phase !== "discover") return;
        imState.sim.session = true;
        var firstHealthy = IM_PLATFORMS.filter(function (p) {
          return imDerived.platforms[p.key].ok > 0;
        })[0];
        gf.groups = [
          { name: "artemis-ui-评审群", platform: firstHealthy ? firstHealthy.key : "feishu", members: 5, confirmed: false },
        ];
        gf.phase = "select";
        imRefresh();
        return;
      }
      if (ev.target.closest("[data-im-gf-save]")) {
        gf.spaceSaved = true;
        gf.groups.forEach(function (g) { g.confirmed = false; });
        gf.phase = "confirm";
        imRefresh();
        return;
      }
      var confirmBtn = ev.target.closest("[data-im-gf-confirm]");
      if (confirmBtn) {
        gf.groups[Number(confirmBtn.getAttribute("data-im-gf-confirm"))].confirmed = true;
        if (gf.groups.every(function (g) { return g.confirmed; })) gf.phase = "grant";
        imRefresh();
        return;
      }
      if (ev.target.closest("[data-im-gf-resave]")) {
        gf.spaceSaved = false;
        gf.groups.forEach(function (g) { g.confirmed = false; });
        gf.phase = "select";
        imRefresh();
        notice("已重新编辑空间；保存后全部群确认会重置（演示）");
        return;
      }
      if (ev.target.closest("[data-im-gf-grant]")) {
        gf.phase = "done";
        imRefresh();
        notice("群协作已就绪（演示）");
      }
    });

    /* 完成后概览交互：总开关（暂停/恢复）/进入/返回/继续设置/分区跳转 */
    imPanel.addEventListener("click", function (ev) {
      var master2 = ev.target.closest("[data-im-ov-master]");
      if (master2) {
        imState.masterOn = master2.classList.contains("on");
        imRefresh();
        notice(imState.masterOn ? "已恢复响应 IM 指令（演示）" : "已暂停响应 IM 指令，配置保留（演示）");
        return;
      }
      if (ev.target.closest("[data-im-view-overview]")) {
        imShowOverview = true;
        imRefresh();
        var scroller3 = $(".settings-content");
        if (scroller3) scroller3.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (ev.target.closest("[data-im-back-setup]")) {
        imShowOverview = false;
        imRefresh();
        return;
      }
      var cont2 = ev.target.closest("[data-im-continue-setup]");
      if (cont2) {
        imShowOverview = false;
        imRefresh();
        var target2 = imDerived.firstUndone || (imDerived.expired ? "projects" : "channel");
        imLocateCard(target2);
        return;
      }
      var goto2 = ev.target.closest("[data-im-ov-goto]");
      if (goto2) {
        imShowOverview = false;
        imRefresh();
        imLocateCard(goto2.getAttribute("data-im-ov-goto"));
      }
    });

    /* 重置入口：从头再来一遍（回到 empty 快照，滚回面板顶，焦点落①卡头） */
    imPanel.querySelector("[data-im-sim-reset]").addEventListener("click", function () {
      imConfirm("重新开始设置", "清空本次演示的配置和未保存输入。实际服务不受影响。", function () { imApplyDemo("empty"); notice("已回到初始状态（演示）"); });
      var scroller = $(".settings-content");
      if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(function () {
        var head = imCardEls.service.querySelector("[data-im-card-head]");
        if (head) head.focus();
      }, 250);
    });

    /* 配对码倒计时（tabular-nums；元素随指令区重建，逐 tick 查询）；
       到期变「已过期 · [换一个]」，点击重置倒计时并换新码；
       ③ 双轨等待 10s 归零 → 确认自动到达（幂等） */
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
      var wait = imState && imState.sim && imState.sim.pairWait;
      if (wait) {
        wait.leftMs -= 1000;
        if (wait.leftMs <= 0) {
          imArrivePairing();
        } else {
          var waitEl = imPanel.querySelector("[data-im-wait-countdown]");
          if (waitEl) waitEl.textContent = imPairWaitText();
        }
      }
    }
    var imTimer = setInterval(imTick, 1000);

    /* 渠道 tab 吸顶：tab 条贴住滚动容器顶缘时加投影（仅可见时判定） */
    (function () {
      var strip = imPanel.querySelector(".im-channel-tabs");
      var scroller = $(".settings-content");
      if (!strip || !scroller) return;
      function update() {
        if (strip.offsetParent === null) return; /* ②折叠或不在面板内：不判定 */
        /* 停靠线 = padding-top + 条的 top（Chromium sticky 参照滚动容器 content box 顶，
           top 为 -padding-top 时停靠线=0=裁剪线）；+1px 容差 */
        var padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
        var stickTop = parseFloat(getComputedStyle(strip).top) || 0;
        var dockLine = padTop + stickTop;
        var stuck =
          strip.getBoundingClientRect().top - scroller.getBoundingClientRect().top <= dockLine + 1;
        strip.classList.toggle("stuck", stuck);
      }
      scroller.addEventListener("scroll", update, { passive: true });
    })();

    /* hash 直达桥（#im-demo=empty|progress|alert）、定位桥与幂等态 setter；
       无 hash 时默认未配置（empty），打开面板即处于可操作的从头模拟起点 */
    /* Settings simulation shares buttons, icons, dialog and toast with the workspace. */
    var imConfirmEl = document.createElement("dialog");
    imConfirmEl.className = "prototype-dialog im-confirm-dialog";
    imConfirmEl.setAttribute("aria-labelledby", "im-confirm-title");
    imConfirmEl.innerHTML = '<h3 id="im-confirm-title"></h3><p id="im-confirm-description"></p><div class="btn-pair"></div>';
    var imCancelButton = UI.button({ label: "取消", variant: "ghost" });
    imCancelButton.setAttribute("data-im-confirm-cancel", "");
    var imSaveButton = UI.button({ label: "确认保存", variant: "primary" });
    imSaveButton.setAttribute("data-im-confirm-ok", "");
    imConfirmEl.querySelector(".btn-pair").append(imCancelButton, imSaveButton);
    imConfirmEl.setAttribute("aria-describedby", "im-confirm-description");
    document.body.appendChild(imConfirmEl);
    var imConfirmController = UI.dialog(imConfirmEl, { initialFocus: imConfirmEl.querySelector("[data-im-confirm-cancel]") });
    var imConfirmAction;
    function imConfirm(title, description, action, options) {
      imConfirmEl.querySelector("h3").textContent = title;
      imConfirmEl.querySelector("p").textContent = description;
      imSaveButton.dataset.variant = options && options.danger ? "danger" : "primary";
      imConfirmAction = action;
      imConfirmController.open(document.activeElement);
    }
    imConfirmEl.querySelector("[data-im-confirm-cancel]").onclick = function () { imConfirmController.close(); imConfirmAction = null; };
    imConfirmEl.querySelector("[data-im-confirm-ok]").onclick = function () { var action = imConfirmAction; imConfirmAction = null; imConfirmController.close(); if (action) action(); };

    /* ③ 授权配置弹窗（生产对齐：草稿=当前授权快照；关闭=回退，确认设置=行内即时生效）。
       挂在 imPanel 内，让 mode/scope/permission 的委托监听器直接作用于弹窗草稿。 */
    var imGrantDialogEl = document.createElement("dialog");
    imGrantDialogEl.className = "prototype-dialog im-grant-dialog";
    imGrantDialogEl.setAttribute("aria-labelledby", "im-grant-title");
    imGrantDialogEl.innerHTML =
      '<h3 id="im-grant-title"></h3>' +
      '<div class="im-grant-dialog-scroll" data-im-grant-body=""></div>' +
      '<p class="im-fine im-grant-dialog-error" data-im-grant-dialog-error="" hidden="" role="alert"></p>' +
      '<div class="btn-pair"></div>';
    imPanel.appendChild(imGrantDialogEl);
    var imGrantIdx = -1;
    var imGrantSnapshot = null;
    var imGrantConfirmed = false;
    var imGrantController = UI.dialog(imGrantDialogEl, {
      initialFocus: null,
      onClose: function () {
        /* 未确认的任何关闭（按钮/Esc/点外）= 放弃草稿，回退授权快照 */
        if (!imGrantConfirmed && imGrantSnapshot && imState.projects[imGrantIdx]) {
          imState.projects[imGrantIdx] = imGrantSnapshot;
          imState.sim.projectsDirty = false;
          imBuildProjects();
          imRefresh();
        }
        imGrantConfirmed = false;
      },
    });
    function imOpenGrantDialog(idx) {
      var pr = imState.projects[idx];
      if (!pr) return;
      imGrantIdx = idx;
      imGrantConfirmed = false;
      imGrantSnapshot = JSON.parse(JSON.stringify(pr));
      imState.sim.session = true;
      imGrantDialogEl.querySelector("h3").textContent = "授权配置 · " + pr.id;
      var body = imGrantDialogEl.querySelector("[data-im-grant-body]");
      body.setAttribute("data-im-project-idx", String(idx));
      body.innerHTML = imGrantBodyTemplate(pr, idx);
      var approvalSel = body.querySelector('[data-im-permission="approval"]');
      if (approvalSel) approvalSel.value = pr.approval;
      var cmd = body.querySelector('[data-im-permission="commands"]');
      var net = body.querySelector('[data-im-permission="network"]');
      if (cmd) cmd.checked = !!pr.commands;
      if (net) net.checked = !!pr.network;
      imUpdateProjectRow(body, pr);
      imGrantDialogEl.querySelector("[data-im-grant-dialog-error]").hidden = true;
      var closeBtn = document.createElement("button");
      closeBtn.className = "btn btn-ghost";
      closeBtn.type = "button";
      closeBtn.textContent = "关闭";
      var okBtn = document.createElement("button");
      okBtn.className = "btn btn-primary";
      okBtn.type = "button";
      okBtn.textContent = "确认设置";
      imGrantDialogEl.querySelector(".btn-pair").replaceChildren(closeBtn, okBtn);
      closeBtn.onclick = function () {
        imGrantController.close(); /* onClose 统一回退草稿 */
      };
      okBtn.onclick = function () {
        var pr2 = imState.projects[imGrantIdx];
        var errEl2 = imGrantDialogEl.querySelector("[data-im-grant-dialog-error]");
        if (imState.sim.saveFailure) {
          /* 保存失败：弹窗保持打开，草稿保留可重试 */
          errEl2.hidden = false;
          errEl2.textContent = "保存失败：服务暂不可用。授权未生效；已保留你的调整，恢复后重试。";
          return;
        }
        imGrantConfirmed = true;
        imGrantController.close();
        imApplyGrant(null, pr2.id);
      };
      imGrantController.open(document.activeElement);
    }

    function imCopy(text) {
      if (!navigator.clipboard) { notice("剪贴板不可用，请选中指令手动复制。", true); return; }
      navigator.clipboard.writeText(text).catch(function () { notice("复制失败，请选中指令手动复制。", true); });
    }
    function imDecorate() {
      imPanel.querySelectorAll("[data-im-field-label]").forEach(function (field) {
        var input = field.querySelector("input,select");
        if (!input) return;
        if (!input.id) input.id = "im-input-" + (++imFieldSequence);
        field.htmlFor = input.id;
      });
      imPanel.querySelectorAll('input[type="password"]').forEach(function (input) {
        if (input.dataset.revealReady) return;
        input.dataset.revealReady = "true";
        var wrap = document.createElement("span"); wrap.className = "im-secret-wrap";
        input.replaceWith(wrap); wrap.append(input);
        var button = document.createElement("button"); button.type = "button"; button.className = "btn btn-ghost im-reveal";
        button.textContent = "显示"; button.setAttribute("aria-label", "显示密钥"); button.setAttribute("aria-pressed", "false");
        button.onclick = function (event) { event.preventDefault(); var show = input.type === "password"; input.type = show ? "text" : "password"; button.textContent = show ? "隐藏" : "显示"; button.setAttribute("aria-label", show ? "隐藏密钥" : "显示密钥"); button.setAttribute("aria-pressed", String(show)); };
        wrap.append(button);
      });
      /* 行内次要按钮与设置抽屉其他分区对齐：纯文字 compact ghost（12px/28px）。
         不按标签猜图标——猜测曾把「已保存 · 更换」配成 ✓、「删除连接」配成 ⟲，语义全错。 */
      imPanel.querySelectorAll(".btn-ghost, .btn-quiet").forEach(function (button) {
        button.dataset.size = "compact";
      });
      UI.enhance(imPanel);
    }
    // Observe added controls only; repeated enhancement is idempotent.
    var imDecorating = false;
    var imObserver = new MutationObserver(function () {
      if (imDecorating) return;
      imDecorating = true; imObserver.disconnect(); imDecorate();
      imObserver.observe(imPanel, { childList: true, subtree: true }); imDecorating = false;
    });
    imObserver.observe(imPanel, { childList: true, subtree: true });
    imPanel.addEventListener("submit", function (event) {
      if (!event.target.matches("[data-im-cred-form]")) return;
      event.preventDefault(); event.target.querySelector("[data-im-cred-save]").click();
    });
    imPanel.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing && event.target.matches("[data-im-cred-form] input")) {
        event.preventDefault(); event.target.closest("form").querySelector("[data-im-cred-save]").click();
      }
    });
    imPanel.addEventListener("change", function (event) {
      var li = event.target.closest("[data-im-project-idx]");
      if (!li) return;
      var pr = imState.projects[Number(li.getAttribute("data-im-project-idx"))];
      /* 三档模式：退出「允许修改」清空命令/网络/可写 */
      var modeRadio = event.target.closest("[data-im-mode]");
      if (modeRadio && modeRadio.checked) {
        pr.mode = modeRadio.value;
        if (pr.mode !== "execute") {
          pr.commands = pr.network = false;
          pr.writes = [];
        }
        imState.sim.projectsDirty = true;
        imUpdateProjectRow(li, pr);
        imRefresh();
        return;
      }
      /* 审批 / 沙箱命令 / 网络 */
      var input = event.target.closest("[data-im-permission]");
      if (input) {
        pr[input.dataset.imPermission] = input.type === "checkbox" ? input.checked : input.value;
        if (pr.mode !== "execute") pr.commands = pr.network = false;
        if (!pr.commands) pr.network = false;
        imState.sim.projectsDirty = true;
        imUpdateProjectRow(li, pr);
        imRefresh();
        return;
      }
      /* 范围树：可写⊆可读联动；受保护不可选（构建时已禁） */
      var readChk = event.target.closest("[data-im-scope-read]");
      var writeChk = event.target.closest("[data-im-scope-write]");
      if (readChk || writeChk) {
        var path = (readChk || writeChk).getAttribute("data-scope-path");
        if (readChk) {
          if (readChk.checked) {
            if (pr.reads.indexOf(path) < 0) pr.reads.push(path);
          } else {
            var depends = pr.writes.some(function (wPath) {
              return wPath === path || wPath.indexOf(path) === 0;
            });
            if (depends) {
              readChk.checked = true;
              notice("先取消依赖它的可写范围，再取消可读。", true);
              return;
            }
            pr.reads = pr.reads.filter(function (rPath) { return rPath !== path; });
          }
        }
        if (writeChk) {
          if (writeChk.checked) {
            if (pr.writes.indexOf(path) < 0) pr.writes.push(path);
            /* 可写强制可读：自身 + 祖先目录 */
            imScopeAncestors(path).concat([path]).forEach(function (p2) {
              if (pr.reads.indexOf(p2) < 0) pr.reads.push(p2);
            });
          } else {
            pr.writes = pr.writes.filter(function (wPath) { return wPath !== path; });
          }
        }
        imState.sim.projectsDirty = true;
        imUpdateProjectRow(li, pr);
        imRefresh();
      }
    });
    /* 模式档位卡：label→radio 原生激活在部分 webview 的 <dialog> 内不触发，
       委托兜底幂等补勾（原生已勾则空转） */
    imPanel.addEventListener("click", function (ev) {
      var tier = ev.target.closest(".im-mode-tier");
      if (!tier || !tier.closest(".im-grant-dialog")) return;
      var radio = tier.querySelector('input[type="radio"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    /* 「自定义范围」：Plan/Review 档展开完整树（Execute 档树常显） */
    imPanel.addEventListener("click", function (event) {
      var custom = event.target.closest("[data-im-scope-custom]");
      if (!custom) return;
      var li = custom.closest("[data-im-project-idx]");
      if (li.dataset.scopeCustom === "true") delete li.dataset.scopeCustom;
      else li.dataset.scopeCustom = "true";
      var pr = imState.projects[Number(li.getAttribute("data-im-project-idx"))];
      imUpdateProjectRow(li, pr);
    });
    imPanel.addEventListener("click", function (event) {
      var fill = event.target.closest("[data-im-fill-demo]");
      if (fill) {
        var row = fill.closest("[data-im-platform]");
        var values = { "App ID": "cli_demo_artemis", "App Secret": "demo-secret", "企业 ID": "ww123456789", "Bot ID": "demo-bot", "Secret": "demo-secret", "Bot Token": "xoxb-demo", "App-Level Token": "xapp-demo", "Verification Token": "demo-verification", "Encrypt Key": "demo-encrypt" };
        row.querySelectorAll("[data-im-field-label]").forEach(function (field) { var input = field.querySelector("input"); if (input && values[field.dataset.imFieldLabel]) { input.value = values[field.dataset.imFieldLabel]; imHideFieldMessage(field); } });
        notice("已填入虚构演示值，仅在当前页面使用。");
      }
      var scene = event.target.closest("[data-im-scene]");
      if (scene) {
        var key = scene.dataset.imScene;
        imConfirm("切换演示场景", "当前输入和未保存设置会清空；不会修改实际消息服务。", function () {
          imApplyDemo(key === "ready" || key === "offline" || key === "expired" ? "alert" : key === "team" ? "progress" : key);
          if (key === "ready" || key === "offline" || key === "expired") {
            Object.values(imState.connections).flat().forEach(function (c) { c.state = "ok"; delete c.reason; });
            imState.pairingRequests = []; imState.projects.forEach(function (p) { p.expired = false; });
            imState.gateway.linkBroken = key === "offline";
            if (key === "ready") { imState.test.stage = 4; imState.test.confirmed = true; imState.test.channel = "feishu"; }
            if (key === "expired") { imSecondsLeft = 0; imCodeExpired = true; imManual.channel = true; }
            imRenderAll();
            imShowOverview = !!(imDerived && imDerived.allDone);
            imRefresh();
          }
          if (key === "team") {
            imState.gateway.team = "https://gw.example.com";
            imRenderAll();
          }
          notice("已切换演示场景。");
        });
      }
      if (event.target.closest("[data-im-save-failure]")) { imState.sim.saveFailure = !imState.sim.saveFailure; event.target.closest("button").setAttribute("aria-pressed", String(imState.sim.saveFailure)); notice(imState.sim.saveFailure ? "接下来保存项目权限将失败。" : "已恢复保存能力，可重试。"); }
      if (event.target.closest("[data-im-enable-failure]")) { imState.sim.enableFailure = !imState.sim.enableFailure; event.target.closest("button").setAttribute("aria-pressed", String(imState.sim.enableFailure)); notice(imState.sim.enableFailure ? "接下来保存成功后启用连接将失败。" : "已恢复启用能力，可重试启用。"); }
      if (event.target.closest("[data-im-recover]")) { imState.gateway.linkBroken = false; imRefresh(); notice("消息服务已恢复（演示）"); }
      if (event.target.closest("[data-im-diagnose]")) {
        var output = imPanel.querySelector("[data-im-diagnostic-result]");
        output.textContent = !imState.gateway.started ? "服务未启动：先完成第 1 步。" : imState.gateway.linkBroken ? "设备与服务断连：恢复服务后重试。" : imDerived.badTotal ? "机器人凭据或权限异常：展开第 2 步查看原因。" : !imState.bindings.length ? "服务正常；尚未绑定账号，请在第 2 步完成绑定。" : !imDerived.ready ? "连接正常；请保存有效项目授权并启用连接。" : "服务、机器人、账号与项目授权均正常。";
        output.hidden = false;
      }
      if (event.target.closest("[data-im-team-register]")) {
        var form = imPanel.querySelector("#imTeamForm"); var inputs = form.querySelectorAll("input");
        var result = form.querySelector("[data-im-team-result]");
        var url;
        try { url = new URL(inputs[0].value); } catch (_) {}
        if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !inputs[1].value.trim() || !inputs[2].value.trim()) {
          result.textContent = "填写 HTTPS 服务地址、设备名和管理凭据；地址不能含账号、密码或查询参数。"; result.hidden = false; inputs[!url || url.protocol !== "https:" ? 0 : !inputs[1].value.trim() ? 1 : 2].focus(); return;
        }
        /* 切换服务先暂停并明确影响（PT-2）：已在运行时注册团队=断开现有连接与绑定 */
        var switching = imState.gateway.started && !imState.gateway.linkBroken;
        imConfirm("注册到团队服务器", switching
          ? "将切换到团队服务器：本机服务停止，现有机器人连接与绑定会被断开，之后需要重新接入。确认继续？"
          : "机器人凭据将由团队 Gateway 保管。此处只模拟注册，不连接外部服务器。", function () {
          inputs[2].value = "";
          if (switching) {
            IM_PLATFORMS.forEach(function (p) { imState.connections[p.key] = []; });
            imState.pairingRequests = [];
            imState.bindings = [];
            imBuildPlatformRows();
            imUpdatePlatformRows();
            imBuildPairingRequests();
            imBuildBindings();
            imBuildInstructions();
          }
          imState.gateway.team = url.origin; imState.gateway.started = true; imState.gateway.linkBroken = false;
          result.textContent = "已注册演示设备 dev-3f9a，管理凭据已清空。"; result.hidden = false; imRefresh();
          if (switching) notice("已切换到团队服务器，机器人连接已断开（演示）");
        });
      }
    });
    window.addEventListener("beforeunload", function (event) {
      var dirty = imState.sim.projectsDirty || Array.from(imPanel.querySelectorAll('[data-im-cred-form] input')).some(function (input) { return !!input.value; });
      if (dirty) { event.preventDefault(); event.returnValue = ""; }
    });
    imDecorate();

    window.__imApplyDemo = imApplyDemo;
    window.__imLocateCard = imLocateCard;
    imApplyDemo("empty");
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

  /* 定时任务卡「待授权」深链：打开设置 → 消息接入 → 展开③ → 滚动 → 一次性脉冲 → 焦点落③卡头 */
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
