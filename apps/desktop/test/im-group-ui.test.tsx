import { uiTranslator } from "../src/shared/ui-text.js";
// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { useRef, useState } from "react";
import {
  ImMemberMentionMenu,
  useImMemberMentions,
} from "../src/renderer/ImMemberMentions.js";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imSettingsSchema,
  resolveImGroupMentions,
  imGroupMentionTargets,
  type ImGroupContext,
} from "@artemis/protocol";
import { imNativeGroupChoices } from "../src/renderer/ImNativeGroups.js";
import { ImGroupMembers } from "../src/renderer/ImGroupMembers.js";
import { useImThreadStatus } from "../src/renderer/ImThreadConnection.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const identity = (userId: string, channel: "slack" | "feishu") => ({
  userId,
  channel,
  connectionId: channel,
  appId: "bot",
  tenantId: "tenant",
});
const group: ImGroupContext = {
  spaceId: "team",
  name: "Design team",
  confirmed: true,
  stale: false,
  executingDeviceId: "bob-device",
  members: [
    {
      deviceId: "alice-device",
      name: "Alice",
      identity: identity("alice", "feishu"),
      deviceName: "Alice laptop",
      state: "offline",
    },
    {
      deviceId: "bob-device",
      name: "Bob",
      identity: identity("bob", "slack"),
      deviceName: "Bob desktop",
      state: "online",
    },
  ],
};
const space = {
  id: "team",
  name: group.name,
  confirmed: true,
  endpoints: [
    { connectionId: "feishu", id: "lark-group", kind: "group" },
    { connectionId: "slack", id: "slack-channel", kind: "group" },
  ],
  participants: group.members,
  administrators: [group.members[0]!.identity],
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("group collaboration UI", () => {
  it("keeps retired shared spaces out of the native group directory", () => {
    expect(
      imNativeGroupChoices(
        { identities: [], groups: [], spaces: [space], deliveries: [] },
        [space],
        "device",
        uiTranslator("zh-CN"),
      ),
    ).toEqual([]);
  });

  it("selects @ members by keyboard without submitting, and resolves equal names to different computers", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const user = userEvent.setup(),
      send = vi.fn();
    function Composer() {
      const [text, setText] = useState("");
      const input = useRef<HTMLTextAreaElement>(null);
      const mentions = useImMemberMentions({ group, text, setText, input });
      return (
        <>
          <textarea
            aria-label="Prompt"
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              mentions.changed(e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              if (
                !mentions.keyDown(e) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing
              )
                send(text);
            }}
          />
          <ImMemberMentionMenu mentions={mentions} locale="zh-CN" />
        </>
      );
    }
    render(<Composer />);
    await user.type(screen.getByLabelText("Prompt"), "@");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByLabelText("Prompt")).toHaveValue("@Bob ");
    expect(send).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Prompt"), "检查接口");
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    await user.keyboard("！");
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenCalledWith("@Bob 检查接口！");
    const duplicate = {
      ...group,
      members: group.members.map((m) => ({ ...m, name: "张三" })),
    };
    const targets = imGroupMentionTargets(duplicate);
    expect(new Set(targets.map((m) => m.token)).size).toBe(2);
    expect(
      resolveImGroupMentions(duplicate, targets[1]!.token + " 检查").map(
        (m) => m.deviceId,
      ),
    ).toEqual(["bob-device"]);
    expect(() => resolveImGroupMentions(duplicate, "@张三 检查")).toThrow();
    expect(() => resolveImGroupMentions(group, "@Bobby 检查")).toThrow();
  });
  it("limits the environment roster to selected members and inserts their visible mention", async () => {
    const mention = vi.fn();
    render(
      <ImGroupMembers
        managePermissions
        group={{ ...group, targetDeviceIds: ["bob-device"] }}
        locale="zh-CN"
        onMention={mention}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "@ Bob" }));
    expect(mention).toHaveBeenCalledWith("@Bob");
  });
  it("keeps compact removal behind confirmation and preserves mention actions", async () => {
    const remove = vi.fn(async () => true);
    render(
      <ImGroupMembers
        managePermissions
        group={{ ...group, targetDeviceIds: ["bob-device"] }}
        locale="zh-CN"
        onRemove={remove}
        onMention={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: "从本对话移除：Bob · Bob desktop",
    });
    expect(button).toHaveAttribute("data-artemis-component", "icon-button");
    expect(screen.getByRole("button", { name: "@ Bob" })).toHaveAttribute(
      "data-artemis-component",
      "icon-button",
    );
    await userEvent.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "从本对话移除：Bob · Bob desktop",
    );
    expect(button).toHaveAccessibleDescription(
      "从本对话移除：Bob · Bob desktop",
    );
    await userEvent.unhover(button);
    const mentionButton = screen.getByRole("button", { name: "@ Bob" });
    await userEvent.hover(mentionButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("提及 Bob");
    await userEvent.unhover(mentionButton);
    const computer = screen.getByRole("img", { name: "电脑在线" });
    await userEvent.hover(computer);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("电脑在线");
    await userEvent.unhover(computer);
    act(() => mentionButton.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("提及 Bob");
    act(() => mentionButton.blur());
    await userEvent.click(button);
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "从本对话移除：Bob · Bob desktop" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认移除成员" }));
    expect(remove).toHaveBeenCalledWith("bob-device");
  });
  it("shows actual member platforms, devices, executor and stale state", () => {
    const { rerender } = render(
      <ImGroupMembers managePermissions group={group} locale="zh-CN" />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Alice laptop");
    expect(
      within(rows[0]!).getByRole("img", { name: "电脑离线或暂停" }),
    ).toHaveAttribute("data-state", "offline");
    expect(
      within(rows[1]!).getByRole("img", { name: "电脑在线" }),
    ).toHaveAttribute("data-state", "online");
    expect(
      within(rows[1]!).getByTitle("Bob · Slack · Bob desktop"),
    ).toBeVisible();
    expect(screen.queryByText(group.name)).not.toBeInTheDocument();
    expect(
      screen.queryByText("已加入此 Artemis 空间的成员"),
    ).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText("本任务执行者")).toBeVisible();
    rerender(
      <ImGroupMembers
        managePermissions
        group={{ ...group, stale: true }}
        locale="zh-CN"
      />,
    );
    expect(screen.queryByText("电脑在线")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "状态未知" })).toHaveLength(2);
    for (const icon of screen.getAllByRole("img")) {
      expect(icon).toHaveAttribute("data-state", "offline");
    }
    rerender(
      <ImGroupMembers
        managePermissions
        group={{ ...group, confirmed: false }}
        locale="zh-CN"
      />,
    );
    for (const icon of screen.getAllByRole("img")) {
      expect(icon).toHaveAttribute("data-state", "offline");
    }
  });
  it("refreshes the selected thread's roster and never infers membership from a task title or private chat", async () => {
    vi.useFakeTimers();
    let current = group;
    const getImStatus = vi.fn(async () => ({
      remoteTasks: [
        { threadId: "group", kind: "group", channel: "slack", group: current },
        {
          threadId: "direct",
          kind: "direct",
          channel: "slack",
          group: current,
        },
      ],
    }));
    stubWindowArtemis({ getImStatus });
    const { result } = renderHook(useImThreadStatus);
    await act(async () => {});
    expect(result.current.group?.group?.members).toHaveLength(2);
    expect(result.current.direct?.group).toBeUndefined();
    current = { ...group, members: group.members.slice(1) };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.group?.group?.members).toHaveLength(1);
    getImStatus.mockRejectedValueOnce(new Error("offline"));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.group?.group?.stale).toBe(true);
  });
});

