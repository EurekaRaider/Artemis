// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalPanel } from "../../../src/renderer/terminal/TerminalPanel.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

const terminals = vi.hoisted(
  () =>
    [] as Array<{
      options: Record<string, any>;
      write: ReturnType<typeof vi.fn>;
      writeln: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      select: ReturnType<typeof vi.fn>;
      scrollToLine: ReturnType<typeof vi.fn>;
      refresh: ReturnType<typeof vi.fn>;
    }>,
);
// The size the next FitAddon.fit() measures; undefined keeps the terminal as is.
const fit = vi.hoisted(() => ({
  size: undefined as { cols: number; rows: number } | undefined,
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
    buffer = { active: { viewportY: 4 } };
    getSelectionPosition() {
      return { start: { x: 2, y: 5 }, end: { x: 8, y: 5 } };
    }
    select = vi.fn();
    scrollToLine = vi.fn();
    refresh = vi.fn();
    constructor(public options: Record<string, any>) {
      terminals.push(this);
    }
    loadAddon(addon: { activate?(terminal: unknown): void }) {
      addon.activate?.(this);
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    open() {}
    focus() {}
    onData() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    terminal?: { resize(cols: number, rows: number): void };
    activate(terminal: { resize(cols: number, rows: number): void }) {
      this.terminal = terminal;
    }
    fit() {
      if (fit.size) this.terminal?.resize(fit.size.cols, fit.size.rows);
    }
  },
}));
afterEach(() => {
  terminals.length = 0;
  fit.size = undefined;
  vi.useRealTimers();
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
    locale: "en" as const,
    threadId: "task",
    title: "Terminal",
    emptyMessage: "No terminal",
  };
  const view = render(<TerminalPanel {...props} theme="light" />);
  await act(async () => {});
  expect(
    screen.getByText(
      "Runs as your desktop user without automatic privilege elevation.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("zsh · desktop-user")).toBeNull();
  const terminal = terminals[0]!;
  expect(terminal.options.minimumContrastRatio).toBe(4.5);
  act(() => window.dispatchEvent(new Event("artemis:appearance-applied")));
  expect(terminal.select).toHaveBeenCalledWith(2, 5, 6);
  expect(terminal.scrollToLine).toHaveBeenCalledWith(4);
  expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
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

it("updates exit messages in the current language without restarting the terminal", async () => {
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
  let exit: (event: { terminalId: string; exitCode: number }) => void;
  stubWindowArtemis({
    openTerminal: open,
    closeTerminal: close,
    resizeTerminal: vi.fn(async () => {}),
    onTerminalData: vi.fn(() => () => {}),
    onTerminalExit: vi.fn((listener) => {
      exit = listener;
      return () => {};
    }),
  });
  const view = render(
    <TerminalPanel
      threadId="task"
      theme="light"
      locale="en"
      title="Terminal"
      emptyMessage="No terminal"
    />,
  );
  await act(async () => {});
  const terminal = terminals[0]!;
  view.rerender(
    <TerminalPanel
      threadId="task"
      theme="light"
      locale="zh-CN"
      title="终端"
      emptyMessage="终端不可用"
    />,
  );
  await act(async () => {});
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(terminal.dispose).not.toHaveBeenCalled();
  act(() => exit({ terminalId: "terminal", exitCode: 7 }));
  expect(terminal.writeln).toHaveBeenCalledWith("\r\n[进程已退出，退出码：7]");
  expect(screen.getByText("进程已退出，退出码：7")).toBeTruthy();
  view.rerender(
    <TerminalPanel
      threadId="task"
      theme="light"
      locale="de"
      title="Terminal"
      emptyMessage="Kein Terminal"
    />,
  );
  expect(screen.getByText("Prozess mit Code 7 beendet")).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
  expect(terminal.writeln).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(close).toHaveBeenCalledExactlyOnceWith("terminal");
});

it("tells the shell only the settled size while the dock animates open or closed", async () => {
  vi.useFakeTimers();
  let observed: () => void = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  const resizeTerminal = vi.fn(async () => {});
  stubWindowArtemis({
    openTerminal: vi.fn(async () => ({
      terminalId: "terminal",
      shell: "zsh",
      sandboxImplementation: "desktop-user",
    })),
    closeTerminal: vi.fn(async () => {}),
    resizeTerminal,
    onTerminalData: vi.fn(() => () => {}),
    onTerminalExit: vi.fn(() => () => {}),
  });
  const view = render(
    <TerminalPanel
      threadId="task"
      theme="dark"
      locale="en"
      title="Terminal"
      emptyMessage="No terminal"
    />,
  );
  await act(async () => {});
  const host = view.container.querySelector<HTMLElement>(".terminal-host")!;
  const terminal = terminals[0]!;
  let width = 560;
  Object.defineProperty(host, "clientWidth", { get: () => width });
  const animate = (frames: Array<[cols: number, px: number]>) => {
    for (const [cols, px] of frames) {
      fit.size = { cols, rows: 24 };
      width = px;
      act(() => observed());
      act(() => vi.advanceTimersByTime(16));
    }
  };

  // Closing eases the host to zero width (FitAddon's 2-column floor) well
  // before the dock turns hidden.
  animate([
    [60, 420],
    [30, 210],
    [8, 56],
    [2, 0],
  ]);
  act(() => vi.advanceTimersByTime(300));
  host.style.visibility = "hidden";
  act(() => vi.advanceTimersByTime(500));
  expect(resizeTerminal).not.toHaveBeenCalled();
  // xterm never shrinks either: it does not reflow the cursor line.
  expect(terminal).toMatchObject({ cols: 80, rows: 24 });

  // Reopening returns to the size the shell already has.
  host.style.visibility = "";
  animate([
    [8, 56],
    [30, 210],
    [60, 420],
    [80, 560],
  ]);
  act(() => vi.advanceTimersByTime(500));
  expect(resizeTerminal).not.toHaveBeenCalled();

  // A real size change reaches the shell once, after it settles.
  animate([
    [76, 532],
    [70, 490],
    [64, 448],
  ]);
  expect(terminal.cols).toBe(80);
  expect(resizeTerminal).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(500));
  expect(resizeTerminal).toHaveBeenCalledExactlyOnceWith("terminal", 64, 24);
  view.unmount();
});
