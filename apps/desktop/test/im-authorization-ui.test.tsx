// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  IM_SECURITY_VERSION,
  imSettingsSchema,
  type Project,
} from "@artemis/protocol";
import { stubWindowArtemis } from "./renderer-test-utils";
import { GroupCollaborationPanel } from "../src/renderer/GroupCollaborationPanel";
const identity = {
  channel: "slack",
  connectionId: "bot-a",
  tenantId: "team",
  appId: "app",
  userId: "owner",
} as const;
function fixture() {
  const status = {
    authorizationVersion: 1 as const,
    settings: imSettingsSchema.parse({
      deviceId: "device",
      gatewayUrl: "http://127.0.0.1:12345",
    }),
    state: "disabled" as const,
    localGateway: { state: "running" as const },
    identities: [identity],
    spaces: [],
    connections: [],
  };
  const diagnostics = {
    identities: [{ deviceId: "device", identity }],
    groups: [
      {
        conversation: { connectionId: "bot-a", kind: "group", id: "room" },
        name: "研发群",
        platform: "slack",
        identities: [identity],
        lastSeenAt: 1,
      },
    ],
    spaces: [],
    deliveries: [],
  };
  const manage = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
  const save = vi.fn();
  stubWindowArtemis({
    manageIm: manage,
    saveImSettings: save,
    getImStatus: async () => status,
  });
  const props = {
    status,
    diagnostics,
    projects: [{ id: "p", name: "Project A", path: "/synthetic" }] as Project[],
    locale: "zh-CN" as const,
    refresh: vi.fn(async () => {}),
    onClose: vi.fn(),
    returnFocusRef: createRef<HTMLButtonElement>(),
  };
  return { props, manage, save };
}
async function openGroup() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /研发群/ }));
  await user.click(screen.getByRole("button", { name: "为此群授权" }));
  return user;
}
function multiBotFixture(channel: "slack" | "feishu" | "lark" = "slack") {
  const f = fixture();
  const identities = ["bot-a", "bot-b"].map((connectionId) => ({
    ...identity,
    channel: channel === "lark" ? ("feishu" as const) : channel,
    connectionId,
    appId: connectionId,
  }));
  const groups = identities.map((owner) => ({
    ...f.props.diagnostics.groups[0]!,
    platform: channel,
    identities: [owner],
    conversation: {
      connectionId: owner.connectionId,
      kind: "group" as const,
      id: "room",
    },
  }));
  const spaces = groups.map((group, index) => ({
    id: `saved-${index}`,
    name: "研发群",
    revision: `revision-${index}`,
    endpoints: [group.conversation],
    participants: [
      { deviceId: "device", identity: identities[index]!, name: "林晓" },
    ],
    nativeGroup: {
      version: 1 as const,
      projectId: index ? "q" : "p",
      enabled: !index,
      ownerDeviceId: "device",
      capability: "events" as const,
      enabledAt: 1,
    },
    roster: {
      complete: true,
      members: [
        { identity: identities[index]!, name: "林晓", kind: "human" },
        {
          identity: { ...identities[index]!, userId: `robot-${index}` },
          name: index ? "Venus" : "Jupiter",
          kind: "bot",
          self: true,
        },
      ],
    },
  }));
  const props = {
    ...f.props,
    projects: [
      ...f.props.projects,
      { id: "q", name: "Project B", path: "/synthetic-b" } as Project,
    ],
    diagnostics: {
      ...f.props.diagnostics,
      groups,
      identities: identities.map((owner) => ({
        deviceId: "device",
        identity: owner,
      })),
    },
    status: {
      ...f.props.status,
      state: "connected" as const,
      spaces,
      connections: identities.map((owner, index) => ({
        id: owner.connectionId,
        channel: owner.channel,
        name: index ? "Venus" : "Jupiter",
        state: "connected" as const,
      })),
      settings: imSettingsSchema.parse({
        ...f.props.status.settings,
        enabled: true,
        grants: spaces.map((space, index) => ({
          projectId: space.nativeGroup.projectId,
          mode: "plan",
          expiresAt: Date.now() + 86400000,
          groups: [`space:${space.id}`],
          security: {
            version: IM_SECURITY_VERSION,
            revision: `security-${index}`,
            confirmedAt: 1,
            scopes: [
              {
                audience: `space:${space.id}`,
                readMode: "selected",
                readPaths: [index ? "venus-only" : "jupiter-only"],
                writePaths: [],
                confirmedAt: 1,
              },
            ],
          },
        })),
      }),
    },
  };
  return { ...f, props };
}
it.each(["slack", "feishu", "lark"] as const)(
  "shows one %s group with independent bot authorizations and a shared member list",
  async (channel) => {
    const f = multiBotFixture(channel);
    f.manage.mockImplementation(async (input) => ({
      version: 1,
      state: "complete",
      command: (input as { command: unknown }).command,
      phases: {
        binding: "applied",
        local: "applied",
        activation: "applied",
        sync: "applied",
      },
    }));
    const user = userEvent.setup();
    render(<GroupCollaborationPanel {...f.props} />);
    const entries = screen.getAllByRole("button", { name: /研发群/ });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent("2 个本机机器人");
    await user.click(entries[0]!);
    const jupiter = screen.getByRole("region", { name: "Jupiter" });
    const venus = screen.getByRole("region", { name: "Venus" });
    expect(jupiter).toHaveTextContent("Project A");
    expect(jupiter).toHaveTextContent("jupiter-only");
    expect(venus).toHaveTextContent("Project B");
    expect(venus).toHaveTextContent("venus-only");
    expect(venus).toHaveTextContent("已暂停");
    expect(document.querySelectorAll(".im-group-members")).toHaveLength(1);
    await user.click(within(venus).getByRole("button", { name: "恢复授权" }));
    expect(document.querySelector(".im-group-draft-target")).toHaveTextContent(
      "Venus",
    );
    await user.click(
      screen.getByRole("checkbox", { name: /我已确认完整摘要/ }),
    );
    await user.click(screen.getByRole("button", { name: "确认并应用" }));
    expect(f.manage).toHaveBeenCalledExactlyOnceWith({
      action: "authorize-group",
      command: expect.objectContaining({
        intent: "restore",
        projectId: "q",
        conversation: f.props.diagnostics.groups[1]!.conversation,
        owner: f.props.diagnostics.identities[1]!.identity,
        expectedGroupVersion: "revision-1",
        scope: expect.objectContaining({ readPaths: ["venus-only"] }),
      }),
    });
    expect(screen.getByRole("heading", { name: "研发群" })).toBeVisible();
  },
);
it("filters bot authorization rows by project without losing the grouped directory", async () => {
  const f = multiBotFixture();
  const user = userEvent.setup();
  render(<GroupCollaborationPanel {...f.props} />);
  await user.click(screen.getByRole("button", { name: /研发群/ }));
  await user.click(screen.getByRole("button", { name: "按项目" }));
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project B" }));
  expect(screen.getAllByRole("button", { name: /研发群/ })).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Venus" })).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Jupiter" }),
  ).not.toBeInTheDocument();
});
it("shows group names with platform logos and exposes the selected group", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = userEvent.setup();
  const group = screen.getByRole("button", { name: /研发群/ });
  expect(group).toHaveTextContent("研发群");
  expect(screen.getByRole("img", { name: "Slack" })).toBeVisible();
  expect(screen.getByRole("button", { name: "按群" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(group);
  expect(group).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "研发群" })).toBeVisible();
  expect(screen.queryByText(/bot-a|room/)).not.toBeInTheDocument();
});
it("requires an explicit project and preserves the draft across Back without saving settings", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = await openGroup();
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText("项目共享策略", { selector: "dt" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByRole("button", { name: /^项目/ })).toHaveTextContent(
    "Project A",
  );
  expect(f.save).not.toHaveBeenCalled();
  expect(f.manage).not.toHaveBeenCalled();
});
it("keeps zero selected paths invalid and asks to discard inside the same dialog", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = await openGroup();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await user.click(screen.getByRole("button", { name: /^可读范围/ }));
  await user.click(screen.getByRole("option", { name: /指定目录或文件/ }));
  expect(screen.getByRole("button", { name: "确认并应用" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(f.props.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("button", { name: "确认并应用" })).toBeDisabled();
});
it("prefills only the project when entered through the project view", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "按项目" }));
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "添加群授权" }));
  expect(screen.getByRole("button", { name: /^项目/ })).toHaveTextContent(
    "Project A",
  );
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  expect(f.manage).not.toHaveBeenCalled();
});

