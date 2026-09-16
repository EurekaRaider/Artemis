// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImNativeConversation } from "../src/renderer/ImNativeConversation";
import { stubWindowArtemis } from "./renderer-test-utils";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps local and public drafts separate and switches without sending", async () => {
  const manage = vi.fn(async (_input: unknown) => ({
    tasks: [],
    messages: [],
  }));
  stubWindowArtemis({ manageIm: manage });
  await act(async () => {
    render(
      <ImNativeConversation
        threadId="group"
        group={{
          spaceId: "g",
          name: "Team",
          native: true,
          capability: "manual",
          confirmed: true,
          stale: false,
          executingDeviceId: "d",
          members: [],
        }}
        zh
        drafts={new Map()}
        open={() => {}}
      />,
    );
  });
  fireEvent.change(screen.getByLabelText("仅在本机执行，结果不自动外发"), {
    target: { value: "private draft" },
  });
  fireEvent.click(screen.getByLabelText("输入用途"));
  fireEvent.click(screen.getByRole("option", { name: "发送到群" }));
  expect(
    manage.mock.calls.some(
      ([input]) =>
        (input as { action: string }).action === "native-group-input",
    ),
  ).toBe(false);
  expect(
    (screen.getByLabelText("公开发送到 Team") as HTMLTextAreaElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("公开发送到 Team"), {
    target: { value: "public draft" },
  });
  fireEvent.click(screen.getByLabelText("输入用途"));
  fireEvent.click(screen.getByRole("option", { name: "本地指令" }));
  expect(
    (
      screen.getByLabelText(
        "仅在本机执行，结果不自动外发",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("private draft");
  await act(async () => fireEvent.click(screen.getByText("启动本地任务")));
  expect(manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "native-group-input",
      destination: "local",
      text: "private draft",
    }),
  );
});

it("orders public messages and IM receipts chronologically and requests remote cancellation through IM", async () => {
  const manage = vi.fn(async () => ({
    tasks: [],
    messages: [
      {
        id: "later",
        time: 3000,
        text: "Later public message",
        state: "platform-accepted",
      },
    ],
    cooperation: {
      history: [
        {
          id: "receipt",
          time: 1000,
          direction: "incoming",
          envelope: {
            action: "accepted",
            sender: "Bot B",
            recipient: "Bot A",
            text: "Earlier acceptance receipt",
          },
        },
      ],
      tasks: [
        {
          id: "remote",
          workflow: "flow",
          updatedAt: 2000,
          direction: "outgoing",
          state: "accepted",
          peer: "Bot B",
          text: "Remote assignment",
        },
      ],
    },
  }));
  const localCancel = vi.fn();
  stubWindowArtemis({ manageIm: manage, cancelTurn: localCancel });
  await act(async () => {
    render(
      <ImNativeConversation
        threadId="group"
        group={{
          spaceId: "g",
          name: "Team",
          native: true,
          capability: "events",
          confirmed: true,
          stale: false,
          executingDeviceId: "d",
          members: [],
        }}
        zh
        drafts={new Map()}
        open={() => {}}
      />,
    );
  });
  const text = document.body.textContent!;
  expect(text.indexOf("Earlier acceptance receipt")).toBeLessThan(
    text.indexOf("Remote assignment"),
  );
  expect(text.indexOf("Remote assignment")).toBeLessThan(
    text.indexOf("Later public message"),
  );
  await act(async () => fireEvent.click(screen.getByText("通过 IM 请求取消")));
  expect(manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "native-cancel",
      groupId: "g",
      taskId: "remote",
    }),
  );
  expect(localCancel).not.toHaveBeenCalled();
});
