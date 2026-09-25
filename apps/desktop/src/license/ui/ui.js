const $ = (id) => document.getElementById(id);
const messages = {
  revalidation_required:
    "上次运行的授权检查未通过，请重新输入有效注册码进行验证。",
  issuer_unconfigured:
    "此构建尚未配置签发公钥。请先从注册机导出公钥配置并重新构建 Artemis。",
  unlicensed: "尚未激活，请输入注册码。",
  valid: "验证成功，正在进入…",
  expired: "注册码已过期，请申请新的注册码。",
  not_yet_valid: "注册码尚未生效，请检查系统时间。",
  invalid_license: "注册码格式或签名无效。",
  device_mismatch: "注册码属于另一台电脑。",
  clock_error: "检测到系统时间回拨，请校正时间或申请恢复凭证。",
  storage_error: "无法读取或保存受保护授权，请检查系统安全存储或申请恢复。",
  device_unavailable: "无法读取可靠的机器标识，不能激活。",
  invalid_recovery: "恢复凭证无效、已使用或已过期。",
};
function show(value) {
  if (!value) return;
  $("device").value = value.device;
  $("status").textContent = messages[value.state] ?? "授权验证失败。";
  $("expiry").textContent = value.expiresAt
    ? `授权截止：${new Date(value.expiresAt).toLocaleString()}（本机时区）`
    : "";
}
async function run(action) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const result = await action();
    if (result?.state) show(result);
  } catch (error) {
    const key = Object.keys(messages).find((key) =>
      String(error).includes(key),
    );
    $("status").textContent = key
      ? messages[key]
      : "操作失败，请检查输入和系统安全存储。";
  } finally {
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
$("activate").onsubmit = (e) => {
  e.preventDefault();
  void run(() => window.license.activate($("token").value));
};
$("copy").onclick = () =>
  run(async () => {
    await window.license.copyDevice();
    $("status").textContent = "机器码已复制。";
  });
$("import").onclick = () => run(() => window.license.importFile());
$("request").onclick = () =>
  run(async () => {
    await window.license.recovery();
    $("status").textContent = "恢复请求已复制，请发送给授权签发者。";
  });
$("recover").onclick = () =>
  run(() => window.license.recover($("recovery").value));
$("quit").onclick = () => window.license.quit();
void run(() => window.license.status());
window.license.onStatus(show);
