// Build tooling only. Node and the SDK are never copied into the capability.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, values) =>
        value.startsWith("--")
          ? [...pairs, [value.slice(2), values[index + 1]]]
          : pairs,
      [],
    ),
);
if (!args.sdk || !args.office || !args.json || !args.out)
  throw new Error(
    "Required: --sdk directory --office executable --json json.hpp --out directory",
  );
const sdk = resolve(args.sdk),
  program = dirname(resolve(args.office)),
  out = resolve(args.out);
const generated = join(out, "generated"),
  include = join(out, "include"),
  mac = process.platform === "darwin";
if (!mac && process.platform !== "win32")
  throw new Error("Only macOS arm64 and Windows x64 are supported");
await mkdir(generated, { recursive: true });
await mkdir(join(include, "nlohmann"), { recursive: true });
await copyFile(resolve(args.json), join(include, "nlohmann", "json.hpp"));
const run = (file, values, options = {}) =>
  execFileSync(file, values, { stdio: "inherit", ...options });
const framework = join(program, "..", "Frameworks");
const libraries = ["sal", "cppu", "cppuhelpergcc3"];
let maker = join(sdk, "bin", mac ? "cppumaker" : "cppumaker.exe");
if (mac) {
  // Relocate only a private SDK build-tool copy, never the installed runtime.
  const relocated = join(out, "cppumaker");
  await copyFile(maker, relocated);
  maker = relocated;
  const changes = ["unoidllo", "uno_salhelpergcc3", "uno_sal"].flatMap(
    (name) => {
      const library = `lib${name}.dylib${name === "unoidllo" ? "" : ".3"}`;
      return [
        "-change",
        `@__VIA_LIBRARY_PATH__/${library}`,
        join(framework, library),
      ];
    },
  );
  run("install_name_tool", [...changes, maker]);
  run("codesign", ["--force", "--sign", "-", maker]);
}
const resources = mac ? join(program, "..", "Resources") : program;
run(
  maker,
  [
    "-Gc",
    `-O${generated}`,
    join(resources, "types", "offapi.rdb"),
    mac
      ? join(resources, "ure", "share", "misc", "types.rdb")
      : join(program, "types.rdb"),
  ],
  {
    env: {
      ...process.env,
      PATH: `${program}${mac ? ":" : ";"}${process.env.PATH ?? ""}`,
    },
  },
);
const source = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/desktop/native/office-bridge/main.cxx",
);
const binary = join(out, mac ? "office-bridge" : "office-bridge.exe");
if (mac) {
  run("clang++", [
    "-std=c++17",
    "-O2",
    "-fPIC",
    "-fno-common",
    "-fvisibility=hidden",
    "-DUNX",
    "-DGCC",
    "-DMACOSX",
    "-DCPPU_ENV=gcc3",
    `-I${join(sdk, "include")}`,
    `-I${generated}`,
    `-I${include}`,
    source,
    ...libraries.map((name) => join(framework, `libuno_${name}.dylib.3`)),
    `-Wl,-rpath,${framework}`,
    "-o",
    binary,
  ]);
  run("install_name_tool", [
    ...libraries.flatMap((name) => [
      "-change",
      `@__________________________________________________URELIB/libuno_${name}.dylib.3`,
      `@rpath/libuno_${name}.dylib.3`,
    ]),
    binary,
  ]);
  run("codesign", ["--force", "--sign", "-", binary]);
} else {
  run("cl.exe", [
    "/nologo",
    "/std:c++17",
    "/O2",
    "/EHsc",
    "/MD",
    "/Zc:wchar_t-",
    "/DWIN32",
    "/DWNT",
    "/D_DLL",
    "/DCPPU_ENV=mscx",
    `/I${join(sdk, "include")}`,
    `/I${generated}`,
    `/I${include}`,
    `/Fo${join(out, "bridge.obj")}`,
    source,
    `/Fe${binary}`,
    "/link",
    `/LIBPATH:${join(sdk, "lib")}`,
    "isal.lib",
    "icppu.lib",
    "icppuhelper.lib",
  ]);
}
console.log(binary);
