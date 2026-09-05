var UI = window.ArtemisUI;
UI.enhance(document);

(function () {
  var root = document.documentElement;
  /* ===== 方向元数据 ===== */
  var DIRS = {
    a: {
      name: "方向 A · Apple-inspired",
      meta: [
        "石墨中性底",
        "Artemis Blue",
        "舒适密度",
        "同心圆角 8–18px",
        "轻毛玻璃浮层",
      ],
    },
    b: {
      name: "方向 B · Studio Precision",
      meta: [
        "石墨蓝灰底",
        "钢蓝 #5e9bd8",
        "紧凑密度",
        "直角 4–8px",
        "实底高对比描边",
      ],
    },
    c: {
      name: "方向 C · Warm Editorial",
      meta: [
        "暖米底",
        "赭石 #c15c3f",
        "宽松密度",
        "大圆角 10–24px",
        "衬线标题 + 纸感",
      ],
    },
  };
  var dirMeta = document.getElementById("dirMeta"),
    dirName = document.getElementById("dirName");

  window.__setState = window.__setState || {};
  function seg(id, attr, key, cb) {
    var s = document.getElementById(id);
    function pick(b) {
      s.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-selected", "false");
        x.tabIndex = -1;
      });
      b.setAttribute("aria-selected", "true");
      b.tabIndex = 0;
      root.setAttribute(attr, b.dataset[key]);
      if (cb) cb(b.dataset[key]);
    }
    var controller = UI.tabs(s, { selector: "button", onSelect: pick });

    // 统一 setter 注册：点击与 URL hash 共用此唯一路径
    window.__setState[
      attr === "data-direction" ? "d" : attr === "data-theme" ? "t" : "c"
    ] = function (v) {
      var b = s.querySelector("[data-" + key + '="' + v + '"]');
      if (b && b.getAttribute("aria-selected") !== "true") pick(b);
    };
  }
  seg("themeSeg", "data-theme", "t");
  seg("contrastSeg", "data-contrast", "c");
  seg("dirSeg", "data-direction", "dir", function (d) {
    dirName.textContent = DIRS[d].name;
    dirMeta.innerHTML = "";
    DIRS[d].meta.forEach(function (m) {
      var t = document.createElement("span");
      t.className = "tag";
      t.textContent = m;
      dirMeta.appendChild(t);
    });
    refreshMeta();
    renderTokens();
  });

  /* 速览元数据（回读计算值） */
  function refreshMeta() {
    var cs = getComputedStyle(root);
    document.getElementById("metaRadius").textContent = cs
      .getPropertyValue("--r-sm")
      .trim();
    document.getElementById("metaAccent").textContent = cs
      .getPropertyValue("--accent")
      .trim();
    document.getElementById("metaRow").textContent = cs
      .getPropertyValue("--row-h")
      .trim();
  }
  dirName.textContent = DIRS.a.name;
  DIRS.a.meta.forEach(function (m) {
    var t = document.createElement("span");
    t.className = "tag";
    t.textContent = m;
    dirMeta.appendChild(t);
  });
  refreshMeta();

  /* ===== 令牌速览 ===== */
  var tokens = [
    ["基底", "--bg"],
    ["面板", "--surface"],
    ["面板 2", "--surface-2"],
    ["面板 3", "--surface-3"],
    ["强调", "--accent"],
    ["文字", "--text"],
    ["次级", "--text-2"],
    ["三级", "--text-3"],
    ["成功", "--success"],
    ["警告", "--warning"],
    ["危险", "--danger"],
    ["边框", "--border"],
  ];
  var tg = document.getElementById("tokenGrid");
  function renderTokens() {
    tg.innerHTML = "";
    var cs = getComputedStyle(root);
    tokens.forEach(function (t) {
      var v = cs.getPropertyValue(t[1]).trim();
      var d = document.createElement("div");
      d.style.cssText =
        "border:1px solid var(--border-soft);border-radius:var(--r-md);overflow:hidden;background:var(--surface)";
      var sw = document.createElement("div");
      var isBorder = t[1] === "--border";
      sw.style.cssText =
        "height:42px;background:" +
        (isBorder ? "var(--surface-3)" : v) +
        (isBorder ? ";border-bottom:3px solid " + v : "");
      var meta = document.createElement("div");
      meta.style.cssText = "padding:6px 9px;font-size:10.5px";
      meta.innerHTML =
        "<div style='font-weight:600'>" +
        t[0] +
        "</div><div style='color:var(--text-3);font-family:ui-monospace,Menlo,monospace'>" +
        v +
        "</div>";
      d.appendChild(sw);
      d.appendChild(meta);
      tg.appendChild(d);
    });
  }
  renderTokens();
  new MutationObserver(function () {
    renderTokens();
    refreshMeta();
  }).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme", "data-contrast", "data-direction"],
  });

  /* ===== 两级侧栏导航：分类组（可折叠）+ 组件项（按卡片自动生成，与卡片集自动同步）===== */
  var navSide = document.querySelector("nav.side");
  document.querySelectorAll(".spec[data-card]").forEach(function (spec) {
    spec.id = spec.dataset.card;
  });
  /* 滚动高亮仅在用户首次滚动后启用（锚点跳转同样触发 scroll）：初始批 IO 回调的触发时机
     在不同运行间不定，会污染扫描器结构指纹造成等价类时序毛刺；初始高亮由构建期同步落在首卡 */
  var navUser = false;
  window.addEventListener(
    "scroll",
    function () {
      navUser = true;
    },
    { passive: true, once: true },
  );
  var navIO = new IntersectionObserver(
    function (entries) {
      if (!navUser) return;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id,
          cat = en.target.closest(".cat");
        navSide.querySelectorAll(".nav-items a").forEach(function (a) {
          a.classList.toggle("active", a.getAttribute("href") === "#" + id);
        });
        navSide.querySelectorAll(".grp").forEach(function (g) {
          if (cat && g.dataset.cat === cat.id) g.classList.remove("collapsed");
        });
      });
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  navSide.innerHTML = "";
  document.querySelectorAll("section.cat").forEach(function (cat) {
    var grp = document.createElement("div");
    grp.className = "grp";
    grp.dataset.cat = cat.id;
    var h2 = cat.querySelector("h2");
    var title = ((h2.childNodes[0] || {}).textContent || h2.textContent).trim();
    var cards = cat.querySelectorAll(".spec[data-card]");
    var head = document.createElement("button");
    head.type = "button";
    head.className = "nav-cat";
    head.setAttribute("aria-expanded", "true");
    head.innerHTML =
      '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var label = document.createElement("span");
    label.textContent = title;
    head.appendChild(label);
    var count = document.createElement("span");
    count.className = "n";
    count.textContent = String(cards.length);
    head.appendChild(count);
    head.addEventListener("click", function () {
      var collapsed = grp.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    });
    var items = document.createElement("div");
    items.className = "nav-items";
    cards.forEach(function (spec) {
      var a = document.createElement("a");
      var name = spec.querySelector(".name"),
        en2 = spec.querySelector(".en");
      a.href = "#" + spec.id;
      a.textContent = name ? name.textContent.trim() : spec.dataset.card;
      if (name)
        a.title =
          name.textContent.trim() + (en2 ? " · " + en2.textContent.trim() : "");
      items.appendChild(a);
      navIO.observe(spec);
    });
    grp.appendChild(head);
    grp.appendChild(items);
    navSide.appendChild(grp);
  });
  /* 初始高亮同步落在首卡（与 IO 初始回调的选择一致）：避免 IO 回调时序不同导致
     扫描器结构指纹跨组合捕获到不同 active 状态（EQUIV_STALE 时序毛刺） */
  var navFirst = navSide.querySelector(".nav-items a");
  if (navFirst) navFirst.classList.add("active");

  /* ===== 下拉 ===== */
  var trig = document.getElementById("sel1"),
    menu = document.getElementById("sel1Menu");
  UI.menu(trig, menu, {
    selector: ".m-opt",
    onSelect: function (option) {
      trig.querySelector(".val").textContent = option.textContent
        .replace("✓", "")
        .trim();
    },
  });

  /* ===== 进度 ===== */
  var pv = 40,
    bar = document.getElementById("progBar"),
    pval = document.getElementById("progVal");
  document.getElementById("progBtn").addEventListener("click", function () {
    pv = pv >= 100 ? 10 : pv + 15;
    bar.style.width = pv + "%";
    pval.textContent = pv;
  });

  /* ===== 对话框 ===== */
  var overlay = document.getElementById("overlay"),
    dialog = document.getElementById("dialog");
  var dialogController = UI.dialog(overlay, {
    surface: dialog,
    initialFocus: document.getElementById("dlgInput"),
    inert: [
      document.querySelector(".layout"),
      document.querySelector("header.top"),
    ],
  });
  function openDialog(trigger) {
    UI.enhance(document.getElementById("dlgConfirm"));
    dialogController.open(trigger);
  }
  function closeDialog() {
    dialogController.close();
  }

  document.getElementById("openDlg").addEventListener("click", function () {
    openDialog(this);
  });
  document
    .getElementById("openDangerDlg")
    .addEventListener("click", function () {
      document.getElementById("dlgT").textContent = "删除此项目？";
      document.getElementById("dlgD").textContent =
        "此操作不可撤销，相关任务与历史将被永久移除。";
      document.getElementById("dlgConfirm").textContent = "删除";
      document.getElementById("dlgConfirm").className = "btn btn-danger";
      openDialog(this);
    });
  dialog.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", closeDialog);
  });
  document.getElementById("dlgConfirm").addEventListener("click", function () {
    closeDialog();
    showToast("已确认", false);
  });

  /* ===== Popover ===== */
  var envTrig = document.getElementById("envTrig"),
    envPop = document.getElementById("envPop");
  UI.floating(envTrig, envPop);

  /* ===== Toast ===== */
  var toastHost = document.getElementById("toastHost");
  function showToast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " error" : "");
    toastHost.appendChild(t);
    var controller = UI.toast(t);
    controller.show(msg, isErr);
    setTimeout(function () {
      controller.destroy();
      t.remove();
    }, 3400);
  }

  document.getElementById("toastInfo").addEventListener("click", function () {
    showToast("已保存更改", false);
  });
  document.getElementById("toastErr").addEventListener("click", function () {
    showToast("操作失败，请重试", true);
  });

  /* ===== Split Pane（2 栏 / 3 栏，每条分隔条控制其左侧面板） ===== */
  var splitDemo = document.getElementById("splitDemo"),
    splitA = document.getElementById("splitA"),
    splitSep = document.getElementById("splitSep"),
    splitPct = document.getElementById("splitPct"),
    splitState = document.getElementById("splitState");
  var splitMid = document.getElementById("splitMid"),
    splitSep2 = document.getElementById("splitSep2"),
    splitMidPct = document.getElementById("splitMidPct");
  var splitOpen = true,
    splitDefault = 190,
    splitMidDefault = 150,
    splitThree = false;
  function splitLimits() {
    var w = Math.max(
      480,
      Math.round(splitDemo.getBoundingClientRect().width || 500),
    );
    return { min: 120, max: Math.max(120, w - 140), width: w };
  }
  function makeSplitCtl(sep, pane, pctEl, name, def) {
    var controller = UI.splitPane(sep, {
      initial: def,
      limits: splitLimits,
      onChange: function (px, lim) {
        pane.style.width = px + "px";
        var pct = Math.round((px / lim.width) * 100);
        if (pctEl) pctEl.textContent = pct + "%";
        sep.setAttribute("aria-valuetext", name + " " + pct + "%");
        splitState.textContent =
          name +
          " " +
          px +
          "px（" +
          pct +
          "%）· " +
          (splitThree ? "3 栏模式" : "2 栏模式");
      },
    });
    return { setPx: controller.set };
  }

  var splitCtlA = makeSplitCtl(
    splitSep,
    splitA,
    splitPct,
    "左面板",
    splitDefault,
  );
  var splitCtlM = makeSplitCtl(
    splitSep2,
    splitMid,
    splitMidPct,
    "中面板",
    splitMidDefault,
  );
  document.querySelectorAll("[data-split-mode]").forEach(function (btn) {
    /* 2 栏 / 3 栏切换 */
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-split-mode]").forEach(function (other) {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      splitThree = btn.dataset.splitMode === "3";
      splitMid.hidden = !splitThree;
      splitSep2.hidden = !splitThree;
      if (splitThree) {
        splitCtlM.setPx(splitMidDefault);
        splitState.textContent =
          "已切换 3 栏 · 左/中两条分隔条均可拖拽或键盘调整";
      } else splitState.textContent = "已切换 2 栏 · 中栏与第二分隔条已隐藏";
    });
  });
  document.getElementById("splitClose").addEventListener("click", function () {
    splitOpen = !splitOpen;
    splitDemo.classList.toggle("closed", !splitOpen);
    [splitSep, splitSep2].forEach(function (s) {
      s.tabIndex = splitOpen ? 0 : -1;
      s.setAttribute("aria-disabled", String(!splitOpen));
    });
    this.textContent = splitOpen ? "关闭分栏" : "打开分栏";
    splitState.textContent = splitOpen
      ? "分栏已打开"
      : "分栏已关闭；separator 已移出 Tab 顺序";
  });
  document.getElementById("splitClamp").addEventListener("click", function () {
    var lim = splitLimits();
    splitCtlA.setPx(lim.max + 999);
  });
  splitCtlA.setPx(splitDefault);

  /* ===== 树 ===== */
  document.querySelectorAll("#treeDemo .tree-toggle").forEach(function (t) {
    t.addEventListener("click", function (e) {
      e.stopPropagation();
      var row = t.closest(".list-row"),
        exp = t.getAttribute("aria-expanded") === "true";
      t.setAttribute("aria-expanded", String(!exp));
      row.setAttribute("aria-expanded", String(!exp));
      var lvl = row,
        hide = !exp;
      while ((lvl = lvl.nextElementSibling) && lvl.classList.contains("child"))
        lvl.style.display = hide ? "none" : "";
    });
  });
  function wireTree(tree, stateId, menuId) {
    if (!tree) return;
    var rows = Array.prototype.slice.call(
        tree.querySelectorAll('[role="treeitem"]'),
      ),
      state = document.getElementById(stateId),
      menu = document.getElementById(menuId),
      lastMore = null;
    function focusRow(i, select) {
      i = (i + rows.length) % rows.length;
      rows.forEach(function (r, j) {
        r.tabIndex = j === i ? 0 : -1;
        if (select) {
          r.classList.toggle("selected", j === i);
          r.setAttribute("aria-selected", String(j === i));
        }
      });
      rows[i].focus();
      if (state)
        state.textContent =
          "焦点：" +
          rows[i].querySelector(".lr-t").textContent +
          " · level " +
          rows[i].getAttribute("aria-level");
    }
    rows.forEach(function (r, i) {
      r.addEventListener("click", function (e) {
        if (!e.target.closest("button")) focusRow(i, true);
      });
      r.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusRow(i + 1, false);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          focusRow(i - 1, false);
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          focusRow(i, true);
        }
      });
    });
    tree.querySelectorAll(".tree-more").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        lastMore = b;
        var open = !menu.classList.contains("open");
        menu.classList.toggle("open", open);
        b.setAttribute("aria-expanded", String(open));
        if (open) {
          var rect = b.closest(".list-row").offsetTop;
          menu.style.top = rect + 28 + "px";
          menu.querySelector("button").focus();
        }
      });
    });
    if (menu) {
      var items = Array.prototype.slice.call(menu.querySelectorAll(".tm-item"));
      function closeMenu(returnFocus) {
        menu.classList.remove("open");
        if (lastMore) {
          lastMore.setAttribute("aria-expanded", "false");
          if (returnFocus && menu.contains(document.activeElement))
            lastMore.focus();
        }
      }
      menu.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu(true);
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          var i = items.indexOf(document.activeElement);
          items[
            (i +
              (e.key === "ArrowDown" ? 1 : items.length - 1) +
              items.length) %
              items.length
          ].focus();
        }
      });
      items.forEach(function (item) {
        item.addEventListener("click", function () {
          var label = (item.querySelector("span") || item).textContent.trim();
          closeMenu(true);
          if (state)
            state.textContent =
              "已执行「" + label + "」· 焦点已归还更多钮（演示回读）";
        });
      });
      document.addEventListener("pointerdown", function (e) {
        /* 点外关闭：菜单与触发钮之外的 pointerdown 一律收起 */
        if (!menu.classList.contains("open")) return;
        if (
          menu.contains(e.target) ||
          (lastMore && lastMore.contains(e.target))
        )
          return;
        closeMenu(true);
      });
    }
  }
  wireTree(document.getElementById("treeDemo"), "treeState", "treeMenu");
  wireTree(
    document.getElementById("rowTreeDemo"),
    "rowTreeState",
    "rowTreeMenu",
  );

  /* ===== Composer ===== */
  var compTa = document.getElementById("compTa"),
    sendBtn = document.getElementById("sendBtn");
  compTa.addEventListener("input", function () {
    sendBtn.disabled = !compTa.value.trim();
    compTa.style.height = "auto";
    compTa.style.height = Math.min(compTa.scrollHeight, 120) + "px";
    var used = Math.min(95, 42 + compTa.value.length / 8);
    var cr = document.getElementById("ctxRing");
    cr.setAttribute("stroke-dashoffset", String(56.5 * (1 - used / 100)));
    cr.parentElement.setAttribute(
      "aria-label",
      "上下文用量 " + Math.round(used) + "%",
    );
  });
  var attachRow = document.getElementById("attachRow"),
    attachNames = ["设计稿.fig", "需求文档.pdf", "截图.png"],
    ai = 0;
  attachRow.addEventListener("click", function (e) {
    var btn = e.target.closest(".ctx-chip > button");
    if (btn) btn.closest(".ctx-chip").remove();
  });
  document.getElementById("attachBtn").addEventListener("click", function () {
    if (attachRow.children.length >= 5) {
      showToast("最多 5 个附件", false);
      return;
    }
    var chip = document.createElement("span");
    chip.className = "ctx-chip";
    chip.innerHTML =
      attachNames[ai % attachNames.length] +
      '<button aria-label="移除附件" type="button">×</button>';
    attachRow.appendChild(chip);
    ai++;
  });
  document.getElementById("simDrag").addEventListener("click", function () {
    var c = document.getElementById("composerDemo");
    c.classList.add("dragging");
    setTimeout(function () {
      c.classList.remove("dragging");
    }, 1400);
  });
  document.getElementById("modePill").addEventListener("click", function () {
    var v = document.getElementById("modeVal");
    v.textContent = v.textContent === "自动执行" ? "只读分析" : "自动执行";
  });
  document.getElementById("projPill").addEventListener("click", function () {
    showToast("切换项目（演示）", false);
  });
  document.getElementById("branchPill").addEventListener("click", function () {
    showToast("切换分支（演示）", false);
  });
  document.getElementById("modelPill").addEventListener("click", function () {
    var m = document.getElementById("modelVal");
    m.textContent = m.textContent === "GLM · 自动" ? "GLM · 5.3" : "GLM · 自动";
  });
  var policyPill = document.getElementById("policyPill"),
    policyMenu = document.getElementById("policyMenu");
  function setPolicy(open, focus) {
    policyMenu.classList.toggle("open", open);
    policyPill.setAttribute("aria-expanded", String(open));
    if (!open && focus) policyPill.focus();
  }
  policyPill.addEventListener("click", function (e) {
    e.stopPropagation();
    setPolicy(!policyMenu.classList.contains("open"));
  });
  policyMenu.addEventListener("click", function (e) {
    var opt = e.target.closest(".policy-opt");
    if (!opt) return;
    policyMenu.querySelectorAll(".policy-opt").forEach(function (o) {
      o.setAttribute("aria-checked", String(o === opt));
    });
    document.getElementById("policyVal").textContent =
      opt.querySelector(".t").textContent;
    setPolicy(false, true);
  });
  document.addEventListener("click", function (e) {
    if (
      policyMenu.classList.contains("open") &&
      !e.target.closest(".composer-policy")
    )
      setPolicy(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && policyMenu.classList.contains("open")) {
      e.preventDefault();
      setPolicy(false, true);
    }
  });

  /* ===== 排队 steer ===== */
  var queueList = document.getElementById("queueList"),
    queueDemo = document.getElementById("queueDemo");
  function refreshQueue() {
    var n = queueList.querySelectorAll(".queued-item").length;
    queueDemo.setAttribute("aria-label", n + " 条排队消息");
    queueDemo.querySelector(".queued-head").innerHTML =
      '<svg class="ic sm" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>' +
      n +
      " 条排队消息（当前任务后执行）";
    queueList.querySelectorAll(".qi-n").forEach(function (el, i) {
      el.textContent = i + 1;
    });
  }
  queueList.addEventListener("click", function (e) {
    var btn = e.target.closest(".qi-btn");
    if (!btn) return;
    var item = btn.closest(".queued-item"),
      act = btn.dataset.act;
    if (act === "del") {
      item.remove();
      refreshQueue();
      showToast("已移除排队消息", false);
    }
    if (act === "steer") {
      showToast(
        "已插入当前任务：" + item.querySelector(".qi-t").textContent,
        false,
      );
      item.remove();
      refreshQueue();
    }
    if (act === "front") {
      queueList.insertBefore(item, queueList.firstElementChild);
      refreshQueue();
      item.querySelector('[data-act="front"]').focus();
      showToast("已移到队列最前", false);
    }
    if (act === "edit") {
      var input = item.querySelector(".qi-edit-input");
      input.value = item.querySelector(".qi-t").textContent;
      item.classList.add("editing");
      input.focus();
    }
    if (act === "save") {
      var value = item.querySelector(".qi-edit-input").value.trim();
      if (value) item.querySelector(".qi-t").textContent = value;
      item.classList.remove("editing");
      item.querySelector('[data-act="edit"]').focus();
    }
    if (act === "cancel") {
      item.classList.remove("editing");
      item.querySelector('[data-act="edit"]').focus();
    }
    if (act === "busy") {
      var busy = item.getAttribute("aria-busy") === "true";
      item.setAttribute("aria-busy", String(!busy));
      item.querySelectorAll("button").forEach(function (b) {
        if (b.dataset.act !== "busy") b.disabled = !busy;
      });
      btn.textContent = busy ? "busy" : "解除 busy";
    }
  });
  queueList.addEventListener("keydown", function (e) {
    if (!e.target.classList.contains("qi-edit-input")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.target
        .closest(".queued-item")
        .querySelector('[data-act="cancel"]')
        .click();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.target
        .closest(".queued-item")
        .querySelector('[data-act="save"]')
        .click();
    }
  });
  document.getElementById("simQueue").addEventListener("click", function () {
    var li = document.createElement("li");
    li.className = "queued-item";
    li.innerHTML =
      '<span class="qi-n"></span><span class="qi-t">新的排队消息 ' +
      (queueList.children.length + 1) +
      '</span><span class="qi-act"><button class="qi-btn steer" data-act="steer">插入当前</button><button class="qi-btn" data-act="front">移到最前</button><button class="qi-btn" data-act="edit">编辑</button><button class="qi-btn" data-act="busy">busy</button><button class="qi-btn" data-act="del">移除</button></span><span class="qi-edit-row"><input class="qi-edit-input" aria-label="编辑排队消息"><button class="qi-btn" data-act="save">保存</button><button class="qi-btn" data-act="cancel">取消</button></span>';
    queueList.appendChild(li);
    refreshQueue();
  });

  /* ===== slash 键盘 ===== */
  var slashMenu = document.getElementById("slashMenu"),
    sItems = Array.prototype.slice.call(
      slashMenu.querySelectorAll(".slash-item"),
    ),
    sIdx = 0;
  function sFocus(i) {
    sIdx = Math.max(0, Math.min(sItems.length - 1, i));
    sItems.forEach(function (s, j) {
      s.classList.toggle("focused", j === sIdx);
      s.setAttribute("aria-selected", String(j === sIdx));
    });
  }
  slashMenu.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sFocus(sIdx + 1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      sFocus(sIdx - 1);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      showToast(
        "已选择 " + sItems[sIdx].querySelector(".sc-cmd").textContent,
        false,
      );
    }
  });
  sItems.forEach(function (s, i) {
    s.addEventListener("click", function () {
      sFocus(i);
      showToast("已选择 " + s.querySelector(".sc-cmd").textContent, false);
    });
  });

  /* ===== 热力图（伪随机生成，令牌着色） ===== */
  (function () {
    var hm = document.getElementById("heatmapDemo");
    if (!hm) return;
    var cs = getComputedStyle(root);
    function build() {
      hm.innerHTML = "";
      var acc = cs.getPropertyValue("--accent").trim();
      for (var i = 0; i < 56; i++) {
        var c = document.createElement("div");
        c.className = "hm-cell";
        var lvl = Math.random();
        if (lvl > 0.62) {
          c.style.background = acc;
          c.style.opacity = 0.25 + Math.round(((lvl - 0.62) / 0.38) * 7) / 10;
        }
        hm.appendChild(c);
      }
    }
    build();
    new MutationObserver(build).observe(root, {
      attributes: true,
      attributeFilter: ["data-direction", "data-theme"],
    });
  })();
})();