it("requires renewed confirmation when the audience of a shared policy changes", async () => {
  const {
    createAuthorizationDraft,
    draftAuthorizationCommand,
    authorizationDraftConflict,
  } = await import("../src/renderer/im-authorization-draft");
  const { imNativeGroupChoices } =
    await import("../src/renderer/ImNativeGroups");
  const { uiTranslator } = await import("../src/shared/ui-text");
  const f = fixture();
  const target = imNativeGroupChoices(
    f.props.diagnostics,
    [],
    "device",
    uiTranslator("zh-CN"),
  )[0]!;
  const draft = createAuthorizationDraft(
    f.props.status.settings,
    target,
    "p",
    "create",
    "group",
  );
  const before = draftAuthorizationCommand(draft)!;
  const settings = structuredClone(f.props.status.settings);
  settings.grants.push({
    projectId: "another",
    mode: "plan",
    approval: "ask",
    network: false,
    shell: false,
    groups: ["space:new-group"],
    expiresAt: Date.now() + 86400000,
  });
  expect(authorizationDraftConflict(draft, settings, target)).toBe(true);
  expect(draftAuthorizationCommand(draft)!.confirmationFingerprint).toBe(
    before.confirmationFingerprint,
  );
});

it("clears confirmation when a live refresh changes the impact baseline", async () => {
  const f = fixture();
  const view = render(<GroupCollaborationPanel {...f.props} />);
  const user = await openGroup();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  const confirmation = screen.getByRole("checkbox", {
    name: "我已确认完整摘要及其分享与执行影响。",
  });
  await user.click(confirmation);
  expect(confirmation).toBeChecked();
  view.rerender(
    <GroupCollaborationPanel
      {...f.props}
      status={{
        ...f.props.status,
        settings: { ...f.props.status.settings, enabled: true },
      }}
    />,
  );
  expect(confirmation).not.toBeChecked();
  expect(screen.getByRole("button", { name: "确认并应用" })).toBeDisabled();
  expect(f.manage).not.toHaveBeenCalled();
});

