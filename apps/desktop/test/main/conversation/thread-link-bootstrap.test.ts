import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";

it("queues cold macOS URL events until startup connects the main entry and delivers warm events once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artemis-link-bootstrap-"));
  const globals = globalThis as unknown as {
    __reviewBootstrapApp?: { emit(...args: unknown[]): void; release(): void };
    __reviewBootstrapOpened?: string[];
  };
  globals.__reviewBootstrapOpened = [];
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await writeFile(
      join(directory, "main.js"),
      "export function startDesktopApplication() {} export function openThreadLink(url) { globalThis.__reviewBootstrapOpened.push(url); }",
    );
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../../../src/main/bootstrap.ts", import.meta.url),
        ),
      ],
      outfile: join(directory, "bootstrap.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["./main.js"],
      logLevel: "silent",
      plugins: [
        {
          name: "fake-electron",
          setup(builder) {
            builder.onResolve({ filter: /^electron$/ }, () => ({
              path: "electron",
              namespace: "review-fixture",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "review-fixture" },
              () => ({
                contents: `import { EventEmitter } from 'node:events';
          let release; const ready = new Promise(resolve => release = resolve);
          export const app = Object.assign(new EventEmitter(), { isPackaged: false, requestSingleInstanceLock: () => true, whenReady: () => ready, release, quit() {}, exit() {} });
          globalThis.__reviewBootstrapApp = app;
          export const BrowserWindow = { getAllWindows: () => [] };
          export const protocol = { registerSchemesAsPrivileged() {} };
          export const dialog = { showErrorBox(title, error) { throw Error(error); } };`,
              }),
            );
          },
        },
      ],
    });
    await import(pathToFileURL(join(directory, "bootstrap.js")).href);
    const cold = "artemis://thread/e59ea82c-775a-4a3f-87ab-62c11ac31f3b";
    const warm = "artemis://thread/4c891818-ae97-4ccd-8445-799c01ddca5a";
    globals.__reviewBootstrapApp!.emit(
      "open-url",
      { preventDefault() {} },
      cold,
    );
    globals.__reviewBootstrapApp!.release();
    await vi.waitFor(() =>
      expect(globals.__reviewBootstrapOpened).toEqual([cold]),
    );
    globals.__reviewBootstrapApp!.emit(
      "open-url",
      { preventDefault() {} },
      warm,
    );
    globals.__reviewBootstrapApp!.emit(
      "open-url",
      { preventDefault() {} },
      `${warm}?run=1`,
    );
    expect(globals.__reviewBootstrapOpened).toEqual([cold, warm]);
  } finally {
    delete globals.__reviewBootstrapApp;
    delete globals.__reviewBootstrapOpened;
    await rm(directory, { recursive: true, force: true });
  }
});