/* ===== tabs：roving tabindex + 方向键/Home/End ===== */
function wireTabs(box, state, getLabel, options) {
  var controller = UI.tabs(
    box,
    Object.assign(
      {
        onSelect: function (tab) {
          if (state) state.textContent = "当前：" + getLabel(tab);
        },
      },
      options,
    ),
  );
  return controller.select;
}

wireTabs(
  document.getElementById("tabsDemo"),
  document.getElementById("tabsState"),
  function (t) {
    return t.textContent.trim();
  },
);
/* ===== dock tabs：关闭/焦点转移/空态启动器 ===== */
var dockTabs = document.getElementById("dockTabs"),
  dockState = document.getElementById("dockState"),
  dockLauncher = document.getElementById("dockLauncher");
var DOCK_ICONS = {
  审查: '<span class="dt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/><path d="m9 11.5 2 2 4-4"/></svg></span>',
  终端: '<span class="dt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8l4 4-4 4"/><path d="M12 16h7"/></svg></span>',
  浏览器:
    '<span class="dt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg></span>',
  文件: '<span class="dt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg></span>',
};
var selectDock = wireTabs(
  dockTabs,
  dockState,
  function (t) {
    return t.dataset.dockName;
  },
  { closeSelector: ".dt-x", onClose: closeDock },
);
function dockEmpty() {
  var empty = !dockTabs.querySelector('[role="tab"]');
  dockTabs.hidden = empty;
  dockLauncher.setAttribute("data-empty", String(empty));
  dockState.textContent = empty
    ? "Dock 空态：请选择启动器"
    : dockState.textContent;
}
document.querySelectorAll("[data-dock-mode]").forEach(function (btn) {
  /* 显示模式切换：纯文字 / 图标+文字 */
  btn.addEventListener("click", function () {
    document.querySelectorAll("[data-dock-mode]").forEach(function (other) {
      other.setAttribute("aria-pressed", String(other === btn));
    });
    var iconMode = btn.dataset.dockMode === "icontext";
    dockTabs.classList.toggle("icon-mode", iconMode);
    dockLauncher.classList.toggle("icon-mode", iconMode);
    document.getElementById("dockModeState").textContent =
      "显示模式：" + (iconMode ? "图标+文字" : "纯文字");
  });
});
function closeDock(tab) {
  var list = Array.from(dockTabs.querySelectorAll('[role="tab"]')),
    i = list.indexOf(tab),
    active = tab.getAttribute("aria-selected") === "true";
  tab.remove();
  var rest = Array.from(dockTabs.querySelectorAll('[role="tab"]'));
  if (active && rest.length)
    selectDock(rest[Math.min(i, rest.length - 1)], true);
  dockEmpty();
  if (!rest.length) dockLauncher.querySelector(".launch-btn").focus();
}

