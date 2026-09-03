import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("./verify-ui-convergence.mjs", import.meta.url),
);
let accepted = 0;
let rejected = 0;

async function fixture({
  contract = { dynamicClassConsumers: [], rawComponentOverrides: [] },
  main = 'import "./used.js";\nexport const className = "used";\n',
  styles = ".used { color: var(--artemis-color-text-primary); }\n",
  extraFiles = {},
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "artemis-ui-convergence-"));
  const tsconfig = `${JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "ESNext", moduleResolution: "Bundler", noEmit: true, target: "ES2024" }, include: ["src/**/*.ts", "src/**/*.tsx"] }, null, 2)}\n`;
  const files = {
    "apps/desktop/src/renderer/main.tsx": main,
    "apps/desktop/src/renderer/used.ts": "export const used = true;\n",
    "apps/desktop/src/renderer/styles.css": styles,
    "apps/desktop/tsconfig.json": tsconfig,
    "packages/ui/src/index.ts": "export {};\n",
    "packages/ui/tsconfig.json": tsconfig,
    "scripts/ui-convergence-contract.json": `${JSON.stringify(contract, null, 2)}\n`,
    ...extraFiles,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

async function runCase(name, options, expectedSuccess, expectedMessage) {
  const root = await fixture(options);
  try {
    const result = spawnSync(process.execPath, [checker, "--root", root], {
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    if ((result.status === 0) !== expectedSuccess) {
      throw new Error(
        `${name}: expected success=${String(expectedSuccess)}, exit=${String(result.status)}\n${output}`,
      );
    }
    if (expectedMessage !== undefined && !output.includes(expectedMessage)) {
      throw new Error(
        `${name}: expected output to include ${expectedMessage}\n${output}`,
      );
    }
    if (expectedSuccess) accepted += 1;
    else rejected += 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runCase("bounded production fixture", undefined, true);
await runCase(
  "unused selector",
  {
    styles:
      ".used { color: var(--artemis-color-text-primary); }\n.stale { display: block; }\n",
  },
  false,
  ".stale has no production class consumer",
);
await runCase(
  "unreachable adapter",
  {
    extraFiles: {
      "apps/desktop/src/renderer/orphan-adapter.ts":
        'export const orphanClass = "orphan";\n',
    },
  },
  false,
  "production renderer module is unreachable from main.tsx",
);
await runCase(
  "unregistered raw override",
  {
    styles:
      '.used { color: var(--artemis-color-text-primary); }\n[data-artemis-component="button"] { gap: 9px; }\n',
  },
  false,
  "unregistered raw public-component override",
);
await runCase(
  "registered raw override",
  {
    contract: {
      dynamicClassConsumers: [],
      rawComponentOverrides: [
        {
          atRules: [],
          selector: '[data-artemis-component="button"]',
          property: "z-index",
          value: "80",
          owner: "Fixture overlay",
          reason: "The fixture has no layer token.",
        },
      ],
    },
    styles:
      '.used { color: var(--artemis-color-text-primary); }\n[data-artemis-component="button"] { z-index: 80; }\n',
  },
  true,
);
const dynamicContract = (contains) => ({
  dynamicClassConsumers: [
    {
      classes: ["dynamic-before"],
      owner: "Fixture ordering",
      reason: "A finite edge is appended at runtime.",
      sources: [{ path: "apps/desktop/src/renderer/main.tsx", contains }],
    },
  ],
  rawComponentOverrides: [],
});
const dynamicMain =
  'import "./used.js";\nconst edge: "before" = "before";\nexport const className = `dynamic-${edge}`;\n';
await runCase(
  "dynamic finite class",
  {
    contract: dynamicContract("`dynamic-${edge}`"),
    main: dynamicMain,
    styles: ".dynamic-before { display: block; }\n",
  },
  true,
);
await runCase(
  "drifted dynamic evidence",
  {
    contract: dynamicContract("missing expression"),
    main: dynamicMain,
    styles: ".dynamic-before { display: block; }\n",
  },
  false,
  "dynamic class evidence drifted",
);

console.log(
  `UI convergence negative fixtures passed (${accepted} accepted; ${rejected} rejected)`,
);
