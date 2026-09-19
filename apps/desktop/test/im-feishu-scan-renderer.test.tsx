// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";
import { ImFeishuScan } from "../src/renderer/ImFeishuScan.js";
import { uiTranslator } from "../src/shared/ui-text.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const t = uiTranslator("zh-CN");
const begin = {
  deviceCode: "device",
  qrUrl: "https://accounts.feishu.cn/confirm",
  qrImage: "data:image/png;base64,c3ludGhldGlj",
  userCode: "new-code",
  expiresAt: Date.now() + 600000,
  intervalMs: 1,
  domain: "feishu",
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Feishu scan request lifecycle", () => {
  it("updates failure copy when the desktop language changes without restarting the scan", async () => {
    const manage = vi
      .fn()
      .mockRejectedValue(new Error("synthetic network failure"));
    stubWindowArtemis({ manageIm: manage });
    const props = {
      autoStart: true,
      busy: false,
      disabled: false,
      onConnected: vi.fn(),
    };
    const view = render(<ImFeishuScan {...props} t={uiTranslator("en")} />);
    expect(
      await screen.findByText(uiTranslator("en")("ImFeishuScan.message13")),
    ).toBeVisible();
    view.rerender(<ImFeishuScan {...props} t={uiTranslator("ja")} />);
    expect(
      screen.getByText(uiTranslator("ja")("ImFeishuScan.message13")),
    ).toBeVisible();
    expect(manage).toHaveBeenCalledTimes(1);
  });
  it.each(APP_LOCALES)("names Lark in scan instructions in %s", (locale) => {
    const { container } = render(
      <ImFeishuScan
        t={uiTranslator(locale)}
        domain="lark"
        busy={false}
        disabled={false}
        onConnected={vi.fn()}
      />,
    );
    expect(container).toHaveTextContent("Lark");
    expect(container.textContent).not.toMatch(/Feishu|飞书|飛書|\{\{/);
  });
  it("waits for device registration before automatically starting", async () => {
    const manage = vi.fn(async () => ({ ...begin, intervalMs: 60000 }));
    stubWindowArtemis({ manageIm: manage });
    const props = {
      t,
      autoStart: true,
      busy: false,
      disabled: true,
      onConnected: vi.fn(),
    };
    const ui = render(<ImFeishuScan {...props} />);
    await act(async () => {});
    expect(manage).not.toHaveBeenCalled();
    ui.rerender(<ImFeishuScan {...props} disabled={false} />);
    expect(await screen.findByText("new-code")).toBeVisible();
    expect(manage).toHaveBeenCalledWith({
      action: "feishu-scan-begin",
      domain: "feishu",
    });
  });
  it("ignores an old poll rejection after replacing the QR code", async () => {
    vi.useFakeTimers();
    let rejectPoll: (error: Error) => void = () => {};
    const manage = vi.fn(async (input: { action: string }) =>
      input.action === "feishu-scan-poll"
        ? new Promise((_, reject) => {
            rejectPoll = reject;
          })
        : begin,
    );
    stubWindowArtemis({ manageIm: manage });
    const props = {
      t,
      autoStart: true,
      busy: false,
      disabled: false,
      onConnected: vi.fn(),
    };
    const ui = render(<ImFeishuScan {...props} refreshSignal={0} />);
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feishu-scan-poll" }),
    );
    ui.rerender(<ImFeishuScan {...props} refreshSignal={1} />);
    await act(async () => {});
    await act(async () => rejectPoll(new Error("stale network failure")));
    expect(screen.getByText("new-code")).toBeVisible();
    expect(
      screen.queryByText(t("ImFeishuScan.message13")),
    ).not.toBeInTheDocument();
  });

  it("polls and connects Lark credentials without changing the saved app name", async () => {
    vi.useFakeTimers();
    const manage = vi.fn(async (input: { action: string }) => {
      if (input.action === "feishu-scan-begin")
        return { ...begin, domain: "lark" };
      if (input.action === "feishu-scan-poll")
        return {
          status: "success",
          appId: "cli_lark",
          appSecret: "synthetic-secret",
          appName: "Feishu migration helper",
          domain: "lark",
        };
      return { connectionId: "lark-bot" };
    });
    stubWindowArtemis({ manageIm: manage });
    const connected = vi.fn();
    render(
      <ImFeishuScan
        t={t}
        domain="lark"
        autoStart
        busy={false}
        disabled={false}
        onConnected={connected}
      />,
    );
    await act(async () => {});
    expect(screen.getByText("等待Lark扫码…")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(manage).toHaveBeenCalledWith({
      action: "feishu-scan-poll",
      deviceCode: "device",
      domain: "lark",
    });
    expect(manage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "feishu-scan-connect",
        appId: "cli_lark",
        domain: "lark",
      }),
    );
    expect(connected).toHaveBeenCalledWith("lark-bot");
    expect(
      screen.getByText(/「Feishu migration helper」，请在Lark私聊/),
    ).toBeVisible();
  });
});
