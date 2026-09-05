/* Static IM demonstrations only. Never contains real credentials or contacts. */
(function () {
  "use strict";
  const platforms = {
    wecom: { name: "企业微信", summary: "智能机器人 · 长连接免公网", constraint: "无需公网", method: "长连接", fields: [["id", "连接 ID", "wecom-team"], ["name", "连接名称", "团队机器人"], ["tenantId", "企业 ID", "Corp ID"], ["botId", "Bot ID", "智能机器人 Bot ID"], ["secret", "Bot Secret", "", true]], scopes: ["API 模式", "长连接"], guide: ["请管理员创建智能机器人，选择 API 模式并启用长连接。", "填写企业 ID、Bot ID 和 Secret；群 Webhook 不能作为机器人凭据。", "一个 Bot ID 只连接一份 Gateway。显示已连接后，再用机器人单聊配对。"] },
    feishu: { name: "飞书", summary: "企业自建应用 · HTTPS 事件回调", constraint: "需 HTTPS", method: "公网回调", fields: [["id", "连接 ID", "feishu-team"], ["name", "连接名称", "团队机器人"], ["tenantId", "Tenant Key", "企业 Tenant Key"], ["appId", "App ID", "cli_…"], ["botOpenId", "Bot Open ID", "机器人的 open_id"], ["appSecret", "App Secret", "", true], ["verificationToken", "Verification Token", "", true], ["encryptKey", "Encrypt Key", "", true]], scopes: ["im.message.receive_v1", "单聊消息", "群聊 @ 消息", "发送与更新消息", "图片 / 文件资源"], guide: ["创建企业自建应用并启用机器人能力，取得应用凭证、Tenant Key 和 Bot Open ID。", "保存凭据后，将事件回调地址填入飞书开放平台。订阅 im.message.receive_v1 并按用途开通消息与资源权限。", "发布应用版本，并将自己加入可用范围。连接状态只验证凭据，仍需真实单聊验证消息投递。"] },
    slack: { name: "Slack", summary: "Socket Mode · Manifest 导入", constraint: "无需公网", method: "Manifest 导入", fields: [["botToken", "Bot User OAuth Token", "xoxb-…", true], ["appToken", "App-Level Token", "xapp-…", true]], advanced: [["id", "连接 ID（可选）", "slack"], ["name", "连接名称（可选）", "Slack"]], scopes: ["connections:write", "chat:write", "app_mentions:read", "im:history"], guide: ["在 Slack 创建应用，选择 From a manifest 并导入配置。", "启用 Socket Mode，创建包含 connections:write 权限的 App-Level Token。", "安装应用到工作区，填写 xoxb- 与 xapp- 令牌。保存时自动识别工作区和机器人。"] },
  };
  function fixture(kind = "manage") {
    const state = {
      gateway: { mode: "team", url: "https://gw.example.com", prepared: true },
      device: { id: "dev-3f9a", name: "小明的电脑" }, enabled: true,
      channels: {
        wecom: { saved: false, connections: [], identities: [] },
        feishu: { saved: true, connections: [{ id: "conn-1", name: "团队机器人", state: "connected", updatedAt: Date.now() - 120000 }, { id: "conn-2", name: "测试机器人", state: "connecting", retry: "1/3" }], identities: [{ id: "u_9f3a", name: "王小明", mode: "Plan" }, { id: "u_2c71", name: "李小雨", mode: "Execute" }], pairingAwaiting: { id: "u_7b21", name: "张晓" } },
        slack: { saved: false, connections: [], identities: [] },
      },
      projects: [{ id: "artemis", name: "Artemis" }, { id: "website", name: "团队网站" }],
      grants: [{ projectId: "artemis", mode: "plan", approval: "ask", shell: false, network: false, groups: [], expiresAt: Date.now() + 30 * 86400000 }],
      defaultProjectId: "artemis", pairing: null, space: null,
    };
    if (["wizard", "empty", "pairing"].includes(kind)) {
      state.enabled = false; state.grants = []; state.defaultProjectId = "";
      for (const channel of Object.values(state.channels)) { channel.saved = false; channel.connections = []; channel.identities = []; delete channel.pairingAwaiting; }
      state.gateway = { mode: "local", url: "", prepared: false }; state.device = { id: "", name: "我的电脑" };
      if (kind !== "empty") { state.gateway.url = "http://127.0.0.1:4317"; state.gateway.prepared = true; state.device.id = "dev-demo"; }
      if (kind === "pairing") { state.channels.wecom.saved = true; state.channels.wecom.connections = [{ id: "wecom-team", name: "团队机器人", state: "connected", updatedAt: Date.now() }]; }
    }
    if (kind === "error") state.channels.feishu.connections = [{ id: "conn-1", name: "团队机器人", state: "error", error: "事件回调暂时不可达，请检查团队 Gateway。" }];
    if (kind === "paused") state.enabled = false;
    if (kind === "expired") state.pairing = { code: "8a234fbc91d2e678", expiresAt: Date.now() - 1, channel: "feishu" };
    return state;
  }
  window.ImPrototypeFixtures = { platforms, create: fixture };
})();
