// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ResourceCenter } from "../src/renderer/ResourceCenter.js";
import { PluginConnectionDialog } from "../src/renderer/PluginConnectionDialog.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import type { ConnectorCatalogEntry } from "../src/shared/connectors.js";

const definition: ConnectorCatalogEntry = {
  version: 1,
  id: "qq-mail",
  serverId: "plugin-qq",
  displayName: "QQ Mail",
  provider: "qq",
  auth: "app-password",
  scopes: [],
  installed: true,
};
const plugin = {
  id: "qq-plugin",
  name: "qq-mail",
  displayName: "QQ Mail",
  version: "0.2.0",
  description: "Mail plugin",
  source: { kind: "local", path: "/synthetic/qq" },
  installed: false,
  installable: true,
  skills: [],
  mcpServers: [
    {
      name: "QQ Mail",
      endpoint: "${ARTEMIS_NODE}",
      importable: true,
      connector: definition,
    },
  ],
  apps: [],
  unsupported: [],
  warnings: [],
};
const installed = {
  ...plugin,
  installed: true,
  mcpServerIds: [definition.serverId],
  skillNames: [],
  contentHash: "synthetic",
  installedAt: "today",
  updatedAt: "today",
};
const server = {
  config: {
    id: definition.serverId,
    name: "QQ Mail",
    enabled: false,
    resourceKind: "connector",
    connector: definition,
  },
  state: "disabled",
  tools: [],
};
const market = {
  selectedView: "shop",
  sources: [
    {
      id: "shop",
      displayName: "ArtemisPluginShop",
      marketplaceName: "artemis-plugin-shop",
      repository: "synthetic/shop",
      builtIn: false,
      removable: true,
    },
  ],
  marketplaces: [
    {
      sourceId: "shop",
      marketplace: {
        name: "ArtemisPluginShop",
        marketplaceName: "artemis-plugin-shop",
        plugins: [plugin],
        warnings: [],
      },
    },
  ],
  errors: [],
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it("opens only the newly installed plugin connection, then reopens it from that plugin", async () => {
  const user = userEvent.setup();
  const confirm = vi.fn(
    async (_message: string, _tone?: string, _options?: object) => true,
  );
  const connect = vi.fn(async () => ({}));
  const install = vi.fn(async () => ({
    plugins: [installed],
    settings: { mcpServers: [server], trustedExtensions: [] },
    skills: [],
    warnings: [],
  }));
  stubWindowArtemis({
    listMcpServers: async () => [],
    listCodexPlugins: async () => [],
    listInstalledSkills: async () => [],
    getCodexPluginMarketplaces: async () => market,
    loadCodexRuntimeMarketplace: async () => undefined,
    onResourceInstallProgress: () => () => {},
    installCodexPlugin: install,
    listConnectorDefinitions: async () => [
      definition,
      {
        ...definition,
        id: "gmail",
        serverId: "other",
        displayName: "Other Gmail",
        provider: "google",
      },
    ],
    listConnectorConnections: async () => [],
    connectConnector: connect,
  });
  render(
    <ResourceCenter
      locale="en"
      onConfirm={confirm}
      onSettingsChange={() => {}}
    />,
  );
  // Loading a marketplace does not open authorization or expose a separate page.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("tab", { name: "Connectors" })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Install" }));
  const dialog = await screen.findByRole("dialog", { name: "QQ Mail" });
  expect(install).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledWith(expect.any(String), "default", {
    title: "QQ Mail",
    acceptLabel: "Install",
  });
  const confirmation = String(confirm.mock.calls[0]?.[0]);
  expect(confirmation).not.toContain("${ARTEMIS_NODE}");
  expect(confirmation).not.toContain("MCP: 1");
  expect(confirmation).not.toContain("Unsupported: —");
  expect(confirmation).toContain("Connectors: 1");
  expect(within(dialog).queryByText("Other Gmail")).toBeNull();
  expect(within(dialog).getByLabelText("Email")).toBeVisible();
  expect(connect).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(
    screen.getAllByRole("button", { name: "Configure", exact: true })[0]!,
  );
  expect(await screen.findByRole("dialog", { name: "QQ Mail" })).toBeVisible();
});

it("cancels pending authorization when its plugin dialog is closed", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const connect = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const cancel = vi.fn(async () => {
    finish();
  });
  stubWindowArtemis({
    listConnectorDefinitions: async () => [definition],
    listConnectorConnections: async () => [],
    connectConnector: connect,
    cancelConnectorAuthorization: cancel,
  });
  const view = render(
    <PluginConnectionDialog
      locale="en"
      plugin={installed}
      closeLabel="Close"
      onClose={() => view.unmount()}
      onChanged={async () => {}}
    />,
  );
  await user.type(await screen.findByLabelText("Email"), "demo@qq.com");
  await user.type(
    screen.getByLabelText("Authorization code"),
    "abcdefghijklmnop",
  );
  await user.click(
    screen.getByRole("button", { name: "Connect", exact: true }),
  );
  expect(connect).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(cancel).toHaveBeenCalledWith("plugin-qq");
});

it("guides QQ setup and removes formatting spaces from a pasted authorization code", async () => {
  const user = userEvent.setup();
  const connect = vi.fn(async () => ({}));
  stubWindowArtemis({
    listConnectorDefinitions: async () => [definition],
    listConnectorConnections: async () => [],
    connectConnector: connect,
  });
  render(
    <PluginConnectionDialog
      locale="zh-CN"
      plugin={installed}
      closeLabel="关闭"
      onClose={() => {}}
      onChanged={async () => {}}
    />,
  );
  const email = await screen.findByLabelText("邮箱");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText(/不要填写 QQ 登录密码/)).toBeVisible();
  expect(screen.getByRole("link", { name: /打开 QQ 邮箱/ })).toHaveAttribute(
    "href",
    "https://mail.qq.com",
  );
  expect(screen.getByRole("link", { name: /官方设置帮助/ })).toHaveAttribute(
    "href",
    "https://service.mail.qq.com/detail/0/1087",
  );
  const submit = screen.getByRole("button", { name: "连接", exact: true });
  expect(submit).toBeDisabled();
  await user.type(email, "demo@qq.com");
  await user.click(screen.getByLabelText("授权码"));
  await user.paste("abcd efgh ijkl mnop");
  expect(submit).toBeEnabled();
  await user.click(submit);
  expect(connect).toHaveBeenCalledWith({
    serverId: "plugin-qq",
    email: "demo@qq.com",
    appPassword: "abcdefghijklmnop",
  });
  expect(screen.getByLabelText("授权码")).toHaveValue("");
});
