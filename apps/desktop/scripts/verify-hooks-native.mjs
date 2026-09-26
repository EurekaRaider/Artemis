import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareVisualLicenseFixture } from "./prepare-visual-license-fixture.mjs";

// Development-only signed license fixture. The production/package license gate is unchanged.
const desktop = fileURLToPath(new URL("../", import.meta.url));
const output =
  process.env.ARTEMIS_HOOKS_EVIDENCE ??
  join(desktop, "../../artifacts/hooks-native");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "artemis-hooks-native-"));
for (const directory of ["build", "resources"])
  await symlink(
    join(desktop, directory),
    join(stage, directory),
    process.platform === "win32" ? "junction" : "dir",
  );
const project = join(stage, "project");
const profile = join(stage, "profile");
await mkdir(join(project, ".artemis", "hooks"), { recursive: true });
await writeFile(
  join(project, ".artemis", "hooks.json"),
  JSON.stringify({
    description: "Native hook review fixture",
    hooks: {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: "echo native-hook-accepted",
              timeout: 5,
            },
          ],
        },
      ],
    },
  }),
);
const serviceFile = join(stage, "hooks-service.mjs");
await build({
  entryPoints: [join(desktop, "src/main/hooks-service.ts")],
  outfile: serviceFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
const reportPath = join(output, `${process.platform}-${process.arch}.json`);
const entry = join(stage, "entry.mjs");
await writeFile(
  entry,
  `
import assert from 'node:assert/strict';
import { app, dialog } from 'electron';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HooksService } from ${JSON.stringify(pathToFileURL(serviceFile).href)};
app.setPath('userData', ${JSON.stringify(profile)});
app.disableHardwareAcceleration();
app.getPreferredSystemLanguages = () => ['en-US'];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(project)}] });
const proof = { platform:process.platform, arch:process.arch, packaged:false, checks:[] };
const deadline = setTimeout(() => app.exit(2), 60000);
let started = false;
app.on('browser-window-created', (_event, window) => {
 window.webContents.on('did-finish-load', () => void (async () => {
  if(started || !await window.webContents.executeJavaScript('Boolean(window.artemis)')) return;
  started = true;
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const until = async (code) => {
   for(let i=0;i<100;i++) { if(await evaluate(code)) return; await new Promise(r=>setTimeout(r,100)); }
   throw new Error('UI condition not reached: '+code);
  };
  const click = (selector, label) => evaluate('Array.from(document.querySelectorAll('+JSON.stringify(selector)+')).find(e=>(e.getAttribute("aria-label")??e.textContent.trim())==='+JSON.stringify(label)+')?.click(); true');
  try {
   const project = await evaluate('window.artemis.openProject()');
   assert(project?.id);
   const query = JSON.stringify({projectId:project.id});
   const catalog = () => evaluate('window.artemis.listHooks('+query+')');
   const initial = await catalog();
   const hook = initial.hooks.find(h=>h.source==='project');
   assert.equal(hook.status,'pending');
   assert.equal(initial.records.length,0);
   proof.checks.push('discovery-does-not-execute');
   await until('Boolean(Array.from(document.querySelectorAll("button")).find(e=>(e.getAttribute("aria-label")??e.textContent.trim())==="Settings"))');
   await click('button','Settings');
   await until('Boolean(Array.from(document.querySelectorAll("[role=tab]")).find(e=>(e.getAttribute("aria-label")??e.textContent.trim())==="Hooks"))');
   await click('[role=tab]','Hooks');
   await until('Boolean(document.querySelector(".hooks-row input[type=checkbox]"))');
   assert.equal(await evaluate('document.querySelector(".hooks-row input[type=checkbox]").checked'),false);
   await evaluate('document.querySelector(".hooks-row input[type=checkbox]").click(); true');
   await click('button','Review hooks (1)');
   await until('Boolean(Array.from(document.querySelectorAll("button")).find(e=>e.textContent.includes("Trust and enable")))');
   await evaluate('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.includes("Trust and enable")).click(); true');
   await until('window.artemis.listHooks('+query+').then(c=>c.hooks.some(h=>h.id==='+JSON.stringify(hook.id)+'&&h.status==="trusted"))');
   proof.checks.push('explicit-ui-trust');
   await until('!document.querySelector(".hooks-dialog") && Boolean(document.querySelector(".hooks-row input[role=switch]:checked"))');
   window.show();window.focus();
   await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
   const shot = await window.webContents.capturePage();
   await writeFile(${JSON.stringify(join(output, `${process.platform}-${process.arch}.png`))}, shot.toPNG());
   const service = new HooksService(${JSON.stringify(join(profile, "hooks"))},join(homedir(),'.artemis'));
   const context = {projectId:project.id,workspacePath:project.path,threadId:'native-test',mode:'execute',remote:false};
   const invocation = {version:1,hook_event_name:'PreToolUse',session_id:'native-test',cwd:project.path,permission_mode:'execute',tool_name:'write'};
   for(const mode of ['plan','review']) await service.run({...context,mode},invocation);
   await service.run({...context,remote:true},invocation);
   assert.equal(service.records().length,0);
   await service.run(context,invocation);
   assert.equal(service.records().length,1);
   assert.equal(service.records()[0].status,'success');
   assert.match(service.records()[0].output,/native-hook-accepted/);
   proof.checks.push('native-command-executed','plan-review-im-zero-executions');
   await until('Boolean(document.querySelector(".hooks-row button:not(:disabled)"))');
   await click('.hooks-row button','Review hooks');
   await until('Boolean(Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()==="Revoke trust"))');
   await click('button','Revoke trust');
   await until('window.artemis.listHooks('+query+').then(c=>c.hooks.some(h=>h.id==='+JSON.stringify(hook.id)+'&&h.status==="pending"))');
   proof.checks.push('ui-revoke');
   await writeFile(${JSON.stringify(reportPath)}, JSON.stringify(proof,null,2));
   clearTimeout(deadline); app.exit(0);
  } catch(error) {
   proof.error=String(error?.stack??error);
   await writeFile(${JSON.stringify(reportPath)},JSON.stringify(proof,null,2));
   clearTimeout(deadline); app.exit(1);
  }
 })().catch(error=>{console.error(error);app.exit(1)}));
});
await import(${JSON.stringify(pathToFileURL(join(desktop, "dist-electron/main.js")).href)});
`,
);
const restore = await prepareVisualLicenseFixture();
try {
  const isolatedHome = join(stage, "home");
  await mkdir(isolatedHome, { recursive: true });
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    ARTEMIS_SMOKE_LOCALE: "en",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)("electron"), [entry], {
    cwd: desktop,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (value) => {
    logs += value;
  });
  child.stderr.on("data", (value) => {
    logs += value;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 75000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  await writeFile(
    join(output, `${process.platform}-${process.arch}.log`),
    logs,
  );
  assert.equal(code, 0, `Native hook verification failed: ${logs}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.checks.length, 5);
  console.log(JSON.stringify(report));
} finally {
  await restore();
  await rm(stage, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
