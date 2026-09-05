import { afterEach, describe, expect, it } from "vitest";
import { imIdentityKey } from "@artemis/protocol";
import { GatewayStore } from "../src/store.js";
import { GatewayRouter } from "../src/router.js";

const stores: GatewayStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
function fixture() {
  const store = new GatewayStore(":memory:", "e".repeat(32));
  stores.push(store);
  const device = store.register("Test device");
  const identity = {
    channel: "wecom" as const,
    connectionId: "bot",
    tenantId: "tenant",
    appId: "app",
    userId: "user",
  };
  const conversation = {
    connectionId: "bot",
    kind: "direct" as const,
    id: "chat",
  };
  const code = store.pairCode(device.id, 100, true);
  return { store, device, identity, conversation, code };
}
describe("device-confirmed pairing", () => {
  it("consumes a code without binding until its own device approves, and cannot replay approval", () => {
    const f = fixture();
    const request = f.store.requestPair(
      f.code,
      f.identity,
      f.conversation,
      200,
    )!;
    expect(
      f.store.get("identities", imIdentityKey(f.identity)),
    ).toBeUndefined();
    expect(() => f.store.pair(f.code, f.identity, 201)).toThrow();
    expect(() =>
      f.store.resolvePairRequest("other-device", request.id, true, 300),
    ).toThrow();
    expect(f.store.pairingRequests(f.device.id, 300)).toHaveLength(1);
    f.store.resolvePairRequest(f.device.id, request.id, true, 300);
    expect(f.store.get("identities", imIdentityKey(f.identity))).toEqual({
      deviceId: f.device.id,
      identity: f.identity,
    });
    expect(f.store.get("direct-routes", imIdentityKey(f.identity))).toEqual(
      f.conversation,
    );
    expect(f.store.pairingRequests(f.device.id, 300)).toEqual([]);
    expect(() =>
      f.store.resolvePairRequest(f.device.id, request.id, true, 301),
    ).toThrow();
  });
  it("rejects without binding and invalidates pending requests when regenerating", () => {
    const f = fixture();
    const request = f.store.requestPair(
      f.code,
      f.identity,
      f.conversation,
      200,
    )!;
    f.store.resolvePairRequest(f.device.id, request.id, false, 300);
    expect(
      f.store.get("identities", imIdentityKey(f.identity)),
    ).toBeUndefined();
    const code = f.store.pairCode(f.device.id, 400, true);
    const next = f.store.requestPair(code, f.identity, f.conversation, 500)!;
    f.store.pairCode(f.device.id, 600, true);
    expect(() =>
      f.store.resolvePairRequest(f.device.id, next.id, true, 700),
    ).toThrow();
  });
  it("enforces the original five-minute expiry and rechecks identity ownership at approval", () => {
    const f = fixture();
    const request = f.store.requestPair(
      f.code,
      f.identity,
      f.conversation,
      200,
    )!;
    expect(() =>
      f.store.resolvePairRequest(f.device.id, request.id, true, 300100),
    ).toThrow();
    expect(f.store.pairingRequests(f.device.id, 300100)).toEqual([]);
    const code = f.store.pairCode(f.device.id, 400000, true);
    const next = f.store.requestPair(code, f.identity, f.conversation, 400100)!;
    const other = f.store.register("Other");
    f.store.pair(f.store.pairCode(other.id, 400200), f.identity, 400300);
    expect(() =>
      f.store.resolvePairRequest(f.device.id, next.id, true, 400400),
    ).toThrow();
  });
  it("routes a real pairing command into pending status, without authorizing task delivery", () => {
    const f = fixture();
    const router = new GatewayRouter(f.store, () => 200);
    const event = {
      version: 1,
      messageId: "pair-message",
      identity: f.identity,
      conversation: f.conversation,
      text: `/pair ${f.code}`,
      timestamp: 200,
      mentioned: false,
      bot: false,
      attachments: [],
    };
    router.ingest(event);
    router.processIncoming();
    expect(f.store.pairingRequests(f.device.id, 200)).toHaveLength(1);
    expect(
      f.store.pending<{ text: string }>("outgoing")[0]?.payload.text,
    ).toContain("批准");
    router.ingest({
      ...event,
      messageId: "task-message",
      text: "/new inspect",
    });
    router.processIncoming();
    expect(f.store.pending("device")).toEqual([]);
  });
});
