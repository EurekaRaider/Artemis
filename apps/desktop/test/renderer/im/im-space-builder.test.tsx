import { expect, it } from "vitest";
import {
  imNativeGroupChoices,
  imNativeGroupDirectory,
} from "../../../src/renderer/im/ImNativeGroups";
import { uiTranslator } from "../../../src/shared/i18n/ui-text";
const t = uiTranslator("zh-CN");
const diagnostics = (groups: unknown[]) => ({
  identities: [],
  groups,
  spaces: [],
  deliveries: [],
});
it.each([
  ["same group through different apps", "slack", "team", "room", true, 1],
  ["different workspace", "slack", "other-team", "room", true, 2],
  ["different platform", "feishu", "team", "room", true, 2],
  ["different group with the same name", "slack", "team", "other", true, 2],
  ["unknown workspace", "slack", "team", "room", false, 2],
] as const)(
  "groups the directory by verified platform identity: %s",
  (_name, platform, tenantId, id, known, count) => {
    const groups = imNativeGroupChoices(
      diagnostics(
        ["bot-a", "bot-b"].map((connectionId, index) => ({
          conversation: {
            connectionId,
            id: index ? id : "room",
            kind: "group",
          },
          name: "设计群",
          platform: index ? platform : "slack",
          identities: known
            ? [
                {
                  channel: index ? platform : "slack",
                  connectionId,
                  tenantId: index ? tenantId : "team",
                  appId: connectionId,
                  userId: "owner",
                },
              ]
            : [],
          lastSeenAt: 1,
        })),
      ),
      [],
      "device",
      t,
    );
    const directory = imNativeGroupDirectory(groups);
    expect(directory).toHaveLength(count);
    expect(directory.flatMap((entry) => entry.targets)).toEqual(groups);
    expect(new Set(groups.map((group) => group.value)).size).toBe(2);
  },
);
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
