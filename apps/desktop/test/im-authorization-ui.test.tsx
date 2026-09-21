// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { imSettingsSchema, type Project } from "@artemis/protocol";
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
  const manage = vi.fn(async () => []);
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
it("shows group names with platform logos and exposes the selected group", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = userEvent.setup();
  const group = screen.getByRole("button", { name: /研发群/ });
  expect(group).toHaveTextContent(/^研发群$/);
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
  const roster = document.querySelector(".im-group-members") as HTMLElement;
  expect(roster).toHaveAttribute("open");
  expect(roster).toHaveTextContent("林晓");
  expect(roster).toHaveTextContent("陈晨");
  expect(within(roster).getAllByRole("img", { name: "成员" })).toHaveLength(3);
  expect(within(roster).getByRole("img", { name: "机器人" })).toBeVisible();
  expect(within(roster).getAllByText("状态未知")).toHaveLength(4);
  expect(roster).toHaveTextContent("Wrong account");
  await user.click(within(roster).getByRole("button", { name: "刷新" }));
  expect(f.manage).toHaveBeenCalledWith({
    action: "refresh-group-members",
    spaceId: "saved",
  });
  expect(f.props.refresh).toHaveBeenCalled();
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
  await user.click(screen.getByText("群成员", { selector: "summary" }));
  const roster = document.querySelector(".im-group-members") as HTMLElement;
  expect(roster).toHaveTextContent("尚未同步群成员。");
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
  expect(screen.getByText("群成员").closest("details")).toHaveAttribute("open");
});
