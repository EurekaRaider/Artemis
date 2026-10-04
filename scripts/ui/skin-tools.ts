import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { parseFragment } from "parse5";
import {
  artemisThemeManifest,
  artemisTokenDocuments,
} from "@artemis/theme-artemis";
import {
  generateSkinCss,
  generateSkinMotionCss,
  SKIN_FONT_STACKS,
  skinDeclaredFiles,
  isSkinRelativePath,
  validateSkinIcons,
  validateVisualSkinManifest,
  validateSkinPackage,
  type SkinIcons,
  type SkinGeometry,
  type VisualSkinManifest,
} from "@artemis/theme-contract";
import {
  loadSkinPackage,
  skinSafePath,
  skinFileIdentity,
} from "../../apps/desktop/src/main/appearance/skin-package.js";
import { AppearanceService } from "../../apps/desktop/src/main/appearance/appearance-service.js";
import type { ArtemisPluginService } from "../../apps/desktop/src/main/plugins/artemis-plugin-service.js";

const VERSION = "1.0.0";
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function readJson(path: string) {
  const b = await readStable(dirname(path), basename(path));
  if (b.length > 1_048_576) throw new Error("JSON exceeds 1 MiB.");
  return JSON.parse(b.toString("utf8")) as Record<string, unknown>;
}
async function pathsUnder(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Symlink is forbidden: ${path}`);
    if (entry.isDirectory()) files.push(...(await pathsUnder(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported file: ${path}`);
    if (files.length > 2500) throw new Error("Plugin exceeds 2500 files.");
  }
  return files.sort();
}
async function readStable(root: string, path: string) {
  const full = await skinSafePath(root, path),
    handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 50n * 1_048_576n)
      throw new Error(`Plugin file exceeds 50 MiB: ${path}`);
    const bytes = await handle.readFile(),
      after = await handle.stat({ bigint: true });
    if (
      skinFileIdentity(before) !== skinFileIdentity(after) ||
      skinFileIdentity(after) !==
        skinFileIdentity(
          await lstat(await skinSafePath(root, path), { bigint: true }),
        )
    )
      throw new Error("Source changed during build.");
    return bytes;
  } finally {
    await handle.close();
  }
}
async function packages(root: string) {
  const manifest = await readJson(join(root, "artemis.plugin.json"));
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.name !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(manifest.name) ||
    typeof manifest.version !== "string" ||
    !manifest.version ||
    !Array.isArray(manifest.skins) ||
    manifest.skins.length < 1 ||
    manifest.skins.length > 32
  )
    throw new Error(
      "Expected native plugin manifest with 1–32 declared skins.",
    );
  const paths: string[] = [];
  for (const declaration of manifest.skins) {
    if (typeof declaration !== "string")
      throw new Error("Skin declarations must be strings.");
    const path = declaration.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (!isSkinRelativePath(path) || paths.includes(path))
      throw new Error("Unsafe or duplicate skin package directory.");
    await skinSafePath(root, `${path}/manifest.json`);
    paths.push(path);
  }
  return paths;
}
async function validate(root: string) {
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("Package root cannot be a symlink.");
  root = await realpath(root);
  if ((await readdir(root)).includes("artemis.plugin.json")) {
    const paths = await packages(root),
      ids = new Set<string>();
    let total = 0;
    for (const file of await pathsUnder(root)) {
      const size = (await lstat(await skinSafePath(root, file))).size;
      if (size > 50 * 1_048_576) throw new Error("Plugin file exceeds 50 MiB.");
      total += size;
    }
    if (total > 200 * 1_048_576) throw new Error("Plugin exceeds 200 MiB.");
    for (const path of paths) {
      const loaded = await loadSkinPackage(join(root, path));
      const id = loaded.data.manifest.id;
      if (id === "com.artemis.default" || ids.has(id))
        throw new Error(`Duplicate or reserved skin ID: ${id}`);
      ids.add(id);
    }
    return { root, skins: [...ids] };
  }
  const loaded = await loadSkinPackage(root);
  return { root, skins: [loaded.data.manifest.id] };
}
async function integrity(root: string) {
  const manifest = validateVisualSkinManifest(
    await readJson(join(root, "manifest.json")),
  );
  if (!manifest.value || !manifest.valid)
    throw new Error(json(manifest.issues));
  const files: Record<string, string> = {};
  for (const path of skinDeclaredFiles(manifest.value))
    files[path] = hash(await readStable(root, path));
  await writeFile(
    join(root, "integrity.json"),
    json({
      ...(manifest.value.schemaVersion === 2 ? { schemaVersion: 2 } : {}),
      algorithm: "sha256",
      files,
    }),
  );
}
async function init(root: string, id = "com.example.ocean") {
  const manifest = {
    ...artemisThemeManifest,
    schemaVersion: 2,
    id,
    name: "Ocean",
    version: "1.0.0",
    assets: {},
    backgrounds: { light: { type: "none" }, dark: { type: "none" } },
  } satisfies VisualSkinManifest;
  const report = validateVisualSkinManifest(manifest);
  if (!report.valid) throw new Error(json(report.issues));
  await mkdir(root);
  try {
    const path = "skins/ocean.artemis-skin",
      skin = join(root, path);
    await mkdir(skin, { recursive: true });
    await writeFile(
      join(root, "artemis.plugin.json"),
      json({
        schemaVersion: 1,
        name: "ocean-visual-skins",
        version: "1.0.0",
        description: "Local visual skins for Artemis",
        interface: { displayName: "Ocean Skins", category: "Design" },
        skins: [`./${path}/`],
      }),
    );
    await writeFile(join(skin, "manifest.json"), json(manifest));
    for (const [file, value] of Object.entries(artemisTokenDocuments))
      await writeFile(join(skin, file), json({ ...value, skinId: id }));
    await integrity(skin);
    await validate(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
async function build(source: string, destination: string) {
  if ((await lstat(source)).isSymbolicLink())
    throw new Error("Source root cannot be a symlink.");
  source = await realpath(source);
  destination = resolve(destination);
  if (destination === source || destination.startsWith(source + sep))
    throw new Error("Output must be outside the source directory.");
  try {
    await lstat(destination);
    throw new Error("Output already exists; choose a new directory.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(dirname(destination), { recursive: true });
  const stage = join(dirname(destination), `.skin-build-${randomUUID()}`);
  try {
    await mkdir(stage);
    let total = 0;
    for (const file of await pathsUnder(source)) {
      const bytes = await readStable(source, file);
      total += bytes.length;
      if (total > 200 * 1_048_576) throw new Error("Plugin exceeds 200 MiB.");
      const target = join(stage, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, {
        mode: (await lstat(join(source, file))).mode & 0o777,
      });
    }
    const skinPaths = (await readdir(stage)).includes("artemis.plugin.json")
      ? await packages(stage)
      : [""];
    for (const path of skinPaths) await integrity(join(stage, path));
    await validate(stage);
    await rename(stage, destination);
    console.log(`Built ${destination}`);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
async function convertIcons(source: string, output: string) {
  const icons: Record<string, SkinGeometry[]> = {};
  for (const file of (await readdir(source))
    .filter((p) => p.endsWith(".svg"))
    .sort()) {
    const path = await skinSafePath(source, file),
      bytes = await readFile(path);
    if (bytes.length > 1_048_576) throw new Error("SVG exceeds 1 MiB.");
    const text = bytes.toString("utf8").replace(/^\s*<\?xml\s[^?]*\?>/u, "");
    if (/<!DOCTYPE|<!ENTITY|<\?/iu.test(text))
      throw new Error("SVG declarations are unsupported.");
    const parsed = parseFragment(text);
    const roots = parsed.childNodes.filter((n) => "tagName" in n);
    if (
      roots.length !== 1 ||
      !("tagName" in roots[0]!) ||
      roots[0].tagName !== "svg"
    )
      throw new Error("Expected one SVG document.");
    const root = roots[0];
    const attrs = Object.fromEntries(root.attrs.map((a) => [a.name, a.value]));
    if (attrs.viewBox !== "0 0 24 24")
      throw new Error("SVG viewBox must be 0 0 24 24.");
    const shapes: SkinGeometry[] = [];
    function visit(
      node: (typeof parsed.childNodes)[number],
      inheritedFill: string,
    ) {
      if (!("tagName" in node)) {
        if ("value" in node && node.value.trim())
          throw new Error("SVG text is unsupported.");
        return;
      }
      const a = Object.fromEntries(node.attrs.map((v) => [v.name, v.value])),
        type = node.tagName;
      const fields: Record<string, string[]> = {
        svg: ["viewBox", "width", "height", "xmlns"],
        g: [],
        path: ["d"],
        circle: ["cx", "cy", "r"],
        rect: ["x", "y", "width", "height", "rx"],
        line: ["x1", "y1", "x2", "y2"],
      };
      if (!fields[type]) throw new Error(`Unsupported SVG element: ${type}`);
      for (const key of Object.keys(a))
        if (
          ![
            ...fields[type]!,
            "fill",
            "stroke",
            "stroke-width",
            "stroke-linecap",
            "stroke-linejoin",
          ].includes(key)
        )
          throw new Error(`Unsupported SVG attribute: ${key}`);
      const fill = a.fill ?? inheritedFill;
      if (type !== "svg" && type !== "g") {
        const shape: Record<string, unknown> = { type };
        for (const key of fields[type]!) {
          if (a[key] === undefined && key === "rx") continue;
          shape[key] = key === "d" ? a[key] : Number(a[key]);
        }
        if (type !== "line") shape.fill = fill !== "none";
        shapes.push(shape as unknown as SkinGeometry);
      }
      for (const child of node.childNodes) visit(child, fill);
    }
    visit(root, attrs.fill ?? "currentColor");
    icons[basename(file, ".svg")] = shapes;
  }
  const result = { schemaVersion: 1, icons } satisfies SkinIcons;
  const report = validateSkinIcons(result);
  if (!report.valid) throw new Error(json(report.issues));
  await writeFile(output, json(result), { flag: "wx" });
  console.log(`Converted ${Object.keys(icons).length} icons to ${output}`);
}
function escape(text: string) {
  return text.replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
async function preview(root: string, port = 8787) {
  root = await realpath(root);
  if ((await readdir(root)).includes("artemis.plugin.json"))
    root = join(root, (await packages(root))[0]!);
  const loaded = await loadSkinPackage(root),
    manifest = loaded.data.manifest,
    contentHash = loaded.files["manifest.json"]!.hash;
  const plugins = {
    skinSources: async () => [
      {
        pluginId: "preview",
        pluginName: "Preview",
        contentHash,
        enabled: true,
        root: dirname(root),
        skins: [
          {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            schemaVersion: manifest.schemaVersion,
            path: basename(root),
          },
        ],
      },
    ],
    assertSkinSnapshot: async () => {
      await loadSkinPackage(root);
    },
  } as unknown as ArtemisPluginService;
  const appearance = new AppearanceService({
    plugins,
    getSelection: async () => null,
    saveSelection: async () => {},
    getTheme: async () => "system",
    changed: () => {},
  });
  await appearance.refresh();
  const resolved = await appearance.resolve(0, {
    pluginId: "preview",
    skinId: manifest.id,
  });
  const assets = Object.fromEntries(
    Object.entries(resolved.assets).map(([id, a]) => [
      id,
      { ...a, url: `/resource${new URL(a.url).pathname}` },
    ]),
  );
  const payload = JSON.stringify({
    manifest,
    assets,
    icons: loaded.data.icons,
    fontStacks: SKIN_FONT_STACKS,
  }).replace(/</gu, "\\u003c");
  const fallback = validateSkinPackage({
    manifest: artemisThemeManifest,
    tokenDocuments: artemisTokenDocuments,
  }).value!;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(manifest.name)} — Artemis Skin Preview</title><style>${generateSkinCss(fallback)}${generateSkinCss(loaded.data)}${generateSkinMotionCss(loaded.data.motion, manifest.id)}
  *{box-sizing:border-box}body{margin:0;color:var(--artemis-color-text-primary);background:var(--artemis-color-canvas);font:14px var(--artemis-typography-body-family)}header{padding:16px;display:flex;gap:12px;flex-wrap:wrap;background:var(--artemis-color-surface-raised)}button,select{font:inherit;color:inherit;background:var(--artemis-color-surface-base);border:1px solid var(--artemis-color-border-default);border-radius:var(--artemis-radius-control);padding:8px}button:focus-visible,select:focus-visible{outline:2px solid var(--artemis-color-focus-ring)}main{display:grid;grid-template-columns:200px 1fr;max-width:1200px;margin:auto;min-height:80vh;position:relative}nav{padding:24px;background:var(--artemis-color-background-sidebar)}article{padding:32px}section{padding:20px;border-radius:var(--artemis-radius-card);background:var(--artemis-color-surface-base);margin:16px 0}code,pre{font-family:var(--artemis-typography-mono-family)}pre{padding:16px;background:var(--artemis-color-terminal-background);color:var(--artemis-color-terminal-foreground);overflow:auto}svg{width:20px;height:20px;vertical-align:middle}#background{position:fixed;inset:0;pointer-events:none;overflow:hidden}#background>*{position:absolute;width:100%;height:100%;inset:0}header,main{position:relative}#conversation{font-family:var(--preview-conversation,var(--artemis-typography-body-family))}@media(max-width:600px){main{grid-template-columns:1fr}nav{display:none}article{padding:16px}}</style></head><body><div id="background"></div><header><strong>${escape(manifest.name)} · ${escape(manifest.version)}</strong><select id="theme" aria-label="Theme"><option>light</option><option>dark</option></select><label><input type="checkbox" id="contrast"> High contrast</label><label><input type="checkbox" id="reduced"> Reduce motion</label><span id="status" role="status"></span></header><main><nav><h3>Artemis</h3><p>Tasks</p><p>Projects</p><p>Resources</p><p>Settings</p></nav><article><h1>Visual skin preview</h1><p id="conversation">Hello, Artemis. 中文缺字使用系统字体回退。 مرحباً</p><section class="composer-surface"><p>Skin colors, wallpaper, fonts and icons</p><button data-artemis-component="button" id="send">Send</button> <button data-artemis-component="button" id="search">Search</button> <button data-artemis-component="button" id="folder">Folder</button></section><pre>$ echo Artemis\nArtemis — 0123456789\nconst visualSkin = true;</pre><p>This preview demonstrates the visual contract. Install the plugin in Artemis to verify the complete application.</p></article></main><script>
  const data=${payload},root=document.documentElement,bg=document.querySelector('#background'),status=document.querySelector('#status');root.dataset.artemisSkin=data.manifest.id;
  async function fonts(){for(const [role,faces]of Object.entries(data.manifest.fonts||{})){const family='Preview_'+role;let ok=false;for(const f of faces){try{const face=new FontFace(family,'url("'+data.assets[f.asset].url+'")',{weight:String(f.weight),style:f.style});await Promise.race([face.load(),new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),2000))]);document.fonts.add(face);ok=true;}catch{status.textContent='Font fallback';}}if(ok){if(role==='code'){const c=document.createElement('canvas').getContext('2d');c.font='16px "'+family+'"';const widths=['iiiiiiii','WWWWWWWW','00000000'].map(t=>c.measureText(t).width);if(Math.max(...widths)-Math.min(...widths)>.25){status.textContent='Monospace font fallback';continue;}}const stack='"'+family+'",'+data.fontStacks[role==='code'?'system-mono':'system-ui'];root.style.setProperty(role==='code'?'--artemis-typography-mono-family':role==='conversation'?'--preview-conversation':'--artemis-typography-body-family',stack);}}}
  for(const [name,shapes]of Object.entries(data.icons?.icons||{})){const button=document.getElementById(name);if(!button)continue;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('stroke','currentColor');svg.setAttribute('fill','none');svg.setAttribute('aria-hidden','true');for(const shape of shapes){const node=document.createElementNS(svg.namespaceURI,shape.type);for(const [key,value]of Object.entries(shape)){if(key==='type')continue;node.setAttribute(key,key==='fill'?(value?'currentColor':'none'):String(value));}svg.append(node);}button.prepend(svg);}
  function render(){for(const v of bg.querySelectorAll('video'))v.pause();bg.replaceChildren();const theme=document.querySelector('#theme').value,high=document.querySelector('#contrast').checked,reduced=document.querySelector('#reduced').checked||matchMedia('(prefers-reduced-motion:reduce)').matches;root.dataset.artemisTheme=theme;root.dataset.artemisContrast=high?'high':'normal';root.dataset.artemisSkin=high&&!data.manifest.modes.contrasts.includes('high')?'com.artemis.default':data.manifest.id;bg.style.animation='none';const b=data.manifest.backgrounds?.[theme];if(!b||b.type==='none'||high)return;const img=new Image();img.className='appearance-background-media';img.src=data.assets[b.type==='video'?b.poster:b.asset].url;bg.append(img);if(b.type==='video'&&!reduced){const v=document.createElement('video');v.className='appearance-background-media';v.src=data.assets[b.asset].url;v.muted=true;v.defaultMuted=true;v.loop=true;v.playsInline=true;v.poster=img.src;v.addEventListener('error',()=>{v.remove();status.textContent='Video poster fallback';});bg.append(v);v.play().catch(()=>v.remove());}for(const e of bg.children)Object.assign(e.style,{objectFit:b.fit||'cover',objectPosition:(b.position||[50,50]).map(x=>x+'%').join(' '),opacity:String(b.opacity??1),filter:'blur('+(b.blur||0)+'px)'});const scrim=document.createElement('div');scrim.style.background=b.scrim||'transparent';bg.append(scrim);}
  document.querySelector('#theme').addEventListener('change',render);document.querySelector('#contrast').addEventListener('change',render);document.querySelector('#reduced').addEventListener('change',render);document.addEventListener('visibilitychange',()=>{for(const v of bg.querySelectorAll('video')){if(document.hidden)v.pause();else v.play().catch(()=>{});}});render();fonts();
  </script></body></html>`;
  const server = createServer(async (req, res) => {
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'none'",
      });
      res.end(html);
      return;
    }
    if (
      !/^\/resource\/[a-f0-9-]+$/u.test(req.url ?? "") ||
      !["GET", "HEAD"].includes(req.method ?? "")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const response = await appearance.respond(
      new Request(`artemis-skin://asset/${req.url!.split("/").at(-1)}`, {
        method: req.method!,
        headers: req.headers.range ? { Range: req.headers.range } : {},
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const stream = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      );
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } else res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`Artemis Skin Tools ${VERSION}: http://127.0.0.1:${port}/`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close();
      void appearance.dispose();
    });
}
const [command, first, second, ...extra] = process.argv.slice(2);
try {
  if (command === "--version") {
    console.log(VERSION);
  } else if (!command || command === "--help") {
    console.log(
      `Artemis Skin Tools ${VERSION}\ninit <new-plugin-directory> [skin-id]\nvalidate <plugin-or-skin-directory>\nbuild <source-directory> <new-output-directory>\npreview <plugin-or-skin-directory> [port]\nconvert-icons <svg-directory> <new-icons.json>`,
    );
  } else {
    if (!first || extra.length)
      throw new Error("Invalid arguments; use --help.");
    if (command === "init") await init(resolve(first), second);
    else if (command === "validate" && !second)
      console.log(json(await validate(resolve(first))));
    else if (command === "build" && second)
      await build(resolve(first), resolve(second));
    else if (command === "convert-icons" && second)
      await convertIcons(resolve(first), resolve(second));
    else if (command === "preview") {
      const port = second === undefined ? 8787 : Number(second);
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new Error("Invalid preview port.");
      await preview(resolve(first), port);
    } else throw new Error("Unknown command or missing arguments; use --help.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
