// @vitest-environment jsdom
import {
  act,
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
  executionGrantSchema,
  resolveImGroupMentions,
  imGroupMentionTargets,
  type ImGroupContext,
  type Project,
} from "@artemis/protocol";
import { ImGroupTaskComposer } from "../src/renderer/ImGroupTaskComposer.js";
import { ImGroupMembers } from "../src/renderer/ImGroupMembers.js";
import { ImSavedSpaces } from "../src/renderer/ImSavedSpaces.js";
import { useImThreadDevices } from "../src/renderer/ImThreadDevices.js";
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
  it("restores saved space configuration and requires a separate delete confirmation while retaining failed attempts", async () => {
    const user = userEvent.setup(),
      edit = vi.fn(),
      remove = vi.fn(async () => false);
    render(
      <ImSavedSpaces
        spaces={[space]}
        settings={imSettingsSchema.parse({})}
        tasks={[]}
        edit={edit}
        remove={remove}
        canRemove
        busy={false}
        t={(cn) => cn}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: `打开已保存配置：${space.name}` }),
    );
    expect(JSON.parse(edit.mock.calls[0]![0])).toMatchObject({
      id: space.id,
      endpoints: space.endpoints,
    });
    expect(edit.mock.calls[0]![1]).toBe("/space-confirm team");
    await user.click(
      screen.getByRole("button", { name: `删除空间：${space.name}` }),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/原生 IM 群与已有对话历史保留/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: `删除空间：${space.name}` }),
    );
    await user.click(screen.getByRole("button", { name: "确认删除空间" }));
    expect(remove).toHaveBeenCalledWith(space.id);
    expect(screen.getByRole("button", { name: "确认删除空间" })).toBeVisible();
  });
  it("opens a conversation with selected identities and saves editable member and computer names", async () => {
    const user = userEvent.setup(),
      open = vi.fn(),
      rename = vi.fn(async () => true);
    const settings = imSettingsSchema.parse({
      enabled: true,
      grants: [
        executionGrantSchema.parse({
          projectId: "project",
          groups: ["space:team"],
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    const props = {
      settings,
      projects: [{ id: "project", name: "Local project" } as Project],
      busy: false,
      open,
      rename,
      canRemove: true,
      remove: vi.fn(async () => true),
      t: (cn: string) => cn,
    };
    const { rerender } = render(
      <ImGroupTaskComposer {...props} spaces={[space]} />,
    );
    const button = screen.getByRole("button", { name: "创建并打开协作对话" });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^协作空间/ }));
    await user.click(screen.getByRole("option", { name: group.name }));
    await user.click(screen.getByRole("checkbox", { name: /^Bob/ }));
    expect(open).not.toHaveBeenCalled();
    await user.click(button);
    expect(open).toHaveBeenCalledWith("team", ["bob-device"], "project");
    await user.click(screen.getByRole("button", { name: "重命名：Bob" }));
    await user.clear(screen.getByLabelText("成员姓名"));
    await user.type(screen.getByLabelText("成员姓名"), "小博");
    await user.clear(screen.getByLabelText("电脑名称"));
    await user.type(screen.getByLabelText("电脑名称"), "开发机");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(rename).toHaveBeenCalledWith("bob-device", "小博", "开发机");
    expect(screen.queryByLabelText("成员姓名")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "从整个空间移除：Bob · Bob desktop" }),
    );
    expect(props.remove).not.toHaveBeenCalled();
    expect(
      screen.getByText(/所有连接的群与协作对话都不能再向其派发任务/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(props.remove).not.toHaveBeenCalled();

    rerender(
      <ImGroupTaskComposer
        {...props}
        spaces={[{ ...space, confirmed: false }]}
      />,
    );
    expect(button).toBeDisabled();
    rerender(
      <ImGroupTaskComposer
        {...props}
        spaces={[{ ...space, participants: space.participants.slice(0, 1) }]}
      />,
    );
    expect(button).toBeDisabled();
  });
  it("selects @ members by keyboard without submitting, and resolves equal names to different computers", async () => {
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
          <ImMemberMentionMenu mentions={mentions} zh />
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
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenCalledWith("@Bob 检查接口");
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
  it("shows actual member platforms, devices, executor and stale state", () => {
    const { rerender } = render(
      <ImGroupMembers group={group} locale="zh-CN" />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Alice laptop");
    expect(rows[0]).toHaveTextContent("电脑离线或暂停");
    expect(rows[1]).toHaveTextContent("Slack");
    expect(within(rows[1]!).getByText("本任务执行者")).toBeVisible();
    rerender(
      <ImGroupMembers group={{ ...group, stale: true }} locale="zh-CN" />,
    );
    expect(screen.queryByText("电脑在线")).not.toBeInTheDocument();
    expect(screen.getAllByText("状态未知")).toHaveLength(2);
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
    const { result } = renderHook(useImThreadDevices);
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
