import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export interface ImShellRuntime {
  node?: string;
  npm?: string;
  readFiles: string[];
  readDirectories: string[];
  writableDirectory: string;
  env: Record<string, string>;
  dispose(): Promise<void>;
}

/** Resolve host-installed tools without importing the host's shell or credentials. */
export async function prepareImShellRuntime(): Promise<ImShellRuntime> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "artemis-im-runtime-")),
  );
  const bin = join(root, "bin"),
    cache = join(root, "cache");
  const runtime: ImShellRuntime = {
    readFiles: [],
    readDirectories: [bin],
    writableDirectory: cache,
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: cache,
      TMPDIR: cache,
      npm_config_cache: join(cache, "npm"),
      npm_config_userconfig: join(bin, "user.config"),
      npm_config_globalconfig: join(bin, "global.config"),
      npm_config_update_notifier: "false",
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
  try {
    await mkdir(bin);
    await mkdir(cache);
    await writeFile(join(bin, "user.config"), "", { mode: 0o400 });
    await writeFile(join(bin, "global.config"), "", { mode: 0o400 });
    const find = async (name: string) => {
      for (const directory of (process.env.PATH ?? "").split(":")) {
        if (!isAbsolute(directory)) continue;
        try {
          const file = await realpath(join(directory, name));
          await access(file, constants.X_OK);
          return file;
        } catch {
          /* Keep looking for an installed executable. */
        }
      }
      return undefined;
    };
    const node = await find("node");
    if (!node) return runtime;
    const files = new Set<string>();
    const inspect = async (file: string): Promise<void> => {
      if (
        files.has(file) ||
        file.startsWith("/usr/lib/") ||
        file.startsWith("/System/")
      )
        return;
      if (files.size >= 64)
        throw new Error("Node runtime has too many native dependencies.");
      files.add(file);
      const { stdout } = await exec("/usr/bin/otool", ["-L", file], {
        timeout: 5000,
        maxBuffer: 65536,
      });
      for (const line of stdout.split("\n").slice(1)) {
        const dependency = line.trim().split(" (", 1)[0]!;
        if (
          !dependency ||
          dependency.startsWith("/usr/lib/") ||
          dependency.startsWith("/System/")
        )
          continue;
        const path = dependency.startsWith("@loader_path/")
          ? join(dirname(file), dependency.slice(13))
          : dependency;
        if (!isAbsolute(path))
          throw new Error(
            "Node runtime uses an unsupported library search path.",
          );
        await inspect(await realpath(path));
      }
    };
    await inspect(node);
    runtime.node = node;
    runtime.readFiles = [...files];
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      join(bin, "node"),
      `#!/bin/sh\nexec ${quote(node)} "$@"\n`,
      { mode: 0o500 },
    );
    const npm = await find("npm");
    if (npm) {
      const directory = dirname(dirname(npm));
      const metadata = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (
        metadata.name === "npm" &&
        npm === join(directory, "bin", "npm-cli.js")
      ) {
        runtime.npm = npm;
        runtime.readDirectories.push(directory);
        await writeFile(
          join(bin, "npm"),
          `#!/bin/sh\nexec ${quote(node)} ${quote(npm)} "$@"\n`,
          { mode: 0o500 },
        );
      }
    }
    return runtime;
  } catch {
    delete runtime.node;
    delete runtime.npm;
    runtime.readFiles = [];
    runtime.readDirectories = [bin];
    await rm(join(bin, "node"), { force: true });
    await rm(join(bin, "npm"), { force: true });
    return runtime;
  }
}