dockLauncher.addEventListener("click", function (e) {
  var b = e.target.closest(".launch-btn");
  if (!b) return;
  if (b.getAttribute("aria-disabled") === "true") {
    dockState.textContent = "Unavailable：当前环境不支持";
    return;
  }
  var name = b.dataset.launch,
    existing = Array.prototype.find.call(
      dockTabs.querySelectorAll('[role="tab"]'),
      function (t) {
        return t.dataset.dockName === name;
      },
    );
  if (!existing) {
    existing = UI.tab({
      label: name,
      className: "dock-tab",
      closeClass: "dt-x",
    });
    existing.dataset.dockName = name;
    existing.insertAdjacentHTML("afterbegin", DOCK_ICONS[name] || "");
    dockTabs.appendChild(existing);
  }
  dockTabs.hidden = false;
  selectDock(existing, true);
  dockEmpty();
});
/* ===== segmented ===== */
document.querySelectorAll("#segCtl button").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll("#segCtl button").forEach(function (x) {
      x.setAttribute("aria-pressed", "false");
    });
    b.setAttribute("aria-pressed", "true");
  });
});
/* ===== 活动栏 ===== */
document.querySelectorAll(".act-btn").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".act-btn").forEach(function (x) {
      x.classList.remove("active");
      x.removeAttribute("aria-current");
    });
    b.classList.add("active");
    b.setAttribute("aria-current", "page");
    var s = document.getElementById("activityState");
    if (s)
      s.textContent =
        "当前区域：" +
        b.getAttribute("aria-label") +
        " · aria-current 仅在活动项";
  });
});
/* ===== 来源：真实打开控件 + 加载/失败 + MCP 详情 ===== */
var sourcesState = document.getElementById("sourcesState");
document.querySelectorAll("[data-open-source]").forEach(function (b) {
  b.addEventListener("click", function () {
    if (sourcesState)
      sourcesState.textContent = "已打开来源：" + b.dataset.openSource;
  });
});
document
  .getElementById("sourcesLoading")
  .addEventListener("click", function () {
    this.closest(".spec").setAttribute("aria-busy", "true");
    sourcesState.textContent = "正在加载来源…";
  });
