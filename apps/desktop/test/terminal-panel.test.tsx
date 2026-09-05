// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalPanel } from "../src/renderer/TerminalPanel.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

const terminals = vi.hoisted(
  () =>
    [] as Array<{
      options: Record<string, any>;
      write: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>,
);
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
    constructor(public options: Record<string, any>) {
      terminals.push(this);
    }
    loadAddon() {}
    open() {}
    focus() {}
    onData() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
afterEach(() => {
  terminals.length = 0;
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

it("uses a complete light palette with contrast protection and preserves the live terminal on theme changes", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const open = vi.fn(async () => ({
    terminalId: "terminal",
    shell: "zsh",
    sandboxImplementation: "desktop-user",
  }));
  const close = vi.fn(async () => {});
  stubWindowArtemis({
    openTerminal: open,
    closeTerminal: close,
    resizeTerminal: vi.fn(async () => {}),
    onTerminalData: vi.fn(() => () => {}),
    onTerminalExit: vi.fn(() => () => {}),
  });
  const props = {
    threadId: "task",
    title: "Terminal",
    emptyMessage: "No terminal",
  };
  const view = render(<TerminalPanel {...props} theme="light" />);
  await act(async () => {});
  const terminal = terminals[0]!;
  expect(terminal.options.minimumContrastRatio).toBe(4.5);
  expect(terminal.options.theme).toMatchObject({
    background: "#ffffff",
    foreground: "#1f2023",
    selectionForeground: "#1f2023",
  });
  for (const name of [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ])
    expect(terminal.options.theme[name], name).toMatch(/^#[0-9a-f]{6}$/i);
  view.rerender(<TerminalPanel {...props} theme="dark" />);
  expect(terminal.options.theme.background).toBe("#0d0e10");
  expect(terminal.options.minimumContrastRatio).toBe(4.5);
  view.rerender(<TerminalPanel {...props} theme="light" />);
  expect(terminal.options.theme.background).toBe("#ffffff");
  expect(open).toHaveBeenCalledTimes(1);
  expect(terminal.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(close).toHaveBeenCalledExactlyOnceWith("terminal");
});
