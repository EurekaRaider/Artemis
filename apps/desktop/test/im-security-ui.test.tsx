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

it("bulk selects only explicit unprotected entries for the chosen audience and resets confirmation", async () => {
  const user = userEvent.setup();
  stubWindowArtemis({
    manageIm: vi.fn(async () => [
      { path: "src", directory: true, protected: false },
      { path: "README.md", directory: false, protected: false },
      { path: ".env", directory: false, protected: true },
      { path: ".git", directory: true, protected: true },
    ]),
  });
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
        audiences={[{ value: "space:team", label: "Team", revision: "v1" }]}
        disabled={false}
      />
    );
  }
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "全选可处理" }));
  expect(value!.security!.scopes[0]).toMatchObject({
    audience: "owner",
    readPaths: ["src", "README.md"],
    writePaths: [],
    filePaths: ["README.md"],
  });
  await user.click(screen.getByRole("checkbox", { name: /我确认以上/ }));
  await user.click(screen.getByRole("button", { name: "全选可修改" }));
  expect(value!.security!.confirmedAt).toBe(0);
  expect(value!.security!.scopes[0]!.writePaths).toEqual(["src", "README.md"]);
  await user.click(screen.getByRole("button", { name: /^分享给谁/ }));
  await user.click(screen.getByRole("option", { name: "Team", exact: true }));
  await user.click(screen.getByRole("button", { name: "全选可处理" }));
  expect(value!.security!.scopes[1]).toMatchObject({
    audience: "space:team",
    readPaths: ["src", "README.md"],
    writePaths: [],
    spaceRevision: "v1",
  });
  await user.click(screen.getByRole("button", { name: "清除此范围" }));
  expect(
    value!.security!.scopes.find((s) => s.audience === "space:team")!.readPaths,
  ).toEqual([]);
  expect(
    value!.security!.scopes.find((s) => s.audience === "owner")!.writePaths,
  ).toEqual(["src", "README.md"]);
});

it("exposes disclosure state and preserves inherited permissions with keyboard controls", async () => {
  const user = userEvent.setup();
  stubWindowArtemis({
    manageIm: vi.fn(async ({ path }: { path?: string }) =>
      path === "src"
        ? [{ path: "src/index.ts", directory: false, protected: false }]
        : [{ path: "src", directory: true, protected: false }],
    ),
  });
  function Editor() {
    const [grant, setGrant] = useState(
      executionGrantSchema.parse({
        projectId: "p",
        expiresAt: Date.now() + 60000,
      }),
    );
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
  await user.click(screen.getByRole("button", { name: "全选可处理" }));
  const disclosure = screen.getByRole("button", {
    name: "展开 src",
    expanded: false,
  });
  disclosure.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "收起 src", expanded: true })).toBe(
    disclosure,
  );
  const inherited = screen.getByRole("checkbox", {
    name: "可处理 src/index.ts",
  }) as HTMLInputElement;
  expect(inherited.checked).toBe(true);
  expect(inherited.disabled).toBe(true);
  await user.keyboard(" ");
  expect(
    screen.queryByRole("checkbox", { name: "可处理 src/index.ts" }),
  ).toBeNull();
  const read = screen.getByRole("checkbox", {
    name: "可处理 src",
  }) as HTMLInputElement;
  read.focus();
  await user.keyboard(" ");
  expect(read.checked).toBe(false);
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