document.getElementById("sourcesError").addEventListener("click", function () {
  this.closest(".spec").setAttribute("aria-busy", "false");
  sourcesState.setAttribute("role", "alert");
  sourcesState.textContent = "来源加载失败，请重试";
  document.getElementById("webSourceError").hidden = false;
});
document.getElementById("sourcesReady").addEventListener("click", function () {
  this.closest(".spec").setAttribute("aria-busy", "false");
  sourcesState.setAttribute("role", "status");
  sourcesState.textContent = "来源已就绪";
  document.getElementById("webSourceError").hidden = true;
});
document
  .getElementById("webSourceRetry")
  .addEventListener("click", function () {
    document.getElementById("webSourceError").hidden = true;
    sourcesState.textContent = "网页搜索重试成功";
  });
document.querySelectorAll("[data-mcp-call]").forEach(function (b) {
  b.addEventListener("click", function () {
    document.getElementById("mcpSourceDetail").textContent =
      "调用详情：" +
      b.dataset.mcpCall +
      " · 输出过长时保留完整 title 并视觉截断";
  });
});

/* ===== GoalEditor：dirty/loading/saving/error/stale retry ===== */
var goalEditor = document.getElementById("goalEditor"),
  goalInput = document.getElementById("goalInput"),
  goalStatus = document.getElementById("goalStatus"),
  goalSave = document.getElementById("goalSave");
