import { describe, expect, it } from "vitest";
import { readLegacyImSettings } from "../src/main/im-legacy-import.js";

const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
const json = (payload: unknown) =>
  JSON.stringify({
    version: 2,
    imAdapters: { work: { platform: "feishu", enabled: true, domain: "lark" } },
    credentials: {
      "im:feishu:work": {
        type: "api_key",
        encrypted: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    },
    approvalPolicy: { type: "auto" },
    imBindings: [{ channelId: "old", threadId: "old", muted: false }],
  });
describe("explicit legacy IM import", () => {
  it("imports only the selected bot configuration, with no bindings or global permissions", () => {
    expect(
      readLegacyImSettings(
        json({
          type: "api_key",
          env: { FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "private" },
        }),
        secure,
      ),
    ).toEqual([
      { name: "work", appId: "app", appSecret: "private", domain: "lark" },
    ]);
  });
  it("reports bounded errors without exposing decrypted credentials", () => {
    expect(() =>
      readLegacyImSettings(json({ type: "secret-private" }), secure),
    ).toThrow("无法读取旧版飞书配置");
    try {
      readLegacyImSettings(json({ type: "secret-private" }), secure);
    } catch (error) {
      expect(String(error)).not.toContain("secret-private");
    }
    expect(() =>
      readLegacyImSettings("x".repeat(2 * 1024 * 1024 + 1), secure),
    ).toThrow("2 MiB");
    expect(() =>
      readLegacyImSettings("{}", {
        ...secure,
        isEncryptionAvailable: () => false,
      }),
    ).toThrow("加密不可用");
  });
});
