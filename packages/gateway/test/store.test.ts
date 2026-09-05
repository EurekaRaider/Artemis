import { describe, expect, it } from "vitest";
import { GatewayStore } from "../src/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("durable Gateway identity and queues", () => {
  it("preserves conversation order during backoff and does not let an offline channel starve another", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    try {
      const message = (id: string) => ({
        conversation: { kind: "direct", id },
        text: "status",
      });
      for (let i = 0; i < 101; i++)
        store.enqueue("outgoing", `offline-${i}`, "offline", message("alice"));
      store.enqueue("outgoing", "first", "online", message("bob"));
      store.enqueue("outgoing", "second", "online", message("bob"));
      store.enqueue("outgoing", "other-chat", "online", message("carol"));
      store.mark("outgoing", "first", "pending", 500);
      expect(store.outgoing("online", 100).map((row) => row.id)).toEqual([
        "other-chat",
      ]);
      expect(store.outgoing("online", 600).map((row) => row.id)).toEqual([
        "first",
        "other-chat",
      ]);
      store.mark("outgoing", "first", "done");
      expect(store.outgoing("online", 600).map((row) => row.id)).toEqual([
        "second",
        "other-chat",
      ]);
    } finally {
      store.close();
    }
  });
  it("excludes a second database owner and preserves uncertain deliveries across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-gateway-store-"));
    const path = join(directory, "gateway.sqlite");
    let store = new GatewayStore(path, "e".repeat(32));
    try {
      store.enqueue("outgoing", "uncertain", "bot", { text: "sent?" });
      store.mark("outgoing", "uncertain", "sending");
      store.enqueue("incoming", "pending", "bot", { text: "not yet" });
      expect(() => new GatewayStore(path, "e".repeat(32))).toThrow(/locked/u);
      store.close();
      store = new GatewayStore(path, "e".repeat(32));
      expect(store.pending("outgoing")).toEqual([]);
      expect(
        store.db.prepare("SELECT state FROM queue WHERE id='uncertain'").get()
          ?.state,
      ).toBe("uncertain");
      expect(store.pending("incoming")).toHaveLength(1);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("uses one-time expiring pairing and binds stable identity to exactly one device", () => {
    const store = new GatewayStore(":memory:", "x".repeat(32));
    const device = store.register("Alice");
    expect(store.authenticate(device.id, device.token)).toBe(true);
    expect(store.authenticate(device.id, "wrong")).toBe(false);
    const identity = {
      channel: "wecom" as const,
      connectionId: "connection",
      tenantId: "corp",
      appId: "bot",
      userId: "alice",
    };
    const code = store.pairCode(device.id, 100);
    expect(store.pair(code, identity, 200)).toBe(device.id);
    expect(() => store.pair(code, identity, 201)).toThrow();
    const other = store.register("Bob");
    expect(() =>
      store.pair(store.pairCode(other.id, 100), identity, 200),
    ).toThrow();
    expect(() =>
      store.pair(store.pairCode(device.id, 100), identity, 400000),
    ).toThrow();
    store.close();
  });
  it("deduplicates incoming events and atomically rolls back failed work", () => {
    const store = new GatewayStore(":memory:", "x".repeat(32));
    expect(store.enqueue("incoming", "m", "device", { text: "hi" })).toBe(true);
    expect(
      store.enqueue("incoming", "m", "device", { text: "different" }),
    ).toBe(false);
    expect(() =>
      store.transaction(() => {
        store.mark("incoming", "m", "done");
        throw new Error("crash");
      }),
    ).toThrow();
    expect(store.pending("incoming")).toHaveLength(1);
    const encrypted = store.seal({ secret: "bot-token" });
    expect(encrypted).not.toContain("bot-token");
    expect(store.unseal(encrypted)).toEqual({ secret: "bot-token" });
    store.close();
  });
});
