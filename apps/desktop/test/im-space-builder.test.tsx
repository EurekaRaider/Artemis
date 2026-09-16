// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { imSettingsSchema } from "@artemis/protocol";
import { ImNativeGroups } from "../src/renderer/ImNativeGroups.js";
import "./renderer-test-utils.js";
afterEach(cleanup);
it("distinguishes groups by real route identifiers and permits keyboard selection without authorizing", async () => {
  const user = userEvent.setup();
  render(
    <ImNativeGroups
      spaces={[]}
      settings={imSettingsSchema.parse({})}
      diagnostics={{
        identities: [],
        groups: ["room-a", "room-b"].map((id) => ({
          conversation: { connectionId: "bot", id, kind: "group" },
          name: "设计群",
          platform: "slack",
          identities: [],
          lastSeenAt: 1,
        })),
        spaces: [],
        deliveries: [],
      }}
      projects={[]}
      busy={false}
      t={(cn) => cn}
      run={async (fn) => {
        await fn();
        return true;
      }}
      refresh={async () => {}}
    />,
  );
  const select = screen.getByRole("button", { name: /已发现的群/ });
  await user.click(select);
  expect(
    screen.getByRole("option", { name: "设计群 · Slack · room-a" }),
  ).toBeVisible();
  expect(
    screen.getByRole("option", { name: "设计群 · Slack · room-b" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(select).toHaveFocus());
  expect(
    screen.queryByRole("button", { name: "确认并启用群聊" }),
  ).not.toBeInTheDocument();
});

it("keeps many groups compact and searches without expanding their settings", async () => {
  const user = userEvent.setup();
  render(
    <ImNativeGroups
      spaces={[]}
      settings={imSettingsSchema.parse({})}
      diagnostics={{
        identities: [],
        spaces: [],
        deliveries: [],
        groups: Array.from({ length: 40 }, (_, i) => ({
          conversation: { connectionId: "bot", id: `room-${i}`, kind: "group" },
          name: `Team ${i}`,
          platform: "slack",
          identities: [],
          lastSeenAt: 1,
        })),
      }}
      projects={[]}
      busy={false}
      t={(cn) => cn}
      run={async (fn) => {
        await fn();
        return true;
      }}
      refresh={async () => {}}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /本地项目/ }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "搜索群" }), "Team 39");
  await user.click(screen.getByRole("button", { name: /已发现的群/ }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await user.click(screen.getByRole("option", { name: "Team 39 · Slack" }));
  expect(screen.getAllByRole("button", { name: /本地项目/ })).toHaveLength(1);
});

it("hides discovered and saved WeCom groups while keeping Slack and Lark selectable", async () => {
  const user = userEvent.setup();
  const wecom = {
    channel: "wecom",
    connectionId: "w",
    tenantId: "t",
    appId: "b",
    userId: "owner",
  };
  render(
    <ImNativeGroups
      spaces={[
        {
          id: "saved-w",
          name: "Hidden saved WeCom",
          nativeGroup: {},
          endpoints: [{ connectionId: "w", id: "old", kind: "group" }],
          participants: [{ identity: wecom }],
        },
      ]}
      settings={imSettingsSchema.parse({})}
      diagnostics={{
        identities: [],
        spaces: [],
        deliveries: [],
        groups: [
          {
            conversation: { connectionId: "w", id: "room", kind: "group" },
            platform: "wecom",
            name: "Hidden WeCom",
            identities: [wecom],
            lastSeenAt: 1,
          },
          ...["slack", "lark"].map((platform) => ({
            conversation: {
              connectionId: platform,
              id: platform,
              kind: "group",
            },
            platform,
            name: platform,
            identities: [],
            lastSeenAt: 1,
          })),
        ],
      }}
      projects={[]}
      busy={false}
      t={(cn) => cn}
      run={async () => true}
      refresh={async () => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: /已发现的群/ }));
  expect(
    screen.queryByRole("option", { name: /WeCom/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "slack · Slack" })).toBeVisible();
  expect(screen.getByRole("option", { name: "lark · Lark" })).toBeVisible();
});
