import { expect, it } from "vitest";
import {
  imSettingsSchema,
  type ImGroupRoster,
  type ImStatus,
} from "@artemis/protocol";
import { imGroupMemberStatus } from "../src/renderer/im-group-member-status";
const now = 200000;
const identity = {
  channel: "feishu",
  connectionId: "f",
  tenantId: "t",
  appId: "app",
  userId: "bot",
} as const;
const bot: ImGroupRoster["members"][number] = {
  identity,
  name: "Bot",
  kind: "bot",
  self: true,
};
function fixture(): ImStatus {
  return {
    state: "connected",
    identities: [],
    settings: imSettingsSchema.parse({
      enabled: true,
      deviceId: "device",
      gatewayUrl: "http://localhost:1234",
    }),
    remoteTasks: [
      {
        threadId: "thread",
        channel: "feishu",
        kind: "group",
        running: false,
        group: {
          spaceId: "group",
          name: "Group",
          confirmed: true,
          stale: false,
          executingDeviceId: "device",
          members: [
            {
              deviceId: "device",
              identity: { ...identity, userId: "owner" },
              name: "Owner",
              deviceName: "Desktop",
              state: "online",
            },
          ],
        },
      },
    ],
  };
}
it("distinguishes a local bot's online, busy and offline states using live evidence", () => {
  const status = fixture();
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("online");
  status.remoteTasks![0]!.running = true;
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("busy");
  status.remoteTasks![0]!.group!.members[0]!.state = "offline";
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("offline");
});
it("does not infer a person's presence from their online desktop or the bot's running task", () => {
  const status = fixture();
  status.remoteTasks![0]!.running = true;
  const human = {
    ...bot,
    identity: { ...identity, userId: "owner" },
    kind: "human" as const,
    self: false,
  };
  expect(imGroupMemberStatus(human, status, "group", now)).toBe("unknown");
  expect(
    imGroupMemberStatus(
      { ...human, presence: "active", presenceCheckedAt: now },
      status,
      "group",
      now,
    ),
  ).toBe("online");
  expect(
    imGroupMemberStatus(
      { ...human, presence: "away", presenceCheckedAt: now },
      status,
      "group",
      now,
    ),
  ).toBe("unknown");
  expect(
    imGroupMemberStatus(
      { ...human, presence: "active", presenceCheckedAt: now - 120000 },
      status,
      "group",
      now,
    ),
  ).toBe("unknown");
});
it("ignores stale, unconfirmed, disconnected and unrelated group activity", () => {
  const status = fixture();
  status.remoteTasks![0]!.running = true;
  expect(imGroupMemberStatus(bot, status, "other", now)).toBe("unknown");
  status.remoteTasks![0]!.group!.stale = true;
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("unknown");
  status.remoteTasks![0]!.group!.stale = false;
  status.remoteTasks![0]!.group!.confirmed = false;
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("unknown");
  status.remoteTasks![0]!.group!.confirmed = true;
  status.state = "error";
  expect(
    imGroupMemberStatus(
      { ...bot, presence: "active", presenceCheckedAt: now },
      status,
      "group",
      now,
    ),
  ).toBe("unknown");
});
it("does not let retained history mark a current bot busy", () => {
  const status = fixture();
  status.remoteTasks!.push({
    ...status.remoteTasks![0]!,
    threadId: "history",
    currentGroupEntry: false,
    running: true,
  });
  expect(imGroupMemberStatus(bot, status, "group", now)).toBe("online");
});
