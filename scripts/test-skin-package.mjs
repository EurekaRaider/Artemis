import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const verifier = join(root, "scripts/verify-skin-package.mjs");
const fixture = await import(
  pathToFileURL(join(root, "apps/ui-gallery/src/stress-skin-fixture.mjs")).href
);
let rejected = 0;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (content) => createHash("sha256").update(content).digest("hex");

async function writePackage(directory, files) {
  for (const [name, value] of Object.entries(files)) {
    const content = typeof value === "string" ? value : canonicalJson(value);
    await writeFile(join(directory, name), content, "utf8");
  }
}

async function expectRejected(name, mutate) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-skin-negative-"));
  try {
    const files = structuredClone(fixture.stressSkinPackageFiles);
    await writePackage(directory, files);
    await mutate(directory, files);
    const result = spawnSync(
      process.execPath,
      [verifier, "--package", directory],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    if (result.status === 0) {
      throw new Error(
        `${name}: invalid package unexpectedly passed\n${result.stdout}`,
      );
    }
    rejected += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, content] of [
  ["CSS file", ":root{}\n"],
  ["JavaScript file", "export default {};\n"],
  ["HTML file", "<html></html>\n"],
  ["unknown unhashed file", "{}\n"],
]) {
  await expectRejected(name, async (directory) => {
    const fileName =
      name === "CSS file"
        ? "theme.css"
        : name === "JavaScript file"
          ? "script.js"
          : name === "HTML file"
            ? "index.html"
            : "unknown.json";
    await writeFile(join(directory, fileName), content, "utf8");
  });
}

await expectRejected("URL token", async (directory, files) => {
  files["tokens.light.json"].modes[0].tokens["color.canvas"] = {
    kind: "color",
    value: "url(https://invalid.example)",
  };
  const content = canonicalJson(files["tokens.light.json"]);
  files["integrity.json"].files["tokens.light.json"] = hash(content);
  await writeFile(join(directory, "tokens.light.json"), content, "utf8");
  await writeFile(
    join(directory, "integrity.json"),
    canonicalJson(files["integrity.json"]),
    "utf8",
  );
});

await expectRejected("path traversal", async (directory, files) => {
  files["manifest.json"].tokens.light = "../tokens.light.json";
  const content = canonicalJson(files["manifest.json"]);
  files["integrity.json"].files["manifest.json"] = hash(content);
  await writeFile(join(directory, "manifest.json"), content, "utf8");
  await writeFile(
    join(directory, "integrity.json"),
    canonicalJson(files["integrity.json"]),
    "utf8",
  );
});

await expectRejected("missing file", async (directory) => {
  await unlink(join(directory, "tokens.dark.json"));
});

await expectRejected("invalid hash", async (directory, files) => {
  files["integrity.json"].files["manifest.json"] = "0".repeat(64);
  await writeFile(
    join(directory, "integrity.json"),
    canonicalJson(files["integrity.json"]),
    "utf8",
  );
});

console.log(
  `Skin package negative verification passed (${rejected}/8 rejected)`,
);
