import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { ComputerBrowserDriver } from "../src/main/computer-use/browser-driver.js";

async function fixture() {
  const image = {
    isEmpty: () => false,
    resize: vi.fn().mockReturnThis(),
    toJPEG: () => Buffer.from("frame"),
  };
  const page = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: vi.fn(() => false),
    getURL: () => "https://example.test/",
    getTitle: vi.fn(() => "Form"),
    loadURL: vi.fn(async () => {}),
    invalidate: vi.fn(),
    capturePage: vi.fn(async () => image),
    debugger: {
      isAttached: () => true,
      sendCommand: vi.fn(async (method: string) =>
        method === "Accessibility.getFullAXTree"
          ? {
              nodes: [
                {
                  nodeId: "1",
                  role: { value: "textbox" },
                  name: { value: "Name" },
                },
              ],
            }
          : {
              cssLayoutViewport: {
                clientWidth: 800,
                clientHeight: 600,
                pageX: 0,
                pageY: 0,
              },
            },
      ),
    },
  });
  const driver = new ComputerBrowserDriver(
    async () => page as unknown as WebContents,
    vi.fn(),
  );
  const controller = new AbortController();
  const target = await driver.open(
    { target: "browser", url: "https://example.test/" },
    { threadId: "task", turnId: "turn", mode: "execute" },
    controller.signal,
  );
  return { driver, page, image, target, controller };
}

it("recovers transient compositor failures inside one observation without replaying navigation or input", async () => {
  const { driver, page, target, controller } = await fixture();
  page.capturePage
    .mockRejectedValueOnce(new Error("UnknownVizError"))
    .mockRejectedValueOnce(
      new Error("Current display surface not available for capture"),
    );
  const frame = await driver.observe(target, true, controller.signal);
  expect(frame.image?.data).toBe(Buffer.from("frame").toString("base64"));
  expect(page.capturePage).toHaveBeenCalledTimes(4);
  expect(page.invalidate).toHaveBeenCalledTimes(2);
  expect(page.loadURL).toHaveBeenCalledOnce();
  expect(
    page.debugger.sendCommand.mock.calls.slice(-2).map(([method]) => method),
  ).toEqual(["Accessibility.getFullAXTree", "Page.getLayoutMetrics"]);
  expect(
    page.debugger.sendCommand.mock.invocationCallOrder.at(-2),
  ).toBeGreaterThan(page.capturePage.mock.invocationCallOrder.at(-1)!);
});

it("waits for an opening panel to finish resizing before returning its first observation", async () => {
  const { driver, page, target, controller } = await fixture();
  const sendCommand = page.debugger.sendCommand.getMockImplementation()!;
  const widths = [342, 600, 800, 800];
  page.debugger.sendCommand.mockImplementation(async (method) => {
    const result = await sendCommand(method);
    if (method === "Page.getLayoutMetrics")
      result.cssLayoutViewport!.clientWidth = widths.shift() ?? 800;
    return result;
  });
  target.name = "about:blank";
  const frame = await driver.observe(target, true, controller.signal);
  expect(frame.width).toBe(800);
  expect(target.name).toBe("Form");
  expect(page.loadURL).toHaveBeenCalledOnce();
  expect(page.capturePage).toHaveBeenCalledTimes(4);
  expect(
    page.debugger.sendCommand.mock.calls.some(([method]) =>
      method.startsWith("Input."),
    ),
  ).toBe(false);
  page.debugger.sendCommand.mockClear();
  page.capturePage.mockClear();
  await driver.observe(target, false, controller.signal);
  expect(page.debugger.sendCommand.mock.calls).toHaveLength(2);
  expect(page.capturePage).not.toHaveBeenCalled();
});

it("bounds the wait when the viewport keeps resizing", async () => {
  const { driver, page, target, controller } = await fixture();
  const sendCommand = page.debugger.sendCommand.getMockImplementation()!;
  let width = 400;
  page.debugger.sendCommand.mockImplementation(async (method) => {
    const result = await sendCommand(method);
    if (method === "Page.getLayoutMetrics")
      result.cssLayoutViewport!.clientWidth = width++;
    return result;
  });
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    /viewport is still resizing/,
  );
  expect(page.loadURL).toHaveBeenCalledOnce();
});

it("bounds capture recovery and reports the actual failure", async () => {
  const { driver, page, target, controller } = await fixture();
  page.capturePage.mockRejectedValue(new Error("UnknownVizError"));
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    /Browser screenshot unavailable after 4 attempts: UnknownVizError/,
  );
  expect(page.capturePage).toHaveBeenCalledTimes(4);
  expect(page.loadURL).toHaveBeenCalledOnce();
});

it("never treats an empty capture as a valid coordinate observation", async () => {
  const { driver, page, image, target, controller } = await fixture();
  image.isEmpty = () => true;
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    /empty image/,
  );
  expect(page.capturePage).toHaveBeenCalledTimes(4);
  expect(image.resize).not.toHaveBeenCalled();
});

it("cancels capture recovery immediately when control is stopped", async () => {
  const { driver, page, target, controller } = await fixture();
  page.capturePage.mockRejectedValue(new Error("UnknownVizError"));
  page.invalidate.mockImplementation(() => controller.abort());
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    /abort/i,
  );
  expect(page.capturePage).toHaveBeenCalledOnce();
});

it("does not retry unrelated errors or a destroyed browser", async () => {
  const { driver, page, target, controller } = await fixture();
  page.capturePage.mockRejectedValueOnce(new Error("Permission denied"));
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    "Permission denied",
  );
  expect(page.capturePage).toHaveBeenCalledOnce();
  page.capturePage.mockImplementationOnce(async () => {
    page.isDestroyed.mockReturnValue(true);
    throw new Error("UnknownVizError");
  });
  await expect(driver.observe(target, true, controller.signal)).rejects.toThrow(
    /Browser closed/,
  );
  expect(page.capturePage).toHaveBeenCalledTimes(2);
});

it("keeps semantic-only observations free of screenshot work", async () => {
  const { driver, page, target, controller } = await fixture();
  const frame = await driver.observe(target, false, controller.signal);
  expect(frame.elements).toHaveLength(1);
  expect(frame.image).toBeUndefined();
  expect(page.capturePage).not.toHaveBeenCalled();
});
