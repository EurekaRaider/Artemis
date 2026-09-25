import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL(".", import.meta.url));
const artifacts = resolve(root, "../../artifacts/license-issuer-ui");
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(artifacts, "fixture-"));
const entry = process.argv[2]
  ? resolve(process.argv[2], "dist/main.cjs")
  : join(root, "dist/main.cjs");
const proofPath = join(artifacts, "result.json");
const harness = join(temporary, "runner.cjs");
try {
  await writeFile(
    harness,
    `
const {app,BrowserWindow,dialog}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(join(temporary, "profile"))});
let cancel=false; let saves=0;
const privatePath=${JSON.stringify(join(temporary, "fixture-key.pem"))};
const publicPath=${JSON.stringify(join(temporary, "public.json"))};
dialog.showSaveDialog=async (_window,options)=>{saves++;return cancel?{canceled:true}:{canceled:false,filePath:options.defaultPath.endsWith('.pem')?privatePath:publicPath}};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[privatePath]});
const steps=[];
const timer=setTimeout(()=>{console.error('Issuer UI timeout');app.exit(2)},30000);
app.once('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',()=>void (async()=>{
  const evaluate=(code)=>window.webContents.executeJavaScript(code);
  const wait=(expression)=>evaluate('(async()=>{const until=Date.now()+5000;while(!('+expression+')){if(Date.now()>until)throw new Error("UI did not settle");await new Promise(r=>setTimeout(r,20));}})()');
  const click=async(action)=>{await evaluate('document.querySelector('+JSON.stringify('[data-action="'+action+'"]').replace(/'/g,"\\'")+').click()');await wait('!document.querySelector("[data-action=create]").disabled');};
  const visible=async()=>evaluate('(()=>{const el=document.getElementById("status"),r=el.getBoundingClientRect();return {text:el.textContent,visible:r.top>=0&&r.bottom<=innerHeight};})()');
  await wait('document.getElementById("status").textContent.length>0 && !document.querySelector("[data-action=create]").disabled');
  await click('create');
  let result=await visible();steps.push({step:'empty-password',...result});
  assert.match(result.text,/12/);assert.equal(result.visible,true,'Password error is outside the viewport');assert.equal(saves,0);
  await click('lock');result=await visible();steps.push({step:'lock',...result});assert.match(result.text,/锁定/);assert.equal(result.visible,true);
  await click('public');result=await visible();steps.push({step:'export-locked',...result});assert.match(result.text,/先.*解锁/);assert.equal(result.visible,true);
  await evaluate('document.getElementById("password").value="fixture-only-password"');
  await click('create');assert.match(await evaluate('document.getElementById("key").textContent'),/已解锁/);assert.match(readFileSync(privatePath,'utf8'),/BEGIN ENCRYPTED PRIVATE KEY/);
  await click('public');assert.equal(Object.keys(JSON.parse(readFileSync(publicPath,'utf8'))).length,1);result=await visible();steps.push({step:'export-public',...result});assert.equal(result.visible,true);
  await click('lock');
  await evaluate('document.getElementById("password").value="fixture-only-password"');await click('unlock');assert.match(await evaluate('document.getElementById("key").textContent'),/已解锁/);
  cancel=true;await click('public');result=await visible();steps.push({step:'cancel-export',...result});assert.match(result.text,/取消/);
  await evaluate('window.scrollTo(0,document.body.scrollHeight)');
  await click('lock');result=await visible();steps.push({step:'scrolled-feedback',...result});assert.equal(result.visible,true);
  await evaluate('window.scrollTo(0,0)');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(${JSON.stringify(join(artifacts, "issuer.png"))},(await window.webContents.capturePage()).toPNG());
  writeFileSync(${JSON.stringify(proofPath)},JSON.stringify({passed:true,steps},null,2));clearTimeout(timer);app.quit();
})().catch(error=>{writeFileSync(${JSON.stringify(proofPath)},JSON.stringify({passed:false,steps,error:String(error)},null,2));console.error(error.message);app.exit(1)})));
require(${JSON.stringify(entry)});
`,
  );
  await new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [harness], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (data) => {
      logs += data;
    });
    child.stderr.on("data", (data) => {
      logs += data;
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 40000);
    child.on("error", reject);
    child.on("exit", async (code) => {
      clearTimeout(timeout);
      await writeFile(join(artifacts, "native.log"), logs);
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              `Issuer UI verification failed (${code}); see ${proofPath}`,
            ),
          );
    });
  });
  console.log(await readFile(proofPath, "utf8"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
