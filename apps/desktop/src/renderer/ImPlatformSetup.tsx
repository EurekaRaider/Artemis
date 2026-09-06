import type { ImTranslate } from "./ImNavigation";

export function ImPlatformSetup({
  channel,
  transport = "websocket",
  domain = "feishu",
  t: translate,
}: {
  channel: "feishu" | "wecom";
  transport?: string;
  domain?: string;
  t: ImTranslate;
}) {
  const feishu = channel === "feishu";
  const lark = feishu && domain === "lark";
  const origin = lark ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const t: ImTranslate = (cn, en) =>
    translate(
      lark ? cn.replaceAll("飞书", "Lark") : cn,
      lark ? en.replaceAll("Feishu", "Lark") : en,
    );
  return (
    <div className="im-platform-setup">
      <h4>{t("1 · 准备机器人", "1 · Prepare your bot")}</h4>
      <p>
        {feishu
          ? t(
              "在飞书里创建一个应用机器人，再把应用凭据粘贴到下方。默认只需 App ID 和 App Secret，企业标识和机器人编号会自动获取。",
              "Create a Feishu app bot and paste its credentials below. By default, only App ID and App Secret are needed; tenant and bot IDs are retrieved automatically.",
            )
          : t(
              "在企业微信里创建智能机器人，使用长连接接入。这台电脑无需公网地址，也不用部署服务器。",
              "Create a WeCom intelligent bot with a long connection. This computer needs no public URL or separate server.",
            )}
      </p>
      <div className="im-platform-help">
        <details>
          <summary>
            {t(
              "我是个人开发者，没有企业怎么办？",
              "Personal developer without an organization?",
            )}
          </summary>
          <p>
            {feishu
              ? t(
                  "这里的“企业”指飞书团队。先注册飞书账号，在客户端头像菜单中选择「创建或加入团队」→「创建团队」，再切换到该团队身份登录开放平台。自己创建的团队由自己管理。只做开发测试时，也可使用开放平台「测试企业与人员」中的测试企业；应用凭据与登录身份都要切换到同一测试企业。",
                  "An organization here means a Feishu team. Register, open the avatar menu, choose Create or join a team → Create a team, then sign into the developer console with that team identity. You manage your own team. For development, the console also offers test tenants under Test enterprises and users; use credentials and an account from the same test tenant.",
                )
              : t(
                  "个人微信号不是企业微信企业。先下载并注册企业微信，按注册页指引创建自己的企业/团队，或加入已有团队。创建后用管理员账号登录管理后台。是否需要认证、能否创建智能机器人，以你账号的实际开放情况为准；若没有入口，先更新客户端并查看官方说明或联系团队管理员。",
                  "A personal WeChat account is not a WeCom organization. Register with WeCom and follow its registration flow to create your enterprise/team, or join an existing one. Sign into the admin console with its administrator account. Verification and intelligent-bot availability depend on your account; update the client and consult the official guide or your administrator if the entry is missing.",
                )}
          </p>
          <p>
            {feishu
              ? t(
                  "Tenant Key 是团队的内部标识，不是团队名称、企业编号或 App ID。默认无需查询；自动获取失败时，可在飞书 API 调试台运行「获取企业信息」，复制 data.tenant.tenant_key 到高级设置。",
                  "Tenant Key identifies the team; it is not a team name, enterprise display ID or App ID. Normally no lookup is needed. If automatic lookup fails, use Get tenant information in the API Explorer and copy data.tenant.tenant_key into Advanced settings.",
                )
              : t(
                  "企业 ID 获取路径：企业微信官网 → 企业登录 → 我的企业 → 企业信息 → 页面底部「企业 ID」（Corp ID，通常以 ww 开头）。复制到下方；它不是营业执照编号、个人微信号或 Bot ID。",
                  "Get your Corp ID: WeCom website → Enterprise login → My enterprise → Enterprise information → Enterprise ID at the bottom (usually starts with ww). Copy it below; it is not a business registration number, personal WeChat ID or Bot ID.",
                )}
          </p>
        </details>
        <details>
          <summary>
            {t(
              "第一次创建？展开查看操作步骤",
              "First time? Show the setup steps",
            )}
          </summary>
          <ol className="im-platform-steps">
            {feishu ? (
              <>
                <li>
                  {t(
                    "打开飞书开放平台 → 开发者后台 → 创建企业自建应用。进入应用，在「添加应用能力」中添加「机器人」，然后打开「凭证与基础信息」复制 App ID 和 App Secret。",
                    "Open the Feishu developer console → Create custom app. Add the Bot capability, then copy App ID and App Secret from Credentials & Basic Info.",
                  )}
                </li>
                <li>
                  {t(
                    "在「权限管理」搜索并开启：获取企业信息、接收用户发给机器人的单聊消息、获取群组中所有用户 @机器人的消息、以应用的身份发消息。需要图片或文件时再开启对应资源权限。创建版本并发布，将自己加入可用范围。",
                    "In Permissions, enable Get tenant information, Receive private messages sent to the bot, Receive group mentions and Send messages as the app. Add resource permissions if you need images or files. Create and publish a version with yourself in its availability.",
                  )}
                </li>
                <li>
                  {transport === "webhook"
                    ? t(
                        "使用有公网 HTTPS 地址的团队服务。在飞书「事件与回调」中复制 Verification Token 和 Encrypt Key，和应用凭据一起保存到 Artemis。再复制 Artemis 显示的回调地址，填入飞书的事件配置，订阅「接收消息」（im.message.receive_v1），保存并发布。",
                        "Use a team service with a public HTTPS URL. Copy Verification Token and Encrypt Key from Feishu Events & callbacks and save them with the app credentials in Artemis. Copy the callback URL displayed by Artemis into Feishu event settings, subscribe to Receive message (im.message.receive_v1), save and publish.",
                      )
                    : t(
                        "回到 Artemis 填写下方两项凭据并保存，先建立长连接。再回飞书「事件与回调」→「事件配置」，选择「使用长连接接收事件」，添加「接收消息」（im.message.receive_v1），保存并发布。若提示未建立连接，请保持 Artemis 打开并检查连接状态。",
                        "Save the two credentials in Artemis to establish a long connection first. Then open Events & callbacks → Event configuration in Feishu, select long connection delivery, add Receive message (im.message.receive_v1), save and publish. Keep Artemis open if the console cannot find the connection.",
                      )}
                </li>
                <li>
                  {t(
                    "在飞书搜索应用名称并打开机器人单聊。完成下面第 3 步的账号绑定和项目授权，即可发送任务。需要审批卡片时，在回调配置中再订阅 card.action.trigger。",
                    "Search the app name in Feishu and open its private chat. Complete account pairing and project permissions in step 3 below to send tasks. Subscribe to card.action.trigger in callback settings for approval cards.",
                  )}
                </li>
              </>
            ) : (
              <>
                <li>
                  {t(
                    "打开企业微信客户端 → 工作台 → 智能机器人 → 创建机器人（部分版本需点「手动创建」），选择「API 模式创建」。",
                    "Open WeCom → Workbench → Intelligent bots → Create bot (Manual creation in some versions), then select API mode.",
                  )}
                </li>
                <li>
                  {t(
                    "在 API 配置选择「使用长连接」，复制 Bot ID，点击获取 Secret；将自己加入可使用成员范围并保存机器人。同一 Bot ID 只连接一处服务。",
                    "Select Long connection in API settings, copy Bot ID and get Secret. Include yourself in the allowed members and save the bot. Connect each Bot ID to only one service.",
                  )}
                </li>
                <li>
                  {t(
                    "登录企业微信管理后台 → 我的企业 → 企业信息，从底部复制企业 ID。将企业 ID、Bot ID 和 Secret 填入下方，保存后等待“已连接”。",
                    "In the WeCom admin console, open My enterprise → Enterprise information and copy Enterprise ID at the bottom. Paste it with Bot ID and Secret below, save and wait for Connected.",
                  )}
                </li>
              </>
            )}
          </ol>
        </details>
      </div>
      <div className="im-setup-links">
        <a
          href={feishu ? `${origin}/app` : "https://work.weixin.qq.com/"}
          target="_blank"
          rel="noreferrer"
        >
          {feishu
            ? lark
              ? t("打开 Lark 开发者后台", "Open Lark console")
              : t("打开飞书开发者后台", "Open Feishu console")
            : t("打开企业微信管理后台", "Open WeCom admin console")}
        </a>
        <a
          href={
            feishu
              ? `${origin}/document/home/develop-a-bot-in-5-minutes/create-an-app`
              : "https://cloud.tencent.cn/document/product/1831/137051"
          }
          target="_blank"
          rel="noreferrer"
        >
          {t("官方图文教程", "Official illustrated guide")}
        </a>
      </div>
    </div>
  );
}