var goalController = ArtemisPatterns.goalEditor(goalEditor, {
  input: goalInput,
  save: goalSave,
  revert: document.getElementById("goalRevert"),
  status: goalStatus,
  onSave: function (value) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(value);
      }, 80);
    });
  },
});
document.querySelectorAll("[data-goal-state]").forEach(function (button) {
  button.addEventListener("click", function () {
    var state = button.dataset.goalState;
    goalController.setState(
      state === "loading"
        ? "loading"
        : state.indexOf("error") >= 0
          ? "error"
          : "ready",
      state === "loading"
        ? "正在加载…"
        : state.indexOf("error") >= 0
          ? "加载失败，请重试"
          : "已加载",
    );
  });
});

document
  .getElementById("goalStaleRetry")
  .addEventListener("click", function () {
    var stale = document.getElementById("goalStale"),
      state = document.getElementById("goalStaleState");
    stale.setAttribute("aria-busy", "true");
    state.textContent = "正在重新加载…";
    setTimeout(function () {
      stale.setAttribute("aria-busy", "false");
      stale.classList.remove("stale");
      state.textContent = "已载入最新修订";
      document.getElementById("goalStaleSave").disabled = false;
    }, 80);
  });

/* ===== PR checks：六态/三警告/焦点对话框/stale retry ===== */
var prState = document.getElementById("prState"),
  checksDialog = document.getElementById("checksDialog"),
  openChecks = document.getElementById("openChecks");
document.querySelectorAll("[data-pr-state]").forEach(function (b) {
  b.addEventListener("click", function () {
    prState.textContent = "当前 summary：" + b.dataset.prState;
  });
});
openChecks.addEventListener("click", function () {
  checksDialog.hidden = false;
  openChecks.setAttribute("aria-expanded", "true");
  setTimeout(function () {
    checksDialog.focus();
  }, 0);
});
function closeChecksDemo() {
  checksDialog.hidden = true;
  openChecks.setAttribute("aria-expanded", "false");
  openChecks.focus();
}
document
  .getElementById("closeChecks")
  .addEventListener("click", closeChecksDemo);
checksDialog.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeChecksDemo();
  }
});
document.getElementById("prStaleRetry").addEventListener("click", function () {
  prState.textContent = "正在刷新 stale PR…";
  this.setAttribute("aria-busy", "true");
  var b = this;
  setTimeout(function () {
    b.setAttribute("aria-busy", "false");
    prState.textContent = "stale PR 已刷新";
  }, 80);
});

/* ===== 工具活动折叠 ===== */
var toolAct = document.getElementById("toolAct");
UI.disclosure(toolAct.querySelector(".tool-act-h"), null, {
  classTarget: toolAct,
});

