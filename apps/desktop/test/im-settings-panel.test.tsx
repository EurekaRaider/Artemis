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
import {
  ImNavigation,
  imConnectionHealth,
} from "../src/renderer/ImNavigation.js";
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
type Status = ImStatus & {
  connections: ImConnectionStatus[];
  spaces?: unknown[];
};
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
  it.each(["slack", "feishu", "wecom"] as const)(
    "refreshes %s connection signals after disconnect, failure, and recovery",
    async (channel) => {
      vi.useFakeTimers();
      const f = fixture();
      f.set({
        state: "connected",
        settings: { ...f.get().settings, enabled: true },
        connections: [{ ...connection, channel }],
        identities: [{ ...identity, channel }],
      });
      render(<ImSettingsPanel locale="zh-CN" />);
      await act(async () => {});
      const signal = () => document.querySelector(`#im-nav-${channel} .im-dot`);
      expect(signal()).toHaveAttribute("data-state", "connected");
      f.set({ connections: [{ ...connection, channel, state: "connecting" }] });
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(signal()).toHaveAttribute("data-state", "connecting");
      f.manage.mockRejectedValueOnce(new Error("Gateway offline"));
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(signal()).toHaveAttribute("data-state", "error");
      f.set({ connections: [{ ...connection, channel, state: "connected" }] });
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(signal()).toHaveAttribute("data-state", "connected");
    },
  );
  it("preserves credential edits across disconnect and reconnect", async () => {
    vi.useFakeTimers();
    const f = fixture();
    render(<ImSettingsPanel locale="zh-CN" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "更换" }));
    fireEvent.change(screen.getByLabelText("Bot Secret"), {
      target: { value: "unsaved-secret" },
    });
    f.set({ connections: [{ ...connection, state: "error" }] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    f.set({ connections: [connection] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("unsaved-secret");
  });
  it("loads local groups automatically on entry and restores a saved space after reopening settings", async () => {
    const f = fixture();
    const space = {
      id: "saved",
      name: "Saved team",
      confirmed: true,
      endpoints: [
        { connectionId: connection.id, id: "existing-group", kind: "group" },
      ],
      participants: [{ deviceId: "test-device", identity, name: "Alice" }],
      administrators: [identity],
    };
    f.set({ localGateway: { state: "running" }, spaces: [space] });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) =>
      input.action === "admin" && input.operation === "status"
        ? {
            identities: [{ identity, deviceId: "test-device" }],
            groups: [
              { conversation: space.endpoints[0], lastSeenAt: Date.now() },
            ],
            spaces: [space],
            deliveries: [],
          }
        : original(input),
    );
    const user = userEvent.setup();
    const first = render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("群消息接入"));
    expect(
      await screen.findByRole("checkbox", {
        name: "Test bot · existing-group",
      }),
    ).toBeVisible();
    expect(f.manage).toHaveBeenCalledWith({
      action: "admin",
      operation: "status",
    });
    first.unmount();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("群消息接入"));
    await user.click(
      await screen.findByRole("button", { name: "打开已保存配置：Saved team" }),
    );
    expect(screen.getByLabelText("给这组群起个名字")).toHaveValue("Saved team");
    expect(
      screen.getByRole("button", { name: "复制群确认指令" }),
    ).toBeVisible();
    expect(screen.queryByText(/还没有已配对账号/)).not.toBeInTheDocument();
  });
  it("recognizes a configured Lark bot when pairing and uses the selected platform for all commands", async () => {
    const f = fixture();
    f.set({
      identities: [],
      connections: [
        {
          id: "lark-team",
          name: "Lark bot",
          channel: "feishu",
          state: "connected",
          configuration: { domain: "lark", transport: "websocket" },
        },
      ],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(
      await screen.findByRole("button", { name: /^绑定你的 IM 账号/ }),
    );
    expect(
      screen.getByRole("button", { name: "配对平台 Lark 国际版" }),
    ).toBeVisible();
    expect(
      screen.getByText(/在 Lark 国际版 中找到刚配置的机器人/),
    ).toBeVisible();
    expect(document.querySelector("#im-pair ol")).not.toHaveTextContent(
      "Slack",
    );
    await user.click(screen.getByRole("button", { name: "生成一次性配对码" }));
    expect(screen.getByText("/pair 0123456789abcdef")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^配对平台/ }));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    for (const label of ["企业微信", "飞书国内版", "Lark 国际版", "Slack"])
      expect(
        screen.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    await user.click(
      screen.getByRole("option", { name: "Slack", exact: true }),
    );
    expect(screen.getByText("pair 0123456789abcdef")).toBeVisible();
    expect(document.querySelector("#im-pair ol")).toHaveTextContent(
      "Slack 工作区",
    );
    await user.click(screen.getByText("试试第一条任务"));
    expect(document.querySelector("#im-test")).toHaveTextContent("projects");
    expect(document.querySelector("#im-test")).not.toHaveTextContent(
      "/projects",
    );
    await user.click(screen.getByRole("button", { name: /^配对平台/ }));
    await user.click(
      screen.getByRole("option", { name: "Lark 国际版", exact: true }),
    );
    expect(screen.getByText("/pair 0123456789abcdef")).toBeVisible();
    expect(document.querySelector("#im-test")).toHaveTextContent("/projects");
    for (const label of ["飞书国内版", "企业微信"]) {
      await user.click(screen.getByRole("button", { name: /^配对平台/ }));
      await user.click(
        screen.getByRole("option", { name: label, exact: true }),
      );
      expect(screen.getByText("/pair 0123456789abcdef")).toBeVisible();
      expect(document.querySelector("#im-pair ol")).toHaveTextContent(label);
      expect(document.querySelector("#im-pair ol")).not.toHaveTextContent(
        "Slack",
      );
    }
    expect(f.manage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin" }),
    );
  });
  it("shows the Lark region before credentials and switches the setup links and saved domain", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(await screen.findByRole("tab", { name: /飞书/ }));
    const region = screen.getByRole("button", { name: /^应用区域/ });
    expect(region.closest("details")).toBeNull();
    await user.click(region);
    await user.click(screen.getByRole("option", { name: /Lark 国际版/ }));
    expect(
      screen.getByRole("link", { name: "打开 Lark 开发者后台" }),
    ).toHaveAttribute("href", "https://open.larksuite.com/app");
    await user.type(screen.getByLabelText("App ID"), "cli_lark");
    await user.type(screen.getByLabelText("App Secret"), "synthetic-secret");
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    expect(f.manage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin",
        operation: "connections",
        configuration: expect.objectContaining({
          domain: "lark",
          id: expect.stringMatching(/^feishu-/),
          name: "Lark",
        }),
      }),
    );
  });
  it.each([
    {
      channel: "wecom",
      label: /企业微信.*无需公网地址/,
      secretLabel: "Bot Secret",
    },
    { channel: "feishu", label: /^飞书.*HTTPS/, secretLabel: "App Secret" },
    {
      channel: "slack",
      label: /^Slack.*Socket Mode/,
      secretLabel: "Bot User OAuth Token",
    },
  ] as const)(
    "removes a $channel bot without paired accounts, supports cancellation, and clears saved credentials",
    async ({ channel, label, secretLabel }) => {
      const f = fixture();
      const selected = {
        ...connection,
        id: `${channel}-team`,
        channel,
        state: "error" as const,
      };
      f.set({
        localGateway: { state: "running" },
        identities: [],
        connections: [selected],
      });
      const original = f.manage.getMockImplementation()!;
      f.manage.mockImplementation(async (input) => {
        if (
          input.action === "admin" &&
          input.operation === "remove-connection"
        ) {
          f.set({ connections: [] });
          return { removed: true };
        }
        return original(input);
      });
      const user = userEvent.setup();
      render(<ImSettingsPanel locale="zh-CN" />);
      await user.click(await screen.findByRole("button", { name: label }));
      await user.click(screen.getByRole("button", { name: "移除连接" }));
      await user.keyboard("{Escape}");
      expect(
        screen.queryByRole("button", { name: "确认移除" }),
      ).not.toBeInTheDocument();
      expect(f.manage).not.toHaveBeenCalledWith(
        expect.objectContaining({ operation: "remove-connection" }),
      );
      await user.click(screen.getByRole("button", { name: "移除连接" }));
      f.manage.mockRejectedValueOnce(new Error("Cannot remove"));
      await user.click(screen.getByRole("button", { name: "确认移除" }));
      expect(await screen.findByText("Cannot remove")).toBeVisible();
      expect(screen.getByRole("button", { name: "确认移除" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "确认移除" }));
      expect(f.manage).toHaveBeenCalledWith({
        action: "admin",
        operation: "remove-connection",
        configuration: { id: selected.id },
      });
      expect(await screen.findByText("尚未保存机器人连接")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "更换" }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText(secretLabel)).toBeVisible();
    },
  );
  it("removes only the selected connection and requires an administrator token on a team Gateway", async () => {
    const f = fixture();
    const second = { ...connection, id: "second-bot", name: "Second bot" };
    f.set({ connections: [connection, second] });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "admin" && input.operation === "remove-connection") {
        f.set({ connections: [connection] });
        return { removed: true };
      }
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(
      await screen.findByRole("button", { name: /^机器人连接/ }),
    );
    await user.click(screen.getByRole("option", { name: "Second bot" }));
    await user.click(screen.getByRole("button", { name: "移除连接" }));
    expect(screen.getByText(/确认移除“Second bot”/)).toBeVisible();
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    const token = "synthetic-administrator-credential";
    await user.type(screen.getByLabelText("移除连接的管理凭据"), token);
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    expect(f.manage).toHaveBeenCalledWith({
      action: "admin",
      operation: "remove-connection",
      adminToken: token,
      configuration: { id: second.id },
    });
    expect(
      await screen.findByText(connection.name, { selector: "code" }),
    ).toBeVisible();
    expect(screen.getByText(identity.userId)).toBeVisible();
    expect(
      screen.queryByLabelText("移除连接的管理凭据"),
    ).not.toBeInTheDocument();
  });
  it("connects a new Feishu bot from two credentials with generated metadata and actionable personal setup help", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("飞书"));
    expect(
      screen.getByText("高级设置（通常无需修改）").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByLabelText("Tenant Key（可留空，自动获取）"),
    ).not.toBeVisible();
    await user.click(screen.getByText("我是个人开发者，没有企业怎么办？"));
    expect(screen.getByText(/这里的“企业”指飞书团队/)).toBeVisible();
    await user.type(screen.getByLabelText("App ID"), "cli_example");
    await user.type(
      screen.getByLabelText("App Secret"),
      "synthetic-app-secret",
    );
    const save = screen.getByRole("button", { name: "保存并连接机器人" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(f.manage).toHaveBeenCalledWith({
      action: "admin",
      operation: "connections",
      configuration: {
        channel: "feishu",
        enabled: true,
        transport: "websocket",
        domain: "feishu",
        appId: "cli_example",
        appSecret: "synthetic-app-secret",
        id: expect.stringMatching(/^feishu-/),
        name: "飞书",
      },
    });
    expect(screen.queryByLabelText("App Secret")).not.toBeInTheDocument();
    expect(f.manage).toHaveBeenCalledWith({
      action: "pair",
      requireConfirmation: true,
    });
  });
  it("builds a group configuration from discovered groups and paired members without editing JSON", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    const conversation = {
      connectionId: connection.id,
      id: "group-123",
      kind: "group",
    };
    f.manage.mockImplementation(async (input) => {
      if (input.action === "admin" && input.operation === "status")
        return {
          identities: [{ identity, deviceId: "test-device" }],
          groups: [{ conversation, lastSeenAt: Date.now() }],
          spaces: [],
          deliveries: [],
        };
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("群消息接入"));
    const save = screen.getByRole("button", { name: "保存空间并等待各群确认" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("空间配置（JSON）")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新群和成员" }));
    await user.type(screen.getByLabelText("给这组群起个名字"), "我的讨论群");
    await user.click(
      screen.getByRole("checkbox", { name: "Test bot · group-123" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "test-user · 企业微信 · test-device",
      }),
    );
    expect(save).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: /^谁来确认群接入 · Test bot/ }),
    );
    await user.click(
      screen.getByRole("option", { name: "test-user", exact: true }),
    );
    expect(save).toBeEnabled();
    await user.click(save);
    const input = f.manage.mock.calls
      .map(([input]) => input)
      .find(
        (input) => input.action === "admin" && input.operation === "spaces",
      );
    expect(input).toMatchObject({
      action: "admin",
      operation: "spaces",
      configuration: {
        id: expect.stringMatching(/^space-/),
        name: "我的讨论群",
        endpoints: [conversation],
        participants: [
          { identity, deviceId: "test-device", name: "test-user" },
        ],
        administrators: [identity],
      },
    });
    expect(
      await screen.findByRole("button", { name: "复制群确认指令" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "去选择项目并授权" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("给这组群起个名字"), "2");
    expect(
      screen.queryByRole("button", { name: "复制群确认指令" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the compact header, channel status, credential action, and guide in management order", async () => {
    fixture();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    expect(
      document.querySelector('.im-header [data-artemis-component="switch"]'),
    ).toHaveAttribute("data-label-visibility", "hidden");
    expect(
      nav("企业微信").querySelector(".im-channel-status"),
    ).toHaveTextContent("已配置(1)");
    expect(document.querySelector(".im-block-header button")).toHaveAttribute(
      "data-variant",
      "quiet",
    );
    const guide = screen.getByRole("button", { name: "重看设置指引" });
    const bot = document.getElementById("im-bot")!;
    expect(
      bot.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("keeps connection counts separate from partial failure and offers the existing guide in General", async () => {
    const f = fixture();
    const failed = {
      ...connection,
      id: "failed-bot",
      name: "Offline bot",
      state: "error" as const,
    };
    f.set({
      connections: [connection, failed],
      state: "connected",
      settings: { ...f.get().settings, enabled: true },
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    expect(imConnectionHealth([connection, failed])).toEqual({
      total: 2,
      failed: 1,
      state: "error",
    });
    expect(document.querySelector(".im-status-pill")).toHaveTextContent(
      "2 个连接，1 个异常",
    );
    expect(nav("企业微信").querySelector(".im-dot")).toHaveAttribute(
      "data-state",
      "error",
    );
    await user.click(nav("设置指引"));
    expect(screen.getByRole("list", { name: "IM 设置步骤" })).toBeVisible();
    expect(f.get().identities).toEqual([identity]);
  });
  it("defaults a new Feishu bot to a long connection without callback secrets", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("飞书"));
    expect(screen.getByLabelText("接入方式")).toHaveTextContent("长连接");
    expect(
      screen.queryByLabelText("Verification Token"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Encrypt Key")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制回调地址" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("凭据加密保存在团队 Gateway。")).toBeVisible();
  });
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
      await screen.findByRole("button", { name: /^连接一个机器人/ }),
    );
    for (const [label, value] of [
      ["连接 ID", "wecom-team"],
      ["连接名称", "Test bot"],
      ["企业 ID（Corp ID）", "test-corp"],
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
    expect(
      screen.getByText("Test bot", { selector: ".im-connection code" })
        .parentElement,
    ).toBeVisible();
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
    expect(screen.getByText("长连接或 HTTPS 回调")).toBeVisible();
    expect(screen.getByRole("switch", { name: "启用 IM 连接" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^准备 Gateway/ }));
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
    expect(screen.getAllByRole("tab")).toHaveLength(8);
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
    expect(nav("设置指引")).toHaveFocus();
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
      await screen.findByRole("button", { name: /^绑定你的 IM 账号/ }),
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
  it("shows guided groups with advanced JSON collapsed, clears diagnostic credentials and rejects invalid JSON locally", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await screen.findByRole("heading", { name: "应用凭据" });
    await user.click(nav("群消息接入"));
    const summary = screen.getByText("高级：查看诊断或手动编辑配置");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    await user.type(screen.getByLabelText("协作空间管理凭据"), "a".repeat(32));
    await user.click(screen.getByRole("button", { name: "刷新群和成员" }));
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
  it("opens group setup directly from the first-time wizard", async () => {
    fixture(false);
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await user.click(await screen.findByRole("button", { name: /群消息接入/ }));
    expect(screen.getByRole("tab", { name: "群消息接入" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("创建与连接 IM 群协作空间")).toBeVisible();
  });
  it("keeps group messages directly accessible in compact navigation", async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ImNavigation
        view="slack"
        onSelect={select}
        connections={[connection]}
        compact
        t={t}
      />,
    );
    const groups = screen.getByRole("tab", { name: "群消息接入" });
    await user.click(groups);
    expect(select).toHaveBeenLastCalledWith("spaces");
    rerender(
      <ImNavigation
        view="spaces"
        onSelect={select}
        connections={[connection]}
        compact
        t={t}
      />,
    );
    expect(groups).toHaveAttribute("aria-selected", "true");
    expect(groups).toHaveAttribute("aria-controls", "im-panel-spaces");
    expect(document.querySelectorAll("#im-nav-spaces")).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: /通用/ }));
    expect(
      screen.queryByRole("menuitem", { name: "群消息接入" }),
    ).not.toBeInTheDocument();
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
    expect(select).toHaveBeenCalledWith("setup-guide");
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