it("shows all four native members with robot icons only for bots", async () => {
  const manage = vi.fn(async () => ({ allowed: false }));
  stubWindowArtemis({ manageIm: manage });
  const roster: NonNullable<ImGroupContext["roster"]> = {
    complete: true,
    members: [
      { identity: identity("u1", "slack"), name: "Alex", kind: "human" },
      { identity: identity("u2", "slack"), name: "Morgan", kind: "human" },
      {
        identity: identity("b1", "slack"),
        name: "Artemis",
        kind: "bot",
        self: true,
      },
      { identity: identity("b2", "slack"), name: "Solar", kind: "bot" },
    ],
  };
  const { rerender } = render(
    <ImGroupMembers
      managePermissions
      group={{ ...group, native: true, roster }}
      locale="zh-CN"
      onMention={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getAllByRole("img", { name: "机器人" })).toHaveLength(2);
  for (const icon of screen.getAllByRole("img", { name: "机器人" })) {
    expect(icon.querySelector("svg")).toHaveAttribute(
      "data-artemis-icon",
      "bot",
    );
    expect(icon.closest("strong")?.textContent).toMatch(/Artemis|Solar/);
  }
  expect(screen.getAllByRole("img", { name: "成员" })).toHaveLength(2);
  expect(screen.getByText("群协作成员 · 4")).toBeVisible();
  const bots = screen.getAllByRole("img", { name: "机器人" });
  expect(bots[0]).toHaveAttribute("data-state", "online");
  expect(bots[1]).toHaveAttribute("data-state", "unknown");
  expect(screen.queryByText("在线")).not.toBeInTheDocument();
  await userEvent.hover(bots[0]!);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("在线");
  await userEvent.unhover(bots[0]!);
  await userEvent.hover(bots[1]!);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("状态未知");
  await userEvent.unhover(bots[1]!);
  expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "@ Artemis" })).toBeVisible();
  expect(
    imGroupMentionTargets({ ...group, native: true, roster })[1]?.name,
  ).toBe("Artemis");
  expect(
    imGroupMentionTargets({ ...group, native: true, roster })[1]?.token,
  ).toBe("@Artemis");
  fireEvent.contextMenu(screen.getByText("Artemis"));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByText("Artemis").closest("[role=listitem]")!, {
    key: "F10",
    shiftKey: true,
  });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "禁止 Solar 派工" })
      .querySelector("svg"),
  ).toHaveAttribute("data-artemis-icon", "send");
  fireEvent.contextMenu(screen.getByText("Alex"));
  await userEvent.click(screen.getByRole("button", { name: "禁止 Alex 派工" }));
  expect(manage).toHaveBeenCalledWith({
    action: "set-group-member-assignment",
    spaceId: group.spaceId,
    identity: roster.members[0]!.identity,
    allowed: false,
  });
  expect(
    screen.getByRole("button", { name: "允许 Alex 派工" }),
  ).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "允许 Alex 派工" }));
  expect(
    screen.getByRole("button", { name: "禁止 Alex 派工" }),
  ).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "禁止 Alex 派工" }));
  await userEvent.click(
    screen.getByRole("button", { name: "禁止 Solar 派工" }),
  );
  expect(manage).toHaveBeenLastCalledWith({
    action: "set-group-member-assignment",
    spaceId: group.spaceId,
    identity: roster.members[3]!.identity,
    allowed: false,
  });
  expect(
    screen.getByRole("button", { name: "允许 Solar 派工" }),
  ).toHaveAttribute("aria-pressed", "true");
  await userEvent.unhover(
    screen.getByRole("button", { name: "允许 Solar 派工" }),
  );
  fireEvent.contextMenu(screen.getByText("Solar"));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const verifyButton = screen.getByRole("button", { name: "重新验证" });
  await userEvent.hover(verifyButton);
  expect(
    (await screen.findByText("重新验证")).closest('[role="tooltip"]'),
  ).toBeVisible();
  await userEvent.unhover(verifyButton);

  rerender(
    <ImGroupMembers
      managePermissions
      group={{
        ...group,
        native: true,
        roster: {
          ...roster,
          members: roster.members.map((m, i) => ({ ...m, owner: i === 0 })),
        },
      }}
      locale="zh-CN"
    />,
  );
  fireEvent.contextMenu(screen.getByText("Alex"));
  fireEvent.keyDown(screen.getByText("Alex").closest("[role=listitem]")!, {
    key: "ContextMenu",
  });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Alex.*派工/ }),
  ).not.toBeInTheDocument();
  rerender(
    <ImGroupMembers
      managePermissions
      group={{
        ...group,
        native: true,
        roster: { ...roster, complete: false, error: "missing-scope" },
      }}
      locale="zh-CN"
    />,
  );
  rerender(
    <ImGroupMembers
      managePermissions
      group={{
        ...group,
        native: true,
        roster,
        members: group.members.map((m) => ({ ...m, state: "offline" })),
      }}
      locale="zh-CN"
    />,
  );
  expect(screen.getAllByRole("img", { name: "机器人" })[0]).toHaveAttribute(
    "data-state",
    "offline",
  );
  rerender(
    <ImGroupMembers
      managePermissions
      group={{ ...group, native: true, roster, stale: true }}
      locale="zh-CN"
    />,
  );
  expect(screen.queryByText("在线")).not.toBeInTheDocument();
  expect(
    screen
      .getAllByRole("img")
      .every((icon) => icon.dataset.state === "unknown"),
  ).toBe(true);
  rerender(
    <ImGroupMembers
      managePermissions
      group={{
        ...group,
        native: true,
        roster: { ...roster, complete: false, error: "missing-scope" },
      }}
      locale="zh-CN"
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("im:chat.members:read");
  expect(screen.queryByText("群协作成员 · 4")).not.toBeInTheDocument();
});