/* ===== 任务计划胶囊（对齐 TaskPlanProgress.tsx：175ms 悬停意图；点击/聚焦固定；Esc/移出/点外关闭；完成后 2.5s 隐藏） ===== */
var planRoot = document.getElementById("planProgress"),
  planTrig = document.getElementById("planTrigger"),
  planList = document.getElementById("planList"),
  planMarker = document.getElementById("planMarker"),
  planLabel = document.getElementById("planLabel"),
  planStateEl = document.getElementById("planState");
var PLAN_DELAY = 175;
var PLAN_STEPS = [
  "梳理真实胶囊的交互与样式",
  "映射设计令牌（surface / text 体系）",
  "实现胶囊与步骤浮窗组件",
  "键盘与指针交互契约",
  "对比度矩阵与 README 回写",
];
var PLAN_STATUS_LABELS = {
  pending: "尚未开始",
  in_progress: "正在进行",
  completed: "已完成",
  failed: "失败",
};
var PLAN_CASES = {
  run: {
    idx: 2,
    status: ["completed", "completed", "in_progress", "pending", "pending"],
    note: "进行中 · 当前第 3 步",
  },
  failed: {
    idx: 2,
    status: ["completed", "completed", "failed", "pending", "pending"],
    note: "第 3 步失败 · 失败标记保持可见",
  },
  done: {
    idx: 4,
    status: ["completed", "completed", "completed", "completed", "completed"],
    note: "全部完成 · 2.5 秒后自动隐藏胶囊",
  },
};
var planController = ArtemisPatterns.taskPlan(planRoot, {
  trigger: planTrig,
  list: planList,
  marker: planMarker,
  label: planLabel,
  steps: PLAN_STEPS,
  index: 2,
  statuses: PLAN_CASES.run.status,
  onChange: function (state) {
    if (state === "hidden")
      planStateEl.textContent = "胶囊已自动隐藏 · 点击「进行中」恢复";
  },
});
function planRender(name) {
  var data = PLAN_CASES[name];
  if (!data) return;
  planStateEl.textContent = data.note;
  planController.update({
    steps: PLAN_STEPS,
    index: data.idx,
    statuses: data.status,
  });
}
window.__planSet = planRender;

document.querySelectorAll("[data-plan-state]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll("[data-plan-state]").forEach(function (other) {
      other.setAttribute("aria-pressed", String(other === btn));
    });
    planRender(btn.dataset.planState);
  });
});
planRender("run");

/* ===== 动效节奏播放 ===== */
var motionBtn = document.getElementById("motionBtn"),
  motionBar = document.getElementById("motionBar");
motionBtn.addEventListener("click", function () {
  motionBar.style.transition = "none";
  motionBar.style.width = "0";
  requestAnimationFrame(function () {
    motionBar.style.transition = "width 900ms cubic-bezier(0.32,0.72,0,1)";
    motionBar.style.width = "100%";
  });
});
/* ===== 独立输入区自适应 ===== */
var soloTa = document.getElementById("soloTa");
if (soloTa)
  soloTa.addEventListener("input", function () {
    soloTa.style.height = "auto";
    soloTa.style.height = Math.min(soloTa.scrollHeight, 120) + "px";
  });
/* ===== 附件芯片移除（独立卡） ===== */
document.querySelectorAll(".ctx-chip button").forEach(function (b) {
  if (!b.closest("#attachRow"))
    b.addEventListener("click", function () {
      b.closest(".ctx-chip").remove();
    });
});

/* ===== Browser 导航状态机 ===== */
var urlInput = document.getElementById("urlInput"),
  bvLoad = document.getElementById("bvLoad"),
  bvText = document.getElementById("bvText");
var navStack = ["https://artemis.dev/docs"],
  navIdx = 0;
function refreshNav() {
  document.getElementById("navBack").disabled = navIdx <= 0;
  document.getElementById("navFwd").disabled = navIdx >= navStack.length - 1;
}
function navigate(url) {
  navStack = navStack.slice(0, navIdx + 1);
  navStack.push(url);
  navIdx++;
  urlInput.value = url;
  refreshNav();
  bvLoad.style.width = "0";
  bvText.textContent = "加载中…";
  requestAnimationFrame(function () {
    bvLoad.style.width = "70%";
  });
  setTimeout(function () {
    bvLoad.style.width = "100%";
    bvText.textContent = "已加载 " + url;
    setTimeout(function () {
      bvLoad.style.width = "0";
    }, 400);
  }, 700);
}
urlInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") navigate(urlInput.value);
});
document.getElementById("navReload").addEventListener("click", function () {
  navigate(navStack[navIdx]);
  navIdx--;
  navStack.pop();
});
document.getElementById("navBack").addEventListener("click", function () {
  if (navIdx > 0) {
    navIdx--;
    urlInput.value = navStack[navIdx];
    bvText.textContent = "已加载 " + navStack[navIdx];
    refreshNav();
  }
});
document.getElementById("navFwd").addEventListener("click", function () {
  if (navIdx < navStack.length - 1) {
    navIdx++;
    urlInput.value = navStack[navIdx];
    bvText.textContent = "已加载 " + navStack[navIdx];
    refreshNav();
  }
});
refreshNav();

/* ===== Markdown/File：生产双态、dirty/save/error、⌘S、plain 阈值 ===== */
var mdBody = document.getElementById("mdBody"),
  mdEdit = document.getElementById("mdEdit"),
  mdView = mdBody.querySelector(".md-view"),
  mdStatus = document.getElementById("mdStatus"),
  mdSave = document.getElementById("mdSave"),
  mdDirty = false;
function setMdMode(mode) {
  document.querySelectorAll("[data-md]").forEach(function (x) {
    x.setAttribute("aria-pressed", String(x.dataset.md === mode));
  });
  mdEdit.hidden = mode !== "source";
  mdView.hidden = mode !== "rich";
}
document.querySelectorAll("[data-md]").forEach(function (t) {
  t.addEventListener("click", function () {
    setMdMode(t.dataset.md);
  });
});
function saveMd() {
  if (!mdDirty) return;
  mdStatus.className = "md-status";
  mdStatus.textContent = "正在保存…";
  mdSave.disabled = true;
  setTimeout(function () {
    mdDirty = false;
    mdStatus.textContent = "已保存";
  }, 80);
}
mdEdit.addEventListener("input", function () {
  mdDirty = true;
  mdStatus.className = "md-status dirty";
  mdStatus.textContent = "未保存";
  mdSave.disabled = false;
});
mdEdit.addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveMd();
  }
});
mdSave.addEventListener("click", saveMd);
document.getElementById("mdImageFail").addEventListener("click", function () {
  mdStatus.className = "md-status error";
  mdStatus.textContent = "图片加载失败：asset.png";
});
setMdMode("rich");
var codeEdit = document.getElementById("codeEdit"),
  codeStatus = document.getElementById("codeStatus");
