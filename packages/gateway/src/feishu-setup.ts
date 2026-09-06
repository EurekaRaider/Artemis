import { z } from "zod";
import { channelConnectionSchema, type ChannelConnection } from "./channels.js";

const setupSchema = channelConnectionSchema.options[1].partial({
  tenantId: true,
  botOpenId: true,
});

/** Resolve real platform identities before persisting a new connection. */
export async function resolveFeishuConnection(
  input: unknown,
): Promise<Extract<ChannelConnection, { channel: "feishu" }>> {
  const setup = setupSchema.parse(input);
  // Keep fully specified legacy and team configurations compatible.
  if (setup.tenantId && setup.botOpenId)
    return channelConnectionSchema.options[1].parse(input);
  const origin =
    setup.domain === "lark"
      ? "https://open.larksuite.com"
      : "https://open.feishu.cn";
  // Finish within the desktop administration request's 15-second deadline.
  const signal = AbortSignal.timeout(10000);
  async function request(path: string, hint: string, init: RequestInit = {}) {
    try {
      const response = await fetch(`${origin}/open-apis/${path}`, {
        ...init,
        redirect: "error",
        signal,
      });
      const result = await response.json();
      if (!response.ok || result?.code !== 0) throw new Error();
      return result;
    } catch {
      // Platform responses can echo credentials. Return only actionable local text.
      throw new Error(hint);
    }
  }
  const authHint =
    "无法验证飞书应用。请从「凭证与基础信息」重新复制 App ID 和 App Secret，并检查网络。 / Could not verify Feishu app credentials. Check App ID, App Secret and network.";
  const auth = await request("auth/v3/tenant_access_token/internal", authHint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: setup.appId, app_secret: setup.appSecret }),
  });
  const token = z.string().min(1).safeParse(auth.tenant_access_token);
  if (!token.success) throw new Error(authHint);
  const headers = { Authorization: `Bearer ${token.data}` };
  const tenantHint =
    "无法自动获取飞书企业标识。请在权限管理中开启「获取企业信息」并发布应用后重试；也可在高级设置填写真实 Tenant Key。 / Enable Get tenant information and publish, or enter the real Tenant Key in Advanced settings.";
  const botHint =
    "无法自动获取机器人编号。请在应用能力中添加「机器人」并发布后重试。 / Add the Bot capability and publish the app, then retry.";
  const [tenant, bot] = await Promise.all([
    setup.tenantId ??
      request("tenant/v2/tenant/query", tenantHint, { headers }).then(
        (result) => result.data?.tenant?.tenant_key,
      ),
    setup.botOpenId ??
      request("bot/v3/info", botHint, { headers }).then(
        (result) => result.bot?.open_id,
      ),
  ]);
  if (!z.string().min(1).safeParse(tenant).success) throw new Error(tenantHint);
  if (!z.string().min(1).safeParse(bot).success) throw new Error(botHint);
  return channelConnectionSchema.options[1].parse({
    ...setup,
    tenantId: tenant,
    botOpenId: bot,
  });
}
