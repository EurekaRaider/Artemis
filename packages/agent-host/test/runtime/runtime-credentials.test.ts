import { describe, expect, it } from "vitest";

import { RuntimeCredentialStore } from "../../src/runtime/runtime-credentials.js";

describe("RuntimeCredentialStore", () => {
  it("lists only non-secret credential metadata", async () => {
    const store = new RuntimeCredentialStore();
    store.replace({
      openai: { type: "api_key", key: "secret" },
      anthropic: {
        type: "oauth",
        access: "access-secret",
        refresh: "refresh-secret",
        expires: 123,
      },
    });

    expect(await store.list()).toEqual([
      { providerId: "anthropic", type: "oauth" },
      { providerId: "openai", type: "api_key" },
    ]);
    expect(JSON.stringify(await store.list())).not.toContain("secret");
  });

  it("serializes provider refresh modifications", async () => {
    const store = new RuntimeCredentialStore();
    store.replace({ openai: { type: "api_key", key: "first" } });
    const seen: string[] = [];

    await Promise.all([
      store.modify("openai", async (current) => {
        seen.push(current?.type === "api_key" ? (current.key ?? "") : "");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { type: "api_key", key: "second" };
      }),
      store.modify("openai", async (current) => {
        seen.push(current?.type === "api_key" ? (current.key ?? "") : "");
        return { type: "api_key", key: "third" };
      }),
    ]);

    expect(seen).toEqual(["first", "second"]);
    expect(await store.read("openai")).toEqual({
      type: "api_key",
      key: "third",
    });
  });
});

it("does not publish refreshed credentials until host persistence succeeds", async () => {
  const store = new RuntimeCredentialStore(async () => {
    throw new Error("persistence failed");
  });
  store.replace({ p: { type: "api_key", key: "old" } });
  await expect(
    store.modify("p", async () => ({ type: "api_key", key: "new" })),
  ).rejects.toThrow("persistence failed");
  expect(await store.read("p")).toEqual({ type: "api_key", key: "old" });
});
