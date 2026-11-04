import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function desktopCommandEnvironment(): NodeJS.ProcessEnv {
  if (process.platform === "win32") return { ...process.env };
  const entries = [
    ...(process.env.PATH?.split(delimiter) ?? []),
    join(homedir(), ".local", "bin"),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  return {
    ...process.env,
    PATH: [...new Set(entries)].join(delimiter),
  };
}
