// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  imSettingsSchema,
  type ImStatus,
  type ImConnectionStatus,
  type ImManagement,
  type ImSettings,
} from "@artemis/protocol";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { ImSettingsPanel } from "../src/renderer/ImSettingsPanel.js";
import { ImPairingCode } from "../src/renderer/ImAccountControls.js";
import { ImNavigation } from "../src/renderer/ImNavigation.js";
import { ImDiagnostics } from "../src/renderer/ImDiagnostics.js";

const identity = {
  channel: "wecom" as const,
  connectionId: "wecom-team",
  tenantId: "test-corp",
  appId: "test-bot",
  userId: "test-user",
};
const connection: ImConnectionStatus = {
  id: "wecom-team",
  name: "Test bot",
  channel: "wecom",
  state: "connected",
  configuration: {
    id: "wecom-team",
    name: "Test bot",
    tenantId: "test-corp",
    botId: "test-bot",
  },
};
type Status = ImStatus & { connections: ImConnectionStatus[] };
const t = (cn: string) => cn;
function fixture(ready = true) {
  let current: Status = {
    settings: imSettingsSchema.parse(
      ready
        ? {
            gatewayUrl: "https://gateway.example.test",
            deviceId: "test-device",
          }
        : {},
    ),
    state: "disabled",
    identities: ready ? [identity] : [],
    connections: ready ? [connection] : [],
    pairingRequests: [],
  };
  const manage = vi.fn(async (input: ImManagement): Promise<unknown> => {
    if (input.action === "setup-local") {
      current = {
        ...current,
        settings: {
          ...current.settings,
          gatewayUrl: "http://127.0.0.1:12345",
          deviceId: "local-device",
        },
        localGateway: { state: "running" },
      };
    }
    if (input.action === "pair")
      return { code: "0123456789abcdef", expiresIn: 300 };
    if (input.action === "unpair") current = { ...current, identities: [] };
    if (input.action === "resolve-pairing")
      current = {
        ...current,
        identities: input.approve ? [identity] : [],
        pairingRequests: [],
      };
    if (input.action === "admin" && input.operation === "connections")
      current = { ...current, connections: [connection] };
    return structuredClone(current);
  });
  const save = vi.fn(async (settings: ImSettings) => {
    current = { ...current, settings };
    return structuredClone(current);
  });
  stubWindowArtemis({
    getImStatus: vi.fn(async () => structuredClone(current)),
    getSnapshot: vi.fn(async () => ({
      projects: [
        {
          id: "test-project",
          name: "Test project",
          path: "/synthetic/project",
        },
      ],
    })),
    manageIm: manage,
    saveImSettings: save,
  });
  return {
    manage,
    save,
    get: () => current,
    set: (patch: Partial<Status>) => {
      current = { ...current, ...patch };
    },
  };
}
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const nav = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(name) });

