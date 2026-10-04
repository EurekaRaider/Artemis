import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const verifier = join(root, "scripts/ui/verify-skin-package.mjs");
const fixture = await import(
  pathToFileURL(
    join(root, "apps/ui-gallery/src/themes/stress-skin-fixture.mjs"),
  ).href
);
const { verifyExternalSkinPackage } = await import(
  pathToFileURL(verifier).href
);
let rejected = 0;
let rejectedCli = 0;
let skippedSymlink = 0;

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (content) => createHash("sha256").update(content).digest("hex");

async function writePackage(directory, files) {
  for (const [name, value] of Object.entries(files)) {
    const content = typeof value === "string" ? value : canonicalJson(value);
    await writeFile(join(directory, name), content, "utf8");
  }
}

async function expectRejected(name, mutate, skipUnsupportedSymlink = false) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-skin-negative-"));
  try {
    const files = structuredClone(fixture.stressSkinPackageFiles);
    await writePackage(directory, files);
    try {
      await mutate(directory, files);
    } catch (error) {
      if (
        skipUnsupportedSymlink &&
        process.platform === "win32" &&
        error?.code === "EPERM"
      ) {
        skippedSymlink += 1;
        console.log(`${name}: Windows runner cannot create file symlinks.`);
        return;
      }
      throw error;
    }
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

async function expectRootSymlinkRejected() {
  const parent = await mkdtemp(join(tmpdir(), "artemis-skin-root-link-"));
  try {
    const directory = join(parent, "package");
    const link = join(parent, "package-link");
    await mkdir(directory);
    await writePackage(directory, fixture.stressSkinPackageFiles);
    await symlink(
      directory,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = spawnSync(process.execPath, [verifier, "--package", link], {
      cwd: root,
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    if (
      result.status === 0 ||
      !output.includes("Skin package path must be a real directory")
    ) {
      throw new Error(`root symlink package was not rejected\n${output}`);
    }
    rejected += 1;
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function expectVerificationRaceRejected(name, hooks, expectedError) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-skin-race-"));
  try {
    await writePackage(directory, fixture.stressSkinPackageFiles);
    let failure = "";
    try {
      await verifyExternalSkinPackage(directory, hooks(directory));
    } catch (error) {
      if (error instanceof Error) failure = error.message;
    }
    if (!failure.includes(expectedError)) {
      throw new Error(
        `${name}: verification race was not rejected for ${expectedError}: ${failure}`,
      );
    }
    rejected += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function expectCliRejected(name, args, expectedError) {
  const result = spawnSync(process.execPath, [verifier, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expectedError)) {
    throw new Error(
      `${name}: CLI was not rejected for ${expectedError}\n${output}`,
    );
  }
  rejected += 1;
  rejectedCli += 1;
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

await expectRejected("nested directory", async (directory) => {
  await mkdir(join(directory, "assets"));
});

await expectRejected(
  "symlink entry",
  async (directory) => {
    await symlink("manifest.json", join(directory, "manifest-link.json"));
  },
  true,
);

await expectRootSymlinkRejected();

await expectVerificationRaceRejected(
  "file replacement during validation",
  (directory) => ({
    async afterSnapshot() {
      const path = join(directory, "tokens.dark.json");
      const content = await readFile(path);
      await unlink(path);
      await writeFile(path, content);
    },
  }),
  "file changed during verification",
);

await expectVerificationRaceRejected(
  "directory entry added after validation",
  (directory) => ({
    async afterValidation() {
      await writeFile(join(directory, "late.json"), "{}\n", "utf8");
    },
  }),
  "directory entries changed during verification",
);

expectCliRejected(
  "unknown package flag",
  ["--pakage", "fixture"],
  "unknown flag",
);
expectCliRejected(
  "duplicate package flag",
  ["--package", "fixture", "--package", "fixture"],
  "duplicate --package flag",
);
expectCliRejected(
  "missing package value",
  ["--package"],
  "requires a non-empty path",
);
expectCliRejected(
  "empty package value",
  ["--package", ""],
  "requires a non-empty path",
);
expectCliRejected(
  "package positional argument",
  ["fixture"],
  "unexpected positional argument",
);

if (rejected + skippedSymlink !== 18 || rejectedCli !== 5) {
  throw new Error(
    `Skin package negative coverage is incomplete: ${rejected} rejected, ${skippedSymlink} unavailable symlink fixture, ${rejectedCli}/5 CLI`,
  );
}

console.log(
  `Skin package negative verification passed (${rejected}/18 rejected; ${skippedSymlink} unavailable symlink fixture; ${rejectedCli}/5 CLI fixtures; 2/2 deterministic race fixtures)`,
);
