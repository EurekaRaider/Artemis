#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  copyFile,
} from "node:fs/promises";
import { watch } from "node:fs";
import { resolve, join, relative, dirname, isAbsolute, sep } from "node:path";
import {
  manifestV2Schema,
  normalizeResourceManifest,
  pluginManifestSchema,
} from "@artemis/plugin-contract";
import { zipEntries } from "../design-pack/pack.mjs";

const [command, input = ".", option] = process.argv.slice(2);
const root = resolve(input);
const manifestFile = join(root, "artemis.plugin.json");
async function files(directory = root) {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    if ([".git", "node_modules", ".env"].includes(name))
      throw new Error(
        `Remove ${name} from the plugin package; bundle runtime dependencies first.`,
      );
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink is not allowed: ${relative(root, path)}`);
    if (stat.isDirectory()) result.push(...(await files(path)));
    else if (stat.isFile()) {
      if (stat.size > 10 * 1024 * 1024)
        throw new Error(`File exceeds 10 MiB: ${name}`);
      result.push({
        name: relative(root, path).replaceAll("\\", "/"),
        bytes: await readFile(path),
        executable: Boolean(stat.mode & 0o111),
      });
    }
  }
  return result;
}
async function validate() {
  const value = JSON.parse(await readFile(manifestFile, "utf8"));
  const manifest =
    value.schemaVersion === 2
      ? manifestV2Schema.parse(value)
      : normalizeResourceManifest(value);
  if (value.engines?.artemisPluginApi) pluginManifestSchema.parse(value);
  const contents = await files();
  if (
    contents.length > 2500 ||
    contents.reduce((sum, entry) => sum + entry.bytes.length, 0) >
      100 * 1024 * 1024
  )
    throw new Error("Plugin exceeds package limits");
  if (value.schemaVersion === 2) {
    const paths =
      manifest.kind === "resource"
        ? [
            ...manifest.contributes.skills.map(
              (path) => `${path.replace(/\/$/, "")}/SKILL.md`,
            ),
            ...manifest.contributes.skins,
            ...manifest.contributes.hooks,
            ...(manifest.contributes.mcp ? [manifest.contributes.mcp] : []),
          ]
        : [
            manifest.runtime.entry,
            ...manifest.panels.map((panel) => panel.entry),
          ];
    for (const path of paths) await lstat(join(root, path));
  }
  return { manifest, contents };
}
async function init() {
  const kind = option ?? "resource";
  if (!["resource", "interactive"].includes(kind))
    throw new Error("init kind must be resource or interactive");
  const name = root.split(/[\\/]/).at(-1);
  const base = {
    schemaVersion: 2,
    kind,
    id: `local.${name}`,
    name,
    version: "0.1.0",
  };
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name))
    throw new Error(
      "Plugin directory name must be lowercase letters, digits, dots, underscores or hyphens (maximum 64 characters)",
    );
  await mkdir(root, { recursive: false });
  if (kind === "resource") {
    base.contributes = { skills: ["skills/hello"], skins: [], hooks: [] };
    await mkdir(join(root, "skills/hello"), { recursive: true });
    await writeFile(
      join(root, "skills/hello/SKILL.md"),
      "---\nname: hello\ndescription: Explain this project in plain language.\n---\nRead the project documentation and explain its purpose.\n",
    );
  } else {
    Object.assign(base, {
      engines: { artemisPluginApi: "1" },
      projectTypes: [
        {
          id: "notes",
          title: { en: "Notes", "zh-CN": "笔记" },
          targets: ["project", "temporary"],
          panelIds: ["notes"],
        },
      ],
      panels: [{ id: "notes", entry: "panel/index.html" }],
      runtime: { entry: "runtime/index.mjs", protocolVersion: 1 },
      tools: [
        {
          name: "notes_list",
          description: "Read this task's notes",
          effect: "state-read",
        },
      ],
      capabilities: {
        artifactStore: "thread",
        projectFiles: "explicit-import",
        network: "none",
        sessionInput: "host-user-action",
      },
    });
    await mkdir(join(root, "runtime"));
    await mkdir(join(root, "panel"));
    await copyFile(
      new URL("../../packages/plugin-sdk/dist/runtime.js", import.meta.url),
      join(root, "runtime/sdk.mjs"),
    );
    await writeFile(
      join(root, "runtime/index.mjs"),
      `import { serveRuntime } from './sdk.mjs';\nserveRuntime(${JSON.stringify(base.id)}, { notes_list: async () => [] });\n`,
    );
    await writeFile(
      join(root, "panel/index.html"),
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Notes</title><body><h1>Notes</h1><p>Ask the agent to list notes in this task.</p></body></html>\n',
    );
  }
  manifestV2Schema.parse(base);
  await writeFile(manifestFile, JSON.stringify(base, null, 2) + "\n");
  console.log(`Created ${kind} plugin: ${root}`);
}
try {
  if (command === "init") await init();
  else if (command === "validate") {
    await validate();
    console.log(
      "Plugin is valid. Host trust and sandbox checks still apply at installation.",
    );
  } else if (command === "pack") {
    const { contents } = await validate();
    const output = resolve(option ?? `${root}.zip`);
    const outputPath = relative(root, output);
    if (!(
      outputPath === ".." ||
      outputPath.startsWith(`..${sep}`) ||
      isAbsolute(outputPath)
    ))
      throw new Error("Write the archive outside the plugin directory");
    await writeFile(output, zipEntries(contents), { flag: "wx" });
    console.log(output);
  } else if (command === "dev") {
    await validate();
    console.log(
      "Watching plugin files; install this directory in Artemis to test host integration.",
    );
    let timer;
    const watcher = watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          validate().then(
            () => console.log("Valid"),
            (error) => console.error(error.message),
          ),
        150,
      );
    });
    process.once("SIGINT", () => {
      clearTimeout(timer);
      watcher.close();
    });
  } else if (command === "migrate") {
    const legacy = JSON.parse(await readFile(manifestFile, "utf8"));
    if (legacy.schemaVersion !== 1)
      throw new Error("migrate accepts v1 manifests only");
    const interactive = Boolean(legacy.engines?.artemisPluginApi);
    if (!interactive) {
      const supported = new Set([
        "schemaVersion",
        "id",
        "name",
        "version",
        "description",
        "skills",
        "skins",
        "hooks",
        "mcpServers",
      ]);
      const unsupported = Object.keys(legacy).filter(
        (key) => !supported.has(key),
      );
      if (unsupported.length)
        throw new Error(
          `Manual migration required to preserve fields: ${unsupported.join(", ")}`,
        );
      if (legacy.mcpServers && typeof legacy.mcpServers !== "string")
        throw new Error(
          "Write inline MCP declarations to a package file before migration",
        );
    }
    const paths = (value) =>
      value === undefined ? [] : typeof value === "string" ? [value] : value;
    const next = interactive
      ? {
          ...legacy,
          schemaVersion: 2,
          kind: "interactive",
          name: legacy.name ?? legacy.id,
        }
      : {
          schemaVersion: 2,
          kind: "resource",
          id: legacy.id ?? legacy.name,
          name: legacy.name,
          version: legacy.version,
          ...(legacy.description ? { description: legacy.description } : {}),
          contributes: {
            skills: paths(legacy.skills),
            skins: paths(legacy.skins),
            hooks: paths(legacy.hooks),
            ...(legacy.mcpServers ? { mcp: legacy.mcpServers } : {}),
          },
        };
    const output = manifestV2Schema.parse(next);
    await writeFile(
      join(root, "artemis.plugin.v2.json"),
      JSON.stringify(output, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(
      "Review artemis.plugin.v2.json before replacing the original manifest. Explicitly declare any previously auto-discovered resources.",
    );
  } else
    throw new Error(
      "Usage: npm run plugin -- init DIR [resource|interactive] | validate DIR | dev DIR | pack DIR [ZIP] | migrate DIR",
    );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        code: "PLUGIN_INVALID",
        phase: command ?? "usage",
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