it("shows matched bot and account names instead of authorization identifiers", async () => {
  const f = fixture();
  const otherIdentity = { ...identity, connectionId: "other-bot" };
  const space = {
    id: "saved",
    name: "研发群",
    revision: "1",
    endpoints: [f.props.diagnostics.groups[0]!.conversation],
    participants: [{ deviceId: "device", identity, name: "Saved account" }],
    nativeGroup: {
      projectId: "p",
      enabled: false,
      ownerDeviceId: "device",
      capability: "manual",
      enabledAt: 1,
    },
    roster: {
      complete: true,
      members: [
        { identity: otherIdentity, name: "Wrong account", kind: "human" },
        { identity, name: "林晓", kind: "human" },
        {
          identity: { ...identity, userId: "peer" },
          name: "陈晨",
          kind: "human",
        },
        {
          identity: { ...identity, userId: "robot" },
          name: "Artemis 助手",
          kind: "bot",
          self: true,
        },
      ],
    },
  };
  const { container } = render(
    <GroupCollaborationPanel
      {...f.props}
      status={{
        ...f.props.status,
        spaces: [space],
        connections: [
          {
            id: "bot-a",
            channel: "slack",
            name: "Configured bot",
            state: "connected",
          },
        ],
      }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /研发群/ }));
  const roster = document.querySelector(".im-group-members") as HTMLElement;
  expect(roster).not.toHaveAttribute("open");
  await user.click(within(roster).getByText("群成员"));
  expect(roster).toHaveTextContent("林晓");
  expect(roster).toHaveTextContent("陈晨");
  expect(within(roster).getAllByRole("img", { name: "成员" })).toHaveLength(3);
  expect(within(roster).getByRole("img", { name: "机器人" })).toBeVisible();
  expect(within(roster).getAllByText("状态未知")).toHaveLength(3);
  expect(within(roster).getByText("在线")).toBeVisible();
  expect(within(roster).getByRole("img", { name: "机器人" })).toHaveAttribute(
    "data-state",
    "online",
  );
  expect(roster).toHaveTextContent("Wrong account");
  await user.click(within(roster).getByRole("button", { name: "刷新" }));
  expect(f.manage).toHaveBeenCalledWith({
    action: "refresh-group-members",
    spaceId: "saved",
  });
  expect(f.props.refresh).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "恢复授权" }));
  const summary = container.ownerDocument.querySelector(
    ".im-group-identity-summary",
  ) as HTMLElement;
  expect(within(summary).getByRole("img", { name: "Slack" })).toBeVisible();
  expect(summary).toHaveTextContent("Artemis 助手");
  expect(summary).toHaveTextContent("林晓");
  expect(summary).not.toHaveTextContent("Wrong account");
  expect(summary).not.toHaveTextContent("bot-a");
  expect(screen.getByText("本次授权身份")).toBeVisible();
  expect(
    screen.queryByText("已观察成员可能不完整，仍适用现有群成员准入规则。"),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".im-group-members")).toBeNull();
});

