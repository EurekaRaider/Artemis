(function () {
  "use strict";
  var $ = function (s) {
    return document.querySelector(s);
  };
  var $$ = function (s) {
    return Array.prototype.slice.call(document.querySelectorAll(s));
  };
  var body = document.body;
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
    initial: $(".sidebar").getBoundingClientRect().width || 252,
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
    body.classList.toggle("sidebar-collapsed");
    this.classList.toggle(
      "active",
      !body.classList.contains("sidebar-collapsed"),
    );
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
    },
  });

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
    $("#environmentBranch").textContent = value + " ▾";
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
    });
  });

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

  /* ---------- 消息接入（按 proposal-im-settings-redesign 三态：向导 / 管理双栏 / 紧凑） ---------- */
  var imPanel = $("#settingsPanelIm");
  if (imPanel) {
    var imNav = $("#imNavList"),
      imDetailEl = $("#imDetail"),
      imMoreBtn = $("#imMoreBtn"),
      imMoreMenu = $("#imMoreMenu"),
      imWizard = $("#imWizard"),
      imManage = $("#imManage"),
      imMaster = $("#imMasterSwitch"),
      imStateText = $("#imStateText"),
      imStatePill = $("#imStatePill"),
      countdownEl = $("#imCountdown");

    /* 渠道/通用导航：点选或方向键切换详情视图（tablist 语义） */
    function imSelect(view) {
      $$('#imNavList .im-channel-card[data-im-view]').forEach(function (b) {
        b.setAttribute(
          "aria-selected",
          String(b.getAttribute("data-im-view") === view),
        );
      });
      imDetailEl
        .querySelectorAll(".im-view")
        .forEach(function (section) {
          section.hidden = section.getAttribute("data-im-view") !== view;
        });
      imMoreMenu.hidden = true;
    }
    imNav.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-im-view]");
      if (btn) imSelect(btn.getAttribute("data-im-view"));
      if (ev.target === imMoreBtn || imMoreBtn.contains(ev.target))
        imMoreMenu.hidden = !imMoreMenu.hidden;
    });
    imNav.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      var tabs = $$('#imNavList .im-channel-card');
      var i = tabs.findIndex(function (t) {
        return t.getAttribute("aria-selected") === "true";
      });
      var next = (i + (ev.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      imSelect(tabs[next].getAttribute("data-im-view"));
      ev.preventDefault();
    });

    /* 向导态 ↔ 管理态（hash #settings=1&im=wizard|manage 可直达）；
       六步清单为单份 markup（#imGuideContent），向导态整体搬入向导面板，管理态归位「设置指引」视图 */
    function imMode(mode) {
      var wizard = mode === "wizard";
      imPanel.setAttribute("data-im-mode", mode);
      imWizard.hidden = !wizard;
      imManage.hidden = wizard;
      var content = $("#imGuideContent");
      if (content) {
        (wizard ? $("#imWizardBody") : $("#imGuideBody")).appendChild(
          content,
        );
      }
      /* 主开关守卫：向导态（未完成配置）禁用并给原因 */
      imMaster.disabled = wizard;
      imMaster.setAttribute(
        "title",
        wizard
          ? "完成 Gateway、渠道与账号配置后可启用"
          : "关闭后停止响应 IM 指令，配置保留",
      );
    }
    $("#imBackManage") &&
      $("#imBackManage").addEventListener("click", function () {
        imMode("manage");
      });
    $$("[data-im-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        imMode("manage");
        imSelect(b.getAttribute("data-im-goto"));
      });
    });

    /* 主开关：关闭只停用，不清配置（proposal 语义）；翻转由全局 UI.toggle 完成，此处只跟随状态 */
    imMaster.addEventListener("click", function () {
      var on = imMaster.classList.contains("on");
      imMaster.setAttribute("aria-checked", String(on));
      imStateText.textContent = on ? "已连接" : "已停用";
      var dot = imStatePill.querySelector(".im-dot");
      dot.className = "im-dot " + (on ? "ok" : "idle");
      notice(on ? "IM 连接已启用（演示）" : "IM 连接已停用，配置保留（演示）");
    });

    /* 配对请求条件卡：批准/拒绝后即时移除 */
    imDetailEl.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-im-approve]")) {
        var card = ev.target.closest(".im-pairing-request-card");
        if (card) card.remove();
        notice("已批准配对，账号已绑定（演示）");
      } else if (ev.target.closest("[data-im-reject]")) {
        var card2 = ev.target.closest(".im-pairing-request-card");
        if (card2) card2.remove();
        notice("已拒绝配对（演示）");
      }
    });

    /* 凭据两态：已保存 ↔ 表单（按渠道就近展开，密钥不回显） */
    imDetailEl.addEventListener("click", function (ev) {
      var swap = ev.target.closest("[data-im-cred-swap]");
      if (swap) {
        var block = swap.closest(".im-block");
        var saved = block.querySelector("[data-im-cred-saved]");
        var empty = block.querySelector(".im-cred-empty");
        var form = block.querySelector("[data-im-cred-form]");
        if (saved) saved.hidden = true;
        if (empty) empty.hidden = true;
        form.hidden = false;
        var first = form.querySelector("input, select");
        if (first) first.focus();
        return;
      }
      if (ev.target.closest("[data-im-cred-cancel]")) {
        var form2 = ev.target.closest("[data-im-cred-form]");
        var block2 = form2.closest(".im-block");
        form2.hidden = true;
        form2.reset();
        var saved2 = block2.querySelector("[data-im-cred-saved]");
        var empty2 = block2.querySelector(".im-cred-empty");
        if (saved2) saved2.hidden = false;
        if (empty2) empty2.hidden = false;
        return;
      }
      if (ev.target.closest("[data-im-cred-save]")) {
        var form3 = ev.target.closest("[data-im-cred-form]");
        var block3 = form3.closest(".im-block");
        form3.hidden = true;
        form3.reset();
        var saved3 = block3.querySelector("[data-im-cred-saved]");
        var empty3 = block3.querySelector(".im-cred-empty");
        if (saved3) saved3.hidden = false;
        if (empty3) {
          /* 未配置渠道首次保存：升级为已保存态提示 */
          empty3.innerHTML =
            '<p class="im-muted">凭据已加密保存在本机，不会回显。</p>' +
            '<button class="btn btn-ghost" data-im-cred-swap="" type="button">已保存 · 更换</button>';
          empty3.hidden = false;
        }
        notice("凭据已保存并连接（演示）");
        return;
      }
      /* 解绑行内二次确认：焦点移入确认钮，Esc 视为保留 */
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
      }
    });
    imDetailEl.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var confirmBar = ev.target.closest(".im-unbind-confirm");
      if (!confirmBar) return;
      /* 行内确认的 Esc 只作用于本行（不给设置弹窗的关闭让路） */
      ev.stopPropagation();
      ev.preventDefault();
      var row = confirmBar.closest(".im-binding-row");
      confirmBar.hidden = true;
      row.querySelector(".im-binding-actions").hidden = false;
      row.querySelector("[data-im-unbind]").focus();
    });

    /* 折叠块（接入指引 / 高级字段 / 群协作 / 试试第一条任务 / 授权设置） */
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

    /* Gateway 模式卡片：团队模式展开连接表单 */
    $$('input[name="gwMode"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        $("#imTeamForm").hidden = radio.value !== "team" || !radio.checked;
      });
    });

    /* 配对码倒计时（tabular-nums，5 分钟时效） */
    var secondsLeft = 4 * 60 + 32;
    function imTick() {
      if (secondsLeft > 0) secondsLeft--;
      var m = Math.floor(secondsLeft / 60),
        s = secondsLeft % 60;
      countdownEl.textContent = m + ":" + String(s).padStart(2, "0");
      if (secondsLeft === 0) {
        clearInterval(imTimer);
        var head = countdownEl.closest(".im-pair-head");
        if (head) head.querySelector("strong").textContent = "配对码已过期";
      }
    }
    var imTimer = setInterval(imTick, 1000);

    /* 复制类按钮反馈（回调地址 / 配对指令） */
    $$('[data-copy], [data-copy-pair]').forEach(function (btn) {
      var original = btn.textContent;
      btn.addEventListener("click", function () {
        btn.textContent = "已复制";
        setTimeout(function () {
          btn.textContent = original;
        }, 1400);
      });
    });

    /* 渠道 tab 状态推导：已配置(连接数)/未配置；任一连接健康即绿灯（否则已配置但无健康连接=amber） */
    function imSyncChannelTabs() {
      $$("#imNavList .im-channel-card:not(.gen)").forEach(function (card) {
        var view = card.getAttribute("data-im-view");
        var section = imDetailEl.querySelector(
          '.im-view[data-im-view="' + view + '"]',
        );
        var status = card.querySelector(".im-channel-status");
        if (!section || !status) return;
        var conns = Array.prototype.slice.call(
          section.querySelectorAll(".im-conn-row"),
        );
        var healthy = conns.some(function (row) {
          return !!row.querySelector(".im-dot.ok");
        });
        var dot = status.querySelector(".im-dot");
        if (!dot) {
          dot = document.createElement("span");
          dot.className = "im-dot";
          dot.setAttribute("aria-hidden", "true");
        }
        var text = document.createElement("span");
        text.textContent = conns.length
          ? "已配置(" + conns.length + ")"
          : "未配置";
        dot.className =
          "im-dot " +
          (conns.length ? (healthy ? "ok" : "pending") : "idle");
        status.textContent = "";
        status.appendChild(dot);
        status.appendChild(text);
      });
    }

    imMode("manage");
    imSelect("feishu");
    imSyncChannelTabs();
    /* 供连接态变化后复推（及测试直达） */
    window.__imSyncChannelTabs = imSyncChannelTabs;
    /* hash 直达桥（#settings=1&im=wizard|manage） */
    window.__imSetMode = imMode;
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
    orientation: "vertical",
    panelFor: function (tab) {
      return $(
        '.settings-panel-content[data-panel="' +
          tab.dataset.settingsPanel +
          '"]',
      );
    },
  });
  function selectSettings(key) {
    var tab = $('.settings-tab[data-settings-panel="' + key + '"]');
    if (tab) settingsTabs.select(tab);
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
        if (status) status.textContent = "当前版本 v1.4.40 · 已是最新版本";
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
    modelsTable.addEventListener("click", function (ev) {
      var btn = ev.target.closest("td:first-child button");
      if (!btn) return;
      var row = btn.closest("tr");
      modelsTable.querySelectorAll("tbody tr").forEach(function (tr) {
        var selected = tr === row;
        tr.classList.toggle("selected", selected);
        var b = tr.querySelector("td:first-child button");
        if (b) b.setAttribute("aria-pressed", String(selected));
      });
    });
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
    var min = Math.min(440, Math.max(320, cw - 327));
    var max = Math.min(1080, cw - 327);
    return { min: min, max: Math.max(min, max) };
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
    });
  });
  $("#prototypeDialog").addEventListener("close", function () {
    if (this.returnValue === "confirm")
      notice("提交表单演示完成，仓库未发生变化");
  });
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
    choose(trigger, ["main", "feat/im-feishu"], function (value) {
      applyBranch(value);
    });
  });

  /* ---------- 模型与推理强度（Zcode 式两组联动，选中即回写单行触发条） ---------- */
  var modelPicker = $("#modelPicker");
  if (modelPicker) {
    var modelTrigger = $("#modelBtn");

    function modelClose(focus) {
      modelPicker.classList.remove("open");
      modelTrigger.setAttribute("aria-expanded", "false");
      if (focus) modelTrigger.focus({ preventScroll: true });
    }
    modelTrigger.addEventListener("click", function () {
      var opening = !modelPicker.classList.contains("open");
      if (opening) {
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
    });
  });
  $("#sendBtn").disabled = true;
  input.addEventListener("input", function () {
    $("#sendBtn").disabled = !this.value.trim();
  });
  function sendDemo() {
    var value = input.value.trim();
    if (!value) return;
    var message = document.createElement("article");
    message.className = "user-message";
    message.textContent = value;
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

  $$(".project-head").forEach(function (button) {
    button.addEventListener("click", function (e) {
      if (e.target.closest(".acts")) return;
      var open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      button.nextElementSibling.hidden = !open;
    });
  });
  $$(".group-row").forEach(function (button) {
    button.addEventListener("click", function (e) {
      if (e.target.closest(".group-add")) return;
      var open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      var sibling = button.nextElementSibling;
      while (sibling && !sibling.classList.contains("group-row")) {
        sibling.hidden = !open;
        sibling = sibling.nextElementSibling;
      }
    });
  });
  function syncNavigation() {
    $$(".activity-button[data-goto]").forEach(function (button) {
      if (button.dataset.goto === body.dataset.view)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    var collapsed = body.classList.contains("sidebar-collapsed");
    $("#projectSidebar").inert = collapsed;
    $("#leftToggle").setAttribute("aria-expanded", String(!collapsed));
    sidebarHandle.tabIndex = collapsed ? -1 : 0;
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
      $(".status-pill").textContent = "已停止";
      notice("原型任务已停止");
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
        var imHash = params.get("im");
        if ((imHash === "wizard" || imHash === "manage") && window.__imSetMode) {
          selectSettings("im");
          window.__imSetMode(imHash);
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