describe("production IM settings", () => {
  it("keeps a first successful credential save distinct from a failed status refresh", async () => {
    const f = fixture();
    f.set({ identities: [], connections: [] });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "refresh") throw new Error("Refresh offline");
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(
      await screen.findByRole("button", { name: "3. 连接一个机器人" }),
    );
    for (const [label, value] of [
      ["连接 ID", "wecom-team"],
      ["连接名称", "Test bot"],
      ["企业 ID / Tenant Key", "test-corp"],
      ["Bot ID", "test-bot"],
      ["Bot Secret", "synthetic-secret"],
      ["机器人配置的管理凭据", "a".repeat(32)],
    ])
      await user.type(screen.getByLabelText(label!), value!);
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    expect(
      await screen.findByText(/凭据已保存，但连接状态刷新失败/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "更换" })).toBeVisible();
    expect(screen.getByText("凭据已保存，请刷新确认连接状态。")).toBeVisible();
    expect(screen.getByRole("switch", { name: "启用 IM 连接" })).toBeDisabled();
    expect(screen.queryByLabelText("Bot Secret")).not.toBeInTheDocument();
  });
  it("does not overwrite a completed action with an older in-flight refresh", async () => {
    const f = fixture();
    f.set({ settings: { ...f.get().settings, enabled: true } });
    vi.useFakeTimers();
    await act(async () => {
      render(<ImSettingsPanel locale="zh-CN" />);
    });
    expect(screen.getByRole("heading", { name: "应用凭据" })).toBeVisible();
    const old = structuredClone(f.get());
    let finishRefresh!: (value: Status) => void;
    f.manage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    f.set({
      connections: [
        { ...connection, state: "error", error: "Channel offline" },
      ],
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("switch", { name: "启用 IM 连接" })),
    );
    await act(async () => finishRefresh(old));
    expect(screen.getByText("Test bot · 连接错误")).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "启用 IM 连接" }),
    ).not.toBeChecked();
  });
  it("shows six real steps and platform constraints before configuration, then starts and registers once", async () => {
    const f = fixture(false);
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    expect(
      await screen.findByRole("list", { name: "IM 设置步骤" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("需公网 HTTPS 回调 · 团队服务")).toBeVisible();
    expect(screen.getByRole("switch", { name: "启用 IM 连接" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "1. 准备 Gateway" }));
    await user.click(screen.getByRole("button", { name: "一键启动并注册" }));
    await waitFor(() =>
      expect(f.manage).toHaveBeenCalledWith({ action: "setup-local" }),
    );
    expect(
      await screen.findByRole("heading", { name: "企业微信" }),
    ).toBeVisible();
    expect(f.get().settings.enabled).toBe(false);
    expect(f.get().settings.grants).toEqual([]);
    expect(
      screen.queryByLabelText("机器人配置的管理凭据"),
    ).not.toBeInTheDocument();
  });
  it("opens management from connected and paired data and reviews the guide without clearing configuration", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    expect(
      await screen.findByRole("heading", { name: "应用凭据" }),
    ).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "重看设置指引" }));
    expect(
      screen
        .getByRole("list", { name: "IM 设置步骤" })
        .querySelector('[aria-current="step"]'),
    ).toHaveTextContent("选择项目并启用");
    await user.click(screen.getByRole("button", { name: "返回管理" }));
    expect(screen.getByRole("heading", { name: "应用凭据" })).toBeVisible();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.get().identities).toEqual([identity]);
  });
  it("supports tab arrow navigation and returns to the first/last entry", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    nav("企业微信").focus();
    await user.keyboard("{ArrowDown}");
    expect(nav("飞书")).toHaveFocus();
    expect(nav("飞书")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(nav("群协作空间")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(nav("企业微信")).toHaveFocus();
  });
  it("replaces credentials using public identifiers, never fills secrets, and cancels locally", async () => {
    const f = fixture();
    f.set({
      connections: [
        {
          ...connection,
          configuration: Object.assign({}, connection.configuration, {
            secret: "must-never-be-refilled",
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(await screen.findByRole("button", { name: "更换" }));
    expect(screen.getByLabelText("连接 ID")).toHaveValue("wecom-team");
    expect(screen.getByLabelText("Bot ID")).toHaveValue("test-bot");
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("");
    await user.type(screen.getByLabelText("Bot Secret"), "synthetic-secret");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "更换" }));
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("");
    expect(f.manage).not.toHaveBeenCalled();
  });
  it("clears administrator credentials on a failed save and does not generate a pairing code", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(await screen.findByRole("button", { name: "更换" }));
    await user.type(screen.getByLabelText("Bot Secret"), "synthetic-secret");
    await user.type(
      screen.getByLabelText("机器人配置的管理凭据"),
      "a".repeat(32),
    );
    f.manage.mockRejectedValueOnce(new Error("Gateway unavailable"));
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    expect(await screen.findByText("Gateway unavailable")).toBeVisible();
    expect(screen.getByLabelText("机器人配置的管理凭据")).toHaveValue("");
    expect(f.manage.mock.calls.some(([input]) => input.action === "pair")).toBe(
      false,
    );
  });
  it("keeps saved credentials when the subsequent pairing-code request fails", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(await screen.findByRole("button", { name: "更换" }));
    await user.type(screen.getByLabelText("Bot Secret"), "synthetic-secret");
    await user.type(
      screen.getByLabelText("机器人配置的管理凭据"),
      "a".repeat(32),
    );
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "pair") throw new Error("Pairing unavailable");
      return original(input);
    });
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    expect(
      await screen.findByText(/凭据已保存，但配对码生成失败/),
    ).toBeVisible();
    expect(screen.queryByLabelText("Bot Secret")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更换" })).toBeVisible();
  });
  it("keeps saved grants when pausing, and does not silently save a project draft from the header", async () => {
    const f = fixture();
    f.set({ settings: { ...f.get().settings, enabled: true } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("项目授权"));
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    await user.click(screen.getByRole("switch", { name: "启用 IM 连接" }));
    expect(f.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, grants: [] }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Test project" }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存项目授权" }));
    expect(f.get().settings).toMatchObject({
      enabled: false,
      defaultProjectId: "test-project",
      grants: [{ mode: "plan", approval: "ask", shell: false, network: false }],
    });
  });
  it("can pause a degraded active connection while blocking a new enable without a bot", async () => {
    const f = fixture();
    f.set({
      connections: [],
      settings: { ...f.get().settings, enabled: true },
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    const toggle = await screen.findByRole("switch", { name: "启用 IM 连接" });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(toggle).toBeDisabled();
    expect(screen.getByText("请先连接至少一个机器人渠道。")).toBeVisible();
  });
  it("approves real pending data and automatically enters management; rejection does not bind", async () => {
    const f = fixture();
    f.set({
      identities: [],
      pairingRequests: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          identity,
          expiresAt: Date.now() + 300000,
        },
      ],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(
      await screen.findByRole("button", { name: "4. 绑定你的 IM 账号" }),
    );
    await user.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "批准" }),
      ).not.toBeInTheDocument(),
    );
    expect(f.get().identities).toEqual([]);
    f.set({
      pairingRequests: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          identity,
          expiresAt: Date.now() + 300000,
        },
      ],
    });
    await user.click(
      screen.getByRole("button", { name: "我已发送，刷新配对结果" }),
    );
    await user.click(await screen.findByRole("button", { name: "批准" }));
    expect(
      await screen.findByRole("heading", { name: "应用凭据" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "批准" }),
    ).not.toBeInTheDocument();
    expect(f.get().identities).toEqual([identity]);
  });
  it("requires inline unpair confirmation, restores focus on Escape, and retains failed confirmation", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    const trigger = await screen.findByRole("button", { name: "解除绑定" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "确认解除" })).toHaveFocus();
    expect(f.manage).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    f.manage.mockRejectedValueOnce(new Error("Cannot unpair"));
    await user.click(screen.getByRole("button", { name: "确认解除" }));
    expect(await screen.findByText("Cannot unpair")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认解除" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认解除" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "解除绑定" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("keeps advanced collaboration collapsed, clears diagnostic credentials and rejects invalid JSON locally", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("群协作空间"));
    const summary = screen.getByText(/进阶：群聊与跨 IM 协作/);
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    await user.type(screen.getByLabelText("协作空间管理凭据"), "a".repeat(32));
    await user.click(
      screen.getByRole("button", { name: "查看连接、成员和投递诊断" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("协作空间管理凭据")).toHaveValue(""),
    );
    await user.type(screen.getByLabelText("协作空间管理凭据"), "a".repeat(32));
    fireEvent.change(screen.getByLabelText("空间配置（JSON）"), {
      target: { value: "invalid json" },
    });
    await user.click(
      screen.getByRole("button", { name: "保存空间并等待各群确认" }),
    );
    expect(
      f.manage.mock.calls
        .filter(([input]) => input.action === "admin")
        .map(([input]) => input),
    ).toHaveLength(1);
  });
});