it("uses the configured bot name and an explicit fallback when the account name is unavailable", async () => {
  const f = fixture();
  render(
    <GroupCollaborationPanel
      {...f.props}
      status={{
        ...f.props.status,
        connections: [
          {
            id: "bot-a",
            channel: "slack",
            name: "Configured bot",
            state: "connected",
          },
        ],
      }}
    />,
  );
  const user = await openGroup();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  const summary = document.querySelector(
    ".im-group-identity-summary",
  ) as HTMLElement;
  expect(summary).toHaveTextContent("Configured bot");
  expect(summary).toHaveTextContent("暂未获取名称");
  expect(summary).not.toHaveTextContent("bot-a");
  expect(screen.getByText("本次授权身份")).toBeVisible();
  expect(
    screen.queryByText("已观察成员可能不完整，仍适用现有群成员准入规则。"),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".im-group-members")).toBeNull();
  expect(summary).not.toHaveTextContent("owner");
});

it("requires fresh confirmation after editing policy or scope on the combined page", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = await openGroup();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(
    screen.queryByRole("button", { name: "下一步" }),
  ).not.toBeInTheDocument();
  const consent = screen.getByRole("checkbox", { name: /我已确认完整摘要/ });
  const submit = screen.getByRole("button", { name: "确认并应用" });
  await user.click(consent);
  expect(submit).toBeEnabled();
  await user.click(screen.getByRole("button", { name: /^模式/ }));
  await user.click(screen.getByRole("option", { name: "Execute · 允许修改" }));
  expect(consent).not.toBeChecked();
  expect(submit).toBeDisabled();
  await user.click(consent);
  await user.click(screen.getByRole("button", { name: /^可写范围/ }));
  await user.click(
    screen.getByRole("option", { name: "整个项目", exact: true }),
  );
  expect(consent).not.toBeChecked();
  expect(submit).toBeDisabled();
  await user.click(consent);
  expect(submit).toBeEnabled();
  await user.click(screen.getByRole("button", { name: /^可读范围/ }));
  await user.click(screen.getByRole("option", { name: "指定目录或文件" }));
  expect(consent).toBeDisabled();
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /^可读范围/ }));
  await user.click(
    screen.getByRole("option", { name: "整个项目", exact: true }),
  );
  await user.click(consent);
  expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText("到期时间（本机时区）"), {
    target: { value: "2000-01-01T00:00" },
  });
  expect(consent).not.toBeChecked();
  expect(consent).toBeDisabled();
  expect(submit).toBeDisabled();
  expect(f.manage).toHaveBeenCalledExactlyOnceWith({
    action: "scope-entries",
    projectId: "p",
    path: "",
  });
});

