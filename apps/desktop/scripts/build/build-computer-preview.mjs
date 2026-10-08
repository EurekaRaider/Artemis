import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function buildComputerPreview(output, arch = process.arch) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const require = createRequire(import.meta.url);
  let windowsHeaders, windowsLibrary;
  if (process.platform === "win32") {
    const electronVersion = require("electron/package.json").version;
    const cache = join(root, "build", "computer-use", "electron-headers");
    execFileSync(
      process.execPath,
      [
        require.resolve("node-gyp/bin/node-gyp.js"),
        "install",
        "--target=" + electronVersion,
        "--dist-url=https://electronjs.org/headers",
        "--devdir=" + cache,
        "--ensure",
      ],
      { stdio: "inherit" },
    );
    windowsHeaders = join(cache, electronVersion, "include", "node");
    windowsLibrary = join(cache, electronVersion, "x64", "node.lib");
  }
  const cache = join(homedir(), "Library", "Caches", "node-gyp");
  const installedHeaders = join(
    dirname(process.execPath),
    "..",
    "include",
    "node",
  );
  const headers =
    process.env.ARTEMIS_NODE_HEADERS ??
    windowsHeaders ??
    (existsSync(join(installedHeaders, "node_api.h"))
      ? installedHeaders
      : undefined) ??
    (existsSync(cache)
      ? readdirSync(cache)
          .reverse()
          .map((version) => join(cache, version, "include", "node"))
          .find((path) => existsSync(join(path, "node_api.h")))
      : undefined);
  if (!headers)
    throw new Error(
      "Set ARTEMIS_NODE_HEADERS to a Node N-API header directory",
    );
  mkdirSync(output, { recursive: true });
  if (process.platform === "darwin") {
    execFileSync(
      "xcrun",
      [
        "clang++",
        "-std=c++20",
        "-fobjc-arc",
        "-O2",
        "-DNAPI_VERSION=8",
        "-arch",
        arch === "x64" ? "x86_64" : arch,
        "-mmacosx-version-min=14.0",
        "-I",
        headers,
        "-bundle",
        "-undefined",
        "dynamic_lookup",
        "-framework",
        "AppKit",
        "-framework",
        "ScreenCaptureKit",
        "-framework",
        "IOSurface",
        "-framework",
        "CoreMedia",
        "-framework",
        "CoreVideo",
        join(root, "native/computer-use/preview/macos.mm"),
        "-o",
        join(output, "artemis-computer-preview.node"),
      ],
      { stdio: "inherit" },
    );
  } else if (process.platform === "win32") {
    const build = join(output, "preview-build");
    execFileSync(
      "cmake",
      [
        "-S",
        join(root, "native/computer-use/windows"),
        "-B",
        build,
        "-A",
        "x64",
        "-DARTEMIS_NODE_DELAY_HOOK=" +
          require.resolve("node-gyp/src/win_delay_load_hook.cc"),
        "-DARTEMIS_NODE_HEADERS=" + headers,
        "-DARTEMIS_NODE_LIBRARY=" +
          (process.env.ARTEMIS_NODE_LIBRARY ?? windowsLibrary),
      ],
      { stdio: "inherit" },
    );
    execFileSync(
      "cmake",
      [
        "--build",
        build,
        "--config",
        "Release",
        "--target",
        "artemis-computer-preview",
      ],
      { stdio: "inherit" },
    );
    copyFileSync(
      join(build, "Release", "artemis-computer-preview.node"),
      join(output, "artemis-computer-preview.node"),
    );
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildComputerPreview(
    process.argv[2] ??
      fileURLToPath(
        new URL("../../build/computer-use/development", import.meta.url),
      ),
  );
}