describe("pairing code lifecycle", () => {
  it("renders real member/group diagnostics and loads an existing space without its server revision", async () => {
    const editSpace = vi.fn();
    const space = {
      id: "test-space",
      name: "Test space",
      revision: "server-revision",
      endpoints: [
        { connectionId: "wecom-team", id: "test-group", kind: "group" },
      ],
      participants: [
        { deviceId: "test-device", identity, name: "Test member" },
      ],
      administrators: [identity],
    };
    const user = userEvent.setup();
    render(
      <ImDiagnostics
        t={t}
        editSpace={editSpace}
        value={{
          identities: [{ identity, deviceId: "test-device" }],
          groups: [
            { conversation: space.endpoints[0], lastSeenAt: Date.now() },
          ],
          deliveries: [{ state: "pending", count: 2 }],
          spaces: [space],
        }}
      />,
    );
    expect(
      screen.getByText("test-user · 企业微信 · test-device"),
    ).toBeVisible();
    expect(screen.getByText("wecom-team · test-group")).toBeVisible();
    expect(screen.getByText("pending · 2")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "编辑空间：Test space" }),
    );
    const loaded = JSON.parse(editSpace.mock.calls[0]![0]);
    expect(loaded).not.toHaveProperty("revision");
    expect(loaded.administrators).toEqual([identity]);
    expect(loaded.endpoints).toEqual(space.endpoints);
  });
  it("counts down from five minutes, rejects expired copying even before the timer tick, and regenerates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const copy = vi.fn(),
      generate = vi.fn();
    const ui = render(
      <ImPairingCode
        t={t}
        pair={{ code: "test-code", expiresAt: 301000 }}
        slack={false}
        busy={false}
        generate={generate}
        copy={copy}
      />,
    );
    expect(screen.getByLabelText("剩余有效时间")).toHaveTextContent("5:00");
    fireEvent.click(screen.getByRole("button", { name: "复制配对指令" }));
    expect(copy).toHaveBeenLastCalledWith("/pair test-code");
    vi.setSystemTime(301001);
    fireEvent.click(screen.getByRole("button", { name: "复制配对指令" }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "复制配对指令" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新生成配对码" }));
    expect(generate).toHaveBeenCalledOnce();
    ui.rerender(
      <ImPairingCode
        t={t}
        pair={{ code: "new-code", expiresAt: 601001 }}
        slack
        busy={false}
        generate={generate}
        copy={copy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制配对指令" }));
    expect(copy).toHaveBeenLastCalledWith("pair new-code");
    await act(() => vi.advanceTimersByTimeAsync(300000));
    expect(screen.getByRole("button", { name: "复制配对指令" })).toBeDisabled();
  });
  it("uses the compact general menu with keyboard selection and Escape focus restoration", async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    render(
      <ImNavigation
        view="wecom"
        onSelect={select}
        connections={[connection]}
        compact
        t={t}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /通用/ }));
    const menu = await screen.findByRole("menu", { name: "通用设置" });
    await waitFor(() =>
      expect(
        within(menu).getByRole("menuitem", { name: "Gateway 与设备" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{End}{Enter}");
    expect(select).toHaveBeenCalledWith("spaces");
    await user.click(screen.getByRole("tab", { name: /通用/ }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /通用/ })).toHaveFocus(),
    );
  });
});
