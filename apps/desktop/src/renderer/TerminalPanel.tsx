import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { AppTheme } from "@artemis/protocol";
import {
  TerminalHeader,
  TerminalHost,
  TerminalState,
  TerminalSurface,
  TerminalViewport,
} from "@artemis/ui/professional";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  threadId: string | undefined;
  title: string;
  emptyMessage: string;
  theme: AppTheme;
}

type TerminalPanelState = "ready" | "connecting" | "empty" | "error" | "exited";

const terminalThemes = {
  dark: {
    background: "#0d0e10",
    foreground: "#d7d9df",
    cursor: "#78a9ff",
    cursorAccent: "#0d0e10",
    selectionBackground: "#314260",
    selectionForeground: "#ffffff",
    black: "#1b1d21",
    red: "#f47067",
    green: "#8ddb8c",
    yellow: "#f2cc60",
    blue: "#78a9ff",
    magenta: "#d2a8ff",
    cyan: "#76e3ea",
    white: "#d7d9df",
    brightBlack: "#686d76",
    brightRed: "#ff7b72",
    brightGreen: "#aff5b4",
    brightYellow: "#f8e3a1",
    brightBlue: "#a5d6ff",
    brightMagenta: "#e2c5ff",
    brightCyan: "#b3f0ff",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1f2023",
    cursor: "#326fcb",
    yellow: "#795e00",
    brightYellow: "#6b5700",
    selectionBackground: "#c9dcf8",
  },
} as const;

function resolveTerminalTheme(theme: AppTheme, systemDark: boolean) {
  return terminalThemes[
    theme === "system" ? (systemDark ? "dark" : "light") : theme
  ];
}

function resolveTerminalElementTheme(
  element: HTMLElement,
  theme: AppTheme,
  systemDark: boolean,
) {
  const fallback = resolveTerminalTheme(theme, systemDark);
  const styles = window.getComputedStyle(element);
  const color = (name: string, fallbackColor: string) =>
    styles.getPropertyValue(name).trim() || fallbackColor;
  const background = color(
    "--artemis-color-terminal-background",
    fallback.background,
  );
  const foreground = color(
    "--artemis-color-terminal-foreground",
    fallback.foreground,
  );
  const selectionForeground =
    "selectionForeground" in fallback
      ? fallback.selectionForeground
      : fallback.foreground;
  return {
    ...fallback,
    background,
    cursor: color("--artemis-color-accent-primary", fallback.cursor),
    cursorAccent: background,
    foreground,
    selectionBackground: color(
      "--artemis-color-selection-background",
      fallback.selectionBackground,
    ),
    selectionForeground: color(
      "--artemis-color-selection-text",
      selectionForeground,
    ),
  };
}

export function TerminalPanel({
  threadId,
  title,
  emptyMessage,
  theme,
}: TerminalPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const themeRef = useRef(theme);
  const [detail, setDetail] = useState(emptyMessage);
  const [state, setState] = useState<TerminalPanelState>(
    threadId ? "connecting" : "empty",
  );
  themeRef.current = theme;

  useEffect(() => {
    const element = host.current;
    if (!element || !threadId) {
      setDetail(emptyMessage);
      setState("empty");
      return;
    }

    setDetail(emptyMessage);
    setState("connecting");
    let disposed = false;
    let terminalId: string | undefined;
    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: 10_000,
      theme: resolveTerminalElementTheme(
        element,
        themeRef.current,
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      ),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminalRef.current = terminal;
    terminal.open(element);

    const dataSubscription = window.artemis.onTerminalData((event) => {
      if (event.terminalId === terminalId) {
        terminal.write(event.data);
      }
    });
    const exitSubscription = window.artemis.onTerminalExit((event) => {
      if (event.terminalId === terminalId) {
        terminal.writeln(`\r\n[process exited ${event.exitCode}]`);
        setDetail(`Process exited ${event.exitCode}`);
        setState("exited");
      }
    });
    const inputSubscription = terminal.onData((data) => {
      if (terminalId) {
        void window.artemis.writeTerminal(terminalId, data);
      }
    });

    const resize = () => {
      fitAddon.fit();
      if (terminalId) {
        void window.artemis.resizeTerminal(
          terminalId,
          terminal.cols,
          terminal.rows,
        );
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    void window.artemis
      .openTerminal({
        threadId,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then((descriptor) => {
        if (disposed) {
          return window.artemis.closeTerminal(descriptor.terminalId);
        }
        terminalId = descriptor.terminalId;
        setDetail(`${descriptor.shell} · ${descriptor.sandboxImplementation}`);
        setState("ready");
        terminal.focus();
      })
      .catch((error) => {
        setDetail(error instanceof Error ? error.message : String(error));
        setState("error");
      });

    return () => {
      disposed = true;
      observer.disconnect();
      dataSubscription();
      exitSubscription();
      inputSubscription.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (terminalId) {
        void window.artemis.closeTerminal(terminalId);
      }
    };
  }, [emptyMessage, threadId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const terminal = terminalRef.current;
      const element = host.current;
      if (terminal && element) {
        terminal.options.theme = resolveTerminalElementTheme(
          element,
          theme,
          media.matches,
        );
      }
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributeFilter: [
        "data-artemis-contrast",
        "data-artemis-skin",
        "data-artemis-theme",
        "data-theme",
      ],
      attributes: true,
    });
    if (theme === "system") media.addEventListener("change", applyTheme);
    return () => {
      observer.disconnect();
      if (theme === "system") media.removeEventListener("change", applyTheme);
    };
  }, [theme]);

  return (
    <TerminalSurface
      busy={state === "connecting"}
      className="terminal-panel"
      label={title}
      state={state}
    >
      <TerminalHeader
        className="terminal-header"
        detail={detail}
        heading={title}
      />
      <TerminalViewport className="terminal-body">
        <TerminalHost className="terminal-host" ref={host} />
        {(state === "connecting" || state === "empty" || state === "error") && (
          <TerminalState state={state}>{detail}</TerminalState>
        )}
      </TerminalViewport>
    </TerminalSurface>
  );
}
