import { expect, it } from "vitest";
import { imConversationKey } from "@artemis/protocol";
import { GatewayStore } from "../../src/store.js";
import { GatewayRouter } from "../../src/router.js";
import { retireGroup } from "../../src/groups/group-retirement.js";

it("removes only the retired group's configuration, grants and queued work, retaining history", () => {
  const store = new GatewayStore(":memory:", "e".repeat(32));
  try {
    const conversation = {
      connectionId: "bot",
      id: "room",
      kind: "group" as const,
    };
    const group = {
      id: "group",
      endpoints: [conversation],
      participants: [{ deviceId: "owner" }],
      nativeGroup: { enabledAt: 100, enabled: false },
    };
    store.put("native-groups", "group", group);
    store.put("native-groups", "other", {
      ...group,
      id: "other",
      endpoints: [{ ...conversation, id: "other" }],
    });
    store.put("native-authorizations", "operation", { group });
    store.put("group-denied-senders", JSON.stringify(["group", "sender"]), {
      denied: true,
    });
    store.put("native-history", "history", {
      groupId: "group",
      text: "saved result",
    });
    store.put("device-security", "owner", {
      grants: [
        { audience: "space:group" },
        { audience: "space:other" },
        { audience: "owner" },
      ],
    });
    const payload = { conversation, text: "queued" };
    store.enqueue("outgoing", "queued", "bot", payload);
    retireGroup(store, conversation, "dissolved", 99);
    expect(store.get("native-groups", "group")).toEqual(group);
    retireGroup(store, conversation, "dissolved", 101);
    expect(store.get("native-groups", "group")).toBeUndefined();
    expect(store.get("native-groups", "other")).toBeDefined();
    expect(store.list("native-authorizations")).toEqual([]);
    expect(store.list("group-denied-senders")).toEqual([]);
    expect(store.get("native-history", "history")).toMatchObject({
      text: "saved result",
    });
    expect(store.get("device-security", "owner")).toEqual({
      grants: [{ audience: "space:other" }, { audience: "owner" }],
    });
    expect(store.pending("outgoing")).toEqual([]);
    const router = new GatewayRouter(store);
    expect(router.canDeliver(payload)).toBe(false);
    router.queueDelivery("late", payload);
    expect(store.pending("outgoing")).toEqual([]);
    const tombstone = store.get(
      "retired-groups",
      imConversationKey(conversation),
    );
    retireGroup(store, conversation, "dissolved", 102);
    expect(
      store.get("retired-groups", imConversationKey(conversation)),
    ).toEqual(tombstone);
  } finally {
    store.close();
  }
});