it("shows Slack active and away presence, and makes stale presence unknown", () => {
  stubWindowArtemis({ manageIm: vi.fn(async () => ({})) });
  const roster: NonNullable<ImGroupContext["roster"]> = {
    complete: true,
    members: [
      {
        identity: identity("u1", "slack"),
        name: "Alex",
        kind: "human",
        presence: "active",
        presenceCheckedAt: Date.now(),
      },
      {
        identity: identity("u2", "slack"),
        name: "Morgan",
        kind: "human",
        presence: "away",
        presenceCheckedAt: Date.now(),
      },
      {
        identity: identity("u3", "slack"),
        name: "Expired",
        kind: "human",
        presence: "active",
        presenceCheckedAt: Date.now() - 120001,
      },
      { identity: identity("u4", "slack"), name: "Unknown", kind: "human" },
    ],
  };
  const { rerender } = render(
    <ImGroupMembers
      managePermissions
      group={{ ...group, native: true, roster }}
      locale="zh-CN"
    />,
  );
  expect(
    screen
      .getAllByRole("img", { name: "成员" })
      .map((icon) => icon.getAttribute("data-state")),
  ).toEqual(["active", "away", "unknown", "unknown"]);
  rerender(
    <ImGroupMembers
      managePermissions
      group={{ ...group, native: true, roster, stale: true }}
      locale="zh-CN"
    />,
  );
  expect(
    screen
      .getAllByRole("img", { name: "成员" })
      .every((icon) => icon.getAttribute("data-state") === "unknown"),
  ).toBe(true);
});

