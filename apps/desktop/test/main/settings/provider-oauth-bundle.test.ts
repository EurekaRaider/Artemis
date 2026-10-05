import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("loads all OAuth flows in a standalone production bundle", async () => {
  const desktop = fileURLToPath(new URL("../../../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "artemis-oauth-bundle-"));
  try {
    const outfile = join(directory, "probe.mjs");
    await build({
      stdin: {
        contents: `
          import { ProviderLoginService } from './src/main/settings/provider-login-service.ts';
          import { ModelRuntime } from '@earendil-works/pi-coding-agent';
          globalThis.fetch = async () => { throw new Error('NETWORK_BOUNDARY'); };
          const runtime = await ModelRuntime.create({modelsPath:null, refreshOnCreate:false, allowModelNetwork:false});
          const results = [];
          for (const provider of runtime.getProviders()) {
            if (!provider.auth?.oauth) continue;
            try {
              await provider.auth.oauth.refresh({type:'oauth',access:'fixture',refresh:'fixture',expires:0},new AbortController().signal);
              results.push({id:provider.id,loaded:true});
            } catch (error) {
              results.push({id:provider.id,loaded:error.code !== 'ERR_MODULE_NOT_FOUND' && !/Cannot find module/.test(error.message)});
            }
          }
          const service = new ProviderLoginService({}, async()=>{});
          const state = await service.start('openai-codex','oauth');
          await new Promise(resolve=>setTimeout(resolve,100));
          const status = service.status(state.id);
          service.cancel(state.id);
          console.log(JSON.stringify({results,prompt:status.prompt?.type,status:status.status}));
        `,
        resolveDir: desktop,
        sourcefile: "oauth-probe.ts",
      },
      outfile,
      bundle: true,
      minify: true,
      platform: "node",
      format: "esm",
      target: "node24",
      banner: {
        js: `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(join(desktop, "package.json"))});`,
      },
      logLevel: "silent",
    });
    const { stdout } = await promisify(execFile)(process.execPath, [outfile]);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.results.length).toBeGreaterThanOrEqual(9);
    expect(
      result.results.filter((item: { loaded: boolean }) => !item.loaded),
    ).toEqual([]);
    expect(result).toMatchObject({ prompt: "select", status: "running" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
