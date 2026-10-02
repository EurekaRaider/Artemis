// Isolated real-Electron integration. Never rewrites the production build or user data.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "artemis-visual-skins-"));
const output = resolve(
  process.argv[2] || join(repository, "artifacts/visual-skins"),
);
const source = join(temporary, "source");
await mkdir(output, { recursive: true });
await cp(
  join(repository, "examples/visual-skins/plugins/ocean-visual-skins"),
  source,
  { recursive: true },
);
const modulePath = (relative) => JSON.stringify(join(repository, relative));
const main = `
import { app, BrowserWindow, ipcMain, protocol, session, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ArtemisPluginService } from ${modulePath("apps/desktop/src/main/artemis-plugin-service.ts")};
import { AppearanceService } from ${modulePath("apps/desktop/src/main/appearance-service.ts")};
import { McpConfigStore } from ${modulePath("apps/desktop/src/main/mcp-config-store.ts")};
import { EncryptedSettingsStore } from ${modulePath("apps/desktop/src/main/encrypted-settings-store.ts")};
protocol.registerSchemesAsPrivileged([{scheme:'artemis-skin',privileges:{standard:true,secure:true,corsEnabled:true,stream:true}}]);
const {spawn:spawnPty}=require('node-pty');
const root=${JSON.stringify(temporary)},output=${JSON.stringify(output)},source=${JSON.stringify(source)};
app.setPath('userData',join(root,'user-data'));
app.whenReady().then(async()=>{
const settings=new EncryptedSettingsStore(join(root,'settings.json'),safeStorage);
let appearance,win,pty,opens=0,closes=0;
const plugins=new ArtemisPluginService({skillsRoot:join(root,'skills'),pluginsRoot:join(root,'plugins'),marketplacesRoot:join(root,'markets'),marketplaceStatePath:join(root,'markets.json'),statePath:join(root,'plugins.json'),mcpWorkspaceRoot:join(root,'mcp'),mcpStore:new McpConfigStore(join(root,'mcp.json')),beforeSnapshotChange:id=>appearance.beforePluginChange(id),afterSnapshotChange:async()=>{await appearance.refresh();}});
appearance=new AppearanceService({plugins,getSelection:()=>settings.skinSelection(),saveSelection:s=>settings.setSkinSelection(s),getTheme:async()=> 'dark',changed:state=>{if(win&&!win.isDestroyed())win.webContents.send('appearance:changed',state);}});
await appearance.refresh();
session.defaultSession.protocol.handle('artemis-skin',request=>appearance.respond(request));
win=new BrowserWindow({width:1280,height:820,show:true,webPreferences:{preload:join(root,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
function trusted(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Main window only');}
ipcMain.handle('appearance:get',event=>{trusted(event);return appearance.state();});
ipcMain.handle('appearance:resolve',(event,value)=>{trusted(event);return appearance.resolve(event.sender.id,value);});
ipcMain.handle('appearance:release',(event,value)=>{trusted(event);return appearance.release(event.sender.id,value);});
ipcMain.handle('appearance:select',(event,value)=>{trusted(event);return appearance.select(value);});
ipcMain.handle('terminal:open',event=>{trusted(event);opens++;pty=spawnPty(process.platform==='win32'?process.env.ComSpec:'/bin/zsh',[],{cwd:root,cols:80,rows:24,env:{...process.env,TERM:'xterm-256color'}});pty.onData(data=>win.webContents.send('terminal:data',{terminalId:'qa',data}));return {terminalId:'qa',shell:'native PTY',sandboxImplementation:'desktop-user'};});
ipcMain.handle('terminal:write',(event,data)=>{trusted(event);pty.write(data);});
ipcMain.handle('terminal:resize',(event,cols,rows)=>{trusted(event);pty.resize(cols,rows);});
ipcMain.handle('terminal:close',event=>{trusted(event);closes++;pty?.kill();});
ipcMain.handle('qa',async(event,action,value)=>{
 trusted(event);
 if(action==='install'){return (await plugins.install({kind:'local',path:source})).plugin;}
 if(action==='enabled'){await plugins.setSkinsEnabled((await plugins.listInstalled())[0].id,value);return;}
 if(action==='update'){
  const skin=join(source,'skins/ocean-video.artemis-skin');const path=join(skin,'manifest.json');const m=JSON.parse(await readFile(path,'utf8'));m.version='1.0.1';const bytes=JSON.stringify(m);await writeFile(path,bytes);const integrityPath=join(skin,'integrity.json');const i=JSON.parse(await readFile(integrityPath,'utf8'));i.files['manifest.json']=createHash('sha256').update(bytes).digest('hex');await writeFile(integrityPath,JSON.stringify(i));await plugins.update((await plugins.listInstalled())[0].id);return;
 }
 if(action==='remove'){await plugins.remove((await plugins.listInstalled())[0].id);return;}
 if(action==='stats'){return {opens,closes};}
 if(action==='reduced'){if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:value?'reduce':'no-preference'}]});return;}
 if(action==='pause'){appearance.setMediaPaused(value);return;}
 if(action==='narrow'){win.setSize(620,820);return;}
 if(action==='isolation'){
  const browserSession=session.fromPartition('visual-skins-browser');const handled=await browserSession.protocol.isProtocolHandled('artemis-skin');
  const isolated=new BrowserWindow({show:false,webPreferences:{session:browserSession,contextIsolation:true,sandbox:true,nodeIntegration:false}});
  await isolated.loadURL('data:text/html,<title>Isolated Browser</title>');
  const canLoad=await isolated.webContents.executeJavaScript('new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src='+JSON.stringify(value)+';setTimeout(()=>resolve(false),2000);})');isolated.destroy();return {handled,canLoad};
 }
 if(action==='screenshot'){await writeFile(join(output,value),(await win.webContents.capturePage()).toPNG());return;}
 if(action==='done'){await writeFile(join(output,'phase-'+process.env.SKIN_QA_PHASE+'.json'),JSON.stringify({...value,hostPlatform:process.platform,hostArch:process.arch,electronVersion:process.versions.electron},null,2));setTimeout(()=>app.quit(),100);return;}
 throw new Error('Unknown QA operation');
});
win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('renderer:',message);});
const owner=win.webContents.id;win.on('closed',()=>{void appearance.releaseOwner(owner);});
app.on('before-quit',()=>{pty?.kill();void appearance.dispose();});
await win.loadFile(join(root,'index.html'),{query:{phase:process.env.SKIN_QA_PHASE}});
setTimeout(()=>{console.error('Visual skin QA timed out');app.exit(1);},90000).unref();
}).catch(error=>{console.error(error);app.exit(1);});
`;
const preload = `
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('artemis',{
getAppearanceState:()=>ipcRenderer.invoke('appearance:get'),resolveSkin:s=>ipcRenderer.invoke('appearance:resolve',s),releaseSkinResources:id=>ipcRenderer.invoke('appearance:release',id),setSkinSelection:s=>ipcRenderer.invoke('appearance:select',s),onAppearanceStateChanged:listener=>{const handler=(_,s)=>listener(s);ipcRenderer.on('appearance:changed',handler);return()=>ipcRenderer.removeListener('appearance:changed',handler);},
openTerminal:()=>ipcRenderer.invoke('terminal:open'),writeTerminal:(_,s)=>ipcRenderer.invoke('terminal:write',s),resizeTerminal:(_,c,r)=>ipcRenderer.invoke('terminal:resize',c,r),closeTerminal:()=>ipcRenderer.invoke('terminal:close'),onTerminalData:listener=>{const handler=(_,s)=>listener(s);ipcRenderer.on('terminal:data',handler);return()=>ipcRenderer.removeListener('terminal:data',handler);},onTerminalExit:()=>()=>{},qa:(...args)=>ipcRenderer.invoke('qa',...args)
});
`;
const renderer = `
import React from 'react';import { createRoot } from 'react-dom/client';
import { bootstrapDesktopSkin,desktopSkinHost } from ${modulePath("apps/desktop/src/renderer/desktop-skin-bootstrap.ts")};
import { bootstrapAppearance,getAppearanceController } from ${modulePath("apps/desktop/src/renderer/appearance-controller.ts")};
import { AppearanceProvider } from ${modulePath("apps/desktop/src/renderer/AppearanceProvider.tsx")};
import { AppearanceSettingsSection } from ${modulePath("apps/desktop/src/renderer/AppearanceSettingsSection.tsx")};
import { TerminalPanel } from ${modulePath("apps/desktop/src/renderer/TerminalPanel.tsx")};
import { ArtemisIcon } from '@artemis/ui/icons';
import ${modulePath("packages/ui/dist/styles.css")};
import ${modulePath("apps/desktop/src/renderer/styles.css")};
import ${modulePath("apps/desktop/src/renderer/prototype-migration.css")};
import ${modulePath("packages/theme-artemis/dist/theme.css")};
import ${modulePath("apps/desktop/src/renderer/appearance.css")};
import ${modulePath("node_modules/@xterm/xterm/css/xterm.css")};
const checks=[],errors=[],timings={};window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const check=(condition,name)=>{if(!condition)throw new Error(name);checks.push(name);};
const wait=async(fn,name)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+name);};
const qa=async(...args)=>{if(args[0]==='screenshot'){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await new Promise(resolve=>setTimeout(resolve,150));}return window.artemis.qa(...args);};
try {
 const boot=performance.now();await bootstrapDesktopSkin('dark');await bootstrapAppearance();timings.bootstrapMs=performance.now()-boot;
 const controller=getAppearanceController(),phase=new URLSearchParams(location.search).get('phase');
 const videoSelection={pluginId:controller.snapshot().state.selection?.pluginId,skinId:'com.artemis.example.ocean-video'},staticSelection={...videoSelection,skinId:'com.artemis.example.ocean-static'};
 createRoot(document.getElementById('root')).render(<AppearanceProvider><main className='workspace'><h1>Artemis visual skin integration</h1><AppearanceSettingsSection locale='en'/><div className='composer-surface'><textarea aria-label='Draft' defaultValue='Keep this draft and selection'/><button data-artemis-component='button' aria-label='Send'><ArtemisIcon name='send'/></button></div><TerminalPanel locale='en' theme='dark' threadId='qa' title='Native PTY' emptyMessage='No terminal'/></main></AppearanceProvider>);
 await wait(()=>document.querySelector('textarea')&&document.querySelector('.xterm'),'React controls');
 if(phase==='1'){
  const plugin=await qa('install');videoSelection.pluginId=plugin.id;staticSelection.pluginId=plugin.id;check(plugin.skins.length===2,'native pure skin plugin installed');
  await wait(()=>controller.snapshot().state.catalog.length===2&&!controller.snapshot().busy,'catalog');
  const terminal=window.__skinQaTerminal;await new Promise(resolve=>terminal.write('\\r\\nQA selected 中文 terminal text\\r\\n',resolve));const selectedLine=terminal.buffer.active.baseY+terminal.buffer.active.cursorY-1;terminal.select(0,selectedLine,11);const selectedText=terminal.getSelection();
  const draft=document.querySelector('textarea');draft.focus();draft.setSelectionRange(2,8);const xterm=document.querySelector('.xterm');
  const staticStart=performance.now();await controller.preview(staticSelection);await wait(()=>controller.snapshot().applied?.skinId===staticSelection.skinId&&!controller.snapshot().busy,'static preview '+JSON.stringify(controller.snapshot().diagnostics));timings.staticPreparationMs=performance.now()-staticStart;check(true,'static preview applied');check((await window.artemis.getAppearanceState()).selection===null,'preview is not persisted');
  check(document.fonts.size>=3,'bundled fonts decoded');check(document.querySelector('.appearance-background img').naturalWidth===1280,'wallpaper decoded');
  check(!document.querySelector('.appearance-background').hidden&&getComputedStyle(document.querySelector('.workspace')).backgroundColor==='rgba(0, 0, 0, 0)','wallpaper is visible through workspace');
  await wait(()=>document.querySelector('[aria-label=Send] svg path')?.getAttribute('d')===controller.snapshot().icons.send?.[0]?.d,'semantic icon override');
  check(document.querySelector('textarea')===draft&&draft.value==='Keep this draft and selection'&&draft.selectionStart===2&&draft.selectionEnd===8&&document.activeElement===draft,'draft node, focus and selection retained');
  check(terminal.getSelection()===selectedText&&selectedText.length>0,'terminal selection survives font fit');
  await qa('screenshot','static-desktop.png');await controller.cancelPreview();check(controller.snapshot().applied===null,'cancel restores default');
  const videoStart=performance.now();document.querySelector('.appearance-settings [data-part=trigger]').click();await wait(()=>[...document.querySelectorAll('[data-part=option]')].some(option=>option.textContent.includes('Ocean Motion')),'skin chooser');[...document.querySelectorAll('[data-part=option]')].find(option=>option.textContent.includes('Ocean Motion')).click();await wait(()=>controller.snapshot().applied?.skinId===videoSelection.skinId&&!controller.snapshot().busy,'video preview from settings');timings.videoPreparationMs=performance.now()-videoStart;
  [...document.querySelectorAll('.appearance-settings button')].find(button=>button.textContent==='Apply skin').click();await wait(()=>controller.snapshot().preview===undefined&&controller.snapshot().state.selection?.skinId===videoSelection.skinId&&!controller.snapshot().busy,'confirm from settings');check(true,'settings chooser and Apply persist selection');
  await wait(()=>{const v=document.querySelector('.appearance-background video');return v&&v.readyState>=2&&!v.paused&&v.currentTime>0;},'video playing');
  check(document.querySelector('.appearance-background video').muted,'video forced muted');check(document.fonts.size<=4,'old font faces released');
  const resolved=await window.artemis.resolveSkin(videoSelection),url=resolved.assets.video.url;
  const isolation=await qa('isolation',url);check(!isolation.handled&&!isolation.canLoad,'Browser partition cannot load skin resources');await window.artemis.releaseSkinResources(resolved.leaseId);
  await qa('pause',true);await wait(()=>document.querySelector('.appearance-background video').paused,'hidden pause');await qa('pause',false);
  await qa('reduced',true);await wait(()=>document.querySelector('.appearance-background video').paused&&document.querySelector('.appearance-background video').style.visibility==='hidden','reduced motion poster');await qa('reduced',false);
  await desktopSkinHost.setContrast('high');check(document.querySelector('.appearance-background').hidden,'high contrast removes wallpaper');await desktopSkinHost.setContrast('normal');
  await qa('enabled',false);await wait(()=>controller.snapshot().applied===null&&!controller.snapshot().busy,'disabled fallback');check((await window.artemis.getAppearanceState()).selection.skinId===videoSelection.skinId,'disable retains selection');
  await qa('enabled',true);await wait(()=>controller.snapshot().applied?.skinId===videoSelection.skinId&&!controller.snapshot().busy,'reenabled restore');
  await qa('update');await wait(()=>controller.snapshot().state.catalog.find(s=>s.id===videoSelection.skinId)?.version==='1.0.1'&&controller.snapshot().applied?.skinId===videoSelection.skinId&&!controller.snapshot().busy,'video update');
  check(document.querySelectorAll('[data-appearance-lease]').length===1&&document.querySelector('textarea')===draft&&document.querySelector('.xterm')===xterm,'update retains UI nodes and releases old styles');
  const stats=await qa('stats');check(stats.opens===1&&stats.closes===0,'native PTY survives visual updates');
  await qa('screenshot','video-desktop.png');await qa('narrow');await qa('screenshot','video-narrow.png');
 }else{
  check(controller.snapshot().applied?.skinId===videoSelection.skinId,'selection restored before first React render after process restart');
  await qa('remove');await wait(()=>controller.snapshot().applied===null&&!controller.snapshot().busy,'uninstall fallback');check((await window.artemis.getAppearanceState()).selection===null,'uninstall clears persisted selection');
 }
 check(errors.length===0,'no renderer errors');check(timings.bootstrapMs<10000&&(!timings.staticPreparationMs||timings.staticPreparationMs<6000)&&(!timings.videoPreparationMs||timings.videoPreparationMs<6000),'appearance preparation budget');await qa('done',{passed:true,platform:navigator.platform,phase,checks,timings,diagnostics:controller.snapshot().diagnostics});
}catch(error){console.error(error);await qa('done',{passed:false,error:String(error),checks,errors,diagnostics:getAppearanceController().snapshot().diagnostics});}
`;
try {
  await writeFile(join(temporary, "main.ts"), main);
  await writeFile(join(temporary, "preload.cjs"), preload);
  await writeFile(join(temporary, "renderer.tsx"), renderer);
  const terminalWrapper = join(temporary, "xterm-wrapper.mjs");
  await writeFile(
    terminalWrapper,
    `import {Terminal as ProductionTerminal} from ${modulePath("node_modules/@xterm/xterm/lib/xterm.mjs")};export class Terminal extends ProductionTerminal {constructor(options){super(options);window.__skinQaTerminal=this;}}`,
  );
  await build({
    entryPoints: [join(temporary, "main.ts")],
    outfile: join(temporary, "main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron", "node-pty"],
    banner: {
      js: `import {createRequire as bundleCreateRequire} from 'node:module';const require=bundleCreateRequire(${modulePath("package.json")});`,
    },
  });
  await build({
    entryPoints: [join(temporary, "renderer.tsx")],
    outfile: join(temporary, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome140",
    jsx: "automatic",
    nodePaths: [join(repository, "node_modules")],
    plugins: [
      {
        name: "native-terminal-qa",
        setup(builder) {
          builder.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({
            path: terminalWrapper,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await writeFile(
    join(temporary, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' artemis-skin:; font-src 'self' artemis-skin:; media-src 'self' artemis-skin:; connect-src 'none'"><link rel="stylesheet" href="renderer.css"><style>body{margin:0;color:var(--artemis-color-text-primary);background:var(--artemis-color-canvas);font:14px var(--artemis-typography-body-family)}.workspace{padding:24px;min-height:100vh}.composer-surface{padding:16px;background:var(--artemis-color-surface-base)}textarea{width:80%;height:80px;font:inherit}.terminal-host{height:250px}.terminal-panel{margin-top:24px}.appearance-settings{max-width:580px}</style></head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>`,
  );
  const electron = createRequire(import.meta.url)("electron");
  for (const phase of ["1", "2"]) {
    const env = { ...process.env, SKIN_QA_PHASE: phase };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      electron,
      [join(temporary, "main.mjs"), "--disable-gpu"],
      { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        log += String(data);
      });
    const timer = setTimeout(() => child.kill(), 120000);
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    clearTimeout(timer);
    await writeFile(join(output, `phase-${phase}.log`), log);
    if (code !== 0) throw new Error(`Electron exited ${code}: ${log}`);
    const report = JSON.parse(
      await readFile(join(output, `phase-${phase}.json`), "utf8"),
    );
    if (!report.passed) throw new Error(JSON.stringify(report));
    console.log(
      `Real Electron phase ${phase}: ${report.checks.length} checks passed.`,
    );
  }
  console.log(`Evidence: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
