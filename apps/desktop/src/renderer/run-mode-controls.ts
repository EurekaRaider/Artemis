import type { RunMode } from "@artemis/protocol";

export const RUN_MODE_ORDER = ["plan", "execute", "review"] as const;

export type ParsedRunModeCommand =
  | { kind: "command"; mode: RunMode; prompt: string }
  | { kind: "multiple"; modes: RunMode[] };

const RUN_MODE_COMMAND_PATTERN = /(?<!\S)\/(plan|execute|review)(?!\S)/giu;

export function parseRunModeCommand(
  prompt: string,
): ParsedRunModeCommand | undefined {
  const matches = [...prompt.matchAll(RUN_MODE_COMMAND_PATTERN)];
  if (matches.length === 0) return undefined;

  const modes = matches.map(
    (match) => match[1]!.toLocaleLowerCase() as RunMode,
  );
  if (modes.length > 1) return { kind: "multiple", modes };

  const match = matches[0]!;
  const start = match.index;
  const withoutCommand = `${prompt.slice(0, start)}${prompt.slice(start + match[0].length)}`;
  return {
    kind: "command",
    mode: modes[0]!,
    prompt: withoutCommand
      .replace(/[ \t]{2,}/gu, " ")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n[ \t]+/gu, "\n")
      .trim(),
  };
}

export function nextRunMode(mode: RunMode): RunMode {
  const currentIndex = RUN_MODE_ORDER.indexOf(mode);
  return RUN_MODE_ORDER[(currentIndex + 1) % RUN_MODE_ORDER.length]!;
}
