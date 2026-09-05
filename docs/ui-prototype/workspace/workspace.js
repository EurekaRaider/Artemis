/* IM-only static interactions. No IPC, network requests, or credential storage. */
(function () {
  "use strict";
  const root = document.getElementById("settingsPanelIm");
  const fixtures = window.ImPrototypeFixtures;
  const platforms = fixtures.platforms;
  const params = new URLSearchParams(location.hash.slice(1));
  let state = fixtures.create(params.get("im-fixture") || (params.get("im") === "wizard" ? "wizard" : "manage"));
  let view = params.get("im-view") || (state.channels.feishu.saved ? "feishu" : "wecom");
  let currentChannel = platforms[view] ? view : (state.channels.feishu.saved ? "feishu" : "wecom");
  let wizardDetail = null, editing = null, unbinding = null, menuOpen = false;
  let feedback = "", feedbackError = false, diagnostics = false;
  const opened = new Set(), drafts = { wecom: {}, feishu: {}, slack: {} };
  const common = { gateway: "Gateway 与设备", pairing: "配对与账号", permissions: "项目授权", spaces: "群协作空间" };
  const views = [...Object.keys(platforms), ...Object.keys(common)];
  let grants = structuredClone(state.grants), defaultProjectId = state.defaultProjectId;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const connected = () => Object.values(state.channels).some((channel) => channel.connections.some((connection) => connection.state === "connected"));
  const managed = () => connected() && Object.values(state.channels).some((channel) => channel.identities.length);
  const allIdentities = () => Object.entries(state.channels).flatMap(([channel, value]) => value.identities.map((identity) => ({ ...identity, channel })));
  const channelKey = () => platforms[view] ? view : currentChannel;
  const disabled = (condition) => condition ? " disabled" : "";
  function btn(label, action, attrs = "") { return '<button type="button" class="im-btn" data-im-action="' + action + '" ' + attrs + ">" + esc(label) + "</button>"; }
  function primary(label, action, attrs = "") { return btn(label, action, attrs).replace('class="im-btn"', 'class="im-btn primary"'); }
  function field(id, label, value = "", placeholder = "", secret = false, attrs = "") {
    return '<label class="im-field" for="' + id + '"><span>' + esc(label) + '</span><input class="im-input" id="' + id + '" name="' + id + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" type="' + (secret ? "password" : "text") + '" autocomplete="off" ' + attrs + "></label>";
  }
  function select(id, label, value, options, attrs = "") {
    return '<label class="im-field" for="' + id + '"><span>' + esc(label) + '</span><select class="im-select" id="' + id + '" ' + attrs + ">" + options.map(([key, text]) => '<option value="' + esc(key) + '"' + (key === value ? " selected" : "") + ">" + esc(text) + "</option>").join("") + "</select></label>";
  }
  function check(id, label, checked, attrs = "") { return '<label class="im-check"><input type="checkbox" id="' + id + '"' + (checked ? " checked" : "") + " " + attrs + ">" + esc(label) + "</label>"; }
  function details(id, label, body) { return '<details id="' + id + '"' + (opened.has(id) ? " open" : "") + "><summary>" + esc(label) + "</summary>" + body + "</details>"; }
  function block(title, body) { return '<section class="im-block"><h4>' + esc(title) + "</h4>" + body + "</section>"; }
  function notice(text, tone = "") { return '<p class="im-notice ' + tone + '">' + esc(text) + "</p>"; }
  function pill(label, tone = "idle") { return '<span class="im-status-pill"><span class="im-dot ' + tone + '" aria-hidden="true"></span>' + esc(label) + "</span>"; }
  function connectionState(channel) {
    const list = state.channels[channel].connections;
    if (list.some((connection) => connection.state === "error")) return ["连接错误", "bad"];
    if (list.some((connection) => connection.state === "connected")) return ["已连接", "ok"];
    if (list.some((connection) => connection.state === "connecting")) return ["连接中", "pending"];
    return ["未配置", "idle"];
  }
  function overall() {
    if (!state.device.id || !Object.values(state.channels).some((channel) => channel.saved)) return ["未配置", "idle"];
    if (!state.enabled) return ["已暂停", "idle"];
    if (Object.values(state.channels).some((channel) => channel.connections.some((connection) => connection.state === "error"))) return ["连接错误", "bad"];
    return connected() ? ["已连接", "ok"] : ["连接中", "pending"];
  }
  function steps() {
    return [
      ["gateway", "准备 Gateway", "一键启动内置服务，或连接团队服务。", !!state.gateway.url],
      ["gateway", "注册这台电脑", state.device.id ? "设备编号 " + state.device.id + " · 无需重复注册" : "内置服务会自动注册；团队服务需管理员协助。", !!state.device.id],
      [channelKey(), "连接一个机器人", "选择企业微信、飞书或 Slack；团队已配置时可跳过填写。", connected()],
      ["pairing", "绑定你的 IM 账号", "把一次性指令发给机器人，收到“配对成功”。", allIdentities().length > 0],
      ["permissions", "选择项目并启用", "先用 Plan 模式，选择项目后保存并启用。", state.enabled && state.grants.some((grant) => grant.expiresAt > Date.now())],
      ["test", "发送第一条任务", "在 IM 里完成测试，并核对桌面上的同一任务。", false],
    ];
  }
  function guide() {
    const list = steps(), current = list.findIndex((step) => !step[3]);
    return '<ol class="im-setup-steps" aria-label="IM 设置步骤">' + list.map(([target, title, description, done], index) => '<li class="im-step"><button type="button" data-im-step="' + target + '"' + (index === current ? ' aria-current="step"' : "") + '><span class="im-step-number">' + (done ? "✓" : index + 1) + '</span><span><strong>' + esc(title) + "</strong>" + (done || index === current ? "<small>" + esc(description) + "</small>" : "") + '</span><span class="im-step-state">' + (done ? "已完成" : index === current ? "当前步 →" : "待办") + "</span></button></li>").join("") + "</ol>";
  }
  function platformCards() {
    return '<h4>支持的平台</h4><div class="im-platform-cards">' + Object.entries(platforms).map(([key, platform]) => '<button class="im-platform-card" data-im-step="' + key + '"><strong>' + platform.name + "</strong><span>" + platform.constraint + "</span><small>" + platform.method + "</small></button>").join("") + "</div>";
  }
  function nav() {
    const tab = (id, label, status) => '<button type="button" class="im-channel-card" role="tab" id="im-nav-' + id + '" aria-controls="im-panel-' + id + '" aria-selected="' + (view === id) + '" tabindex="' + (view === id ? "0" : "-1") + '" data-im-view="' + id + '"><span>' + (status ? '<span class="im-dot ' + status[1] + '" aria-hidden="true"></span>' : "") + esc(label) + "</span>" + (status ? "<small>" + status[0] + "</small>" : id === "spaces" ? "<small>高级</small>" : "") + "</button>";
    return '<nav class="im-channel-list" role="tablist" aria-label="消息接入分类" aria-orientation="vertical"><span class="im-nav-label">渠道</span>' + Object.keys(platforms).map((key) => tab(key, platforms[key].name, connectionState(key))).join("") +
      '<div class="im-common-tabs"><span class="im-nav-label">通用</span>' + Object.entries(common).map(([key, label]) => tab(key, label)).join("") + '</div><div class="im-more"><button type="button" class="im-channel-card" id="im-nav-more" role="tab" aria-selected="' + !!common[view] + '" aria-controls="im-panel-' + view + '" aria-haspopup="menu" aria-expanded="' + menuOpen + '" tabindex="' + (common[view] ? 0 : -1) + '" data-im-action="more"><span>通用 ▾</span></button><div class="im-more-menu" role="menu" aria-label="通用设置"' + (menuOpen ? "" : " hidden") + ">" +
      Object.entries(common).map(([key, label]) => '<button type="button" role="menuitem" tabindex="-1" data-im-common="' + key + '">' + label + (key === "spaces" ? " · 高级" : "") + "</button>").join("") + "</div></div></nav>";
  }
  function bindings(channel) {
    const list = channel ? state.channels[channel].identities.map((identity) => ({ ...identity, channel })) : allIdentities();
    if (!list.length) return '<p class="im-muted">尚未绑定账号。到“配对与账号”生成一次性配对码。</p>';
    return '<ul class="im-binding-list">' + list.map((identity) => {
      const key = identity.channel + ":" + identity.id, confirming = unbinding === key;
      return '<li class="im-binding-row" data-binding="' + esc(key) + '"><div class="im-binding-main"><strong>' + esc(identity.name) + '</strong><span class="im-muted"><code>' + esc(identity.id) + "</code> · " + identity.mode + (channel ? "" : " · " + platforms[identity.channel].name) + "</span></div>" +
        (confirming ? '<div class="im-unbind-confirm"><p>确认解除与该账号的绑定？</p><div class="im-actions">' + btn("确认解除", "confirm-unbind", 'class="im-btn danger" id="im-confirm-unbind"').replace('class="im-btn" ', "") + btn("保留", "keep-binding") + "</div></div>" : btn("解除绑定", "unbind", 'data-identity="' + esc(key) + '" id="im-unbind-' + esc(identity.id) + '"')) + "</li>";
    }).join("") + "</ul>";
  }
  function channelPanel(channel) {
    const platform = platforms[channel], data = state.channels[channel];
    const formFields = (fields) => fields.map(([key, label, placeholder, secret]) => field("im-credential-" + key, label, drafts[channel][key] ?? "", placeholder, secret, 'data-credential="' + key + '"' + (!label.includes("可选") ? " required" : ""))).join("");
    const request = data.pairingAwaiting ? '<div class="im-pairing-card" role="status"><strong>配对请求 · 待确认</strong><span>' + esc(data.pairingAwaiting.name) + ' · <code>' + esc(data.pairingAwaiting.id) + '</code></span><div class="im-actions">' + primary("批准", "approve-pair") + btn("拒绝", "reject-pair") + '</div></div>' : "";
    let credentials = data.saved && editing !== channel ? '<div class="im-row"><p class="im-muted">凭据已保存，密钥不会回显。</p>' + btn("已保存 · 更换", "edit-credentials", 'id="im-edit-credentials"') + "</div>" :
      '<form class="im-form" id="im-credential-form">' + (!data.saved ? '<p class="im-muted">还没有保存' + platform.name + "应用凭据。</p>" : "") + formFields(platform.fields) + (platform.advanced ? details("im-slack-advanced", "高级：连接名称与多个工作区", formFields(platform.advanced)) : "") +
      (state.gateway.mode === "team" ? field("im-bot-admin", "Gateway 管理凭据", "", "保存后自动清空", true, "required") : "") +
      (channel === "feishu" && state.gateway.mode === "local" ? notice("飞书需要公网 HTTPS 回调，请先在“Gateway 与设备”连接团队服务。", "warning") : "") +
      '<div class="im-actions"><button class="im-btn primary" type="submit"' + disabled(!state.device.id || (channel === "feishu" && state.gateway.mode === "local")) + ">保存并连接</button>" + (data.saved ? btn("取消", "cancel-credentials", 'id="im-cancel-credentials"') : "") + "</div></form>";
    const callback = state.gateway.url + "/channels/feishu/" + (data.connections[0]?.id || "连接ID");
    return '<header class="im-detail-header"><div><h3 tabindex="-1" id="im-detail-title">' + platform.name + '</h3><p>' + platform.summary + "</p></div>" + pill(...connectionState(channel)) + "</header>" + request +
      block("应用凭据", credentials) +
      (channel === "feishu" ? block("事件回调地址", data.saved ? '<code class="im-identifier">' + esc(callback) + "</code>" + btn("复制回调地址", "copy", 'data-copy-value="' + esc(callback) + '"') : '<p class="im-muted">保存凭据后生成回调地址。</p>') : "") +
      block("连接状态", data.connections.length ? data.connections.map((connection) => '<div class="im-row"><span><span class="im-dot ' + (connection.state === "connected" ? "ok" : connection.state === "error" ? "bad" : "pending") + '" aria-hidden="true"></span> <code>' + esc(connection.id) + '</code></span><span class="im-muted">' + ({ connected: "已连接", connecting: "连接中", error: "连接错误" })[connection.state] + '</span><time class="im-muted">' + (connection.retry ? "重试 " + connection.retry : connection.updatedAt ? Math.max(0, Math.floor((Date.now() - connection.updatedAt) / 60000)) + " 分钟前" : "") + "</time></div>" + (connection.error ? notice(connection.error, "error") : "")).join("") + btn("刷新连接状态", "refresh-channel") : '<p class="im-muted">尚未连接机器人。</p>') +
      block("已绑定账号", bindings(channel)) +
      details("im-guide-" + channel, platform.name + "接入指引", '<ol class="im-guide">' + platform.guide.map((line) => "<li>" + esc(line) + "</li>").join("") + '</ol><div class="im-chips">' + platform.scopes.map((scope) => '<span class="im-chip">' + esc(scope) + "</span>").join("") + "</div>");
  }
  function gatewayPanel() {
    return block("Gateway 与设备", '<p class="im-muted">内置服务适合个人使用；团队服务适合共享接入和公网回调。</p><div class="im-actions">' + btn("内置 Gateway", "gateway-local", 'aria-pressed="' + (state.gateway.mode === "local") + '"') + btn("团队 Gateway", "gateway-team", 'aria-pressed="' + (state.gateway.mode === "team") + '"') + "</div>") +
      (state.gateway.mode === "local" ? block("内置服务", notice(state.gateway.prepared ? "内置 Gateway 已启动，设备已自动注册。" : "一键启动服务并注册设备，无需输入地址或管理凭据。") + primary(state.gateway.prepared ? "已启动并注册" : "一键启动并注册", "setup-local", disabled(state.gateway.prepared)) + btn("导出独立运行包", "export-gateway")) :
        block("团队服务", '<form id="im-device-form" class="im-form">' + field("im-gateway-url", "Gateway 地址", state.gateway.url, "https://gw.example.com", false, 'required inputmode="url"') + field("im-device-name", "设备名称", state.device.name, "我的电脑", false, "required") + field("im-device-admin", "Gateway 管理凭据", "", "请管理员输入；注册后清空", true, "required") + '<button type="submit" class="im-btn primary"' + disabled(state.enabled) + ">注册当前设备</button>" + (state.enabled ? '<p class="im-muted">注册新设备前，请先暂停顶部的 IM 连接。</p>' : "") + "</form>")) +
      (state.device.id ? block("当前设备", '<p>' + esc(state.device.name) + '</p><code class="im-identifier">' + esc(state.device.id) + "</code>") : "");
  }
  function firstTask() {
    const command = (channelKey() === "slack" ? "" : "/") + "new 请只读检查当前项目，概括项目用途，不要修改文件。";
    return block("试试第一条任务", '<p class="im-muted">将指令发到机器人单聊，再核对桌面上的同一任务。</p><code class="im-identifier">' + esc(command) + "</code>" + btn("复制首条任务指令", "copy", 'data-copy-value="' + esc(command) + '"'));
  }
  function pairingPanel() {
    const channel = channelKey();
    const pairing = state.pairing;
    const command = pairing ? (pairing.channel === "slack" ? "" : "/") + "pair " + pairing.code : "";
    const active = pairing && pairing.expiresAt > Date.now();
    return block("配对与账号", '<p class="im-muted">在本人的机器人单聊发送一次性指令。配对码 5 分钟内有效。</p>' +
      primary("生成一次性配对码", "generate-pair", disabled(!state.device.id || !connected())) +
      (pairing ? '<div class="im-pairing-card"><strong id="im-pair-status">' + (active ? '配对码 · <span class="im-countdown" id="im-pair-countdown"></span> 内有效' : "配对码已过期，请重新生成") + '</strong><code class="im-identifier">' + esc(command) + '</code>' + btn("复制配对指令", "copy", 'id="im-copy-pair" data-copy-value="' + esc(command) + '"' + disabled(!active)) + "</div>" : "") +
      (pairing ? btn("演示：收到配对成功", "simulate-pair", disabled(!active)) : "") +
      '<p class="im-muted">当前演示平台：' + platforms[channel].name + "。</p>") +
      block("已绑定账号", bindings()) + details("im-first-task", "试试第一条任务", firstTask());
  }
  function permissionPanel() {
    return block("项目授权", '<p class="im-muted">只开放你选择的项目。先使用 Plan 只读分析；修改文件时再选择 Execute。</p>') +
      state.projects.map((project) => {
        const grant = grants.find((value) => value.projectId === project.id);
        const id = project.id;
        return '<div class="im-project">' + check("im-project-" + id, project.name, !!grant, 'data-project="' + id + '"') +
          (grant ? details("im-grant-" + id, "授权设置 · " + grant.mode.toUpperCase(), '<div class="im-form">' +
            select("im-mode-" + id, "任务模式", grant.mode, [["plan", "Plan · 只读分析（首次推荐）"], ["review", "Review · 只读审查"], ["execute", "Execute · 允许授权范围内修改"]], 'data-grant="' + id + '" data-property="mode"') +
            select("im-approval-" + id, "执行审批", grant.approval, [["ask", "每次确认"], ["automatic", "授权范围内自动执行"]], 'data-grant="' + id + '" data-property="approval"') +
            check("im-shell-" + id, "允许沙箱命令", grant.shell, 'data-grant="' + id + '" data-property="shell"' + disabled(grant.mode !== "execute")) +
            check("im-network-" + id, "允许命令访问网络", grant.network, 'data-grant="' + id + '" data-property="network"' + disabled(grant.mode !== "execute" || !grant.shell)) +
            field("im-groups-" + id, "允许的协作空间 ID（逗号分隔）", grant.groups.join(", "), "单聊可留空", false, 'data-grant="' + id + '" data-property="groups"') +
            '<div class="im-row"><span class="im-muted">' + (grant.expiresAt <= Date.now() ? "授权已到期：" : "授权到期：") + '<time>' + new Date(grant.expiresAt).toLocaleString("zh-CN") + "</time></span>" + btn("续期 30 天", "renew", 'data-project="' + id + '"') + "</div></div>") : "") + "</div>";
      }).join("") + block("默认项目", select("im-default-project", "默认项目", defaultProjectId, [["", "每次明确选择"], ...state.projects.filter((project) => grants.some((grant) => grant.projectId === project.id)).map((project) => [project.id, project.name])]) +
        primary(grants.length ? "保存并启用连接" : "保存远程授权", "save-grants", disabled(!state.device.id || !connected())));
  }
  function spacePanel() {
    const sample = {
      id: "team-space", name: "研发协作",
      endpoints: [{ connectionId: "conn-1", id: "group-demo", kind: "group" }],
      participants: [{ deviceId: state.device.id, identity: { channel: "feishu", connectionId: "conn-1", tenantId: "tenant-demo", appId: "app-demo", userId: "u_9f3a" }, name: state.device.name }],
      administrators: [{ channel: "feishu", connectionId: "conn-1", tenantId: "tenant-demo", appId: "app-demo", userId: "u_9f3a" }],
    };
    return block("群协作空间 · 高级", '<p class="im-muted">单聊成功后再设置。只有明确发给机器人的协作内容与成果对连接的群可见，普通聊天不会同步。</p>' +
      details("im-space-advanced", "配置群协作空间", '<div class="im-form">' +
        '<ol class="im-guide"><li>成员先单聊配对，再将机器人加入群聊，由已配对管理员 @机器人发送 /help。</li><li>查看成员和群列表，配置空间；每个群由指定管理员确认共享。</li><li>成员在自己的项目授权中加入空间 ID。多 Agent 分派需要 Execute，命令与网络权限单独授权。</li></ol>' +
        (state.gateway.mode === "team" ? field("im-space-admin", "协作空间管理凭据", "", "操作后自动清空", true) : "") +
        btn("查看成员、群聊与诊断", "diagnostics") +
        (diagnostics ? '<div class="im-block"><h4>已配对成员</h4>' + allIdentities().map((identity) => '<p class="im-muted">' + esc(identity.name) + " · " + esc(identity.id) + " · " + platforms[identity.channel].name + "</p>").join("") + '<h4>已发现群聊</h4><code class="im-identifier">conn-1 · group-demo</code><h4>投递状态</h4><p class="im-muted">待投递 0 · 失败 0（演示数据）</p></div>' : "") +
        '<label class="im-field"><span>空间配置（JSON）</span><textarea id="im-space-json" class="im-textarea" spellcheck="false">' + esc(state.spaceDraft ?? "") + "</textarea></label>" +
        '<div class="im-actions">' + btn("填入演示配置", "space-example", 'data-sample="' + esc(JSON.stringify(sample)) + '"') + primary("保存并等待各群确认", "save-space") + "</div>" +
        (state.space ? notice("空间已保存，等待各群管理员 @机器人发送 /space-confirm " + state.space.id + "。修改配置会重新要求确认。") : "") + "</div>"));
  }
  function panel(target) {
    if (platforms[target]) return channelPanel(target);
    if (target === "gateway") return gatewayPanel();
    if (target === "pairing") return pairingPanel();
    if (target === "permissions") return permissionPanel();
    if (target === "spaces") return spacePanel();
    return firstTask();
  }
  function layout() {
    const compact = document.querySelector(".settings-panel").getBoundingClientRect().width / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) < 720;
    root.dataset.compact = String(compact);
    const nav = root.querySelector(".im-channel-list");
    if (nav) {
      nav.setAttribute("aria-orientation", compact ? "horizontal" : "vertical");
      const tabs = [...nav.querySelectorAll('[role="tab"]')].filter((element) => element.getClientRects().length);
      tabs.forEach((tab) => tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1);
      if (tabs.length && !tabs.some((tab) => tab.tabIndex === 0)) tabs[0].tabIndex = 0;
      const activePanel = root.querySelector('.im-detail [role="tabpanel"]:not([hidden])');
      if (activePanel) activePanel.setAttribute("aria-labelledby", compact && common[view] ? "im-nav-more" : "im-nav-" + view);
    }
  }
  function render(focusId) {
    if (!views.includes(view)) view = "feishu";
    const oldFocus = focusId || (root.contains(document.activeElement) ? document.activeElement.id : "");
    const mode = managed() ? "manage" : "wizard";
    root.dataset.mode = mode;
    const guard = !state.device.id ? "请先注册当前设备。" : !connected() ? "请先连接一个机器人。" : "";
    root.innerHTML = '<header class="im-header"><h2>消息接入</h2>' + pill(...(!state.device.id ? ["未配置", "idle"] : overall())) +
      '<label class="im-master-switch">启用<button type="button" id="im-enabled" class="switch' + (state.enabled ? " on" : "") + '" role="switch" aria-label="启用 IM 连接" aria-checked="' + state.enabled + '" aria-describedby="im-switch-reason" data-im-action="toggle-enabled"' + disabled(!!guard) + '></button></label><p id="im-switch-reason">' + (mode === "wizard" ? "首次使用？跟着 6 步完成设置" + (guard ? " · " + guard : "") : "通过 IM 单聊或群协作，把任务交给这台电脑执行") + "</p></header>" +
      (mode === "wizard" ? '<div class="im-wizard">' + (wizardDetail ? btn("返回设置步骤", "back-guide") + panel(wizardDetail) : guide() + platformCards()) + "</div>" :
        '<div class="im-layout">' + nav() + '<div class="im-detail">' + views.map((id) => '<div role="tabpanel" id="im-panel-' + id + '" aria-labelledby="im-nav-' + id + '"' + (view === id ? "" : " hidden") + ">" + (view === id ? details("im-replay-guide", "重看设置指引", guide()) + panel(view) : "") + "</div>").join("") + "</div></div>") +
      '<div id="im-feedback" class="im-feedback" role="' + (feedbackError ? "alert" : "status") + '">' + esc(feedback) + "</div>";
    layout(); updateCountdown();
    if (oldFocus) document.getElementById(oldFocus)?.focus({ preventScroll: true });
  }
  function say(message, error = false) {
    feedback = message; feedbackError = error;
    const area = document.getElementById("im-feedback");
    if (area) { area.textContent = message; area.setAttribute("role", error ? "alert" : "status"); }
  }
  function navigate(target) {
    unbinding = null; menuOpen = false;
    if (platforms[target]) currentChannel = target;
    if (target === "test") { view = "pairing"; opened.add("im-first-task"); }
    else view = target;
    if (!managed()) wizardDetail = target;
    render("im-detail-title");
  }
  function generatePairing(channel) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    state.pairing = { code: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""), expiresAt: Date.now() + 300000, channel };
  }
  function updateCountdown() {
    const counter = document.getElementById("im-pair-countdown");
    if (!counter || !state.pairing) return;
    const seconds = Math.max(0, Math.ceil((state.pairing.expiresAt - Date.now()) / 1000));
    counter.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    if (!seconds) {
      document.getElementById("im-pair-status").textContent = "配对码已过期，请重新生成";
      document.getElementById("im-copy-pair").disabled = true;
      root.querySelector('[data-im-action="simulate-pair"]').disabled = true;
    }
  }
  root.addEventListener("toggle", (event) => {
    if (event.target instanceof HTMLDetailsElement) {
      if (event.target.open) opened.add(event.target.id); else opened.delete(event.target.id);
    }
  }, true);
  root.addEventListener("input", (event) => {
    const element = event.target;
    if (element.dataset.credential) drafts[channelKey()][element.dataset.credential] = element.value;
    if (element.id === "im-space-json") state.spaceDraft = element.value;
    if (element.dataset.property === "groups") grants.find((grant) => grant.projectId === element.dataset.grant).groups = element.value.split(",").map((value) => value.trim()).filter(Boolean);
  });
  root.addEventListener("change", (event) => {
    const element = event.target;
    if (element.dataset.project) {
      const id = element.dataset.project;
      if (element.checked) {
        grants.push({ projectId: id, mode: "plan", approval: "ask", shell: false, network: false, groups: [], expiresAt: Date.now() + 30 * 86400000 });
        if (grants.length === 1) defaultProjectId = id;
        opened.add("im-grant-" + id);
      } else { grants = grants.filter((grant) => grant.projectId !== id); if (defaultProjectId === id) defaultProjectId = ""; }
      render(element.id);
    } else if (element.dataset.grant && element.dataset.property !== "groups") {
      grants.find((grant) => grant.projectId === element.dataset.grant)[element.dataset.property] = element.type === "checkbox" ? element.checked : element.value;
      render(element.id);
    } else if (element.id === "im-default-project") defaultProjectId = element.value;
  });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "im-credential-form") {
      const channel = channelKey(), data = state.channels[channel], form = new FormData(event.target);
      data.saved = true;
      data.connections = [{ id: form.get("im-credential-id") || channel, name: form.get("im-credential-name") || platforms[channel].name, state: "connected", updatedAt: Date.now() }];
      drafts[channel] = {}; editing = null;
      generatePairing(channel);
      say("演示：凭据已保存，管理凭据已清空。一次性配对码已在“配对与账号”自动生成。");
      render("im-edit-credentials");
    } else if (event.target.id === "im-device-form") {
      const form = new FormData(event.target);
      let url;
      try { url = new URL(form.get("im-gateway-url")); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error(); }
      catch { say("请填写 HTTPS 地址；本机服务可使用 http://127.0.0.1。", true); return; }
      state.gateway.url = url.origin; state.gateway.prepared = true;
      state.device = { id: "dev-demo", name: String(form.get("im-device-name")) };
      say("演示：设备注册成功，管理凭据已清空。"); render();
    }
  });
  root.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    if (target.dataset.imView) { view = target.dataset.imView; if (platforms[view]) currentChannel = view; unbinding = null; menuOpen = false; render(target.id); return; }
    if (target.dataset.imStep) { navigate(target.dataset.imStep); return; }
    if (target.dataset.imCommon) { navigate(target.dataset.imCommon); document.getElementById("im-nav-more")?.focus(); return; }
    const action = target.dataset.imAction, channel = channelKey();
    if (action === "copy") {
      if (target.id === "im-copy-pair" && state.pairing.expiresAt <= Date.now()) { updateCountdown(); say("配对码已过期，请重新生成。", true); return; }
      try { await navigator.clipboard.writeText(target.dataset.copyValue); say("已复制。请粘贴到对应位置。"); }
      catch { say("无法访问剪贴板，请手动选择上方内容复制。", true); }
      return;
    }
    if (action === "more") { menuOpen = !menuOpen; render("im-nav-more"); if (menuOpen) root.querySelector('[role="menuitem"]').focus(); return; }
    if (action === "toggle-enabled") { state.enabled = !state.enabled; say(state.enabled ? "IM 连接已启用（演示）。" : "IM 连接已暂停，配置保留。"); }
    if (action === "edit-credentials") { editing = channel; drafts[channel] = {}; render("im-credential-" + platforms[channel].fields[0][0]); return; }
    if (action === "cancel-credentials") { editing = null; drafts[channel] = {}; render("im-edit-credentials"); return; }
    if (action === "unbind") { unbinding = target.dataset.identity; render("im-confirm-unbind"); return; }
    if (action === "keep-binding") { const id = unbinding.split(":")[1]; unbinding = null; render("im-unbind-" + id); return; }
    if (action === "confirm-unbind") {
      const [key, id] = unbinding.split(":");
      state.channels[key].identities = state.channels[key].identities.filter((identity) => identity.id !== id);
      unbinding = null; say("已解除该账号的绑定（演示）。");
    }
    if (action === "approve-pair" || action === "reject-pair") {
      const data = state.channels[channel];
      if (action === "approve-pair" && data.pairingAwaiting) data.identities.push({ ...data.pairingAwaiting, mode: "Plan" });
      delete data.pairingAwaiting; say(action === "approve-pair" ? "配对已批准，账号列表已更新（演示）。" : "已拒绝配对（演示）。");
    }
    if (action === "back-guide") wizardDetail = null;
    if (action === "gateway-local" || action === "gateway-team") state.gateway.mode = action.endsWith("local") ? "local" : "team";
    if (action === "setup-local") { state.gateway = { mode: "local", prepared: true, url: "http://127.0.0.1:4317" }; state.device.id = "dev-demo"; say("内置 Gateway 已启动，设备已自动注册（演示）。"); }
    if (action === "export-gateway") { say("静态原型仅演示导出入口。独立运行包由正式桌面应用导出。"); return; }
    if (action === "refresh-channel") {
      state.channels[channel].connections.forEach((connection) => { if (connection.state === "connected") connection.updatedAt = Date.now(); });
      say("已刷新演示状态；真实连接需在正式应用中验证。");
    }
    if (action === "generate-pair") {
      generatePairing(channel);
    }
    if (action === "simulate-pair") {
      if (!state.pairing || state.pairing.expiresAt <= Date.now()) return;
      const data = state.channels[state.pairing.channel];
      if (!data.identities.some((identity) => identity.id === "u_demo")) data.identities.push({ id: "u_demo", name: "我的账号", mode: "Plan" });
      view = state.pairing.channel; state.pairing = null; say("配对成功，已切换到日常管理（演示）。");
    }
    if (action === "renew") { grants.find((grant) => grant.projectId === target.dataset.project).expiresAt = Date.now() + 30 * 86400000; say("授权已续期，请保存更改。"); }
    if (action === "save-grants") { state.grants = structuredClone(grants); state.defaultProjectId = defaultProjectId; state.enabled = grants.length > 0; say("项目授权已保存" + (state.enabled ? "，IM 连接已启用" : "") + "（演示）。"); }
    if (action === "diagnostics" || action === "save-space") {
      const token = document.getElementById("im-space-admin");
      if (state.gateway.mode === "team" && !token.value.trim()) { say("请先填写协作空间管理凭据。", true); token.focus(); return; }
      if (action === "diagnostics") { diagnostics = true; if (token) token.value = ""; }
      else {
        let value;
        try {
          value = JSON.parse(document.getElementById("im-space-json").value);
          const identityValid = (identity) => identity && ["wecom", "feishu", "slack"].includes(identity.channel) && ["connectionId", "tenantId", "appId", "userId"].every((key) => typeof identity[key] === "string" && identity[key].length > 0);
          if (!/^[\w-]{1,100}$/.test(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || !Array.isArray(value.endpoints) || !value.endpoints.length || value.endpoints.length > 8 || !value.endpoints.every((endpoint) => endpoint.kind === "group" && endpoint.connectionId && endpoint.id) || !Array.isArray(value.participants) || !value.participants.length || !value.participants.every((member) => member.deviceId && member.name && identityValid(member.identity)) || !Array.isArray(value.administrators) || !value.administrators.length || !value.administrators.every(identityValid)) throw new Error();
        } catch { say("JSON 格式或必填字段不完整，请检查 id、name、endpoints、participants 和 administrators。", true); return; }
        state.space = value; if (token) token.value = "";
        say("空间配置已保存（演示），等待各群确认。管理凭据已清空。");
      }
    }
    if (action === "space-example") { state.spaceDraft = JSON.stringify(JSON.parse(target.dataset.sample), null, 2); }
    if (action) render();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (unbinding || menuOpen)) {
      event.preventDefault(); event.stopPropagation();
      const focus = unbinding ? "im-unbind-" + unbinding.split(":")[1] : "im-nav-more";
      unbinding = null; menuOpen = false; render(focus); return;
    }
    const menu = event.target.closest('[role="menu"]');
    if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('[role="menuitem"]')], index = items.indexOf(document.activeElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length].focus(); return;
    }
    const nav = event.target.closest(".im-channel-list");
    if (!nav || !event.target.matches('[role="tab"]') || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...nav.querySelectorAll('[role="tab"]')].filter((tab) => tab.getClientRects().length), index = tabs.indexOf(event.target);
    const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length];
    if (next.id === "im-nav-more") { next.focus(); next.click(); } else { view = next.dataset.imView; if (platforms[view]) currentChannel = view; unbinding = null; render(next.id); }
  });
  document.addEventListener("pointerdown", (event) => {
    if (menuOpen && !event.target.closest(".im-more")) { menuOpen = false; render(); }
  });
  document.querySelectorAll(".settings-tab").forEach((tab) => tab.addEventListener("click", () => {
    const im = tab.id === "settingsTabIM";
    document.querySelectorAll(".settings-tab").forEach((item) => item.classList.toggle("active", item === tab));
    root.hidden = !im; document.getElementById("settingsPanelExisting").hidden = im;
    if (im) { render(); layout(); }
  }));
  new ResizeObserver(layout).observe(document.querySelector(".settings-panel"));
  window.setInterval(updateCountdown, 1000);
  if (params.get("contrast") === "high") document.documentElement.dataset.contrast = "high";
  render();
  if (params.has("im")) {
    document.getElementById("settingsBackdrop").classList.add("open");
    document.getElementById("settingsTabIM").click();
  }
  window.ImPrototype = {
    reset(kind) { state = fixtures.create(kind); grants = structuredClone(state.grants); defaultProjectId = state.defaultProjectId; wizardDetail = null; editing = null; unbinding = null; menuOpen = false; feedback = ""; diagnostics = false; opened.clear(); Object.keys(drafts).forEach((key) => drafts[key] = {}); view = state.channels.feishu.saved ? "feishu" : "wecom"; currentChannel = view; render(); },
    snapshot() { return structuredClone(state); },
    setPairingRemaining(seconds) { if (state.pairing) { state.pairing.expiresAt = Date.now() + seconds * 1000; render(); } },
  };
})();