function saveCode() {
  codeStatus.className = "md-status";
  codeStatus.textContent = "已保存";
}
codeEdit.addEventListener("input", function () {
  codeStatus.className = "md-status dirty";
  codeStatus.textContent = "未保存";
});
codeEdit.addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCode();
  }
});
document.getElementById("codeSave").addEventListener("click", saveCode);
document.getElementById("codePlain").addEventListener("click", function () {
  codeEdit.classList.toggle("plain");
  codeStatus.textContent = codeEdit.classList.contains("plain")
    ? "plain：超过 250KB，关闭高亮"
    : "高亮开启";
});

/* ===== MCP 编辑器：stdio/http、auth、校验、busy/error、移除确认、凭据锁定 ===== */
var mcpEditor = document.getElementById("mcpEditor"),
  mcpErrors = document.getElementById("mcpErrors"),
  mcpCommand = document.getElementById("mcpCommand"),
  mcpAuthField = document.getElementById("mcpAuthField"),
  mcpSave = document.getElementById("mcpSave"),
  mcpRemoveConfirm = document.getElementById("mcpRemoveConfirm");
document.querySelectorAll("[data-mcp-kind]").forEach(function (b) {
  b.addEventListener("click", function () {
    var http = b.dataset.mcpKind === "http";
    document.querySelectorAll("[data-mcp-kind]").forEach(function (x) {
      x.setAttribute("aria-pressed", String(x === b));
    });
    mcpAuthField.hidden = !http;
    mcpCommand.value = http
      ? "https://mcp.example.test/stream"
      : "npx codegraph-mcp";
    document.getElementById("mcpArgs").value = http ? "" : "--stdio";
    document.getElementById("mcpNetwork").checked = http;
  });
});
mcpEditor.addEventListener("submit", function (e) {
  e.preventDefault();
  if (
    !document.getElementById("mcpName").value.trim() ||
    !mcpCommand.value.trim()
  ) {
    mcpErrors.textContent = "名称与命令 / URL 为必填项";
    return;
  }
  if (
    mcpCommand.value.startsWith("http") &&
    !/^https:\/\//.test(mcpCommand.value)
  ) {
    mcpErrors.textContent = "streamable-http 必须使用 HTTPS";
    return;
  }
  mcpErrors.textContent = "";
  mcpEditor.setAttribute("aria-busy", "true");
  mcpSave.disabled = true;
  setTimeout(function () {
    mcpEditor.setAttribute("aria-busy", "false");
    mcpSave.disabled = false;
    document.getElementById("mcpModeBadge").textContent = "已保存";
  }, 80);
});
document.getElementById("mcpRemove").addEventListener("click", function () {
  mcpRemoveConfirm.hidden = false;
  setTimeout(function () {
    mcpRemoveConfirm.focus();
  }, 0);
});
document
  .getElementById("mcpRemoveCancel")
  .addEventListener("click", function () {
    mcpRemoveConfirm.hidden = true;
    document.getElementById("mcpRemove").focus();
  });
document.getElementById("mcpRemoveDo").addEventListener("click", function () {
  mcpRemoveConfirm.hidden = true;
  document.getElementById("mcpModeBadge").textContent = "已移除";
  mcpSave.disabled = true;
});

/* ===== Environment 对话框（复用 dialog 模式） ===== */
function envDlg(title, desc, confirmText) {
  document.getElementById("dlgT").textContent = title;
  document.getElementById("dlgD").textContent = desc;
  var c = document.getElementById("dlgConfirm");
  c.textContent = confirmText;
  c.className = "btn btn-primary";
  UI.enhance(c);
  UI.dialog(document.getElementById("overlay")).open(document.activeElement);
}
document.getElementById("envCommit").addEventListener("click", function () {
  envDlg("提交更改", "将当前工作区的 4 个变更文件提交到 main 分支。", "提交");
});
document.getElementById("envPush").addEventListener("click", function () {
  envDlg("推送到远端", "推送 main 分支的 3 个提交到 origin。", "推送");
});
document.getElementById("envBranch").addEventListener("click", function () {
  envDlg("切换分支", "从 main 切换到其他分支，未提交的更改将被保留。", "切换");
});

