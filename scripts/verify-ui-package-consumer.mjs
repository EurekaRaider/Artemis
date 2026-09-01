import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const consumer = await mkdtemp(join(tmpdir(), "artemis-ui-consumer-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: join(consumer, ".npm-cache"),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${String(result.status)}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function pack(packagePath, auditPublicFiles) {
  const output = run(npm, [
    "pack",
    "--json",
    "--pack-destination",
    consumer,
    join(root, packagePath),
  ]);
  const result = JSON.parse(output)[0];
  if (auditPublicFiles) {
    const paths = result.files.map((entry) => entry.path);
    for (const path of paths) {
      if (path !== "package.json" && !path.startsWith("dist/")) {
        throw new Error(
          `${packagePath} tarball contains a non-artifact file: ${path}`,
        );
      }
      if (/(^|\/)(?:src|test|tests)(\/|$)|\.env(?:\.|$)/u.test(path)) {
        throw new Error(
          `${packagePath} tarball leaks source/test/secret path: ${path}`,
        );
      }
    }
    for (const expected of auditPublicFiles) {
      if (!paths.includes(expected)) {
        throw new Error(`${packagePath} tarball is missing ${expected}`);
      }
    }
  }
  return join(consumer, result.filename);
}

async function textFilesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await textFilesBelow(path)));
    else if (/\.(?:css|d\.ts|js|json|map)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

try {
  const tarballs = [
    await pack("packages/theme-contract", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/schema/manifest.schema.json",
      "dist/schema/tokens.schema.json",
      "dist/schema/integrity.schema.json",
    ]),
    await pack("packages/ui", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/conformance.js",
      "dist/conformance.d.ts",
      "dist/actions.js",
      "dist/actions.d.ts",
      "dist/styles.css",
    ]),
    await pack("packages/theme-artemis", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/manifest.json",
      "dist/tokens.light.json",
      "dist/tokens.dark.json",
      "dist/tokens.contrast.json",
      "dist/integrity.json",
      "dist/theme.css",
    ]),
    await pack("node_modules/react"),
    await pack("node_modules/react-dom"),
    await pack("node_modules/scheduler"),
  ];

  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "artemis-ui-consumer", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  run(
    npm,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...tarballs,
    ],
    consumer,
  );

  await writeFile(
    join(consumer, "consumer.ts"),
    `import { UI_CONTRACT_VERSION, validateComponentContract, type ArtemisUiRootAttributes, type ComponentContract } from "@artemis/ui";\nimport { ACTION_COMPONENT_CONTRACTS, Button, IconButton, type ActionIconSize, type ActionTone } from "@artemis/ui/actions";\nimport { CONFORMANCE_PROBE_CONTRACT, ConformanceProbe } from "@artemis/ui/conformance";\nimport { validateSkinManifest, type SkinManifest } from "@artemis/theme-contract";\nimport { artemisThemeManifest } from "@artemis/theme-artemis";\nconst attributes: ArtemisUiRootAttributes = {\n  "data-artemis-skin": "com.artemis.default",\n  "data-artemis-theme": "light",\n  "data-artemis-contrast": "normal",\n};\nconst manifest: SkinManifest = artemisThemeManifest;\nconst contract: ComponentContract = CONFORMANCE_PROBE_CONTRACT;\nconst iconSize: ActionIconSize = "xl";\nconst tone: ActionTone = "success";\nvoid ConformanceProbe;\nvoid Button;\nvoid IconButton;\nif (UI_CONTRACT_VERSION !== 1 || !validateSkinManifest(manifest).valid || !validateComponentContract(contract).valid || attributes["data-artemis-theme"] !== "light" || ACTION_COMPONENT_CONTRACTS.icon.sizes.at(-1) !== iconSize || ACTION_COMPONENT_CONTRACTS.status.tones?.at(2) !== tone) throw new Error("invalid contract");\n`,
    "utf8",
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);

  await writeFile(
    join(consumer, "consumer.mjs"),
    `import { createHash } from "node:crypto";\nimport { readFile } from "node:fs/promises";\nimport { fileURLToPath } from "node:url";\nimport { createElement } from "react";\nimport { renderToStaticMarkup } from "react-dom/server";\nimport { UI_CONTRACT_VERSION, validateComponentContract } from "@artemis/ui";\nimport { ACTION_COMPONENT_CONTRACTS, Badge, Button, IconButton, Status } from "@artemis/ui/actions";\nimport { CONFORMANCE_PROBE_CONTRACT, ConformanceProbe } from "@artemis/ui/conformance";\nimport { validateSkinIntegrity, validateSkinPackage } from "@artemis/theme-contract";\nimport { artemisThemeManifest, artemisTokenDocuments } from "@artemis/theme-artemis";\nconst publicPaths = [\n  "@artemis/ui/styles.css",\n  "@artemis/theme-contract/schema/manifest.json",\n  "@artemis/theme-contract/schema/tokens.json",\n  "@artemis/theme-contract/schema/integrity.json",\n  "@artemis/theme-artemis/manifest.json",\n  "@artemis/theme-artemis/tokens.light.json",\n  "@artemis/theme-artemis/tokens.dark.json",\n  "@artemis/theme-artemis/tokens.contrast.json",\n  "@artemis/theme-artemis/integrity.json",\n  "@artemis/theme-artemis/theme.css",\n];\nfor (const path of publicPaths) {\n  const content = await readFile(fileURLToPath(import.meta.resolve(path)), "utf8");\n  if (content.length === 0) throw new Error(\`empty public export: \${path}\`);\n}\nif (!validateSkinPackage({ manifest: artemisThemeManifest, tokenDocuments: artemisTokenDocuments }).valid) throw new Error("skin validation failed");\nconst integrity = JSON.parse(await readFile(fileURLToPath(import.meta.resolve("@artemis/theme-artemis/integrity.json")), "utf8"));\nif (!validateSkinIntegrity(integrity, artemisThemeManifest).valid) throw new Error("integrity validation failed");\nfor (const [file, expectedHash] of Object.entries(integrity.files)) {\n  const content = await readFile(fileURLToPath(import.meta.resolve("@artemis/theme-artemis/" + file)));\n  const actualHash = createHash("sha256").update(content).digest("hex");\n  if (actualHash !== expectedHash) throw new Error("integrity hash mismatch: " + file);\n}\nconst probeMarkup = renderToStaticMarkup(createElement(ConformanceProbe, { label: "Outside probe", defaultValue: "peer-ok" }));\nconst actionMarkup = [\n  renderToStaticMarkup(createElement(Button, { label: "Outside button" }, "Button")),\n  renderToStaticMarkup(createElement(IconButton, { label: "Outside icon button", icon: createElement("svg") })),\n  renderToStaticMarkup(createElement(Badge, { tone: "success" }, "Complete")),\n  renderToStaticMarkup(createElement(Status, { live: "polite" }, "Running")),\n].join("");\nif (UI_CONTRACT_VERSION !== 1 || !validateComponentContract(CONFORMANCE_PROBE_CONTRACT).valid || !Object.isFrozen(ACTION_COMPONENT_CONTRACTS) || !probeMarkup.includes('data-artemis-component="conformance-probe"') || !probeMarkup.includes('data-part="control"') || !actionMarkup.includes('data-artemis-component="button"') || !actionMarkup.includes('data-artemis-component="icon-button"') || !actionMarkup.includes('data-artemis-component="badge"') || !actionMarkup.includes('data-artemis-component="status"')) throw new Error("peer/component resolution failed");\nconsole.log("outside consumer resolved JS, types, actions/conformance subpaths, CSS, schema, integrity, token data, and React peers");\n`,
    "utf8",
  );
  run(process.execPath, ["consumer.mjs"], consumer);
  run(npm, ["ls", "--all", "react", "react-dom"], consumer);

  await writeFile(
    join(consumer, "tree-shake.ts"),
    `import { createElement } from "react";\nimport { Button } from "@artemis/ui/actions";\nexport const TreeShakeButton = () => createElement(Button, { label: "Tree-shaken action" }, "Action");\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=tree-shake.js",
    ],
    consumer,
  );
  const treeShaken = await readFile(join(consumer, "tree-shake.js"), "utf8");
  const retainedUnusedMarkers = ["icon-button", "badge", "status"].filter(
    (marker) => treeShaken.includes(marker),
  );
  if (
    !treeShaken.includes("data-artemis-component") ||
    !treeShaken.includes("button") ||
    retainedUnusedMarkers.length > 0
  ) {
    throw new Error(
      `Button-only bundle retained unused action markers: ${retainedUnusedMarkers
        .map((marker) => {
          const index = treeShaken.indexOf(marker);
          return `${marker} (${treeShaken.slice(Math.max(0, index - 40), index + marker.length + 40)})`;
        })
        .join(", ")}`,
    );
  }

  const installedRoots = [
    join(consumer, "node_modules/@artemis/theme-contract"),
    join(consumer, "node_modules/@artemis/ui"),
    join(consumer, "node_modules/@artemis/theme-artemis"),
  ];
  for (const installedRoot of installedRoots) {
    for (const file of await textFilesBelow(installedRoot)) {
      const content = await readFile(file, "utf8");
      if (
        content.includes(root) ||
        /\/Users\/[^/]+|BEGIN (?:RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}/u.test(
          content,
        )
      ) {
        throw new Error(
          `installed tarball leaks an absolute path or secret: ${relative(consumer, file)}`,
        );
      }
    }
  }

  console.log(
    `UI package consumer verification passed outside the repository (${basename(consumer)}; 3 public tarballs; unused action JS tree-shaken)`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
