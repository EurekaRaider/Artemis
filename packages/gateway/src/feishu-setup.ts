import { imText } from "./im-localization.js";
import type { AppLocale } from "@artemis/protocol";
import { z } from "zod";
import { channelConnectionSchema, type ChannelConnection } from "./channels.js";

const setupSchema = channelConnectionSchema.options[1].partial({
  tenantId: true,
  botOpenId: true,
});

/** Resolve real platform identities before persisting a new connection. */
export async function resolveFeishuConnection(
  input: unknown,
  locale: AppLocale = "zh-CN",
): Promise<Extract<ChannelConnection, { channel: "feishu" }>> {
  const setup = setupSchema.parse(input);
  const platform =
    setup.domain === "lark"
      ? "Lark"
      : locale === "zh-CN"
        ? "飞书"
        : locale === "zh-TW"
          ? "飛書"
          : "Feishu";
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
  const authHint = imText(locale, "authFailed", { platform });
  const auth = await request("auth/v3/tenant_access_token/internal", authHint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: setup.appId, app_secret: setup.appSecret }),
  });
  const token = z.string().min(1).safeParse(auth.tenant_access_token);
  if (!token.success) throw new Error(authHint);
  const headers = { Authorization: `Bearer ${token.data}` };
  const tenantHint = imText(locale, "tenantFailed", { platform });
  const botHint = imText(locale, "botFailed", { platform });
  /* Scan-minted apps (PersonalAgent) cannot call the tenant query; their
     websocket subscription adopts the tenant key from its first event. */
  const websocket = setup.transport === "websocket";
  const [tenant, bot] = await Promise.all([
    setup.tenantId ??
      (websocket
        ? ""
        : request("tenant/v2/tenant/query", tenantHint, { headers }).then(
            (result) => result.data?.tenant?.tenant_key,
          )),
    setup.botOpenId ??
      request("bot/v3/info", botHint, { headers }).then(
        (result) => result.bot?.open_id,
      ),
  ]);
  if (!websocket && !z.string().min(1).safeParse(tenant).success)
    throw new Error(tenantHint);
  if (!z.string().min(1).safeParse(bot).success) throw new Error(botHint);
  return channelConnectionSchema.options[1].parse({
    ...setup,
    tenantId: tenant,
    botOpenId: bot,
  });
}