it("retries bot verification from its icon and releases the wait after timeout", async () => {
  vi.useFakeTimers();
  const manage = vi.fn(async () => ({ peers: [] }));
  stubWindowArtemis({ manageIm: manage });
  render(
    <ImGroupMembers
      managePermissions
      locale="zh-CN"
      group={{
        ...group,
        native: true,
        roster: {
          complete: true,
          members: [
            {
              identity: identity("solar", "slack"),
              name: "Solar",
              kind: "bot",
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("未完成验证")).toBeInTheDocument();
  fireEvent.contextMenu(screen.getByText("Solar"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重新验证" }));
  });
  expect(manage).toHaveBeenCalledWith({
    action: "native-cooperation",
    groupId: group.spaceId,
    operation: "probe",
    peer: "solar",
  });
  fireEvent.contextMenu(screen.getByText("Solar"));
  expect(screen.getByRole("button", { name: "验证中" })).toBeDisabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32000);
  });
  expect(screen.getByRole("button", { name: "重新验证" })).toBeEnabled();
  expect(screen.getByText("未完成验证")).toBeInTheDocument();
  manage.mockRejectedValueOnce(new Error("Gateway unavailable"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重新验证" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Gateway unavailable");
});

it("shows successful verification and removes the retry action", async () => {
  vi.useFakeTimers();
  const manage = vi.fn(async () => ({
    peers: [{ id: "solar", verifiedAt: Date.now() }],
  }));
  stubWindowArtemis({ manageIm: manage });
  render(
    <ImGroupMembers
      managePermissions
      locale="zh-CN"
      group={{
        ...group,
        native: true,
        roster: {
          complete: true,
          members: [
            {
              identity: identity("solar", "slack"),
              name: "Solar",
              kind: "bot",
              verificationPendingUntil: Date.now() + 30000,
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("验证中")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText("已验证")).toBeInTheDocument();
  fireEvent.contextMenu(screen.getByText("Solar"));
  expect(
    screen.queryByRole("button", { name: "重新验证" }),
  ).not.toBeInTheDocument();
});

it("keeps task member lists read-only without a permission settings entry", () => {
  stubWindowArtemis({ manageIm: vi.fn().mockResolvedValue({}) });
  render(<ImGroupMembers group={{ ...group, native: true }} locale="zh-CN" />);
  expect(
    screen.queryByRole("button", { name: /允许.*派任务|禁止.*派任务/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "项目与协作权限" }),
  ).not.toBeInTheDocument();
});

it("refreshes visible native members and bots while open, on return, and stops on close", async () => {
  vi.useFakeTimers();
  let current: ImGroupContext = {
    ...group,
    native: true,
    roster: {
      complete: true,
      members: [
        {
          identity: identity("self", "feishu"),
          name: "ArtemisLark",
          kind: "bot",
          self: true,
        },
        { identity: identity("old", "feishu"), name: "Mino", kind: "bot" },
      ],
    },
  };
  let next = current;
  const manageIm = vi.fn(async () => {
    current = next;
  });
  const getImStatus = vi.fn(async () => ({
    remoteTasks: [
      { threadId: "room", kind: "group", channel: "feishu", group: current },
    ],
  }));
  stubWindowArtemis({ manageIm, getImStatus });
  function Panel() {
    const statuses = useImThreadStatus();
    return statuses.room?.group ? (
      <ImGroupMembers group={statuses.room.group} locale="zh-CN" />
    ) : null;
  }
  const { unmount } = render(<Panel />);
  await act(async () => {});
  expect(screen.getByText("Mino")).toBeVisible();
  next = {
    ...current,
    roster: {
      complete: true,
      members: [
        current.roster!.members[0]!,
        {
          identity: identity("peer", "feishu"),
          name: "Teammate bot",
          kind: "bot",
        },
        {
          identity: identity("human", "feishu"),
          name: "Teammate",
          kind: "human",
        },
      ],
    },
  };
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(screen.queryByText("Mino")).not.toBeInTheDocument();
  expect(screen.getByText("Teammate bot")).toBeVisible();
  expect(screen.getByText("Teammate")).toBeVisible();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const calls = manageIm.mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(manageIm).toHaveBeenCalledTimes(calls);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(manageIm).toHaveBeenCalledTimes(calls + 1);
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(manageIm).toHaveBeenCalledTimes(calls + 1);
});

it("offers Feishu/Lark bot permission and communication retry in the task member list", async () => {
  const manage = vi.fn().mockResolvedValue({});
  stubWindowArtemis({ manageIm: manage });
  render(
    <ImGroupMembers
      locale="zh-CN"
      group={{
        ...group,
        native: true,
        roster: {
          complete: true,
          members: [
            {
              identity: identity("mino", "feishu"),
              name: "Mino",
              kind: "bot",
              canAssign: false,
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("通信待验证")).toBeInTheDocument();
  expect(screen.getByText("未授权协作")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "允许 Mino 派工" }));
  });
  expect(manage).toHaveBeenCalledWith({
    action: "set-group-member-assignment",
    spaceId: group.spaceId,
    identity: identity("mino", "feishu"),
    allowed: true,
  });
  expect(screen.getByText("已授权协作")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新验证" })).toBeEnabled();
});

it.each(["feishu", "slack"] as const)(
  "keeps %s task controls scoped and shows communication timeout separately",
  (channel) => {
    stubWindowArtemis({ manageIm: vi.fn().mockResolvedValue({}) });
    render(
      <ImGroupMembers
        locale="zh-CN"
        group={{
          ...group,
          native: true,
          roster: {
            complete: true,
            members: [
              {
                identity: identity("peer", channel),
                name: "Peer",
                kind: "bot",
                canAssign: false,
                verificationPendingUntil: Date.now() - 1000,
              },
            ],
          },
        }}
      />,
    );
    if (channel === "feishu") {
      expect(screen.getByText("通信验证超时")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重新验证" })).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "允许 Peer 派工" }),
      ).toBeEnabled();
    } else {
      expect(screen.getByText("未完成验证")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "重新验证" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "允许 Peer 派工" }),
      ).not.toBeInTheDocument();
    }
  },
);
