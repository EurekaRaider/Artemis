import { execFileSync } from "node:child_process";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  macOfficeRuntimeSourceFilter,
  macOfficeSigningTargets,
  macOfficeIsMachO,
} from "./macos-release-layout.mjs";

it("excludes optional script helpers without removing the engine or bridge", () => {
  for (const helper of ["senddoc", "unoinfo"])
    expect(
      macOfficeRuntimeSourceFilter(
        join("LibreOffice.app", "Contents", "MacOS", helper),
      ),
    ).toBe(false);
  for (const executable of ["soffice", "office-bridge", "unopkg", "gengal"])
    expect(
      macOfficeRuntimeSourceFilter(
        join("LibreOffice.app", "Contents", "MacOS", executable),
      ),
    ).toBe(true);
  expect(
    macOfficeRuntimeSourceFilter(
      "LibreOffice.app/Contents/Resources/readme.txt",
    ),
  ).toBe(true);
  expect(
    macOfficeRuntimeSourceFilter(
      "LibreOffice.app/Contents/_CodeSignature/CodeResources",
    ),
  ).toBe(false);
  for (const directory of ["Frameworks", join("MacOS", "urelibs")])
    expect(
      macOfficeRuntimeSourceFilter(
        join("LibreOffice.app", "Contents", directory, "intl", "fbintl.conf"),
      ),
    ).toBe(false);
  expect(
    macOfficeRuntimeSourceFilter(
      "LibreOffice.app/Contents/Resources/intl/fbintl.conf",
    ),
  ).toBe(true);
});

it("signs every helper and nested bundle before the containing application", () => {
  const app = join("payload", "ArtemisOfficeRuntime.app");
  const main = join(app, "Contents", "MacOS", "soffice");
  const helper = join(app, "Contents", "MacOS", "office-bridge");
  const bundle = join(app, "Contents", "Frameworks", "engine.framework");
  expect(macOfficeSigningTargets([main, helper], [bundle], app)).toEqual([
    helper,
    bundle,
    app,
  ]);
});

it.skipIf(process.platform !== "darwin")(
  "distinguishes Java resources from real thin and universal Mach-O files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "office-macho-format-"));
    try {
      const java = join(root, "JREProperties.class");
      const javaHeader = Buffer.from("cafebabe00000034", "hex");
      await writeFile(java, javaHeader);
      expect(macOfficeIsMachO(java, javaHeader.subarray(0, 4))).toBe(false);
      // Use real system code without making a format regression wait for clang.
      const arches = execFileSync(
        "/usr/bin/lipo",
        ["/usr/bin/true", "-archs"],
        {
          encoding: "utf8",
        },
      )
        .trim()
        .split(/\s+/u)
        .filter((arch) => arch === "x86_64" || /^arm64e?$/u.test(arch));
      expect(arches).toHaveLength(2);
      for (const arch of arches) {
        const executable = join(root, arch);
        execFileSync("/usr/bin/lipo", [
          "/usr/bin/true",
          "-thin",
          arch,
          "-output",
          executable,
        ]);
        expect(
          macOfficeIsMachO(
            executable,
            (await readFile(executable)).subarray(0, 4),
          ),
        ).toBe(true);
      }
      const universal = join(root, "universal");
      execFileSync("/usr/bin/lipo", [
        "-create",
        ...arches.map((arch) => join(root, arch)),
        "-output",
        universal,
      ]);
      expect(
        macOfficeIsMachO(universal, (await readFile(universal)).subarray(0, 4)),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "darwin")(
  "retains strict bundle signatures through the plain production ZIP layout",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "office-signing-layout-"));
    const source = join(root, "source.app");
    const app = join(root, "payload", "ArtemisOfficeRuntime.app");
    try {
      await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
      await mkdir(join(source, "Contents", "Resources"), { recursive: true });
      for (const directory of ["Frameworks", join("MacOS", "urelibs")]) {
        const intl = join(source, "Contents", directory, "intl");
        await mkdir(intl, { recursive: true });
        await writeFile(
          join(intl, "fbintl.conf"),
          "optional database charset configuration\n",
        );
      }
      await writeFile(
        join(source, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.artemis.test.office-layout</string><key>CFBundleExecutable</key><string>soffice</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
      );
      for (const executable of ["soffice", "office-bridge"])
        await copyFile(
          "/usr/bin/true",
          join(source, "Contents", "MacOS", executable),
        );
      for (const helper of ["senddoc", "unoinfo"])
        await writeFile(
          join(source, "Contents", "MacOS", helper),
          "#!/bin/sh\nexit 0\n",
          { mode: 0o755 },
        );
      await writeFile(
        join(source, "Contents", "Resources", "readme.txt"),
        "sealed resource",
      );
      await cp(source, app, {
        recursive: true,
        filter: macOfficeRuntimeSourceFilter,
      });
      const main = join(app, "Contents", "MacOS", "soffice");
      const helper = join(app, "Contents", "MacOS", "office-bridge");
      for (const target of macOfficeSigningTargets([main, helper], [], app))
        execFileSync("/usr/bin/codesign", [
          "--force",
          "--sign",
          "-",
          "--options",
          "runtime",
          target,
        ]);
      execFileSync("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        app,
      ]);
      const extracted = join(root, "extracted");
      execFileSync("python3", [
        "-c",
        "import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED,allowZip64=False) as z:\n for p in sorted(root.rglob('*')):\n  if p.is_file(): z.write(p,p.relative_to(root).as_posix())\nwith zipfile.ZipFile(sys.argv[2]) as z: z.extractall(sys.argv[3])",
        join(root, "payload"),
        join(root, "pack.zip"),
        extracted,
      ]);
      execFileSync("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        join(extracted, "ArtemisOfficeRuntime.app"),
      ]);
      expect(
        await readFile(
          join(
            extracted,
            "ArtemisOfficeRuntime.app",
            "Contents",
            "Resources",
            "readme.txt",
          ),
          "utf8",
        ),
      ).toBe("sealed resource");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
