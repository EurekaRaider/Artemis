const $ = (id) => document.getElementById(id);
$("timezone").textContent =
  `时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}。截止时刻会转换为 UTC 写入许可证。`;
function feedback(message, state = "info") {
  $("status").textContent = message;
  $("status").dataset.state = state;
}
async function action(name, input) {
  if (name === "create" && (typeof input !== "string" || input.length < 12)) {
    feedback("请输入至少 12 个字符的私钥口令，再点击“创建新私钥”。", "error");
    $("password").focus();
    return;
  }
  if (name === "unlock" && !input) {
    feedback("请先输入私钥口令，再选择已有的私钥文件。", "error");
    $("password").focus();
    return;
  }
  feedback(
    name === "status"
      ? "正在初始化注册机…"
      : "正在处理，请完成打开的文件对话框或稍候…",
  );
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const result = await window.issuer.action(name, input);
    $("key").textContent = result.keyId
      ? `已解锁密钥：${result.keyId}`
      : "私钥未解锁";
    $("output").value = result.output;
    feedback(result.message ?? "操作完成。");
  } catch (error) {
    feedback(
      String(error).replace(
        /^Error: Error invoking remote method '[^']+': Error: /,
        "",
      ),
      "error",
    );
  } finally {
    if (name === "create" || name === "unlock" || name === "lock")
      $("password").value = "";
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
document
  .querySelectorAll("[data-action]")
  .forEach(
    (button) =>
      (button.onclick = () =>
        action(button.dataset.action, $("password").value)),
  );
$("issue").onclick = () => {
  const expiresAt = new Date($("expiry").value).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    feedback("请选择未来的截止日期和时间。", "error");
    return;
  }
  return action("issue", { device: $("device").value, expiresAt });
};
$("recover").onclick = () =>
  action("issue", { device: "", expiresAt: 0, recovery: $("request").value });
void action("status");
