import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { desktopLocaleOptimization } from "./desktop-locale-optimization.mjs";

const directory = fileURLToPath(
  new URL("../../apps/desktop/src/shared/i18n/ui-locales/", import.meta.url),
);

test("production locale optimization preserves all 14 dictionaries and reduces bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "artemis-locale-build-"));
  try {
    const locales = (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
    assert.equal(locales.length, 14);
    const source = locales
      .map(
        (name, index) =>
          `import locale${index} from ${JSON.stringify(join(directory, name))};`,
      )
      .join("\n");
    const entry = join(temporary, "entry.mjs");
    await writeFile(
      entry,
      `${source}\nexport default [${locales.map((_, index) => `locale${index}`).join(",")}];`,
    );
    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [desktopLocaleOptimization()],
      build: {
        outDir: join(temporary, "dist"),
        lib: { entry, formats: ["es"], fileName: () => "locales.mjs" },
        minify: true,
      },
    });
    const output = join(temporary, "dist/locales.mjs");
    const dictionaries = (await import(pathToFileURL(output).href)).default;
    let originalBytes = 0;
    for (const [index, name] of locales.entries()) {
      const original = JSON.parse(
        await readFile(join(directory, name), "utf8"),
      );
      assert.deepEqual(dictionaries[index], original, name);
      originalBytes += Buffer.byteLength(JSON.stringify(original));
    }
    assert.ok((await readFile(output)).length < originalBytes * 0.8);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
