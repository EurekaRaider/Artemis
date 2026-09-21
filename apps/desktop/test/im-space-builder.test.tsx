import { expect, it } from "vitest";
import { imNativeGroupChoices } from "../src/renderer/ImNativeGroups";
import { uiTranslator } from "../src/shared/ui-text";
const t = uiTranslator("zh-CN");
const diagnostics = (groups: unknown[]) => ({
  identities: [],
  groups,
  spaces: [],
  deliveries: [],
});
it("distinguishes same-named groups on different bot connections", () => {
  const groups = imNativeGroupChoices(
    diagnostics(
      ["bot-a", "bot-b"].map((connectionId) => ({
        conversation: { connectionId, id: "room", kind: "group" },
        name: "设计群",
        platform: "slack",
        identities: [],
        lastSeenAt: 1,
      })),
    ),
    [],
    "device",
    t,
  );
  expect(groups.map((g) => g.label)).toEqual([
    "设计群 · Slack · bot-a · room",
    "设计群 · Slack · bot-b · room",
  ]);
  expect(new Set(groups.map((g) => g.value)).size).toBe(2);
});
it("retains conversation identity when an observed audience becomes a saved native group", () => {
  const conversation = { connectionId: "bot", id: "room", kind: "group" };
  const observed = diagnostics([
    {
      conversation,
      name: "设计群",
      platform: "slack",
      identities: [],
      lastSeenAt: 1,
    },
  ]);
  const before = imNativeGroupChoices(observed, [], "device", t)[0]!;
  const after = imNativeGroupChoices(
    observed,
    [
      {
        id: "saved",
        name: "设计群",
        endpoints: [conversation],
        participants: [],
        nativeGroup: { version: 1 },
      },
    ],
    "device",
    t,
  )[0]!;
  expect(before.value).toMatch(/^native:/);
  expect(after.value).toBe("space:saved");
  expect(after.conversation).toEqual(before.conversation);
});
it("excludes retired WeCom groups while retaining Slack and Lark observations", () => {
  const groups = imNativeGroupChoices(
    diagnostics(
      ["wecom", "slack", "lark"].map((platform) => ({
        conversation: { connectionId: platform, id: "room", kind: "group" },
        platform,
        name: platform,
        identities: [],
        lastSeenAt: 1,
      })),
    ),
    [],
    "device",
    t,
  );
  expect(groups.map((g) => g.label)).toEqual(["slack · Slack", "lark · Lark"]);
});
