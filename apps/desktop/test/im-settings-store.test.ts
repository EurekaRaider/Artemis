// im-settings-store 测试（plan §1.5：配置读写 + 加密凭据 + 重启恢复）

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EncryptedSettingsStore,
  type SafeStorageAdapter,
} from "../src/main/encrypted-settings-store.js";
import {
  loadIMAdapterConfigs,
  saveFeishuCredential,
  setIMAdapterEnabled,
} from "../src/main/im-settings-store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** 假 safeStorage：base64 反转模拟加解密（测试 seam，验证加密路径被走到） */
function fakeSafeStorage(): SafeStorageAdapter & { encryptedWrites: string[] } {
  const encryptedWrites: string[] = [];
  return {
    encryptedWrites,
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => {
      encryptedWrites.push(plainText);
      return Buffer.from(plainText, "utf8").reverse();
    },
    decryptString: (encrypted: Buffer) =>
      Buffer.from(encrypted).reverse().toString("utf8"),
  };
}

async function createStore(safeStorage = fakeSafeStorage()) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-im-settings-"));
  cleanup.push(directory);
  const filePath = join(directory, "settings.json");
  return { store: new EncryptedSettingsStore(filePath, safeStorage), filePath, safeStorage };
}

describe("im-settings-store（plan §1.5）", () => {
  it("适配器配置写入 + 读取", async () => {
    const { store } = await createStore();
    await setIMAdapterEnabled(store, "feishu-main", {
      platform: "feishu",
      enabled: true,
      domain: "feishu",
    });
    const configs = await store.imAdapterConfigs();
    expect(configs).toEqual([
      ["feishu-main", { platform: "feishu", enabled: true, domain: "feishu" }],
    ]);
  });

  it("凭据写入走加密路径且解密可读（app_secret 不落明文）", async () => {
    const { store, safeStorage, filePath } = await createStore();
    await saveFeishuCredential(store, "feishu-main", {
      appId: "cli_test",
      appSecret: "super-secret",
    });
    // 加密路径被调用，明文只在 encryptString 入参中出现一次
    expect(safeStorage.encryptedWrites).toHaveLength(1);
    expect(safeStorage.encryptedWrites[0]).toContain("super-secret");
    // 落盘文件不含明文 secret
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("super-secret");
    expect(raw).toContain("im:feishu:feishu-main");
  });

  it("loadIMAdapterConfigs 合并配置与凭据", async () => {
    const { store } = await createStore();
    await setIMAdapterEnabled(store, "feishu-main", {
      platform: "feishu",
      enabled: true,
    });
    await saveFeishuCredential(store, "feishu-main", {
      appId: "cli_a",
      appSecret: "s3cret",
    });
    const configs = await loadIMAdapterConfigs(store);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      name: "feishu-main",
      platform: "feishu",
      enabled: true,
      credentials: { appId: "cli_a", appSecret: "s3cret" },
    });
  });

  it("重启恢复：新 store 实例读同文件配置与凭据仍在", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-im-settings-"));
    cleanup.push(directory);
    const filePath = join(directory, "settings.json");
    const safe = fakeSafeStorage();

    const s1 = new EncryptedSettingsStore(filePath, safe);
    await setIMAdapterEnabled(s1, "feishu-main", { platform: "feishu", enabled: true });
    await saveFeishuCredential(s1, "feishu-main", { appId: "cli_a", appSecret: "sec" });

    const s2 = new EncryptedSettingsStore(filePath, safe);
    const configs = await loadIMAdapterConfigs(s2);
    expect(configs[0]?.credentials?.appSecret).toBe("sec");
  });

  it("缺凭据的适配器配置 credentials 为空（不抛错）", async () => {
    const { store } = await createStore();
    await setIMAdapterEnabled(store, "feishu-main", { platform: "feishu", enabled: false });
    const configs = await loadIMAdapterConfigs(store);
    expect(configs[0]?.credentials).toBeUndefined();
  });

  it("旧 version 1 设置文件兼容读取", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-im-settings-"));
    cleanup.push(directory);
    const filePath = join(directory, "settings.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, credentials: {}, providers: {} }) + "\n",
    );
    const { store } = await createStore();
    // 重新指向旧文件
    const legacy = new EncryptedSettingsStore(filePath, fakeSafeStorage());
    expect(await legacy.imAdapterConfigs()).toEqual([]);
    void store;
  });
});
