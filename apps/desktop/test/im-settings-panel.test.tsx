import { uiTranslator } from "../src/shared/ui-text.js";
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
import { imWriteVerify } from "../src/renderer/im-flow-derive.js";
import { imConnectionHealth } from "../src/renderer/ImNavigation.js";
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
const t = uiTranslator("zh-CN");
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
      userName: "test-user",
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
  localStorage.clear();
});
const nav = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(name) });

const platformLabels = {
  wecom: "企业微信",
  feishu: "飞书 / Lark",
  slack: "Slack",
} as const;
const cardHead = (title: RegExp | string) =>
  screen.getByRole("button", { name: title });
const openCard = async (
  user: ReturnType<typeof userEvent.setup>,
  title: RegExp | string,
) => {
  /* 卡片下钻：点击列表态的卡片行（详情态自带内容，无需展开）。 */
  const head = await screen.findByRole("button", { name: title });
  await user.click(head);
};
const platformCard = (channel: keyof typeof platformLabels) =>
  within(document.querySelector(".im-channel-list") as HTMLElement).getByRole(
    "button",
    { name: new RegExp(platformLabels[channel]) },
  );
/* 面板加载完成信号：左栏固定标题「连接服务」出现（不再折叠、非按钮）。 */
const panelReady = () => screen.findByText("连接服务");
/* 渠道行下钻：先等面板加载完（原 openCard 的 findByRole 等待语义）。 */
const openChannel = async (
  user: ReturnType<typeof userEvent.setup>,
  channel: keyof typeof platformLabels,
) => {
  await panelReady();
  await user.click(platformCard(channel));
};
/* 渠道详情弹窗的 × 关闭钮：可访问名「关闭」会与叠开的配对弹窗重名，
   直接按专用类定位。 */
const closeChannelDialog = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.click(
    document.querySelector(
      ".im-channel-dialog .im-detail-dialog-close",
    ) as HTMLButtonElement,
  );
};
const platformState = (channel: keyof typeof platformLabels) =>
  platformCard(channel).closest("[data-connection-state]") as HTMLElement;
/* 两栏版：群协作=IM 渠道第三卡，点击下钻群协作详情（带返回）。 */
const openGroupSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await panelReady();
  await user.click(screen.getByRole("button", { name: /^群聊项目授权/ }));
  expect(
    screen.getByRole("button", { name: "返回", exact: true }),
  ).toBeVisible();
};

