import { readFileSync } from "node:fs";
import { parsers } from "prettier/plugins/typescript";

// Legacy integration fixtures execute a handler with their controlled runtime.
// Locate the complete registration by syntax, never by the next file/channel.
export async function ipcHandlerSource(
  owner: string,
  channel: string,
): Promise<string> {
  const source = readFileSync(
    new URL(`../../../src/main/ipc/${owner}.ts`, import.meta.url),
    "utf8",
  );
  const ast = await parsers.typescript.parse(source, {});
  let result: string | undefined;
  function visit(node: any): void {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "ExpressionStatement" &&
      node.expression?.callee?.object?.name === "ipcMain" &&
      node.expression.arguments?.[0]?.object?.name === "IPC" &&
      node.expression.arguments[0].property?.name === channel
    ) {
      result = source.slice(...node.range);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "range", "comments", "tokens"].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value]) visit(child);
    }
  }
  visit(ast);
  if (!result) throw new Error(`Missing IPC registration: ${owner}/${channel}`);
  return result;
}
