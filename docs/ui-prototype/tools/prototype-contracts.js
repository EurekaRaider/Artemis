(function () {
  "use strict";

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function key(target, value, init) {
    target.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: value, bubbles: true, cancelable: true }, init || {})));
  }
  function input(target, value) {
    if (value !== undefined) target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  window.runPrototypeContracts = async function () {
    var failures = [], targetResults = {}, cardResults = {};
    function assert(card, name, condition, detail) {
      var result = { name: name, ok: Boolean(condition), detail: detail || "" };
      (targetResults[card] || (targetResults[card] = [])).push(result);
      if (!condition) failures.push(card + " / " + name + (detail ? ": " + detail : ""));
    }
    function q(selector) { return document.querySelector(selector); }
    function qa(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

    var specs = qa(".spec[data-card]");
    var ids = specs.map(function (spec) { return spec.dataset.card; });
    specs.forEach(function (spec) {
      var id = spec.dataset.card, generic = [];
      generic.push({ name: "header", ok: Boolean(spec.querySelector(".spec-h")) });
      generic.push({ name: "body", ok: Boolean(spec.querySelector(".spec-b")) });
      generic.push({ name: "visible-title", ok: Boolean((spec.querySelector(".name") || {}).textContent) });
      cardResults[id] = { ok: generic.every(function (item) { return item.ok; }), generic: generic, targeted: [] };
    });
    if (specs.length !== 70) failures.push("catalog / card-count: expected 70, got " + specs.length);
    if (new Set(ids).size !== ids.length) failures.push("catalog / duplicate-card-id");
    var domIds = qa("[id]").map(function (el) { return el.id; });
    if (new Set(domIds).size !== domIds.length) failures.push("catalog / duplicate-dom-id");

    var sizeCard = q('[data-card="cat-icons-02"]');
    assert("cat-icons-02", "five-size-tiers", ["xs", "sm", "lg", "xl"].every(function (c) { return sizeCard.querySelector("svg.ic." + c); }) && sizeCard.querySelector("svg.ic:not(.xs):not(.sm):not(.lg):not(.xl)"), "xs/sm/base/lg/xl");
    var iconNames = qa('[data-card="cat-icons-03"] .ic-name').map(function (n) { return n.textContent.trim(); });
    assert("cat-icons-03", "98-unique-icons", iconNames.length === 98 && new Set(iconNames).size === 98, "count=" + iconNames.length + ", unique=" + new Set(iconNames).size);

    var typeCard = q('[data-card="cat-input-03"]');
    ["password", "url", "number", "date", "file"].forEach(function (type) { assert("cat-input-03", type + "-field", Boolean(typeCard.querySelector('input[type="' + type + '"]')), type); });

    var tabs = qa("#tabsDemo [role=tab]"); tabs[0].focus(); key(tabs[0], "ArrowRight");
    assert("cat-data-01", "roving-arrow", document.activeElement === tabs[1] && tabs[1].tabIndex === 0 && tabs[0].tabIndex === -1, q("#tabsState").textContent);
    key(tabs[1], "End"); assert("cat-data-01", "end-selects-last", document.activeElement === tabs[2] && tabs[2].getAttribute("aria-selected") === "true");

    var activity = qa(".act-btn"); activity[1].click();
    assert("cat-data-02", "single-current-page", qa('.act-btn[aria-current="page"]').length === 1 && activity[1].getAttribute("aria-current") === "page", q("#activityState").textContent);
    assert("cat-data-03", "breadcrumb-current", Boolean(q('[data-card="cat-data-03"] nav[aria-label="面包屑"] [aria-current="page"]')));

    var dockTabs = q("#dockTabs"), dockFirst = dockTabs.querySelector('[role="tab"]'); dockFirst.focus(); key(dockFirst, "ArrowRight");
    assert("cat-data-04", "dock-roving", document.activeElement === dockTabs.querySelectorAll('[role="tab"]')[1]);
    while (dockTabs.querySelector(".dt-x")) dockTabs.querySelector(".dt-x").click();
    assert("cat-data-04", "empty-launcher", dockTabs.hidden && q("#dockLauncher").getAttribute("data-empty") === "true");
    q('#dockLauncher [data-launch="终端"]').click();
    assert("cat-data-04", "launcher-restores-tab", Boolean(dockTabs.querySelector('[data-dock-name="终端"][aria-selected="true"]')) && document.activeElement === dockTabs.querySelector('[data-dock-name="终端"]'));
    q('#dockLauncher [aria-disabled="true"]').click();
    assert("cat-data-04", "unavailable-does-not-open", !dockTabs.querySelector('[data-dock-name="不可用"]'), q("#dockState").textContent);

    var split = q("#splitSep"); split.focus(); key(split, "End");
    assert("cat-data-05", "pixel-end-clamped", split.getAttribute("aria-valuenow") === split.getAttribute("aria-valuemax") && /px/.test(q("#splitState").textContent));
    q("#splitClose").click(); assert("cat-data-05", "closed-not-tabbable", split.tabIndex === -1 && split.getAttribute("aria-disabled") === "true");
    q("#splitClose").click();

    async function treeContract(card, treeId, menuId) {
      var tree = q(treeId), rows = qa(treeId + ' [role="treeitem"]'), more = tree.querySelector(".tree-more"), menu = q(menuId);
      rows[0].focus(); key(rows[0], "ArrowDown");
      assert(card, "tree-roving", document.activeElement === rows[1] && rows[1].tabIndex === 0);
      key(rows[1], "Enter"); assert(card, "tree-select", rows[1].getAttribute("aria-selected") === "true");
      more.click(); await wait(0); assert(card, "menu-opens-and-focuses", more.getAttribute("aria-expanded") === "true" && menu.contains(document.activeElement));
      key(menu, "Escape"); assert(card, "menu-escape-restores-focus", document.activeElement === more && more.getAttribute("aria-expanded") === "false");
      assert(card, "three-levels-and-drop", ["1", "2", "3"].every(function (level) { return tree.querySelector('[aria-level="' + level + '"]'); }) && Boolean(tree.querySelector("[data-drop]")) && Boolean(tree.querySelector(".running-mark")));
    }
    await treeContract("cat-data-07", "#rowTreeDemo", "#rowTreeMenu");
    await treeContract("cat-data-08", "#treeDemo", "#treeMenu");

    assert("cat-data-09", "card-and-stat-variants", qa('[data-card="cat-data-09"] .card').length >= 1 && qa('[data-card="cat-data-09"] .stat-card').length >= 1);
    assert("cat-data-12", "heatmap-and-terminal", qa("#heatmapDemo .hm-cell").length === 56 && Boolean(q('[data-card="cat-data-12"] .terminal')));

    var sourceButtons = qa('[data-card="cat-sources-01"] [data-open-source]'); sourceButtons[0].click();
    assert("cat-sources-01", "four-source-open-controls", new Set(sourceButtons.map(function (b) { return b.dataset.openSource; })).size === 4 && /已打开来源/.test(q("#sourcesState").textContent), "count=" + sourceButtons.length);
    q("#sourcesLoading").click(); assert("cat-sources-01", "loading-state", /正在加载/.test(q("#sourcesState").textContent));
    q("#sourcesError").click(); assert("cat-sources-01", "error-state", q("#sourcesState").getAttribute("role") === "alert");
    assert("cat-sources-02", "web-error-retry", !q("#webSourceError").hidden && Boolean(q("#webSourceRetry")));
    q("#webSourceRetry").click(); assert("cat-sources-02", "web-retry-recovers", q("#webSourceError").hidden && /成功/.test(q("#sourcesState").textContent));
    var mcpCall = q("[data-mcp-call]"); mcpCall.click(); assert("cat-sources-03", "mcp-detail", /调用详情/.test(q("#mcpSourceDetail").textContent) && /title/.test(q("#mcpSourceDetail").textContent));

    var goal = q("#goalInput"); input(goal, goal.value + " v17");
    assert("cat-sources-06", "goal-dirty", goal.classList.contains("dirty") && /未保存/.test(q("#goalStatus").textContent));
    key(goal, "Enter", { ctrlKey: true }); assert("cat-sources-06", "goal-saving-busy", q("#goalEditor").getAttribute("aria-busy") === "true");
    await wait(100); assert("cat-sources-06", "goal-saved", q("#goalEditor").getAttribute("aria-busy") === "false" && /已保存/.test(q("#goalStatus").textContent));
    q('[data-goal-state="load-error"]').click(); assert("cat-sources-06", "goal-error", q("#goalStatus").classList.contains("error"));
    q("#goalStaleRetry").click(); assert("cat-sources-07", "stale-busy", q("#goalStale").getAttribute("aria-busy") === "true");
    await wait(100); assert("cat-sources-07", "stale-recovered", !q("#goalStale").classList.contains("stale") && !q("#goalStaleSave").disabled);

    var prStates = qa("[data-pr-state]"); prStates.forEach(function (b) { b.click(); });
    assert("cat-sources-08", "six-check-states", prStates.length === 6 && /none/.test(q("#prState").textContent));
    assert("cat-sources-08", "three-coverage-warnings", qa(".coverage-warning").length === 3);
    q("#openChecks").click(); await wait(0); assert("cat-sources-08", "checks-dialog-focus", !q("#checksDialog").hidden && document.activeElement === q("#checksDialog"));
    key(q("#checksDialog"), "Escape"); assert("cat-sources-08", "checks-focus-return", q("#checksDialog").hidden && document.activeElement === q("#openChecks"));

    q('[data-md="source"]').click(); var md = q("#mdEdit"); input(md);
    assert("cat-artemis-11", "markdown-dual-dirty", !md.hidden && /未保存/.test(q("#mdStatus").textContent));
    key(md, "s", { ctrlKey: true }); await wait(100); assert("cat-artemis-11", "markdown-shortcut-save", /已保存/.test(q("#mdStatus").textContent));
    q("#mdImageFail").click(); assert("cat-artemis-11", "markdown-image-error", q("#mdStatus").classList.contains("error"));
    var code = q("#codeEdit"); assert("cat-artemis-11", "file-editor-nowrap", code.getAttribute("wrap") === "off"); q("#codePlain").click(); assert("cat-artemis-11", "file-editor-plain-threshold", code.classList.contains("plain")); input(code, code.value + "x"); key(code, "s", { metaKey: true }); assert("cat-artemis-11", "file-editor-shortcut-save", /已保存/.test(q("#codeStatus").textContent));

    q('[data-mcp-kind="http"]').click();
    assert("cat-artemis-13", "mcp-http-mode", !q("#mcpAuthField").hidden && q("#mcpNetwork").checked && /^https:/.test(q("#mcpCommand").value));
    q("#mcpName").value = ""; q("#mcpSave").click(); assert("cat-artemis-13", "mcp-validation", /必填/.test(q("#mcpErrors").textContent));
    q("#mcpName").value = "codegraph"; q("#mcpRemove").click(); await wait(0); assert("cat-artemis-13", "mcp-remove-confirm-focus", !q("#mcpRemoveConfirm").hidden && document.activeElement === q("#mcpRemoveConfirm"));
    q("#mcpRemoveCancel").click(); assert("cat-artemis-13", "mcp-remove-focus-return", document.activeElement === q("#mcpRemove"));
    assert("cat-artemis-13", "credential-lock-and-permissions", /凭据/.test(q("#mcpCredentialLock").textContent) && Boolean(q("#mcpFullAccess")));

    var queue = q("#queueList"), second = queue.children[1]; second.querySelector('[data-act="front"]').click();
    assert("cat-artemis-15", "queue-move-front", queue.firstElementChild === second && queue.firstElementChild.querySelector(".qi-n").textContent === "1");
    second.querySelector('[data-act="edit"]').click(); var edit = second.querySelector(".qi-edit-input"); input(edit, "已编辑的排队消息"); key(edit, "Enter", { ctrlKey: true });
    assert("cat-artemis-15", "queue-inline-edit", /已编辑/.test(second.querySelector(".qi-t").textContent) && !second.classList.contains("editing"));
    second.querySelector('[data-act="busy"]').click(); assert("cat-artemis-15", "queue-busy", second.getAttribute("aria-busy") === "true" && second.querySelector('[data-act="del"]').disabled);

    var dots = qa("#uqDots [role=tab]"); dots[0].focus(); key(dots[0], "ArrowRight");
    assert("cat-artemis-18", "question-roving", document.activeElement === dots[1] && dots[1].tabIndex === 0 && dots[0].tabIndex === -1);
    assert("cat-artemis-18", "tabpanel-wiring", dots.every(function (dot) { var panel = q("#" + dot.getAttribute("aria-controls")); return panel && panel.getAttribute("aria-labelledby") === dot.id; }));
    q("#uqTrack .uq-slide:nth-child(2) .uinput-opt").click(); assert("cat-artemis-18", "independent-answer-progress", /已答 1\/3/.test(q("#ucpTxt").textContent));

    Object.keys(targetResults).forEach(function (card) {
      if (!cardResults[card]) { failures.push("target / unknown-card: " + card); return; }
      cardResults[card].targeted = targetResults[card];
      cardResults[card].ok = cardResults[card].ok && targetResults[card].every(function (item) { return item.ok; });
    });
    var targetedCards = Object.keys(targetResults);
    if (targetedCards.length !== 22) failures.push("catalog / targeted-card-count: expected 22, got " + targetedCards.length);
    var passedCards = Object.keys(cardResults).filter(function (card) { return cardResults[card].ok; }).length;
    return {
      version: "v17",
      ok: failures.length === 0 && passedCards === 70,
      totalCards: specs.length,
      passedCards: passedCards,
      targetedCards: targetedCards.length,
      failures: failures,
      cardResults: cardResults
    };
  };
})();
