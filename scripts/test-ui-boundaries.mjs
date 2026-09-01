import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
    "package.json": { name: "artemis", version: "1.4.42" },
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
      dependencies: { "@artemis/theme-contract": "1.4.42" },
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
    "apps/desktop/vite.config.ts",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "export {};\n", "utf8");
  }
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
) {
  const root = await fixture(sourcePath, source, manifestOverrides);
  try {
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
    "package.json": { name: "artemis", version: "1.4.43" },
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

if (acceptedCases !== 17 || rejectedCases !== 62) {
  throw new Error(
    `Unexpected boundary test count: ${acceptedCases} accepted, ${rejectedCases} rejected`,
  );
}
console.log(
  "UI boundary fixture tests passed (17 safe cases; 62/62 violations rejected)",
);
