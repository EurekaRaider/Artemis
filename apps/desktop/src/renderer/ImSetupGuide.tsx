import type { AppLocale, ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { ManagementSection } from "@artemis/ui/management";

type Translate = (cn: string, en: string) => string;
export function ImSetupGuide({
  locale,
  status,
  onNavigate,
}: {
  locale: AppLocale;
  status?: ImStatus & { connections?: unknown[] };
  onNavigate(id: string): void;
}) {
  const t: Translate = (cn, en) => (locale.startsWith("zh") ? cn : en);
  const hasBot =
    status?.connections?.some(
      (value) =>
        value &&
        typeof value === "object" &&
        (value as { state?: string }).state === "connected",
    ) ?? false;
  const steps = [
    {
      id: "im-prepare",
      title: t("准备 Gateway", "Prepare Gateway"),
      description: t(
        "一键启动内置服务，或连接团队服务。",
        "Start the built-in service or connect to a team service.",
      ),
      done: !!status?.settings.gatewayUrl,
    },
    {
      id: "im-device",
      title: t("注册这台电脑", "Register this computer"),
      description: t(
        "内置服务会自动完成注册；团队服务需管理员协助。",
        "Built-in setup registers automatically; team services need administrator help.",
      ),
      done: !!status?.settings.deviceId,
    },
    {
      id: "im-bot",
      title: t("连接一个机器人", "Connect a bot"),
      description: t(
        "选择企业微信、飞书或 Slack；团队已配置时可跳过填写。",
        "Choose WeCom, Feishu or Slack. Skip the form if your team already configured a bot.",
      ),
      done: hasBot,
    },
    {
      id: "im-pair",
      title: t("绑定你的 IM 账号", "Pair your IM account"),
      description: t(
        "把一次性指令发给机器人，收到“配对成功”。",
        "Send the one-time command to the bot and wait for confirmation.",
      ),
      done: !!status?.identities.length,
    },
    {
      id: "im-permissions",
      title: t("选择项目并启用", "Allow a project and enable IM"),
      description: t(
        "先用 Plan 模式，选择项目后保存并启用。",
        "Start with Plan mode, select a project, then save and enable.",
      ),
      done:
        !!status?.settings.enabled &&
        !!status?.settings.grants.some((grant) => grant.expiresAt > Date.now()),
    },
    {
      id: "im-test",
      title: t("发送第一条任务", "Send your first task"),
      description: t(
        "在 IM 里完成测试，并核对桌面上的同一任务。",
        "Try a task in IM and find the same task on your desktop.",
      ),
      done: false,
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  return (
    <ManagementSection
      title={t("首次使用：跟着 6 步设置", "First time? Follow these 6 steps")}
      description={t(
        "每一步都有填写示例和成功标志。先完成个人单聊，再设置群聊协作。点击步骤可直接跳到对应位置。",
        "Each step includes examples and a success check. Set up private chat before group collaboration. Select a step to jump to its controls.",
      )}
    >
      <ol
        className="im-setup-steps"
        aria-label={t("IM 设置步骤", "IM setup steps")}
      >
        {steps.map((step, index) => (
          <li key={step.id}>
            <Button
              aria-current={index === current ? "step" : undefined}
              onClick={() => onNavigate(step.id)}
            >
              {index + 1}. {step.title}
            </Button>
            <span className="im-step-status">
              {step.done
                ? t("已完成", "Done")
                : index === current
                  ? t("下一步", "Next")
                  : t("待设置", "Pending")}
            </span>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </ManagementSection>
  );
}

export function ImGatewayInstructions({
  t,
  busy,
  ready,
  setup,
  useRemote,
  exportPackage,
}: {
  t: Translate;
  busy: boolean;
  ready: boolean;
  setup(): void;
  useRemote(): void;
  exportPackage(): void;
}) {
  return (
    <ManagementSection
      title={t("1 · 启动内置 Gateway", "1 · Start the built-in Gateway")}
      description={t(
        "个人使用点击一次即可：自动启动服务、生成并加密保存凭据、注册当前设备。无需源码、安装工具或命令行。",
        "One click starts the service, securely creates credentials and registers this device. No source checkout, additional tools or terminal required.",
      )}
    >
      <Button disabled={busy || ready} onClick={setup}>
        {ready
          ? t("内置 Gateway 已就绪", "Built-in Gateway is ready")
          : t("一键启动并注册", "Start and register automatically")}
      </Button>
      <p>
        {t(
          "企业微信和 Slack 可直接连接，无需公网地址。服务随 Artemis 启动和退出；接收远程任务时请保持电脑唤醒、Artemis 运行。项目权限在第 5 步由你选择。",
          "WeCom and Slack connect without a public URL. The service runs with Artemis; keep this computer awake and Artemis open for remote tasks. Choose project permissions in step 5.",
        )}
      </p>
      <details>
        <summary>
          {t(
            "高级：使用团队服务或独立部署",
            "Advanced: team service or separate deployment",
          )}
        </summary>
        <p>
          {t(
            "团队已有 Gateway 时，填写管理员提供的 HTTPS 地址和管理凭据。飞书需要公网 HTTPS 回调，请使用独立部署。",
            "For an existing team Gateway, use the HTTPS URL and administrator token supplied by your administrator. Feishu requires a public HTTPS callback and a separate deployment.",
          )}
        </p>
        <div className="im-actions">
          <Button disabled={busy} onClick={useRemote}>
            {t("使用团队 Gateway", "Use a team Gateway")}
          </Button>
          <Button disabled={busy} onClick={exportPackage}>
            {t("导出独立运行包", "Export standalone package")}
          </Button>
        </div>
        <p>
          {t(
            "导出的包已编译，只需在服务器安装 Node.js 24 或更新版本。解压后执行下方命令，首次启动自动生成配置和凭据；团队地址的 HTTPS 由服务器管理员配置。操作说明包含在包内。",
            "The export is prebuilt. Install Node.js 24+ on the server, extract it and run the command below. First launch generates configuration and credentials. Your administrator configures HTTPS; instructions are included.",
          )}
        </p>
        <pre className="im-command">node gateway.mjs</pre>
      </details>
    </ManagementSection>
  );
}

export function ImFirstTaskInstructions({
  t,
  copy,
  slack = false,
}: {
  slack?: boolean;
  t: Translate;
  copy(text: string): void;
}) {
  const prefix = slack ? "" : "/";
  const commands = [
    {
      command: `${prefix}projects`,
      detail: t(
        "发给机器人。应看到你刚授权的项目；有多个项目时，复制项目编号，用 /project 项目编号 选择一个。",
        "Send this to the bot. It should list the projects you allowed. For multiple projects, copy an ID and select it with /project PROJECT_ID.",
      ),
    },
    {
      command: t(
        `${prefix}new 请查看当前项目，告诉我它是做什么的，先不要修改文件。`,
        `${prefix}new Inspect this project and explain what it does. Do not modify files yet.`,
      ),
      detail: t(
        "应收到任务编号；回到 Artemis，任务列表中会出现同一个 IM 来源任务。",
        "Expect a task ID. The same IM task should appear in the Artemis task list.",
      ),
    },
    {
      command: `${prefix}status`,
      detail: t(
        "查看实际进度。等待机器人发回最终答复后，第一条任务测试完成。",
        "Check progress. Your first task test is complete when the bot sends its final answer.",
      ),
    },
  ];
  return (
    <ManagementSection
      title={t("6 · 在 IM 发送第一条任务", "6 · Send your first task in IM")}
      description={t(
        "保持 Artemis 运行，在你刚配对的机器人单聊中依次发送下面的指令。复制按钮只复制文字，请自行粘贴到 IM 发送。",
        "Keep Artemis running. Send these commands in your paired private bot conversation. Copy only copies text; paste and send it in IM yourself.",
      )}
    >
      <ol className="im-test-steps">
        {commands.map((item) => (
          <li key={item.command}>
            <div className="im-actions">
              <code className="im-identifier">{item.command}</code>
              <Button onClick={() => copy(item.command)}>
                {t("复制指令", "Copy command")}
              </Button>
            </div>
            <p>{item.detail}</p>
          </li>
        ))}
      </ol>
      <p>
        {t(
          "Slack 中的指令不带开头的 /。后续直接发送普通文字，就会追加到当前任务。/tasks 查看任务，/continue 任务编号 切换任务，/stop 停止当前任务。审批和澄清请使用机器人给出的完整指令，或回桌面处理。",
          "In Slack, omit the leading / from commands. Ordinary messages add to the current task. Use /tasks to list tasks, /continue TASK_ID to switch, and /stop to stop. For approvals and questions, use the full command supplied by the bot or respond on the desktop.",
        )}
      </p>
      <details>
        <summary>
          {t("没有成功？按现象排查", "Not working? Troubleshoot by symptom")}
        </summary>
        <ul>
          <li>
            {t(
              "机器人不回复：检查第 3 步的机器人状态；企业微信确认没有另一处连接相同 Bot ID，飞书确认应用已发布、你在可用范围内且消息事件已订阅；Slack 确认应用已安装，两个令牌来自同一个应用，并使用不带 / 的普通消息命令。",
              "No bot reply: check step 3. For WeCom, ensure no other service uses the same Bot ID. For Feishu, publish the app, include yourself in its availability and subscribe to message events. For Slack, install the app, use two tokens from the same app and send plain commands without /.",
            )}
          </li>
          <li>
            {t(
              "提示未配对或配对码过期：回第 4 步重新生成，在本人单聊中于 5 分钟内发送。",
              "Unpaired or expired code: generate a new code in step 4 and send it in your private chat within 5 minutes.",
            )}
          </li>
          <li>
            {t(
              "看不到项目：先在桌面打开项目，然后在第 5 步勾选并保存授权。",
              "No projects: open a desktop project, select it in step 5 and save permissions.",
            )}
          </li>
          <li>
            {t(
              "任务排队或桌面离线：保持 Artemis 打开并启用连接；同一项目已有写任务时，等待它完成。",
              "Queued or offline: keep Artemis open and IM enabled. If the project has another write task, wait for it to finish.",
            )}
          </li>
          <li>
            {t(
              "提示沙箱不可用：先选择 Plan 模式完成单聊验证。Execute 需在本机通过原生沙箱检查。",
              "Sandbox unavailable: use Plan mode to check private chat first. Execute requires the local native sandbox checks to pass.",
            )}
          </li>
        </ul>
      </details>
    </ManagementSection>
  );
}