describe("production IM settings", () => {
  it("shows and copies the pairing code after saving a Slack bot", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "slack");
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    await user.type(screen.getByLabelText("Bot User OAuth Token"), "xoxb-test");
    await user.type(screen.getByLabelText("App-Level Token"), "xapp-test");
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    const dialog = await screen.findByRole("dialog", {
      name: t("ImAccountControls.message1"),
    });
    expect(within(dialog).getByText("0123456789abcdef")).toBeVisible();
    expect(f.manage).toHaveBeenCalledWith({
      action: "pair",
      requireConfirmation: true,
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: t("ImAccountControls.message6"),
      }),
    );
    expect(writeText).toHaveBeenCalledWith("pair 0123456789abcdef");
  });

  it("copies a Slack manifest named after the current user", async () => {
    fixture(false);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "slack");
    await user.click(screen.getByText(t("ImSettingsPanel.message59")));
    await user.click(
      screen.getByRole("button", { name: "复制 Slack 应用配置" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const manifest = JSON.parse(writeText.mock.calls[0]![0]);
    expect(manifest.display_information.name).toBe("test-user_bot");
    expect(manifest.features.bot_user.display_name).toBe("test-user_bot");
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });

  it.each(["overview", "verify"])(
    "navigates from the completion action to %s",
    async (destination) => {
      const f = fixture();
      f.set({
        settings: {
          ...f.get().settings,
          grants: [
            {
              projectId: "test-project",
              tokenBudget: 100000,
              approval: "ask",
              mode: "plan",
              network: false,
              shell: false,
              groups: [],
              expiresAt: Date.now() + 60000,
              security: {
                version: 2,
                revision: "confirmed",
                confirmedAt: 1,
                scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
              },
            },
          ],
        },
      });
      const user = userEvent.setup();
      render(<ImSettingsPanel locale="zh-CN" />);
      await waitFor(() =>
        expect(document.querySelector(".im-overview")).toBeInTheDocument(),
      );
      await openCard(user, /^单聊项目授权/);
      await user.click(
        screen.getByRole("button", {
          name:
            destination === "overview"
              ? "查看连接概览"
              : "发测试消息验证（可选）",
        }),
      );
      if (destination === "overview") {
        expect(document.querySelector(".im-overview")).toHaveFocus();
      } else {
        /* 验证=渠道详情弹窗的一页：深链弹窗打开并切到验证页。 */
        expect(document.querySelector(".im-channel-dialog")).toBeVisible();
        expect(
          screen.getByRole("button", { name: /^顺手验证/ }),
        ).toHaveAttribute("data-selected", "true");
        expect(document.getElementById("im-verify")).toHaveFocus();
        expect(
          screen.getByRole("list", { name: "测试任务进度" }),
        ).toBeVisible();
      }
    },
  );
  it.each(["slack", "feishu"] as const)(
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
      expect(platformState(channel)).toHaveAttribute(
        "data-connection-state",
        "connected",
      );
      f.set({ connections: [{ ...connection, channel, state: "connecting" }] });
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(platformState(channel)).toHaveAttribute(
        "data-connection-state",
        "connecting",
      );
      f.manage.mockRejectedValueOnce(new Error("Gateway offline"));
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(platformState(channel)).toHaveAttribute(
        "data-connection-state",
        "error",
      );
      f.set({ connections: [{ ...connection, channel, state: "connected" }] });
      await act(() => window.dispatchEvent(new Event("focus")));
      expect(platformState(channel)).toHaveAttribute(
        "data-connection-state",
        "connected",
      );
    },
  );
  it("preserves credential edits across disconnect and reconnect", async () => {
    vi.useFakeTimers();
    const f = fixture();
    render(<ImSettingsPanel locale="zh-CN" />);
    await act(async () => {});
    fireEvent.click(platformCard("wecom"));
    fireEvent.click(screen.getByRole("button", { name: /^更换凭据/ }));
    fireEvent.change(screen.getByLabelText("Bot Secret"), {
      target: { value: "unsaved-secret" },
    });
    f.set({ connections: [{ ...connection, state: "error" }] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    f.set({ connections: [connection] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("unsaved-secret");
  });
  it("loads native groups on entry and preserves their entry across settings reopen", async () => {
    const f = fixture();
    const identity = { ...f.get().identities[0]!, channel: "slack" as const };
    const space = {
      id: "saved",
      name: "Saved team",
      confirmed: true,
      endpoints: [{ connectionId: connection.id, id: "room", kind: "group" }],
      participants: [{ deviceId: "test-device", identity, name: "Alice" }],
      administrators: [identity],
      nativeGroup: {
        version: 1,
        projectId: "test-project",
        enabled: true,
        capability: "manual",
        enabledAt: 1,
        ownerDeviceId: "test-device",
      },
    };
    f.set({ localGateway: { state: "running" }, spaces: [space] });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) =>
      input.action === "admin" && input.operation === "status"
        ? {
            identities: [{ identity, deviceId: "test-device" }],
            groups: [
              {
                conversation: space.endpoints[0],
                identities: [identity],
                lastSeenAt: Date.now(),
              },
            ],
            spaces: [space],
            deliveries: [],
          }
        : input.action === "scope-entries"
          ? []
          : original(input),
    );
    const user = userEvent.setup();
    const first = render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openGroupSetup(user);
    await user.click(screen.getByRole("button", { name: /已发现的群/ }));
    await user.click(screen.getByRole("option", { name: /Saved team/ }));
    expect(await screen.findByText("Saved team")).toBeVisible();
    expect(screen.getByRole("button", { name: "打开群对话" })).toBeVisible();
    expect(f.manage).toHaveBeenCalledWith({
      action: "admin",
      operation: "status",
    });
    first.unmount();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openGroupSetup(user);
    await user.click(screen.getByRole("button", { name: /已发现的群/ }));
    await user.click(screen.getByRole("option", { name: /Saved team/ }));
    expect(await screen.findByText("Saved team")).toBeVisible();
    expect(screen.queryByLabelText("空间配置（JSON）")).not.toBeInTheDocument();
  });
  it("derives the pairing platform from the active channel tab and offers no selector", async () => {
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
    /* 平台选择器已移除，配对平台随渠道行派生；配对说明随配对码框（生成后）展示。 */
    expect(
      screen.queryByRole("button", { name: /^配对平台/ }),
    ).not.toBeInTheDocument();
    await openChannel(user, "feishu");
    await user.click(
      await screen.findByRole("button", { name: "生成配对码 Lark bot" }),
    );
    expect(screen.getByText("0123456789abcdef")).toBeVisible();
    expect(
      screen.getByText(/在 Lark 国际版 中找到刚配置的机器人/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
    expect(document.querySelector("#im-test")).toHaveTextContent("/projects");
    /* 关闭弹窗切到 Slack：配对与验证指令整体切到 Slack 形态（无斜杠）。 */
    await closeChannelDialog(user);
    await openChannel(user, "slack");
    expect(
      screen.getByText(/在安装应用的 Slack 工作区中打开该应用的私信/),
    ).toBeVisible();
    expect(screen.getByText("0123456789abcdef")).toBeVisible();
    /* 验证是主从布局的一页：切页后断言指令形态。 */
    await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
    expect(document.querySelector("#im-test")).toHaveTextContent("projects");
    expect(document.querySelector("#im-test")).not.toHaveTextContent(
      "/projects",
    );
    expect(f.manage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin" }),
    );
  });
  it.each(["wecom", "feishu", "slack"] as const)(
    "removes a $channel bot without paired accounts, supports cancellation, and clears saved credentials",
    async (channel) => {
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
      /* 渠道详情从列表行下钻。移除走行尾图标按钮 + 弹窗确认；取消路径
         用弹窗内「取消」按钮（jsdom 不派发原生 dialog 的 Esc cancel 事件）。 */
      await openChannel(user, channel);
      await screen.findByRole("button", { name: /^移除连接/ });
      await user.click(screen.getByRole("button", { name: /^移除连接/ }));
      await user.click(screen.getByRole("button", { name: "取消" }));
      expect(
        screen.queryByRole("button", { name: "确认移除" }),
      ).not.toBeInTheDocument();
      expect(f.manage).not.toHaveBeenCalledWith(
        expect.objectContaining({ operation: "remove-connection" }),
      );
      await user.click(screen.getByRole("button", { name: /^移除连接/ }));
      f.manage.mockRejectedValueOnce(new Error("Cannot remove"));
      await user.click(screen.getByRole("button", { name: "确认移除" }));
      expect(
        await within(
          document.querySelector(".im-removal-dialog") as HTMLElement,
        ).findByRole("alert"),
      ).toHaveTextContent("Cannot remove");
      expect(screen.getByRole("button", { name: "确认移除" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "确认移除" }));
      expect(f.manage).toHaveBeenCalledWith({
        action: "admin",
        operation: "remove-connection",
        configuration: { id: selected.id },
      });
      expect(await screen.findByText("尚未保存机器人连接")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /^更换凭据/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "新建 BOT 连接" }),
      ).toBeVisible();
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
    await openChannel(user, "wecom");
    /* 主从布局：先选中 Second bot 卡片，右栏详情才出现它的移除入口。 */
    await user.click(await screen.findByRole("button", { name: /^Second bot/ }));
    await user.click(
      await screen.findByRole("button", { name: "移除连接 Second bot" }),
    );
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
      await screen.findByText(connection.name, {
        selector: ".im-bot-card-copy strong",
      }),
    ).toBeVisible();
    expect(screen.getByText(identity.userId)).toBeVisible();
    expect(
      screen.queryByLabelText("移除连接的管理凭据"),
    ).not.toBeInTheDocument();
  });
  it("creates a Feishu bot from the scan-first create pane and lands on its profile", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openChannel(user, "feishu");
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "feishu-scan-begin")
        return {
          deviceCode: "dev1",
          qrUrl: "https://accounts.feishu.cn/confirm?c=1",
          userCode: "ABCD",
          expiresAt: Date.now() + 600_000,
          intervalMs: 0,
          domain: "feishu",
        };
      if (input.action === "feishu-scan-poll")
        return {
          status: "success",
          appId: "cli_example",
          appSecret: "synthetic-secret",
          appName: "My bot",
          domain: "feishu",
        };
      if (input.action === "feishu-scan-connect") {
        f.set({
          connections: [
            { ...connection, channel: "feishu", id: "feishu-scan-1", name: "My bot" },
          ],
        });
        return { connectionId: "feishu-scan-1" };
      }
      return original(input);
    });
    /* 飞书创建页=扫码优先：右栏直接出码，不再展示凭据表单。 */
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    expect(screen.queryByLabelText("App ID")).not.toBeInTheDocument();
    expect(
      screen.getByText("机器人回复模式", {
        selector: ".im-bot-section-copy strong",
      }),
    ).toBeVisible();
    /* 回复模式值展示：固定流式卡片。 */
    expect(screen.getByText("流式卡片")).toBeVisible();
    /* 扫码建连：凭据经 scan-connect 落库，接续配对码并选中新机器人。 */
    await waitFor(() =>
      expect(f.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "feishu-scan-connect",
          appId: "cli_example",
          appSecret: "synthetic-secret",
          domain: "feishu",
        }),
      ),
    );
    expect(f.manage).toHaveBeenCalledWith({ action: "pair", requireConfirmation: true });
    expect(
      await screen.findByText("My bot", {
        selector: ".im-bot-profile-head strong",
      }),
    ).toBeVisible();
    expect(document.querySelector(".im-bot-create")).toBeNull();
    /* 指引页折叠块仍在（与创建页互斥，切换后可见）。 */
    await user.click(screen.getByRole("button", { name: /^接入指引/ }));
    await user.click(screen.getByText("我是个人开发者，没有企业怎么办？"));
    expect(screen.getByText(/这里的“企业”指飞书团队/)).toBeVisible();
  });
  it("hides the create scan card on cancel and reopens it with a fresh code", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "feishu-scan-begin")
        return {
          deviceCode: "dev1",
          qrUrl: "https://accounts.feishu.cn/confirm?c=1",
          userCode: "ABCD",
          expiresAt: Date.now() + 600_000,
          intervalMs: 60_000,
          domain: "feishu",
        };
      if (input.action === "feishu-scan-poll")
        return { status: "pending", intervalMs: 60_000, domain: "feishu" };
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    expect(await screen.findByText("等待飞书扫码…")).toBeVisible();
    /* 取消=隐藏二维码卡体，仅剩关联机器人卡头。 */
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(document.querySelector(".im-bot-scan")).toBeNull();
    /* 卡头「扫码」钮重新展开并出码。 */
    await user.click(screen.getByRole("button", { name: "扫码" }));
    expect(await screen.findByText("等待飞书扫码…")).toBeVisible();
    expect(document.querySelector(".im-bot-scan")).toBeVisible();
  });
  it("refreshes the create QR in place instead of remounting the scan card", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "feishu-scan-begin")
        return {
          deviceCode: `dev-${f.manage.mock.calls.length}`,
          qrUrl: "https://accounts.feishu.cn/confirm?c=1",
          userCode: "ABCD",
          expiresAt: Date.now() + 600_000,
          intervalMs: 60_000,
          domain: "feishu",
        };
      if (input.action === "feishu-scan-poll")
        return { status: "pending", intervalMs: 60_000, domain: "feishu" };
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    expect(await screen.findByText("等待飞书扫码…")).toBeVisible();
    const begins = () =>
      f.manage.mock.calls.filter(([a]) => a.action === "feishu-scan-begin")
        .length;
    const before = begins();
    await user.click(screen.getByRole("button", { name: "扫码" }));
    await waitFor(() => expect(begins()).toBeGreaterThan(before));
    /* 局部刷新：扫码卡体保持挂载，仅二维码/用户码换新。 */
    expect(document.querySelector(".im-bot-scan")).toBeVisible();
    expect(screen.getByText("等待飞书扫码…")).toBeVisible();
    expect(document.querySelector(".im-scan-qr")).toBeVisible();
  });
  it("shows a friendly error without a retry button when the scanned app is already owned", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "feishu-scan-begin")
        return {
          deviceCode: "dev1",
          qrUrl: "https://accounts.feishu.cn/confirm?c=1",
          userCode: "ABCD",
          expiresAt: Date.now() + 600_000,
          intervalMs: 0,
          domain: "feishu",
        };
      if (input.action === "feishu-scan-poll")
        return {
          status: "error",
          message: "Error invoking remote method 'artemis:im-manage': Error: This bot is already owned by another connection.",
        };
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    /* 扫码失败文案友好化：不带 IPC 包装与英文原文。 */
    expect(
      await screen.findByText(/该应用已被其他机器人连接占用/),
    ).toBeVisible();
    expect(screen.queryByText(/already owned/i)).not.toBeInTheDocument();
    /* bare 失败态无重试钮：卡头「扫码」钮承担重开。 */
    expect(
      screen.queryByRole("button", { name: "扫码并创建应用" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the Feishu scan entry on the linked-bot card while the bot is offline", async () => {
    const f = fixture();
    f.set({
      localGateway: { state: "running" },
      connections: [
        { ...connection, channel: "feishu", name: "飞书", state: "error" },
      ],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    /* 关联机器人卡（ZCode 式）：离线时保留扫码入口，手动编辑器退役。 */
    expect(screen.getByText("关联机器人")).toBeVisible();
    expect(screen.getByText("扫码获取应用凭据。")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "更换凭据 飞书" }),
    ).not.toBeInTheDocument();
    f.manage.mockImplementationOnce(async (input) =>
      input.action === "feishu-scan-begin"
        ? {
            deviceCode: "dev1",
            qrUrl: "https://accounts.feishu.cn/confirm?c=1",
            userCode: "ABCD",
            expiresAt: Date.now() + 600_000,
            intervalMs: 5000,
            domain: "feishu",
          }
        : structuredClone(f.get()),
    );
    await user.click(screen.getByRole("button", { name: "扫码" }));
    expect(f.manage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feishu-scan-begin" }),
    );
    expect(await screen.findByText("等待飞书扫码…")).toBeVisible();
    expect(document.querySelector(".im-scan-qr")).toBeVisible();
    /* 再点收起：扫码区随开合移除，可随时重开。 */
    await user.click(screen.getByRole("button", { name: "扫码" }));
    expect(document.querySelector(".im-bot-scan")).toBeNull();
  });
  it("flags a connected bot as awaiting pairing across nav, status line and linked-bot card", async () => {
    const f = fixture();
    f.set({
      localGateway: { state: "running" },
      identities: [],
      connections: [{ ...connection, channel: "feishu", name: "飞书" }],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    /* 已连接未配对：状态行=警告灯+待配对。 */
    const stateLine = document.querySelector(".im-bot-profile-state")!;
    expect(stateLine).toHaveTextContent("待配对");
    expect(stateLine.querySelector(".im-dot")).toHaveAttribute(
      "data-state",
      "warning",
    );
    /* 导航卡与关联机器人卡的信号灯同节奏。 */
    const navCard = document.querySelector(".im-bot-card")!;
    expect(navCard).toHaveTextContent("待配对");
    expect(navCard.querySelector(".im-dot")).toHaveAttribute(
      "data-state",
      "warning",
    );
    expect(document.querySelector(".im-bot-link-state")).toHaveTextContent(
      "待配对",
    );
    /* 未配对没有「解除配对」可点，绑定入口在配对聊天卡。 */
    expect(
      screen.queryByRole("button", { name: "解除配对 飞书" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成配对码 飞书" })).toBeVisible();
  });
  it("marks a paired bot everywhere and unpairs through the linked-bot card", async () => {
    const f = fixture();
    f.set({
      localGateway: { state: "running" },
      connections: [{ ...connection, channel: "feishu", name: "飞书" }],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    /* 已配对：状态行=绿灯+已配对；导航卡与关联机器人卡同节奏。 */
    const stateLine = document.querySelector(".im-bot-profile-state")!;
    expect(stateLine).toHaveTextContent("已配对");
    expect(stateLine.querySelector(".im-dot")).toHaveAttribute(
      "data-state",
      "connected",
    );
    const navCard = document.querySelector(".im-bot-card")!;
    expect(navCard).toHaveTextContent("已配对");
    expect(document.querySelector(".im-bot-link-state")).toHaveTextContent(
      "已配对",
    );
    /* 解除配对：解绑这条连接的绑定账号，连接保留。 */
    await user.click(await screen.findByRole("button", { name: "解除配对 飞书" }));
    expect(f.manage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unpair",
        identity: expect.objectContaining({ connectionId: "wecom-team" }),
      }),
    );
    expect(await screen.findByText("账号已解除绑定。")).toBeVisible();
    /* 解绑后随刷新回到待配对。 */
    expect(
      await screen.findByText("待配对", { selector: ".im-bot-profile-state" }),
    ).toBeVisible();
  });
  it("shows the reply-mode card above the delete card in the bot detail", async () => {
    const f = fixture();
    f.set({
      localGateway: { state: "running" },
      connections: [{ ...connection, channel: "feishu", name: "飞书" }],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "feishu");
    await screen.findByText("关联机器人");
    /* 卡序：关联机器人 → 配对聊天 → 机器人回复模式 → 删除机器人。 */
    const titles = [
      ...document.querySelectorAll(".im-bot-section-copy strong"),
    ].map((node) => node.textContent);
    expect(titles).toEqual([
      "关联机器人",
      "配对聊天",
      "机器人回复模式",
      "删除机器人",
    ]);
    expect(document.querySelector(".im-reply-mode-select")).toBeVisible();
  });
  it("opens team gateway registration and advanced deployment as dialogs", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    /* 使用团队 Gateway（手动注册）：入口卡下钻弹窗，× 关闭。 */
    await user.click(
      screen.getByRole("button", { name: "使用团队 Gateway（手动注册）" }),
    );
    expect(document.querySelector(".im-remote-dialog")).toBeVisible();
    expect(await screen.findByLabelText("Gateway 地址")).toBeVisible();
    await user.click(
      document.querySelector(
        ".im-remote-dialog .im-detail-dialog-close",
      ) as HTMLButtonElement,
    );
    expect(document.querySelector(".im-remote-dialog")).toBeNull();
    /* 高级：说明+导出/命令；弹窗内「使用团队 Gateway」替换为注册弹窗。 */
    await user.click(
      screen.getByRole("button", { name: /高级：使用团队服务或独立部署/ }),
    );
    expect(document.querySelector(".im-advanced-dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "使用团队 Gateway" }));
    expect(document.querySelector(".im-advanced-dialog")).toBeNull();
    expect(document.querySelector(".im-remote-dialog")).toBeVisible();
  });
  it("replaces the right detail card with the create form instead of a dialog", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "wecom");
    /* ZCode 式：创建表单占据右栏整卡，不再弹独立弹窗；取消回到详情。 */
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    expect(
      document.querySelector(".im-channel-dialog .im-bot-create"),
    ).toBeVisible();
    expect(document.querySelector(".im-bot-dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(document.querySelector(".im-bot-create")).toBeNull();
    expect(document.querySelector(".im-bot-profile")).toBeVisible();
  });
  it("separates saved credentials from an established connection in the lifecycle", async () => {
    const f = fixture();
    f.set({ localGateway: { state: "running" } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    /* 两栏：初始态在列表行断言（未配置不亮灯）；操作进详情。
       （Slack 走凭据表单创建；飞书新建为扫码流，另测。） */
    expect(platformState("slack")).toHaveAttribute(
      "data-connection-state",
      "unconfigured",
    );
    await openChannel(user, "slack");
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    await user.type(
      screen.getByLabelText("Bot User OAuth Token"),
      "xoxb-example",
    );
    await user.type(
      screen.getByLabelText("App-Level Token"),
      "xapp-example",
    );
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    // 保存成功但连接尚未建立：关闭详情弹窗，行提亮（已配置），状态仍为未配置。
    await closeChannelDialog(user);
    await waitFor(() =>
      expect(platformCard("slack")).toHaveAttribute("data-configured"),
    );
    f.set({
      connections: [{ ...connection, channel: "slack", state: "connecting" }],
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(platformState("slack")).toHaveAttribute(
        "data-connection-state",
        "connecting",
      ),
    );
    f.set({
      connections: [{ ...connection, channel: "slack", state: "connected" }],
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(platformState("slack")).toHaveAttribute(
        "data-connection-state",
        "connected",
      );
      expect(platformState("slack").querySelector(".im-dot")).toHaveAttribute(
        "data-state",
        "connected",
      );
    });
  });
  it("updates discovered names after background lookup without resetting the selected group", async () => {
    const f = fixture();
    const identity = { ...f.get().identities[0]!, channel: "slack" as const };
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    let name: string | undefined;
    f.manage.mockImplementation(async (input) =>
      input.action === "admin" && input.operation === "status"
        ? {
            identities: [{ identity, deviceId: "test-device" }],
            groups: [
              {
                conversation: {
                  connectionId: connection.id,
                  id: "room",
                  kind: "group",
                },
                platform: "slack",
                identities: [identity],
                lastSeenAt: Date.now(),
                ...(name ? { name } : {}),
              },
            ],
            spaces: [],
            deliveries: [],
          }
        : original(input),
    );
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openGroupSetup(user);
    await user.click(screen.getByRole("button", { name: /已发现的群/ }));
    await user.click(screen.getByRole("option", { name: "Slack · room" }));
    name = "后台取得的群名";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /已发现的群/ }),
      ).toHaveTextContent("后台取得的群名 · Slack"),
    );
    expect(
      screen.queryByRole("button", { name: "确认并启用群聊" }),
    ).not.toBeInTheDocument();
  });
  it("requires observed identity, project and explicit consent for native group authorization", async () => {
    const f = fixture();
    const identity = { ...f.get().identities[0]!, channel: "slack" as const };
    f.set({ localGateway: { state: "running" } });
    const original = f.manage.getMockImplementation()!;
    const conversation = {
      connectionId: connection.id,
      id: "group-123",
      kind: "group",
    };
    f.manage.mockImplementation(async (input) =>
      input.action === "admin" && input.operation === "status"
        ? {
            identities: [{ identity, deviceId: "test-device" }],
            groups: [
              {
                conversation,
                name: "研发群",
                identities: [identity],
                lastSeenAt: Date.now(),
              },
            ],
            spaces: [],
            deliveries: [],
          }
        : input.action === "scope-entries"
          ? [{ path: "README.md", directory: false, protected: false }]
          : original(input),
    );
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openGroupSetup(user);
    expect(
      screen.queryByRole("button", { name: "确认并启用群聊" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /已发现的群/ }));
    await user.click(screen.getByRole("option", { name: "研发群 · Slack" }));
    expect(
      screen.queryByRole("group", { name: "数据与分享范围" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本地项目/ }),
    ).not.toBeInTheDocument();
    /* 单聊项目授权已移至右栏第四卡：返回列表后下钻。 */
    await user.click(screen.getByRole("button", { name: "返回", exact: true }));
    await user.click(screen.getByRole("button", { name: /^单聊项目授权/ }));
    expect(screen.getAllByRole("button", { name: "授权配置" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    const dialog = screen.getByRole("dialog", {
      name: "Test project · 授权设置",
    });
    await user.click(within(dialog).getByRole("button", { name: /分享给谁/ }));
    await user.click(screen.getByRole("option", { name: "研发群 · Slack" }));
    expect(
      within(dialog).getAllByRole("group", { name: "数据与分享范围" }),
    ).toHaveLength(1);
    const save = within(dialog).getByRole("button", { name: "确认并启用群聊" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /我确认当前会话/ }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(f.manage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "authorize-native-group",
        conversation,
        owner: identity,
        allowedSenders: [],
        confirmed: true,
        name: "研发群",
        grant: expect.objectContaining({
          security: expect.objectContaining({
            scopes: [
              expect.objectContaining({
                readPaths: [],
                writePaths: [],
              }),
            ],
          }),
        }),
      }),
    );
    expect(
      f.manage.mock.calls.some(
        ([a]) => a.action === "admin" && a.operation === "spaces",
      ),
    ).toBe(false);
  });
  it("shows the service state capsule beside the service title", async () => {
    const f = fixture();
    f.set({
      settings: { ...f.get().settings, deviceId: "test-device" },
      connections: [{ ...connection }],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    const capsule = () => document.querySelector(".im-service-capsule");
    expect(capsule()).toHaveTextContent("已断开");
    /* 连接后胶囊翻转为已就绪（断开按钮态）。 */
    await user.click(screen.getByRole("switch", { name: "启用 IM 连接" }));
    expect(capsule()).toHaveTextContent("已就绪");
  });
  it("keeps the compact header, step summaries and the credential action in flow order", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    /* 总开关=连接服务标题栏内的启动/停止双态圆钮。 */
    expect(
      document.querySelector(".im-service-head .im-power-toggle"),
    ).toHaveAttribute("role", "switch");
    /* 两栏：wecom 存量连接在渠道列表可见（未配置渠道不出现）。 */
    expect(platformCard("wecom")).toBeVisible();
    await openChannel(user, "wecom");
    const change = screen.getByRole("button", { name: /^更换凭据/ });
    const bot = document.getElementById("im-bot")!;
    expect(
      bot.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("keeps connection counts separate from partial failure in the step summaries", async () => {
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
    await panelReady();
    expect(imConnectionHealth([connection, failed])).toEqual({
      total: 2,
      failed: 1,
      state: "partial_error",
    });
    /* 两栏：部分失败明细由渠道行信号灯表达（partial_error）。 */
    expect(platformState("wecom")).toHaveAttribute(
      "data-connection-state",
      "partial_error",
    );
    expect(f.get().identities).toEqual([identity]);
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
    // 渠道配置=点卡进入的二级弹窗，新建入口直达（Slack 字段断言）。
    await openChannel(user, "slack");
    await screen.findByRole("button", { name: "新建 BOT 连接" });
    expect(document.querySelector(".im-channel-dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建 BOT 连接" }));
    await screen.findByLabelText("Bot User OAuth Token");
    for (const [label, value] of [
      ["Bot User OAuth Token", "xoxb-synthetic-token"],
      ["App-Level Token", "xapp-synthetic-token"],
      ["机器人配置的管理凭据", "a".repeat(32)],
    ])
      await user.type(screen.getByLabelText(label!), value!);
    await user.click(screen.getByRole("button", { name: "保存并连接机器人" }));
    expect(
      await screen.findByText(/凭据已保存，但连接状态刷新失败/),
    ).toBeVisible();
    expect(screen.getByText("凭据已保存，请刷新确认连接状态。")).toBeVisible();
    /* 总开关在概览服务卡上：关闭详情弹窗后断言无连接不可启用。 */
    await closeChannelDialog(user);
    expect(screen.getByRole("switch", { name: "启用 IM 连接" })).toBeDisabled();
    expect(
      screen.queryByLabelText("Bot User OAuth Token"),
    ).not.toBeInTheDocument();
  });
  it("does not overwrite a completed action with an older in-flight refresh", async () => {
    const f = fixture();
    f.set({ settings: { ...f.get().settings, enabled: true } });
    vi.useFakeTimers();
    await act(async () => {
      render(<ImSettingsPanel locale="zh-CN" />);
    });
    expect(screen.getByText("连接服务")).toBeVisible();
    /* 暂停动作留在概览完成；旧刷新在后台悬着，不得回写任何状态。 */
    fireEvent.click(screen.getByRole("switch", { name: "启用 IM 连接" }));
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
    /* 进入整幅渠道卡：总开关不在屏上，旧刷新也不得把暂停态顶掉。 */
    fireEvent.click(platformCard("wecom"));
    await act(async () => finishRefresh(old));
    expect(
      screen.getByText("Test bot", { selector: ".im-bot-card-copy strong" }),
    ).toBeVisible();
    /* 整幅渠道卡打开时总开关不在屏上，用落库状态断言暂停未被回写。 */
    expect(f.get().settings.enabled).toBe(false);
  });
  it("shows the three-step guided flow with progress, then starts and registers once", async () => {
    const f = fixture(false);
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    expect(await screen.findByText("IM渠道设置")).toBeVisible();
    /* 左栏=固定标题连接服务；右栏=四张卡（渠道/群协作/单聊项目授权）。 */
    expect(screen.getByText("连接服务")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^单聊项目授权/ }),
    ).toBeInTheDocument();
    // D1：未注册设备的首次流程不出现总开关。
    expect(screen.queryByRole("switch", { name: "启用 IM 连接" })).toBeNull();
    // 渠道列表常显（品牌图标+名称+信号灯）；①一键启动后进入渠道编辑。
    expect(platformCard("feishu")).toBeVisible();
    expect(screen.queryByText("长连接或 HTTPS 回调")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "一键启动并注册" }));
    await waitFor(() =>
      expect(f.manage).toHaveBeenCalledWith({ action: "setup-local" }),
    );
    /* 一键启动后自动切到②的渠道编辑主体（#im-bot）。 */
    await waitFor(() =>
      expect(document.getElementById("im-bot")).toBeVisible(),
    );
    expect(f.get().settings.enabled).toBe(false);
    expect(f.get().settings.grants).toEqual([]);
    expect(
      screen.queryByLabelText("机器人配置的管理凭据"),
    ).not.toBeInTheDocument();
  });
  it("opens the overview directly from completed data without rerunning the flow", async () => {
    const f = fixture();
    imWriteVerify("test-device", { confirmed: true, channel: "wecom" });
    f.set({
      settings: {
        ...f.get().settings,
        grants: [
          {
            projectId: "test-project",
            tokenBudget: 100000,
            approval: "ask",
            mode: "plan",
            network: false,
            shell: false,
            groups: [],
            expiresAt: Date.now() + 60000,
            security: {
              version: 2,
              revision: "confirmed",
              confirmedAt: 1,
              scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    // 完成态直接进入概览：左栏两卡全绿、总开关新家（D1）、不重跑流程。
    expect(
      await screen.findByText(/2 个项目 · 所有渠道通用/),
    ).toBeVisible();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    // 概览分区可展开编辑，配置不被清除；授权设置在行右侧按钮的聚焦弹窗里。
    await openCard(user, /^单聊项目授权/);
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    expect(
      screen.getByText("默认范围：可读整个项目，不可写任何文件。"),
    ).toBeVisible();
    // 临时会话计入④摘要（列表态已断言）；默认项目以临时会话行的徽章呈现。
    expect(
      document.querySelector(".im-project-builtin .im-default-badge"),
    ).toBeVisible();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.get().identities).toEqual([identity]);
  });
  it("keeps the service block always expanded and drills cards with the keyboard", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    /* 左栏连接服务=固定标题+常驻内容：无折叠按钮，主体直接可见。 */
    expect(
      screen.queryByRole("button", { name: /^连接服务/ }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("im-prepare")).toBeVisible();
    /* 卡片行可键盘下钻。 */
    const projects = screen.getByRole("button", { name: /^单聊项目授权/ });
    projects.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: "返回", exact: true }),
    ).toBeVisible();
    expect(document.getElementById("im-permissions")).toBeVisible();
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
    await openChannel(user, "wecom");
    await user.click(await screen.findByRole("button", { name: /^更换凭据/ }));
    expect(screen.getByLabelText("连接 ID")).toHaveValue("wecom-team");
    expect(screen.getByLabelText("Bot ID")).toHaveValue("test-bot");
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("");
    await user.type(screen.getByLabelText("Bot Secret"), "synthetic-secret");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: /^更换凭据/ }));
    expect(screen.getByLabelText("Bot Secret")).toHaveValue("");
    expect(f.manage).not.toHaveBeenCalled();
  });
  it("clears administrator credentials on a failed save and does not generate a pairing code", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "wecom");
    await user.click(await screen.findByRole("button", { name: /^更换凭据/ }));
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
    await openChannel(user, "wecom");
    await user.click(await screen.findByRole("button", { name: /^更换凭据/ }));
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
    expect(screen.getByRole("button", { name: /^更换凭据/ })).toBeVisible();
  });
  it("saves a project grant immediately from the row and keeps it when pausing from the header", async () => {
    const f = fixture();
    f.set({ settings: { ...f.get().settings, enabled: true } });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    // 勾选即时生效：已启用的服务一次保存授权；首个项目自动成为默认并带徽章。
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        defaultProjectId: "test-project",
        grants: [expect.objectContaining({ mode: "plan", approval: "ask" })],
      }),
    );
    expect(f.get().settings).toMatchObject({
      enabled: true,
      grants: [{ mode: "plan" }],
    });
    expect(f.get().settings.grants[0]!.security!.confirmedAt).toBe(0);
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    expect(
      screen.getByRole("checkbox", { name: /我确认当前会话/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭", exact: true }));
    await waitFor(() =>
      expect(
        document.querySelector(
          ".im-project:not(.im-project-builtin) .im-default-badge",
        ),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector(".im-project-builtin .im-default-badge"),
    ).toBeNull();
    // 顶部暂停保留已保存的授权草稿不再丢失。
    await user.click(screen.getByRole("switch", { name: "启用 IM 连接" }));
    expect(f.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: false,
        grants: [expect.objectContaining({ mode: "plan" })],
      }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Test project.Plan" }),
    ).toBeChecked();
  });
  it("does not enable when the immediate row save fails", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    f.save.mockRejectedValueOnce(new Error("Grant rejected"));
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    expect(await screen.findByText("Grant rejected")).toBeVisible();
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0]![0]).toMatchObject({ enabled: false });
    expect(f.get().settings.enabled).toBe(false);
  });
  it("reports saved-but-not-enabled and retries only the enable phase", async () => {
    const f = fixture();
    const original = f.save.getMockImplementation()!;
    f.save.mockImplementation(async (settings: ImSettings) => {
      if (settings.enabled) throw new Error("Gateway enable rejected");
      return original(settings);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    // 勾选即时保存：保存成功但启用失败 → 提示与重试入口出现在④卡。
    expect(await screen.findByText(/授权已保存，连接未启用/)).toBeVisible();
    expect(f.get().settings).toMatchObject({
      enabled: false,
      grants: [{ mode: "plan" }],
    });
    const savedGrants = f.get().settings.grants;
    f.save.mockImplementation(original);
    await user.click(screen.getByRole("button", { name: "重试启用" }));
    expect(f.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(f.save.mock.lastCall[0].grants).toEqual(savedGrants);
    expect(f.get().settings.enabled).toBe(true);
    expect(f.get().settings.grants).toHaveLength(1);
    expect(screen.queryByText(/授权已保存，连接未启用/)).toBeNull();
  });
  it("shows the built-in ad-hoc conversations row outside project grants", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    const builtin = screen.getByRole("checkbox", {
      name: "临时会话（内置，始终可用）",
    }) as HTMLInputElement;
    expect(builtin).toBeChecked();
    expect(builtin).toBeDisabled();
    /* 说明与提示统一子区（边框包裹、默认收起）：展开后可见临时会话说明。 */
    await user.click(screen.getByText("说明与提示"));
    expect(screen.getByText(/不绑定项目的会话/)).toBeVisible();
    expect(f.get().settings.grants).toEqual([]);
  });
  it("supports explicitly confirmed whole-project writes including future files", async () => {
    const f = fixture();
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) => {
      if (input.action === "scope-entries")
        return [
          { path: "src", directory: true, protected: false },
          { path: "docs", directory: true, protected: false },
        ];
      return original(input);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    // 授权设置收进行右侧按钮的聚焦弹窗。
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    // 未确认的 Plan 授权直接展示范围确认入口。
    expect(
      screen.getByText("默认范围：可读整个项目，不可写任何文件。"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "选择目录或文件" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "自定义范围 ▸" }));
    expect(
      screen.getByRole("button", { name: "选择目录或文件" }),
    ).toBeVisible();
    // Execute：范围树强制展开；未选可写范围时「确认设置」禁用并提示。
    await user.click(screen.getByRole("radio", { name: /Execute/ }));

    const confirm = screen.getByRole("button", { name: "确认设置" });
    expect(confirm).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "选择目录或文件" }));
    await user.click(screen.getByRole("button", { name: "整个项目可修改" }));
    expect(confirm).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "允许沙箱命令" }));
    await user.click(confirm);
    // 勾选已即时保存过一次（plan）；确认再走两阶段（execute+启用）。
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
    expect(f.get().settings.grants[0]).toMatchObject({
      mode: "execute",
      shell: true,
      network: false,
    });
    expect(f.get().settings.grants[0]!.security!.scopes[0]!.writeMode).toBe(
      "project",
    );
    // 确认后弹窗关闭；④详情仍在（卡片无需重新下钻），行内摘要更新。
    await waitFor(() =>
      expect(document.querySelector(".im-row-summary")?.textContent).toContain(
        "整个项目可修改",
      ),
    );
    // 切回 Plan：命令与网络同步关闭，控件收起。
    await user.click(await screen.findByRole("button", { name: "授权配置" }));
    await user.click(screen.getByRole("radio", { name: /Plan · 只读分析/ }));
    expect(screen.queryByRole("checkbox", { name: "允许沙箱命令" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "确认设置" }));
    // 已启用的服务确认即单阶段保存（总计 4 次）。
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(4));
    expect(f.get().settings.grants[0]).toMatchObject({
      mode: "plan",
      shell: false,
      network: false,
    });
  });
  it("applies grant settings from the focused dialog and reverts on close", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openCard(user, /^单聊项目授权/);
    await user.click(screen.getByRole("checkbox", { name: "Test project" }));
    // 勾选即时生效（两阶段：保存 + 启用）。
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(f.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    // 授权后的项目行带模式后缀。
    expect(
      await screen.findByRole("checkbox", { name: "Test project.Plan" }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    // 关闭放弃未确认的改动：模式回退为已保存的 Plan。
    await user.click(screen.getByRole("radio", { name: /Review · 只读审查/ }));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(
      screen.getByRole("checkbox", { name: "Test project.Plan" }),
    ).toBeChecked();
    expect(f.save).toHaveBeenCalledTimes(2);
    // 「确认设置」直接保存并启用，并关闭弹窗。
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    await user.click(screen.getByRole("radio", { name: /Review · 只读审查/ }));
    await user.click(screen.getByRole("button", { name: "确认设置" }));
    await waitFor(() =>
      expect(f.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          enabled: true,
          grants: [expect.objectContaining({ mode: "review" })],
        }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "确认设置" }),
    ).not.toBeInTheDocument();
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
    // 配对请求卡片已内聚进配对码弹窗：下钻机器人所在渠道后从行内打开弹窗审批。
    await openChannel(user, "wecom");
    await user.click(
      await screen.findByRole("button", { name: "生成配对码 Test bot" }),
    );
    await screen.findByText("0123456789abcdef");
    /* 生成新码会作废旧请求（与网关同语义）：重新注入待确认请求并经
       「刷新配对结果」拉取。 */
    f.set({
      pairingRequests: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          identity,
          expiresAt: Date.now() + 300000,
        },
      ],
    });
    await user.click(
      screen.getByRole("button", { name: "我已发送，刷新配对结果" }),
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
    /* 批准后自动进入管理=渠道详情弹窗保持打开。 */
    expect(document.querySelector(".im-channel-dialog")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "批准" }),
    ).not.toBeInTheDocument();
    expect(f.get().identities).toEqual([identity]);
  });
  it("requires inline unpair confirmation, restores focus on Escape, and retains failed confirmation", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await openChannel(user, "wecom");
    const trigger = await screen.findByRole("button", { name: "解除绑定" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "确认解除" })).toHaveFocus();
    expect(f.manage).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "解除绑定" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "解除绑定" }));
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
  it("removes advanced space editing and requires a local gateway for group setup", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await panelReady();
    await openGroupSetup(user);
    expect(screen.queryByLabelText("空间配置（JSON）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("协作空间管理凭据")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "确认并启用群聊" }),
    ).not.toBeInTheDocument();
    expect(
      f.manage.mock.calls.some(([a]) => a.action === "authorize-native-group"),
    ).toBe(false);
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
        locale="zh-CN"
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
    expect(screen.getByText("待处理 · 2")).toBeVisible();
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
        onClose={() => {}}
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
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制配对指令" }));
    expect(copy).toHaveBeenLastCalledWith("pair new-code");
    await act(() => vi.advanceTimersByTimeAsync(300000));
    expect(screen.getByRole("button", { name: "复制配对指令" })).toBeDisabled();
  });
  it("opens group setup from the overview of a completed flow", async () => {
    const f = fixture();
    f.set({
      identities: [{ ...identity, channel: "slack" }],
      connections: [{ ...connection, channel: "slack" }],
    });
    imWriteVerify("test-device", { confirmed: true, channel: "slack" });
    f.set({
      settings: {
        ...f.get().settings,
        grants: [
          {
            projectId: "test-project",
            tokenBudget: 100000,
            approval: "ask",
            mode: "plan",
            network: false,
            shell: false,
            groups: [],
            expiresAt: Date.now() + 60000,
            security: {
              version: 2,
              revision: "confirmed",
              confirmedAt: 1,
              scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    // 完成态直达概览；顶部设置群协作按钮已移除，入口=右栏第三卡。
    expect(
      screen.queryByRole("button", { name: "设置群协作" }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /^群聊项目授权/ }),
    );
    expect(
      screen.getByRole("button", { name: "返回", exact: true }),
    ).toBeVisible();
    expect(screen.getByText("群聊项目授权")).toBeVisible();
  });
  it("advances the honest test track from real task signals only", async () => {
    const f = fixture();
    f.set({
      settings: {
        ...f.get().settings,
        grants: [
          {
            projectId: "test-project",
            tokenBudget: 100000,
            approval: "ask",
            mode: "plan",
            network: false,
            shell: false,
            groups: [],
            expiresAt: Date.now() + 60000,
            security: {
              version: 2,
              revision: "confirmed",
              confirmedAt: 1,
              scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
            },
          },
        ],
      },
      remoteTasks: [{ threadId: "task-1", channel: "wecom", kind: "task" }],
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    // 三步全✓直达概览；②尾「顺手验证」段按需展开（可选，不入完成链）。
    await waitFor(() =>
      expect(document.querySelector(".im-overview")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "单聊项目授权" }),
    ).not.toBeInTheDocument();
    await openChannel(user, "wecom");
    await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
    const track = screen.getByRole("list", { name: "测试任务进度" });
    /* 真实信号推进：仅「桌面出现任务」由系统检测置 done；后续两段等用户确认。 */
    expect(
      track.children[1].getAttribute("data-state") === "done" &&
        track.children[2].getAttribute("data-state") === "pending" &&
        track.children[3].getAttribute("data-state") === "pending",
    ).toBe(true);
    await user.click(
      screen.getByRole("checkbox", { name: /我已在手机上收到/ }),
    );
    /* 确认（诚实版）：折叠标签带渠道归属，完成链进度不变。 */
    expect(screen.getByText("顺手验证：已验证 · 企业微信")).toBeVisible();
    expect(screen.queryByText("设置进度 3/3")).toBeNull();
  });
  it("notifies once when a completed flow step regresses after a connection is removed", async () => {
    const f = fixture();
    imWriteVerify("test-device", { confirmed: true, channel: "wecom" });
    f.set({
      settings: {
        ...f.get().settings,
        grants: [
          {
            projectId: "test-project",
            tokenBudget: 100000,
            approval: "ask",
            mode: "plan",
            network: false,
            shell: false,
            groups: [],
            expiresAt: Date.now() + 60000,
            security: {
              version: 2,
              revision: "confirmed",
              confirmedAt: 1,
              scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" />);
    await waitFor(() =>
      expect(document.querySelector(".im-overview")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "单聊项目授权" }),
    ).not.toBeInTheDocument();
    // 删除连接后②③完成态回退：卡片摘要回退、给出一次性提示并出现「继续设置」。
    f.set({ connections: [], identities: [] });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText(/有已完成步骤被重置/)).toBeVisible();
    expect(screen.getByRole("button", { name: "继续设置" })).toBeVisible();
    // 继续设置回到引导流：无已配置渠道自动下钻，空态文案在渠道详情内。
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "继续设置" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "继续设置" }));
    /* 渠道配置=点卡进入的整幅二级卡。 */
    await openChannel(user, "feishu");
    expect(await screen.findByText("尚未保存机器人连接")).toBeVisible();
  });
});

it("hides WeCom group setup while retaining direct-chat setup and other platform entries", async () => {
  fixture();
  const user = userEvent.setup();
  render(<ImSettingsPanel locale="zh-CN" />);
  await openChannel(user, "wecom");
  /* 主从布局：验证页与机器人详情互斥；wecom 验证页不出现单聊授权入口。 */
  await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
  expect(
    screen.queryByRole("button", { name: /^单聊项目授权$/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Test bot/ }));
  expect(
    screen.getByRole("button", { name: "生成配对码 Test bot" }),
  ).toBeVisible();
  await closeChannelDialog(user);
  await openChannel(user, "slack");
  await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
  expect(screen.getByRole("button", { name: /设置群协作/ })).toBeVisible();
  await closeChannelDialog(user);
  await openChannel(user, "feishu");
  await user.click(screen.getByRole("button", { name: /^顺手验证/ }));
  expect(screen.getByRole("button", { name: /设置群协作/ })).toBeVisible();
});

describe("single project authorization editor", () => {
  function groupFixture(enabled: boolean, observedOwner = true) {
    const f = fixture();
    const owner = { ...identity, channel: "slack" as const };
    const conversation = {
      connectionId: connection.id,
      id: "room",
      kind: "group",
    };
    const space = {
      id: "saved",
      name: "研发群",
      revision: "members-1",
      confirmed: true,
      endpoints: [conversation],
      participants: [
        {
          deviceId: "test-device",
          identity: owner,
          name: "Private member name",
        },
      ],
      administrators: [owner],
      nativeGroup: {
        version: 1,
        projectId: "test-project",
        enabled,
        capability: "manual",
        enabledAt: 1,
        ownerDeviceId: "test-device",
      },
    };
    f.set({
      localGateway: { state: "running" },
      spaces: [space],
      settings: imSettingsSchema.parse({
        ...f.get().settings,
        grants: [
          {
            projectId: "test-project",
            mode: "execute",
            approval: "automatic",
            groups: ["space:saved"],
            expiresAt: Date.now() + 600000,
            security: {
              version: 2,
              revision: "saved",
              confirmedAt: 1,
              scopes: [
                {
                  audience: "owner",
                  readPaths: ["private"],
                  writePaths: [],
                  confirmedAt: 1,
                },
                {
                  audience: "space:saved",
                  readPaths: ["shared"],
                  writePaths: [],
                  confirmedAt: 1,
                  spaceRevision: "members-1",
                },
              ],
            },
          },
        ],
      }),
      remoteTasks: [
        {
          threadId: "group-task",
          channel: "slack",
          kind: "task",
          group: {
            spaceId: "saved",
            name: "研发群",
            native: true,
            confirmed: true,
            stale: false,
            executingDeviceId: "test-device",
            members: [
              {
                deviceId: "test-device",
                identity: owner,
                name: "Private member name",
                deviceName: "Private device",
                state: "online",
              },
            ],
          },
        },
      ],
    });
    const original = f.manage.getMockImplementation()!;
    f.manage.mockImplementation(async (input) =>
      input.action === "admin" && input.operation === "status"
        ? {
            identities: [{ identity: owner, deviceId: "test-device" }],
            groups: [
              {
                conversation,
                name: "研发群",
                platform: "slack",
                identities: observedOwner ? [owner] : [],
                lastSeenAt: 1,
              },
            ],
            spaces: [space],
            deliveries: [],
          }
        : original(input),
    );
    return { ...f, owner };
  }
  async function openGroupEditor(user: ReturnType<typeof userEvent.setup>) {
    /* initialPermissions 渲染时授权详情直接打开：等数据到位后点授权配置。 */
    await screen.findByRole("button", { name: "授权配置" });
    await user.click(screen.getByRole("button", { name: "授权配置" }));
    const dialog = screen.getByRole("dialog", {
      name: "Test project · 授权设置",
    });
    await user.click(within(dialog).getByRole("button", { name: /分享给谁/ }));
    await user.click(
      await screen.findByRole("option", { name: "研发群 · Slack" }),
    );
    return dialog;
  }
  it("removes member details and leaves only the project entry for enabled and paused groups", async () => {
    groupFixture(true);
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" initialPermissions />);
    /* initialPermissions：授权详情直接打开，无需点卡片。 */
    await screen.findByRole("button", { name: "授权配置" });
    expect(screen.queryByText("Private member name")).not.toBeInTheDocument();
    expect(screen.queryByText(/群协作成员/)).not.toBeInTheDocument();
    // 群协作入口已移至 IM 渠道第三卡：返回列表后下钻。
    await user.click(screen.getByRole("button", { name: "返回", exact: true }));
    await user.click(screen.getByRole("button", { name: /^群聊项目授权/ }));
    await user.click(screen.getByRole("button", { name: /已发现的群/ }));
    await user.click(screen.getByRole("option", { name: "研发群 · Slack" }));
    /* 单聊项目授权=第四卡：返回列表后下钻再断言授权配置。 */
    await user.click(screen.getByRole("button", { name: "返回", exact: true }));
    await user.click(screen.getByRole("button", { name: /^单聊项目授权/ }));
    expect(screen.getAllByRole("button", { name: "授权配置" })).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: "数据与分享范围" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本地项目/ }),
    ).not.toBeInTheDocument();
  });
  it("edits an enabled group's scope in the same dialog without changing the owner's scope", async () => {
    const f = groupFixture(true);
    const ownerScope = f.get().settings.grants[0]!.security!.scopes[0];
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" initialPermissions />);
    const dialog = await openGroupEditor(user);
    expect(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    ).toBeChecked();
    await user.click(
      within(dialog).getByRole("button", { name: "整个项目可修改" }),
    );
    expect(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    ).not.toBeChecked();
    await user.click(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "确认设置" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const scopes = f.get().settings.grants[0]!.security!.scopes;
    expect(scopes.find((scope) => scope.audience === "owner")).toEqual(
      ownerScope,
    );
    expect(
      scopes.find((scope) => scope.audience === "space:saved"),
    ).toMatchObject({ writeMode: "project" });
    expect(
      f.manage.mock.calls.some(
        ([action]) => action.action === "authorize-native-group",
      ),
    ).toBe(false);
  });
  it("requires fresh consent to resume a paused group and keeps the draft open on failure", async () => {
    const f = groupFixture(false);
    const ownerScope = f.get().settings.grants[0]!.security!.scopes[0];
    const original = f.manage.getMockImplementation()!;
    let fail = true;
    f.manage.mockImplementation(async (action) => {
      if (action.action === "authorize-native-group" && fail)
        throw new Error("Group service unavailable");
      return original(action);
    });
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" initialPermissions />);
    const dialog = await openGroupEditor(user);
    const save = within(dialog).getByRole("button", { name: "确认并启用群聊" });
    expect(save).toBeDisabled();
    expect(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    ).not.toBeChecked();
    await user.click(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    );
    await user.click(save);
    expect(
      await within(dialog).findByText("Group service unavailable"),
    ).toBeVisible();
    expect(f.get().settings.grants[0]!.security!.scopes[0]).toEqual(ownerScope);
    fail = false;
    await user.click(save);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(f.manage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "authorize-native-group",
        owner: f.owner,
        grant: expect.objectContaining({
          mode: "execute",
          security: expect.objectContaining({
            scopes: [
              expect.objectContaining({
                audience: "owner",
                readPaths: ["shared"],
              }),
            ],
          }),
        }),
      }),
    );
  });
  it("cannot activate a group without observing the paired owner in that group", async () => {
    const f = groupFixture(false, false);
    const user = userEvent.setup();
    render(<ImSettingsPanel locale="zh-CN" initialPermissions />);
    const dialog = await openGroupEditor(user);
    await user.click(
      within(dialog).getByRole("checkbox", { name: /我确认当前会话/ }),
    );
    expect(within(dialog).getByText(/请先在该群发送一条消息/)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "确认并启用群聊" }),
    ).toBeDisabled();
    expect(
      f.manage.mock.calls.some(
        ([action]) => action.action === "authorize-native-group",
      ),
    ).toBe(false);
  });
});
