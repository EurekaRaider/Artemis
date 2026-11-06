import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parsers } from "prettier/plugins/typescript";

// Legacy source contracts inspect all composition owners. Behavior tests import
// feature modules directly; verification-only sources are never included here.
export function readMainProcessSources(): string {
  const root = fileURLToPath(new URL("../../../src/main/", import.meta.url));
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  // Expand thin composition delegates for existing source-characterization
  // tests. Read the actual owner bodies, never a stored copy of old code.
  // Architectural boundary tests inspect files and bundle graphs directly.
  let composition = read("main.ts");
  const ast = parsers.typescript.parse(composition, {}) as any;
  const factories = new Map<string, string>();
  for (const statement of ast.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      !statement.source.value.startsWith("./")
    )
      continue;
    for (const specifier of statement.specifiers)
      factories.set(
        specifier.local.name,
        statement.source.value.slice(2).replace(/\.js$/, ""),
      );
  }
  const instances = new Map<string, string>();
  for (const statement of ast.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (
        declaration.init?.arguments?.[0]?.callee?.name !==
        "createApplicationServices"
      )
        continue;
      const owner = factories.get(declaration.init.callee.name);
      if (owner) instances.set(declaration.id.name, owner);
    }
  }
  const replacements: Array<[number, number, string]> = [];
  for (const statement of ast.body) {
    const declaration = statement.declaration ?? statement;
    if (
      declaration.type !== "FunctionDeclaration" ||
      declaration.body.body.length !== 1
    )
      continue;
    const call = declaration.body.body[0]?.argument;
    const owner = instances.get(call?.callee?.object?.name);
    if (!owner) continue;
    const text = read(`${owner}.ts`);
    const tree = parsers.typescript.parse(text, {}) as any;
    const factory = tree.body.find(
      (node: any) => node.declaration?.type === "FunctionDeclaration",
    )?.declaration;
    const fn = factory?.body.body.find(
      (node: any) =>
        node.type === "FunctionDeclaration" &&
        node.id.name === declaration.id.name,
    );
    if (!fn)
      throw new Error(`Missing runtime owner: ${owner}/${declaration.id.name}`);
    replacements.push([
      declaration.range[0],
      declaration.range[1],
      text.slice(...fn.range),
    ]);
  }
  for (const [start, end, text] of replacements.sort((a, b) => b[0] - a[0]))
    composition = composition.slice(0, start) + text + composition.slice(end);
  const registration = read("ipc/register-ipc.ts");
  const ipcOwners = [
    ...registration.matchAll(/from ["']\.\/(.*?)\.js["']/g),
  ].map((match) => read(`ipc/${match[1]}.ts`));
  const collect = (directory: string): string[] =>
    readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
      (entry) =>
        entry.isDirectory()
          ? collect(`${directory}/${entry.name}`)
          : entry.name.endsWith(".ts")
            ? [`${directory}/${entry.name}`]
            : [],
    );
  const registeredPaths = new Set(
    [...registration.matchAll(/from ["']\.\/(.*?)\.js["']/g)].map(
      (match) => `ipc/${match[1]}.ts`,
    ),
  );
  const additionalIpcOwners = collect("ipc")
    .filter(
      (path) => !registeredPaths.has(path) && path !== "ipc/register-ipc.ts",
    )
    .map(read);
  const applicationOwners = collect("application").map(read);
  return [
    composition,
    ...ipcOwners,
    ...additionalIpcOwners,
    ...applicationOwners,
  ].join("\n");
}
