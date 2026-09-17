import { z } from "zod";
import type {
  ImFeishuScanBeginResult,
  ImFeishuScanPollResult,
} from "@artemis/protocol";

/**
 * Feishu's official OAuth app registration endpoint: a device-authorization
 * flow where the scanning user confirms app creation on their phone and the
 * client polls for the minted credentials. No Artemis server is involved.
 */
const REGISTRATION_HOSTS = {
  feishu: "https://accounts.feishu.cn",
  lark: "https://accounts.larksuite.com",
} as const;
type FeishuScanDomain = keyof typeof REGISTRATION_HOSTS;

const beginResponseSchema = z
  .object({
    device_code: z.string().min(1),
    verification_uri_complete: z.string().url(),
    user_code: z.string().optional(),
    expire_in: z.number().optional(),
    interval: z.number().optional(),
  })
  .strip();
const pollResponseSchema = z
  .object({
    device_code: z.string().optional(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    app_name: z.string().optional(),
    client_name: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    interval: z.number().optional(),
    user_info: z
      .object({
        open_id: z.string().optional(),
        tenant_key: z.string().optional(),
        tenant_brand: z.string().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

async function postRegistration(
  domain: FeishuScanDomain,
  body: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(
    `${REGISTRATION_HOSTS[domain]}/oauth/v1/app/registration`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Feishu registration endpoint returned HTTP ${response.status}.`,
    );
  return response.json();
}

export async function beginFeishuScan(): Promise<ImFeishuScanBeginResult> {
  const networkHint =
    "无法连接飞书应用注册服务，请检查网络。 / Could not reach the Feishu app registration service. Check the network.";
  let init: unknown;
  try {
    init = await postRegistration("feishu", { action: "init" });
  } catch {
    throw new Error(networkHint);
  }
  const methods = (init as { supported_auth_methods?: unknown })
    .supported_auth_methods;
  if (!Array.isArray(methods) || !methods.includes("client_secret"))
    throw new Error(
      "当前飞书环境不支持扫码创建应用，请改用手动接入。 / This Feishu environment does not support scan-created apps. Use manual setup.",
    );
  const begin = beginResponseSchema.parse(
    await postRegistration("feishu", {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    }),
  );
  return {
    deviceCode: begin.device_code,
    qrUrl: begin.verification_uri_complete,
    userCode: begin.user_code ?? "",
    expiresAt: Date.now() + (begin.expire_in ?? 600) * 1000,
    intervalMs: (begin.interval ?? 5) * 1000,
    domain: "feishu",
  };
}

export async function pollFeishuScan(input: {
  deviceCode: string;
  domain: FeishuScanDomain;
}): Promise<ImFeishuScanPollResult> {
  let response: unknown;
  try {
    response = await postRegistration(input.domain, {
      action: "poll",
      device_code: input.deviceCode,
    });
  } catch {
    // Transient network failures must not kill the session: the renderer's
    // expiry deadline governs how long polling continues.
    return { status: "pending", intervalMs: 5000, domain: input.domain };
  }
  const result = pollResponseSchema.parse(response);
  const brand =
    result.user_info?.tenant_brand === "lark" ||
    result.user_info?.tenant_brand === "feishu"
      ? result.user_info.tenant_brand
      : undefined;
  // A Lark identity may confirm a session that began on the Feishu host;
  // subsequent polls (and the resulting connection domain) follow the brand.
  if (brand === "lark" && input.domain !== "lark")
    return { status: "pending", intervalMs: 0, domain: "lark" };
  if (result.client_id && result.client_secret) {
    const appName = (result.app_name ?? result.client_name)?.trim();
    return {
      status: "success",
      appId: result.client_id,
      appSecret: result.client_secret,
      ...(appName ? { appName: appName.slice(0, 100) } : {}),
      ...(result.user_info?.open_id ? { openId: result.user_info.open_id } : {}),
      ...(result.user_info?.tenant_key
        ? { tenantKey: result.user_info.tenant_key }
        : {}),
      domain: brand ?? input.domain,
    };
  }
  if (!result.error || result.error === "authorization_pending")
    return {
      status: "pending",
      intervalMs: (result.interval ?? 5) * 1000,
      domain: input.domain,
    };
  if (result.error === "slow_down")
    return { status: "pending", intervalMs: 10000, domain: input.domain };
  if (result.error === "access_denied") return { status: "denied" };
  if (result.error === "expired_token") return { status: "expired" };
  return {
    status: "error",
    message: result.error_description
      ? `${result.error}: ${result.error_description}`
      : `Feishu registration error: ${result.error}`,
  };
}
