import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

if (target === "theme-contract") {
  const contract = await import(
    pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
  );
  await writeJson(
    join(root, "packages/theme-contract/dist/schema/manifest.schema.json"),
    contract.themeManifestSchema,
  );
  await writeJson(
    join(root, "packages/theme-contract/dist/schema/tokens.schema.json"),
    contract.themeTokenDocumentSchema,
  );
  await writeJson(
    join(root, "packages/theme-contract/dist/schema/integrity.schema.json"),
    contract.skinIntegritySchema,
  );
} else if (target === "ui") {
  const source = await readFile(
    join(root, "packages/ui/src/styles.css"),
    "utf8",
  );
  await writeFile(join(root, "packages/ui/dist/styles.css"), source, "utf8");
} else if (target === "theme-artemis") {
  const contract = await import(
    pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
  );
  const theme = await import(
    pathToFileURL(join(root, "packages/theme-artemis/dist/index.js")).href
  );
  const dist = join(root, "packages/theme-artemis/dist");
  await rm(join(dist, "tokens"), { recursive: true, force: true });
  const dataArtifacts = {
    "manifest.json": theme.artemisThemeManifest,
    [theme.artemisThemeManifest.tokens.light]: theme.artemisLightTokens,
    [theme.artemisThemeManifest.tokens.dark]: theme.artemisDarkTokens,
    [theme.artemisThemeManifest.tokens.contrast]: theme.artemisContrastTokens,
  };
  for (const [file, value] of Object.entries(dataArtifacts)) {
    await writeJson(join(dist, file), value);
  }
  const integrity = {
    algorithm: "sha256",
    files: Object.fromEntries(
      await Promise.all(
        Object.keys(dataArtifacts).map(async (file) => [
          file,
          await sha256(join(dist, file)),
        ]),
      ),
    ),
  };
  const integrityReport = contract.validateSkinIntegrity(
    integrity,
    theme.artemisThemeManifest,
  );
  if (!integrityReport.valid) {
    throw new Error(
      `Generated Artemis integrity failed validation: ${JSON.stringify(integrityReport.issues)}`,
    );
  }
  await writeJson(join(dist, "integrity.json"), integrity);
  await writeFile(join(dist, "theme.css"), theme.artemisThemeCss, "utf8");
} else {
  throw new Error(`Unknown UI asset target: ${String(target)}`);
}