it.each([false, true])(
  "uses a single edit entry for authorization and renewal (expired: %s)",
  async (expired) => {
    const f = fixture();
    const expiresAt = expired ? 1 : Date.now() + 86400000;
    const settings = imSettingsSchema.parse({
      ...f.props.status.settings,
      grants: [{ projectId: "p", mode: "plan", expiresAt }],
    });
    render(
      <GroupCollaborationPanel
        {...f.props}
        status={{
          ...f.props.status,
          settings,
          spaces: [
            {
              id: "saved",
              name: "研发群",
              revision: "1",
              endpoints: [f.props.diagnostics.groups[0]!.conversation],
              participants: [{ deviceId: "device", identity, name: "林晓" }],
              nativeGroup: {
                projectId: "p",
                enabled: true,
                ownerDeviceId: "device",
                capability: "manual",
                enabledAt: 1,
              },
            },
          ],
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /研发群/ }));
    expect(
      screen.queryByRole("button", { name: "检查并续期" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑授权" }));
    const consent = screen.getByRole("checkbox", { name: /我已确认完整摘要/ });
    const submit = screen.getByRole("button", { name: "确认并应用" });
    expect(submit).toBeDisabled();
    if (expired) expect(consent).toBeDisabled();
    fireEvent.change(screen.getByLabelText("到期时间（本机时区）"), {
      target: { value: "2099-01-01T00:00" },
    });
    expect(consent).not.toBeChecked();
    expect(submit).toBeDisabled();
    await user.click(consent);
    expect(submit).toBeEnabled();
    expect(screen.getByRole("button", { name: /^可读范围/ })).toBeVisible();
    expect(f.manage).not.toHaveBeenCalled();
  },
);

it("does not open an unrelated task for an unbound Lark group", async () => {
  const f = fixture();
  const diagnostics = {
    ...f.props.diagnostics,
    groups: [
      {
        ...f.props.diagnostics.groups[0]!,
        name: "Lark group",
        platform: "lark",
        conversation: {
          connectionId: "lark-bot",
          kind: "group",
          id: "lark-room",
        },
        identities: [],
      },
    ],
  };
  render(
    <GroupCollaborationPanel
      {...f.props}
      diagnostics={diagnostics}
      status={{
        ...f.props.status,
        remoteTasks: [
          { threadId: "unrelated-slack", channel: "slack", kind: "direct" },
        ],
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Lark group/ }));
  expect(
    screen.queryByRole("button", { name: "打开群对话" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("在群内向机器人发送首条消息，即可开始对话。"),
  ).toBeVisible();
});

it("omits the open group conversation button when a current task exists", async () => {
  const f = fixture();
  const group = {
    spaceId: "saved",
    name: "研发群",
    confirmed: true,
    executingDeviceId: "device",
    stale: false,
    members: [],
  };
  const space = {
    id: "saved",
    name: "研发群",
    endpoints: [f.props.diagnostics.groups[0]!.conversation],
    participants: [{ deviceId: "device", identity }],
    nativeGroup: {
      projectId: "p",
      enabled: true,
      ownerDeviceId: "device",
      capability: "manual",
      enabledAt: 1,
    },
  };
  render(
    <GroupCollaborationPanel
      {...f.props}
      status={{
        ...f.props.status,
        spaces: [space],
        remoteTasks: [
          { threadId: "direct", channel: "slack", kind: "direct" },
          {
            threadId: "other-group",
            channel: "slack",
            kind: "group",
            group: { ...group, spaceId: "other" },
          },
          {
            threadId: "child",
            parentThreadId: "current",
            channel: "slack",
            kind: "group",
            group,
          },
          {
            threadId: "history",
            currentGroupEntry: false,
            channel: "slack",
            kind: "group",
            group,
          },
          { threadId: "current", channel: "slack", kind: "group", group },
        ],
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /研发群/ }));
  expect(
    screen.queryByRole("button", { name: "打开群对话" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("群成员").closest("details")).not.toHaveAttribute(
    "open",
  );
});

it("shows rejoined status and restores the saved project through authorization", async () => {
  const f = fixture();
  const space = {
    id: "saved",
    name: "研发群",
    revision: "rejoined",
    endpoints: [f.props.diagnostics.groups[0]!.conversation],
    participants: [{ deviceId: "device", identity, name: "Owner" }],
    nativeGroup: {
      version: 1,
      projectId: "p",
      enabled: false,
      ownerDeviceId: "device",
      capability: "manual",
      enabledAt: 1,
      recovery: { version: 1, removedAt: 2, rejoinedAt: 3 },
    },
  };
  render(
    <GroupCollaborationPanel
      {...f.props}
      status={{ ...f.props.status, spaces: [space] }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /研发群/ }));
  expect(screen.getByText("已重新加入，待确认授权")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "恢复授权" }));
  expect(screen.getByText("Project A")).toBeVisible();
  expect(f.manage).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认并应用" })).toBeDisabled();
});

it.each([false, true])(
  "refreshes members after authorization without undoing success on refresh failure (%s)",
  async (fails) => {
    const f = fixture();
    f.manage.mockImplementation(async (...args: unknown[]) => {
      const action = args[0] as { action: string; command: unknown };
      if (action.action === "authorize-group")
        return {
          state: "complete",
          command: action.command,
          group: { id: "authorized-group", nativeGroup: { enabled: true } },
        };
      if (fails) throw new Error("Member refresh failed");
      return undefined;
    });
    render(<GroupCollaborationPanel {...f.props} />);
    const user = await openGroup();
    await user.click(screen.getByRole("button", { name: /^项目/ }));
    await user.click(screen.getByRole("option", { name: "Project A" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "我已确认完整摘要及其分享与执行影响。",
      }),
    );
    await user.click(screen.getByRole("button", { name: "确认并应用" }));
    expect(f.manage).toHaveBeenNthCalledWith(2, {
      action: "refresh-group-members",
      spaceId: "authorized-group",
    });
    expect(f.props.refresh).toHaveBeenCalledTimes(fails ? 1 : 2);
    expect(
      screen.queryByRole("button", { name: "确认并应用" }),
    ).not.toBeInTheDocument();
    if (fails)
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Member refresh failed",
      );
  },
);

it("shows full-local risk inline and clears confirmation whenever access changes", async () => {
  const f = multiBotFixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /研发群/ }));
  await user.click(
    within(screen.getByRole("region", { name: "Jupiter" })).getByRole(
      "button",
      { name: "编辑授权" },
    ),
  );
  expect(screen.getByRole("radio", { name: /限定项目范围/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /完整本机权限/ }));
  expect(screen.getByText("仅对当前群中的 Jupiter 生效。")).toBeInTheDocument();
  const approval = screen.getByRole("button", { name: /执行审批/ });
  expect(approval).toBeDisabled();
  expect(approval).toHaveTextContent("授权范围内自动执行");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "完整权限可能影响整台电脑",
  );
  expect(
    screen.getByText(
      "操作和结果发送将自动进行，不再逐次审批或等待桌面审阅；可能直接向群内或外部服务发送敏感信息。",
    ),
  ).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "确认并启用完整权限" });
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /我理解风险/ }));
  expect(submit).toBeEnabled();
  await user.click(screen.getByRole("radio", { name: /限定项目范围/ }));
  await user.click(screen.getByRole("radio", { name: /完整本机权限/ }));
  expect(
    screen.getByRole("checkbox", { name: /我理解风险/ }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "确认并启用完整权限" }),
  ).toBeDisabled();
});
