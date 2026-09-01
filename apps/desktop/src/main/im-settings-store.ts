// IM 适配器配置与凭据的加密存储访问（证据 E8：plan §4）
// 凭据存 encrypted-settings-store 的 credentials 表，键 "im:feishu:{adapterName}"；
// 适配器启用配置存 imAdapters 字段（PersistedSettings version 升 2，缺省=无适配器）。

import type { EncryptedSettingsStore } from "./encrypted-settings-store.js";
import type { IMAdapterConfig } from "./im-service.js";

export interface PersistedIMAdapterConfig {
  platform: "feishu";
  domain?: "feishu" | "lark";
  enabled: boolean;
}

interface FeishuCredentialPayload {
  appId: string;
  appSecret: string;
}

function credentialKey(adapterName: string): string {
  return `im:feishu:${adapterName}`;
}

/**
 * 从 EncryptedSettingsStore 读取全部 IM 适配器配置（含解密后的凭据）。
 * 凭据只在 main 进程内存中存在，永不出本层（UI 走状态快照 IPC）。
 */
export async function loadIMAdapterConfigs(
  store: EncryptedSettingsStore,
): Promise<IMAdapterConfig[]> {
  const configs = await store.imAdapterConfigs();
  const runtime = await store.runtimeConfiguration();
  return configs.map(([name, cfg]) => {
    const cred = runtime.credentials[credentialKey(name)];
    let credentials: IMAdapterConfig["credentials"];
    if (cred && cred.type === "api_key" && cred.env) {
      const appId = cred.env.FEISHU_APP_ID;
      const appSecret = cred.env.FEISHU_APP_SECRET;
      if (appId && appSecret) {
        credentials = {
          appId,
          appSecret,
          ...(cfg.domain ? { domain: cfg.domain } : {}),
        };
      }
    }
    return {
      name,
      platform: cfg.platform,
      enabled: cfg.enabled,
      ...(credentials ? { credentials } : {}),
    };
  });
}

/** 写入飞书凭据（加密存储，写入即加密，永不回显 secret）。 */
export async function saveFeishuCredential(
  store: EncryptedSettingsStore,
  adapterName: string,
  credential: FeishuCredentialPayload,
): Promise<void> {
  await store.setIMCredential(credentialKey(adapterName), {
    FEISHU_APP_ID: credential.appId,
    FEISHU_APP_SECRET: credential.appSecret,
  });
}

export async function deleteIMCredential(
  store: EncryptedSettingsStore,
  adapterName: string,
): Promise<void> {
  await store.removeIMCredential(credentialKey(adapterName));
}

export async function setIMAdapterEnabled(
  store: EncryptedSettingsStore,
  adapterName: string,
  config: PersistedIMAdapterConfig,
): Promise<void> {
  await store.setIMAdapterConfig(adapterName, config);
}
