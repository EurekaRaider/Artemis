// @vitest-environment jsdom
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
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
  await user.click(screen.getByRole("button", { name: /研发群 · Slack/ }));
  await user.click(screen.getByRole("button", { name: "为此群授权" }));
  return user;
}
it("requires an explicit project and preserves the draft across Back without saving settings", async () => {
  const f = fixture();
  render(<GroupCollaborationPanel {...f.props} />);
  const user = await openGroup();
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /^项目/ }));
  await user.click(screen.getByRole("option", { name: "Project A" }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText("项目共享策略", { selector: "h3" })).toBeVisible();
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
  await user.click(screen.getByRole("option", { name: /仅选定条目/ }));
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(f.props.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
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
