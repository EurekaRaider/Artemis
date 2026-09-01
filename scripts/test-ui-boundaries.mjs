import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileMatcher } from "app-builder-lib/out/fileMatcher.js";
import { expandMacro } from "app-builder-lib/out/util/macroExpander.js";
import { resolveConfig } from "vite";
import { htmlInlineResources } from "./verify-ui-boundaries.mjs";

const checker = fileURLToPath(
  new URL("./verify-ui-boundaries.mjs", import.meta.url),
);
const themeContractConfig = fileURLToPath(
  new URL("../packages/theme-contract/tsconfig.json", import.meta.url),
);
const typeScriptCompiler = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
let acceptedCases = 0;
let rejectedCases = 0;
const desktopFixtureSource = "apps/desktop/src/renderer/index.ts";
const executableScriptTypes = [
  undefined,
  "  ",
  " MODULE ",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
  " Text/JavaScript ; Charset=UTF-8 ",
];
const galleryAliasConfig = {
  "apps/desktop/tsconfig.json": {
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      paths: { "@gallery/*": ["../../apps/ui-gallery/src/*"] },
      target: "ES2024",
    },
    include: ["src/**/*.ts"],
  },
};
const inheritedSafeAliasConfig = {
  "tsconfig.paths.json": {
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      paths: { "@safe/*": ["./apps/desktop/src/*"] },
      target: "ES2024",
    },
  },
  "apps/desktop/tsconfig.json": {
    extends: "../../tsconfig.paths.json",
    include: ["src/**/*.ts"],
  },
};
const inheritedGalleryAliasConfig = {
  "tsconfig.paths.json": {
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      paths: { "@gallery/*": ["./apps/ui-gallery/src/*"] },
      target: "ES2024",
    },
  },
  "apps/desktop/tsconfig.json": {
    extends: "../../tsconfig.paths.json",
    include: ["src/**/*.ts"],
  },
};

async function fixture(sourcePath, source, manifestOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "artemis-ui-boundary-"));
  const manifests = {
    "package.json": { name: "artemis", version: "1.4.45" },
    "packages/theme-contract/package.json": {
      name: "@artemis/theme-contract",
      private: true,
    },
    "packages/ui/package.json": {
      name: "@artemis/ui",
      private: true,
      peerDependencies: { react: ">=19 <20", "react-dom": ">=19 <20" },
    },
    "packages/theme-artemis/package.json": {
      name: "@artemis/theme-artemis",
      private: true,
      dependencies: { "@artemis/theme-contract": "1.4.45" },
    },
    "apps/ui-gallery/package.json": {
      name: "@artemis/ui-gallery",
      private: true,
    },
    "apps/desktop/package.json": { name: "@artemis/desktop", dependencies: {} },
    "apps/desktop/tsconfig.json": {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        target: "ES2024",
      },
      include: ["src/**/*.ts"],
    },
    ...manifestOverrides,
  };
  for (const [path, value] of Object.entries(manifests)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), JSON.stringify(value), "utf8");
  }
  for (const path of [
    "packages/theme-contract/src/index.ts",
    "packages/ui/src/index.ts",
    "packages/theme-artemis/src/index.ts",
    "apps/ui-gallery/src/index.ts",
    "apps/desktop/src/index.ts",
    "apps/desktop/src/safe.ts",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "export {};\n", "utf8");
  }
  await writeFile(
    join(root, "apps/desktop/vite.config.ts"),
    "export default {};\n",
    "utf8",
  );
  await writeFile(
    join(root, "apps/desktop/index.html"),
    '<!doctype html><html><body><script type="module" src="/src/index.ts"></script></body></html>',
    "utf8",
  );
  if (sourcePath !== undefined) {
    await mkdir(join(root, sourcePath, ".."), { recursive: true });
    await writeFile(join(root, sourcePath), source, "utf8");
  }
  return root;
}

