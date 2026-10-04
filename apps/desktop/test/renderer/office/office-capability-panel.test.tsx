// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CapabilityPackStatus } from "@artemis/protocol";
import { OfficeCapabilityPanel } from "../../../src/renderer/office/OfficeCapabilityPanel.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

function fixture(overrides: Partial<CapabilityPackStatus> = {}) {
  let status: CapabilityPackStatus = {
    id: "office-core",
    activeVersion: "1.0.0",
    versions: [
      { version: "1.0.0", bytes: 653346500, active: true, inUse: false },
    ],
    dependents: ["Documents", "Presentations", "Spreadsheets"],
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: 0,
    ...overrides,
  };
  const uninstall = vi.fn(async () => {
    status = {
      ...status,
      activeVersion: undefined,
      versions: [],
      dependents: [],
    };
  });
  const install = vi.fn(async () => {});
  const importPack = vi.fn(async () => {});
  const deactivate = vi.fn(async () => {});
  const check = vi.fn(async () => {
    status = { ...status, updateCheck: "checked" };
  });
  stubWindowArtemis({
    officeCapabilityStatus: async () => status,
    uninstallOfficeCapability: uninstall,
    installOfficeCapability: install,
    importOfficeCapability: importPack,
    deactivateOfficeCapability: deactivate,
    checkOfficeCapabilityUpdates: check,
  });
  render(<OfficeCapabilityPanel locale="zh-CN" onClose={vi.fn()} />);
  return { uninstall, install, importPack, deactivate, check };
}

describe("Office installation controls", () => {
  it("switches an installed pack to management and puts offline maintenance behind a disclosure", async () => {
    fixture();
    expect(
      await screen.findByRole("dialog", { name: "管理 Office 配置" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "导入离线包" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择离线包" }),
    ).not.toBeVisible();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled();
    expect(screen.getByText("在线更新暂未开放。")).toBeInTheDocument();
    fireEvent.click(screen.getByText("离线更新 / 修复", { exact: true }));
    expect(screen.getByRole("button", { name: "选择离线包" })).toBeVisible();
  });

  it("checks an installed version without reinstalling and reports that it is current", async () => {
    const f = fixture({
      canCheckUpdates: true,
      availableVersion: "1.0.0",
      updateCheck: "idle",
    });
    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
    expect(
      await screen.findByText("当前已是可用的最新版本。"),
    ).toBeInTheDocument();
    expect(f.check).toHaveBeenCalledOnce();
    expect(f.install).not.toHaveBeenCalled();
  });

  it("offers a confirmed newer release as an update action", async () => {
    const f = fixture({
      canCheckUpdates: true,
      availableVersion: "1.1.0",
      updateVersion: "1.1.0",
      updateCheck: "checked",
    });
    expect(await screen.findByText("发现新版本 1.1.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更新到 1.1.0" }));
    await waitFor(() => expect(f.install).toHaveBeenCalledOnce());
  });

  it("reports failed checks without claiming the installed version is current", async () => {
    fixture({
      canCheckUpdates: true,
      updateCheck: "error",
      updateError: "offline",
    });
    expect(
      await screen.findByText("检查更新失败，请稍后重试。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("当前已是可用的最新版本。"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled();
  });
  it("removes a shared installation in one action without a separate Lite switch", async () => {
    const f = fixture();
    const remove = await screen.findByRole("button", {
      name: "卸载",
      exact: true,
    });
    expect(remove).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /恢复使用 Lite/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(remove);
    await waitFor(() => expect(f.uninstall).toHaveBeenCalledWith("1.0.0"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "卸载", exact: true }),
      ).not.toBeInTheDocument(),
    );
    expect(f.deactivate).not.toHaveBeenCalled();
  });

  it("explains why removal is unavailable while a document is open", async () => {
    fixture({
      versions: [{ version: "1.0.0", bytes: 10, active: true, inUse: true }],
    });
    expect(
      await screen.findByRole("button", { name: "卸载", exact: true }),
    ).toBeDisabled();
    expect(
      screen.getByText("请先关闭正在使用 Office 功能的文档，再卸载。"),
    ).toBeInTheDocument();
  });

  it("offers offline import and an honest message when no online release is configured", async () => {
    const f = fixture({
      activeVersion: undefined,
      versions: [],
      dependents: [],
    });
    expect(
      await screen.findByText("在线安装暂未开放，请导入离线包。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "在线安装" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "校验 / 修复" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入离线包" }));
    await waitFor(() => expect(f.importPack).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导入离线包" })).toBeEnabled(),
    );
  });

  it("installs an available online release directly", async () => {
    const f = fixture({
      availableVersion: "1.0.0",
      activeVersion: undefined,
      versions: [],
    });
    fireEvent.click(await screen.findByRole("button", { name: "在线安装" }));
    await waitFor(() => expect(f.install).toHaveBeenCalledOnce());
    expect(f.importPack).not.toHaveBeenCalled();
  });
});