/* ===== 多组问答：单卡滑动切换 ===== */
(function () {
  var mi = document.getElementById("multiInput");
  if (!mi) return;
  var track = document.getElementById("uqTrack");
  var slides = Array.prototype.slice.call(track.querySelectorAll(".uq-slide"));
  var dotsBox = document.getElementById("uqDots");
  var prev = document.getElementById("uqPrev"),
    next = document.getElementById("uqNext");
  var title = document.getElementById("uqTitle"),
    bar = document.getElementById("ucpBar"),
    txt = document.getElementById("ucpTxt");
  var idx = 0,
    answers = new Array(slides.length).fill(null);
  // 建点
  slides.forEach(function (s, i) {
    var slideId = "uqSlide" + (i + 1),
      dotId = "uqDot" + (i + 1);
    s.id = slideId;
    s.setAttribute("role", "tabpanel");
    s.setAttribute("aria-labelledby", dotId);
    var d = document.createElement("button");
    d.id = dotId;
    d.className = "uq-dot";
    d.setAttribute("role", "tab");
    d.setAttribute("aria-controls", slideId);
    d.setAttribute("aria-label", "第 " + (i + 1) + " 题 " + s.dataset.q);
    d.addEventListener("click", function () {
      go(i, false);
    });
    dotsBox.appendChild(d);
  });
  var dots = Array.prototype.slice.call(dotsBox.children);
  function answered() {
    return answers.filter(function (a) {
      return a !== null;
    }).length;
  }
  function go(i, focusDot) {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    track.style.transform = "translateX(-" + idx * 100 + "%)";
    title.textContent =
      "配置发布 · 第 " + (idx + 1) + "/" + slides.length + " 题";
    prev.disabled = idx === 0;
    next.disabled = idx === slides.length - 1;
    dots.forEach(function (d, j) {
      d.classList.toggle("cur", j === idx);
      d.classList.toggle("done", answers[j] !== null && j !== idx);
      d.setAttribute("aria-selected", String(j === idx));
      d.tabIndex = j === idx ? 0 : -1;
    });
    slides.forEach(function (s, j) {
      s.setAttribute("aria-hidden", String(j !== idx));
    });
    if (focusDot) dots[idx].focus();
    bar.style.width = (answered() / slides.length) * 100 + "%";
    txt.textContent = "已答 " + answered() + "/" + slides.length;
    if (window.__ucReset) window.__ucReset(); // 每题独立 5 分钟（对齐真实产品：每组问答独立请求）
  }
  slides.forEach(function (s, i) {
    s.addEventListener("click", function (e) {
      var opt = e.target.closest(".uinput-opt");
      if (!opt) return;
      s.querySelectorAll(".uinput-opt").forEach(function (o) {
        o.classList.remove("sel");
      });
      opt.classList.add("sel");
      answers[i] = opt.textContent.trim();
      go(idx); // 刷新进度与点
    });
  });
  prev.addEventListener("click", function () {
    go(idx - 1, false);
  });
  next.addEventListener("click", function () {
    go(idx + 1, false);
  });
  dotsBox.addEventListener("keydown", function (e) {
    var at = dots.indexOf(document.activeElement);
    if (at < 0) return;
    var target = at;
    if (e.key === "ArrowLeft") target = (at - 1 + dots.length) % dots.length;
    else if (e.key === "ArrowRight") target = (at + 1) % dots.length;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = dots.length - 1;
    else return;
    e.preventDefault();
    go(target, true);
  });
  mi.addEventListener("keydown", function (e) {
    if (e.target.closest("#uqDots")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(idx - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(idx + 1);
    }
  });
  mi.setAttribute("tabindex", "0");
  go(0);
})();

/* ===== 17/17b 倒计时：默认 5 分钟（user-input-policy.ts），格式 M:SS（user-input-countdown.ts，Math.ceil）=====
     demo 到 0:00 后回卷 5:00 循环演示；真实产品到时自动采用推荐项并显示「5 分钟未选择，已采用模型推荐项」 */
(function () {
  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function dotState(sec) {
    return sec <= 15 ? "danger" : sec <= 60 ? "warn" : "";
  }
  function makeTimer(elId, dotId) {
    var el = document.getElementById(elId),
      dot = document.getElementById(dotId),
      s = 300;
    function render(sec) {
      s = Math.max(0, Math.min(300, sec));
      el.textContent = fmt(s);
      el.dataset.rem = String(s);
      if (dot) {
        var st = dotState(s);
        dot.classList.toggle("warn", st === "warn");
        dot.classList.toggle("danger", st === "danger");
      }
    }
    render(300);
    var iv = setInterval(function () {
      render(s - 1 > 0 ? s - 1 : 300);
    }, 1000); // demo 到 0 回卷
    return {
      set: render,
      stop: function () {
        clearInterval(iv);
      },
      el: el,
    };
  }
  window.__ucTimers = {};
  var t17 = document.getElementById("ucCount17")
    ? makeTimer("ucCount17", "ucDot17")
    : null;
  if (t17) window.__ucTimers.t17 = t17;
  var t17b = document.getElementById("ucCount17b")
    ? makeTimer("ucCount17b", "ucDot17b")
    : null;
  if (t17b) window.__ucTimers.t17b = t17b;
  window.__ucReset = function () {
    if (t17b) t17b.set(300);
  };
  window.__ucSet = function (sec) {
    if (t17) t17.set(sec);
    if (t17b) t17b.set(sec);
  }; // 演示/测试：直达任意剩余秒数
})();

/* ---------- URL hash 状态（截图/分享直达）: #d=a|b|c & t=light|dark & c=normal|high & dialog=1 & goto=<spec编号> ---------- */
(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  var booted = false; // goto / dialog 为一次性动作，仅初始加载执行
  function applyHash() {
    var hp;
    try {
      hp = new URLSearchParams(location.hash.slice(1));
    } catch (e) {
      return;
    }
    if (!hp.toString()) return;
    var pendD = hp.get("d"),
      pendT = hp.get("t"),
      pendC = hp.get("c");
    function applyViaSetter() {
      if (!(window.__setState && window.__setState.d))
        return setTimeout(applyViaSetter, 30);
      if (pendD) window.__setState.d(pendD);
      if (pendT) window.__setState.t(pendT);
      if (pendC) window.__setState.c(pendC);
    }
    if (pendD || pendT || pendC) ready(applyViaSetter);
    if (booted) return;
    booted = true;
    ready(function () {
      var g = hp.get("goto");
      if (g) {
        var spec = Array.prototype.find.call(
          document.querySelectorAll(".spec"),
          function (s) {
            var no = s.querySelector(".spec-h .no");
            return no && no.textContent.trim() === g;
          },
        );
        if (spec)
          setTimeout(function () {
            spec.scrollIntoView({ behavior: "instant", block: "start" });
          }, 60);
      }
      if (hp.get("dialog") === "1") {
        var btn = document.getElementById("openDlg");
        if (btn)
          setTimeout(function () {
            btn.click();
          }, 80);
      }
    });
  }
  applyHash();
  window.addEventListener("hashchange", applyHash); // hash 实时同步（同页改 hash 即生效）
})();

/* ===== 17 · 用户输入请求：普通选项即点即答；自定义输入进入兄弟行编辑（Enter 提交 / Esc 取消） ===== */
(function () {
  var opt = document.getElementById("optCustom"),
    row = document.getElementById("optEditRow"),
    inp = document.getElementById("ucEdit");
  if (!opt || !row || !inp) return;
  var card = opt.closest(".uinput-card");

  function clearSel() {
    card.querySelectorAll(".uinput-opt.sel").forEach(function (x) {
      x.classList.remove("sel");
    });
  }
  function dropResult() {
    card.querySelectorAll(".uc-result.dynamic").forEach(function (x) {
      x.remove();
    });
  }
  function exitEdit() {
    row.classList.remove("open");
    inp.value = "";
  }
  function doneWith(label) {
    // 对齐真实产品：作答后卡片切结果态并锁定
    dropResult();
    var res = document.createElement("div");
    res.className = "uc-result dynamic";
    var sp = document.createElement("span");
    sp.textContent = "已选择";
    var st = document.createElement("strong");
    st.textContent = label;
    res.appendChild(sp);
    res.appendChild(st);
    card.insertBefore(res, card.querySelector(".uc-timeout"));
    var to = card.querySelector(".uc-timeout");
    if (to) to.style.display = "none";
    card.classList.add("done");
    exitEdit();
    if (window.__ucTimers && window.__ucTimers.t17)
      window.__ucTimers.t17.stop();
  }
  function labelText(btn) {
    // 编号块后的纯文本
    var clone = btn.cloneNode(true);
    var k = clone.querySelector(".uo-k");
    if (k) k.remove();
    var l = clone.querySelector(".uo-label");
    return (l ? l.textContent : clone.textContent).trim();
  }

  card.querySelectorAll(".uinput-opt").forEach(function (btn) {
    if (btn === opt || btn === row) return;
    btn.addEventListener("click", function () {
      if (card.classList.contains("done")) return;
      clearSel();
      btn.classList.add("sel");
      doneWith(labelText(btn));
    });
  });

  opt.addEventListener("click", function () {
    if (card.classList.contains("done")) return;
    clearSel();
    opt.classList.add("sel");
    opt.style.display = "none"; // 编辑态离开 button，输入行顶替原位
    row.classList.add("open");
    inp.focus();
  });
  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      var v = inp.value.trim();
      if (v) {
        doneWith(v);
        opt.style.display = "";
      } else {
        exitEdit();
        opt.style.display = "";
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
      exitEdit();
      opt.style.display = "";
    }
  });
})();

UI.enhance(document);
