// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  executionGrantSchema,
  type ExecutionGrant,
  type ImOutboundCandidate,
} from "@artemis/protocol";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { ImDataPermissions } from "../src/renderer/ImDataPermissions.js";
import { ImOutboundReview } from "../src/renderer/ImOutboundReview.js";
import { ImHandoff } from "../src/renderer/ImHandoff.js";
const t = (cn: string) => cn;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requires explicit file selection and confirmation and keeps writes within reads", async () => {
  const user = userEvent.setup();
  const manage = vi.fn(async () => [
    { path: "src", directory: true, protected: false },
    { path: ".env", directory: false, protected: true },
  ]);
  stubWindowArtemis({ manageIm: manage });
  let value: ExecutionGrant;
  function Editor() {
    const [grant, setGrant] = useState(
      executionGrantSchema.parse({
        projectId: "p",
        expiresAt: Date.now() + 60000,
      }),
    );
    value = grant;
    return (
      <ImDataPermissions
        grant={grant}
        onChange={(security) => setGrant({ ...grant, security })}
        t={t}
        audiences={[]}
        disabled={false}
      />
    );
  }
  render(<Editor />);
  expect(value!.security).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "选择目录或文件" }));
  expect(screen.queryByRole("checkbox", { name: "可处理 .env" })).toBeNull();
  expect(
    (screen.getByRole("checkbox", { name: "可修改 src" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "可处理 src" }));
  await user.click(screen.getByRole("checkbox", { name: "可修改 src" }));
  await user.click(screen.getByRole("checkbox", { name: /我确认以上/ }));
  expect(value!.security!.confirmedAt).toBeGreaterThan(0);
  await user.click(screen.getByRole("checkbox", { name: "可处理 src" }));
  expect(value!.security!.scopes[0]!.writePaths).toEqual([]);
  expect(value!.security!.confirmedAt).toBe(0);
});

it("shows sensitive previews as inert text and sends only the reviewed content hash", async () => {
  const user = userEvent.setup();
  const candidate: ImOutboundCandidate = {
    id: "candidate",
    threadId: "task",
    kind: "reply",
    contentHash: "frozen-hash",
    expiresAt: Date.now() + 60000,
    state: "pending",
    reason: "审阅候选",
    security: {
      version: 2,
      projectId: "p",
      revision: "revision",
      audience: "space:team",
      identityKey: "owner",
      messageId: "m",
      source: "owner",
    },
  };
  const manage = vi.fn(async (action: { action: string }) =>
    action.action === "outbound-list"
      ? [candidate]
      : action.action === "outbound-preview"
        ? {
            ...candidate,
            body: { text: '<img src="https://secret.example.test">' },
          }
        : {},
  );
  stubWindowArtemis({ manageIm: manage });
  const { container } = render(<ImOutboundReview t={t} />);
  await user.click(screen.getByRole("button", { name: "刷新待审结果" }));
  await user.click(screen.getByRole("button", { name: /审阅候选/ }));
  expect(container.querySelector("img")).toBeNull();
  const editor = screen.getByRole("textbox", { name: "预览或修改发送内容" });
  await user.clear(editor);
  await user.type(editor, "Reviewed summary");
  await user.click(screen.getByRole("button", { name: "仅发送这一次" }));
  expect(manage).toHaveBeenLastCalledWith({ action: "outbound-list" });
  expect(manage).toHaveBeenCalledWith({
    action: "outbound-resolve",
    id: "candidate",
    contentHash: "frozen-hash",
    approve: true,
    text: "Reviewed summary",
  });
});

it("requires an explicit handoff target and selected text", () => {
  stubWindowArtemis({ manageIm: vi.fn() });
  render(<ImHandoff tasks={[]} t={t} />);
  expect(
    (
      screen.getByRole("button", {
        name: "确认文字并交接",
        hidden: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
