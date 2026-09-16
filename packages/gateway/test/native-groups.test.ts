import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { imConversationKey, type ChannelEvent } from "@artemis/protocol";
import { GatewayStore } from "../src/store.js";
import { GatewayRouter } from "../src/router.js";
import { saveNativeGroup, retireLegacySpaces } from "../src/native-groups.js";
const stores: GatewayStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function fixture() {
  const store = new GatewayStore(":memory:", "e".repeat(32));
  stores.push(store);
  const device = store.register("Owner");
  const identity = {
    channel: "slack" as const,
    connectionId: "bot",
    tenantId: "team",
    appId: "app",
    userId: "owner",
  };
  const conversation = {
    connectionId: "bot",
    id: "room",
    kind: "group" as const,
  };
  store.pair(store.pairCode(device.id), identity);
  const event: ChannelEvent = {
    version: 1,
    identity,
    conversation,
    messageId: "first",
    text: "do work",
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
  const router = new GatewayRouter(store);
  return { store, device, identity, conversation, event, router };
}
it("requires an observed group and a paired owner, without replaying discovery", () => {
  const f = fixture();
  const input = {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "project",
    enabled: true,
  };
  expect(() => saveNativeGroup(f.store, input)).toThrow(/observed/);
  f.router.ingest(f.event);
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(0);
  const group = saveNativeGroup(f.store, input);
  expect(group.endpoints).toEqual([f.conversation]);
  expect(group.nativeGroup?.capability).toBe("manual");
  expect(f.store.list("spaces")).toEqual([]); // Older binaries cannot discover native grants.
  expect(saveNativeGroup(f.store, input).id).toBe(group.id);
  expect(f.store.pending("device")).toHaveLength(0);
  f.router.ingest({ ...f.event, messageId: "second", timestamp: Date.now() });
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(1);
});
it("binds discovery to the owner and rejects a different tenant or account", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  expect(() =>
    saveNativeGroup(f.store, {
      conversation: f.conversation,
      owner: { ...f.identity, tenantId: "other" },
      deviceId: f.device.id,
      name: "Room",
      projectId: "p",
      enabled: true,
    }),
  ).toThrow();
});
it("retires legacy spaces idempotently and preserves their history", () => {
  const f = fixture();
  f.store.put("spaces", "legacy", {
    id: "legacy",
    name: "Old",
    endpoints: [f.conversation],
    participants: [],
  });
  f.store.put("space-confirmations", "legacy", [
    imConversationKey(f.conversation),
  ]);
  retireLegacySpaces(f.store);
  retireLegacySpaces(f.store);
  expect(f.store.get("spaces", "legacy")).toBeUndefined();
  expect(f.store.get("retired-spaces", "legacy")).toMatchObject({
    name: "Old",
  });
  expect(f.router.findSpace(f.conversation)).toBeUndefined();
});
it("pausing preserves identity and invalidates routing", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  const input = {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "p",
    enabled: true,
  };
  const a = saveNativeGroup(f.store, input);
  const b = saveNativeGroup(f.store, { ...input, enabled: false });
  expect(b.id).toBe(a.id);
  expect(b.revision).not.toBe(a.revision);
  expect(f.router.findSpace(f.conversation)).toBeUndefined();
});
it("routes a teammate paired to another device through the receiving bot's group grant", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  const member = { ...f.identity, userId: "teammate" };
  const other = f.store.register("Other computer");
  f.store.pair(f.store.pairCode(other.id), member);
  const input = {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "p",
    enabled: true,
  };
  saveNativeGroup(f.store, input);
  f.router.ingest({
    ...f.event,
    identity: member,
    messageId: "peer",
    timestamp: Date.now(),
  });
  f.router.processIncoming();
  const requests = f.store.pending<any>("device");
  expect(requests).toHaveLength(1);
  const request = requests[0]!.payload;
  expect(request.deviceId).toBe(f.device.id);
  expect(request.identity).toEqual(f.identity);
  expect(request.originator).toEqual(member);
  expect(f.router.isInvocationAuthorized(request)).toBe(true);
  expect(
    f.router.isInvocationAuthorized({
      ...request,
      originator: { ...member, userId: "forged" },
    }),
  ).toBe(false);
  saveNativeGroup(f.store, { ...input, enabled: false });
  expect(f.router.isInvocationAuthorized(request)).toBe(false);
});
it("rejects copied bot protocol, cross-group replay and pre-authorization history", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  const group = saveNativeGroup(f.store, {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "p",
    enabled: true,
  });
  expect(
    f.router.ingest({
      ...f.event,
      bot: true,
      messageId: "bot",
      text: '{"action":"delegate"}',
    }),
  ).toBe(false);
  f.router.ingest({
    ...f.event,
    messageId: "history",
    timestamp: group.nativeGroup!.enabledAt - 1,
  });
  f.router.ingest({
    ...f.event,
    messageId: "other-group",
    conversation: { ...f.conversation, id: "other" },
    timestamp: Date.now(),
  });
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(0);
});
it("pausing stops both execution and setup replies while preserving history", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  saveNativeGroup(f.store, {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "p",
    enabled: false,
  });
  const before = f.store.pending("outgoing").length;
  f.router.ingest({ ...f.event, messageId: "paused", timestamp: Date.now() });
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(0);
  expect(f.store.pending("outgoing")).toHaveLength(before);
});
it("backs up legacy state before migration and never overwrites the upgrade snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-upgrade-"));
  const path = join(directory, "backup.sqlite");
  const f = fixture();
  try {
    f.store.put("spaces", "legacy", {
      id: "legacy",
      name: "Old",
      endpoints: [f.conversation],
      participants: [],
    });
    retireLegacySpaces(f.store, path);
    const backup = new DatabaseSync(path);
    const previous = statSync(path).mtimeMs;
    expect(
      JSON.parse(
        String(
          backup
            .prepare(
              "SELECT value FROM state WHERE namespace='spaces' AND id='legacy'",
            )
            .get()!.value,
        ),
      ).name,
    ).toBe("Old");
    backup.close();
    retireLegacySpaces(f.store, path);
    expect(statSync(path).mtimeMs).toBe(previous);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("accepts an unpaired human mention only in an authorized native group", () => {
  const f = fixture();
  f.router.ingest(f.event);
  f.router.processIncoming();
  saveNativeGroup(f.store, {
    conversation: f.conversation,
    owner: f.identity,
    deviceId: f.device.id,
    name: "Room",
    projectId: "p",
    enabled: true,
  });
  const event = {
    ...f.event,
    identity: { ...f.identity, userId: "teammate" },
    messageId: "peer",
    timestamp: Date.now(),
  };
  f.router.ingest(event);
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(1);
  const request = f.store.pending<any>("device")[0]!.payload;
  expect(f.router.isInvocationAuthorized(request)).toBe(true);
  expect(f.store.list("identities")).toHaveLength(1);
  for (const extra of [
    {
      messageId: "other-group",
      conversation: { ...event.conversation, id: "other" },
    },
    {
      messageId: "other-tenant",
      identity: { ...event.identity, tenantId: "other" },
    },
    { messageId: "bot", bot: true },
    { messageId: "not-mentioned", mentioned: false },
    { messageId: "old", timestamp: 1 },
  ]) {
    f.router.ingest({ ...event, ...extra });
    f.router.processIncoming();
  }
  f.router.ingest(event);
  f.router.processIncoming();
  expect(f.store.pending("device")).toHaveLength(1);
});
