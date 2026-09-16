import { afterEach, expect, it } from "vitest";
import { GatewayRouter } from "../src/router.js";
import { GatewayStore } from "../src/store.js";
const stores: GatewayStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
for (const source of ["wecom", "feishu", "slack"] as const) {
  for (const target of ["wecom", "feishu", "slack"] as const) {
    it(`rejects retired ${source} to ${target} gateway delegation without side effects`, () => {
      const store = new GatewayStore(":memory:", "e".repeat(32));
      stores.push(store);
      const router = new GatewayRouter(store);
      const a = store.register(source),
        b = store.register(target);
      for (const action of [
        "delegate",
        "delegate-many",
        "message",
        "finish",
        "cancel",
      ] as const) {
        expect(() =>
          router.collaborate(a.id, "legacy", "thread", {
            action,
            participantId: b.id,
            text: "work",
            assignments: [{ participantId: b.id, text: "work" }],
          }),
        ).toThrow(/退役/);
      }
      expect(store.pending("device")).toEqual([]);
      expect(store.pending("outgoing")).toEqual([]);
    });
  }
}
it("does not revive a revoked target or replay a previously accepted cross-device command", () => {
  const store = new GatewayStore(":memory:", "e".repeat(32));
  stores.push(store);
  const a = store.register("A"),
    b = store.register("B");
  const router = new GatewayRouter(store);
  store.put("devices", b.id, { ...b, revoked: true });
  for (let i = 0; i < 2; i++)
    expect(() =>
      router.collaborate(a.id, "same-invocation", "same-thread", {
        action: "delegate",
        participantId: b.id,
        text: "work",
      }),
    ).toThrow(/退役/);
  expect(store.pending("device")).toHaveLength(0);
  expect(store.list("collaboration-tasks")).toHaveLength(0);
});
