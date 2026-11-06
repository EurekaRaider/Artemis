import { join } from "node:path";

export function posixDesktopPath(
  platform: NodeJS.Platform,
  homePath: string,
  inheritedPath: string | undefined,
): string {
  const entries = [
    ...(inheritedPath?.split(":") ?? []),
    join(homePath, ".local", "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(Boolean);
  return [...new Set(entries)].join(":");
}

export function inheritedEnvironment(names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return typeof value === "string" ? [[name, value]] : [];
    }),
  );
}

export function stdioBaseEnvironment(
  platform: NodeJS.Platform,
  fullAccess: boolean,
): Record<string, string> {
  if (fullAccess) {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  return inheritedEnvironment(
    platform === "win32"
      ? [
          "SystemRoot",
          "WINDIR",
          "ComSpec",
          "PATHEXT",
          "PATH",
          "Path",
          "LANG",
          "LC_ALL",
          "LC_CTYPE",
        ]
      : ["LANG", "LC_ALL", "LC_CTYPE"],
  );
}

export function setEnvironmentDefault(
  environment: Record<string, string>,
  name: string,
  value: string,
): void {
  if (
    !Object.keys(environment).some(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    )
  ) {
    environment[name] = value;
  }
}
