import { useId, useState } from "react";
import { Button } from "@artemis/ui/actions";
import type { ImTranslate } from "./ImNavigation";
import "./im-gateway-deployment.css";

export function ImGatewayDeployment({
  t,
  busy,
  exportPackage,
  connect,
}: {
  t: ImTranslate;
  busy: boolean;
  exportPackage(): void;
  connect(): void;
}) {
  const id = useId();
  const [system, setSystem] = useState<string | null>("Windows");
  const [persistent, setPersistent] = useState(false);
  return (
    <section className="im-gateway-deployment" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>
        {t(
          "在自己的电脑上部署团队 Gateway",
          "Host a team Gateway on your computer",
        )}
      </h4>
      <p>
        {t(
          "选一台能持续开机联网的电脑运行 Gateway，再通过 Cloudflare Tunnel 获得所有成员都能访问的 HTTPS 地址。无需家庭公网 IP 或路由器端口映射；任务仍由各成员自己的 Artemis 执行。",
          "Run Gateway on an always-on computer and use Cloudflare Tunnel to provide a shared HTTPS URL. No home public IP or router port forwarding is needed. Tasks still run in each member’s own Artemis.",
        )}
      </p>
      {["Windows", "Linux"].map((os) => {
        const windows = os === "Windows";
        const expanded = system === os;
        const panelId = `${id}-${os}`;
        return (
          <div className="im-gateway-os" key={os}>
            <button
              type="button"
              className="im-gateway-os-toggle"
              id={`${panelId}-toggle`}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setSystem(expanded ? null : os)}
            >
              {os}
              <span aria-hidden="true" className="im-gateway-chevron">
                ▾
              </span>
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={`${panelId}-toggle`}
              hidden={!expanded}
              className="im-gateway-os-content"
            >
              <ol className="im-gateway-deployment-steps">
                <li>
                  <strong>
                    {t("准备独立运行包", "Prepare the standalone package")}
                  </strong>
                  <p>
                    {t(
                      `在主机安装 Node.js 24 或更新版本。导出运行包并复制到主机，解压到 ${windows ? "C:\\ArtemisGateway" : "~/artemis-gateway"}，确保目录内能看到 gateway.mjs。无需安装源码或执行 npm install。`,
                      `Install Node.js 24+ on the host. Export and copy the package there, then extract it into ${windows ? "C:\\ArtemisGateway" : "~/artemis-gateway"} with gateway.mjs directly inside. No source checkout or npm install is needed.`,
                    )}
                  </p>
                  <div className="im-actions">
                    <Button disabled={busy} onClick={exportPackage}>
                      {t("导出独立运行包", "Export standalone package")}
                    </Button>
                    <a
                      href="https://nodejs.org/en/download"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("安装 Node.js", "Install Node.js")}
                    </a>
                  </div>
                </li>
                <li>
                  <strong>
                    {t(
                      "启动并检查本机服务",
                      "Start and check the local service",
                    )}
                  </strong>
                  <p>
                    {windows
                      ? t("打开 PowerShell，执行：", "Open PowerShell and run:")
                      : t("打开终端，执行：", "Open a terminal and run:")}
                  </p>
                  <pre className="im-command">
                    <code>
                      {windows
                        ? "Set-Location C:\\ArtemisGateway\nnode --version\nnode gateway.mjs"
                        : "cd ~/artemis-gateway\nnode --version\nnode gateway.mjs"}
                    </code>
                  </pre>
                  <p>
                    {t(
                      "保持窗口打开，另开一个终端检查：",
                      "Leave it running and check from another terminal:",
                    )}
                  </p>
                  <pre className="im-command">
                    <code>{`${windows ? "curl.exe" : "curl"} http://127.0.0.1:8787/health`}</code>
                  </pre>
                  <p>
                    {t(
                      '返回 {"ok":true,"version":1} 表示启动成功。保留默认的 127.0.0.1:8787 监听地址。',
                      'A response of {"ok":true,"version":1} confirms startup. Keep the default listener at 127.0.0.1:8787.',
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t("取得可共享的 HTTPS 地址", "Get a shared HTTPS URL")}
                  </strong>
                  <p>
                    {windows
                      ? t(
                          "从 Cloudflare 官方下载页选择与 Windows 架构匹配的可执行文件，重命名为 cloudflared.exe，放进 C:\\ArtemisGateway。在另一个 PowerShell 窗口执行：",
                          "Download the executable for your Windows architecture from Cloudflare, rename it cloudflared.exe and place it in C:\\ArtemisGateway. In another PowerShell window, run:",
                        )
                      : t(
                          "按 Cloudflare 官方下载页安装适合当前 Linux 发行版和架构的 cloudflared 软件包。在另一个终端执行：",
                          "Install the cloudflared package for your Linux distribution and architecture from Cloudflare. In another terminal, run:",
                        )}
                  </p>
                  <a
                    href="https://developers.cloudflare.com/tunnel/downloads/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("下载 cloudflared", "Download cloudflared")}
                  </a>
                  <pre className="im-command">
                    <code>
                      {windows
                        ? "Set-Location C:\\ArtemisGateway\n.\\cloudflared.exe tunnel --url http://127.0.0.1:8787"
                        : "cloudflared tunnel --url http://127.0.0.1:8787"}
                    </code>
                  </pre>
                  <p>
                    {t(
                      "终端会输出随机的 https://…trycloudflare.com 地址。把实际地址发给朋友，请对方从外网访问该地址的 /health，确认也能看到健康状态。此时两个终端都要保持运行。",
                      "The terminal prints a random https://…trycloudflare.com URL. Share the actual URL and ask your friend to open its /health endpoint from their network. Keep both terminal processes running.",
                    )}
                  </p>
                  <p className="im-credential-location">
                    {t(
                      "临时隧道无需账号或域名，仅适合测试；重新启动后地址可能变化。长期使用请展开下方的固定地址与开机自启配置。",
                      "Quick tunnels need no account or domain and are for testing only; the URL may change after restart. For ongoing use, open the fixed URL and startup configuration below.",
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t(
                      "每位成员连接同一个 Gateway",
                      "Connect each member to the same Gateway",
                    )}
                  </strong>
                  <p>
                    {t(
                      "在各自的 Artemis 中使用团队 Gateway，填写相同的 HTTPS 地址，不带 /health 或其他路径。由管理员输入主机 .env.gateway 中的 ARTEMIS_GATEWAY_ADMIN_TOKEN 完成注册，再分别配对账号、授权项目并加入协作空间。",
                      "In each Artemis, use a team Gateway and enter the same HTTPS URL without /health or any other path. The administrator enters ARTEMIS_GATEWAY_ADMIN_TOKEN from the host’s .env.gateway to register each device. Then each member pairs their account, grants project access and joins the space.",
                    )}
                  </p>
                  <p className="im-credential-location">
                    {t(
                      ".env.gateway 还包含数据加密密钥，请留在主机妥善保存，不要发送整份文件。Gateway 和隧道只转发消息；执行任务的电脑仍需保持 Artemis 开启。",
                      ".env.gateway also contains the data encryption key. Keep the file private on the host. Gateway and the tunnel relay messages; computers executing tasks must keep Artemis open.",
                    )}
                  </p>
                  <Button disabled={busy} onClick={connect}>
                    {t(
                      "前往团队 Gateway 注册",
                      "Open team Gateway registration",
                    )}
                  </Button>
                </li>
              </ol>
              <button
                type="button"
                className="im-gateway-persistent-toggle"
                aria-expanded={persistent}
                aria-controls={`${panelId}-persistent`}
                onClick={() => setPersistent(!persistent)}
              >
                {t(
                  "长期使用：固定地址与开机自启",
                  "Ongoing use: fixed URL and automatic startup",
                )}
                <span aria-hidden="true" className="im-gateway-chevron">
                  ▾
                </span>
              </button>
              <div
                id={`${panelId}-persistent`}
                hidden={!persistent}
                className="im-gateway-persistent"
              >
                <p>
                  {t(
                    "准备 Cloudflare 账号和已接入 Cloudflare 的域名。在控制台 Networking → Tunnels 创建隧道，选择主机操作系统，按页面命令安装隧道服务。连接后添加 Published application 路由：子域名可填 gateway，选择自己的域名，路径留空，Service URL 填 http://127.0.0.1:8787。所有成员改用该固定 HTTPS 地址注册。",
                    "Prepare a Cloudflare account and a domain on Cloudflare. Create a tunnel under Networking → Tunnels, select the host OS and follow the displayed service installation command. Add a Published application route: use gateway as the subdomain, select your domain, leave Path empty and set Service URL to http://127.0.0.1:8787. Register all members using that fixed HTTPS URL.",
                  )}
                </p>
                <a
                  href="https://developers.cloudflare.com/tunnel/setup/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("固定隧道官方设置说明", "Official fixed tunnel setup")}
                </a>
                {windows ? (
                  <>
                    <p>
                      {t(
                        "Gateway 使用 Windows 任务计划程序 → 创建任务。触发器选择“计算机启动时”，选择“不管用户是否登录都运行”，填写：",
                        "For Gateway, create a task in Windows Task Scheduler. Trigger it at system startup, select Run whether user is logged on or not, and set:",
                      )}
                    </p>
                    <dl>
                      <dt>{t("程序", "Program")}</dt>
                      <dd>
                        {t(
                          "node.exe 的完整路径（可在 PowerShell 用 (Get-Command node).Source 查询）",
                          "The full path to node.exe (find it with (Get-Command node).Source in PowerShell)",
                        )}
                      </dd>
                      <dt>{t("参数", "Arguments")}</dt>
                      <dd>
                        <code>gateway.mjs</code>
                      </dd>
                      <dt>{t("起始于", "Start in")}</dt>
                      <dd>
                        <code>C:\ArtemisGateway</code>
                      </dd>
                    </dl>
                    <p>
                      {t(
                        "启用失败后重新启动；取消运行超时停止；已运行时不启动新实例。接通电源时关闭自动睡眠。启动计划任务前，先用 Ctrl+C 停止手动运行的 Gateway，避免两个进程使用同一数据库。",
                        "Enable restart on failure, disable the execution time limit and prevent overlapping instances. Disable sleep while plugged in. Stop the manually started Gateway with Ctrl+C before starting the task so only one process uses the database.",
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      {t(
                        "以下适用于使用 systemd 的 Linux。用 command -v node 查出 Node.js 的完整路径，在 ~/.config/systemd/user/artemis-gateway.service 保存下面的用户服务，将 ExecStart 中的 Node 路径替换为实际路径：",
                        "On Linux with systemd, find Node.js with command -v node. Save this user service as ~/.config/systemd/user/artemis-gateway.service and replace the Node path in ExecStart with the actual path:",
                      )}
                    </p>
                    <pre className="im-command">
                      <code>
                        {
                          "[Unit]\nDescription=Artemis Gateway\n\n[Service]\nWorkingDirectory=%h/artemis-gateway\nExecStart=/usr/bin/node gateway.mjs\nRestart=on-failure\nRestartSec=5\nUMask=0077\n\n[Install]\nWantedBy=default.target"
                        }
                      </code>
                    </pre>
                    <p>
                      {t(
                        "先创建用户服务目录并保存文件，再停止手动运行的 Gateway（Ctrl+C），执行：",
                        "Create the user service directory and save the file, then stop the manual Gateway (Ctrl+C) and run:",
                      )}
                    </p>
                    <pre className="im-command">
                      <code>
                        {
                          'systemctl --user daemon-reload\nsystemctl --user enable --now artemis-gateway.service\nsystemctl --user status artemis-gateway.service\nsudo loginctl enable-linger "$USER"'
                        }
                      </code>
                    </pre>
                    <p>
                      {t(
                        "最后一条命令允许用户服务在开机及退出登录后继续运行，需要管理员权限。关闭主机自动睡眠；固定隧道也按 Cloudflare 页面安装为系统服务。",
                        "The last command requires administrator permission and lets the user service run at boot and after logout. Disable host sleep and install the fixed tunnel as a system service using Cloudflare’s instructions.",
                      )}
                    </p>
                  </>
                )}
                <p>
                  {t(
                    "重启主机后，请朋友再次访问固定地址的 /health，并从 Artemis 发起一个小任务，确认连接、权限和结果回传。",
                    "After rebooting the host, ask your friend to check /health at the fixed URL and send a small Artemis task to verify connectivity, permissions and results.",
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
