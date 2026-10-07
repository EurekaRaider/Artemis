import { imText } from "@artemis/gateway";
import type { AppLocale } from "@artemis/protocol";
import { z } from "zod";
import type { SafeStorageAdapter } from "../settings/encrypted-settings-store.js";

const legacySettings = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  imAdapters: z.record(
    z.string().min(1).max(100),
    z.object({
      platform: z.literal("feishu"),
      domain: z.enum(["feishu", "lark"]).default("feishu"),
      enabled: z.boolean(),
    }),
  ),
  credentials: z.record(
    z.string(),
    z.object({ type: z.string(), encrypted: z.string().max(32768) }),
  ),
});
const credential = z.object({
  type: z.literal("api_key"),
  env: z.object({
    FEISHU_APP_ID: z.string().min(1).max(256),
    FEISHU_APP_SECRET: z.string().min(1).max(1024),
  }),
});

/** Only called for a settings file explicitly selected in the native import dialog. */
export function readLegacyImSettings(
  json: string,
  secure: SafeStorageAdapter,
  locale: AppLocale = "zh-CN",
) {
  if (!secure.isEncryptionAvailable())
    throw new Error(imText(locale, "legacyImportEncryption"));
  if (Buffer.byteLength(json) > 2 * 1024 * 1024)
    throw new Error(imText(locale, "legacyFileTooLarge"));
  try {
    const settings = legacySettings.parse(JSON.parse(json));
    return Object.entries(settings.imAdapters).map(([name, config]) => {
      const stored = settings.credentials[`im:feishu:${name}`];
      if (!stored || stored.type !== "api_key") throw new Error();
      const parsed = credential.parse(
        JSON.parse(
          secure.decryptString(Buffer.from(stored.encrypted, "base64")),
        ),
      );
      return {
        name,
        domain: config.domain,
        appId: parsed.env.FEISHU_APP_ID,
        appSecret: parsed.env.FEISHU_APP_SECRET,
      };
    });
  } catch {
    // Do not return Zod values or OS decryption errors containing credentials.
    throw new Error(imText(locale, "legacyCredentialsUnreadable"));
  }
}
