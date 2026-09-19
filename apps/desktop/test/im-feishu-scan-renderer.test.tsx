// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(manage).toHaveBeenCalledWith({ action: "feishu-scan-begin" });
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
});
