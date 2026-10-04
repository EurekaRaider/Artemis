import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TrustedExtensionManager } from "../src/main/trusted-extension-manager.js";
import { TrustedExtensionStore } from "../src/main/trusted-extension-store.js";

it("kills an in-flight managed extension and rejects execution after license shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artemis-license-extension-"));
  let manager: TrustedExtensionManager | undefined;
  try {
    const extension = join(directory, "extension.mjs");
    const worker = join(directory, "worker.mjs");
    const marker = join(directory, "pid");
    await writeFile(extension, "export default () => {};");
    await writeFile(
      worker,
      `import {writeFileSync} from 'node:fs'; let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => { const request=JSON.parse(input); if(request.type === 'discover') console.log('ARTEMIS_EXTENSION_RESULT:' + JSON.stringify({ok:true,result:{tools:[{name:'wait',label:'Wait',description:'Fixture',inputSchema:{type:'object'}}],unsupported:{handlers:0,commands:0,flags:0,shortcuts:0}}})); else {writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);} });`,
    );
    const config = await new TrustedExtensionStore(
      join(directory, "trusted.json"),
    ).trust(extension);
    manager = new TrustedExtensionManager("darwin", undefined, worker);
    await manager.refresh([config], directory, true);
    const pending = manager.call(
      config.id,
      "wait",
      {},
      directory,
      "work",
      true,
    );
    const rejected = expect(pending).rejects.toThrow();
    let pid = 0;
    const deadline = Date.now() + 5000;
    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(marker, "utf8"));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(pid).toBeGreaterThan(0);
    manager.dispose();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(
      manager.call(config.id, "wait", {}, directory, "work", true),
    ).rejects.toThrow("stopped");
  } finally {
    manager?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
