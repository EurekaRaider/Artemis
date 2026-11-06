import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsers } from "prettier/plugins/typescript";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const shop =
  process.env.ARTEMIS_PLUGIN_SHOP ?? resolve(root, "../ArtemisPluginShop");

function typeShape(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(typeShape);
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !["loc", "range", "raw", "comments", "tokens", "parent"].includes(
            key,
          ) && !key.startsWith("__"),
      )
      .map(([key, nested]) => [key, typeShape(nested)]),
  );
}

// Follow public type re-exports so moving a contract cannot remove it from the
// parity check. Runtime validation is checked separately in the emitted graph.
function exportedTypes(file: string): Map<string, unknown> {
  const ast = parsers.typescript.parse(readFileSync(file, "utf8"), {}) as any;
  const result = new Map<string, unknown>();
  for (const statement of ast.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(
        declaration?.type,
      )
    ) {
      result.set(declaration.id.name, typeShape(declaration));
    }
    if (!statement.source) continue;
    const target = resolve(
      dirname(file),
      statement.source.value.replace(/\.js$/, ".ts"),
    );
    const types = exportedTypes(target);
    for (const specifier of statement.specifiers) {
      const name = specifier.local.name;
      if (statement.exportKind === "type" || specifier.exportKind === "type")
        expect(
          types.has(name),
          `${file} must resolve exported type ${name}`,
        ).toBe(true);
      if (types.has(name)) result.set(specifier.exported.name, types.get(name));
    }
  }
  return result;
}

async function validationCode(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    packages: "external",
    platform: "node",
    format: "esm",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

it.skipIf(!existsSync(shop))(
  "uses identical OAuth validation and public contracts in the host and marketplace",
  async () => {
    for (const name of ["connectors.ts", "connector-oauth.ts"]) {
      const marketplace = resolve(shop, "src/shared", name);
      const desktop = resolve(root, "apps/desktop/src/shared", name);
      const [marketplaceCode, desktopCode] = await Promise.all([
        validationCode(marketplace),
        validationCode(desktop),
      ]);
      expect(marketplaceCode).toBe(desktopCode);
      expect(exportedTypes(marketplace)).toEqual(exportedTypes(desktop));
    }
  },
);
