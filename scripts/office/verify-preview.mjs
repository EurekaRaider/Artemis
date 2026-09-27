// Real renderer/PDF rasterization with an explicit synthetic IPC fixture.
// This measures renderer behavior, not native round-trip compatibility or end-to-end latency.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { PDFDocument, StandardFonts } from "pdf-lib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? "artifacts/office/preview");
const nativeDirectory = process.argv[3] && resolve(process.argv[3]);
const nativeCases = [];
if (nativeDirectory) {
  for (const [format, id] of [
    ["word", "word_2col-header.docx"],
    ["excel", "sheets_TableStyleTest.xlsx"],
    ["powerpoint", "slides_ShapePlusImage.pptx"],
    ["excel", "sheets_PivotTable_CachedDefinitionAndDataInSync.xlsx"],
  ]) {
    nativeCases.push({
      format,
      path: id.slice(id.indexOf("_") + 1),
      snapshot: JSON.parse(
        await readFile(join(nativeDirectory, id, "snapshots.json"), "utf8"),
      ).reopened,
      pdf: (await readFile(join(nativeDirectory, id, "reopened.pdf"))).toString(
        "base64",
      ),
    });
  }
}
const fixture = await mkdtemp(
  join(repo, "artifacts", "office-preview-fixture-"),
);
const profile = await mkdtemp(join(tmpdir(), "artemis-office-preview-"));
await mkdir(out, { recursive: true });
const pdfs = [];
for (const version of [0, 1, 2]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) {
    const sheet = pdf.addPage([600, 780]);
    sheet.drawText(`Artemis Office preview - draft ${version}`, {
      x: 42,
      y: 712,
      size: 24,
      font,
    });
    sheet.drawText(`Page ${page} - actual PDF content`, {
      x: 42,
      y: 666,
      size: 16,
      font,
    });
    sheet.drawRectangle({
      x: 42 + version * 30,
      y: 470,
      width: 320,
      height: 130,
      color: (await import("pdf-lib")).rgb(0.15, 0.35 + version * 0.1, 0.65),
    });
  }
  pdfs.push(Buffer.from(await pdf.save()).toString("base64"));
}
const relative = (path) => JSON.stringify(resolve(repo, path));
await writeFile(
  join(fixture, "index.html"),
  '<!doctype html><html data-artemis-skin="com.artemis.default" data-artemis-theme="light" data-artemis-contrast="normal"><head><title>Artemis Office preview verification</title></head><body style="margin:0"><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
await writeFile(
  join(fixture, "entry.tsx"),
  `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OfficeWorkbenchPanel} from ${relative("apps/desktop/src/renderer/OfficeWorkbenchPanel.tsx")};
import '@artemis/ui/styles.css';
import '@artemis/theme-artemis/theme.css';
const pdfs = ${JSON.stringify(pdfs)};
const nativeCases = ${JSON.stringify(nativeCases)};
let current = 0; window.notes = []; window.paints = []; window.errors = []; window.recovered = [];
window.addEventListener('artemis-office-preview-painted', event => window.paints.push(event.detail));
window.addEventListener('error', event => window.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', event => window.errors.push(String(event.reason)));
const session = version => ({protocolVersion:1,documentId:'sample',sessionId:'fixture',path:nativeCases[version-3]?.path??'Sample.docx',format:nativeCases[version-3]?.format??'word',engineVersion:'fixture',version,savedVersion:version>=3?version:0,previewVersion:version,sequence:version+1,status:version>=3||!version?'saved':'editing'});
window.artemis = {
 readOfficeSnapshot: async () => ({session:session(current),targets:[{selection:{kind:'paragraph',index:0,start:0,end:12},text:'Artemis Office preview'}],sheets:[],warnings:[],...nativeCases[current-3]?.snapshot,preview:{assetId:String(current),version:current}}),
 openOfficePreview: async (_thread,_session,assetId) => { const v=Number(assetId); if(v===1) await new Promise(resolve=>setTimeout(resolve,350)); return {data:v>=3?nativeCases[v-3].pdf:pdfs[v],version:v}; }
};
function Fixture(){const [version,setVersion]=useState(0);const [gap,setGap]=useState(false);window.recoverGap=()=>setGap(true);window.advance=v=>{current=v;setVersion(v)};return <main style={{height:'100vh',padding:16,boxSizing:'border-box'}}><OfficeWorkbenchPanel key={version>=3?version:'synthetic'} locale="zh-CN" threadId="fixture" view={{session:session(version),needsSnapshot:gap}} onSnapshot={snapshot=>{window.recovered.push(snapshot.session.sequence);setGap(false)}} onAnnotate={note=>window.notes.push(note)}/></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`,
);
await build({
  configFile: false,
  root: fixture,
  base: "./",
  plugins: [react()],
  build: { outDir: join(fixture, "dist"), emptyOutDir: true },
});
const electron = createRequire(import.meta.url)("electron");
const main = join(profile, "main.cjs");
await writeFile(
  main,
  `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(join(profile, "user"))});
const out=${JSON.stringify(out)};
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1100,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
 const errors=[]; win.webContents.on('console-message', details=>{if(details.level==='error') errors.push(details.message)});
 const js=source=>win.webContents.executeJavaScript(source);
 const wait=async source=>{for(let i=0;i<200;i++){if(await js(source))return;await new Promise(r=>setTimeout(r,50))}await fs.writeFile(out+'/failure.png',(await win.webContents.capturePage()).toPNG());throw Error('Timeout: '+source+'; '+JSON.stringify(await js('({errors:window.errors,text:document.body.innerText,paints:window.paints})')))};
 await win.loadFile(${JSON.stringify(join(fixture, "dist/index.html"))});
 await wait('document.querySelector(".office-page-scroll canvas")?.dataset.previewVersion === "0"');
 const before=await js('document.querySelector(".office-page-scroll canvas").toDataURL()');
 await js('window.advance(1)'); await new Promise(r=>setTimeout(r,30)); await js('window.advance(2)');
 await wait('document.querySelector(".office-page-scroll canvas")?.dataset.previewVersion === "2"');
 await new Promise(r=>setTimeout(r,500));
 if(await js('document.querySelector(".office-page-scroll canvas").dataset.previewVersion')!=='2') throw Error('Stale render overwrote the latest version');
 if(before===await js('document.querySelector(".office-page-scroll canvas").toDataURL()')) throw Error('Document content did not repaint');
 await js('window.recoverGap()');
 await wait('window.recovered.includes(3)');
 const bounds=await js('(()=>{const r=document.querySelector(".office-page-scroll canvas").getBoundingClientRect();return {x:r.x,y:r.y}})()');
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(bounds.x+30),y:Math.round(bounds.y+30),button:'left',clickCount:1});
 win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(bounds.x+130),y:Math.round(bounds.y+100),button:'left',clickCount:1});
 await js('document.querySelector("textarea").focus()');
 await win.webContents.insertText('Please check this region.');
 await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("加入输入框")&&!b.disabled)');
 await js('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("加入输入框")).click()');
 await wait('window.notes.length===1');
 const note=await js('window.notes[0]'); if(note.sourceVersion!==2||note.selection.kind!=='region') throw Error('Annotation lost its rendered source version');
 const scroll=await js('(()=>{const s=document.querySelector(".office-page-scroll");s.scrollTop=100;return s.scrollTop})()');
 await fs.writeFile(out+'/desktop.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(600,850); await new Promise(r=>setTimeout(r,100));
 await fs.writeFile(out+'/compact.png',(await win.webContents.capturePage()).toPNG());
 const nativeScreenshots=[]; let sheetPageMappingVerified=false;
 for(const [index,sample] of ${JSON.stringify(nativeCases.map(({ format, path }) => ({ format, path })))}.entries()) {
   win.setContentSize(760,960);
   await js('window.advance('+(index+3)+')');
   await wait('document.querySelector(".office-page-scroll canvas")?.dataset.previewVersion === "'+(index+3)+'"');
   await wait('document.querySelector(".office-workbench")?.getAttribute("aria-label") === '+JSON.stringify(sample.path));
   if(sample.format==='powerpoint') await wait('[...document.querySelectorAll("nav canvas")].length>0 && [...document.querySelectorAll("nav canvas")].every(canvas=>canvas.dataset.previewVersion==="'+(index+3)+'")');
   if(index===3) {
     await js('[...document.querySelectorAll("[data-artemis-component=select]")].find(control=>control.querySelector("[data-part=label]").textContent==="工作表").querySelector("button").click()');
     await wait('[...document.querySelectorAll("[role=option]")].some(option=>option.textContent==="Sheet1")');
     await js('[...document.querySelectorAll("[role=option]")].find(option=>option.textContent==="Sheet1").click()');
     await wait('document.querySelector(".office-page-scroll canvas")?.dataset.previewPage==="2"');
     sheetPageMappingVerified=true;
     continue;
   }
   await fs.writeFile(out+'/'+sample.format+'.png',(await win.webContents.capturePage()).toPNG());
   nativeScreenshots.push({...sample,screenshot:sample.format+'.png',viewport:win.getContentSize()});
 }
 const report={fixture:'synthetic IPC with real PDF.js rasterization',nativeScreenshots,sheetPageMappingVerified,browser:'Browser plugin not available; repository Electron verification pattern',title:await js('document.title'),contentChanged:true,staleRenderRejected:true,eventGapSnapshotRecovered:true,annotation:note,scroll,errors:[...errors,...await js('window.errors')],paints:await js('window.paints')};
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
 if(report.errors.length) throw Error(JSON.stringify(report.errors));
 win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`,
);
try {
  await new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [main], { stdio: "inherit", env });
    // Native documents render sequentially; each readiness assertion stays bounded.
    const timeout = setTimeout(
      () => {
        child.kill();
        reject(new Error("Office preview verification timed out"));
      },
      nativeCases.length ? 120_000 : 30_000,
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error(`Office preview verification failed: ${code}`));
    });
  });
  console.log(await readFile(join(out, "report.json"), "utf8"));
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
