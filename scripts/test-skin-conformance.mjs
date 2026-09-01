import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const verifier = join(root, "scripts/verify-skin-conformance.mjs");
const conformance = await import(
  pathToFileURL(join(root, "packages/ui/dist/conformance.js")).href
);
const baseMatrix = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(join(root, "apps/ui-gallery/src/conformance-matrix.json"), "utf8"),
);
let rejected = 0;

async function rejectContract(name, mutate) {
  const directory = await mkdtemp(
    join(tmpdir(), "artemis-conformance-negative-"),
  );
  try {
    const contract = structuredClone(conformance.CONFORMANCE_PROBE_CONTRACT);
    mutate(contract);
    const path = join(directory, "contract.json");
    await writeFile(path, JSON.stringify(contract), "utf8");
    const result = spawnSync(process.execPath, [verifier, "--contract", path], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0)
      throw new Error(`${name}: invalid contract passed`);
    rejected += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await rejectContract("missing part", (contract) => contract.parts.pop());
await rejectContract("missing state", (contract) => {
  contract.states = contract.states.filter((state) => state.name !== "busy");
});
await rejectContract("invalid ARIA", (contract) => {
  contract.aria.rootRole = "presentation";
});
await rejectContract("invalid event order", (contract) => {
  contract.callbacks[0].order.reverse();
});

const matrixDirectory = await mkdtemp(
  join(tmpdir(), "artemis-conformance-matrix-"),
);
try {
  const matrix = structuredClone(baseMatrix);
  matrix.skins.stress.pop();
  const path = join(matrixDirectory, "matrix.json");
  await writeFile(path, JSON.stringify(matrix), "utf8");
  const result = spawnSync(process.execPath, [verifier, "--matrix", path], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) throw new Error("missing behavior case passed");
  rejected += 1;
} finally {
  await rm(matrixDirectory, { recursive: true, force: true });
}

const skinDirectory = await mkdtemp(
  join(tmpdir(), "artemis-conformance-skin-"),
);
try {
  await writeFile(join(skinDirectory, "manifest.json"), "{}\n", "utf8");
  const result = spawnSync(
    process.execPath,
    [verifier, "--skin-package", skinDirectory],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status === 0) throw new Error("invalid skin package passed");
  rejected += 1;
} finally {
  await rm(skinDirectory, { recursive: true, force: true });
}

console.log(
  `Skin conformance negative verification passed (${rejected}/6 rejected)`,
);