async function runCase(
  name,
  sourcePath,
  source,
  expectedSuccess,
  manifestOverrides,
  typecheckDesktop = false,
  prepare,
) {
  const root = await fixture(sourcePath, source, manifestOverrides);
  try {
    await prepare?.(root);
    if (typecheckDesktop) {
      const typecheck = spawnSync(
        process.execPath,
        [typeScriptCompiler, "-p", join(root, "apps/desktop/tsconfig.json")],
        { encoding: "utf8" },
      );
      if (typecheck.status !== 0) {
        throw new Error(
          `${name}: expected Desktop fixture typecheck success, exit=${String(typecheck.status)}\n${typecheck.stdout}${typecheck.stderr}`,
        );
      }
    }
    const result = spawnSync(process.execPath, [checker, "--root", root], {
      encoding: "utf8",
    });
    const succeeded = result.status === 0;
    if (succeeded !== expectedSuccess) {
      throw new Error(
        `${name}: expected success=${expectedSuccess}, exit=${String(result.status)}\n${result.stdout}${result.stderr}`,
      );
    }
    if (expectedSuccess) acceptedCases += 1;
    else rejectedCases += 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertViteOracle(root, inlineConfig, expected) {
  const previousDirectory = process.cwd();
  try {
    process.chdir(join(root, "apps/desktop"));
    const resolved = await resolveConfig(
      { ...inlineConfig, configFile: false },
      "build",
      "production",
      "production",
      false,
    );
    for (const [name, value] of Object.entries(expected)) {
      const actual = name === "outDir" ? resolved.build.outDir : resolved[name];
      if (actual !== value) {
        throw new Error(
          `Vite oracle ${name}: expected ${value}, received ${String(actual)}`,
        );
      }
    }
  } finally {
    process.chdir(previousDirectory);
  }
}

function assertFileMatcherOracle(base, candidate, patterns, expected) {
  const matcher = new FileMatcher(
    base,
    join(base, "out"),
    (value) => value,
    patterns,
  );
  if (matcher.isEmpty() || matcher.containsOnlyIgnore()) {
    matcher.prependPattern("**/*");
  }
  const actual = matcher.createFilter()(candidate, {
    isDirectory: () => false,
  });
  if (actual !== expected) {
    throw new Error(
      `electron-builder FileMatcher oracle expected ${String(expected)}, received ${String(actual)} for ${patterns.join(", ")}`,
    );
  }
}

function assertUnsupportedBuilderMacroOracle(pattern) {
  let rejected = false;
  try {
    expandMacro(pattern, "x64", {});
  } catch (error) {
    rejected = String(error).includes("macro");
  }
  if (!rejected) {
    throw new Error(
      `electron-builder expandMacro oracle unexpectedly accepted ${pattern}`,
    );
  }
}

async function runThemeContractTypeCase(name, source, missingGlobal) {
  const root = await mkdtemp(join(tmpdir(), "artemis-theme-contract-types-"));
  try {
    const configPath = join(root, "tsconfig.json");
    await writeFile(join(root, "index.ts"), source, "utf8");
    await writeFile(
      configPath,
      JSON.stringify({
        extends: themeContractConfig,
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          noEmit: true,
          rootDir: ".",
        },
        files: ["index.ts"],
        include: [],
      }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [typeScriptCompiler, "-p", configPath],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;
    if (missingGlobal === undefined) {
      if (result.status !== 0) {
        throw new Error(
          `${name}: expected source-only typecheck success, exit=${String(result.status)}\n${output}`,
        );
      }
      acceptedCases += 1;
      return;
    }
    if (
      result.status === 0 ||
      !output.includes(`Cannot find name '${missingGlobal}'`)
    ) {
      throw new Error(
        `${name}: expected ${missingGlobal} to be unavailable, exit=${String(result.status)}\n${output}`,
      );
    }
    rejectedCases += 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runCase(
  "safe public import",
  "apps/ui-gallery/src/index.ts",
  'import "@artemis/ui/styles.css";\n',
  true,
);
await runCase(
  "safe comments strings and property names",
  "packages/ui/src/index.ts",
  'const text = "process window Buffer HTMLElement";\n// process window Buffer\nconst value = { process: text, window: text };\nvoid value.process;\nvoid value.window;\n',
  true,
);
await runCase(
  "safe CSS comments and strings",
  "packages/ui/src/safe.css",
  '/* @import "ignored.css"; */\n@import2 ignored;\n:root { --example: "@import"; }\n',
  true,
);
await runCase(
  "safe exact extension loader",
  "apps/desktop/src/extension/extension-worker.ts",
  'import { dirname, resolve } from "node:path";\nimport { fileURLToPath, pathToFileURL } from "node:url";\nconst piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));\nconst loaderUrl = pathToFileURL(resolve(dirname(piEntry), "core", "extensions", "loader.js")).href;\nvoid import(loaderUrl);\n',
  true,
);
await runCase(
  "safe inherited non-Gallery alias",
  desktopFixtureSource,
  'import "@safe/safe";\n',
  true,
  inheritedSafeAliasConfig,
  true,
);
await runCase(
  "safe Desktop CSS local resources",
  "apps/desktop/src/renderer/safe.css",
  '@import "./base.css";\n.safe { background-image: url("./icon.png"); }\n',
  true,
);
await runCase(
  "safe Desktop CSS image-set resources",
  "apps/desktop/src/renderer/safe.css",
  '.safe { background-image: image-set("./icon.png" 1x, url("./icon@2x.png") 2x); }\n.safe-webkit { background-image: -webkit-image-set("./icon.png" 1x); }\n',
  true,
);
await runCase(
  "safe Desktop HTML entry",
  "apps/desktop/index.html",
  '<!doctype html><html><head><title>ui-gallery is only text</title></head><body><script type="module" src="/src/index.ts"></script></body></html>',
  true,
);
await runCase(
  "safe Desktop HTML Gallery-like prose",
  "apps/desktop/index.html",
  '<!doctype html><p>Example: import("../ui-gallery/src/main.tsx")</p><script>const example = "import(\\\"../ui-gallery/src/main.tsx\\\")";</script><style>.example::after { content: "@import ../ui-gallery/src/gallery.css"; }</style>',
  true,
);
await runCase(
  "safe Desktop HTML non-executable data script",
  "apps/desktop/index.html",
  '<!doctype html><script type=" Application/JSON ; Charset=UTF-8 ">{"example":"import(\\"../ui-gallery/src/main.tsx\\")"}</script>',
  true,
);
await runCase(
  "safe Desktop Vite config string",
  "apps/desktop/vite.config.ts",
  'const label = "ui-gallery is only text";\nexport default { label };\n',
  true,
);
await runCase(
  "safe Desktop Vite const paths",
  "apps/desktop/vite.config.ts",
  'import { resolve } from "node:path";\nconst publicDir = "assets";\nconst page = "index.html";\nconst input = resolve(import.meta.dirname, page);\nexport default { publicDir, build: { rollupOptions: { input } } };\n',
  true,
);
await runCase(
  "safe Desktop Vite root-relative publicDir",
  "apps/desktop/vite.config.ts",
  'export default { root: "src", publicDir: "public" };\n',
  true,
  undefined,
  false,
  async (root) => {
    const canonicalRoot = await realpath(root);
    await assertViteOracle(
      root,
      { root: "src", publicDir: "public" },
      {
        publicDir: join(canonicalRoot, "apps/desktop/src/public"),
        root: join(canonicalRoot, "apps/desktop/src"),
      },
    );
  },
);
await runCase(
  "safe Desktop Vite alias replacement",
  "apps/desktop/vite.config.ts",
  'import { resolve } from "node:path";\nexport default { resolve: { alias: { "@desktop": resolve(import.meta.dirname, "src") } } };\n',
  true,
);
await runCase(
  "safe Desktop builder string shorthand",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { files: "dist/**/*" },
    },
  },
);
await runCase(
  "safe Desktop builder single FileSet",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: { from: "resources", filter: "**/*" } },
    },
  },
);
await runCase(
  "safe Desktop builder FileSet array",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraFiles: [
          { from: "resources", to: "resources", filter: ["**/*", "!tmp/**"] },
        ],
      },
    },
  },
);
await runCase(
  "safe Desktop builder platform levels",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        mac: { files: "dist/**/*" },
        mas: { extraResources: { from: "resources" } },
        masDev: { extraFiles: ["resources"] },
        win: { asarUnpack: "node_modules/node-pty/**" },
        linux: { files: [{ from: "dist", filter: "**/*" }] },
      },
    },
  },
);
await runCase(
  "safe Desktop builder official file macros",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraResources: [
          "native/${os}/${arch}.bin",
          "metadata/${platform}/${name}/${productName}/${version}/${buildVersion}/${buildNumber}/${channel}.json",
        ],
      },
    },
  },
);
await runCase(
  "safe Desktop builder exclusion filters",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraFiles: {
          from: "resources",
          filter: ["**/*", "!../ui-gallery/**", "!tmp/**"],
        },
      },
    },
  },
);
await runCase(
  "safe Desktop builder parent source excludes Gallery",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraResources: {
          from: "..",
          filter: ["**/*", "!ui-gallery/**"],
        },
      },
    },
  },
  false,
  async (root) => {
    assertFileMatcherOracle(
      join(root, "apps"),
      join(root, "apps/ui-gallery/src/index.ts"),
      ["**/*", "!ui-gallery/**"],
      false,
    );
  },
);
await runCase(
  "safe Desktop builder literal appDir",
  undefined,
  undefined,
  true,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { directories: { app: "app" } },
    },
  },
  false,
  async (root) => {
    await mkdir(join(root, "apps/desktop/app"), { recursive: true });
  },
);
await runCase(
  "static forbidden import",
  "packages/theme-contract/src/index.ts",
  'export { reducer } from "@artemis/protocol";\n',
  false,
);
await runCase(
  "dynamic forbidden import",
  "packages/theme-artemis/src/index.ts",
  'void import("@artemis/platform");\n',
  false,
);
await runCase(
  "comment-gap dynamic forbidden import",
  "packages/theme-artemis/src/index.ts",
  'void import/*gap*/("@artemis/protocol");\n',
  false,
);
await runCase(
  "require bypass",
  "packages/ui/src/index.ts",
  'const host = require("@artemis/agent-host");\n',
  false,
);
await runCase(
  "import-equals bypass",
  "packages/ui/src/index.ts",
  'import host = require("@artemis/agent-host");\n',
  false,
);
await runCase(
  "window bracket bridge",
  "packages/ui/src/index.ts",
  'void window["artemis"];\n',
  false,
);
await runCase(
  "globalThis bracket bridge",
  "packages/ui/src/index.ts",
  'void globalThis["artemis"];\n',
  false,
);
await runCase(
  "globalThis.window bridge",
  "packages/ui/src/index.ts",
  "void globalThis.window.artemis;\n",
  false,
);
await runCase(
  "self bridge",
  "packages/ui/src/index.ts",
  'void self["artemis"];\n',
  false,
);
await runCase(
  "asserted parenthesized bridge",
  "packages/ui/src/index.ts",
  'void (((window as any)))["artemis"];\n',
  false,
);
await runCase(
  "bridge destructuring",
  "packages/ui/src/index.ts",
  "const { artemis } = window as any;\nvoid artemis;\n",
  false,
);
await runCase(
  "renamed bridge destructuring",
  "packages/ui/src/index.ts",
  "const { artemis: bridge } = globalThis.window as any;\nvoid bridge;\n",
  false,
);
await runCase(
  "computed bridge destructuring",
  "packages/ui/src/index.ts",
  'const { ["artemis"]: artemis } = window as any;\nvoid artemis;\n',
  false,
);
await runCase(
  "renamed computed bridge destructuring",
  "packages/ui/src/index.ts",
  "const { [`artemis`]: bridge } = globalThis.window as any;\nvoid bridge;\n",
  false,
);
await runCase(
  "globalThis process member",
  "packages/ui/src/index.ts",
  "void (globalThis as any).process;\n",
  false,
);
await runCase(
  "globalThis Buffer member",
  "packages/ui/src/index.ts",
  'void globalThis["Buffer"];\n',
  false,
);
await runCase(
  "true Node global",
  "packages/ui/src/index.ts",
  "void process.cwd();\n",
  false,
);
await runCase(
  "true CSS import",
  "packages/ui/src/unsafe.css",
  '@import "forbidden.css";\n',
  false,
);
await runCase(
  "Gallery private source traversal",
  "apps/ui-gallery/src/index.ts",
  'import "../../../packages/ui/src/index.js";\n',
  false,
);
await runCase(
  "Gallery alias bypass",
  "apps/ui-gallery/src/index.ts",
  'import app from "@desktop/renderer";\n',
  false,
);
await runCase("public UI package", undefined, undefined, false, {
  "packages/ui/package.json": {
    name: "@artemis/ui",
    private: false,
    peerDependencies: { react: ">=19 <20", "react-dom": ">=19 <20" },
  },
});
await runCase(
  "workspace dependency version drift",
  undefined,
  undefined,
  false,
  {
    "package.json": { name: "artemis", version: "1.4.42" },
  },
);
await runCase(
  "Desktop bare Gallery static import",
  desktopFixtureSource,
  'import "@artemis/ui-gallery";\n',
  false,
);
await runCase(
  "Desktop bare Gallery dynamic import",
  desktopFixtureSource,
  'void import("@artemis/ui-gallery");\n',
  false,
);
await runCase(
  "Desktop bare Gallery require",
  desktopFixtureSource,
  'void require("@artemis/ui-gallery");\n',
  false,
);
await runCase(
  "Desktop test-only UI conformance static import",
  desktopFixtureSource,
  'import "@artemis/ui/conformance";\n',
  false,
);
await runCase(
  "Desktop test-only UI conformance export",
  desktopFixtureSource,
  'export { ConformanceProbe } from "@artemis/ui/conformance";\n',
  false,
);
await runCase(
  "Desktop test-only UI conformance dynamic import",
  desktopFixtureSource,
  'void import("@artemis/ui/conformance");\n',
  false,
);
await runCase(
  "Desktop test-only UI conformance require",
  desktopFixtureSource,
  'void require("@artemis/ui/conformance");\n',
  false,
);
await runCase(
  "Desktop Gallery alias static import",
  desktopFixtureSource,
  'import "@gallery/index";\n',
  false,
  galleryAliasConfig,
);
await runCase(
  "Desktop Gallery alias dynamic import",
  desktopFixtureSource,
  'void import("@gallery/index");\n',
  false,
  galleryAliasConfig,
);
await runCase(
  "Desktop Gallery alias require",
  desktopFixtureSource,
  'void require("@gallery/index");\n',
  false,
  galleryAliasConfig,
);
await runCase(
  "Desktop relative Gallery static import",
  desktopFixtureSource,
  'import "../../../ui-gallery/src/index";\n',
  false,
);
await runCase(
  "Desktop relative Gallery dynamic import",
  desktopFixtureSource,
  'void import("../../../ui-gallery/src/index");\n',
  false,
);
await runCase(
  "Desktop relative Gallery require",
  desktopFixtureSource,
  'const gallery = require("../../../ui-gallery/src/index");\nvoid gallery;\n',
  false,
);
await runCase(
  "Desktop computed relative Gallery import",
  desktopFixtureSource,
  'const page = "index";\nvoid import(`../../../ui-gallery/src/${page}.js`);\n',
  false,
);
await runCase(
  "Desktop spoofed trusted loader",
  "apps/desktop/src/extension/extension-worker.ts",
  'const loaderUrl = "../../../ui-gallery/src/index.js";\nvoid import(loaderUrl);\n',
  false,
);
await runCase(
  "Desktop inherited Gallery alias",
  desktopFixtureSource,
  'import "@gallery/index";\n',
  false,
  inheritedGalleryAliasConfig,
  true,
);
await runCase(
  "Desktop CSS imports Gallery",
  "apps/desktop/src/renderer/unsafe.css",
  '@import "../../../ui-gallery/src/gallery.css";\n',
  false,
);
await runCase(
  "Desktop CSS URL references Gallery",
  "apps/desktop/src/renderer/unsafe.css",
  '.unsafe { background: url("../../../ui-gallery/index.html"); }\n',
  false,
);
await runCase(
  "Desktop CSS image-set string references Gallery",
  "apps/desktop/src/renderer/unsafe.css",
  '.unsafe { background-image: image-set("../../../ui-gallery/index.html" 1x); }\n',
  false,
);
await runCase(
  "Desktop CSS webkit image-set string references Gallery",
  "apps/desktop/src/renderer/unsafe.css",
  '.unsafe { background-image: -webkit-image-set("../../../ui-gallery/index.html" 1x); }\n',
  false,
);
await runCase(
  "Desktop HTML src references Gallery",
  "apps/desktop/index.html",
  '<!doctype html><script src="../ui-gallery/src/main.tsx"></script>',
  false,
);
await runCase(
  "Desktop HTML href references Gallery",
  "apps/desktop/index.html",
  '<!doctype html><link rel="stylesheet" href="../ui-gallery/src/gallery.css">',
  false,
);
await runCase(
  "Desktop HTML srcset references Gallery",
  "apps/desktop/index.html",
  '<!doctype html><img alt="" srcset="../ui-gallery/index.html 1x, ./safe.png 2x">',
  false,
);
for (const type of executableScriptTypes) {
  const typeAttribute =
    type === undefined ? "" : ` type=${JSON.stringify(type)}`;
  const html = `<!doctype html><script${typeAttribute}>import("../ui-gallery/src/main.tsx")</script>`;
  const inline = htmlInlineResources(html, "/fixture/apps/desktop/index.html");
  if (
    inline.scripts.length !== 1 ||
    inline.scripts[0]?.references[0] !== "../ui-gallery/src/main.tsx"
  ) {
    throw new Error(
      `Executable script MIME was not parsed: ${type ?? "<missing>"}`,
    );
  }
  await runCase(
    `Desktop HTML executable script MIME ${type ?? "<missing>"} imports Gallery`,
    "apps/desktop/index.html",
    html,
    false,
  );
}
await runCase(
  "Desktop HTML inline static module imports Gallery",
  "apps/desktop/index.html",
  '<!doctype html><script type="module">import "../ui-gallery/src/main.tsx"</script>',
  false,
);
await runCase(
  "Desktop HTML inline script requires Gallery",
  "apps/desktop/index.html",
  '<!doctype html><script>require("../ui-gallery/src/main.tsx")</script>',
  false,
);
await runCase(
  "Desktop HTML inline script imports test-only UI conformance",
  "apps/desktop/index.html",
  '<!doctype html><script type="module">import "@artemis/ui/conformance"</script>',
  false,
);
await runCase(
  "Desktop HTML inline style imports Gallery",
  "apps/desktop/index.html",
  '<!doctype html><style>@import "../ui-gallery/src/gallery.css";</style>',
  false,
);
await runCase(
  "Desktop HTML style attribute references Gallery",
  "apps/desktop/index.html",
  '<!doctype html><div style="background:url(../ui-gallery/src/gallery.css)"></div>',
  false,
);
await runCase(
  "Desktop mts imports Gallery",
  "apps/desktop/src/renderer/unsafe.mts",
  'import "../../../ui-gallery/src/index";\n',
  false,
);
await runCase(
  "Desktop cts imports test-only UI conformance",
  "apps/desktop/src/renderer/unsafe.cts",
  'require("@artemis/ui/conformance");\n',
  false,
);
await runCase(
  "Desktop cjs imports Gallery",
  "apps/desktop/src/renderer/unsafe.cjs",
  'require("../../../ui-gallery/src/index");\n',
  false,
);
await runCase(
  "Gallery d.mts imports Electron",
  "apps/ui-gallery/src/unsafe.d.mts",
  'import "electron";\n',
  false,
);
await runCase(
  "UI d.cts imports Node",
  "packages/ui/src/unsafe.d.cts",
  'import "node:fs";\n',
  false,
);
await runCase(
  "Desktop Vite config imports Gallery",
  "apps/desktop/vite.config.ts",
  'import gallery from "../ui-gallery/vite.config";\nexport default gallery;\n',
  false,
);
await runCase(
  "Desktop Vite config resolves Gallery path",
  "apps/desktop/vite.config.ts",
  'import { resolve } from "node:path";\nexport default { publicDir: resolve(import.meta.dirname, "../ui-gallery") };\n',
  false,
);
await runCase(
  "Desktop Vite config direct path references Gallery",
  "apps/desktop/vite.config.ts",
  'export default { publicDir: "../ui-gallery" };\n',
  false,
);
await runCase(
  "Desktop Vite const path references Gallery",
  "apps/desktop/vite.config.ts",
  'const publicDir = "../ui-gallery";\nexport default { publicDir };\n',
  false,
);
await runCase(
  "Desktop Vite dynamic path is rejected",
  "apps/desktop/vite.config.ts",
  'const resolvePublic = () => "assets";\nexport default { publicDir: resolvePublic() };\n',
  false,
);
await runCase(
  "Desktop Vite root-relative publicDir references Gallery",
  "apps/desktop/vite.config.ts",
  'export default { root: "src", publicDir: "../../ui-gallery" };\n',
  false,
  undefined,
  false,
  async (root) => {
    const canonicalRoot = await realpath(root);
    await assertViteOracle(
      root,
      { root: "src", publicDir: "../../ui-gallery" },
      {
        publicDir: join(canonicalRoot, "apps/ui-gallery"),
        root: join(canonicalRoot, "apps/desktop/src"),
      },
    );
  },
);
await runCase(
  "Desktop Vite dynamic root is rejected",
  "apps/desktop/vite.config.ts",
  'const selectRoot = () => "src";\nexport default { root: selectRoot(), publicDir: "public" };\n',
  false,
);
await runCase(
  "Desktop Vite duplicate root is rejected",
  "apps/desktop/vite.config.ts",
  'export default { root: "src", root: "safe" };\n',
  false,
);
await runCase(
  "Desktop Vite alias replacement references Gallery",
  "apps/desktop/vite.config.ts",
  'export default { resolve: { alias: { "@gallery": "../ui-gallery" } } };\n',
  false,
);
await runCase(
  "Desktop Vite assetsDir resolves from outDir into Gallery",
  "apps/desktop/vite.config.ts",
  'export default { build: { outDir: "dist", assetsDir: "../../ui-gallery" } };\n',
  false,
);
await runCase(
  "Desktop Vite rollup input resolves from root into Gallery",
  "apps/desktop/vite.config.ts",
  'export default { root: "src", build: { rollupOptions: { input: "../../ui-gallery/index.html" } } };\n',
  false,
);
await runCase("Desktop build includes Gallery", undefined, undefined, false, {
  "apps/desktop/package.json": {
    name: "@artemis/desktop",
    dependencies: {},
    build: { extraResources: [{ from: "../ui-gallery/dist" }] },
  },
});
await runCase(
  "Desktop files string includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { files: "../ui-gallery/**/*" },
    },
  },
);
await runCase(
  "Desktop asarUnpack includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { asarUnpack: "../ui-gallery/**" },
    },
  },
);
await runCase(
  "Desktop extraFiles string includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraFiles: "../ui-gallery" },
    },
  },
);
await runCase(
  "Desktop FileSet filter includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraFiles: [{ from: ".", filter: ["../ui-gallery/**"] }] },
    },
  },
);
await runCase(
  "Desktop builder Gallery prefix before safe macro",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: "../ui-gallery/${arch}.json" },
    },
  },
);
await runCase(
  "Desktop builder dynamic environment macro fails closed",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: "${env.GALLERY_PATH}/payload.json" },
    },
  },
);
await runCase(
  "Desktop builder parent source includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: { from: "..", filter: "**/*" } },
    },
  },
  false,
  async (root) => {
    assertFileMatcherOracle(
      join(root, "apps"),
      join(root, "apps/ui-gallery/src/index.ts"),
      ["**/*"],
      true,
    );
  },
);
await runCase(
  "Desktop builder appDir ancestor includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { directories: { app: ".." } },
    },
  },
);
await runCase(
  "Desktop builder literal macro appDir symlink resolves to Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { directories: { app: "${projectDir}" } },
    },
  },
  false,
  async (root) => {
    await symlink(
      "../ui-gallery",
      join(root, "apps/desktop/${projectDir}"),
      "dir",
    );
  },
);
await runCase(
  "Desktop builder FileSet symlink resolves to Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: { from: "gallery-link", filter: "**/*" } },
    },
  },
  false,
  async (root) => {
    await symlink(
      "../ui-gallery",
      join(root, "apps/desktop/gallery-link"),
      "dir",
    );
  },
);
await runCase(
  "Desktop builder FileSet intermediate symlink resolves to Gallery ancestor",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraResources: { from: "repo-link/apps", filter: "**/*" },
      },
    },
  },
  false,
  async (root) => {
    await symlink(root, join(root, "apps/desktop/repo-link"), "dir");
    const source = join(root, "apps/desktop/repo-link/apps");
    assertFileMatcherOracle(
      source,
      join(source, "ui-gallery/src/index.ts"),
      ["**/*"],
      true,
    );
  },
);
await runCase(
  "Desktop builder projectDir resource macro is unsupported",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: "native/${projectDir}/probe" },
    },
  },
  false,
  () => {
    assertUnsupportedBuilderMacroOracle("native/${projectDir}/probe");
  },
);
await runCase(
  "Desktop builder appDir resource macro is unsupported",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: "native/${appDir}/probe" },
    },
  },
  false,
  () => {
    assertUnsupportedBuilderMacroOracle("native/${appDir}/probe");
  },
);
await runCase(
  "Desktop builder brace pattern includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraResources: {
          from: "..",
          filter: "ui-{gallery,other}/**/*",
        },
      },
    },
  },
  false,
  async (root) => {
    assertFileMatcherOracle(
      join(root, "apps"),
      join(root, "apps/ui-gallery/src/index.ts"),
      ["ui-{gallery,other}/**/*"],
      true,
    );
  },
);
await runCase(
  "Desktop builder character class includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: {
        extraResources: { from: "..", filter: "ui-galler[y]/**/*" },
      },
    },
  },
);
await runCase(
  "Desktop builder actual scoped name macro includes Gallery",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@scope/../ui-gallery",
      version: "1.4.45",
      dependencies: {},
      build: {
        extraResources: { from: "..", filter: "${name}/**/*" },
      },
    },
  },
);
await runCase(
  "Desktop builder Windows os macro uses win",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      version: "1.4.45",
      dependencies: {},
      build: {
        win: {
          extraResources: {
            from: "..",
            filter: "ui-gallery/${os}/probe",
          },
        },
      },
    },
  },
  false,
  async (root) => {
    await mkdir(join(root, "apps/ui-gallery/win"), { recursive: true });
    await writeFile(join(root, "apps/ui-gallery/win/probe"), "win", "utf8");
  },
);
for (const [platform, resources] of [
  ["mac", { extraFiles: "../ui-gallery" }],
  ["mas", { files: { from: "../ui-gallery" } }],
  ["masDev", { extraResources: [{ from: "../ui-gallery" }] }],
  ["win", { asarUnpack: "../ui-gallery/**" }],
  ["linux", { files: "../ui-gallery/**/*" }],
]) {
  await runCase(
    `Desktop ${platform} resources include Gallery`,
    undefined,
    undefined,
    false,
    {
      "apps/desktop/package.json": {
        name: "@artemis/desktop",
        dependencies: {},
        build: { [platform]: resources },
      },
    },
  );
}
await runCase(
  "Desktop builder malformed FileSet fails closed",
  undefined,
  undefined,
  false,
  {
    "apps/desktop/package.json": {
      name: "@artemis/desktop",
      dependencies: {},
      build: { extraResources: { from: 42 } },
    },
  },
);

await runThemeContractTypeCase(
  "theme-contract ES ambient",
  "const values = new Map<string, number>();\nvoid values;\n",
);
await runThemeContractTypeCase(
  "theme-contract DOM ambient",
  "declare const value: Document;\nvoid value;\n",
  "Document",
);
await runThemeContractTypeCase(
  "theme-contract Buffer ambient",
  "void Buffer.from([]);\n",
  "Buffer",
);
await runThemeContractTypeCase(
  "theme-contract process ambient",
  "void process.cwd();\n",
  "process",
);

if (acceptedCases !== 23 || rejectedCases !== 113) {
  throw new Error(
    `Unexpected boundary test count: ${acceptedCases} accepted, ${rejectedCases} rejected`,
  );
}
console.log(
  "UI boundary fixture tests passed (23 safe cases; 113/113 violations rejected)",
);
